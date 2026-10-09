"""贵族肖像：文艺复兴式侧面像（面朝左），背景为低地平线风景。"""

from __future__ import annotations

import numpy as np

from .paint import oil_finish
from .scene import Canvas, mix

S = 200  # 输出边长

ROBE = {
    "white": "#d9d2c4",
    "blue": "#2a4a8c",
    "green": "#2e6a3a",
    "red": "#9a1f22",
    "black": "#2a2428",
}
SKIN = ["#e2b894", "#d6a47c", "#c99272", "#e8c4a2"]
HAIR = ["#3a2616", "#5a3a20", "#1e1610", "#7a5a3a", "#9a8a78"]

# 侧脸轮廓（男性），从额头顶 → 下巴 → 前颈
FACE_M = [(96, 44), (88, 60), (85, 72), (82, 79), (74, 92), (70, 97), (78, 102), (78, 107), (75, 111), (79, 115), (79, 120), (82, 128), (92, 136), (100, 142)]
FACE_F = [(98, 48), (91, 62), (88, 73), (86, 80), (80, 92), (77, 96), (83, 100), (82, 105), (80, 109), (83, 113), (84, 120), (88, 128), (97, 135), (104, 140)]
BACK = [(102, 146), (103, 178), (137, 178), (135, 138), (144, 120), (150, 100), (151, 80), (146, 60), (134, 46), (116, 39)]

# 10 位贵族的造型：(性别, 帽子, 胡子)
LOOKS = [
    ("m", "cap", False),
    ("f", "veil", False),
    ("m", "crown", True),
    ("m", "beret", True),
    ("f", "hennin", False),
    ("m", "mitre", False),
    ("m", "chaperon", True),
    ("f", "crown", False),
    ("m", "beret", False),
    ("m", "crown", True),
]


def portrait(index: int, colors: list[str], seed: int = 0):
    rng = np.random.default_rng(1000 + index * 17 + seed)
    gender, hat, beard = LOOKS[index % len(LOOKS)]
    robe = ROBE[colors[0]]
    accent = ROBE[colors[1]] if len(colors) > 1 else "#c9a24a"
    skin = SKIN[index % len(SKIN)]
    hair = HAIR[index % len(HAIR)]

    c = Canvas(S, S, rng)
    # 背景：上部暗色天空，下部远山风景（乌尔比诺公爵像式）
    c.sky("#22303e", "#a9b4b0", S * 0.78)
    c.clouds(3, 10, 80, "#c8ccc4", a=60)
    c.mountains(S * 0.8, 26, "#7f8f96", "#4a5a5e", peaks=3)
    c.mountains(S * 0.9, 16, "#5a6a4a", "#2e3a26", peaks=2)
    c.glow(60, 150, 70, "#f0e2b8", 0.25)

    face = FACE_F if gender == "f" else FACE_M
    # 长袍（肩膀）
    c.poly([(20, S + 4), (34, 176), (70, 160), (104, 156), (140, 156), (170, 166), (190, 186), (S + 4, S + 4)], robe)
    c.poly([(120, 156), (170, 166), (190, 186), (S + 4, S + 4), (130, S + 4)], mix(robe, "#000000", 0.3), a=170)
    for k in range(5):  # 衣褶
        x = 50 + k * 26 + rng.normal(0, 4)
        c.line([(x, 170), (x - 6, S)], mix(robe, "#000000", 0.25), 2.2, a=140)
    # 脖子 + 头
    c.poly([(98, 136), (104, 160), (136, 160), (138, 128)], mix(skin, "#000000", 0.12))
    c.poly(face + BACK, skin)
    c.poly([(118, 60), (150, 80), (146, 122), (130, 140), (120, 110)], mix(skin, "#000000", 0.14), a=140)  # 侧脸阴影
    c.ellipse(127, 92, 6, 9, mix(skin, "#000000", 0.18))  # 耳
    # 五官
    c.line([(84, 72), (95, 70)], mix(hair, "#000000", 0.2), 1.6)  # 眉
    c.ellipse(91, 78, 3.4, 1.8, "#2a1a12")
    c.ellipse(89.6, 77.6, 1.0, 0.7, "#e8dccc")
    c.line([(77, 111), (84, 111)], "#7a3a30", 1.4)  # 唇线
    c.ellipse(80, 109, 2.6, 1.6, mix(skin, "#a04030", 0.35))
    c.glow(86, 92, 10, "#ffd6b0", 0.15)  # 颧骨高光
    # 头发
    if gender == "f":
        c.poly([(98, 44), (130, 36), (152, 60), (154, 100), (140, 120), (128, 104), (122, 70), (100, 54)], hair)
        c.ellipse(150, 110, 13, 15, hair)  # 发髻
    else:
        c.poly([(96, 44), (128, 36), (150, 58), (152, 96), (140, 122), (130, 100), (124, 72), (104, 54), (96, 52)], hair)
    if beard:
        c.poly([(80, 116), (82, 128), (92, 140), (112, 146), (126, 132), (124, 112), (112, 120), (98, 126), (86, 120)], mix(hair, "#000000", 0.1))
    # 毛领 / 项链
    c.ellipse(118, 162, 34, 9, "#e6dcc8" if colors[0] != "white" else "#7a5a3a")
    for k in range(9):
        c.ellipse(96 + k * 6, 170 + abs(k - 4) * 1.6, 2.2, 2.2, "#d9b24a")
    c.ellipse(120, 180, 5, 6, accent)
    c.ellipse(119, 178, 1.8, 2, "#ffffff", a=160)

    gold = "#d9b24a"
    if hat == "cap":  # 佛罗伦萨红帽
        c.ellipse(122, 50, 36, 22, accent)
        c.poly([(132, 48), (160, 60), (166, 120), (150, 132), (146, 80)], mix(accent, "#000000", 0.25))
    elif hat == "beret":
        c.ellipse(118, 44, 40, 13, accent)
        c.ellipse(118, 40, 30, 9, mix(accent, "#ffffff", 0.15))
        c.line([(146, 40), (168, 20)], "#f2efe4", 2.4)
    elif hat == "crown":
        c.rect(98, 34, 148, 46, gold)
        for k in range(5):
            x = 100 + k * 11.5
            c.poly([(x - 3, 35), (x + 6, 35), (x + 1.5, 20)], gold)
            c.ellipse(x + 1.5, 21, 2.2, 2.2, "#f4e4a0")
        c.ellipse(123, 40, 3.4, 3.4, accent)
        c.ellipse(108, 40, 2.4, 2.4, "#2f63d6")
        c.ellipse(138, 40, 2.4, 2.4, "#1f9d55")
    elif hat == "veil":
        c.poly([(96, 40), (134, 32), (160, 52), (172, 150), (150, 160), (138, 96), (118, 56)], "#efe8da", a=225)
        c.line([(96, 44), (134, 36)], gold, 2.2)
    elif hat == "hennin":
        c.poly([(104, 44), (140, 40), (172, 8), (162, 2)], accent)
        c.poly([(162, 2), (172, 8), (182, 120), (170, 124)], "#f2ece0", a=150)
        c.line([(102, 46), (142, 41)], gold, 2.4)
    elif hat == "mitre":
        c.poly([(100, 46), (146, 42), (134, 0), (114, 2)], "#f0ead8")
        c.line([(123, 2), (123, 44)], gold, 3)
        c.line([(104, 40), (144, 37)], gold, 3)
    elif hat == "chaperon":
        c.ellipse(120, 44, 34, 18, accent)
        c.poly([(140, 40), (170, 44), (176, 140), (160, 150), (150, 70)], mix(accent, "#000000", 0.3))
        c.ellipse(114, 36, 20, 10, mix(accent, "#ffffff", 0.12))

    # 画框内侧的暗边
    base = c.result()
    return oil_finish(base, seed=2000 + index, sizes=(6, 3, 1.6), warmth=0.5, vignette=0.6, crackle=True)
