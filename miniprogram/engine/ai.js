/**
 * 简单的贪心 AI（移植自 splendor/ai.py）：能买就买（优先高分/高价值），
 * 否则盯住一张目标卡补最急缺的宝石；回合末代币超限时弃掉最不需要的颜色。
 */

const { COLORS, GOLD, bonus, canAfford, qualifiesFor } = require('./game');

function boardCards(game) {
  const out = [];
  game.state.board.forEach((row) => row.forEach((c) => c && out.push(c)));
  return out;
}

/** 买下这张卡后能否立刻迎来贵族（用于同分时的偏好）。 */
function unlocksNoble(game, card) {
  const p = game.current;
  const after = Object.assign({}, p, { cards: p.cards.concat([card]) });
  return game.state.nobles.some((n) => !qualifiesFor(p, n) && qualifiesFor(after, n));
}

function deficits(game, card) {
  const p = game.current;
  const d = {};
  Object.keys(card.cost).forEach((col) => {
    d[col] = Math.max(0, card.cost[col] - bonus(p, col) - p.tokens[col]);
  });
  return d;
}

function pickTarget(game) {
  let best = null;
  let bestScore = Infinity;
  const cands = boardCards(game).concat(game.current.reserved);
  cands.forEach((c) => {
    const d = deficits(game, c);
    const need = Object.keys(d).reduce((s, k) => s + d[k], 0);
    const score = need - c.points * 0.5;
    if (score < bestScore) {
      best = c;
      bestScore = score;
    }
  });
  return best;
}

function neededColors(game, card) {
  const d = deficits(game, card);
  return Object.keys(d)
    .filter((c) => d[c] > 0)
    .sort((a, b) => d[b] - d[a]);
}

function chooseDiscard(game) {
  const p = game.current;
  const target = pickTarget(game);
  const keep = {};
  if (target) {
    Object.keys(target.cost).forEach((col) => {
      keep[col] = Math.max(0, target.cost[col] - bonus(p, col));
    });
  }
  const held = COLORS.filter((c) => p.tokens[c] > 0);
  if (!held.length) return GOLD;
  // 弃掉“超出目标所需”最多的颜色；黄金最后才弃
  return held.sort((a, b) => p.tokens[b] - (keep[b] || 0) - (p.tokens[a] - (keep[a] || 0)))[0];
}

/** 为当前玩家决策并执行一个完整回合（含弃牌），返回动作描述。 */
function step(game) {
  if (game.isOver) return '';
  if (game.state.phase === 'discard') {
    while (game.state.phase === 'discard') game.discard(chooseDiscard(game));
    return game.state.log[game.state.log.length - 1].text;
  }

  const p = game.current;
  const before = game.state.log.length;
  act(game, p);
  while (game.state.phase === 'discard') game.discard(chooseDiscard(game));
  return game.state.log
    .slice(before)
    .map((l) => l.text)
    .join('；');
}

function act(game, p) {
  // 1) 能买就买：优先声望点，其次能引来贵族，再其次成本更高（更稀缺）的卡
  const affordable = boardCards(game)
    .concat(p.reserved)
    .filter((c) => canAfford(p, c));
  if (affordable.length) {
    const key = (c) => [c.points, unlocksNoble(game, c) ? 1 : 0, sumCost(c)];
    affordable.sort((a, b) => cmp(key(b), key(a)));
    game.buy(affordable[0].id);
    return;
  }

  // 2) 盯住一张性价比高的目标卡，拿它最缺的颜色
  const need = game.requiredDistinct();
  if (need > 0) {
    const target = pickTarget(game);
    const wish = target ? neededColors(game, target).filter((c) => game.state.tokens[c] > 0) : [];
    if (target && wish.length === 1 && deficits(game, target)[wish[0]] >= 2 && game.canTakeTwo(wish[0])) {
      game.takeTwo(wish[0]);
      return;
    }
    const rest = COLORS.filter((c) => wish.indexOf(c) < 0 && game.state.tokens[c] > 0).sort(
      (a, b) => game.state.tokens[b] - game.state.tokens[a]
    );
    game.takeThree(wish.concat(rest).slice(0, need));
    return;
  }

  // 3) 桌上没宝石了：预留一张高价值卡吃黄金
  if (game.canReserve()) {
    for (let tier = 3; tier >= 1; tier--) {
      const card = game.state.board[tier - 1].find((c) => c);
      if (card) {
        game.reserve(card.id);
        return;
      }
    }
    for (let tier = 3; tier >= 1; tier--) {
      if (game.state.decks[tier - 1].length) {
        game.reserveFromDeck(tier);
        return;
      }
    }
  }
  game.pass();
}

function sumCost(card) {
  return Object.keys(card.cost).reduce((s, k) => s + card.cost[k], 0);
}

function cmp(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

module.exports = { step, pickTarget, chooseDiscard };
