// 贵族：3 分 + 所需各色发展卡数量
Component({
  options: { addGlobalClass: true },
  properties: {
    noble: { type: Object, value: null },
    size: { type: String, value: 'normal' }, // normal | small
  },
});
