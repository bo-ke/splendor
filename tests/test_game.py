import pytest

from splendor import COLORS, Game
from splendor.ai import choose_and_apply
from splendor.cards import load_cards, load_nobles
from splendor.game import GameOver, IllegalMove


def test_data_integrity():
    cards = load_cards()
    assert len(cards) == 90
    tiers = {1: 0, 2: 0, 3: 0}
    for c in cards:
        tiers[c.tier] += 1
    assert tiers == {1: 40, 2: 30, 3: 20}
    # 每种颜色各 18 张
    for color in COLORS:
        assert sum(1 for c in cards if c.bonus == color) == 18
    assert len(load_nobles()) == 10


def test_setup():
    g = Game.new(["A", "B"], seed=1)
    assert g.tokens["red"] == 4  # 2 人 4 枚
    assert g.tokens["gold"] == 5
    assert len(g.nobles) == 3  # 人数 + 1
    for tier in (1, 2, 3):
        assert len(g.board[tier]) == 4


def test_player_count_tokens():
    assert Game.new(["A", "B", "C"], seed=1).tokens["red"] == 5
    assert Game.new(["A", "B", "C", "D"], seed=1).tokens["red"] == 7


def test_take_three_and_two():
    g = Game.new(["A", "B"], seed=1)
    g.take_three(["red", "blue", "green"])
    p = g.players[0]
    assert p.tokens["red"] == 1 and p.tokens["blue"] == 1 and p.tokens["green"] == 1
    assert g.tokens["red"] == 3
    assert g.current is g.players[1]  # 回合推进
    g.take_two("white")
    assert g.players[1].tokens["white"] == 2
    assert g.tokens["white"] == 2


def test_take_three_rejects_duplicates():
    g = Game.new(["A", "B"], seed=1)
    with pytest.raises(IllegalMove):
        g.take_three(["red", "red", "blue"])


def test_take_two_requires_four():
    g = Game.new(["A", "B"], seed=1)
    g.tokens["red"] = 3
    with pytest.raises(IllegalMove):
        g.take_two("red")


def test_buy_with_tokens_and_bonus():
    g = Game.new(["A", "B"], seed=1)
    p = g.players[0]
    # 找一张便宜的卡，灌足代币后购买
    card = g.board[1][0]
    for color, n in card.cost.items():
        p.tokens[color] = n
    before = p.points
    g.turn = 0
    g.buy(card.id)
    assert card in p.cards
    assert p.points == before + card.points
    assert p.bonus(card.bonus) == 1


def test_reserve_grants_gold():
    g = Game.new(["A", "B"], seed=1)
    p = g.players[0]
    cid = g.board[2][0].id
    g.reserve(card_id=cid)
    assert len(p.reserved) == 1
    assert p.tokens["gold"] == 1
    assert g.tokens["gold"] == 4


def test_noble_auto_visit():
    g = Game.new(["A", "B"], seed=3)
    p = g.players[0]
    noble = g.nobles[0]
    # 直接塞够满足贵族要求的加成卡
    fake = []
    from splendor.cards import Card

    idx = 0
    for color, cnt in noble.requirement.items():
        for _ in range(cnt):
            fake.append(Card(f"x{idx}", 1, color, 0, {}))
            idx += 1
    p.cards.extend(fake)
    g._check_nobles(p)
    assert noble in p.nobles
    assert noble not in g.nobles


def test_ai_selfplay_terminates():
    g = Game.new(["AI1", "AI2", "AI3"], seed=42)
    winner = None
    for _ in range(2000):
        try:
            choose_and_apply(g)
        except GameOver:
            winner = g.winner
            break
    assert winner is not None
    assert winner.points >= 15
