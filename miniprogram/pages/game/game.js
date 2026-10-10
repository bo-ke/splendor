const { Game, MAX_RESERVED } = require('../../engine/game');
const ai = require('../../engine/ai');
const i18n = require('../../utils/i18n');
const storage = require('../../utils/storage');
const {
  avatarChar,
  buildView,
  cardView,
  evaluatePicks,
  paymentPlan,
  togglePick,
} = require('../../utils/view');

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
    pickEval: { ok: false, hint: '' },
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
    if (this.game) this.schedule();
  },

  onHide() {
    this.clearTimer();
  },

  onUnload() {
    this.clearTimer();
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
    if (this.data.showLog) this.onShowLog();
    this.setData({ sheet: null, playerSheet: null });
  },

  onToggleLang() {
    i18n.setLang(i18n.getLang() === 'zh' ? 'en' : 'zh');
    this.applyLang();
  },

  handoffView(name) {
    return {
      name,
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
    this.setData({ picks: {}, sheet: null, result: null, handoff: null, showLog: false });
    this.render();
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

  render() {
    const view = buildView(this.game, this.viewer(), {
      picks: this.data.picks,
      locked: this.locked(),
    });
    this.setData({ view, pickEval: evaluatePicks(this.game, this.data.picks) });
  },

  persist() {
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
    if (g.isOver) {
      if (!this.data.result) this.timer = setTimeout(() => this.showResult(), 600);
      return;
    }
    const cur = g.current;
    if (cur.isAI) {
      this.timer = setTimeout(() => {
        this.timer = null;
        ai.step(g);
        this.persist();
        this.render();
        this.schedule();
      }, AI_DELAY);
      return;
    }
    if (this.locked()) {
      this.setData({ handoff: this.handoffView(cur.name) });
    }
  },

  /** 执行一次真人动作，统一处理非法动作提示、存档与重绘。 */
  act(fn) {
    try {
      fn();
    } catch (e) {
      if (e && e.name === 'IllegalMove') {
        toast(i18n.errText(e));
        return false;
      }
      throw e;
    }
    this.setData({ picks: {}, sheet: null });
    this.persist();
    this.render();
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
    this.setData({ picks: res.picks });
    this.render();
  },

  onClearPicks() {
    this.setData({ picks: {} });
    this.render();
  },

  onConfirmTake() {
    const ev = evaluatePicks(this.game, this.data.picks);
    if (!ev.ok) {
      if (ev.hint) toast(ev.hint);
      return;
    }
    this.act(() => {
      if (ev.kind === 'two') this.game.takeTwo(ev.colors[0]);
      else this.game.takeThree(ev.colors);
    });
  },

  onTapCard(e) {
    const { id, source } = e.currentTarget.dataset;
    if (!id) return;
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
        note: g.state.tokens.gold > 0 ? t('fmt.reserveGold') : t('fmt.reserveNoGold'),
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
    this.act(() => this.game.buy(s.id));
  },

  onSheetReserve() {
    const s = this.data.sheet;
    if (!s || !s.canReserve) return;
    this.act(() => {
      if (s.kind === 'deck') this.game.reserveFromDeck(s.tier);
      else this.game.reserve(s.id);
    });
  },

  onCloseSheet() {
    this.setData({ sheet: null });
  },

  onTapPlayer(e) {
    const i = Number(e.currentTarget.dataset.index);
    const p = this.data.view.players[i];
    if (p) {
      this.setData({ playerSheet: Object.assign({}, p, { sub: t('fmt.playerSub', p.isAI, p.cardCount, p.tokenTotal) }) });
    }
  },

  onClosePlayer() {
    this.setData({ playerSheet: null });
  },

  onTapMyToken(e) {
    const v = this.data.view;
    if (!v.myTurn || v.phase !== 'discard') return;
    const color = e.currentTarget.dataset.color;
    this.act(() => this.game.discard(color));
  },

  onPass() {
    if (!this.ensureMyTurn()) return;
    this.act(() => this.game.pass());
  },

  onHandoffReady() {
    this.holder = this.game.currentIndex;
    this.setData({ handoff: null, picks: {} });
    this.render();
  },

  onShowLog() {
    const logs = this.game.state.log
      .slice()
      .reverse()
      .map((l, i) => ({ key: i, round: l.round, text: i18n.logText(l) }));
    this.setData({ showLog: true, logs });
  },

  onCloseLog() {
    this.setData({ showLog: false });
  },

  showResult() {
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
    const rounds = g.state.round - 1;
    this.setData({
      result: { rank, rounds, title: t('fmt.resultTitle', rank[0].name), sub: t('fmt.resultRounds', rounds) },
    });
  },

  onCloseResult() {
    this.setData({ result: null });
  },

  onRematch() {
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

  noop() {},
});
