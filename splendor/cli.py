"""命令行入口：人机对战 / AI 自对弈演示。

用法:
    python -m splendor                 # 1 人 vs 2 AI
    python -m splendor --demo          # 3 个 AI 自动对弈
    python -m splendor --players 你 AI AI
"""

from __future__ import annotations

import argparse

from .ai import choose_and_apply
from .cards import COLORS, GOLD
from .game import Game, GameOver, IllegalMove


def _show(game: Game) -> None:
    print("\n" + "=" * 60)
    print(
        "桌面代币:",
        "  ".join(f"{c[:1].upper()}:{game.tokens[c]}" for c in COLORS),
        f" 黄金:{game.tokens[GOLD]}",
    )
    for tier in (3, 2, 1):
        cards = "  ".join(str(c) if c else "[空]" for c in game.board[tier])
        print(f"  第{tier}层: {cards}")
    print("  贵族:", "  ".join(str(n) for n in game.nobles) or "（无）")
    print("-" * 60)
    for p in game.players:
        b = p.bonuses()
        bonus = " ".join(f"{c[:1].upper()}{b[c]}" for c in COLORS if b[c])
        toks = " ".join(f"{c[:1].upper()}{p.tokens[c]}" for c in [*COLORS, GOLD] if p.tokens[c])
        print(
            f"  {p.name:<8} {p.points}分 | 加成[{bonus or '-'}] 代币[{toks or '-'}] "
            f"预留{len(p.reserved)}"
        )


def _human_turn(game: Game) -> None:
    p = game.current
    _show(game)
    print(f"\n轮到 {p.name}。动作: (t 拿3色) (d 拿2同色) (b 买卡) (r 预留) (p 跳过示例)")
    try:
        raw = input("> ").strip().split()
    except EOFError:
        raw = []
    if not raw:
        choose_and_apply(game)  # 空输入交给 AI 帮忙走一步
        return
    cmd, *args = raw
    if cmd == "t":
        game.take_three(args)
    elif cmd == "d":
        game.take_two(args[0])
    elif cmd == "b":
        game.buy(args[0])
    elif cmd == "r":
        game.reserve(card_id=args[0])
    else:
        print("无法识别，自动走一步。")
        choose_and_apply(game)


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description="璀璨宝石 Splendor")
    ap.add_argument("--demo", action="store_true", help="全 AI 自对弈")
    ap.add_argument("--players", nargs="+", help="玩家名（含 'AI' 前缀者由电脑托管）")
    ap.add_argument("--seed", type=int, default=None)
    ap.add_argument("--max-turns", type=int, default=400)
    args = ap.parse_args(argv)

    if args.demo:
        names = ["AI-红", "AI-蓝", "AI-绿"]
    elif args.players:
        names = args.players
    else:
        names = ["你", "AI-甲", "AI-乙"]

    game = Game.new(names, seed=args.seed)
    print(f"开始！{len(names)} 名玩家，目标 15 分。")

    try:
        for _ in range(args.max_turns):
            p = game.current
            is_ai = args.demo or p.name.lower().startswith("ai")
            if is_ai:
                desc = choose_and_apply(game)
                print(desc)
            else:
                while True:
                    try:
                        _human_turn(game)
                        break
                    except IllegalMove as e:
                        print("非法动作:", e)
    except GameOver as e:
        _show(game)
        print("\n🏆", e)


if __name__ == "__main__":
    main()
