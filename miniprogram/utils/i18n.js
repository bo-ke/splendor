/**
 * 中英双语。引擎只产出「事件代码 + 参数」，这里负责翻译成当前语言。
 *
 * - t('fmt.round', 3)        → “第 3 轮” / “Round 3”
 * - logText(entry)           → 翻译一条对局记录
 * - errText(err)             → 翻译 IllegalMove
 * - ui()                     → 当前语言的静态文案（可直接 setData 给 WXML）
 */

const LANG_KEY = 'ore.lang';
const LANGS = ['zh', 'en'];

const DICT = {
  zh: {
    appName: '矿石商人',
    appNameEn: 'Ore Merchant',
    color: { white: '白', blue: '蓝', green: '绿', red: '红', black: '黑', gold: '金' },
    ore: { white: '石英', blue: '青金石', green: '孔雀石', red: '朱砂', black: '黑曜石', gold: '黄金' },
    tier: { 1: '矿脉', 2: '商路', 3: '城邦' },
    noble: {
      n01: '银岩侯爵',
      n02: '霜湖女伯爵',
      n03: '青港公爵',
      n04: '翠谷领主',
      n05: '赤焰女公爵',
      n06: '白塔主教',
      n07: '海关总督',
      n08: '林地女王',
      n09: '红崖伯爵',
      n10: '黑曜亲王',
    },
    botNames: ['电脑·甲', '电脑·乙', '电脑·丙', '电脑·丁'],
    me: '我',
    sep: '、',
    ui: {
      subtitle: '开采矿脉 · 经营商路 · 赢得贵族青睐',
      resume: '继续上局',
      resumeSub: '对局已自动保存',
      playerCount: '玩家人数',
      people: '人',
      seats: '座位 · 按出手顺序',
      human: '真人',
      bot: '电脑',
      namePh: '输入名字',
      hotseatTip: '多名真人时为同屏轮流模式，轮到谁就把手机交给谁。',
      start: '开始新游戏',
      howTo: '玩法说明',
      gotIt: '知道了',
      lastRound: '最后一轮',
      logMore: '记录 ›',
      wild: '万能',
      reserve: '预留',
      nobles: '贵族',
      gameOver: '对局已结束',
      results: '查看结果',
      clear: '清空',
      take: '拿取',
      yourTurn: '你的回合',
      turnHint: '点矿石拿取 · 点卡牌购买或预留',
      pass: '跳过',
      colCost: '成本',
      colBonus: '加成',
      colHand: '手中',
      colGold: '黄金',
      colShort: '缺',
      cancel: '取消',
      close: '关闭',
      buy: '购买',
      none: '无',
      logTitle: '对局记录',
      rematch: '再来一局',
      viewTable: '看看牌桌',
      home: '返回首页',
      language: 'EN',
      canBuy: '可买',
      online: '好友联机',
      local: '本机对局',
      nick: '你的昵称',
      nickPh: '朋友会看到这个名字',
      createRoom: '创建房间',
      join: '加入',
      codePh: '输入 6 位房间号',
      backToRoom: '回到联机房间',
      onlineOff: '联机需要开通微信云开发（见 README）',
      roomCode: '房间号',
      invite: '邀请好友',
      addBot: '添加电脑',
      startGame: '开始对局',
      waitingHost: '等待房主开始…',
      leaveRoom: '离开房间',
      hostTag: '房主',
      youTag: '你',
      remove: '移出',
      needTwo: '至少 2 人才能开始',
      waitRematch: '等待房主再开一局',
      emptySeat: '空位',
      roomClosed: '房间已关闭',
      credit: '玩法灵感来自经典桌游《璀璨宝石》（Splendor）',
      disclaimer: '本作为非官方爱好者作品，与原作者及出版方无关',
    },
    rules: [
      ['目标', '率先达到 15 声望。有人达到后打完本轮，分最高者胜；平分时发展卡较少者胜。'],
      ['五种矿石 + 黄金', '石英（白）· 青金石（蓝）· 孔雀石（绿）· 朱砂（红）· 黑曜石（黑），黄金可当任意矿石使用。'],
      [
        '每回合选一个动作',
        '① 拿 3 份不同的矿石（桌上不足 3 种时拿满剩余种类）。\n② 拿 2 份同种矿石（该种剩余 ≥ 4 份时才可），再点一次已选的矿石即可切换。\n③ 预留 1 张发展卡（场上或盲抽牌堆），并获得 1 份黄金，最多预留 3 张。\n④ 购买 1 张场上或自己预留的发展卡。',
      ],
      ['发展卡', '三层牌分别是矿脉、商路与城邦。每张已购发展卡永久提供 1 份右上角的矿石，自动抵扣之后的购买成本。'],
      ['贵族', '回合结束时，若你的发展卡满足某位贵族的要求，他会自动来访，带来 3 声望（每回合至多一位）。'],
      ['持有上限', '回合结束时手中矿石（含黄金）不得超过 10 份，超出须自选弃回。'],
      ['操作提示', '买得起的卡会发出绿光；点卡牌可看到每种矿石怎么付、还差多少；点对手查看其详情。'],
    ],
    fmt: {
      round: (n) => `第 ${n} 轮`,
      playerN: (n) => `玩家${n}`,
      thinking: '思考中…',
      inTurn: '回合中',
      oppSub: (r, h) => `预留 ${r} · 持有 ${h}`,
      meDiscard: '请弃回多余矿石',
      meOver: '对局结束',
      meWaiting: '等待中',
      holding: (n) => `持有 ${n}/10`,
      botThinking: (name) => `${name} 正在思考`,
      waitingFor: (name) => `等待 ${name}`,
      discardBar: (n) => `持有超过上限，点击上方你的矿石弃回 ${n} 份`,
      pickTwo: (ore) => `拿 2 份${ore}`,
      pickOk: (list) => `拿 ${list}`,
      pickNeed: (list, k) => `已选 ${list}，还需 ${k} 种`,
      cardTitle: (ore, tier) => `${ore} · ${tier}`,
      cardDesc: (ore, pts) => `永久 +1 ${ore}${pts ? ` · ${pts} 声望` : ' · 无声望'}`,
      goldTag: (n) => `金×${n}`,
      affordable: '买得起',
      affordableGold: (n) => `买得起 · 需动用 ${n} 份黄金`,
      short: (n) => `还差 ${n} 份矿石`,
      reserveGold: '预留可额外获得 1 份黄金',
      reserveNoGold: '黄金已拿完，预留不再获得黄金',
      deckTitle: (tier, n) => `${tier}牌堆 · 剩 ${n} 张`,
      deckDesc: '从牌堆顶盲抽一张，放入你的预留区',
      reserveMax: (n) => `最多预留 ${n} 张`,
      playerSub: (isAI, cards, hold) => `${isAI ? '电脑' : '玩家'} · ${cards} 张发展卡 · 持有 ${hold}/10`,
      handoffTitle: (name) => `轮到 ${name}`,
      handoffSub: (name) => `请把手机交给 ${name}，其他人请回避`,
      handoffBtn: (name) => `我是 ${name}，开始`,
      resultTitle: (name) => `${name} 获胜`,
      resultRounds: (n) => `共 ${n} 轮`,
      rankDetail: (cards, nobles) => `${cards} 卡 · ${nobles} 贵族`,
      notYourTurn: (name) => `现在是 ${name} 的回合`,
      discardFirst: '请先点击你自己的矿石弃回',
      deckEmpty: '这层牌堆已经空了',
      noSave: '没有可继续的对局',
      dupNames: '玩家名不能重复',
      newGameTitle: '开始新游戏？',
      newGameBody: '当前未完成的对局将被覆盖。',
      newGameOk: '开新局', // showModal 按钮最多 4 个字符
      newGameCancel: '取消',
      share: '来一局《矿石商人》吧！',
      shareRoom: (code) => `来《矿石商人》房间 ${code}，一起开采矿石！`,
      seatCount: (n, max) => `${n}/${max} 人`,
      randomNick: (n) => `矿工${n}`,
      leaveConfirm: '离开后你的座位将由电脑接管。确定离开？',
      leaveOk: '离开',
    },
    log: {
      start: (p) => `开局：${p.n} 名玩家，先到 ${p.goal} 分者触发最后一轮`,
      take3: (p, L) => `${p.who} 拿了 ${p.colors.map((c) => L.color[c]).join(L.sep)}`,
      take2: (p, L) => `${p.who} 拿了 2 份${L.color[p.color]}`,
      reserve: (p, L) =>
        `${p.who} ${p.blind ? `从${L.tier[p.tier]}牌堆盲抽预留了一张卡` : `预留了一张${L.tier[p.tier]}卡`}${p.gold ? '，获得 1 份黄金' : ''}`,
      buy: (p, L) =>
        `${p.who} ${p.fromReserve ? '买下预留的' : '购买了'}${L.color[p.color]}卡${p.points ? `，+${p.points} 分` : ''}${p.gold ? `（用了 ${p.gold} 份黄金）` : ''}`,
      discard: (p) => `${p.who} 弃回矿石至 ${p.max} 份`,
      pass: (p) => `${p.who} 无动作可做，跳过`,
      noble: (p, L) => `${L.noble[p.noble] || p.noble} 拜访了 ${p.who}，+${p.points} 分`,
      reach: (p) => `${p.who} 达到 ${p.points} 分！本轮结束后游戏终止`,
      over: (p) => `游戏结束，${p.who} 以 ${p.points} 分获胜！`,
    },
    err: {
      over: '游戏已结束',
      discardFirst: '请先弃回多余的矿石',
      noDiscard: '现在不需要弃回矿石',
      distinct: '拿取的矿石必须各不相同',
      notOre: '只能拿矿石，黄金需通过预留获得',
      empty: (p, L) => `${L.color[p.color]}色矿石已经拿完了`,
      bankEmpty: '桌上已没有可拿的矿石',
      needDistinct: (p) => `请选择 ${p.n} 种不同的矿石`,
      needFour: '该种剩余 ≥ 4 份时才能拿 2 份同种',
      reserveMax: (p) => `最多预留 ${p.n} 张`,
      noCard: '场上没有这张卡',
      deckEmpty: (p, L) => `${L.tier[p.tier]}牌堆已空`,
      cardMissing: '场上和你的预留区都没有这张卡',
      cantAfford: '矿石不足，买不起',
      noToken: '你没有这种矿石',
      canMove: '还有可执行的动作，不能跳过',
      gold: '黄金只能通过预留卡牌获得',
      twoOnly: '拿 2 份同种时不能再拿其他矿石',
      maxThree: '最多拿 3 种不同的矿石',
      badMove: '无法识别的操作',
      noRoom: '房间不存在或已关闭',
      badCode: '请输入 6 位数字房间号',
      started: '对局已经开始，无法加入',
      full: '房间已满',
      notHost: '只有房主可以这样做',
      notMember: '你不在这个房间里',
      notPlaying: '对局未在进行',
      stale: '局面已更新，请再试一次',
      notYourTurn: '还没轮到你',
      tooFew: '至少 2 人才能开始',
      notOver: '对局还没结束',
      dupName: '名字重复了',
      badSeat: '无法移出这个座位',
      busy: '服务器繁忙，请稍后再试',
      network: '网络不太好，请稍后再试',
      server: '服务器出错了，请稍后再试',
      noAuth: '无法识别你的微信身份',
      badAction: '不支持的操作',
    },
  },

  en: {
    appName: 'Ore Merchant',
    appNameEn: 'Ore Merchant',
    color: { white: 'Quartz', blue: 'Lapis', green: 'Malachite', red: 'Cinnabar', black: 'Obsidian', gold: 'Gold' },
    ore: { white: 'Quartz', blue: 'Lapis Lazuli', green: 'Malachite', red: 'Cinnabar', black: 'Obsidian', gold: 'Gold' },
    tier: { 1: 'Mine', 2: 'Trade Route', 3: 'City' },
    noble: {
      n01: 'Marquis of Silverrock',
      n02: 'Countess of Frostmere',
      n03: 'Duke of Azure Harbor',
      n04: 'Lord of Verdant Vale',
      n05: 'Duchess of Emberfall',
      n06: 'Bishop of the White Tower',
      n07: 'Governor of the Customs',
      n08: 'Queen of the Woodlands',
      n09: 'Earl of Redcliff',
      n10: 'Prince of Obsidian',
    },
    botNames: ['Bot·A', 'Bot·B', 'Bot·C', 'Bot·D'],
    me: 'Me',
    sep: ', ',
    ui: {
      subtitle: 'Mine the veins · Run the roads · Win the nobles',
      resume: 'Continue',
      resumeSub: 'Your game was saved automatically',
      playerCount: 'Players',
      people: '',
      seats: 'Seats · in turn order',
      human: 'Human',
      bot: 'Bot',
      namePh: 'Name',
      hotseatTip: 'With several humans, pass the phone to whoever is up next.',
      start: 'New Game',
      howTo: 'How to Play',
      gotIt: 'Got it',
      lastRound: 'Final round',
      logMore: 'Log ›',
      wild: 'Wild',
      reserve: 'Reserve',
      nobles: 'Nobles',
      gameOver: 'Game over',
      results: 'Results',
      clear: 'Clear',
      take: 'Take',
      yourTurn: 'Your turn',
      turnHint: 'Tap ores to take · tap a card to buy or reserve',
      pass: 'Pass',
      colCost: 'Cost',
      colBonus: 'Cards',
      colHand: 'Hand',
      colGold: 'Gold',
      colShort: 'Short',
      cancel: 'Cancel',
      close: 'Close',
      buy: 'Buy',
      none: 'None',
      logTitle: 'Game Log',
      rematch: 'Play Again',
      viewTable: 'View Table',
      home: 'Home',
      language: '中文',
      canBuy: 'Buy',
      online: 'Play with Friends',
      local: 'Local Game',
      nick: 'Your name',
      nickPh: 'Friends will see this',
      createRoom: 'Create Room',
      join: 'Join',
      codePh: '6-digit room code',
      backToRoom: 'Back to my room',
      onlineOff: 'Online play needs WeChat Cloud Development (see README)',
      roomCode: 'Room code',
      invite: 'Invite Friends',
      addBot: 'Add Bot',
      startGame: 'Start Game',
      waitingHost: 'Waiting for the host…',
      leaveRoom: 'Leave Room',
      hostTag: 'Host',
      youTag: 'You',
      remove: 'Remove',
      needTwo: 'Need at least 2 players',
      waitRematch: 'Waiting for the host to start again',
      emptySeat: 'Empty seat',
      roomClosed: 'This room is closed',
      credit: 'Gameplay inspired by the board game Splendor',
      disclaimer: 'Unofficial fan project · not affiliated with the publisher',
    },
    rules: [
      ['Goal', 'Be the first to reach 15 prestige. When someone does, finish the round; the highest score wins, ties go to whoever bought fewer cards.'],
      ['Five ores + gold', 'Quartz (white) · Lapis (blue) · Malachite (green) · Cinnabar (red) · Obsidian (black). Gold is wild.'],
      [
        'On your turn, do one thing',
        '① Take 3 different ores (fewer if fewer kinds are left).\n② Take 2 of the same ore (only if 4 or more remain) — tap a picked ore again to switch.\n③ Reserve a card (from the table or blind from a deck) and take 1 gold. You may hold 3 reserved cards.\n④ Buy a card from the table or from your reserve.',
      ],
      ['Cards', 'The three tiers are Mines, Trade Routes and Cities. Every card you own permanently gives you 1 ore of the kind shown in its corner, discounting future purchases.'],
      ['Nobles', 'At the end of your turn, if your cards meet a noble’s requirement, the noble visits you for 3 prestige (at most one per turn).'],
      ['Hand limit', 'You may hold at most 10 ores (gold included) at the end of your turn; return the extras of your choice.'],
      ['Tips', 'Cards you can afford glow green. Tap a card to see how each ore is paid and what you are short. Tap an opponent for details.'],
    ],
    fmt: {
      round: (n) => `Round ${n}`,
      playerN: (n) => `Player ${n}`,
      thinking: 'Thinking…',
      inTurn: 'Their turn',
      oppSub: (r, h) => `Rsv ${r} · Hold ${h}`,
      meDiscard: 'Return extra ores',
      meOver: 'Game over',
      meWaiting: 'Waiting',
      holding: (n) => `Holding ${n}/10`,
      botThinking: (name) => `${name} is thinking`,
      waitingFor: (name) => `Waiting for ${name}`,
      discardBar: (n) => `Over the limit — tap your ores above to return ${n}`,
      pickTwo: (ore) => `Take 2 ${ore}`,
      pickOk: (list) => `Take ${list}`,
      pickNeed: (list, k) => `Picked ${list} — ${k} more`,
      cardTitle: (ore, tier) => `${ore} · ${tier}`,
      cardDesc: (ore, pts) => `Permanent +1 ${ore}${pts ? ` · ${pts} prestige` : ' · no prestige'}`,
      goldTag: (n) => `Gold×${n}`,
      affordable: 'You can afford it',
      affordableGold: (n) => `Affordable · uses ${n} gold`,
      short: (n) => `Short by ${n} ore${n === 1 ? '' : 's'}`,
      reserveGold: 'Reserving also gives you 1 gold',
      reserveNoGold: 'No gold left — reserving gives no gold',
      deckTitle: (tier, n) => `${tier} deck · ${n} left`,
      deckDesc: 'Draw the top card blind into your reserve',
      reserveMax: (n) => `You can reserve at most ${n}`,
      playerSub: (isAI, cards, hold) => `${isAI ? 'Bot' : 'Player'} · ${cards} card${cards === 1 ? '' : 's'} · holding ${hold}/10`,
      handoffTitle: (name) => `${name}’s turn`,
      handoffSub: (name) => `Pass the phone to ${name} — no peeking!`,
      handoffBtn: (name) => `I’m ${name}, start`,
      resultTitle: (name) => `${name} wins`,
      resultRounds: (n) => `${n} round${n === 1 ? '' : 's'}`,
      rankDetail: (cards, nobles) => `${cards} cards · ${nobles} noble${nobles === 1 ? '' : 's'}`,
      notYourTurn: (name) => `It’s ${name}’s turn`,
      discardFirst: 'Tap your own ores to return them first',
      deckEmpty: 'This deck is empty',
      noSave: 'No saved game to continue',
      dupNames: 'Player names must be unique',
      newGameTitle: 'Start a new game?',
      newGameBody: 'Your unfinished game will be overwritten.',
      newGameOk: 'Yes', // showModal 按钮最多 4 个字符
      newGameCancel: 'No',
      share: 'Come play Ore Merchant!',
      shareRoom: (code) => `Join my Ore Merchant room ${code}!`,
      seatCount: (n, max) => `${n}/${max} players`,
      randomNick: (n) => `Miner ${n}`,
      leaveConfirm: 'A bot will take over your seat. Leave the room?',
      leaveOk: 'Leave',
    },
    log: {
      start: (p) => `${p.n} players. First to ${p.goal} prestige triggers the final round`,
      take3: (p, L) => `${p.who} took ${p.colors.map((c) => L.color[c]).join(L.sep)}`,
      take2: (p, L) => `${p.who} took 2 ${L.color[p.color]}`,
      reserve: (p, L) =>
        `${p.who} reserved ${p.blind ? `a blind ${L.tier[p.tier]} card` : `a ${L.tier[p.tier]} card`}${p.gold ? ' and took 1 gold' : ''}`,
      buy: (p, L) =>
        `${p.who} bought ${p.fromReserve ? 'a reserved' : 'a'} ${L.color[p.color]} card${p.points ? ` (+${p.points})` : ''}${p.gold ? `, using ${p.gold} gold` : ''}`,
      discard: (p) => `${p.who} returned ores down to ${p.max}`,
      pass: (p) => `${p.who} had no legal move and passed`,
      noble: (p, L) => `The ${L.noble[p.noble] || p.noble} visited ${p.who} (+${p.points})`,
      reach: (p) => `${p.who} reached ${p.points} prestige! The game ends after this round`,
      over: (p) => `Game over — ${p.who} wins with ${p.points} prestige!`,
    },
    err: {
      over: 'The game is over',
      discardFirst: 'Return your extra ores first',
      noDiscard: 'Nothing to return right now',
      distinct: 'Ores taken must all be different',
      notOre: 'Gold can only be gained by reserving',
      empty: (p, L) => `No ${L.color[p.color]} left`,
      bankEmpty: 'There are no ores left to take',
      needDistinct: (p) => `Pick ${p.n} different ores`,
      needFour: 'You can take 2 of an ore only if 4 or more remain',
      reserveMax: (p) => `You can reserve at most ${p.n}`,
      noCard: 'That card isn’t on the table',
      deckEmpty: (p, L) => `The ${L.tier[p.tier]} deck is empty`,
      cardMissing: 'That card isn’t on the table or in your reserve',
      cantAfford: 'Not enough ores to buy this',
      noToken: 'You don’t have that ore',
      canMove: 'You still have a legal move',
      gold: 'Gold can only be gained by reserving',
      twoOnly: 'When taking 2 of a kind you can’t take anything else',
      maxThree: 'You can take at most 3 different ores',
      badMove: 'Unknown move',
      noRoom: 'Room not found or closed',
      badCode: 'Enter a 6-digit room code',
      started: 'The game has already started',
      full: 'The room is full',
      notHost: 'Only the host can do that',
      notMember: 'You are not in this room',
      notPlaying: 'No game in progress',
      stale: 'The table changed — please try again',
      notYourTurn: 'It’s not your turn yet',
      tooFew: 'Need at least 2 players',
      notOver: 'The game isn’t over yet',
      dupName: 'That name is taken',
      badSeat: 'That seat can’t be removed',
      busy: 'Server busy, try again shortly',
      network: 'Network problem, try again shortly',
      server: 'Server error, try again shortly',
      noAuth: 'Couldn’t identify your WeChat account',
      badAction: 'Unsupported action',
    },
  },
};

let current = 'zh';

function detect() {
  try {
    const saved = wx.getStorageSync(LANG_KEY);
    if (LANGS.indexOf(saved) >= 0) return saved;
  } catch (e) {
    // 读不到偏好时按系统语言
  }
  let sys = '';
  try {
    const info = wx.getAppBaseInfo ? wx.getAppBaseInfo() : wx.getSystemInfoSync();
    sys = String((info && info.language) || '');
  } catch (e) {
    sys = '';
  }
  return /^zh/i.test(sys) || !sys ? 'zh' : 'en';
}

function init() {
  current = detect();
  return current;
}

function setLang(lang) {
  if (LANGS.indexOf(lang) < 0) return current;
  current = lang;
  try {
    wx.setStorageSync(LANG_KEY, lang);
  } catch (e) {
    // 存不下也不影响本次使用
  }
  return current;
}

function getLang() {
  return current;
}

function dict(lang) {
  return DICT[lang || current];
}

/** 取 a.b.c 路径；函数则带参调用，字符串原样返回。 */
function t(path) {
  const args = Array.prototype.slice.call(arguments, 1);
  const L = DICT[current];
  const v = path.split('.').reduce((o, k) => (o == null ? o : o[k]), L);
  if (typeof v === 'function') return v.apply(null, args);
  return v == null ? path : v;
}

/** 翻译一条对局记录；老存档里的纯文本记录原样显示。 */
function logText(entry) {
  if (!entry) return '';
  if (entry.text) return entry.text;
  const fn = DICT[current].log[entry.key];
  return fn ? fn(entry.params || {}, DICT[current]) : entry.key;
}

/** 翻译 IllegalMove（或视图层的错误码）。 */
function errText(err) {
  if (!err) return '';
  const code = err.code || err;
  const v = DICT[current].err[code];
  if (typeof v === 'function') return v(err.params || {}, DICT[current]);
  return v || err.message || String(code);
}

/** 当前语言的静态文案 + 规则（可直接 setData）。 */
function ui() {
  const L = DICT[current];
  return Object.assign({ lang: current, appName: L.appName }, L.ui, {
    rules: L.rules.map((r, i) => ({ key: i, h: r[0], p: r[1] })),
  });
}

/** 某个名字是否是任一语言里的默认名（切换语言时用来顺手替换）。 */
function isDefaultName(name) {
  return LANGS.some((l) => {
    const L = DICT[l];
    return name === L.me || L.botNames.indexOf(name) >= 0 || /^(玩家\d|Player \d)$/.test(name);
  });
}

module.exports = { LANGS, dict, errText, getLang, init, isDefaultName, logText, setLang, t, ui };
