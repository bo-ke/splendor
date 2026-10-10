// 联机端到端测试：两台“手机”（各自独立的 wx / 本地存储 / openid），共用一个内存云数据库与真实云函数逻辑。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { createHandler } = require('../../cloudfunctions/ore/logic');

const MP = path.join(__dirname, '../../miniprogram');

// ---------------------------------------------------------------- 云端
function cloudBackend() {
  const rooms = new Map();
  const secrets = new Map();
  const listeners = new Map();
  const copy = (x) => (x == null ? null : JSON.parse(JSON.stringify(x)));
  let clock = 1;
  const store = {
    now: () => ++clock,
    async findActiveRoomByCode(code) {
      for (const r of rooms.values()) if (r.code === code && ['waiting', 'playing', 'over'].includes(r.status)) return copy(r);
      return null;
    },
    async transact(fn) {
      const writes = [];
      const res = await fn({
        getRoom: async (id) => copy(rooms.get(id)),
        getSecret: async (id) => copy(secrets.get(id)),
        putRoom: async (id, doc) => writes.push([rooms, id, doc]),
        putSecret: async (id, doc) => writes.push([secrets, id, doc]),
      });
      writes.forEach(([m, id, doc]) => m.set(id, copy(Object.assign({}, doc, { _id: id }))));
      writes
        .filter(([m]) => m === rooms)
        .forEach(([, id]) =>
          (listeners.get(id) || []).forEach((cb) => setImmediate(() => cb(copy(rooms.get(id)))))
        );
      return res;
    },
  };
  return {
    rooms,
    secrets,
    handle: createHandler(store),
    watch(id, cb) {
      if (!listeners.has(id)) listeners.set(id, []);
      listeners.get(id).push(cb);
      return () => listeners.set(id, listeners.get(id).filter((x) => x !== cb));
    },
    calls: 0,
  };
}

// ---------------------------------------------------------------- 手机
/** 一台手机：独立的全局对象（wx、getApp、Page、定时器），在 vm 沙箱里加载小程序代码。 */
function phone(cloud, openid, lang) {
  const storage = {};
  const timers = [];
  const toasts = [];
  const nav = [];
  const app = { globalData: { pendingSeats: null, cloudReady: true } };
  let lastPage = null;
  const sandbox = {
    console,
    Promise,
    setImmediate,
    setTimeout: (fn) => timers.push(fn),
    clearTimeout: () => {},
    getApp: () => app,
    getCurrentPages: () => [],
    Page: (opts) => (lastPage = opts),
    wx: {
      getStorageSync: (k) => (k in storage ? JSON.parse(storage[k]) : ''),
      setStorageSync: (k, v) => (storage[k] = JSON.stringify(v)),
      removeStorageSync: (k) => delete storage[k],
      showToast: (o) => toasts.push(o.title),
      showModal: (o) => o.success && o.success({ confirm: true }),
      showLoading: () => {},
      hideLoading: () => {},
      navigateTo: (o) => nav.push(o.url),
      redirectTo: (o) => nav.push(o.url),
      navigateBack: () => nav.push('back'),
      reLaunch: (o) => nav.push(o.url),
      setNavigationBarTitle: () => {},
      getAppBaseInfo: () => ({ language: lang === 'en' ? 'en' : 'zh_CN' }),
      cloud: {
        init: () => {},
        callFunction: ({ name, data, success, fail }) => {
          assert.equal(name, 'ore');
          cloud.calls++;
          const payload = JSON.parse(JSON.stringify(data)); // 模拟序列化
          cloud
            .handle(payload, openid)
            .then((result) => setImmediate(() => success({ result: JSON.parse(JSON.stringify(result)) })))
            .catch(() => setImmediate(() => fail({})));
        },
        database: () => ({
          collection: (c) => ({
            doc: (id) => ({
              watch: ({ onChange }) => {
                assert.equal(c, 'rooms', '客户端只能监听公开的 rooms 集合');
                const off = cloud.watch(id, (room) => onChange({ docs: [room] }));
                return { close: off };
              },
              get: () => Promise.resolve({ data: JSON.parse(JSON.stringify(cloud.rooms.get(id))) }),
            }),
          }),
        }),
      },
    },
  };
  vm.createContext(sandbox);
  const cache = {};
  function req(file) {
    if (cache[file]) return cache[file].exports;
    const mod = { exports: {} };
    cache[file] = mod;
    const code = fs.readFileSync(file, 'utf8');
    const fn = vm.runInContext(`(function (require, module, exports) {${code}\n})`, sandbox, { filename: file });
    fn((p) => req(require.resolve(path.resolve(path.dirname(file), p))), mod, mod.exports);
    return mod.exports;
  }
  req(path.join(MP, 'utils/i18n.js')).setLang(lang);

  return {
    openid,
    toasts,
    nav,
    storage,
    timers,
    open(rel, options) {
      lastPage = null;
      req(path.join(MP, rel));
      delete cache[path.join(MP, rel)]; // 同一页面可以多次打开
      const opts = lastPage;
      const page = Object.create(opts);
      page.data = JSON.parse(JSON.stringify(opts.data));
      page.setData = function (patch) {
        Object.keys(patch).forEach((k) => {
          const parts = k.replace(/\[(\d+)\]/g, '.$1').split('.');
          let o = this.data;
          for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
          o[parts[parts.length - 1]] = JSON.parse(JSON.stringify(patch[k] === undefined ? null : patch[k]));
        });
      };
      page.onLoad && page.onLoad(options || {});
      page.onShow && page.onShow();
      return page;
    },
    flushTimers() {
      while (timers.length) timers.shift()();
    },
  };
}

/** 等云函数回调、watch 推送等异步事件都处理完。 */
async function settle(n = 30) {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
}

const ev = (dataset, detail) => ({ currentTarget: { dataset }, detail: detail || {} });

/** 通过页面交互走一步（联机版：处理函数返回 Promise）。 */
async function onlineMove(page) {
  const v = page.data.view;
  if (v.phase === 'discard') {
    const slot = v.me.slots.find((s) => s.n > 0 && s.color !== 'gold') || v.me.slots.find((s) => s.n > 0);
    await page.onTapMyToken(ev({ color: slot.color }));
    return;
  }
  const cards = [];
  v.tiers.forEach((r) => r.slots.forEach(({ card }) => card && cards.push({ card, source: 'board' })));
  v.me.reserved.forEach((card) => cards.push({ card, source: 'reserved' }));
  const buy = cards.find((x) => x.card.affordable);
  if (buy) {
    page.onTapCard(ev({ id: buy.card.id, source: buy.source }));
    await page.onSheetBuy();
    return;
  }
  if (v.requiredDistinct > 0) {
    v.bank
      .filter((b) => b.color !== 'gold' && b.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, v.requiredDistinct)
      .forEach((b) => page.onTapBank(ev({ color: b.color })));
    await page.onConfirmTake();
    return;
  }
  const tier = v.tiers.find((r) => r.deckCount > 0);
  if (v.me.reserved.length < 3 && tier) {
    page.onTapDeck(ev({ tier: tier.tier }));
    await page.onSheetReserve();
    return;
  }
  await page.onPass();
}

test('联机：首页建房 → 好友凭房间号加入 → 加电脑 → 开局 → 打完整局 → 再来一局', async () => {
  const cloud = cloudBackend();
  const A = phone(cloud, 'openid-A', 'zh');
  const B = phone(cloud, 'openid-B', 'en');

  // A 在首页建房
  const home = A.open('pages/index/index.js');
  assert.equal(home.data.onlineOk, true);
  home.onMode(ev({ mode: 'online' }));
  home.onNick(ev({}, { value: '阿明' }));
  await home.onCreateRoom();
  const lobbyUrl = A.nav.pop();
  const roomId = lobbyUrl.match(/roomId=(\w+)/)[1];
  const lobbyA = A.open('pages/lobby/lobby.js', { roomId });
  await settle();
  assert.equal(lobbyA.data.isHost, true);
  assert.equal(lobbyA.data.seats.length, 1);
  const code = lobbyA.data.room.code;
  assert.match(code, /^\d{6}$/);
  const share = lobbyA.onShareAppMessage();
  assert.equal(share.path, `/pages/lobby/lobby?code=${code}`);

  // B 点开分享卡片（英文界面）加入
  const lobbyB = B.open('pages/lobby/lobby.js', { code });
  await settle();
  assert.equal(lobbyB.data.isHost, false);
  assert.equal(lobbyB.data.mySeat, 1);
  assert.match(lobbyB.data.seats[1].name, /^Miner \d{4}$/, '没填昵称时随机一个');
  assert.equal(lobbyA.data.seats.length, 2, 'A 通过 watch 看到 B 加入');

  // 非房主不能开局 / 加电脑
  await lobbyB.onAddBot();
  assert.equal(B.toasts.pop(), 'Only the host can do that');

  await lobbyA.onAddBot();
  await settle();
  assert.equal(lobbyA.data.seats[2].name, '电脑·甲');
  assert.equal(lobbyB.data.seats.length, 3);
  assert.equal(lobbyA.data.countLabel, '3/4 人');

  await lobbyA.onStart();
  await settle();
  assert.equal(A.nav.pop(), `/pages/game/game?room=${roomId}`);
  assert.equal(B.nav.pop(), `/pages/game/game?room=${roomId}`, 'B 通过 watch 被带进对局');

  const gA = A.open('pages/game/game.js', { room: roomId });
  const gB = B.open('pages/game/game.js', { room: roomId });
  await settle();
  assert.equal(gA.data.view.me.name, '阿明');
  assert.equal(gB.data.view.me.name, lobbyB.data.seats[1].name);
  assert.equal(gA.data.handoff, null, '联机不需要交接遮罩');
  assert.ok(gA.data.view.myTurn !== gB.data.view.myTurn || gA.data.view.phase === 'over');

  // 轮流出牌直到结束
  let steps = 0;
  let sawHidden = false;
  while ((gA.data.view.phase !== 'over' || gB.data.view.phase !== 'over') && steps < 3000) {
    const mover = gA.data.view.myTurn ? gA : gB.data.view.myTurn ? gB : null;
    assert.ok(mover, '总有一位真人可以出牌（电脑在云端走）');
    await onlineMove(mover);
    await settle();
    // 两台手机看到的版本一致
    assert.equal(gA.version, gB.version);
    const other = mover === gA ? gB : gA;
    const mySeat = mover === gA ? 0 : 1;
    if (mover.data.view.me.reserved.length) {
      const seen = other.data.view.players[mySeat];
      assert.equal(seen.reservedCount, mover.data.view.me.reserved.length);
      sawHidden = true;
    }
    steps++;
  }
  assert.ok(steps < 3000, '对局应结束');
  assert.ok(steps > 20, `应当真的打了很多步（${steps}）`);
  assert.ok(cloud.calls > steps, '每一步都经过云函数');
  if (process.env.DEBUG_ONLINE) console.log({ steps, calls: cloud.calls, sawHidden });
  // 别人的预留卡对我只有卡背：本地 Game 里拿不到牌面
  gB.game.state.players[0].reserved.forEach((c) => assert.equal(c.hidden, true));

  A.flushTimers();
  B.flushTimers();
  assert.ok(gA.data.result && gB.data.result);
  assert.equal(gA.data.result.title.replace(' 获胜', ''), gB.data.result.title.replace(' wins', ''));
  assert.equal(gA.data.result.canRematch, true);
  assert.equal(gB.data.result.canRematch, false, '只有房主能再开一局');
  await gB.onRematch();
  assert.equal(B.toasts.pop(), 'Waiting for the host to start again');

  await gA.onRematch();
  await settle();
  assert.equal(gA.data.result, null);
  assert.equal(gB.data.result, null, 'B 通过 watch 进入新的一局');
  assert.equal(gA.data.view.round, 1);
  assert.equal(gB.data.view.round, 1);
});

test('联机：过期操作会自动重新同步；离开后座位由电脑接管；无效房间号有提示', async () => {
  const cloud = cloudBackend();
  const A = phone(cloud, 'oA', 'zh');
  const B = phone(cloud, 'oB', 'zh');
  const r = await cloud.handle({ action: 'create', name: 'A', maxPlayers: 2 }, 'oA');
  await cloud.handle({ action: 'join', code: r.room.code, name: 'B' }, 'oB');
  await cloud.handle({ action: 'start', roomId: r.roomId }, 'oA');

  const gA = A.open('pages/game/game.js', { room: r.roomId });
  const gB = B.open('pages/game/game.js', { room: r.roomId });
  await settle();

  // 隐私：盲抽预留后，自己看得到牌面，对手只看到卡背
  const first = gA.data.view.myTurn ? gA : gB;
  const watcher = first === gA ? gB : gA;
  const seat = first === gA ? 0 : 1;
  first.onTapDeck(ev({ tier: 3 }));
  await first.onSheetReserve();
  await settle();
  const own = first.data.view.me.reserved[0];
  assert.ok(own && own.cost.length > 0, '自己能看到盲抽卡的成本');
  assert.equal(watcher.data.view.players[seat].reservedCount, 1);
  assert.deepEqual(watcher.game.state.players[seat].reserved[0].cost, {});
  assert.equal(watcher.game.state.players[seat].reserved[0].hidden, true);
  assert.equal(JSON.stringify(watcher.data).includes(own.id), false, '对手的界面数据里完全没有这张卡');
  assert.ok(watcher.game.state.decks.every((d) => d.every((x) => x === 0)), '牌堆内容不下发');

  const mover = gA.data.view.myTurn ? gA : gB;
  mover.version -= 1; // 模拟错过了一次更新
  await onlineMove(mover);
  await settle();
  assert.match((mover === gA ? A : B).toasts.pop(), /局面已更新/);
  assert.equal(mover.version, cloud.rooms.get(r.roomId).version, '已自动同步到最新');

  // B 离开：A 继续对电脑
  await cloud.handle({ action: 'leave', roomId: r.roomId }, 'oB');
  await settle();
  assert.equal(gA.data.view.players[1].isAI, true);
  let guard = 0;
  while (gA.data.view.phase !== 'over' && guard++ < 2000) {
    assert.ok(gA.data.view.myTurn, '对手是电脑，云端立刻走完');
    await onlineMove(gA);
    await settle();
  }
  assert.equal(gA.data.view.phase, 'over');

  // 无效房间号
  const home = A.open('pages/index/index.js');
  home.onMode(ev({ mode: 'online' }));
  home.onCode(ev({}, { value: '12ab' }));
  home.onJoinRoom();
  assert.equal(A.toasts.pop(), '请输入 6 位数字房间号');
  const lobby = A.open('pages/lobby/lobby.js', { code: '999999' === r.room.code ? '888888' : '999999' });
  await settle();
  assert.equal(A.toasts.pop(), '房间不存在或已关闭');
});
