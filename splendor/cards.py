"""卡牌 / 贵族数据模型与加载。"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

# 五种宝石颜色（宝石代币与卡牌 bonus 共用），gold 为黄金/万能
COLORS = ["white", "blue", "green", "red", "black"]
GOLD = "gold"

_DATA_DIR = Path(__file__).resolve().parent / "data"


@dataclass(frozen=True)
class Card:
    """一张发展卡。"""

    id: str
    tier: int  # 1 / 2 / 3
    bonus: str  # 提供的永久宝石颜色
    points: int  # 声望点
    cost: dict[str, int]  # 购买成本 {颜色: 数量}

    def __str__(self) -> str:
        cost = " ".join(f"{n}{c[0].upper()}" for c, n in sorted(self.cost.items()))
        return f"[{self.id} T{self.tier} +{self.bonus[0].upper()} {self.points}pt | {cost}]"


@dataclass(frozen=True)
class Noble:
    """一张贵族卡。"""

    id: str
    name: str
    points: int
    requirement: dict[str, int]  # {颜色: 需要的卡牌 bonus 数}

    def __str__(self) -> str:
        req = " ".join(f"{n}{c[0].upper()}" for c, n in sorted(self.requirement.items()))
        return f"<{self.id} {self.name} {self.points}pt | 需 {req}>"


def load_cards(path: str | Path | None = None) -> list[Card]:
    path = Path(path) if path else _DATA_DIR / "development_cards.json"
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    return [Card(**c) for c in raw]


def load_nobles(path: str | Path | None = None) -> list[Noble]:
    path = Path(path) if path else _DATA_DIR / "nobles.json"
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    return [Noble(**n) for n in raw]
