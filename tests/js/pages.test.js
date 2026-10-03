// 小程序页面逻辑测试：用最小的 Page / wx / 定时器桩，驱动真实的页面事件处理函数。
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.join(__dirname, '../../miniprogram');

// ------------------------------------------------------------------ 桩
function setPath(obj, key, value) {
  const parts = key.replace(/\[(\d+)\]/g, '.$1').split('.');
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (o[parts[i]] === undefined) o[parts[i]] = /^\d+$/.test(parts[i + 1]) ? [] : {};
    o = o[parts[i]];
  }
  o[parts[parts.length - 1]] = value;
}

function makeEnv() {
  const env = { storage: {}, toasts: [], nav: [], timers: [], globalData: {}, pages: [] };
  global.wx = {
    getStorageSync: (k) => (k in env.storage ? JSON.parse(env.storage[k]) : ''),
    setStorageSync: (k, v) => (env.storage[k] = JSON.stringify(v)),
    removeStorageSync: (k) => delete env.storage[k],
    showToast: (o) => env.toasts.push(o.title),
    showModal: (o) => o.success && o.success({ confirm: true }),
    navigateTo: (o) => env.nav.push(o.url),
    navigateBack: () => env.nav.push('back'),
    reLaunch: (o) => env.nav.push(o.url),
  };
  global.getApp = () => ({ globalData: env.globalData });
  global.getCurrentPages = () => env.pages;
  global.Page = (opts) => (env.lastPage = opts);
  env.realSetTimeout = global.setTimeout;
  env.realClearTimeout = global.clearTimeout;
  let seq = 0;
  global.setTimeout = (fn) => {
    const id = ++seq;
    env.timers.push({ id, fn });
    return id;
  };
  global.clearTimeout = (id) => (env.timers = env.timers.filter((t) => t.id !== id));
  env.flush = () => {
    const t = env.timers.shift();
    if (t) t.fn();
    return !!t;
  };
  env.restore = () => {
    global.setTimeout = env.realSetTimeout;
    global.clearTimeout = env.realClearTimeout;
  };
  return env;
}

function loadPage(env, rel) {
  const file = path.join(ROOT, rel);
  delete require.cache[require.resolve(file)];
  require(file);
  const opts = env.lastPage;
  const page = Object.create(opts);
  page.data = JSON.parse(JSON.stringify(opts.data));
  page.setData = function (patch) {
    Object.keys(patch).forEach((k) => setPath(this.data, k, patch[k]));
  };
  env.pages.push(page);
  return page;
}

const ev = (dataset, detail) => ({ currentTarget: { dataset }, detail: detail || {} });

/** 用页面交互模拟一个“会玩”的真人走一步。 */
function humanMove(page) {
  const v = page.data.view;
  if (v.phase === 'discard') {
    const slot = v.me.slots.find((s) => s.n > 0 && s.color !== 'gold') || v.me.slots.find((s) => s.n > 0);
    page.onTapMyToken(ev({ color: slot.color }));
    return 'discard';
  }
  const board = [];
  v.tiers.forEach((r) => r.cards.forEach((c) => c && board.push({ c, source: 'board' })));
  v.me.reserved.forEach((c) => board.push({ c, source: 'reserved' }));
  const buyable = board.filter((x) => x.c.affordable).sort((a, b) => b.c.points - a.c.points)[0];
  if (buyable) {
    page.onTapCard(ev({ id: buyable.c.id, source: buyable.source }));
    assert.ok(page.data.sheet && page.data.sheet.canBuy, '可买的卡应能在面板中购买');
    page.onSheetBuy();
    return 'buy';
  }
  if (v.requiredDistinct > 0) {
    const colors = v.bank
      .filter((b) => b.color !== 'gold' && b.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, v.requiredDistinct);
    colors.forEach((b) => page.onTapBank(ev({ color: b.color })));
    assert.ok(page.data.pickEval.ok, `选择应有效：${page.data.pickEval.hint}`);
    page.onConfirmTake();
    return 'take';
  }
  if (v.me.reserved.length < 3) {
    const tier = v.tiers.find((r) => r.deckCount > 0);
    if (tier) {
      page.onTapDeck(ev({ tier: tier.tier }));
      page.onSheetReserve();
      return 'reserve';
    }
  }
  page.onPass();
  return 'pass';
}

function playOut(env, page, maxSteps = 4000) {
  for (let i = 0; i < maxSteps; i++) {
    if (page.data.result) return true;
    if (page.data.handoff) {
      page.onHandoffReady();
      continue;
    }
    if (page.data.view.myTurn) humanMove(page);
    else assert.ok(env.flush(), '非真人回合时应有待执行的定时器');
  }
  return false;
}

// ---------------------------------------------------------------- 测试
test('首页：配置座位并开始新局', () => {
  const env = makeEnv();
  try {
    const page = loadPage(env, 'pages/index/index.js');
    page.onLoad();
    page.onShow();
    assert.equal(page.data.hasSave, false);
    page.onCount(ev({ n: 2 }));
    page.onName(ev({ i: 0 }, { value: '小明' }));
    page.onToggleAI(ev({ i: 1 })); // 电脑 -> 真人
    assert.equal(page.data.seats[1].isAI, false);
    assert.equal(page.data.seats[1].name, '玩家2');
    page.onStart();
    assert.deepEqual(env.globalData.pendingSeats, [
      { name: '小明', isAI: false },
      { name: '玩家2', isAI: false },
    ]);
    assert.deepEqual(env.nav, ['/pages/game/game']);

    // 重名会被拦下
    page.onName(ev({ i: 1 }, { value: '小明' }));
    page.onStart();
    assert.equal(env.toasts.pop(), '玩家名不能重复');
  } finally {
    env.restore();
  }
});

test('对局页：1 真人 vs 2 电脑，用页面交互打完整局', () => {
  const env = makeEnv();
  try {
    env.globalData.pendingSeats = [
      { name: '我', isAI: false },
      { name: '电脑·甲', isAI: true },
      { name: '电脑·乙', isAI: true },
    ];
    const page = loadPage(env, 'pages/game/game.js');
    page.onLoad({});
    page.onShow();
    assert.equal(page.data.handoff, null, '单真人局不需要交接遮罩');
    assert.ok(page.data.view.myTurn);
    assert.equal(page.data.view.me.name, '我');

    // 非法选择会提示而不是崩溃
    page.onTapBank(ev({ color: 'gold' }));
    assert.equal(env.toasts.pop(), '黄金只能通过预留卡牌获得');
    page.onTapBank(ev({ color: 'red' }));
    page.onTapBank(ev({ color: 'red' })); // 再点 -> 拿 2 枚同色
    assert.deepEqual(page.data.picks, { red: 2 });
    assert.ok(page.data.pickEval.ok);
    page.onTapBank(ev({ color: 'blue' }));
    assert.equal(env.toasts.pop(), '拿 2 枚同色时不能再拿其他颜色');
    page.onClearPicks();
    assert.deepEqual(page.data.picks, {});

    // 存档在走第一步后写入
    humanMove(page);
    assert.ok(env.storage['splendor.save.v1'], '走子后应自动存档');
    assert.equal(page.data.view.myTurn, false);

    assert.ok(playOut(env, page), '整局应在步数上限内结束');
    const r = page.data.result;
    assert.equal(r.rank.length, 3);
    assert.ok(r.rank[0].points >= 15);
    assert.ok(!env.storage['splendor.save.v1'], '结束后应清除存档');

    // 再来一局
    page.onRematch();
    assert.equal(page.data.result, null);
    assert.equal(page.data.view.round, 1);
  } finally {
    env.restore();
  }
});

test('对局页：同屏 2 真人 + 1 电脑，轮到真人时出现交接遮罩', () => {
  const env = makeEnv();
  try {
    env.globalData.pendingSeats = [
      { name: 'A', isAI: false },
      { name: 'B', isAI: false },
      { name: 'C', isAI: true },
    ];
    const page = loadPage(env, 'pages/game/game.js');
    page.onLoad({});
    assert.deepEqual(page.data.handoff, { name: 'A' });
    assert.equal(page.data.view.myTurn, false, '确认前不能操作');
    page.onHandoffReady();
    assert.equal(page.data.view.myTurn, true);
    humanMove(page);
    assert.deepEqual(page.data.handoff, { name: 'B' });
    assert.equal(page.data.view.me.name, 'A', '交接前仍显示上一位的面板');
    page.onHandoffReady();
    assert.equal(page.data.view.me.name, 'B');
    assert.ok(playOut(env, page));
  } finally {
    env.restore();
  }
});

test('对局页：代币超限进入弃牌阶段；可从存档继续', () => {
  const env = makeEnv();
  try {
    env.globalData.pendingSeats = [
      { name: '我', isAI: false },
      { name: '电脑', isAI: true },
    ];
    const page = loadPage(env, 'pages/game/game.js');
    page.onLoad({});
    const me = page.game.state.players[0];
    me.tokens.white = 5;
    me.tokens.black = 4;
    page.render();
    ['red', 'blue', 'green'].forEach((c) => page.onTapBank(ev({ color: c })));
    page.onConfirmTake();
    assert.equal(page.data.view.phase, 'discard');
    assert.equal(page.data.view.discardNeeded, 2);
    page.onTapBank(ev({ color: 'red' }));
    assert.equal(env.toasts.pop(), '请先点击你自己的代币弃回');
    page.onTapMyToken(ev({ color: 'white' }));
    page.onTapMyToken(ev({ color: 'white' }));
    assert.equal(page.data.view.phase, 'play');
    assert.equal(page.data.view.myTurn, false);

    // 电脑走完后存档，新页面从存档恢复
    env.flush();
    const turn = page.game.state.turn;
    page.onUnload();
    const resumed = loadPage(env, 'pages/game/game.js');
    resumed.onLoad({ resume: '1' });
    assert.equal(resumed.game.state.turn, turn);
    assert.equal(resumed.data.view.me.slots[0].n, 3); // 白色 5 - 2
    assert.ok(playOut(env, resumed));
  } finally {
    env.restore();
  }
});

test('对局页：没有存档时“继续”会回到首页', () => {
  const env = makeEnv();
  try {
    const page = loadPage(env, 'pages/game/game.js');
    page.onLoad({ resume: '1' });
    assert.equal(env.toasts.pop(), '没有可继续的对局');
    env.flush();
    assert.deepEqual(env.nav, ['/pages/index/index']);
  } finally {
    env.restore();
  }
});
