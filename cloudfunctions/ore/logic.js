/**
 * 《矿石商人》联机房间逻辑（与 wx-server-sdk 解耦，便于在 Node 里测试）。
 *
 * 两个集合：
 * - rooms         公开：房间号、座位、状态、版本号。客户端可读（用于 watch），只有云函数能写。
 * - room_secrets  私密：完整对局状态（牌堆顺序、随机种子、所有人的预留卡）与座位 openid。客户端不可读写。
 *
 * 客户端从不直接拿到完整状态：每次都通过 sync / move 拿到“只含自己可见信息”的版本。
 */

const { Game, IllegalMove } = require('./engine/game');
const ai = require('./engine/ai');

const MAX_PLAYERS = 4;
const MIN_PLAYERS = 2;
const NAME_MAX = 12;
const ACTIVE = ['waiting', 'playing', 'over'];

class RoomError extends Error {
  constructor(code, params) {
    super(code);
    this.code = code;
    this.params = params || {};
  }
}

function cleanName(name, fallback) {
  const s = String(name == null ? '' : name)
    .replace(/[\u0000-\u001f]/g, '')
    .trim();
  return Array.from(s).slice(0, NAME_MAX).join('') || fallback;
}

function randomCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function randomId() {
  return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** 给某个座位看的状态：去掉牌堆内容与随机数，别人的预留卡只留层级。 */
function sanitize(state, mySeat) {
  if (!state) return null;
  const s = JSON.parse(JSON.stringify(state));
  delete s.seed;
  delete s.rng;
  s.decks = s.decks.map((d) => new Array(d.length).fill(0));
  s.players.forEach((p, i) => {
    if (i !== mySeat) {
      p.reserved = p.reserved.map((c, k) => ({ id: `hidden-${i}-${k}`, tier: c.tier, hidden: true, bonus: null, points: 0, cost: {} }));
    }
  });
  return s;
}

/** 轮到电脑就一直让电脑走，直到轮到真人或游戏结束。 */
function runBots(game) {
  for (let guard = 0; guard < 400 && !game.isOver && game.current.isAI; guard++) {
    ai.step(game);
  }
}

/**
 * @param {object} store 存储适配器：
 *   findActiveRoomByCode(code) → room | null
 *   transact(async (tx) => …)，tx: getRoom(id) / getSecret(id) / putRoom(id, doc) / putSecret(id, doc)
 *   now() → 时间戳
 */
function createHandler(store) {
  /**
   * 在事务里读写一个房间。fn 返回 {changed, result}：changed 时写回并递增版本；
   * result 可以是函数，在版本号更新之后才求值（保证返回给客户端的是新版本号）。
   */
  async function withRoom(roomId, fn) {
    if (!roomId || typeof roomId !== 'string') throw new RoomError('noRoom');
    return store.transact(async (tx) => {
      const room = await tx.getRoom(roomId);
      const secret = await tx.getSecret(roomId);
      if (!room || !secret) throw new RoomError('noRoom');
      const out = (await fn(room, secret)) || {};
      if (out.changed) {
        room.version += 1;
        secret.version = room.version;
        room.updatedAt = store.now();
        room.seats = room.seats.map((s, i) => Object.assign({}, s, { host: secret.seatOpenids[i] === secret.hostOpenid }));
        if (secret.state) {
          const log = secret.state.log;
          room.lastLog = log.length ? log[log.length - 1] : null;
          room.turnSeat = secret.state.phase === 'over' ? -1 : secret.state.turn % secret.state.players.length;
        }
        await tx.putRoom(roomId, room);
        await tx.putSecret(roomId, secret);
      }
      return typeof out.result === 'function' ? out.result() : out.result;
    });
  }

  function seatOf(secret, openid) {
    return secret.seatOpenids.indexOf(openid);
  }

  function requireHost(secret, openid) {
    if (secret.hostOpenid !== openid) throw new RoomError('notHost');
  }

  function view(room, secret, openid) {
    const mySeat = seatOf(secret, openid);
    return {
      roomId: room._id,
      room: {
        code: room.code,
        status: room.status,
        seats: room.seats,
        maxPlayers: room.maxPlayers,
        version: room.version,
      },
      mySeat,
      isHost: secret.hostOpenid === openid,
      state: sanitize(secret.state, mySeat),
    };
  }

  function startGame(room, secret) {
    const game = Game.create(room.seats.map((s) => ({ name: s.name, isAI: s.isAI })));
    runBots(game);
    secret.state = game.state;
    room.status = game.isOver ? 'over' : 'playing';
  }

  const actions = {
    async create(ev, openid) {
      const maxPlayers = Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, Number(ev.maxPlayers) || MAX_PLAYERS));
      const name = cleanName(ev.name, 'Player');
      for (let attempt = 0; attempt < 8; attempt++) {
        const code = randomCode();
        if (await store.findActiveRoomByCode(code)) continue;
        const id = randomId();
        const now = store.now();
        const room = {
          _id: id,
          code,
          status: 'waiting',
          maxPlayers,
          seats: [{ name, isAI: false, host: true }],
          version: 1,
          turnSeat: -1,
          lastLog: null,
          createdAt: now,
          updatedAt: now,
        };
        const secret = { _id: id, hostOpenid: openid, seatOpenids: [openid], state: null, version: 1 };
        await store.transact(async (tx) => {
          await tx.putRoom(id, room);
          await tx.putSecret(id, secret);
        });
        return view(room, secret, openid);
      }
      throw new RoomError('busy');
    },

    async join(ev, openid) {
      const code = String(ev.code || '').trim();
      if (!/^\d{6}$/.test(code)) throw new RoomError('badCode');
      const found = await store.findActiveRoomByCode(code);
      if (!found) throw new RoomError('noRoom');
      return withRoom(found._id, (room, secret) => {
        if (seatOf(secret, openid) >= 0) return { result: () => view(room, secret, openid) }; // 已在房间里
        if (room.status !== 'waiting') throw new RoomError('started');
        if (room.seats.length >= room.maxPlayers) throw new RoomError('full');
        const names = room.seats.map((s) => s.name);
        let name = cleanName(ev.name, `Player ${room.seats.length + 1}`);
        for (let k = 2; names.indexOf(name) >= 0; k++) name = `${cleanName(ev.name, 'Player')} ${k}`;
        room.seats.push({ name, isAI: false });
        secret.seatOpenids.push(openid);
        return { changed: true, result: () => view(room, secret, openid) };
      });
    },

    async sync(ev, openid) {
      return withRoom(ev.roomId, (room, secret) => {
        if (seatOf(secret, openid) < 0) throw new RoomError('notMember');
        return { result: () => view(room, secret, openid) };
      });
    },

    async addBot(ev, openid) {
      return withRoom(ev.roomId, (room, secret) => {
        requireHost(secret, openid);
        if (room.status !== 'waiting') throw new RoomError('started');
        if (room.seats.length >= room.maxPlayers) throw new RoomError('full');
        const names = room.seats.map((s) => s.name);
        const name = cleanName(ev.name, `Bot ${room.seats.length + 1}`);
        if (names.indexOf(name) >= 0) throw new RoomError('dupName');
        room.seats.push({ name, isAI: true });
        secret.seatOpenids.push(null);
        return { changed: true, result: () => view(room, secret, openid) };
      });
    },

    async removeSeat(ev, openid) {
      return withRoom(ev.roomId, (room, secret) => {
        requireHost(secret, openid);
        if (room.status !== 'waiting') throw new RoomError('started');
        const i = Number(ev.seat);
        if (!(i >= 0 && i < room.seats.length) || secret.seatOpenids[i] === openid) throw new RoomError('badSeat');
        room.seats.splice(i, 1);
        secret.seatOpenids.splice(i, 1);
        return { changed: true, result: () => view(room, secret, openid) };
      });
    },

    async start(ev, openid) {
      return withRoom(ev.roomId, (room, secret) => {
        requireHost(secret, openid);
        if (room.status !== 'waiting') throw new RoomError('started');
        if (room.seats.length < MIN_PLAYERS) throw new RoomError('tooFew');
        startGame(room, secret);
        return { changed: true, result: () => view(room, secret, openid) };
      });
    },

    async move(ev, openid) {
      return withRoom(ev.roomId, (room, secret) => {
        const seat = seatOf(secret, openid);
        if (seat < 0) throw new RoomError('notMember');
        if (room.status !== 'playing' || !secret.state) throw new RoomError('notPlaying');
        if (Number(ev.version) !== room.version) throw new RoomError('stale');
        const game = new Game(secret.state);
        if (game.currentIndex !== seat) throw new RoomError('notYourTurn');
        game.apply(ev.move); // IllegalMove 会被外层转成错误码
        runBots(game);
        room.status = game.isOver ? 'over' : 'playing';
        return { changed: true, result: () => view(room, secret, openid) };
      });
    },

    async rematch(ev, openid) {
      return withRoom(ev.roomId, (room, secret) => {
        requireHost(secret, openid);
        if (room.status !== 'over') throw new RoomError('notOver');
        startGame(room, secret);
        return { changed: true, result: () => view(room, secret, openid) };
      });
    },

    async leave(ev, openid) {
      return withRoom(ev.roomId, (room, secret) => {
        const seat = seatOf(secret, openid);
        if (seat < 0) return { result: { left: true } };
        if (room.status === 'waiting') {
          room.seats.splice(seat, 1);
          secret.seatOpenids.splice(seat, 1);
        } else {
          // 对局中离开：座位交给电脑托管，游戏继续
          room.seats[seat] = Object.assign({}, room.seats[seat], { isAI: true });
          secret.seatOpenids[seat] = null;
          if (secret.state) {
            secret.state.players[seat].isAI = true;
            const game = new Game(secret.state);
            if (room.status === 'playing') {
              runBots(game);
              room.status = game.isOver ? 'over' : 'playing';
            }
          }
        }
        if (secret.hostOpenid === openid) {
          secret.hostOpenid = secret.seatOpenids.find((o) => o) || null; // 房主移交给下一位真人
        }
        if (!secret.seatOpenids.some((o) => o)) room.status = 'closed';
        return { changed: true, result: { left: true } };
      });
    },
  };

  return async function handle(event, openid) {
    if (!openid) return { ok: false, code: 'noAuth' };
    const fn = actions[event && event.action];
    if (!fn) return { ok: false, code: 'badAction' };
    try {
      const data = await fn(event, openid);
      return Object.assign({ ok: true }, data);
    } catch (e) {
      if (e instanceof RoomError || e instanceof IllegalMove || (e && e.name === 'IllegalMove')) {
        return { ok: false, code: e.code, params: e.params };
      }
      throw e;
    }
  };
}

module.exports = { ACTIVE, RoomError, createHandler, sanitize };
