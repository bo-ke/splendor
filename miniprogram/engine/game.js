/**
 * 璀璨宝石规则引擎（JS 版，移植自 splendor/game.py + player.py）。
 *
 * 与 Python 版的区别：
 * - 状态是纯 JSON 对象（state），可直接 setData / 存进本地缓存，并用 new Game(state) 恢复。
 * - 不用异常表示游戏结束：state.phase === 'over' 且 state.winner 为胜者下标。
 * - 回合末代币 > 10 时进入 'discard' 阶段，弃到 10 枚后回合才结束。
 * - 拿不同色代币时须拿满 min(3, 桌上有货的颜色数) 枚（官方规则）。
 */

const { CARDS, NOBLES } = require('./data');

const COLORS = ['white', 'blue', 'green', 'red', 'black'];
const GOLD = 'gold';
const ALL_TOKENS = COLORS.concat([GOLD]);
const TOKENS_BY_PLAYERS = { 2: 4, 3: 5, 4: 7 };
const WINNING_SCORE = 15;
const MAX_TOKENS = 10;
const MAX_RESERVED = 3;
const LOG_LIMIT = 60;

const COLOR_NAMES = {
  white: '白',
  blue: '蓝',
  green: '绿',
  red: '红',
  black: '黑',
  gold: '金',
};

class IllegalMove extends Error {
  constructor(message) {
    super(message);
    this.name = 'IllegalMove';
  }
}

// ---------------------------------------------------------------- 随机数
// mulberry32：可复现、状态只是一个 32 位整数，便于存档。
function nextRandom(state) {
  let t = (state.rng = (state.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function shuffle(state, arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(nextRandom(state) * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

// ------------------------------------------------------------ 玩家衍生值
function emptyTokens() {
  const t = {};
  ALL_TOKENS.forEach((c) => (t[c] = 0));
  return t;
}

function bonus(player, color) {
  let n = 0;
  player.cards.forEach((c) => {
    if (c.bonus === color) n++;
  });
  return n;
}

function bonuses(player) {
  const b = {};
  COLORS.forEach((c) => (b[c] = bonus(player, c)));
  return b;
}

function points(player) {
  let s = 0;
  player.cards.forEach((c) => (s += c.points));
  player.nobles.forEach((n) => (s += n.points));
  return s;
}

function tokenCount(player) {
  let s = 0;
  ALL_TOKENS.forEach((c) => (s += player.tokens[c]));
  return s;
}

/** 买这张卡需要动用多少黄金（0 表示普通代币足够）。 */
function goldNeeded(player, card) {
  let shortfall = 0;
  Object.keys(card.cost).forEach((color) => {
    const pay = Math.max(0, card.cost[color] - bonus(player, color));
    shortfall += Math.max(0, pay - player.tokens[color]);
  });
  return shortfall;
}

function canAfford(player, card) {
  return goldNeeded(player, card) <= player.tokens[GOLD];
}

function qualifiesFor(player, noble) {
  return Object.keys(noble.requirement).every(
    (c) => bonus(player, c) >= noble.requirement[c]
  );
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

// ------------------------------------------------------------------ 游戏
class Game {
  /** 用已有 state（如本地存档）恢复一局。 */
  constructor(state) {
    this.state = state;
  }

  /**
   * 新开一局。
   * @param {Array<{name: string, isAI?: boolean}>} seats 2–4 个座位
   * @param {number} [seed] 随机种子；省略则随机
   */
  static create(seats, seed) {
    const n = seats.length;
    if (n < 2 || n > 4) throw new Error('璀璨宝石支持 2–4 人');
    if (seed === undefined || seed === null) seed = Math.floor(Math.random() * 2147483647);

    const state = {
      version: 1,
      seed,
      rng: seed | 0,
      players: seats.map((s) => ({
        name: s.name,
        isAI: !!s.isAI,
        tokens: emptyTokens(),
        cards: [],
        reserved: [],
        nobles: [],
      })),
      tokens: {},
      decks: [[], [], []], // 下标 = tier - 1，数组末尾为牌堆顶
      board: [[], [], []],
      nobles: [],
      turn: 0,
      round: 1,
      phase: 'play', // play | discard | over
      lastRound: false,
      winner: null,
      log: [],
    };

    COLORS.forEach((c) => (state.tokens[c] = TOKENS_BY_PLAYERS[n]));
    state.tokens[GOLD] = 5;

    [1, 2, 3].forEach((tier) => {
      const deck = shuffle(state, clone(CARDS.filter((c) => c.tier === tier)));
      state.board[tier - 1] = deck.splice(deck.length - 4, 4).reverse();
      state.decks[tier - 1] = deck;
    });

    state.nobles = shuffle(state, clone(NOBLES)).slice(0, n + 1);
    const game = new Game(state);
    game._log(`开局：${n} 名玩家，先到 ${WINNING_SCORE} 分者触发最后一轮。`);
    return game;
  }

  // -------------------------------------------------------------- 查询
  get current() {
    return this.state.players[this.currentIndex];
  }

  get currentIndex() {
    return this.state.turn % this.state.players.length;
  }

  get isOver() {
    return this.state.phase === 'over';
  }

  /** 场上（翻开的）卡。 */
  boardCard(cardId) {
    for (let t = 0; t < 3; t++) {
      const card = this.state.board[t].find((c) => c && c.id === cardId);
      if (card) return card;
    }
    return null;
  }

  /** 当前玩家需要弃掉几枚代币（非弃牌阶段为 0）。 */
  get discardNeeded() {
    if (this.state.phase !== 'discard') return 0;
    return Math.max(0, tokenCount(this.current) - MAX_TOKENS);
  }

  /** 拿不同色代币时必须拿的枚数。 */
  requiredDistinct() {
    return Math.min(3, COLORS.filter((c) => this.state.tokens[c] > 0).length);
  }

  canTakeTwo(color) {
    return COLORS.indexOf(color) >= 0 && this.state.tokens[color] >= 4;
  }

  canReserve() {
    return this.current.reserved.length < MAX_RESERVED;
  }

  /** 当前玩家是否还有任何合法动作（全无时才允许跳过）。 */
  hasLegalMove() {
    const p = this.current;
    if (COLORS.some((c) => this.state.tokens[c] > 0)) return true;
    if (p.reserved.length < MAX_RESERVED) {
      for (let t = 0; t < 3; t++) {
        if (this.state.decks[t].length) return true;
        if (this.state.board[t].some((c) => c)) return true;
      }
    }
    for (let t = 0; t < 3; t++) {
      if (this.state.board[t].some((c) => c && canAfford(p, c))) return true;
    }
    return p.reserved.some((c) => canAfford(p, c));
  }

  /** 名次：分高者在前，平分时发展卡少者在前。 */
  ranking() {
    return this.state.players
      .map((p, i) => ({ index: i, name: p.name, points: points(p), cards: p.cards.length }))
      .sort((a, b) => b.points - a.points || a.cards - b.cards || a.index - b.index);
  }

  // -------------------------------------------------------------- 动作
  takeThree(colors) {
    this._requirePhase('play');
    const s = this.state;
    if (!Array.isArray(colors) || new Set(colors).size !== colors.length) {
      throw new IllegalMove('拿取的代币颜色必须各不相同');
    }
    colors.forEach((c) => {
      if (COLORS.indexOf(c) < 0) throw new IllegalMove(`不能直接拿 ${COLOR_NAMES[c] || c} 色代币`);
      if (s.tokens[c] <= 0) throw new IllegalMove(`${COLOR_NAMES[c]}色代币已经拿完了`);
    });
    const need = this.requiredDistinct();
    if (need === 0) throw new IllegalMove('桌上已没有可拿的宝石代币');
    if (colors.length !== need) throw new IllegalMove(`请选择 ${need} 种不同颜色的代币`);

    const p = this.current;
    colors.forEach((c) => {
      s.tokens[c] -= 1;
      p.tokens[c] += 1;
    });
    this._log(`${p.name} 拿了 ${colors.map((c) => COLOR_NAMES[c]).join('、')}`);
    this._afterAction();
  }

  takeTwo(color) {
    this._requirePhase('play');
    if (COLORS.indexOf(color) < 0) throw new IllegalMove('只能拿宝石代币，黄金需通过预留获得');
    if (!this.canTakeTwo(color)) throw new IllegalMove('该色剩余 ≥ 4 枚时才能拿 2 枚同色');
    const p = this.current;
    this.state.tokens[color] -= 2;
    p.tokens[color] += 2;
    this._log(`${p.name} 拿了 2 枚${COLOR_NAMES[color]}`);
    this._afterAction();
  }

  /** 预留场上的卡。 */
  reserve(cardId) {
    this._requirePhase('play');
    if (!this.canReserve()) throw new IllegalMove(`最多预留 ${MAX_RESERVED} 张`);
    const card = this.boardCard(cardId);
    if (!card) throw new IllegalMove('场上没有这张卡');
    this._removeFromBoard(card);
    this._doReserve(card, `预留了第 ${card.tier} 层的一张卡`);
  }

  /** 从牌堆顶盲抽预留。 */
  reserveFromDeck(tier) {
    this._requirePhase('play');
    if (!this.canReserve()) throw new IllegalMove(`最多预留 ${MAX_RESERVED} 张`);
    const deck = this.state.decks[tier - 1];
    if (!deck || !deck.length) throw new IllegalMove(`第 ${tier} 层牌堆已空`);
    this._doReserve(deck.pop(), `从第 ${tier} 层牌堆盲抽预留了一张卡`);
  }

  buy(cardId) {
    this._requirePhase('play');
    const p = this.current;
    let card = this.boardCard(cardId);
    let fromReserve = false;
    if (!card) {
      card = p.reserved.find((c) => c.id === cardId) || null;
      fromReserve = !!card;
    }
    if (!card) throw new IllegalMove('场上和你的预留区都没有这张卡');
    if (!canAfford(p, card)) throw new IllegalMove('宝石不足，买不起');

    // 结算：先用永久加成折抵，再用普通代币，不足部分用黄金
    let goldUsed = 0;
    Object.keys(card.cost).forEach((color) => {
      const pay = Math.max(0, card.cost[color] - bonus(p, color));
      const use = Math.min(pay, p.tokens[color]);
      p.tokens[color] -= use;
      this.state.tokens[color] += use;
      const gold = pay - use;
      if (gold) {
        p.tokens[GOLD] -= gold;
        this.state.tokens[GOLD] += gold;
        goldUsed += gold;
      }
    });

    if (fromReserve) {
      p.reserved.splice(p.reserved.indexOf(card), 1);
    } else {
      this._removeFromBoard(card, true);
    }
    p.cards.push(card);

    const pts = card.points ? `，+${card.points} 分` : '';
    const gold = goldUsed ? `（用了 ${goldUsed} 金）` : '';
    this._log(
      `${p.name} ${fromReserve ? '买下预留的' : '购买了'}${COLOR_NAMES[card.bonus]}卡${pts}${gold}`
    );
    this._afterAction();
  }

  /** 回合末代币超过 10 枚时，逐枚弃回。 */
  discard(color) {
    this._requirePhase('discard');
    const p = this.current;
    if (!(p.tokens[color] > 0)) throw new IllegalMove('你没有这种代币');
    p.tokens[color] -= 1;
    this.state.tokens[color] += 1;
    if (tokenCount(p) <= MAX_TOKENS) {
      this._log(`${p.name} 弃回代币至 ${MAX_TOKENS} 枚`);
      this._endTurn();
    }
  }

  /** 仅在完全没有合法动作时允许跳过。 */
  pass() {
    this._requirePhase('play');
    if (this.hasLegalMove()) throw new IllegalMove('还有可执行的动作，不能跳过');
    this._log(`${this.current.name} 无动作可做，跳过`);
    this._endTurn();
  }

  // ------------------------------------------------------------ 内部
  _requirePhase(phase) {
    if (this.state.phase === 'over') throw new IllegalMove('游戏已结束');
    if (this.state.phase !== phase) {
      throw new IllegalMove(phase === 'play' ? '请先弃回多余的代币' : '现在不需要弃代币');
    }
  }

  _doReserve(card, text) {
    const p = this.current;
    p.reserved.push(card);
    let got = '';
    if (this.state.tokens[GOLD] > 0) {
      this.state.tokens[GOLD] -= 1;
      p.tokens[GOLD] += 1;
      got = '，获得 1 金';
    }
    this._log(`${p.name} ${text}${got}`);
    this._afterAction();
  }

  _removeFromBoard(card, refill) {
    const row = this.state.board[card.tier - 1];
    const idx = row.indexOf(card);
    const deck = this.state.decks[card.tier - 1];
    row[idx] = refill && deck.length ? deck.pop() : null;
  }

  _afterAction() {
    if (tokenCount(this.current) > MAX_TOKENS) {
      this.state.phase = 'discard';
    } else {
      this._endTurn();
    }
  }

  _checkNobles(p) {
    // 同时满足多位时自动迎接第一位（每回合至多一位）
    const noble = this.state.nobles.find((n) => qualifiesFor(p, n));
    if (noble) {
      this.state.nobles.splice(this.state.nobles.indexOf(noble), 1);
      p.nobles.push(noble);
      this._log(`贵族「${noble.name}」拜访了 ${p.name}，+${noble.points} 分`);
    }
  }

  _endTurn() {
    const s = this.state;
    const p = this.current;
    s.phase = 'play';
    this._checkNobles(p);
    if (!s.lastRound && points(p) >= WINNING_SCORE) {
      s.lastRound = true;
      this._log(`${p.name} 达到 ${points(p)} 分！本轮结束后游戏终止`);
    }
    const isLastSeat = this.currentIndex === s.players.length - 1;
    s.turn += 1;
    if (isLastSeat) s.round += 1;
    if (s.lastRound && isLastSeat) this._finish();
  }

  _finish() {
    const rank = this.ranking();
    this.state.phase = 'over';
    this.state.winner = rank[0].index;
    this._log(`游戏结束，${rank[0].name} 以 ${rank[0].points} 分获胜！`);
  }

  _log(text) {
    const log = this.state.log;
    log.push({ round: this.state.round, text });
    if (log.length > LOG_LIMIT) log.splice(0, log.length - LOG_LIMIT);
  }
}

module.exports = {
  ALL_TOKENS,
  COLORS,
  COLOR_NAMES,
  GOLD,
  MAX_RESERVED,
  MAX_TOKENS,
  WINNING_SCORE,
  Game,
  IllegalMove,
  bonus,
  bonuses,
  canAfford,
  goldNeeded,
  points,
  qualifiesFor,
  tokenCount,
};
