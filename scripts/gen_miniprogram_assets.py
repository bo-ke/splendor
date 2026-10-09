"""生成小程序用的 SVG 美术资源到 miniprogram/assets/。

用法: python scripts/gen_miniprogram_assets.py

- gems/<color>.svg   刻面宝石（每种颜色不同切工，色弱玩家也能靠形状区分）
- chips/<color>.svg  筹码式代币
- cards/<color>.svg  发展卡卡面底图
- backs/tier<n>.svg  三层牌堆卡背
- noble.svg          贵族卡底图
- crown.svg          声望图标

SVG 只用基础元素与渐变（不含 <style>/<text>/外链），保证小程序 <image> 能正常渲染。
"""

from __future__ import annotations

import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "miniprogram" / "assets"

# 宝石配色：base 主色、stroke 描边
GEMS = {
    "white": {"base": "#d5dee9", "stroke": "#5f6d82", "light": "#ffffff", "dark": "#6f7f96"},
    "blue": {"base": "#2f6fe0", "stroke": "#0f3378", "light": "#bcd4ff", "dark": "#0c2a66"},
    "green": {"base": "#1fa463", "stroke": "#0a4f2d", "light": "#b6f2cf", "dark": "#0a4426"},
    "red": {"base": "#e0263f", "stroke": "#6e0b19", "light": "#ffc2ca", "dark": "#5c0814"},
    "black": {"base": "#574d61", "stroke": "#120e16", "light": "#cdbfdb", "dark": "#151018"},
    "gold": {"base": "#f5b80a", "stroke": "#7a4f00", "light": "#fff1b8", "dark": "#8a5a00"},
}

# 卡面渐变（亮 -> 暗）
CARD_FACE = {
    "white": ("#f7f8fb", "#c3ccd8"),
    "blue": ("#4a88ee", "#163680"),
    "green": ("#36b875", "#0d5530"),
    "red": ("#ec5266", "#7f1020"),
    "black": ("#655a6c", "#1a151d"),
}

TIER_BACK = {
    1: ("#3a9a62", "#123d25"),
    2: ("#e2b02e", "#6e4a00"),
    3: ("#4a70d4", "#142a66"),
}


# ------------------------------------------------------------------ 颜色工具
def _rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def _hex(rgb) -> str:
    return "#" + "".join(f"{max(0, min(255, round(v))):02x}" for v in rgb)


def mix(a: str, b: str, t: float) -> str:
    ra, rb = _rgb(a), _rgb(b)
    return _hex([ra[i] + (rb[i] - ra[i]) * t for i in range(3)])


# --------------------------------------------------------------- 宝石形状
def regular(n: int, rot_deg: float, sx: float = 1.0, sy: float = 1.0):
    pts = []
    for i in range(n):
        a = math.radians(rot_deg + 360 * i / n)
        pts.append((math.cos(a) * sx, math.sin(a) * sy))
    return pts


def emerald_cut(w: float = 0.72, h: float = 1.0, c: float = 0.28):
    return [(-w + c, -h), (w - c, -h), (w, -h + c), (w, h - c), (w - c, h), (-w + c, h), (-w, h - c), (-w, -h + c)]


SHAPES = {
    "white": regular(8, 22.5),  # 圆形明亮式（钻石）
    "blue": regular(10, 0, 0.84, 1.0),  # 椭圆（蓝宝石）
    "green": emerald_cut(),  # 祖母绿阶梯式
    "red": regular(6, 90),  # 六边形（红宝石）
    "black": regular(4, 45, 1.2, 1.2),  # 公主方（缟玛瑙）；放大一些，视觉面积与其他宝石接近
    "gold": regular(5, -90),  # 五边形（黄金）
}


def gem_svg_body(color: str, cx: float, cy: float, r: float, uid: str) -> str:
    """在 (cx, cy) 处画半径 r 的刻面宝石，返回 SVG 片段。"""
    g = GEMS[color]
    outer = [(cx + x * r, cy + y * r) for x, y in SHAPES[color]]
    # 台面：向光源（左上）略偏，制造立体感
    ox, oy = cx - r * 0.05, cy - r * 0.07
    inner = [(ox + (x - cx) * 0.5, oy + (y - cy) * 0.5) for x, y in outer]
    lx, ly = -0.62, -0.78  # 光源方向

    parts = [
        f'<defs><linearGradient id="t{uid}" x1="0" y1="0" x2="1" y2="1">'
        f'<stop offset="0" stop-color="{mix(g["base"], g["light"], 0.7)}"/>'
        f'<stop offset="1" stop-color="{mix(g["base"], g["light"], 0.15)}"/>'
        f"</linearGradient></defs>"
    ]
    n = len(outer)
    for i in range(n):
        p1, p2 = outer[i], outer[(i + 1) % n]
        q1, q2 = inner[i], inner[(i + 1) % n]
        mx, my = (p1[0] + p2[0]) / 2 - cx, (p1[1] + p2[1]) / 2 - cy
        d = math.hypot(mx, my) or 1
        dot = (mx * lx + my * ly) / d
        fill = mix(g["base"], g["light"], dot * 0.7) if dot > 0 else mix(g["base"], g["dark"], -dot * 0.7)
        pts = " ".join(f"{x:.2f},{y:.2f}" for x, y in (p1, p2, q2, q1))
        parts.append(f'<polygon points="{pts}" fill="{fill}"/>')
    # 台面 + 内部刻线
    ipts = " ".join(f"{x:.2f},{y:.2f}" for x, y in inner)
    parts.append(f'<polygon points="{ipts}" fill="url(#t{uid})"/>')
    for i in range(n):
        p, q = outer[i], inner[i]
        parts.append(
            f'<line x1="{p[0]:.2f}" y1="{p[1]:.2f}" x2="{q[0]:.2f}" y2="{q[1]:.2f}" '
            f'stroke="{g["stroke"]}" stroke-opacity="0.35" stroke-width="{r * 0.025:.2f}"/>'
        )
    opts = " ".join(f"{x:.2f},{y:.2f}" for x, y in outer)
    parts.append(f'<polygon points="{ipts}" fill="none" stroke="#ffffff" stroke-opacity="0.45" stroke-width="{r * 0.03:.2f}"/>')
    parts.append(
        f'<polygon points="{opts}" fill="none" stroke="{g["stroke"]}" stroke-width="{r * 0.07:.2f}" stroke-linejoin="round"/>'
    )
    # 高光
    sx, sy, s = ox - r * 0.18, oy - r * 0.16, r * 0.16
    parts.append(
        f'<path d="M{sx:.2f},{sy - s:.2f} Q{sx:.2f},{sy:.2f} {sx + s:.2f},{sy:.2f} Q{sx:.2f},{sy:.2f} {sx:.2f},{sy + s:.2f} '
        f'Q{sx:.2f},{sy:.2f} {sx - s:.2f},{sy:.2f} Q{sx:.2f},{sy:.2f} {sx:.2f},{sy - s:.2f}Z" fill="#ffffff" fill-opacity="0.9"/>'
    )
    return "".join(parts)


def svg(view_w: float, view_h: float, body: str) -> str:
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {view_w} {view_h}" '
        f'width="{view_w}" height="{view_h}">{body}</svg>\n'
    )


# ------------------------------------------------------------------ 资源
def gem(color: str) -> str:
    return svg(100, 100, gem_svg_body(color, 50, 50, 44, color))


def chip(color: str) -> str:
    g = GEMS[color]
    rim = mix(g["base"], g["dark"], 0.35)
    stripe = "#ffffff" if color != "white" else "#8794a8"
    parts = [
        f'<defs><radialGradient id="c" cx="0.4" cy="0.35" r="0.75">'
        f'<stop offset="0" stop-color="{mix(g["base"], g["light"], 0.35)}"/>'
        f'<stop offset="1" stop-color="{mix(g["base"], g["dark"], 0.2)}"/></radialGradient></defs>',
        '<circle cx="50" cy="51.5" r="47" fill="#000000" fill-opacity="0.25"/>',
        f'<circle cx="50" cy="50" r="47" fill="{rim}"/>',
    ]
    for i in range(8):
        a = 360 * i / 8
        parts.append(
            f'<rect x="45" y="3.5" width="10" height="11" rx="2" fill="{stripe}" fill-opacity="0.9" '
            f'transform="rotate({a} 50 50)"/>'
        )
    parts += [
        '<circle cx="50" cy="50" r="34" fill="url(#c)"/>',
        f'<circle cx="50" cy="50" r="34" fill="none" stroke="{stripe}" stroke-opacity="0.75" '
        f'stroke-width="1.6" stroke-dasharray="3 3"/>',
        f'<circle cx="50" cy="50" r="38.5" fill="none" stroke="{g["stroke"]}" stroke-opacity="0.45" stroke-width="1.2"/>',
        gem_svg_body(color, 50, 50, 20, "g"),
        '<ellipse cx="42" cy="26" rx="22" ry="9" fill="#ffffff" fill-opacity="0.13"/>',
    ]
    return svg(100, 100, "".join(parts))


def card_face(color: str) -> str:
    hi, lo = CARD_FACE[color]
    w, h = 120, 168
    parts = [
        f'<defs><linearGradient id="bg" x1="0" y1="0" x2="0.6" y2="1">'
        f'<stop offset="0" stop-color="{hi}"/><stop offset="1" stop-color="{lo}"/></linearGradient>'
        f'<radialGradient id="vg" cx="0.5" cy="0.45" r="0.75">'
        f'<stop offset="0.55" stop-color="#000000" stop-opacity="0"/>'
        f'<stop offset="1" stop-color="#000000" stop-opacity="0.32"/></radialGradient>'
        f'<clipPath id="k"><rect width="{w}" height="{h}"/></clipPath></defs>',
        '<g clip-path="url(#k)">',
        f'<rect width="{w}" height="{h}" fill="url(#bg)"/>',
    ]
    # 光芒
    ray = "#ffffff" if color != "white" else "#7d8ca1"
    cx, cy = 92, 128
    for i in range(18):
        a1 = math.radians(i * 20)
        a2 = math.radians(i * 20 + 8)
        R = 220
        parts.append(
            f'<polygon points="{cx},{cy} {cx + R * math.cos(a1):.1f},{cy + R * math.sin(a1):.1f} '
            f'{cx + R * math.cos(a2):.1f},{cy + R * math.sin(a2):.1f}" fill="{ray}" fill-opacity="0.06"/>'
        )
    # 水印大宝石
    parts.append(f'<g opacity="0.42">{gem_svg_body(color, cx, cy, 34, "w")}</g>')
    parts.append(f'<rect width="{w}" height="{h}" fill="url(#vg)"/></g>')
    # 内框
    frame = "#ffffff" if color != "white" else "#9aa6b8"
    parts.append(
        f'<rect x="4" y="4" width="{w - 8}" height="{h - 8}" rx="6" fill="none" stroke="{frame}" '
        f'stroke-opacity="0.35" stroke-width="1"/>'
    )
    return svg(w, h, "".join(parts))


def card_back(tier: int) -> str:
    hi, lo = TIER_BACK[tier]
    w, h = 120, 168
    gold = "#f3d98b"
    parts = [
        f'<defs><linearGradient id="bg" x1="0" y1="0" x2="0.4" y2="1">'
        f'<stop offset="0" stop-color="{hi}"/><stop offset="1" stop-color="{lo}"/></linearGradient></defs>',
        f'<rect width="{w}" height="{h}" fill="url(#bg)"/>',
    ]
    # 菱形格纹
    step = 14
    for k in range(-h, w + h, step):
        parts.append(f'<line x1="{k}" y1="0" x2="{k + h}" y2="{h}" stroke="#ffffff" stroke-opacity="0.08" stroke-width="1"/>')
        parts.append(f'<line x1="{k}" y1="{h}" x2="{k + h}" y2="0" stroke="#ffffff" stroke-opacity="0.08" stroke-width="1"/>')
    parts += [
        f'<rect x="5" y="5" width="{w - 10}" height="{h - 10}" rx="7" fill="none" stroke="{gold}" stroke-opacity="0.8" stroke-width="1.6"/>',
        f'<rect x="9" y="9" width="{w - 18}" height="{h - 18}" rx="5" fill="none" stroke="{gold}" stroke-opacity="0.4" stroke-width="0.8"/>',
        f'<circle cx="{w / 2}" cy="{h / 2 - 14}" r="26" fill="#000000" fill-opacity="0.18" stroke="{gold}" stroke-opacity="0.7" stroke-width="1.4"/>',
    ]
    # 中央 n 颗小金菱
    for i in range(tier):
        x = w / 2 + (i - (tier - 1) / 2) * 14
        y = h / 2 - 14
        parts.append(
            f'<polygon points="{x},{y - 8} {x + 5.5},{y} {x},{y + 8} {x - 5.5},{y}" fill="{gold}" stroke="#6b4b00" stroke-width="0.8"/>'
        )
    return svg(w, h, "".join(parts))


def noble() -> str:
    w = h = 100
    parts = [
        '<defs><linearGradient id="bg" x1="0" y1="0" x2="0.7" y2="1">'
        '<stop offset="0" stop-color="#f8ead0"/><stop offset="1" stop-color="#cfa766"/></linearGradient>'
        '<linearGradient id="cr" x1="0" y1="0" x2="0" y2="1">'
        '<stop offset="0" stop-color="#ffe27a"/><stop offset="1" stop-color="#c58a0e"/></linearGradient></defs>',
        f'<rect width="{w}" height="{h}" fill="url(#bg)"/>',
        '<rect x="0" y="0" width="30" height="100" fill="#5b3d12" fill-opacity="0.16"/>',
        # 半身像剪影
        '<path d="M38,100 C38,80 48,70 64,70 C80,70 92,80 92,100 Z" fill="#6b4a1c" fill-opacity="0.55"/>',
        '<path d="M56,70 L64,80 L72,70 Z" fill="#f8ead0" fill-opacity="0.6"/>',
        '<circle cx="64" cy="52" r="14" fill="#6b4a1c" fill-opacity="0.55"/>',
        # 皇冠
        '<path d="M50,38 L52,26 L58,33 L64,22 L70,33 L76,26 L78,38 Z" fill="url(#cr)" stroke="#7a5200" stroke-width="1.2" stroke-linejoin="round"/>',
        '<circle cx="64" cy="22" r="2" fill="#e0263f"/>',
        '<circle cx="52" cy="26" r="1.6" fill="#2f6fe0"/>',
        '<circle cx="76" cy="26" r="1.6" fill="#1fa463"/>',
        '<rect x="3" y="3" width="94" height="94" rx="7" fill="none" stroke="#8a6326" stroke-opacity="0.7" stroke-width="1.6"/>',
        '<rect x="6.5" y="6.5" width="87" height="87" rx="5" fill="none" stroke="#ffffff" stroke-opacity="0.5" stroke-width="0.8"/>',
    ]
    return svg(w, h, "".join(parts))


def crown() -> str:
    return svg(
        24,
        24,
        '<defs><linearGradient id="c" x1="0" y1="0" x2="0" y2="1">'
        '<stop offset="0" stop-color="#ffe58a"/><stop offset="1" stop-color="#d08f0c"/></linearGradient></defs>'
        '<path d="M3,18 L4.5,7 L9,12 L12,4.5 L15,12 L19.5,7 L21,18 Z" fill="url(#c)" stroke="#7a5200" '
        'stroke-width="1.1" stroke-linejoin="round"/>'
        '<rect x="3" y="18.5" width="18" height="2.6" rx="1" fill="url(#c)" stroke="#7a5200" stroke-width="0.8"/>',
    )


def main() -> None:
    files: dict[str, str] = {}
    for c in GEMS:
        files[f"gems/{c}.svg"] = gem(c)
        files[f"chips/{c}.svg"] = chip(c)
    for c in CARD_FACE:
        files[f"cards/{c}.svg"] = card_face(c)
    for t in TIER_BACK:
        files[f"backs/tier{t}.svg"] = card_back(t)
    files["noble.svg"] = noble()
    files["crown.svg"] = crown()
    total = 0
    for rel, body in files.items():
        p = OUT / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(body, encoding="utf-8")
        total += len(body.encode())
    print(f"wrote {len(files)} files to {OUT.relative_to(ROOT)} ({total / 1024:.1f} KB)")


if __name__ == "__main__":
    main()
