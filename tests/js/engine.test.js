// 小程序 JS 引擎测试：node --test tests/js
const test = require('node:test');
const assert = require('node:assert/strict');

const { CARDS, NOBLES } = require('../../miniprogram/engine/data');
const {
  COLORS,
  Game,
  IllegalMove,
  bonus,
  points,
  tokenCount,
} = require('../../miniprogram/engine/game');
const ai = require('../../miniprogram/engine/ai');

const seats = (n, isAI = false) =>
  Array.from({ length: n }, (_, i) => ({ name: `P${i + 1}`, isAI }));

test('数据完整性：90 张卡、每色 18 张、10 位贵族', () => {
  assert.equal(CARDS.length, 90);
  const tiers = { 1: 0, 2: 0, 3: 0 };
  CARDS.forEach((c) => tiers[c.tier]++);
  assert.deepEqual(tiers, { 1: 40, 2: 30, 3: 20 });
  COLORS.forEach((color) => assert.equal(CARDS.filter((c) => c.bonus === color).length, 18));
  assert.equal(NOBLES.length, 10);
});

test('data.js 与 splendor/data/*.json 保持同步（否则运行 scripts/gen_miniprogram_data.py）', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const dir = path.join(__dirname, '../../splendor/data');
  assert.deepEqual(CARDS, JSON.parse(fs.readFileSync(path.join(dir, 'development_cards.json'), 'utf8')));
  assert.deepEqual(NOBLES, JSON.parse(fs.readFileSync(path.join(dir, 'nobles.json'), 'utf8')));
});

test('开局：代币数随人数、贵族数 = 人数 + 1、每层 4 张', () => {
  const g = Game.create(seats(2), 1);
  assert.equal(g.state.tokens.red, 4);
  assert.equal(g.state.tokens.gold, 5);
  assert.equal(g.state.nobles.length, 3);
  g.state.board.forEach((row) => assert.equal(row.length, 4));
  assert.equal(g.state.decks[0].length + 4, 40);
  assert.equal(Game.create(seats(3), 1).state.tokens.red, 5);
  assert.equal(Game.create(seats(4), 1).state.tokens.red, 7);
  assert.throws(() => Game.create(seats(1), 1));
  assert.throws(() => Game.create(seats(5), 1));
});

test('相同种子可复现', () => {
  const a = Game.create(seats(3), 99).state;
  const b = Game.create(seats(3), 99).state;
  assert.deepEqual(a.board, b.board);
  assert.deepEqual(a.nobles, b.nobles);
});

test('拿 3 枚不同色 / 2 枚同色，回合推进', () => {
  const g = Game.create(seats(2), 1);
  g.takeThree(['red', 'blue', 'green']);
  const p = g.state.players[0];
  assert.equal(p.tokens.red, 1);
  assert.equal(g.state.tokens.red, 3);
  assert.equal(g.currentIndex, 1);
  g.takeTwo('white');
  assert.equal(g.state.players[1].tokens.white, 2);
  assert.equal(g.state.tokens.white, 2);
  assert.equal(g.state.round, 2);
});

test('拿不同色：拒绝重复、拒绝黄金、必须拿满', () => {
  const g = Game.create(seats(2), 1);
  assert.throws(() => g.takeThree(['red', 'red', 'blue']), IllegalMove);
  assert.throws(() => g.takeThree(['red', 'gold', 'blue']), IllegalMove);
  assert.throws(() => g.takeThree(['red', 'blue']), IllegalMove);
  // 只剩两种颜色有货时，拿 2 种即可
  ['white', 'blue', 'green'].forEach((c) => (g.state.tokens[c] = 0));
  assert.equal(g.requiredDistinct(), 2);
  g.takeThree(['red', 'black']);
  assert.equal(g.currentIndex, 1);
});

test('拿 2 枚同色需该色 >= 4', () => {
  const g = Game.create(seats(2), 1);
  g.state.tokens.red = 3;
  assert.throws(() => g.takeTwo('red'), IllegalMove);
  assert.throws(() => g.takeTwo('gold'), IllegalMove);
});

test('购买：加成折抵 + 黄金补足', () => {
  const g = Game.create(seats(2), 1);
  const p = g.state.players[0];
  const card = g.state.board[0][0];
  const colors = Object.keys(card.cost);
  colors.forEach((c) => (p.tokens[c] = card.cost[c]));
  // 第一种颜色少 1 枚，用黄金补
  p.tokens[colors[0]] -= 1;
  p.tokens.gold = 1;
  g.buy(card.id);
  assert.ok(p.cards.some((c) => c.id === card.id));
  assert.equal(bonus(p, card.bonus), 1);
  assert.equal(p.tokens.gold, 0);
  assert.equal(g.state.tokens.gold, 6);
  assert.equal(tokenCount(p), 0);
  assert.equal(g.state.board[0].length, 4); // 已补位
  assert.ok(g.state.board[0][0]);
});

test('买不起时报错', () => {
  const g = Game.create(seats(2), 1);
  const card = g.state.board[2][0];
  assert.throws(() => g.buy(card.id), IllegalMove);
});

test('预留：拿黄金、上限 3 张、可盲抽、之后可买预留卡', () => {
  const g = Game.create(seats(2), 1);
  const p = g.state.players[0];
  const cid = g.state.board[1][0].id;
  g.reserve(cid);
  assert.equal(p.reserved.length, 1);
  assert.equal(p.tokens.gold, 1);
  assert.equal(g.state.tokens.gold, 4);
  // 规则：场上被预留的卡立即从同层牌堆补位
  assert.ok(g.state.board[1][0] && g.state.board[1][0].id !== cid);
  assert.equal(g.state.decks[1].length, 30 - 4 - 1);

  g.takeTwo('red'); // P2
  const deckBefore = g.state.decks[2].length;
  g.reserveFromDeck(3);
  assert.equal(g.state.decks[2].length, deckBefore - 1);
  g.takeTwo('blue'); // P2
  g.reserve(g.state.board[0][1].id);
  g.takeTwo('green'); // P2
  assert.equal(p.reserved.length, 3);
  assert.throws(() => g.reserve(g.state.board[0][2].id), IllegalMove);
  assert.throws(() => g.reserveFromDeck(1), IllegalMove);

  const target = p.reserved[0];
  Object.keys(target.cost).forEach((c) => (p.tokens[c] = target.cost[c]));
  g.buy(target.id);
  assert.equal(p.reserved.length, 2);
  assert.ok(p.cards.some((c) => c.id === target.id));
});

test('代币超过 10 枚须弃回后才结束回合', () => {
  const g = Game.create(seats(2), 1);
  const p = g.state.players[0];
  p.tokens.white = 5;
  p.tokens.black = 4; // 9 枚
  g.takeThree(['red', 'blue', 'green']); // 12 枚
  assert.equal(g.state.phase, 'discard');
  assert.equal(g.discardNeeded, 2);
  assert.equal(g.currentIndex, 0);
  assert.throws(() => g.takeTwo('red'), IllegalMove);
  assert.throws(() => g.discard('gold'), IllegalMove);
  g.discard('white');
  assert.equal(g.currentIndex, 0);
  g.discard('white');
  assert.equal(g.state.phase, 'play');
  assert.equal(g.currentIndex, 1);
  assert.equal(tokenCount(p), 10);
});

test('满足要求自动迎接贵族（每回合至多一位）', () => {
  const g = Game.create(seats(2), 3);
  const p = g.state.players[0];
  const noble = g.state.nobles[0];
  let i = 0;
  Object.keys(noble.requirement).forEach((color) => {
    for (let k = 0; k < noble.requirement[color]; k++) {
      p.cards.push({ id: `x${i++}`, tier: 1, bonus: color, points: 0, cost: {} });
    }
  });
  g.takeThree(['red', 'blue', 'green']);
  assert.ok(p.nobles.some((n) => n.id === noble.id));
  assert.ok(!g.state.nobles.some((n) => n.id === noble.id));
  assert.equal(points(p), 3);
});

test('达到 15 分后打完本轮；平分时发展卡少者胜', () => {
  const g = Game.create(seats(3), 5);
  const [a, b] = g.state.players;
  a.cards.push({ id: 'ya', tier: 3, bonus: 'red', points: 15, cost: {} });
  g.takeThree(['red', 'blue', 'green']); // P1 达标
  assert.ok(g.state.lastRound);
  assert.equal(g.state.phase, 'play');
  b.cards.push(
    { id: 'yb1', tier: 3, bonus: 'red', points: 10, cost: {} },
    { id: 'yb2', tier: 3, bonus: 'red', points: 5, cost: {} }
  );
  g.takeThree(['red', 'blue', 'green']); // P2 同分但卡更多
  assert.equal(g.state.phase, 'play');
  g.takeThree(['white', 'blue', 'green']); // P3，本轮结束
  assert.equal(g.state.phase, 'over');
  assert.equal(g.state.winner, 0);
  assert.throws(() => g.takeTwo('red'), IllegalMove);
  assert.deepEqual(
    g.ranking().map((r) => r.name),
    ['P1', 'P2', 'P3']
  );
});

test('无合法动作时才能跳过', () => {
  const g = Game.create(seats(2), 1);
  assert.throws(() => g.pass(), IllegalMove);
  COLORS.forEach((c) => (g.state.tokens[c] = 0));
  g.state.players[0].reserved = [CARDS[80], CARDS[81], CARDS[82]];
  assert.ok(!g.hasLegalMove());
  g.pass();
  assert.equal(g.currentIndex, 1);
});

test('存档恢复：JSON 往返后可继续对局', () => {
  const g = Game.create(seats(2), 7);
  g.takeThree(['red', 'blue', 'green']);
  const restored = new Game(JSON.parse(JSON.stringify(g.state)));
  const cid = restored.state.board[0][0].id;
  restored.reserve(cid);
  assert.equal(restored.state.players[1].reserved[0].id, cid);
  assert.notEqual(restored.state.board[0][0].id, cid); // 已补位
});

test('AI 自对弈：2–4 人、多个种子均能正常结束且守恒', () => {
  for (const n of [2, 3, 4]) {
    for (let seed = 0; seed < 40; seed++) {
      const g = Game.create(seats(n, true), seed);
      const totalTokens = () => {
        let s = 0;
        Object.values(g.state.tokens).forEach((v) => (s += v));
        g.state.players.forEach((p) => (s += tokenCount(p)));
        return s;
      };
      const start = totalTokens();
      let steps = 0;
      while (!g.isOver && steps < 1000) {
        ai.step(g);
        steps++;
        assert.equal(totalTokens(), start);
        g.state.players.forEach((p) => assert.ok(tokenCount(p) <= 10));
      }
      assert.ok(g.isOver, `n=${n} seed=${seed} 未在 1000 步内结束`);
      const w = g.state.players[g.state.winner];
      assert.ok(points(w) >= 15);
    }
  }
});

test('页面引用的美术资源都存在（否则运行 scripts/gen_miniprogram_art.py）', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { ALL_TOKENS } = require('../../miniprogram/engine/game');
  const mp = path.join(__dirname, '../../miniprogram');
  // {{x.color}} 等占位符的所有可能取值；首页的矿石列表 {{item}} 即五种颜色
  const values = {
    color: ALL_TOKENS,
    bonus: COLORS,
    tier: ['1', '2', '3'],
    id: NOBLES.map((n) => n.id),
    item: COLORS,
  };
  const expand = (ref) => {
    const m = ref.match(/\{\{(?:\w+\.)*(\w+)\}\}/);
    if (!m) return [ref];
    assert.ok(values[m[1]], `无法展开的资源路径 ${ref}`);
    return values[m[1]].flatMap((v) => expand(ref.replace(m[0], v)));
  };
  const walk = (d) =>
    fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.wxml') ? [path.join(d, e.name)] : []
    );
  let checked = 0;
  for (const file of walk(mp)) {
    const src = fs.readFileSync(file, 'utf8');
    for (const [, ref] of src.matchAll(/src="(\/assets\/[^"]+)"/g)) {
      for (const p of expand(ref)) {
        assert.ok(fs.existsSync(path.join(mp, p)), `缺少资源 ${p}（${file}）`);
        checked++;
      }
    }
  }
  assert.ok(checked > 40);
});
