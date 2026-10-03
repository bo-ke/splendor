const storage = require('../../utils/storage');

const AI_NAMES = ['电脑·甲', '电脑·乙', '电脑·丙'];

function defaultSeats() {
  return [
    { name: '我', isAI: false },
    { name: AI_NAMES[0], isAI: true },
    { name: AI_NAMES[1], isAI: true },
    { name: AI_NAMES[2], isAI: true },
  ];
}

Page({
  data: {
    count: 3,
    seats: defaultSeats(),
    hasSave: false,
    showRules: false,
  },

  onLoad() {
    const saved = storage.loadSetup();
    if (saved && saved.seats && saved.seats.length === 4) {
      this.setData({ seats: saved.seats, count: saved.count });
    }
  },

  onShow() {
    this.setData({ hasSave: !!storage.loadGame() });
  },

  onCount(e) {
    this.setData({ count: Number(e.currentTarget.dataset.n) });
  },

  onToggleAI(e) {
    const i = Number(e.currentTarget.dataset.i);
    const seat = this.data.seats[i];
    const isAI = !seat.isAI;
    let name = seat.name;
    // 切换类型时，若还是默认名就顺手换掉
    if (isAI && (name === '我' || /^玩家\d$/.test(name))) name = AI_NAMES[Math.max(0, i - 1)];
    if (!isAI && AI_NAMES.indexOf(name) >= 0) name = i === 0 ? '我' : `玩家${i + 1}`;
    this.setData({ [`seats[${i}]`]: { name, isAI } });
  },

  onName(e) {
    const i = Number(e.currentTarget.dataset.i);
    this.setData({ [`seats[${i}].name`]: e.detail.value });
  },

  onStart() {
    const seats = this.data.seats.slice(0, this.data.count).map((s, i) => ({
      name: (s.name || '').trim() || (s.isAI ? AI_NAMES[0] : `玩家${i + 1}`),
      isAI: s.isAI,
    }));
    const names = seats.map((s) => s.name);
    if (new Set(names).size !== names.length) {
      wx.showToast({ title: '玩家名不能重复', icon: 'none' });
      return;
    }
    const start = () => {
      storage.clearGame();
      storage.saveSetup({ count: this.data.count, seats: this.data.seats });
      getApp().globalData.pendingSeats = seats;
      wx.navigateTo({ url: '/pages/game/game' });
    };
    if (this.data.hasSave) {
      wx.showModal({
        title: '开始新游戏？',
        content: '当前未完成的对局将被覆盖。',
        confirmText: '开新局',
        success: (res) => res.confirm && start(),
      });
    } else {
      start();
    }
  },

  onResume() {
    wx.navigateTo({ url: '/pages/game/game?resume=1' });
  },

  onRules() {
    this.setData({ showRules: !this.data.showRules });
  },

  noop() {},

  onShareAppMessage() {
    return { title: '来一局璀璨宝石吧！', path: '/pages/index/index' };
  },
});
