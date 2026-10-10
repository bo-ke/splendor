const i18n = require('../../utils/i18n');
const online = require('../../utils/online');
const { avatarChar } = require('../../utils/view');

const t = i18n.t;

function toast(title) {
  wx.showToast({ title, icon: 'none' });
}

function goHome() {
  wx.reLaunch({ url: '/pages/index/index' });
}

/** 加入时用的名字：记住的昵称，否则随机一个“矿工1234”。 */
function myNick() {
  let nick = online.nick();
  if (!nick) {
    nick = t('fmt.randomNick', Math.floor(1000 + Math.random() * 9000));
    online.saveNick(nick);
  }
  return nick;
}

Page({
  data: {
    t: {},
    room: null,
    seats: [],
    empty: [],
    mySeat: -1,
    isHost: false,
    countLabel: '',
  },

  onLoad(options) {
    this.applyLang();
    if (!online.available()) {
      toast(t('ui.onlineOff'));
      setTimeout(goHome, 1200);
      return;
    }
    const req =
      options && options.code
        ? online.call('join', { code: options.code, name: myNick() })
        : online.call('sync', { roomId: options && options.roomId });
    this.pending = req.then((r) => this.applyRoom(r)).catch((e) => this.fail(e));
  },

  onShow() {
    if (this.data.t.lang !== i18n.getLang()) this.applyLang();
  },

  onUnload() {
    this.stopWatch();
  },

  applyLang() {
    this.setData({ t: i18n.ui() });
    wx.setNavigationBarTitle && wx.setNavigationBarTitle({ title: t('appName') });
    if (this.data.room) this.renderRoom(this.data.room);
  },

  fail(e) {
    toast(i18n.errText(e));
    if (e && (e.code === 'noRoom' || e.code === 'notMember')) {
      online.forgetRoom();
      setTimeout(goHome, 1200);
    }
  },

  /** 收到云函数返回的房间视图。 */
  applyRoom(r) {
    this.roomId = r.roomId;
    this.setData({ mySeat: r.mySeat, isHost: r.isHost });
    const status = r.room.status;
    if (status === 'closed') {
      online.forgetRoom();
      toast(t('ui.roomClosed'));
      setTimeout(goHome, 1200);
      return;
    }
    online.rememberRoom(r.roomId);
    if (status === 'playing' || status === 'over') {
      this.stopWatch();
      wx.redirectTo({ url: `/pages/game/game?room=${r.roomId}` });
      return;
    }
    this.renderRoom(r.room);
    if (!this.watcher) {
      this.watcher = online.watchRoom(r.roomId, () => this.refresh());
    }
    this.watcher.seen(r.room.version);
  },

  renderRoom(room) {
    const seats = room.seats.map((s, i) => ({
      index: i,
      name: s.name,
      isAI: s.isAI,
      host: !!s.host,
      isMe: i === this.data.mySeat,
      initial: avatarChar(s.name),
      hue: i % 4,
      canRemove: this.data.isHost && i !== this.data.mySeat,
    }));
    this.setData({
      room,
      seats,
      empty: Array.from({ length: Math.max(0, room.maxPlayers - seats.length) }, (_, i) => i),
      countLabel: t('fmt.seatCount', seats.length, room.maxPlayers),
    });
  },

  refresh() {
    if (!this.roomId) return Promise.resolve();
    this.pending = online
      .call('sync', { roomId: this.roomId })
      .then((r) => this.applyRoom(r))
      .catch((e) => this.fail(e));
    return this.pending;
  },

  stopWatch() {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  },

  /** 房间操作：防止连点，结果统一回到 applyRoom。 */
  run(action, data) {
    if (this.busy) return this.pending;
    this.busy = true;
    this.pending = online
      .call(action, Object.assign({ roomId: this.roomId }, data))
      .then((r) => this.applyRoom(r))
      .catch((e) => this.fail(e))
      .then(() => {
        this.busy = false;
      });
    return this.pending;
  },

  onAddBot() {
    const used = this.data.seats.map((s) => s.name);
    const name = i18n.dict().botNames.find((n) => used.indexOf(n) < 0);
    return this.run('addBot', { name });
  },

  onRemove(e) {
    return this.run('removeSeat', { seat: Number(e.currentTarget.dataset.seat) });
  },

  onStart() {
    if (this.data.seats.length < 2) {
      toast(t('ui.needTwo'));
      return Promise.resolve();
    }
    return this.run('start');
  },

  onLeave() {
    this.stopWatch();
    const done = () => {
      online.forgetRoom();
      goHome();
    };
    this.pending = online.call('leave', { roomId: this.roomId }).then(done, done);
    return this.pending;
  },

  onShareAppMessage() {
    const code = this.data.room ? this.data.room.code : '';
    return { title: t('fmt.shareRoom', code), path: `/pages/lobby/lobby?code=${code}` };
  },
});
