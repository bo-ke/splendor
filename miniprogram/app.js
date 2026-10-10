const i18n = require('./utils/i18n');

App({
  globalData: {
    // 首页把座位配置放这里，对局页 onLoad 时取走
    pendingSeats: null,
  },

  onLaunch() {
    // 语言：用户选过的优先，否则跟随微信语言
    i18n.init();
  },
});
