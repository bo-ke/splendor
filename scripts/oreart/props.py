"""卡背、矿石钱币（代币）、矿石图标、桌面与墙面纹理。"""

from __future__ import annotations

import math

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from .paint import canvas_weave, oil_finish, smooth_noise, stable_seed, to_arr, to_img, varnish
from .scene import hex2rgb, mix, rgba

# 矿石配色：(主色, 亮面, 暗面)
ORE = {
    "white": ("#dfe5ec", "#ffffff", "#8e9bb0"),
    "blue": ("#2f5fc8", "#9cc0ff", "#102a6a"),
    "green": ("#1f9d55", "#9af0bf", "#0a4a28"),
    "red": ("#d0233a", "#ffa3ae", "#5c0814"),
    "black": ("#4a4054", "#c6b8d4", "#0e0b12"),
    "gold": ("#e8b020", "#fff0a8", "#7a4f00"),
}

# 钱币边缘金属：(亮, 暗)
RIM = {
    "white": ("#e8e6e0", "#7d7a74"),
    "blue": ("#c9a46a", "#5a3e1c"),
    "green": ("#c9a46a", "#5a3e1c"),
    "red": ("#c9a46a", "#5a3e1c"),
    "black": ("#9a9aa2", "#3a3a40"),
    "gold": ("#ffe28a", "#8a5a00"),
}


# ------------------------------------------------------------------ 矿石簇
def ore_cluster(layer: Image.Image, cx: float, cy: float, s: float, color: str, rng: np.random.Generator, n: int = 5):
    """在 RGBA 图层上画一簇矿石晶体（黄金画成金块）。"""
    d = ImageDraw.Draw(layer, "RGBA")
    base, light, dark = ORE[color]
    if color == "gold":
        for _ in range(n + 2):
            x, y = cx + rng.normal(0, 9 * s), cy + rng.normal(0, 5 * s)
            r = rng.uniform(7, 12) * s
            pts = [(x + math.cos(a) * r * rng.uniform(0.75, 1.15), y + math.sin(a) * r * 0.8 * rng.uniform(0.75, 1.15)) for a in np.linspace(0, math.tau, 9)[:-1]]
            d.polygon(pts, fill=rgba(dark))
            inner = [(x + (px - x) * 0.72 - 1.5 * s, y + (py - y) * 0.72 - 1.5 * s) for px, py in pts]
            d.polygon(inner, fill=rgba(base))
            d.ellipse([x - r * 0.45 - 2 * s, y - r * 0.45 - 2 * s, x - 2 * s, y - 2 * s], fill=rgba(light, 200))
        return
    for i in range(n):
        ang = math.radians(-90 + rng.normal(0, 26))
        ln = rng.uniform(26, 40) * s * (1.25 if i == 0 else 1.0)
        wd = rng.uniform(6, 9) * s
        bx, by = cx + rng.normal(0, 7 * s), cy + rng.uniform(-2, 3) * s
        dx, dy = math.cos(ang), math.sin(ang)
        px, py = -dy, dx
        tip = (bx + dx * ln, by + dy * ln)
        sh = (bx + dx * ln * 0.76, by + dy * ln * 0.76)
        left = [(bx - px * wd, by - py * wd), (sh[0] - px * wd, sh[1] - py * wd), tip, (bx, by)]
        right = [(bx, by), tip, (sh[0] + px * wd, sh[1] + py * wd), (bx + px * wd, by + py * wd)]
        d.polygon(right, fill=rgba(dark))
        d.polygon(left, fill=rgba(base))
        d.polygon([(sh[0] - px * wd, sh[1] - py * wd), tip, (sh[0], sh[1])], fill=rgba(light, 210))
        d.line([(bx - px * wd * 0.45, by - py * wd * 0.45), (sh[0] - px * wd * 0.5, sh[1] - py * wd * 0.5)], fill=rgba(light, 230), width=max(1, int(1.6 * s)))
    # 基岩
    for _ in range(4):
        x = cx + rng.normal(0, 10 * s)
        r = rng.uniform(6, 10) * s
        d.ellipse([x - r, cy - r * 0.35, x + r, cy + r * 0.55], fill=rgba(mix("#5a4a3c", dark, 0.3)))


def _paint_rgba(layer: Image.Image, seed: int, sizes=(3, 1.5), bg: str = "#2a2420") -> Image.Image:
    """对带透明的图层做轻度油画处理并保留轮廓。"""
    alpha = layer.split()[3]
    flat = Image.new("RGB", layer.size, hex2rgb(bg))
    flat.paste(layer, (0, 0), layer)
    painted = oil_finish(flat, seed=seed, sizes=sizes, warmth=0.25, vignette=0.0, crackle=False)
    out = painted.convert("RGBA")
    out.putalpha(alpha.filter(ImageFilter.GaussianBlur(0.6)))
    return out


def ore_icon(color: str, size: int = 96) -> Image.Image:
    rng = np.random.default_rng(stable_seed("icon", color))
    sc = 2
    layer = Image.new("RGBA", (size * sc, size * sc), (0, 0, 0, 0))
    ore_cluster(layer, size * sc * 0.5, size * sc * 0.84, size * sc / 96 * (1.7 if color == "gold" else 1.75), color, rng)
    layer = layer.resize((size, size), Image.LANCZOS)
    return _paint_rgba(layer, seed=31, sizes=(2, 1))


def coin(color: str, size: int = 160) -> Image.Image:
    """矿石钱币：金属边 + 珠纹 + 凹陷底座里嵌一簇矿石。"""
    rng = np.random.default_rng(stable_seed("coin", color))
    sc = 2
    S = size * sc
    hi, lo = RIM[color]
    base, light, dark = ORE[color]
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    # 金属边：径向 + 左上受光
    yy, xx = np.mgrid[0:S, 0:S].astype(np.float32)
    cx = cy = S / 2
    r = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2) / (S / 2)
    lightdir = ((cx - xx) + (cy - yy)) / S
    t = np.clip(0.5 + lightdir * 1.2, 0, 1)
    ch, cl = np.array(hex2rgb(hi), np.float32) / 255, np.array(hex2rgb(lo), np.float32) / 255
    metal = cl * (1 - t[..., None]) + ch * t[..., None]
    metal *= (1 + 0.08 * (smooth_noise(rng, S, S, 6) - 0.5))[..., None]
    a = (r <= 0.97).astype(np.float32)
    rgba_arr = np.concatenate([np.clip(metal, 0, 1), a[..., None]], axis=2)
    img = Image.fromarray((rgba_arr * 255).astype(np.uint8), "RGBA")
    d = ImageDraw.Draw(img, "RGBA")
    # 珠纹
    for k in range(28):
        ang = k / 28 * math.tau
        bx, by = cx + math.cos(ang) * S * 0.405, cy + math.sin(ang) * S * 0.405
        rr = S * 0.022
        d.ellipse([bx - rr, by - rr, bx + rr, by + rr], fill=rgba(mix(hi, "#ffffff", 0.2), 230))
        d.ellipse([bx - rr * 0.4, by + rr * 0.1, bx + rr * 0.9, by + rr], fill=rgba(lo, 160))
    # 凹陷底座
    rin = S * 0.36
    well = mix(dark, "#140e0a", 0.55)
    d.ellipse([cx - rin, cy - rin, cx + rin, cy + rin], fill=rgba(lo))
    d.ellipse([cx - rin * 0.95, cy - rin * 0.92, cx + rin * 0.97, cy + rin], fill=rgba(well))
    # 内圈光晕
    glow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse([cx - rin * 0.7, cy - rin * 0.5, cx + rin * 0.7, cy + rin * 0.7], fill=rgba(base, 120))
    glow = glow.filter(ImageFilter.GaussianBlur(S * 0.06))
    img.alpha_composite(glow)
    ore_cluster(img, cx, cy + S * 0.2, S / 160 * (1.35 if color == "gold" else 1.55), color, rng)
    # 外缘暗线
    d = ImageDraw.Draw(img, "RGBA")
    d.ellipse([S * 0.015, S * 0.015, S * 0.985, S * 0.985], outline=rgba(lo, 255), width=int(S * 0.012))
    img = img.resize((size, size), Image.LANCZOS)
    return _paint_rgba(img, seed=77, sizes=(2.2, 1.1), bg=lo)


# ------------------------------------------------------------------ 卡背
TIER_LEATHER = {1: ("#3a5a32", "#1a2a14"), 2: ("#7a3a1c", "#3a1608"), 3: ("#24366a", "#0e1630")}


def _roman(d: ImageDraw.ImageDraw, cx: float, cy: float, n: int, h: float, color, shadow):
    w = h * 0.16
    gap = h * 0.36
    x0 = cx - (n - 1) * gap / 2
    for i in range(n):
        x = x0 + i * gap
        for col, off in ((shadow, h * 0.04), (color, 0)):
            d.rectangle([x - w / 2 + off, cy - h / 2 + off, x + w / 2 + off, cy + h / 2 + off], fill=col)
            d.rectangle([x - w * 1.5 + off, cy - h / 2 + off, x + w * 1.5 + off, cy - h / 2 + w * 0.7 + off], fill=col)
            d.rectangle([x - w * 1.5 + off, cy + h / 2 - w * 0.7 + off, x + w * 1.5 + off, cy + h / 2 + off], fill=col)


def card_back(tier: int, w: int = 300, h: int = 420) -> Image.Image:
    rng = np.random.default_rng(500 + tier)
    sc = 2
    W, H = w * sc, h * sc
    top, bottom = TIER_LEATHER[tier]
    yy = np.linspace(0, 1, H, dtype=np.float32)[:, None, None]
    ct, cb = np.array(hex2rgb(top), np.float32) / 255, np.array(hex2rgb(bottom), np.float32) / 255
    arr = np.broadcast_to(ct * (1 - yy) + cb * yy, (H, W, 3)).copy()
    arr *= (1 + 0.18 * (smooth_noise(rng, H, W, 30) - 0.5) + 0.08 * (smooth_noise(rng, H, W, 4) - 0.5))[..., None]
    img = to_img(arr)
    d = ImageDraw.Draw(img, "RGBA")
    gold, gold_dark = (222, 184, 98, 230), (90, 60, 20, 200)

    def gline(pts, width):
        d.line([(x + 2, y + 2) for x, y in pts], fill=gold_dark, width=width)
        d.line(pts, fill=gold, width=width)

    # 菱格 + 交点四叶纹
    step = 54 * sc / 2
    m = 30 * sc
    for k in range(-20, 20):
        x = k * step * 2
        gline([(x, 0), (x + H, H)], 2)
        gline([(x + H, 0), (x, H)], 2)
    mask = Image.new("L", (W, H), 0)
    ImageDraw.Draw(mask).rounded_rectangle([m, m, W - m, H - m], radius=10 * sc, fill=255)
    clean = to_img(arr)
    clean.paste(img, (0, 0), mask)
    img = clean
    d = ImageDraw.Draw(img, "RGBA")
    for iy in range(-1, int(H / step) + 2):
        for ix in range(-1, int(W / step) + 2):
            if (ix + iy) % 2:
                continue
            x, y = ix * step, iy * step
            if not (m < x < W - m and m < y < H - m):
                continue
            for a in range(4):
                ox, oy = math.cos(a * math.pi / 2) * 6 * sc, math.sin(a * math.pi / 2) * 6 * sc
                d.ellipse([x + ox - 4 * sc, y + oy - 4 * sc, x + ox + 4 * sc, y + oy + 4 * sc], fill=gold)
            d.ellipse([x - 2.5 * sc, y - 2.5 * sc, x + 2.5 * sc, y + 2.5 * sc], fill=(120, 30, 20, 255))
    # 边框
    for inset, wd in ((12 * sc, 5), (20 * sc, 2), (m, 3)):
        d.rounded_rectangle([inset, inset, W - inset, H - inset], radius=12 * sc, outline=gold, width=wd)
    # 中央徽章
    cx, cy, r = W / 2, H / 2, 64 * sc
    d.ellipse([cx - r - 6, cy - r - 6, cx + r + 6, cy + r + 6], fill=gold_dark)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=gold)
    d.ellipse([cx - r * 0.86, cy - r * 0.86, cx + r * 0.86, cy + r * 0.86], fill=hex2rgb(mix(top, "#000000", 0.35)) + (255,))
    for k in range(16):
        a = k / 16 * math.tau
        x, y = cx + math.cos(a) * r * 0.93, cy + math.sin(a) * r * 0.93
        d.ellipse([x - 3 * sc, y - 3 * sc, x + 3 * sc, y + 3 * sc], fill=(255, 236, 170, 255))
    _roman(d, cx, cy, tier, r * 0.9, (236, 200, 110, 255), (40, 24, 8, 220))
    img = img.resize((w, h), Image.LANCZOS)
    return oil_finish(img, seed=600 + tier, sizes=(3, 1.5), warmth=0.3, vignette=0.45, crackle=True)


# ------------------------------------------------------------------ 纹理
def table_felt(w: int = 360, h: int = 540) -> Image.Image:
    """牌桌：深色胡桃木桌面上铺一块墨绿呢布，金线压边。"""
    rng = np.random.default_rng(900)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    grain = np.sin(yy * 0.9 + 6 * smooth_noise(rng, h, w, 40)) * 0.5 + 0.5
    wood = np.array(hex2rgb("#3a2414"), np.float32) / 255
    wood = wood * (0.75 + 0.35 * grain[..., None]) * (1 + 0.2 * (smooth_noise(rng, h, w, 8) - 0.5))[..., None]
    img = to_img(wood)
    d = ImageDraw.Draw(img, "RGBA")
    m = 10
    felt = np.array(hex2rgb("#1f3a2c"), np.float32) / 255
    fa = felt * (1 + 0.12 * (smooth_noise(rng, h, w, 3) - 0.5) + 0.1 * (smooth_noise(rng, h, w, 60) - 0.5))[..., None]
    d2 = (np.sqrt(((xx - w / 2) / (w / 2)) ** 2 + ((yy - h / 2) / (h / 2)) ** 2))
    fa = fa * (1.18 - 0.35 * d2)[..., None]
    fimg = to_img(fa)
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).rounded_rectangle([m, m, w - m, h - m], radius=14, fill=255)
    img.paste(fimg, (0, 0), mask)
    d = ImageDraw.Draw(img, "RGBA")
    d.rounded_rectangle([m, m, w - m, h - m], radius=14, outline=(210, 170, 90, 200), width=2)
    d.rounded_rectangle([m + 5, m + 5, w - m - 5, h - m - 5], radius=10, outline=(210, 170, 90, 90), width=1)
    arr = canvas_weave(to_arr(img), rng, amount=0.04)
    return to_img(varnish(arr, warmth=0.3, vignette=0.3, contrast=1.0))


def wall(w: int = 375, h: int = 812) -> Image.Image:
    """页面背景：暗色锦缎墙纸（重复的花饰纹样）。"""
    rng = np.random.default_rng(901)
    base = np.array(hex2rgb("#1a1414"), np.float32) / 255
    arr = np.broadcast_to(base, (h, w, 3)).copy()
    arr *= (1 + 0.25 * (smooth_noise(rng, h, w, 80) - 0.5))[..., None]
    img = to_img(arr)
    pat = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(pat)
    col = (120, 70, 50, 70)
    tw, th = 62, 86
    for j in range(-1, h // th + 2):
        for i in range(-1, w // tw + 2):
            cx = i * tw + (tw / 2 if j % 2 else 0)
            cy = j * th
            # 简化的鸢尾花纹（fleur-de-lis）
            d.polygon([(cx, cy - 22), (cx + 6, cy - 6), (cx, cy + 4), (cx - 6, cy - 6)], fill=col)
            d.polygon([(cx - 3, cy - 4), (cx - 18, cy - 14), (cx - 20, cy + 2), (cx - 6, cy + 4)], fill=col)
            d.polygon([(cx + 3, cy - 4), (cx + 18, cy - 14), (cx + 20, cy + 2), (cx + 6, cy + 4)], fill=col)
            d.rectangle([cx - 10, cy + 4, cx + 10, cy + 8], fill=col)
            d.polygon([(cx - 4, cy + 8), (cx + 4, cy + 8), (cx, cy + 18)], fill=col)
            for k in range(4):
                a = k * math.pi / 2 + math.pi / 4
                x, y = cx + tw / 2 + math.cos(a) * 5, cy + th / 2 + math.sin(a) * 5
                d.ellipse([x - 2.5, y - 2.5, x + 2.5, y + 2.5], fill=(150, 110, 60, 50))
    pat = pat.filter(ImageFilter.GaussianBlur(0.6))
    img = img.convert("RGBA")
    img.alpha_composite(pat)
    arr = canvas_weave(to_arr(img.convert("RGB")), rng, amount=0.05)
    return to_img(varnish(arr, warmth=0.2, vignette=0.6, contrast=1.0))
