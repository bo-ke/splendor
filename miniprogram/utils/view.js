/**
 * 把引擎状态转换成 WXML 好渲染的视图模型（不依赖 wx；文案按 i18n 当前语言生成）。
 */

const i18n = require('./i18n');
const {
  ALL_TOKENS,
  COLORS,
  MAX_RESERVED,
  MAX_TOKENS,
  bonus,
  goldNeeded,
  points,
  tokenCount,
} = require('../engine/game');

/** 头像上的字：“电脑·甲”取“甲”，其余取首字。 */
function avatarChar(name) {
  const s = String(name || '?');
  const tail = s.split('·').pop();
  return Array.from(tail || s)[0];
}

function costList(cost) {
  return COLORS.filter((c) => cost[c]).map((c) => ({ color: c, n: cost[c] }));
}

function cardView(card, player) {
  if (!card) return null;
  const v = {
    id: card.id,
    tier: card.tier,
    bonus: card.bonus,
    points: card.points,
    cost: costList(card.cost),
    affordable: false,
    goldNeeded: 0,
    // 奇数编号的卡左右镜像插画，同色同层的卡看起来不至于完全一样
    flip: parseInt(String(card.id).replace(/\D/g, ''), 10) % 2 === 1,
  };
  if (player) {
    v.goldNeeded = goldNeeded(player, card);
    v.affordable = v.goldNeeded <= player.tokens.gold;
    if (v.affordable) {
      v.tag = v.goldNeeded ? i18n.t('fmt.goldTag', v.goldNeeded) : i18n.t('ui.canBuy');
    }
  }
  return v;
}

function nobleView(noble) {
  return {
    id: noble.id,
    name: i18n.dict().noble[noble.id] || noble.name,
    points: noble.points,
    req: costList(noble.requirement),
  };
}

function playerView(game, p, index) {
  return {
    index,
    name: p.name,
    isAI: p.isAI,
    isCurrent: index === game.currentIndex && !game.isOver,
    points: points(p),
    tokenTotal: tokenCount(p),
    cardCount: p.cards.length,
    gold: p.tokens.gold,
    cols: COLORS.map((c) => ({ color: c, bonus: bonus(p, c), tokens: p.tokens[c] })),
    reservedCount: p.reserved.length,
    reservedTiers: p.reserved.map((c, i) => ({ key: i, tier: c.tier })),
    nobleCount: p.nobles.length,
    nobles: p.nobles.map(nobleView),
    initial: avatarChar(p.name),
    hue: index % 4, // 头像配色
  };
}

/** 买某张卡时每种颜色怎么付：加成抵扣 / 代币 / 黄金 / 仍缺。 */
function paymentPlan(player, card) {
  let gold = player.tokens.gold;
  const rows = COLORS.filter((c) => card.cost[c]).map((c) => {
    const cost = card.cost[c];
    const byBonus = Math.min(cost, bonus(player, c));
    const byTokens = Math.min(cost - byBonus, player.tokens[c]);
    const rest = cost - byBonus - byTokens;
    const byGold = Math.min(rest, gold);
    gold -= byGold;
    return { color: c, name: i18n.dict().color[c], cost, byBonus, byTokens, byGold, short: rest - byGold };
  });
  return { rows, short: rows.reduce((n, r) => n + r.short, 0) };
}

/**
 * @param {Game} game
 * @param {number} viewer 我方面板展示哪位玩家
 * @param {{picks?: Object<string, number>, locked?: boolean, hideReserved?: boolean}} [ui]
 *   页面上的临时选择 / 是否锁定操作 / 是否把“我”的预留卡显示为卡背（同屏多人且不确定谁拿着手机时）
 */
function buildView(game, viewer, ui) {
  const s = game.state;
  const picks = (ui && ui.picks) || {};
  const locked = !!(ui && ui.locked);
  const cur = game.current;
  // 只有轮到“我”且是人类玩家时，才可操作并标注买得起
  const activeHuman =
    !game.isOver && !locked && viewer === game.currentIndex && !cur.isAI ? cur : null;
  const me = s.players[viewer];

  const tiers = [3, 2, 1].map((tier) => ({
    tier,
    deckCount: s.decks[tier - 1].length,
    // key 用卡牌 id：新翻开的卡会重新挂载，从而播放发牌动画
    slots: s.board[tier - 1].map((c, i) => ({
      key: c ? c.id : `empty-${tier}-${i}`,
      card: cardView(c, activeHuman),
    })),
  }));

  const bank = ALL_TOKENS.map((c) => ({
    color: c,
    name: i18n.dict().color[c],
    count: s.tokens[c],
    picked: picks[c] || 0,
  }));

  const players = s.players.map((p, i) => playerView(game, p, i));
  const meView = Object.assign({}, players[viewer]);
  if (ui && ui.hideReserved) {
    // 不知道手机在谁手上：预留卡（可能含盲抽）只露卡背
    meView.reserved = [];
    meView.hiddenReserved = meView.reservedTiers;
  } else {
    meView.reserved = me.reserved.map((c) => cardView(c, activeHuman));
    meView.hiddenReserved = [];
  }
  meView.emptySlots = Array.from({ length: MAX_RESERVED - me.reserved.length }, (_, i) => i);
  meView.tokenPct = Math.min(100, (meView.tokenTotal / MAX_TOKENS) * 100);
  // 每列：上方永久加成（发展卡数），下方手中代币；黄金没有加成
  meView.slots = ALL_TOKENS.map((c) => ({
    color: c,
    name: i18n.dict().color[c],
    n: me.tokens[c],
    bonus: c === 'gold' ? -1 : bonus(me, c),
  }));

  const t = i18n.t;
  if (s.phase === 'discard' && activeHuman) meView.sub = t('fmt.meDiscard');
  else if (activeHuman) meView.sub = t('ui.yourTurn');
  else meView.sub = game.isOver ? t('fmt.meOver') : t('fmt.meWaiting');
  meView.holding = t('fmt.holding', meView.tokenTotal);

  const opponents = players
    .filter((p) => p.index !== viewer)
    .map((p) =>
      Object.assign({}, p, {
        sub: p.isCurrent ? (p.isAI ? t('fmt.thinking') : t('fmt.inTurn')) : t('fmt.oppSub', p.reservedCount, p.tokenTotal),
      })
    );

  return {
    phase: s.phase,
    round: s.round,
    lastRound: s.lastRound,
    discardNeeded: game.discardNeeded,
    currentIndex: game.currentIndex,
    currentName: cur.name,
    currentIsAI: cur.isAI,
    myTurn: !!activeHuman,
    canPass: !!activeHuman && s.phase === 'play' && !game.hasLegalMove(),
    requiredDistinct: game.requiredDistinct(),
    bank,
    tiers,
    nobles: s.nobles.map(nobleView),
    players,
    opponents,
    me: meView,
    lastLog: i18n.logText(s.log[s.log.length - 1]),
    roundLabel: t('fmt.round', s.round),
    waitingLabel: cur.isAI ? t('fmt.botThinking', cur.name) : t('fmt.waitingFor', cur.name),
    discardLabel: t('fmt.discardBar', game.discardNeeded),
  };
}

/** 根据当前选中的矿石判断能否确认拿取，返回 {ok, kind, colors, hint}。 */
function evaluatePicks(game, picks) {
  const L = i18n.dict();
  const colors = Object.keys(picks).filter((c) => picks[c] > 0);
  const total = colors.reduce((s, c) => s + picks[c], 0);
  if (!total) return { ok: false, hint: '' };
  if (colors.length === 1 && picks[colors[0]] === 2) {
    return { ok: true, kind: 'two', colors, hint: i18n.t('fmt.pickTwo', L.color[colors[0]]) };
  }
  const need = game.requiredDistinct();
  const names = colors.map((c) => L.color[c]).join(L.sep);
  if (colors.length === need) return { ok: true, kind: 'three', colors, hint: i18n.t('fmt.pickOk', names) };
  return { ok: false, colors, hint: i18n.t('fmt.pickNeed', names, need - colors.length) };
}

/**
 * 点击桌面代币时更新选择：
 * - 新颜色：加入（最多 3 种不同色）
 * - 再点已选的唯一一种颜色：若该色 ≥ 4 枚，变成“拿 2 枚同色”
 * - 其余情况再点：取消该色
 * 返回新的 picks，或 {error} 说明为何不能选。
 */
function togglePick(game, picks, color) {
  const next = Object.assign({}, picks);
  const chosen = Object.keys(next).filter((c) => next[c] > 0);
  if (color === 'gold') return { error: i18n.errText('gold') };
  if (game.state.tokens[color] <= 0) return { error: i18n.errText({ code: 'empty', params: { color } }) };

  if (next[color]) {
    if (chosen.length === 1 && next[color] === 1 && game.canTakeTwo(color)) {
      next[color] = 2;
    } else {
      delete next[color];
    }
    return { picks: next };
  }
  if (chosen.some((c) => next[c] === 2)) {
    return { error: i18n.errText('twoOnly') };
  }
  if (chosen.length >= 3) return { error: i18n.errText('maxThree') };
  next[color] = 1;
  return { picks: next };
}

module.exports = { avatarChar, buildView, cardView, evaluatePicks, paymentPlan, togglePick };
