"""璀璨宝石 (Splendor) —— 完整规则引擎 + CLI + AI。"""

from .cards import COLORS, GOLD, Card, Noble, load_cards, load_nobles
from .game import Game, GameOver, IllegalMove
from .player import Player

__all__ = [
    "COLORS",
    "GOLD",
    "Card",
    "Game",
    "GameOver",
    "IllegalMove",
    "Noble",
    "Player",
    "load_cards",
    "load_nobles",
]
__version__ = "0.1.0"
