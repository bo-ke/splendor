# 璀璨宝石 Splendor

标准版《璀璨宝石》桌游的 Python 规则引擎 —— 含完整的 90 张发展卡 + 10 张贵族卡数据、命令行界面，以及一个可自对弈的简单贪心 AI。

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

## 数据

- `splendor/data/development_cards.json` —— 90 张发展卡（tier 1/2/3 = 40/30/20，每色各 18 张，总声望 140）。
- `splendor/data/nobles.json` —— 10 张贵族卡（各 3 分，4+4 或 3+3+3 加成要求）。

## 测试

```bash
pytest -q          # 10 项：数据完整性、各动作规则、贵族来访、AI 自对弈收敛
ruff check .
```

## 许可

MIT
