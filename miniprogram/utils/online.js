/**
 * 联机会话：封装云函数调用与房间 watch。
 * 所有房间操作都走云函数 ore；客户端只读公开的 rooms 记录来得知“有更新了”。
 */

const ROOM_KEY = 'ore.room';
const NICK_KEY = 'ore.nick';

function available() {
  try {
    return !!(wx.cloud && getApp().globalData.cloudReady);
  } catch (e) {
    return false;
  }
}

/** 调用云函数；成功返回 data，失败抛出 {code, params}（code 用 i18n.errText 翻译）。 */
function call(action, data) {
  return new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name: 'ore',
      data: Object.assign({ action }, data),
      success: (res) => {
        const r = res && res.result;
        if (r && r.ok) resolve(r);
        else reject({ code: (r && r.code) || 'server', params: (r && r.params) || {} });
      },
      fail: () => reject({ code: 'network' }),
    });
  });
}

/**
 * 监听房间公开记录；版本号变化时回调 onVersion(version, room)。
 * watch 断开时自动退回到每 5 秒轮询一次。返回 {close()}。
 */
function watchRoom(roomId, onVersion) {
  let closed = false;
  let watcher = null;
  let timer = null;
  let last = 0;
  const emit = (room) => {
    if (!closed && room && room.version > last) {
      last = room.version;
      onVersion(room.version, room);
    }
  };
  const poll = () => {
    if (closed) return;
    wx.cloud
      .database()
      .collection('rooms')
      .doc(roomId)
      .get()
      .then((res) => emit(res.data))
      .catch(() => {})
      .then(() => {
        if (!closed) timer = setTimeout(poll, 5000);
      });
  };
  try {
    watcher = wx.cloud
      .database()
      .collection('rooms')
      .doc(roomId)
      .watch({
        onChange: (snap) => emit(snap && snap.docs && snap.docs[0]),
        onError: () => {
          watcher = null;
          poll();
        },
      });
  } catch (e) {
    poll();
  }
  return {
    close() {
      closed = true;
      if (timer) clearTimeout(timer);
      if (watcher) {
        try {
          watcher.close();
        } catch (e) {
          // ignore
        }
      }
    },
    /** 已经通过别的途径（如自己出牌的返回值）拿到了这个版本，不必再通知。 */
    seen(version) {
      if (version > last) last = version;
    },
  };
}

function safeGet(key) {
  try {
    return wx.getStorageSync(key) || null;
  } catch (e) {
    return null;
  }
}

function safeSet(key, value) {
  try {
    if (value == null) wx.removeStorageSync(key);
    else wx.setStorageSync(key, value);
  } catch (e) {
    // ignore
  }
}

module.exports = {
  available,
  call,
  watchRoom,
  /** 最近一次进入的房间，首页用来“回到联机房间” */
  lastRoom: () => safeGet(ROOM_KEY),
  rememberRoom: (roomId) => safeSet(ROOM_KEY, roomId),
  forgetRoom: () => safeSet(ROOM_KEY, null),
  nick: () => safeGet(NICK_KEY) || '',
  saveNick: (nick) => safeSet(NICK_KEY, nick),
};
