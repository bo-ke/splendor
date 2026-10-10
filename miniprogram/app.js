const config = require('./config');
const i18n = require('./utils/i18n');

App({
  globalData: {
    // 首页把座位配置放这里，对局页 onLoad 时取走
    pendingSeats: null,
    cloudReady: false,
  },

  onLaunch() {
    // 语言：用户选过的优先，否则跟随微信语言
    i18n.init();
    // 云开发（联机）：基础库过低或未开通时，联机入口会提示不可用
    if (wx.cloud) {
      try {
        wx.cloud.init(Object.assign({ traceUser: true }, config.cloudEnv ? { env: config.cloudEnv } : {}));
        this.globalData.cloudReady = true;
      } catch (e) {
        this.globalData.cloudReady = false;
      }
    }
  },
});
