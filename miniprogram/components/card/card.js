// 发展卡：左上声望点、右上提供的宝石、左下购买成本
Component({
  options: { addGlobalClass: true },
  properties: {
    card: { type: Object, value: null },
    size: { type: String, value: 'normal' }, // normal | small | large
    selected: { type: Boolean, value: false },
    // 为当前人类玩家高亮“买得起”
    highlight: { type: Boolean, value: false },
  },
});
