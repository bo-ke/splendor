"""璀璨宝石核心规则引擎。

规则要点（标准版）：
- 2 人 / 3 人 / 4 人：每种宝石代币 4 / 5 / 7 枚，黄金恒 5 枚。
- 场上三排发展卡，每排翻开 4 张；贵族数 = 人数 + 1。
- 每回合玩家执行以下动作之一：
  1. 拿 3 枚不同颜色的宝石代币
  2. 拿 2 枚同色（该色牌堆 >= 4 时才可）
  3. 预留 1 张卡（场上或牌堆顶）并拿 1 枚黄金（若有）
  4. 购买 1 张卡（场上或自己预留的）
- 回合结束时手里代币 > 10 需弃回。
- 永久加成满足要求则自动迎接贵族（至多 1 位/回合）。
- 有人达到 15 声望点后，打完当前这一轮，分最高者胜（并列比发展卡少者胜）。
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field

from .cards import COLORS, GOLD, Card, Noble, load_cards, load_nobles
from .player import Player

TOKENS_BY_PLAYERS = {2: 4, 3: 5, 4: 7}
WINNING_SCORE = 15


class IllegalMove(Exception):
    """非法动作。"""


class GameOver(Exception):
    """游戏结束。"""


@dataclass
class Game:
    players: list[Player]
    tokens: dict[str, int] = field(default_factory=dict)
    decks: dict[int, list[Card]] = field(default_factory=dict)  # tier -> 牌堆（未翻开）
    board: dict[int, list[Card | None]] = field(default_factory=dict)  # tier -> 翻开的 4 张
    nobles: list[Noble] = field(default_factory=list)
    turn: int = 0
    _rng: random.Random = field(default_factory=random.Random)
    _last_round: bool = False
    _winner: Player | None = None

    # ------------------------------------------------------------------ setup
    @classmethod
    def new(
        cls,
        player_names: list[str],
        seed: int | None = None,
        cards: list[Card] | None = None,
        nobles: list[Noble] | None = None,
    ) -> Game:
        n = len(player_names)
        if not 2 <= n <= 4:
            raise ValueError("璀璨宝石支持 2–4 人")
        rng = random.Random(seed)
        cards = list(cards or load_cards())
        all_nobles = list(nobles or load_nobles())

        tok = TOKENS_BY_PLAYERS[n]
        tokens = {c: tok for c in COLORS}
        tokens[GOLD] = 5

        decks: dict[int, list[Card]] = {}
        board: dict[int, list[Card | None]] = {}
        for tier in (1, 2, 3):
            deck = [c for c in cards if c.tier == tier]
            rng.shuffle(deck)
            board[tier] = [deck.pop() for _ in range(4)]
            decks[tier] = deck

        rng.shuffle(all_nobles)
        chosen = all_nobles[: n + 1]

        g = cls(
            players=[Player(name) for name in player_names],
            tokens=tokens,
            decks=decks,
            board=board,
            nobles=chosen,
        )
        g._rng = rng
        return g

    # ------------------------------------------------------------- properties
    @property
    def current(self) -> Player:
        return self.players[self.turn % len(self.players)]

    def card_by_id(self, card_id: str) -> Card | None:
        for tier in (1, 2, 3):
            for c in self.board[tier]:
                if c and c.id == card_id:
                    return c
        return None

    # ----------------------------------------------------------------- actions
    def take_three(self, colors: list[str]) -> None:
        p = self.current
        if len(set(colors)) != len(colors):
            raise IllegalMove("3 枚必须颜色各不相同")
        if not 1 <= len(colors) <= 3:
            raise IllegalMove("一次拿 1–3 枚不同颜色")
        for c in colors:
            if c not in COLORS:
                raise IllegalMove(f"未知颜色 {c}")
            if self.tokens[c] <= 0:
                raise IllegalMove(f"{c} 代币已空")
        for c in colors:
            self.tokens[c] -= 1
            p.tokens[c] += 1
        self._end_turn()

    def take_two(self, color: str) -> None:
        p = self.current
        if color not in COLORS:
            raise IllegalMove(f"未知颜色 {color}")
        if self.tokens[color] < 4:
            raise IllegalMove("只有该色 >=4 枚时才能拿 2 枚同色")
        self.tokens[color] -= 2
        p.tokens[color] += 2
        self._end_turn()

    def reserve(self, card_id: str | None = None, tier: int | None = None) -> None:
        p = self.current
        if len(p.reserved) >= 3:
            raise IllegalMove("最多预留 3 张")
        if card_id is not None:
            card = self.card_by_id(card_id)
            if card is None:
                raise IllegalMove("场上没有这张卡")
            self._remove_from_board(card)
        elif tier in (1, 2, 3):
            if not self.decks[tier]:
                raise IllegalMove(f"第 {tier} 层牌堆已空")
            card = self.decks[tier].pop()
        else:
            raise IllegalMove("需指定 card_id 或 tier")
        p.reserved.append(card)
        if self.tokens[GOLD] > 0:
            self.tokens[GOLD] -= 1
            p.tokens[GOLD] += 1
        self._end_turn()

    def buy(self, card_id: str) -> None:
        p = self.current
        card = self.card_by_id(card_id)
        from_reserve = False
        if card is None:
            for c in p.reserved:
                if c.id == card_id:
                    card, from_reserve = c, True
                    break
        if card is None:
            raise IllegalMove("买不到：场上和预留区都没有这张卡")
        if not p.can_afford(card):
            raise IllegalMove("宝石不足，买不起")

        # 结算：优先用普通代币，不足部分用黄金
        for color, cost in card.cost.items():
            pay = max(0, cost - p.bonus(color))
            use = min(pay, p.tokens[color])
            p.tokens[color] -= use
            self.tokens[color] += use
            gold = pay - use
            if gold:
                p.tokens[GOLD] -= gold
                self.tokens[GOLD] += gold

        if from_reserve:
            p.reserved.remove(card)
        else:
            self._remove_from_board(card, refill=True)
        p.cards.append(card)

        self._check_nobles(p)
        self._end_turn()

    # --------------------------------------------------------------- internals
    def _remove_from_board(self, card: Card, refill: bool = False) -> None:
        row = self.board[card.tier]
        idx = row.index(card)
        row[idx] = self.decks[card.tier].pop() if (refill and self.decks[card.tier]) else None

    def _check_nobles(self, p: Player) -> None:
        for noble in list(self.nobles):
            if p.qualifies_for(noble):
                self.nobles.remove(noble)
                p.nobles.append(noble)
                break  # 每回合至多迎接一位

    def discard(self, color: str) -> None:
        """回合末代币超 10 时手动弃回。"""
        p = self.current
        if p.tokens.get(color, 0) <= 0:
            raise IllegalMove("没有这种代币可弃")
        p.tokens[color] -= 1
        self.tokens[color] += 1

    def _end_turn(self) -> None:
        p = self.current
        # 代币上限：这里只做校验提示，实际弃牌交由调用方 discard
        if p.points >= WINNING_SCORE:
            self._last_round = True
        is_last_seat = (self.turn % len(self.players)) == len(self.players) - 1
        self.turn += 1
        if self._last_round and is_last_seat:
            self._finish()

    def _finish(self) -> None:
        best = max(
            self.players,
            key=lambda pl: (pl.points, -len(pl.cards)),
        )
        self._winner = best
        raise GameOver(f"游戏结束，胜者：{best.name}（{best.points} 分）")

    @property
    def winner(self) -> Player | None:
        return self._winner
