"""发展卡插画：5 种矿石 × 3 层（I 矿脉 / II 商路 / III 城邦）。

每种颜色的整体色调都贴近矿石颜色，保证在小尺寸下一眼能分辨。
"""

from __future__ import annotations

import numpy as np

from .paint import oil_finish, stable_seed
from .scene import Canvas, mix

W, H = 300, 420

# 每种矿石的环境配色
PAL = {
    # 石英：雪山、晨雾
    "white": dict(
        sky=("#8fa5bd", "#efe6d2"), far=("#c9d2dc", "#8796aa"), snow="#f6f3ec", near=("#a8a59a", "#5f5a50"),
        ground=("#8d8576", "#463f35"), glow="#fff4d6", ore=("#e9eef4", "#ffffff", "#9aa8ba"),
        wall="#d8cfbf", shadow="#7f7668", roof="#6d4c3a", window="#ffd98a", flag="#e8e2d0", cover="#e8dfca",
        hull="#5a3b25", sail="#efe7d6", emblem="#9aa8ba", tree=("#3e4c3a", "#6f7d62"), robe="#5c4a3c", horse="#7a5634",
    ),
    # 青金石：暮色、海港
    "blue": dict(
        sky=("#0d1a3c", "#5a7fbf"), far=("#3b5486", "#1c2b52"), snow=None, near=("#2a3c66", "#121c36"),
        ground=("#2b3550", "#121726"), glow="#cfe0ff", ore=("#2f63d6", "#9cc0ff", "#132f78"),
        wall="#55648a", shadow="#202a48", roof="#1d2a54", window="#ffcf6b", flag="#2f63d6", cover="#c9d4ea",
        hull="#3a2a1e", sail="#d7deea", emblem="#2f63d6", tree=("#13213c", "#2c4470"), robe="#28385e", horse="#6b5848",
        sea=("#2c4a86", "#0b1430"), glint="#cfe0ff",
    ),
    # 孔雀石：森林、丘陵
    "green": dict(
        sky=("#6d8ea0", "#e2d9ad"), far=("#7f9a7c", "#4f6b4c"), snow=None, near=("#3e6b2c", "#1e3a16"),
        ground=("#4b6a2a", "#1f3010"), glow="#fff2c0", ore=("#1f9d55", "#9af0bf", "#0a4a28"),
        wall="#c9b994", shadow="#6c5f45", roof="#2f5a2a", window="#ffe08a", flag="#1f9d55", cover="#d9cfa8",
        hull="#4a3420", sail="#e4dcc2", emblem="#1f9d55", tree=("#1b3a14", "#4f7d32"), robe="#3b5a2a", horse="#7a5634",
    ),
    # 朱砂：赤色峡谷、夕阳
    "red": dict(
        sky=("#4a1410", "#f08a46"), far=("#a24a2c", "#6a2416"), snow=None, near=("#7c2a18", "#3a1008"),
        ground=("#6a2a16", "#2a0e06"), glow="#ffc27a", ore=("#d6263b", "#ffa3ae", "#64091a"),
        wall="#c58a62", shadow="#5a2a18", roof="#7a1a14", window="#ffd47a", flag="#d6263b", cover="#e0c8a0",
        hull="#3e2414", sail="#e6caa4", emblem="#d6263b", tree=("#3a1a0c", "#7a3a18"), robe="#7a1e16", horse="#5a3420",
    ),
    # 黑曜石：火山之夜
    "black": dict(
        sky=("#141018", "#5a4250"), far=("#463a48", "#221a24"), snow=None, near=("#3a2f3a", "#151016"),
        ground=("#332a30", "#120d10"), glow="#ff8a3c", ore=("#4a3f54", "#cdbfdb", "#120e16"),
        wall="#665c68", shadow="#221c24", roof="#1c161e", window="#ff9a4a", flag="#5a4a66", cover="#5a5054",
        hull="#241812", sail="#6a6062", emblem="#b7a9c4", tree=("#0e0b0e", "#2a2328"), robe="#2a2228", horse="#2a201c",
    ),
}


def mine_scene(color: str, rng: np.random.Generator) -> Canvas:
    p = PAL[color]
    c = Canvas(W, H, rng)
    hz = H * 0.42
    c.sky(p["sky"][0], p["sky"][1], hz)
    if color == "blue":
        c.ellipse(W * 0.78, H * 0.12, 13, 13, "#f2f0e2")
        c.glow(W * 0.78, H * 0.12, 60, "#a8c4ff", 0.35)
    elif color == "black":
        c.glow(W * 0.2, H * 0.36, 90, "#ff5a1e", 0.45)  # 远处火山口的光
    else:
        c.glow(W * 0.25, hz * 0.7, 120, p["glow"], 0.45)
    c.clouds(5, H * 0.05, H * 0.3, mix(p["sky"][1], "#ffffff", 0.3), a=90)
    c.mountains(hz + 30, 120, p["far"][0], p["far"][1], snow=p["snow"], peaks=2)
    c.shade_band(hz, hz + 70, p["sky"][1], 0.35)
    # 近处的大山体，矿洞嵌在山脚
    c.mountains(H * 0.72, 150, p["near"][0], p["near"][1], peaks=1, rough=0.5)
    c.mine(W * 0.52, H * 0.72, 1.4, p["near"][1], "#6b4a2c")
    c.crystals(W * 0.18, H * 0.66, 1.1, *p["ore"])
    c.crystals(W * 0.86, H * 0.6, 0.9, *p["ore"], n=4)
    c.ground(H * 0.9, p["ground"][0], p["ground"][1], amp=14)
    c.cart(W * 0.3, H * 0.9, 1.5, "#6b4a2c", p["ore"])
    c.rocks(W * 0.82, H * 0.94, 1.3, p["ground"][0])
    c.figure(W * 0.68, H * 0.88, 1.7, p["robe"])
    c.line([(W * 0.68 + 5, H * 0.88 - 24), (W * 0.68 + 14, H * 0.88 - 34)], "#4a3220", 1.6)
    c.glow(W * 0.68 + 6, H * 0.88 - 14, 10, "#ffb060", 0.5)
    return c


def trade_scene(color: str, rng: np.random.Generator) -> Canvas:
    p = PAL[color]
    c = Canvas(W, H, rng)
    hz = H * 0.5
    c.sky(p["sky"][0], p["sky"][1], hz)
    if color == "black":
        c.glow(W * 0.75, H * 0.42, 80, "#ff6a2a", 0.4)
    elif color == "blue":
        c.ellipse(W * 0.2, H * 0.14, 11, 11, "#f2f0e2")
        c.glow(W * 0.2, H * 0.14, 50, "#a8c4ff", 0.3)
    else:
        c.glow(W * 0.7, hz * 0.8, 110, p["glow"], 0.5)
    c.clouds(6, H * 0.06, H * 0.34, mix(p["sky"][1], "#ffffff", 0.25), a=100)
    c.mountains(hz + 6, 70, p["far"][0], p["far"][1], snow=p["snow"], peaks=3)
    c.shade_band(hz - 20, hz + 30, p["sky"][1], 0.4)
    if color == "blue":
        # 海港：远处小城 + 帆船
        c.town(W * 0.05, W * 0.45, hz + 8, 0.9, p["wall"], p["roof"], p["window"])
        c.water(hz + 8, p["sea"][0], p["sea"][1], p["glint"])
        c.ship(W * 0.56, H * 0.8, 1.5, p["hull"], p["sail"], p["emblem"])
        c.crystals(W * 0.12, H * 0.97, 1.0, *p["ore"])
        return c
    c.town(W * 0.55, W * 0.95, hz + 10, 0.9, p["wall"], p["roof"], p["window"])
    c.ground(hz + 40, p["near"][0], p["near"][1], amp=26)
    for k in range(4):
        c.pine(W * (0.06 + k * 0.07), hz + 46 + k * 3, 1.0 + k * 0.1, p["tree"][0])
    c.ground(H * 0.86, p["ground"][0], p["ground"][1], amp=12)
    # 蜿蜒的土路
    road = mix(p["ground"][0], "#e8d8b0", 0.35)
    c.poly([(W * 0.62, hz + 40), (W * 0.68, hz + 40), (W * 0.95, H), (W * 0.15, H)], road, a=150)
    c.wagon(W * 0.56, H * 0.86, 1.9, "#6b4a2c", p["cover"], p["horse"])
    c.figure(W * 0.2, H * 0.9, 1.6, p["robe"])
    c.crystals(W * 0.88, H * 0.96, 1.0, *p["ore"], n=4)
    c.tree(W * 0.92, H * 0.78, 1.4, p["tree"][0], p["tree"][1])
    return c


def city_scene(color: str, rng: np.random.Generator) -> Canvas:
    p = PAL[color]
    c = Canvas(W, H, rng)
    hz = H * 0.6
    c.sky(p["sky"][0], p["sky"][1], hz)
    if color == "black":
        c.glow(W * 0.5, H * 0.5, 120, "#ff6a2a", 0.35)
    elif color == "blue":
        c.ellipse(W * 0.82, H * 0.1, 12, 12, "#f2f0e2")
        c.glow(W * 0.82, H * 0.1, 60, "#a8c4ff", 0.35)
    else:
        c.glow(W * 0.5, hz * 0.55, 140, p["glow"], 0.55)
    c.clouds(7, H * 0.04, H * 0.38, mix(p["sky"][1], "#ffffff", 0.3), a=110)
    c.mountains(hz - 10, 60, p["far"][0], p["far"][1], snow=p["snow"], peaks=4)
    c.shade_band(hz - 40, hz + 10, p["sky"][1], 0.35)
    # 城堡所在的山丘
    c.mountains(H * 0.7, 46, p["near"][0], p["near"][1], peaks=1, rough=0.35)
    if color in ("green", "white"):
        c.cathedral(W * 0.72, H * 0.66, 1.0, p["wall"], p["shadow"], p["roof"], p["window"])
        c.castle(W * 0.38, H * 0.66, 1.15, p["wall"], p["shadow"], p["roof"], p["window"], p["flag"])
    else:
        c.castle(W * 0.5, H * 0.66, 1.35, p["wall"], p["shadow"], p["roof"], p["window"], p["flag"])
    c.town(W * 0.0, W * 0.3, H * 0.74, 1.0, p["wall"], p["roof"], p["window"])
    c.town(W * 0.7, W * 1.0, H * 0.75, 1.0, p["wall"], p["roof"], p["window"])
    c.ground(H * 0.84, p["ground"][0], p["ground"][1], amp=10)
    for k in range(3):
        c.tree(W * (0.08 + k * 0.1), H * 0.86, 1.3 - k * 0.15, p["tree"][0], p["tree"][1])
    c.crystals(W * 0.8, H * 0.97, 1.3, *p["ore"])
    c.crystals(W * 0.62, H * 0.99, 0.8, *p["ore"], n=3)
    c.figure(W * 0.42, H * 0.95, 1.8, p["robe"])
    c.figure(W * 0.5, H * 0.96, 1.6, mix(p["robe"], "#c8b48a", 0.4))
    return c


SCENES = {1: mine_scene, 2: trade_scene, 3: city_scene}


def card_art(color: str, tier: int, seed: int = 0):
    rng = np.random.default_rng(stable_seed("card", color, tier, seed))
    base = SCENES[tier](color, rng).result()
    return oil_finish(base, seed=tier * 100 + seed + len(color), sizes=(9, 4.5, 2.2), warmth=0.4, vignette=0.55)
