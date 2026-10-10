const i18n = require('../../utils/i18n');
const storage = require('../../utils/storage');

const t = i18n.t;

/** 座位 i 的默认名（按当前语言）：0 号是“我”，其余真人是“玩家N”，电脑依次是甲乙丙。 */
function defaultName(i, isAI) {
  const L = i18n.dict();
  if (isAI) return L.botNames[Math.max(0, i - 1)];
  return i === 0 ? L.me : t('fmt.playerN', i + 1);
}

function defaultSeats() {
  return [0, 1, 2, 3].map((i) => ({ name: defaultName(i, i > 0), isAI: i > 0 }));
}

Page({
  data: {
    count: 3,
    seats: [],
    hasSave: false,
    showRules: false,
    ores: ['white', 'blue', 'green', 'red', 'black'],
    t: {},
  },

  onLoad() {
    const saved = storage.loadSetup();
    const seats = saved && saved.seats && saved.seats.length === 4 ? saved.seats : defaultSeats();
    this.setData({ seats, count: saved && saved.count ? saved.count : 3 });
    this.applyLang();
  },

  onShow() {
    if (this.data.t.lang !== i18n.getLang()) this.applyLang();
    this.setData({ hasSave: !!storage.loadGame() });
  },

  applyLang() {
    // 仍是默认名的座位随语言一起换掉，用户自己起的名字保持不变
    const seats = this.data.seats.map((s, i) =>
      i18n.isDefaultName(s.name) ? { name: defaultName(i, s.isAI), isAI: s.isAI } : s
    );
    this.setData({ t: i18n.ui(), seats });
    wx.setNavigationBarTitle && wx.setNavigationBarTitle({ title: t('appName') });
  },

  onToggleLang() {
    i18n.setLang(i18n.getLang() === 'zh' ? 'en' : 'zh');
    this.applyLang();
  },

  onCount(e) {
    this.setData({ count: Number(e.currentTarget.dataset.n) });
  },

  onToggleAI(e) {
    const i = Number(e.currentTarget.dataset.i);
    const seat = this.data.seats[i];
    const isAI = !seat.isAI;
    // 切换类型时，若还是默认名就顺手换掉
    const name = i18n.isDefaultName(seat.name) ? defaultName(i, isAI) : seat.name;
    this.setData({ [`seats[${i}]`]: { name, isAI } });
  },

  onName(e) {
    const i = Number(e.currentTarget.dataset.i);
    this.setData({ [`seats[${i}].name`]: e.detail.value });
  },

  onStart() {
    const seats = this.data.seats.slice(0, this.data.count).map((s, i) => ({
      name: (s.name || '').trim() || defaultName(i, s.isAI),
      isAI: s.isAI,
    }));
    const names = seats.map((s) => s.name);
    if (new Set(names).size !== names.length) {
      wx.showToast({ title: t('fmt.dupNames'), icon: 'none' });
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
        title: t('fmt.newGameTitle'),
        content: t('fmt.newGameBody'),
        confirmText: t('fmt.newGameOk'),
        cancelText: t('fmt.newGameCancel'),
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
    return { title: t('fmt.share'), path: '/pages/index/index' };
  },
});
