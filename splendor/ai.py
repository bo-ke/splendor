"""简单的贪心 AI：能买就买（优先高分/高价值），否则补最急缺的宝石。"""

from __future__ import annotations

from .cards import COLORS
from .game import Game


def _affordable(game: Game):
    p = game.current
    cands = []
    for tier in (1, 2, 3):
        for c in game.board[tier]:
            if c and p.can_afford(c):
                cands.append(c)
    cands += [c for c in p.reserved if p.can_afford(c)]
    return cands


def choose_and_apply(game: Game) -> str:
    """为当前玩家决策并执行一个动作，返回动作描述。"""
    p = game.current

    # 1) 能买就买：优先声望点，其次成本更高（更稀缺）的卡
    affordable = _affordable(game)
    if affordable:
        card = max(affordable, key=lambda c: (c.points, sum(c.cost.values())))
        game.buy(card.id)
        return f"{p.name} 购买 {card}"

    # 2) 盯住一张性价比高的目标卡，拿它最缺的颜色
    target = _pick_target(game)
    if target:
        wishlist = _needed_colors(game, target)
        colors = [c for c in wishlist if game.tokens[c] > 0][:3]
        if colors:
            game.take_three(colors)
            return f"{p.name} 拿代币 {','.join(colors)}（为 {target.id}）"

    # 3) 兜底：拿库存最多的 3 种不同代币
    avail = sorted((c for c in COLORS if game.tokens[c] > 0), key=lambda c: -game.tokens[c])
    if len(avail) >= 1:
        colors = avail[:3]
        game.take_three(colors)
        return f"{p.name} 拿代币 {','.join(colors)}"

    # 4) 实在没代币，预留一张高价值卡吃黄金
    for tier in (3, 2, 1):
        for c in game.board[tier]:
            if c:
                game.reserve(card_id=c.id)
                return f"{p.name} 预留 {c}"
    raise RuntimeError("无合法动作")


def _pick_target(game: Game):
    p = game.current
    best, best_score = None, 1e9
    for tier in (1, 2, 3):
        for c in game.board[tier]:
            if not c:
                continue
            need = sum(max(0, n - p.bonus(col) - p.tokens[col]) for col, n in c.cost.items())
            score = need - c.points * 0.5
            if score < best_score:
                best, best_score = c, score
    return best


def _needed_colors(game: Game, card) -> list[str]:
    p = game.current
    deficits = {col: max(0, n - p.bonus(col) - p.tokens[col]) for col, n in card.cost.items()}
    return [c for c, d in sorted(deficits.items(), key=lambda kv: -kv[1]) if d > 0]
