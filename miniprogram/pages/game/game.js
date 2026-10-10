const { Game, MAX_RESERVED, points } = require('../../engine/game');
const ai = require('../../engine/ai');
const i18n = require('../../utils/i18n');
const online = require('../../utils/online');
const storage = require('../../utils/storage');
const {
  avatarChar,
  buildView,
  cardView,
  discardList,
  evaluatePicks,
  logIcons,
  paymentPlan,
  toggleDiscard,
  togglePick,
} = require('../../utils/view');

/** 轻触反馈；不支持的机型静默忽略。 */
function buzz() {
  try {
    if (wx.vibrateShort) wx.vibrateShort({ type: 'light' });
  } catch (e) {
    // ignore
  }
}

const AI_DELAY = 900; // 电脑每步的停顿（毫秒），方便看清
const TIER_LABELS = { 1: 'Ⅰ', 2: 'Ⅱ', 3: 'Ⅲ' };
const t = i18n.t;

function toast(title) {
  wx.showToast({ title, icon: 'none' });
}

Page({
  data: {
    view: null,
    picks: {},
    discards: {}, // 弃牌阶段已选中待弃回的矿石 {color: n}
    pickEval: { ok: false, hint: '' },
    gain: null, // 分数上涨时在皇冠旁飘一个 +N
    celebrate: null, // 贵族拜访“我”时的庆祝卡片
    syncing: false, // 联机提交中
    sheet: null, // 卡牌/牌堆操作面板
    playerSheet: null, // 对手详情
    handoff: null, // 同屏多人：传手机遮罩
    showLog: false,
    logs: [],
    result: null,
    tierLabels: TIER_LABELS,
    t: {}, // 当前语言的静态文案
  },

  // ------------------------------------------------------------ 生命周期
  onLoad(options) {
    this.applyLang();
    if (options && options.room) {
      this.startOnline(options.room);
      return;
    }
    let game = null;
    if (options && options.resume) {
      const state = storage.loadGame();
      if (state) game = new Game(state);
    } else {
      const app = getApp();
      const seats = app.globalData.pendingSeats;
      app.globalData.pendingSeats = null;
      if (seats) game = Game.create(seats);
    }
    if (!game) {
      toast(t('fmt.noSave'));
      setTimeout(() => wx.reLaunch({ url: '/pages/index/index' }), 800);
      return;
    }
    this.setupGame(game);
  },

  onShow() {
    // 语言可能在首页被切换过
    if (this.data.t.lang !== i18n.getLang()) this.applyLang();
    if (this.roomId && this.game) this.syncOnline(); // 从后台回来先追上最新局面
    else if (this.game) this.schedule();
  },

  onHide() {
    this.clearTimer();
  },

  onUnload() {
    this.clearTimer();
    if (this.celebrateTimer) clearTimeout(this.celebrateTimer);
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  },

  onShareAppMessage() {
    return { title: t('fmt.share'), path: '/pages/index/index' };
  },

  /** 刷新当前语言的文案；对局记录、弹层都会跟着切换。 */
  applyLang() {
    this.setData({ t: i18n.ui() });
    wx.setNavigationBarTitle && wx.setNavigationBarTitle({ title: t('appName') });
    if (!this.game) return;
    this.render();
    if (this.data.handoff) this.setData({ handoff: this.handoffView(this.game.current.name) });
    if (this.data.result) this.showResult();
    this.refreshOverlays(); // 打开着的面板 / 记录按新语言重算
  },

  onToggleLang() {
    i18n.setLang(i18n.getLang() === 'zh' ? 'en' : 'zh');
    this.applyLang();
  },

  handoffView(name) {
    const index = this.game ? this.game.currentIndex : 0;
    return {
      name,
      initial: avatarChar(name),
      hue: index % 4,
      title: t('fmt.handoffTitle', name),
      sub: t('fmt.handoffSub', name),
      btn: t('fmt.handoffBtn', name),
    };
  },

  // ---------------------------------------------------------------- 核心
  setupGame(game) {
    this.game = game;
    const humans = game.state.players.map((p, i) => (p.isAI ? -1 : i)).filter((i) => i >= 0);
    this.humans = humans;
    // 当前“手持手机”的真人；单人局恒为那位真人
    this.holder = humans.length === 1 ? humans[0] : null;
    this.resultShown = false;
    this.render({ picks: {}, sheet: null, playerSheet: null, result: null, handoff: null, showLog: false, logs: [] });
    this.schedule();
  },

  /** 我方面板展示谁：手持手机的真人 > 第一个真人 > 当前玩家（全电脑观战）。 */
  viewer() {
    if (this.holder !== null) return this.holder;
    return this.humans.length ? this.humans[0] : this.game.currentIndex;
  },

  /** 同屏多人时，轮到的真人确认接过手机前锁住操作。 */
  locked() {
    const g = this.game;
    return !g.current.isAI && this.humans.length > 1 && this.holder !== g.currentIndex;
  },

  /**
   * 重算视图并一次性 setData（setData 跨线程序列化，是小程序里最贵的操作，尽量合并）。
   * @param {Object} [patch] 要一起写入的其他数据；含 picks 时按新的选择渲染
   */
  render(patch) {
    const data = Object.assign({}, patch);
    const picks = data.picks || this.data.picks;
    const discards = data.discards || (this.game.state.phase === 'discard' ? this.data.discards : {});
    if (this.game.state.phase !== 'discard') data.discards = {};
    data.view = buildView(this.game, this.viewer(), {
      picks,
      discards,
      locked: this.locked(),
      // 同屏多人刚读档时不知道手机在谁手上，预留卡（可能含盲抽）只露卡背
      hideReserved: this.humans.length > 1 && this.holder === null,
    });
    data.pickEval = evaluatePicks(this.game, picks);
    // 操作栏里用图标显示已选的矿石（拿 2 份同种时显示两枚）
    data.pickEval.icons = Object.keys(picks).reduce(
      (list, c) => list.concat(Array.from({ length: picks[c] }, () => ({ key: list.length, kind: 'ore', color: c }))),
      []
    );
    data.pickEval.icons.forEach((icon, i) => (icon.key = i));
    this.feedback(data);
    this.setData(data);
  },

  /**
   * 与上一次渲染比较“我”的变化：轮到我时轻震；得分时飘 +N；贵族来访时弹庆祝卡片。
   * 同屏多人换人时视角变了，只重置基准、不提示。
   */
  feedback(data) {
    const viewer = this.viewer();
    const me = this.game.state.players[viewer];
    const now = { viewer, points: points(me), nobles: me.nobles.length, myTurn: data.view.myTurn };
    const prev = this.prevMine;
    this.prevMine = now;
    if (!prev || prev.viewer !== viewer) return;
    if (now.myTurn && !prev.myTurn) buzz();
    if (now.points > prev.points) {
      data.gain = { key: `${this.game.state.turn}-${now.points}`, n: now.points - prev.points };
    }
    if (now.nobles > prev.nobles) {
      const noble = me.nobles[me.nobles.length - 1];
      const title = i18n.dict().noble[noble.id] || noble.name;
      data.celebrate = {
        noble: { id: noble.id, points: noble.points, req: [] },
        text: t('fmt.nobleVisit', title),
        points: noble.points,
      };
      buzz();
      if (this.celebrateTimer) clearTimeout(this.celebrateTimer);
      this.celebrateTimer = setTimeout(() => {
        this.celebrateTimer = null;
        this.setData({ celebrate: null });
      }, 2400);
    }
  },

  onCloseCelebrate() {
    this.setData({ celebrate: null });
  },

  /** 电脑走完一步后，把仍开着的弹层刷新成最新局面，避免显示过期内容。 */
  refreshOverlays() {
    const { sheet, playerSheet, showLog } = this.data;
    if (sheet) {
      const viewer = this.game.state.players[this.viewer()];
      const still =
        sheet.kind === 'card' &&
        (sheet.source === 'reserved' ? viewer.reserved.some((c) => c.id === sheet.id) : this.game.boardCard(sheet.id));
      if (still) this.openCardSheet(sheet.id, sheet.source);
      else this.setData({ sheet: null });
    }
    if (playerSheet) this.openPlayerSheet(playerSheet.index);
    if (showLog) this.onShowLog();
  },

  persist() {
    if (this.roomId) return; // 联机对局保存在云端
    if (this.game.isOver) storage.clearGame();
    else storage.saveGame(this.game.state);
  },

  clearTimer() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  },

  /** 根据局面决定下一步：结算 / 电脑行动 / 换人遮罩 / 等待真人操作。 */
  schedule() {
    this.clearTimer();
    const g = this.game;
    if (this.roomId) {
      // 联机：电脑在云端走，没有交接遮罩；只需在结束时弹一次结算
      if (g.isOver && !this.resultShown) this.timer = setTimeout(() => this.showResult(), 600);
      return;
    }
    if (g.isOver) {
      // 只自动弹一次结算；用户点“看看牌桌”关掉后，切后台再回来不再弹
      if (!this.resultShown) this.timer = setTimeout(() => this.showResult(), 600);
      return;
    }
    const cur = g.current;
    if (cur.isAI) {
      this.timer = setTimeout(() => {
        this.timer = null;
        ai.step(g);
        this.persist();
        this.render();
        this.refreshOverlays();
        this.schedule();
      }, AI_DELAY);
      return;
    }
    if (this.locked()) {
      this.setData({ handoff: this.handoffView(cur.name) });
    }
  },

  /** 执行一次真人动作（move 见 Game.apply），统一处理非法动作提示、存档与重绘。 */
  act(move) {
    if (this.roomId) return this.sendMove(move);
    try {
      this.game.apply(move);
    } catch (e) {
      if (e && e.name === 'IllegalMove') {
        toast(i18n.errText(e));
        return false;
      }
      throw e;
    }
    this.persist();
    this.render({ picks: {}, sheet: null, discards: {} });
    this.schedule();
    return true;
  },

  ensureMyTurn() {
    const v = this.data.view;
    if (v && v.myTurn) return true;
    if (v && v.phase !== 'over') {
      toast(t('fmt.notYourTurn', v.currentName));
    }
    return false;
  },

  // ------------------------------------------------------------- 交互
  onTapBank(e) {
    if (!this.ensureMyTurn()) return;
    if (this.data.view.phase === 'discard') {
      toast(t('fmt.discardFirst'));
      return;
    }
    const res = togglePick(this.game, this.data.picks, e.currentTarget.dataset.color);
    if (res.error) {
      toast(res.error);
      return;
    }
    this.render({ picks: res.picks });
  },

  onClearPicks() {
    this.render({ picks: {} });
  },

  onConfirmTake() {
    const ev = evaluatePicks(this.game, this.data.picks);
    if (!ev.ok) {
      if (ev.hint) toast(ev.hint);
      return;
    }
    return this.act(ev.kind === 'two' ? { type: 'takeTwo', color: ev.colors[0] } : { type: 'takeThree', colors: ev.colors });
  },

  onTapCard(e) {
    const { id, source } = e.currentTarget.dataset;
    if (id) this.openCardSheet(id, source);
  },

  /** 打开（或按最新局面重算）某张卡的购买 / 预留面板。 */
  openCardSheet(id, source) {
    const g = this.game;
    const viewer = g.state.players[this.viewer()];
    const raw = source === 'reserved' ? viewer.reserved.find((c) => c.id === id) : g.boardCard(id);
    if (!raw) return;

    const myTurn = this.data.view.myTurn && this.data.view.phase === 'play';
    const card = cardView(raw, viewer);
    // 每种矿石怎么付：加成 / 手中 / 黄金 / 仍缺
    const plan = paymentPlan(viewer, raw);
    let tip = '';
    if (card.affordable) {
      tip = card.goldNeeded ? t('fmt.affordableGold', card.goldNeeded) : t('fmt.affordable');
    } else {
      tip = t('fmt.short', plan.short);
    }
    const L = i18n.dict();
    const canReserve = source === 'board' && viewer.reserved.length < MAX_RESERVED;
    this.setData({
      sheet: {
        kind: 'card',
        id,
        source,
        card,
        tip,
        ok: card.affordable,
        plan: plan.rows,
        title: t('fmt.cardTitle', L.ore[raw.bonus], L.tier[raw.tier]),
        desc: t('fmt.cardDesc', L.color[raw.bonus], raw.points),
        showBuy: myTurn,
        canBuy: myTurn && card.affordable,
        showReserve: myTurn && source === 'board',
        canReserve: myTurn && canReserve,
        // 预留不了时说明原因（预留区已满），否则说明能否顺带拿到黄金
        note:
          source === 'board' && viewer.reserved.length >= MAX_RESERVED
            ? t('fmt.reserveFull', MAX_RESERVED)
            : g.state.tokens.gold > 0
              ? t('fmt.reserveGold')
              : t('fmt.reserveNoGold'),
      },
    });
  },

  onTapDeck(e) {
    if (!this.ensureMyTurn()) return;
    if (this.data.view.phase !== 'play') return;
    const tier = Number(e.currentTarget.dataset.tier);
    const left = this.game.state.decks[tier - 1].length;
    if (!left) {
      toast(t('fmt.deckEmpty'));
      return;
    }
    this.setData({
      sheet: {
        kind: 'deck',
        tier,
        tierLabel: TIER_LABELS[tier],
        left,
        title: t('fmt.deckTitle', i18n.dict().tier[tier], left),
        desc: t('fmt.deckDesc'),
        tip: this.game.canReserve() ? '' : t('fmt.reserveMax', MAX_RESERVED),
        showBuy: false,
        showReserve: true,
        canReserve: this.game.canReserve(),
        note: this.game.state.tokens.gold > 0 ? t('fmt.reserveGold') : t('fmt.reserveNoGold'),
      },
    });
  },

  onSheetBuy() {
    const s = this.data.sheet;
    if (!s || !s.canBuy) return;
    return this.act({ type: 'buy', id: s.id });
  },

  onSheetReserve() {
    const s = this.data.sheet;
    if (!s || !s.canReserve) return;
    return this.act(s.kind === 'deck' ? { type: 'reserveDeck', tier: s.tier } : { type: 'reserve', id: s.id });
  },

  onCloseSheet() {
    this.setData({ sheet: null });
  },

  onTapPlayer(e) {
    this.openPlayerSheet(Number(e.currentTarget.dataset.index));
  },

  openPlayerSheet(i) {
    const p = this.data.view.players[i];
    if (p) {
      this.setData({ playerSheet: Object.assign({}, p, { sub: t('fmt.playerSub', p.isAI, p.cardCount, p.tokenTotal) }) });
    }
  },

  onClosePlayer() {
    this.setData({ playerSheet: null });
  },

  /** 弃牌阶段：点自己的矿石先选中（再点取消），选够数量后统一确认，可以反悔。 */
  onTapMyToken(e) {
    const v = this.data.view;
    if (!v.myTurn || v.phase !== 'discard') return;
    this.render({ discards: toggleDiscard(this.game, this.data.discards, e.currentTarget.dataset.color) });
  },

  onClearDiscards() {
    this.render({ discards: {} });
  },

  onConfirmDiscard() {
    if (!this.data.view.discardReady) {
      toast(this.data.view.discardLabel);
      return Promise.resolve();
    }
    return this.act({ type: 'discardMany', colors: discardList(this.data.discards) });
  },

  onPass() {
    if (!this.ensureMyTurn()) return;
    return this.act({ type: 'pass' });
  },

  onHandoffReady() {
    this.holder = this.game.currentIndex;
    this.render({ handoff: null, picks: {} });
  },

  onShowLog() {
    const logs = this.game.state.log
      .slice()
      .reverse()
      .map((l, i) => ({ key: i, round: l.round, text: i18n.logText(l), icons: logIcons(l) }));
    this.setData({ showLog: true, logs });
  },

  onCloseLog() {
    this.setData({ showLog: false });
  },

  showResult() {
    this.resultShown = true;
    const g = this.game;
    const rank = g.ranking().map((r, i) => {
      const p = g.state.players[r.index];
      return {
        place: i + 1,
        name: r.name,
        points: r.points,
        cards: r.cards,
        nobles: p.nobles.length,
        isAI: p.isAI,
        initial: avatarChar(r.name),
        hue: r.index % 4,
        detail: t('fmt.rankDetail', r.cards, p.nobles.length),
      };
    });
    const rounds = g.state.round;
    this.setData({
      result: {
        rank,
        rounds,
        title: t('fmt.resultTitle', rank[0].name),
        sub: t('fmt.resultRounds', rounds),
        canRematch: !this.roomId || this.isHost, // 联机时只有房主能再开一局
      },
    });
  },

  onCloseResult() {
    this.setData({ result: null });
  },

  onRematch() {
    if (this.roomId) {
      if (!this.isHost) {
        toast(t('ui.waitRematch'));
        return Promise.resolve();
      }
      this.pending = online
        .call('rematch', { roomId: this.roomId })
        .then((r) => this.applyOnline(r))
        .catch((e) => this.onlineFail(e));
      return this.pending;
    }
    const seats = this.game.state.players.map((p) => ({ name: p.name, isAI: p.isAI }));
    storage.clearGame();
    this.setupGame(Game.create(seats));
  },

  onHome() {
    this.clearTimer();
    const pages = getCurrentPages();
    if (pages.length > 1) wx.navigateBack();
    else wx.reLaunch({ url: '/pages/index/index' });
  },

  // ------------------------------------------------------------- 联机
  startOnline(roomId) {
    this.roomId = roomId;
    this.version = 0;
    if (!online.available()) {
      toast(t('ui.onlineOff'));
      setTimeout(() => wx.reLaunch({ url: '/pages/index/index' }), 1200);
      return;
    }
    online.rememberRoom(roomId);
    this.syncOnline();
  },

  syncOnline() {
    this.pending = online
      .call('sync', { roomId: this.roomId })
      .then((r) => this.applyOnline(r))
      .catch((e) => this.onlineFail(e));
    return this.pending;
  },

  /** 应用云函数返回的房间视图（只含自己可见的信息）。 */
  applyOnline(r, patch) {
    if (r.room.version < this.version) return; // 晚到的旧结果
    this.version = r.room.version;
    this.isHost = r.isHost;
    if (r.room.status === 'closed' || !r.state) {
      if (r.room.status === 'waiting') {
        wx.redirectTo({ url: `/pages/lobby/lobby?roomId=${this.roomId}` });
        return;
      }
      online.forgetRoom();
      toast(t('ui.roomClosed'));
      setTimeout(() => wx.reLaunch({ url: '/pages/index/index' }), 1200);
      return;
    }
    const restarted = !this.game || (this.game.isOver && r.state.phase !== 'over');
    this.game = new Game(r.state);
    this.humans = [r.mySeat];
    this.holder = r.mySeat;
    const data = Object.assign({}, patch);
    if (restarted) {
      this.resultShown = false;
      Object.assign(data, { result: null, sheet: null, playerSheet: null, picks: {} });
    }
    this.render(data);
    this.refreshOverlays();
    if (!this.watcher) {
      this.watcher = online.watchRoom(this.roomId, (v) => {
        if (v > this.version && !this.busy) this.syncOnline();
      });
    }
    this.watcher.seen(this.version);
    this.schedule();
  },

  /** 联机出牌：云端校验并执行（含电脑回合），返回新局面。 */
  sendMove(move) {
    if (this.busy) return this.pending;
    this.busy = true;
    this.setData({ syncing: true });
    this.pending = online
      .call('move', { roomId: this.roomId, version: this.version, move })
      .then((r) => this.applyOnline(r, { picks: {}, sheet: null, discards: {}, syncing: false }))
      .catch((e) => {
        toast(i18n.errText(e));
        this.busy = false;
        if (e && (e.code === 'stale' || e.code === 'notYourTurn')) return this.syncOnline();
        return null;
      })
      .then(() => {
        this.busy = false;
        if (this.data.syncing) this.setData({ syncing: false });
      });
    return this.pending;
  },

  onlineFail(e) {
    toast(i18n.errText(e));
    if (e && (e.code === 'noRoom' || e.code === 'notMember')) {
      online.forgetRoom();
      setTimeout(() => wx.reLaunch({ url: '/pages/index/index' }), 1200);
    }
  },

  noop() {},
});
