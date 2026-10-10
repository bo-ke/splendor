/**
 * 云函数 ore：《矿石商人》联机房间。所有操作走这一个入口：
 *   wx.cloud.callFunction({ name: 'ore', data: { action: 'create' | 'join' | 'sync' | 'move' | … } })
 * 业务逻辑在 logic.js；这里只负责把云数据库接成 logic 需要的存储接口。
 */

const cloud = require('wx-server-sdk');
const { ACTIVE, createHandler } = require('./logic');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const ROOMS = 'rooms';
const SECRETS = 'room_secrets';

function withoutId(doc) {
  const copy = Object.assign({}, doc);
  delete copy._id;
  return copy;
}

const store = {
  now: () => Date.now(),

  async findActiveRoomByCode(code) {
    const res = await db
      .collection(ROOMS)
      .where({ code, status: _.in(ACTIVE) })
      .limit(1)
      .get();
    return res.data[0] || null;
  },

  // 一次房间操作 = 一个数据库事务，读写 rooms 与 room_secrets 两条记录，保证不会出现半更新
  transact(fn) {
    return db.runTransaction(async (t) => {
      const get = async (coll, id) => {
        try {
          const res = await t.collection(coll).doc(id).get();
          return Object.assign({ _id: id }, res.data);
        } catch (e) {
          return null; // 记录不存在
        }
      };
      // set 会整体替换记录（update 遇到对象字段会深度合并，可能残留旧字段）
      const put = (coll, id, doc) => t.collection(coll).doc(id).set({ data: withoutId(doc) });
      return fn({
        getRoom: (id) => get(ROOMS, id),
        getSecret: (id) => get(SECRETS, id),
        putRoom: (id, doc) => put(ROOMS, id, doc),
        putSecret: (id, doc) => put(SECRETS, id, doc),
      });
    });
  },
};

const handle = createHandler(store);

async function ensureCollections() {
  for (const name of [ROOMS, SECRETS]) {
    try {
      await db.createCollection(name);
    } catch (e) {
      // 已存在
    }
  }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  try {
    return await handle(event, OPENID);
  } catch (e) {
    // 首次部署时集合还没建：自动创建后重试一次
    if (e && (e.errCode === -502005 || /not exist/i.test(String(e.message)))) {
      await ensureCollections();
      return handle(event, OPENID);
    }
    console.error(e);
    return { ok: false, code: 'server' };
  }
};
