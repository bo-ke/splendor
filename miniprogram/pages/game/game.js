const { COLORS, COLOR_NAMES, Game, MAX_RESERVED, bonus } = require('../../engine/game');
const ai = require('../../engine/ai');
const storage = require('../../utils/storage');
const { buildView, cardView, evaluatePicks, togglePick } = require('../../utils/view');

const AI_DELAY = 900; // 电脑每步的停顿（毫秒），方便看清
const TIER_LABELS = { 1: 'Ⅰ', 2: 'Ⅱ', 3: 'Ⅲ' };

Page({
  data: {
    view: null,
    picks: {},
    pickEval: { ok: false, hint: '' },
    sheet: null, // 卡牌/牌堆操作面板
    handoff: null, // 同屏多人：传手机遮罩
    showLog: false,
    logs: [],
    result: null,
    tierLabels: TIER_LABELS,
  },

  // ------------------------------------------------------------ 生命周期
  onLoad(options) {
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
      wx.showToast({ title: '没有可继续的对局', icon: 'none' });
      setTimeout(() => wx.reLaunch({ url: '/pages/index/index' }), 800);
      return;
    }
    this.setupGame(game);
  },

  onShow() {
    if (this.game) this.schedule();
  },

  onHide() {
    this.clearTimer();
  },

  onUnload() {
    this.clearTimer();
  },

  onShareAppMessage() {
    return { title: '来一局璀璨宝石吧！', path: '/pages/index/index' };
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
      this.setData({ handoff: { name: cur.name } });
    }
  },

  /** 执行一次真人动作，统一处理非法动作提示、存档与重绘。 */
  act(fn) {
    try {
      fn();
    } catch (e) {
      if (e && e.name === 'IllegalMove') {
        wx.showToast({ title: e.message, icon: 'none' });
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
      wx.showToast({ title: `现在是 ${v.currentName} 的回合`, icon: 'none' });
    }
    return false;
  },

  // ------------------------------------------------------------- 交互
  onTapBank(e) {
    if (!this.ensureMyTurn()) return;
    if (this.data.view.phase === 'discard') {
      wx.showToast({ title: '请先点击你自己的代币弃回', icon: 'none' });
      return;
    }
    const res = togglePick(this.game, this.data.picks, e.currentTarget.dataset.color);
    if (res.error) {
      wx.showToast({ title: res.error, icon: 'none' });
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
      if (ev.hint) wx.showToast({ title: ev.hint, icon: 'none' });
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
    // 还差哪些宝石（扣除加成与手中代币后）
    const short = COLORS.map((c) => ({
      color: c,
      name: COLOR_NAMES[c],
      n: Math.max(0, (raw.cost[c] || 0) - bonus(viewer, c) - viewer.tokens[c]),
    })).filter((x) => x.n > 0);

    let tip = '';
    if (card.affordable) {
      tip = card.goldNeeded ? `买得起，需动用 ${card.goldNeeded} 枚黄金` : '买得起';
    } else {
      tip = `还差 ${short.map((x) => x.name + x.n).join(' ')}（黄金 ${viewer.tokens.gold} 枚可抵）`;
    }
    const canReserve = source === 'board' && viewer.reserved.length < MAX_RESERVED;
    this.setData({
      sheet: {
        kind: 'card',
        id,
        source,
        card,
        tip,
        desc: `提供永久${COLOR_NAMES[raw.bonus]}宝石${raw.points ? ` · ${raw.points} 分` : ''}`,
        showBuy: myTurn,
        canBuy: myTurn && card.affordable,
        showReserve: myTurn && source === 'board',
        canReserve: myTurn && canReserve,
        goldGain: g.state.tokens.gold > 0,
      },
    });
  },

  onTapDeck(e) {
    if (!this.ensureMyTurn()) return;
    if (this.data.view.phase !== 'play') return;
    const tier = Number(e.currentTarget.dataset.tier);
    const left = this.game.state.decks[tier - 1].length;
    if (!left) {
      wx.showToast({ title: '这层牌堆已经空了', icon: 'none' });
      return;
    }
    this.setData({
      sheet: {
        kind: 'deck',
        tier,
        tierLabel: TIER_LABELS[tier],
        left,
        desc: `从第 ${tier} 层牌堆顶盲抽一张预留`,
        tip: this.game.canReserve() ? '' : `最多预留 ${MAX_RESERVED} 张`,
        showBuy: false,
        showReserve: true,
        canReserve: this.game.canReserve(),
        goldGain: this.game.state.tokens.gold > 0,
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
      .map((l, i) => ({ key: i, round: l.round, text: l.text }));
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
      };
    });
    this.setData({ result: { rank, rounds: g.state.round - 1 } });
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
