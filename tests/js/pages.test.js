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
    setNavigationBarTitle: (o) => (env.navTitle = o.title),
    getAppBaseInfo: () => ({ language: env.sysLang || 'zh_CN' }),
  };
  // 每个用例从中文开始；需要英文的用例自己切换
  require(path.join(ROOT, 'utils/i18n.js')).setLang('zh');
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
  v.tiers.forEach((r) => r.slots.forEach(({ card: c }) => c && board.push({ c, source: 'board' })));
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
    assert.equal(env.toasts.pop(), '拿 2 份同种时不能再拿其他矿石');
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
    assert.equal(page.data.handoff.name, 'A');
    assert.equal(page.data.handoff.title, '轮到 A');
    assert.equal(page.data.view.myTurn, false, '确认前不能操作');
    page.onHandoffReady();
    assert.equal(page.data.view.myTurn, true);
    humanMove(page);
    assert.equal(page.data.handoff.name, 'B');
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
    assert.equal(env.toasts.pop(), '请先点击你自己的矿石弃回');
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

test('双语：英文整局 + 对局中切换语言，记录与文案随之变化', () => {
  const env = makeEnv();
  try {
    const i18n = require(path.join(ROOT, 'utils/i18n.js'));
    i18n.setLang('en');
    const idx = loadPage(env, 'pages/index/index.js');
    idx.onLoad();
    idx.onShow();
    assert.equal(idx.data.t.start, 'New Game');
    assert.equal(env.navTitle, 'Ore Merchant');
    assert.deepEqual(
      idx.data.seats.map((x) => x.name),
      ['Me', 'Bot·A', 'Bot·B', 'Bot·C']
    );
    // 切到中文：默认名跟着换，自己起的名字不变
    idx.onName(ev({ i: 1 }, { value: 'Alice' }));
    idx.onToggleLang();
    assert.equal(i18n.getLang(), 'zh');
    assert.deepEqual(
      idx.data.seats.map((x) => x.name),
      ['我', 'Alice', '电脑·乙', '电脑·丙']
    );
    assert.equal(env.navTitle, '矿石商人');
    idx.onToggleLang();

    env.globalData.pendingSeats = [
      { name: 'Me', isAI: false },
      { name: 'Bot·A', isAI: true },
    ];
    const page = loadPage(env, 'pages/game/game.js');
    page.onLoad({});
    assert.equal(page.data.view.roundLabel, 'Round 1');
    assert.match(page.data.view.lastLog, /^2 players\. First to 15/);
    page.onTapBank(ev({ color: 'gold' }));
    assert.equal(env.toasts.pop(), 'Gold can only be gained by reserving');
    humanMove(page);
    assert.match(page.data.view.lastLog, /^Me (took|bought|reserved)/);
    env.flush();
    assert.match(page.data.view.lastLog, /^Bot·A /);

    // 对局中切回中文：同一份记录重新翻译
    page.onToggleLang();
    assert.equal(page.data.t.take, '拿取');
    assert.match(page.data.view.roundLabel, /^第 \d+ 轮$/);
    assert.match(page.data.view.lastLog, /^电脑·甲|^Bot·A /);
    page.onShowLog();
    assert.match(page.data.logs[page.data.logs.length - 1].text, /^开局：2 名玩家/);
    page.onToggleLang();
    page.onShowLog();
    assert.match(page.data.logs[page.data.logs.length - 1].text, /^2 players/);
    page.onCloseLog();

    assert.ok(playOut(env, page));
    assert.match(page.data.result.title, / wins$/);
    assert.match(page.data.result.rank[0].detail, /cards · \d+ nobles?$/);
  } finally {
    env.restore();
  }
});

test('双语：未设置偏好时跟随系统语言', () => {
  const env = makeEnv();
  try {
    const i18n = require(path.join(ROOT, 'utils/i18n.js'));
    delete env.storage['ore.lang'];
    env.sysLang = 'en-US';
    assert.equal(i18n.init(), 'en');
    env.sysLang = 'zh_TW';
    assert.equal(i18n.init(), 'zh');
    i18n.setLang('en');
    env.sysLang = 'zh_CN';
    assert.equal(i18n.init(), 'en', '用户选过的语言优先');
  } finally {
    env.restore();
  }
});

// ------------------------------------------------------------ 回归测试
test('回归：同屏多人读档后、电脑回合里不泄露预留卡（含盲抽）', () => {
  const env = makeEnv();
  try {
    env.globalData.pendingSeats = [
      { name: 'A', isAI: false },
      { name: 'B', isAI: false },
      { name: 'C', isAI: true },
    ];
    const page = loadPage(env, 'pages/game/game.js');
    page.onLoad({});
    page.onHandoffReady();
    page.onTapDeck(ev({ tier: 3 }));
    page.onSheetReserve(); // A 盲抽预留
    page.onHandoffReady();
    humanMove(page); // B
    assert.equal(page.game.current.name, 'C');
    page.onUnload();

    const resumed = loadPage(env, 'pages/game/game.js');
    resumed.onLoad({ resume: '1' });
    assert.equal(resumed.data.view.me.name, 'A');
    assert.deepEqual(resumed.data.view.me.reserved, [], '不知道谁拿着手机时不显示牌面');
    assert.equal(resumed.data.view.me.hiddenReserved.length, 1);
    assert.equal(resumed.data.view.me.hiddenReserved[0].tier, 3);
  } finally {
    env.restore();
  }
});

test('回归：0 号座位改成电脑时默认名不与其他座位重复', () => {
  const env = makeEnv();
  try {
    const page = loadPage(env, 'pages/index/index.js');
    page.onLoad();
    page.onToggleAI(ev({ i: 0 }));
    const names = page.data.seats.map((s) => s.name);
    assert.equal(new Set(names).size, 4, names.join(','));
    page.onStart();
    assert.deepEqual(env.nav, ['/pages/game/game']);
  } finally {
    env.restore();
  }
});

test('回归：卡牌“可买”角标跟随语言', () => {
  const env = makeEnv();
  try {
    const i18n = require(path.join(ROOT, 'utils/i18n.js'));
    const { cardView } = require(path.join(ROOT, 'utils/view.js'));
    const card = { id: 'd01', tier: 1, bonus: 'red', points: 0, cost: { white: 1, blue: 1 } };
    const p = { cards: [], tokens: { white: 1, blue: 0, green: 0, red: 0, black: 0, gold: 1 } };
    assert.equal(cardView(card, p).tag, '金×1');
    i18n.setLang('en');
    assert.equal(cardView(card, p).tag, 'Gold×1');
    p.tokens.blue = 1;
    assert.equal(cardView(card, p).tag, 'Buy');
  } finally {
    env.restore();
  }
});

test('回归：电脑行动后，开着的卡牌面板 / 对手详情会刷新而不是显示过期内容', () => {
  const env = makeEnv();
  try {
    env.globalData.pendingSeats = [
      { name: '我', isAI: false },
      { name: '电脑', isAI: true },
    ];
    const page = loadPage(env, 'pages/game/game.js');
    page.onLoad({});
    humanMove(page);
    // 电脑回合：打开第 1 层第一张卡、以及对手详情
    const target = page.data.view.tiers[2].slots[0].card;
    page.onTapCard(ev({ id: target.id, source: 'board' }));
    assert.equal(page.data.sheet.showBuy, false);
    page.onTapPlayer(ev({ index: 1 }));
    const before = page.data.playerSheet.tokenTotal;
    env.flush(); // 电脑走一步
    const s = page.data.sheet;
    if (page.game.boardCard(target.id)) {
      assert.equal(s.id, target.id);
      assert.equal(s.showBuy, true, '轮到我了，面板应带上购买按钮');
    } else {
      assert.equal(s, null, '卡被电脑拿走后面板应关闭');
    }
    assert.equal(page.data.playerSheet.tokenTotal, page.data.view.players[1].tokenTotal);
    assert.ok(typeof before === 'number');

    // 模拟卡被拿走：刷新后面板关闭
    page.onTapCard(ev({ id: page.data.view.tiers[2].slots[1].card.id, source: 'board' }));
    const gone = page.game.boardCard(page.data.sheet.id);
    page.game._removeFromBoard(gone, true);
    page.refreshOverlays();
    assert.equal(page.data.sheet, null);

    // 再来一局时清掉对手详情
    page.onRematch();
    assert.equal(page.data.playerSheet, null);
  } finally {
    env.restore();
  }
});

test('回归：关掉结算看牌桌后，切后台再回来不会再弹结算；轮数与记录一致', () => {
  const env = makeEnv();
  try {
    env.globalData.pendingSeats = [
      { name: '我', isAI: false },
      { name: '电脑', isAI: true },
    ];
    const page = loadPage(env, 'pages/game/game.js');
    page.onLoad({});
    assert.ok(playOut(env, page));
    const { rounds } = page.data.result;
    assert.equal(page.data.view.round, rounds, '棋盘上的轮数 = 实际打完的轮数');
    const log = page.game.state.log;
    assert.equal(log[log.length - 1].key, 'over');
    assert.equal(log[log.length - 1].round, rounds);

    page.onCloseResult();
    page.onHide();
    page.onShow();
    while (env.flush());
    assert.equal(page.data.result, null);
  } finally {
    env.restore();
  }
});
