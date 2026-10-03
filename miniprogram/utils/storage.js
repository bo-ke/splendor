/** 对局存档：每步自动保存到本地缓存，回到首页可“继续上局”。 */

const SAVE_KEY = 'splendor.save.v1';
const SETUP_KEY = 'splendor.setup.v1';

function safeGet(key) {
  try {
    return wx.getStorageSync(key) || null;
  } catch (e) {
    return null;
  }
}

function safeSet(key, value) {
  try {
    wx.setStorageSync(key, value);
  } catch (e) {
    // 存储失败不影响对局
  }
}

module.exports = {
  loadGame() {
    const s = safeGet(SAVE_KEY);
    return s && s.version === 1 && s.phase !== 'over' ? s : null;
  },
  saveGame(state) {
    safeSet(SAVE_KEY, state);
  },
  clearGame() {
    try {
      wx.removeStorageSync(SAVE_KEY);
    } catch (e) {
      // ignore
    }
  },
  loadSetup() {
    return safeGet(SETUP_KEY);
  },
  saveSetup(seats) {
    safeSet(SETUP_KEY, seats);
  },
};
