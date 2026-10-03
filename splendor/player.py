"""玩家状态。"""

from __future__ import annotations

from dataclasses import dataclass, field

from .cards import COLORS, GOLD, Card, Noble


@dataclass
class Player:
    name: str
    tokens: dict[str, int] = field(default_factory=lambda: {c: 0 for c in [*COLORS, GOLD]})
    cards: list[Card] = field(default_factory=list)  # 已购买的发展卡
    reserved: list[Card] = field(default_factory=list)  # 预留卡（手牌）
    nobles: list[Noble] = field(default_factory=list)

    # ---- 衍生属性 ----
    def bonus(self, color: str) -> int:
        """某颜色的永久宝石加成（已购卡提供）。"""
        return sum(1 for c in self.cards if c.bonus == color)

    def bonuses(self) -> dict[str, int]:
        return {c: self.bonus(c) for c in COLORS}

    @property
    def points(self) -> int:
        return sum(c.points for c in self.cards) + sum(n.points for n in self.nobles)

    @property
    def token_count(self) -> int:
        return sum(self.tokens.values())

    def can_afford(self, card: Card) -> bool:
        """考虑永久加成后，用宝石代币+黄金是否买得起。"""
        return self.gold_needed(card) <= self.tokens[GOLD]

    def gold_needed(self, card: Card) -> int:
        """买这张卡需要动用多少黄金（0 表示普通代币足够）。"""
        shortfall = 0
        for color, cost in card.cost.items():
            pay = max(0, cost - self.bonus(color))
            shortfall += max(0, pay - self.tokens[color])
        return shortfall

    def qualifies_for(self, noble: Noble) -> bool:
        return all(self.bonus(c) >= n for c, n in noble.requirement.items())
