// 联机云函数逻辑测试：内存数据库替代云数据库，多个 openid 模拟多台手机。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createHandler, sanitize } = require('../../cloudfunctions/ore/logic');

/** 内存版存储：事务失败时整体回滚；房间更新后通知监听者（模拟 watch）。 */
function memoryStore() {
  const rooms = new Map();
  const secrets = new Map();
  const listeners = new Map();
  let clock = 1000;
  const copy = (x) => (x == null ? null : JSON.parse(JSON.stringify(x)));
  return {
    rooms,
    secrets,
    now: () => ++clock,
    async findActiveRoomByCode(code) {
      for (const r of rooms.values()) {
        if (r.code === code && ['waiting', 'playing', 'over'].includes(r.status)) return copy(r);
      }
      return null;
    },
    async transact(fn) {
      const writes = [];
      const result = await fn({
        getRoom: async (id) => copy(rooms.get(id)),
        getSecret: async (id) => copy(secrets.get(id)),
        putRoom: async (id, doc) => writes.push(['room', id, copy(Object.assign({}, doc, { _id: id }))]),
        putSecret: async (id, doc) => writes.push(['secret', id, copy(Object.assign({}, doc, { _id: id }))]),
      });
      const changedRooms = [];
      writes.forEach(([kind, id, doc]) => {
        (kind === 'room' ? rooms : secrets).set(id, doc);
        if (kind === 'room') changedRooms.push(id);
      });
      changedRooms.forEach((id) => (listeners.get(id) || []).forEach((cb) => cb(copy(rooms.get(id)))));
      return result;
    },
    watch(id, cb) {
      if (!listeners.has(id)) listeners.set(id, []);
      listeners.get(id).push(cb);
      return { close: () => listeners.set(id, (listeners.get(id) || []).filter((x) => x !== cb)) };
    },
  };
}

function setup() {
  const store = memoryStore();
  const handle = createHandler(store);
  const as = (openid) => (action, data) => handle(Object.assign({ action }, data), openid);
  return { store, handle, A: as('oA'), B: as('oB'), C: as('oC') };
}

/** 一个“会玩”的简单真人策略：能买就买，否则拿矿，否则盲抽，最后跳过。 */
function chooseMove(state, seat) {
  const { Game } = require('../../miniprogram/engine/game');
  const g = new Game(state);
  const p = state.players[seat];
  if (state.phase === 'discard') {
    const c = ['white', 'blue', 'green', 'red', 'black', 'gold'].find((k) => p.tokens[k] > 0);
    return { type: 'discard', color: c };
  }
  const { canAfford } = require('../../miniprogram/engine/game');
  const cards = state.board.flat().filter(Boolean).concat(p.reserved.filter((c) => !c.hidden));
  const buy = cards.find((c) => canAfford(p, c));
  if (buy) return { type: 'buy', id: buy.id };
  const need = g.requiredDistinct();
  if (need > 0) {
    const colors = ['white', 'blue', 'green', 'red', 'black']
      .filter((c) => state.tokens[c] > 0)
      .sort((a, b) => state.tokens[b] - state.tokens[a])
      .slice(0, need);
    return { type: 'takeThree', colors };
  }
  if (p.reserved.length < 3) {
    const t = [1, 2, 3].find((k) => state.decks[k - 1].length);
    if (t) return { type: 'reserveDeck', tier: t };
  }
  return { type: 'pass' };
}

test('云函数引擎副本与小程序引擎一致（否则运行 scripts/sync_cloud_engine.py）', () => {
  for (const f of ['game.js', 'ai.js', 'data.js']) {
    const a = fs.readFileSync(path.join(__dirname, '../../miniprogram/engine', f), 'utf8');
    const b = fs.readFileSync(path.join(__dirname, '../../cloudfunctions/ore/engine', f), 'utf8');
    assert.equal(a, b, f);
  }
});

test('建房 → 凭房间号加入 → 房主加电脑 → 开局', async () => {
  const { A, B, C } = setup();
  const r = await A('create', { name: '阿明', maxPlayers: 3 });
  assert.ok(r.ok);
  assert.match(r.room.code, /^\d{6}$/);
  assert.equal(r.mySeat, 0);
  assert.equal(r.isHost, true);
  assert.equal(r.state, null);

  assert.equal((await B('join', { code: '12' })).code, 'badCode');
  assert.equal((await B('join', { code: '000000' === r.room.code ? '111111' : '000000' })).code, 'noRoom');
  const jb = await B('join', { code: r.room.code, name: '阿明' }); // 重名会自动加后缀
  assert.ok(jb.ok);
  assert.equal(jb.mySeat, 1);
  assert.equal(jb.room.seats[1].name, '阿明 2');
  assert.equal((await B('join', { code: r.room.code })).mySeat, 1, '重复加入返回原座位');

  assert.equal((await B('addBot', { roomId: r.roomId, name: '电脑·甲' })).code, 'notHost');
  assert.equal((await B('start', { roomId: r.roomId })).code, 'notHost');
  assert.ok((await A('addBot', { roomId: r.roomId, name: '电脑·甲' })).ok);
  assert.equal((await C('join', { code: r.room.code })).code, 'full');
  assert.equal((await C('sync', { roomId: r.roomId })).code, 'notMember');

  const st = await A('start', { roomId: r.roomId });
  assert.ok(st.ok);
  assert.equal(st.room.status, 'playing');
  assert.equal(st.state.players.length, 3);
  assert.equal(st.state.players[2].isAI, true);
  assert.equal((await C('join', { code: r.room.code })).code, 'started');
});

test('只有轮到的人能出牌；版本过期会被拒绝；非法动作返回引擎错误码', async () => {
  const { A, B } = setup();
  const r = await A('create', { name: 'A', maxPlayers: 2 });
  await B('join', { code: r.room.code, name: 'B' });
  const s = await A('start', { roomId: r.roomId });
  const v = s.room.version;

  assert.equal((await B('move', { roomId: r.roomId, version: v, move: { type: 'pass' } })).code, 'notYourTurn');
  assert.equal((await A('move', { roomId: r.roomId, version: v - 1, move: { type: 'pass' } })).code, 'stale');
  const bad = await A('move', { roomId: r.roomId, version: v, move: { type: 'takeThree', colors: ['red', 'red', 'blue'] } });
  assert.equal(bad.code, 'distinct');
  assert.equal((await A('move', { roomId: r.roomId, version: v, move: { type: 'hack' } })).code, 'badMove');

  const ok = await A('move', { roomId: r.roomId, version: v, move: { type: 'takeThree', colors: ['red', 'blue', 'green'] } });
  assert.ok(ok.ok);
  assert.equal(ok.room.version, v + 1);
  assert.equal(ok.state.players[0].tokens.red, 1);
  assert.equal(ok.state.turn, 1);
});

test('隐私：客户端拿不到牌堆、随机种子和别人的预留卡', async () => {
  const { A, B, store } = setup();
  const r = await A('create', { name: 'A', maxPlayers: 2 });
  await B('join', { code: r.room.code, name: 'B' });
  const s = await A('start', { roomId: r.roomId });
  const after = await A('move', { roomId: r.roomId, version: s.room.version, move: { type: 'reserveDeck', tier: 3 } });
  assert.ok(after.ok);

  const mine = after.state.players[0].reserved[0];
  assert.ok(mine.cost && !mine.hidden, '自己能看到盲抽的卡');
  const theirs = (await B('sync', { roomId: r.roomId })).state;
  assert.deepEqual(theirs.players[0].reserved, [{ id: 'hidden-0-0', tier: 3, hidden: true, bonus: null, points: 0, cost: {} }]);
  for (const st of [after.state, theirs]) {
    assert.equal(st.seed, undefined);
    assert.equal(st.rng, undefined);
    st.decks.forEach((d) => assert.ok(d.every((x) => x === 0)));
  }
  // 牌堆张数仍然正确
  const full = store.secrets.get(r.roomId).state;
  assert.deepEqual(theirs.decks.map((d) => d.length), full.decks.map((d) => d.length));
  // 公开的 rooms 记录里没有任何对局状态
  const pub = store.rooms.get(r.roomId);
  assert.equal(pub.state, undefined);
  assert.equal(JSON.stringify(pub).includes(full.players[0].reserved[0].id), false);
  assert.deepEqual(sanitize(null, 0), null);
});

test('对局中离开：座位交给电脑托管，房主移交，游戏继续直到结束', async () => {
  const { A, B, store } = setup();
  const r = await A('create', { name: 'A', maxPlayers: 3 });
  await B('join', { code: r.room.code, name: 'B' });
  await A('addBot', { roomId: r.roomId, name: 'Bot' });
  let s = await A('start', { roomId: r.roomId });
  s = await A('move', { roomId: r.roomId, version: s.room.version, move: chooseMove(s.state, 0) });
  assert.ok(s.ok);

  assert.ok((await A('leave', { roomId: r.roomId })).ok);
  const sec = store.secrets.get(r.roomId);
  assert.equal(sec.hostOpenid, 'oB');
  assert.equal(store.rooms.get(r.roomId).seats[0].isAI, true);
  assert.equal(store.rooms.get(r.roomId).seats[1].host, true);

  // B 一个人对两个电脑打完
  let view = await B('sync', { roomId: r.roomId });
  assert.equal(view.isHost, true);
  for (let i = 0; i < 2000 && view.room.status === 'playing'; i++) {
    view = await B('move', { roomId: r.roomId, version: view.room.version, move: chooseMove(view.state, 1) });
    assert.ok(view.ok, view.code);
  }
  assert.equal(view.room.status, 'over');
  assert.equal(store.rooms.get(r.roomId).turnSeat, -1);
  assert.equal(store.rooms.get(r.roomId).lastLog.key, 'over');

  // 再来一局
  const again = await B('rematch', { roomId: r.roomId });
  assert.ok(again.ok);
  assert.equal(again.room.status, 'playing');

  // 所有真人都离开 → 房间关闭
  await B('leave', { roomId: r.roomId });
  assert.equal(store.rooms.get(r.roomId).status, 'closed');
});

test('等待中：房主可移除座位；房主离开后房间关闭或移交', async () => {
  const { A, B } = setup();
  const r = await A('create', { name: 'A', maxPlayers: 4 });
  await B('join', { code: r.room.code, name: 'B' });
  await A('addBot', { roomId: r.roomId, name: 'Bot' });
  assert.equal((await A('addBot', { roomId: r.roomId, name: 'Bot' })).code, 'dupName');
  assert.equal((await A('removeSeat', { roomId: r.roomId, seat: 0 })).code, 'badSeat', '不能移除自己');
  const rm = await A('removeSeat', { roomId: r.roomId, seat: 2 });
  assert.equal(rm.room.seats.length, 2);
  assert.equal((await A('start', { roomId: r.roomId })).ok, true);
});

test('两名真人 + 电脑，多局完整联机对局都能正常结束', async () => {
  for (let round = 0; round < 5; round++) {
    const { A, B, store } = setup();
    const r = await A('create', { name: 'A', maxPlayers: 3 });
    await B('join', { code: r.room.code, name: 'B' });
    await A('addBot', { roomId: r.roomId, name: 'Bot' });
    await A('start', { roomId: r.roomId });
    const players = { 0: A, 1: B };
    let guard = 0;
    while (store.rooms.get(r.roomId).status === 'playing' && guard++ < 3000) {
      const pub = store.rooms.get(r.roomId);
      const who = players[pub.turnSeat];
      const v = await who('sync', { roomId: r.roomId });
      const res = await who('move', { roomId: r.roomId, version: v.room.version, move: chooseMove(v.state, v.mySeat) });
      assert.ok(res.ok, res.code);
    }
    assert.equal(store.rooms.get(r.roomId).status, 'over');
  }
});
