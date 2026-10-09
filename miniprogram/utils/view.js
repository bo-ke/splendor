/**
 * 把引擎状态转换成 WXML 好渲染的视图模型（纯函数，不依赖 wx）。
 */

const {
  ALL_TOKENS,
  COLORS,
  COLOR_NAMES,
  MAX_RESERVED,
  MAX_TOKENS,
  bonus,
  canAfford,
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
  };
  if (player) {
    v.affordable = canAfford(player, card);
    v.goldNeeded = goldNeeded(player, card);
  }
  return v;
}

function nobleView(noble) {
  return {
    id: noble.id,
    name: noble.name,
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
    return { color: c, name: COLOR_NAMES[c], cost, byBonus, byTokens, byGold, short: rest - byGold };
  });
  return { rows, short: rows.reduce((n, r) => n + r.short, 0) };
}

/**
 * @param {Game} game
 * @param {number} viewer 我方面板展示哪位玩家
 * @param {{picks?: Object<string, number>, locked?: boolean}} [ui] 页面上的临时选择 / 是否锁定操作
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
    name: COLOR_NAMES[c],
    count: s.tokens[c],
    picked: picks[c] || 0,
  }));

  const meView = playerView(game, me, viewer);
  meView.reserved = me.reserved.map((c) => cardView(c, activeHuman));
  meView.emptySlots = Array.from({ length: MAX_RESERVED - me.reserved.length }, (_, i) => i);
  meView.tokenPct = Math.min(100, (meView.tokenTotal / MAX_TOKENS) * 100);
  // 每列：上方永久加成（发展卡数），下方手中代币；黄金没有加成
  meView.slots = ALL_TOKENS.map((c) => ({
    color: c,
    name: COLOR_NAMES[c],
    n: me.tokens[c],
    bonus: c === 'gold' ? -1 : bonus(me, c),
  }));

  const last = s.log.length ? s.log[s.log.length - 1].text : '';

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
    players: s.players.map((p, i) => playerView(game, p, i)),
    opponents: s.players.map((p, i) => playerView(game, p, i)).filter((p) => p.index !== viewer),
    me: meView,
    lastLog: last,
  };
}

/** 根据当前选中的代币判断能否确认拿取，返回 {ok, kind, colors, hint}。 */
function evaluatePicks(game, picks) {
  const colors = Object.keys(picks).filter((c) => picks[c] > 0);
  const total = colors.reduce((s, c) => s + picks[c], 0);
  if (!total) return { ok: false, hint: '' };
  if (colors.length === 1 && picks[colors[0]] === 2) {
    return { ok: true, kind: 'two', colors, hint: `拿 2 枚${COLOR_NAMES[colors[0]]}` };
  }
  const need = game.requiredDistinct();
  const names = colors.map((c) => COLOR_NAMES[c]).join(' ');
  if (colors.length === need) return { ok: true, kind: 'three', colors, hint: `拿 ${names}` };
  return { ok: false, colors, hint: `已选 ${names}，还需 ${need - colors.length} 种` };
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
  if (color === 'gold') return { error: '黄金只能通过预留卡牌获得' };
  if (game.state.tokens[color] <= 0) return { error: `${COLOR_NAMES[color]}色代币已经拿完了` };

  if (next[color]) {
    if (chosen.length === 1 && next[color] === 1 && game.canTakeTwo(color)) {
      next[color] = 2;
    } else {
      delete next[color];
    }
    return { picks: next };
  }
  if (chosen.some((c) => next[c] === 2)) {
    return { error: '拿 2 枚同色时不能再拿其他颜色' };
  }
  if (chosen.length >= 3) return { error: '最多拿 3 种不同颜色' };
  next[color] = 1;
  return { picks: next };
}

module.exports = { avatarChar, buildView, cardView, evaluatePicks, paymentPlan, togglePick };
