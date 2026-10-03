# 璀璨宝石 Splendor

标准版《璀璨宝石》桌游的 Python 规则引擎 —— 含完整的 90 张发展卡 + 10 张贵族卡数据、命令行界面，以及一个可自对弈的简单贪心 AI。另附一个可直接运行的 [微信小程序](#微信小程序) 版本。

## 特性

- ✅ **完整规则**：2–4 人；代币数随人数（4/5/7 + 5 黄金）；三排发展卡各翻 4 张；贵族数 = 人数 + 1。
- ✅ **四种动作**：拿 3 枚不同色 / 拿 2 枚同色（需 ≥4）/ 预留并吃黄金 / 购买（场上或预留）。
- ✅ **永久加成结算**：购卡提供永久宝石，自动折抵后续成本，黄金作万能补足。
- ✅ **贵族自动来访**：满足要求即迎接（每回合至多 1 位）。
- ✅ **胜负判定**：达 15 分后打完本轮，分高者胜，平分比发展卡少者胜。
- ✅ **内置 AI**：能买就买（优先声望/稀缺度），否则盯目标卡补最缺的宝石。
- ✅ **可复现**：`seed` 固定洗牌顺序，便于测试。

## 安装

```bash
pip install -e .
```

## 玩

```bash
splendor                      # 1 人 vs 2 AI
splendor --demo --seed 7      # 3 个 AI 自动对弈
splendor --players 你 AI-甲 AI-乙
```

人类回合输入：

| 命令 | 含义 |
|------|------|
| `t red blue green` | 拿 3 枚不同色代币 |
| `d white` | 拿 2 枚同色代币 |
| `b d12` | 购买卡 `d12`（场上或预留） |
| `r d33` | 预留卡 `d33` 并拿 1 黄金 |

## 作为库使用

```python
from splendor import Game
from splendor.ai import choose_and_apply
from splendor.game import GameOver

game = Game.new(["Alice", "Bob"], seed=1)
game.take_three(["red", "blue", "green"])   # Alice 拿代币
game.buy("d05")                              # Bob 购卡（若买得起）

# AI 托管一步
try:
    print(choose_and_apply(game))
except GameOver as e:
    print(e, "->", game.winner.name)
```

## 微信小程序

`miniprogram/` 是一个可直接导入「微信开发者工具」的原生小程序，单机即可玩，无需服务器。

**功能**

- 🤖 **人机对战**：1 名真人 vs 1–3 个电脑（电脑沿用上面的贪心 AI，JS 移植版）。
- 👥 **同屏多人**：多名真人轮流传手机，轮到谁先弹出交接遮罩，避免误操作。
- 💾 **自动存档**：每一步都存到本地缓存，退出后在首页「继续上局」。
- ✋ **触屏操作**：点代币选择（再点同色切换为拿 2 枚），点卡牌弹出购买 / 预留面板，点牌堆盲抽预留；买得起的卡有绿色光边，还差哪些宝石会直接提示。
- 📏 **完整规则**：在 Python 版基础上补全了「回合末代币超过 10 枚须弃回」和「拿不同色须拿满 3 种（不足 3 种时拿满剩余）」。

**运行**

1. 安装 [微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)。
2. 「导入项目」→ 目录选 `miniprogram/` → AppID 填你自己的，或先用「测试号」。
3. 编译即可在模拟器里玩；点「预览」扫码可在手机上真机体验。

**结构**

```
miniprogram/
├── engine/          # 规则引擎（JS 移植自 splendor/game.py、player.py、ai.py）
│   ├── data.js      #   由 scripts/gen_miniprogram_data.py 从 splendor/data/*.json 生成
│   ├── game.js      #   状态是纯 JSON，可直接 setData / 存档
│   └── ai.js
├── utils/           # view.js：状态 → 视图模型；storage.js：本地存档
├── components/      # card（发展卡）、noble（贵族）
└── pages/           # index（开局设置 / 玩法说明）、game（对局）
```

修改卡牌数据后运行 `python scripts/gen_miniprogram_data.py` 同步；JS 测试会检查两边是否一致。

**测试**（Node ≥ 18，无需安装依赖）

```bash
npm test     # 规则引擎 + AI 自对弈（2–4 人 × 40 个种子）+ 用页面事件驱动整局的页面逻辑测试
```

**上线前须知**：正式发布需要注册小程序账号并把 `project.config.json` 里的 `appid` 换成自己的。微信对游戏类内容的审核较严格（通常要求以「小游戏」形式发布，正式运营可能涉及版号）；「Splendor / 璀璨宝石」的名称与美术也受版权保护。自用或开发版 / 体验版分享给朋友不受影响。

## 数据

- `splendor/data/development_cards.json` —— 90 张发展卡（tier 1/2/3 = 40/30/20，每色各 18 张，总声望 140）。
- `splendor/data/nobles.json` —— 10 张贵族卡（各 3 分，4+4 或 3+3+3 加成要求）。

## 测试

```bash
pytest -q          # 10 项：数据完整性、各动作规则、贵族来访、AI 自对弈收敛
ruff check .
npm test           # 小程序 JS 引擎与页面逻辑
```

## 许可

MIT
