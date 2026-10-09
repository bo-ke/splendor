"""程序化中世纪场景：天空、山脉、矿洞、马车、帆船、城堡、矿石晶簇。

所有坐标都以“输出像素”为单位；内部以 2 倍分辨率绘制再缩小，保证边缘柔和。
"""

from __future__ import annotations

import math

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from .paint import smooth_noise


def hex2rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def mix(a: str, b: str, t: float) -> str:
    ra, rb = hex2rgb(a), hex2rgb(b)
    return "#" + "".join(f"{round(ra[i] + (rb[i] - ra[i]) * t):02x}" for i in range(3))


def rgba(c, a: int = 255):
    if isinstance(c, str):
        return hex2rgb(c) + (a,)
    return tuple(c[:3]) + (a,)


class Canvas:
    def __init__(self, w: int, h: int, rng: np.random.Generator, scale: int = 2):
        self.w, self.h, self.s, self.rng = w, h, scale, rng
        self.img = Image.new("RGB", (w * scale, h * scale), (0, 0, 0))
        self.d = ImageDraw.Draw(self.img, "RGBA")

    # -------------------------------------------------------------- 基础
    def P(self, pts):
        return [(x * self.s, y * self.s) for x, y in pts]

    def poly(self, pts, fill, a: int = 255):
        self.d.polygon(self.P(pts), fill=rgba(fill, a))

    def rect(self, x0, y0, x1, y1, fill, a: int = 255):
        self.d.rectangle([x0 * self.s, y0 * self.s, x1 * self.s, y1 * self.s], fill=rgba(fill, a))

    def ellipse(self, cx, cy, rx, ry, fill, a: int = 255):
        s = self.s
        self.d.ellipse([(cx - rx) * s, (cy - ry) * s, (cx + rx) * s, (cy + ry) * s], fill=rgba(fill, a))

    def line(self, pts, fill, width: float, a: int = 255):
        self.d.line(self.P(pts), fill=rgba(fill, a), width=max(1, int(width * self.s)))

    def arr(self) -> np.ndarray:
        return np.asarray(self.img).astype(np.float32) / 255.0

    def set_arr(self, a: np.ndarray) -> None:
        self.img = Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8))
        self.d = ImageDraw.Draw(self.img, "RGBA")

    def mask(self) -> tuple[Image.Image, ImageDraw.ImageDraw]:
        m = Image.new("L", self.img.size, 0)
        return m, ImageDraw.Draw(m)

    def fill_mask(self, m: Image.Image, top: str, bottom: str, y0: float, y1: float, tex: float = 0.12, blur: float = 0.6):
        """用竖直渐变 + 纹理噪声填充一个形状遮罩。"""
        H, W = self.img.size[1], self.img.size[0]
        yy = np.linspace(0, 1, H, dtype=np.float32)[:, None]
        t = np.clip((yy * self.h - y0) / max(1, y1 - y0), 0, 1)
        ct, cb = np.array(hex2rgb(top), np.float32) / 255, np.array(hex2rgb(bottom), np.float32) / 255
        col = ct[None, None, :] * (1 - t[..., None]) + cb[None, None, :] * t[..., None]
        n = smooth_noise(self.rng, H, W, 18 * self.s) - 0.5
        n2 = smooth_noise(self.rng, H, W, 5 * self.s) - 0.5
        col = col * (1 + tex * (n + 0.5 * n2))[..., None]
        mk = np.asarray(m.filter(ImageFilter.GaussianBlur(blur * self.s))).astype(np.float32)[..., None] / 255.0
        self.set_arr(self.arr() * (1 - mk) + col * mk)

    def glow(self, cx, cy, r, color: str, strength: float = 0.6):
        H, W = self.img.size[1], self.img.size[0]
        yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
        d = np.sqrt((xx - cx * self.s) ** 2 + (yy - cy * self.s) ** 2) / (r * self.s)
        g = np.exp(-(d**2) * 2.2)[..., None] * strength
        c = np.array(hex2rgb(color), np.float32) / 255
        a = self.arr()
        self.set_arr(a + (1 - a) * g * c)  # 滤色叠加

    def shade_band(self, y0, y1, color: str, alpha: float):
        """在一段高度上叠一层颜色（雾气 / 地面阴影）。"""
        H = self.img.size[1]
        yy = np.linspace(0, self.h, H, dtype=np.float32)[:, None]
        t = np.clip((yy - y0) / max(1, y1 - y0), 0, 1)
        t = np.sin(t * math.pi)[..., None] * alpha
        c = np.array(hex2rgb(color), np.float32) / 255
        a = self.arr()
        self.set_arr(a * (1 - t) + c * t)

    def result(self) -> Image.Image:
        return self.img.resize((self.w, self.h), Image.LANCZOS)

    # -------------------------------------------------------------- 自然
    def sky(self, top: str, horizon: str, y_horizon: float):
        H, W = self.img.size[1], self.img.size[0]
        yy = np.linspace(0, self.h, H, dtype=np.float32)[:, None]
        t = np.clip(yy / y_horizon, 0, 1) ** 1.3
        ct, ch = np.array(hex2rgb(top), np.float32) / 255, np.array(hex2rgb(horizon), np.float32) / 255
        col = ct * (1 - t[..., None]) + ch * t[..., None]
        col = np.broadcast_to(col, (H, W, 3)).copy()
        self.set_arr(col)

    def clouds(self, n: int, y0: float, y1: float, color: str, a: int = 120):
        layer = Image.new("RGBA", self.img.size, (0, 0, 0, 0))
        d = ImageDraw.Draw(layer)
        s = self.s
        for _ in range(n):
            cx, cy = self.rng.uniform(-20, self.w + 20), self.rng.uniform(y0, y1)
            for _ in range(int(self.rng.integers(3, 7))):
                rx, ry = self.rng.uniform(18, 46), self.rng.uniform(7, 15)
                ox, oy = self.rng.normal(0, 22), self.rng.normal(0, 5)
                d.ellipse([(cx + ox - rx) * s, (cy + oy - ry) * s, (cx + ox + rx) * s, (cy + oy + ry) * s], fill=rgba(color, a))
        layer = layer.filter(ImageFilter.GaussianBlur(7 * s))
        self.img.paste(layer, (0, 0), layer)
        self.d = ImageDraw.Draw(self.img, "RGBA")

    def ridge_pts(self, y: float, amp: float, rough: float = 0.55, peaks: int = 3):
        """随机高斯山峰叠加 + 细碎起伏，比正弦更自然。"""
        xs = np.linspace(-10, self.w + 10, 140)
        hgt = np.zeros_like(xs)
        for _ in range(peaks + 2):
            cx = self.rng.uniform(-0.1, 1.1) * self.w
            wd = self.rng.uniform(0.12, 0.32) * self.w
            hgt = np.maximum(hgt, self.rng.uniform(0.45, 1.0) * np.exp(-(((xs - cx) / wd) ** 2)))
        detail = np.zeros_like(xs)
        freq, a = 6 / self.w, 1.0
        for _ in range(4):
            detail += a * np.sin(xs * freq * math.tau + self.rng.uniform(0, math.tau))
            freq *= 2.2
            a *= 0.5
        hgt = hgt + rough * 0.12 * detail
        hgt = (hgt - hgt.min()) / (hgt.max() - hgt.min() + 1e-6)
        return [(float(x), float(y - amp * h)) for x, h in zip(xs, hgt)]

    def mountains(self, y: float, amp: float, top: str, bottom: str, snow: str | None = None, peaks: int = 3, rough=0.55):
        pts = self.ridge_pts(y, amp, rough, peaks)
        m, md = self.mask()
        md.polygon(self.P(pts + [(self.w + 10, self.h + 10), (-10, self.h + 10)]), fill=255)
        self.fill_mask(m, top, bottom, y - amp, y + 40, tex=0.16)
        if snow:
            sm, sd = self.mask()
            cap = [(x, yy) for x, yy in pts]
            line = [(x, min(yy + self.rng.uniform(8, 18) + amp * 0.25, y)) for x, yy in reversed(pts)]
            sd.polygon(self.P(cap + line), fill=255)
            sm = Image.fromarray(np.minimum(np.asarray(sm), np.asarray(m)))
            self.fill_mask(sm, snow, mix(snow, bottom, 0.35), y - amp, y, tex=0.1)
        return pts

    def ground(self, y: float, top: str, bottom: str, amp: float = 10):
        return self.mountains(y, amp, top, bottom, peaks=2, rough=0.4)

    def water(self, y: float, top: str, bottom: str, glint: str):
        m, md = self.mask()
        md.rectangle([0, y * self.s, self.img.size[0], self.img.size[1]], fill=255)
        self.fill_mask(m, top, bottom, y, self.h, tex=0.08)
        for _ in range(40):
            yy = self.rng.uniform(y + 3, self.h)
            x = self.rng.uniform(0, self.w)
            ln = self.rng.uniform(8, 40) * (0.4 + (yy - y) / (self.h - y))
            self.line([(x, yy), (x + ln, yy)], glint, 1.2, a=int(self.rng.integers(50, 140)))

    def tree(self, x: float, y: float, s: float, dark: str, light: str):
        self.line([(x, y), (x, y - 14 * s)], "#3a2616", 2.4 * s)
        for i in range(6):
            ox, oy = self.rng.normal(0, 5 * s), -14 * s - self.rng.uniform(0, 16 * s)
            r = self.rng.uniform(6, 10) * s
            self.ellipse(x + ox, y + oy, r, r * 0.9, mix(dark, light, i / 6))

    def pine(self, x: float, y: float, s: float, color: str):
        self.line([(x, y), (x, y - 6 * s)], "#2b1d12", 2 * s)
        for i in range(4):
            w, top = (10 - i * 2) * s, y - (6 + i * 7) * s
            self.poly([(x - w, top), (x + w, top), (x, top - 12 * s)], mix(color, "#000000", 0.15 * (3 - i)))

    def crystals(self, x: float, y: float, s: float, base: str, light: str, dark: str, n: int = 5, spread: float = 1.0):
        """一簇矿石晶体（六棱柱），左面受光、右面背光。"""
        self.glow(x, y - 10 * s, 26 * s, light, 0.35)
        for i in range(n):
            ang = math.radians(-90 + self.rng.normal(0, 28) * spread)
            ln = self.rng.uniform(16, 30) * s * (1.2 if i == 0 else 1.0)
            wd = self.rng.uniform(4, 6.5) * s
            bx, by = x + self.rng.normal(0, 6 * s) * spread, y + self.rng.uniform(-2, 2)
            dx, dy = math.cos(ang), math.sin(ang)
            px, py = -dy, dx
            tipx, tipy = bx + dx * ln, by + dy * ln
            shx, shy = bx + dx * ln * 0.78, by + dy * ln * 0.78
            left = [(bx - px * wd, by - py * wd), (shx - px * wd, shy - py * wd), (tipx, tipy), (bx, by)]
            right = [(bx, by), (tipx, tipy), (shx + px * wd, shy + py * wd), (bx + px * wd, by + py * wd)]
            self.poly(right, dark)
            self.poly(left, base)
            self.line([(bx - px * wd * 0.3, by - py * wd * 0.3), (shx - px * wd * 0.4, shy - py * wd * 0.4)], light, 1.2 * s, a=200)

    def rocks(self, x: float, y: float, s: float, color: str, n: int = 4):
        for _ in range(n):
            ox = self.rng.normal(0, 10 * s)
            r = self.rng.uniform(5, 10) * s
            self.ellipse(x + ox, y - r * 0.4, r, r * 0.7, mix(color, "#000000", self.rng.uniform(0, 0.4)))
            self.ellipse(x + ox - r * 0.3, y - r * 0.6, r * 0.5, r * 0.3, mix(color, "#ffffff", 0.18), a=160)

    # -------------------------------------------------------------- 人造物
    def figure(self, x: float, y: float, s: float, robe: str, hood: bool = True):
        self.poly([(x - 4 * s, y), (x + 4 * s, y), (x + 2.2 * s, y - 11 * s), (x - 2.2 * s, y - 11 * s)], robe)
        self.ellipse(x, y - 13 * s, 2.3 * s, 2.6 * s, "#c99a74" if not hood else mix(robe, "#000000", 0.25))
        if hood:
            self.ellipse(x + 0.6 * s, y - 12.6 * s, 1.4 * s, 1.7 * s, "#b88a66")

    def castle(self, x: float, base: float, s: float, wall: str, shadow: str, roof: str, window: str, flag: str):
        def tower(cx, w, h, roof_h):
            self.rect(cx - w, base - h, cx + w, base, wall)
            self.rect(cx + w * 0.25, base - h, cx + w, base, shadow, a=150)
            if roof_h:
                self.poly([(cx - w * 1.2, base - h), (cx + w * 1.2, base - h), (cx, base - h - roof_h)], roof)
                self.poly([(cx, base - h - roof_h), (cx + w * 1.2, base - h), (cx + w * 0.2, base - h)], mix(roof, "#000000", 0.35))
            else:
                for k in range(-2, 3):
                    self.rect(cx + k * w * 0.42 - w * 0.14, base - h - w * 0.35, cx + k * w * 0.42 + w * 0.14, base - h, wall)
            for k in range(int(h / (14 * s))):
                wy = base - h + 8 * s + k * 14 * s
                self.rect(cx - w * 0.18, wy, cx + w * 0.18, wy + 4.5 * s, window)

        self.rect(x - 46 * s, base - 30 * s, x + 46 * s, base, wall)
        self.rect(x - 46 * s, base - 30 * s, x + 46 * s, base - 26 * s, mix(wall, "#ffffff", 0.12))
        for k in range(-9, 10, 2):
            self.rect(x + k * 4.9 * s - 2 * s, base - 34 * s, x + k * 4.9 * s + 2 * s, base - 30 * s, wall)
        tower(x - 46 * s, 8 * s, 52 * s, 20 * s)
        tower(x + 46 * s, 8 * s, 48 * s, 18 * s)
        tower(x, 14 * s, 78 * s, 0)
        tower(x - 22 * s, 7 * s, 62 * s, 24 * s)
        tower(x + 24 * s, 7 * s, 58 * s, 22 * s)
        self.line([(x, base - 89 * s), (x, base - 108 * s)], "#3a2a1a", 1.4 * s)
        self.poly([(x, base - 108 * s), (x + 13 * s, base - 104 * s), (x, base - 100 * s)], flag)
        # 城门
        self.rect(x - 6 * s, base - 14 * s, x + 6 * s, base, "#1a120c")
        self.ellipse(x, base - 14 * s, 6 * s, 5 * s, "#1a120c")

    def cathedral(self, x: float, base: float, s: float, wall: str, shadow: str, roof: str, window: str):
        self.rect(x - 34 * s, base - 40 * s, x + 30 * s, base, wall)
        self.poly([(x - 36 * s, base - 40 * s), (x + 32 * s, base - 40 * s), (x - 2 * s, base - 62 * s)], roof)
        self.rect(x + 8 * s, base - 40 * s, x + 30 * s, base, shadow, a=120)
        self.rect(x - 12 * s, base - 92 * s, x + 4 * s, base, wall)
        self.rect(x - 2 * s, base - 92 * s, x + 4 * s, base, shadow, a=140)
        self.poly([(x - 14 * s, base - 92 * s), (x + 6 * s, base - 92 * s), (x - 4 * s, base - 140 * s)], roof)
        self.ellipse(x - 4 * s, base - 70 * s, 4 * s, 4 * s, window)
        for k in range(4):
            wx = x - 28 * s + k * 14 * s
            self.rect(wx, base - 30 * s, wx + 5 * s, base - 14 * s, window)
            self.ellipse(wx + 2.5 * s, base - 30 * s, 2.5 * s, 2.5 * s, window)

    def town(self, x0: float, x1: float, base: float, s: float, wall: str, roof: str, window: str | None = None):
        x = x0
        while x < x1:
            w = self.rng.uniform(7, 13) * s
            h = self.rng.uniform(8, 16) * s
            self.rect(x, base - h, x + w, base, mix(wall, "#000000", self.rng.uniform(0, 0.25)))
            self.poly([(x - 1.5 * s, base - h), (x + w + 1.5 * s, base - h), (x + w / 2, base - h - w * 0.7)], roof)
            if window and self.rng.random() < 0.6:
                self.rect(x + w * 0.35, base - h * 0.6, x + w * 0.6, base - h * 0.35, window)
            x += w + self.rng.uniform(-2, 2) * s
        sx = (x0 + x1) / 2 + self.rng.uniform(-10, 10)
        self.rect(sx - 4 * s, base - 34 * s, sx + 4 * s, base, wall)
        self.poly([(sx - 5 * s, base - 34 * s), (sx + 5 * s, base - 34 * s), (sx, base - 52 * s)], roof)

    def mine(self, x: float, y: float, s: float, rock: str, timber: str):
        self.ellipse(x, y - 30 * s, 24 * s, 22 * s, "#0d0806")
        self.rect(x - 24 * s, y - 30 * s, x + 24 * s, y, "#0d0806")
        self.glow(x, y - 14 * s, 14 * s, "#ff9a3c", 0.45)
        self.line([(x - 22 * s, y), (x - 20 * s, y - 40 * s)], timber, 5 * s)
        self.line([(x + 22 * s, y), (x + 20 * s, y - 40 * s)], mix(timber, "#000000", 0.35), 5 * s)
        self.line([(x - 28 * s, y - 40 * s), (x + 28 * s, y - 42 * s)], timber, 5.5 * s)
        self.line([(x - 20 * s, y - 36 * s), (x - 8 * s, y - 40 * s)], mix(timber, "#000000", 0.3), 2.5 * s)
        # 铁轨
        for k in range(6):
            yy = y + 4 * s + k * 9 * s
            self.line([(x - 10 * s - k * 6 * s, yy), (x + 10 * s + k * 6 * s, yy)], "#3b2a1c", 2.2 * s)
        self.line([(x - 6 * s, y), (x - 40 * s, y + 52 * s)], "#5d5a58", 1.6 * s)
        self.line([(x + 6 * s, y), (x + 40 * s, y + 52 * s)], "#5d5a58", 1.6 * s)

    def cart(self, x: float, y: float, s: float, wood: str, ore: tuple[str, str, str]):
        base, light, dark = ore
        for k in range(7):
            self.ellipse(x - 12 * s + k * 4 * s, y - 18 * s - self.rng.uniform(0, 4) * s, 4.5 * s, 3.5 * s, mix(base, light if k % 2 else dark, 0.4))
        self.poly([(x - 18 * s, y - 18 * s), (x + 18 * s, y - 18 * s), (x + 14 * s, y - 4 * s), (x - 14 * s, y - 4 * s)], wood)
        self.line([(x - 18 * s, y - 18 * s), (x + 18 * s, y - 18 * s)], mix(wood, "#ffffff", 0.2), 1.4 * s)
        self.line([(x - 15 * s, y - 11 * s), (x + 15 * s, y - 11 * s)], mix(wood, "#000000", 0.35), 1.4 * s)
        for wx in (x - 9 * s, x + 9 * s):
            self.ellipse(wx, y - 2 * s, 5 * s, 5 * s, "#2a1d14")
            self.ellipse(wx, y - 2 * s, 2 * s, 2 * s, "#6b5440")

    def wagon(self, x: float, y: float, s: float, wood: str, cover: str, horse: str):
        # 马
        dark = mix(horse, "#000000", 0.35)
        for lx in (-44, -40, -30, -26):
            self.line([(x + lx * s, y - 13 * s), (x + (lx - 1) * s, y - 6 * s), (x + lx * s, y)], dark, 2.6 * s)
        self.ellipse(x - 35 * s, y - 18 * s, 13 * s, 7.5 * s, horse)
        self.ellipse(x - 35 * s, y - 15 * s, 11 * s, 4 * s, dark, a=90)
        self.poly([(x - 42 * s, y - 22 * s), (x - 50 * s, y - 34 * s), (x - 45 * s, y - 37 * s), (x - 37 * s, y - 24 * s)], horse)
        self.poly([(x - 50 * s, y - 35 * s), (x - 46 * s, y - 38 * s), (x - 55 * s, y - 29 * s), (x - 57 * s, y - 31 * s)], horse)
        self.line([(x - 44 * s, y - 37 * s), (x - 39 * s, y - 25 * s)], "#2a1a10", 2 * s)
        self.line([(x - 22 * s, y - 20 * s), (x - 19 * s, y - 10 * s)], "#2a1a10", 2.2 * s)
        self.line([(x - 22 * s, y - 14 * s), (x - 14 * s, y - 12 * s)], "#3a2a1a", 1.5 * s)
        # 车身 + 篷布
        self.rect(x - 16 * s, y - 16 * s, x + 26 * s, y - 6 * s, wood)
        self.ellipse(x + 5 * s, y - 16 * s, 22 * s, 18 * s, cover)
        self.rect(x - 17 * s, y - 16 * s, x + 27 * s, y - 15 * s, mix(wood, "#000000", 0.4))
        self.poly([(x + 5 * s, y - 34 * s), (x + 27 * s, y - 16 * s), (x + 12 * s, y - 16 * s)], mix(cover, "#000000", 0.28))
        for wx in (x - 8 * s, x + 18 * s):
            self.ellipse(wx, y - 4 * s, 6.5 * s, 6.5 * s, "#2a1d14")
            self.ellipse(wx, y - 4 * s, 4.5 * s, 4.5 * s, mix(wood, "#000000", 0.2))
            self.ellipse(wx, y - 4 * s, 1.5 * s, 1.5 * s, "#2a1d14")

    def ship(self, x: float, y: float, s: float, hull: str, sail: str, emblem: str):
        self.poly([(x - 40 * s, y - 14 * s), (x + 44 * s, y - 16 * s), (x + 30 * s, y + 2 * s), (x - 30 * s, y + 2 * s)], hull)
        self.line([(x - 38 * s, y - 10 * s), (x + 40 * s, y - 12 * s)], mix(hull, "#ffffff", 0.2), 1.4 * s)
        self.rect(x - 40 * s, y - 24 * s, x - 22 * s, y - 14 * s, mix(hull, "#000000", 0.15))
        self.line([(x + 2 * s, y - 15 * s), (x + 2 * s, y - 90 * s)], "#2e2016", 2.4 * s)
        self.poly([(x - 22 * s, y - 82 * s), (x + 26 * s, y - 82 * s), (x + 30 * s, y - 30 * s), (x - 24 * s, y - 30 * s)], sail)
        self.poly([(x + 2 * s, y - 82 * s), (x + 26 * s, y - 82 * s), (x + 30 * s, y - 30 * s), (x + 4 * s, y - 30 * s)], mix(sail, "#000000", 0.22))
        self.ellipse(x + 2 * s, y - 56 * s, 8 * s, 8 * s, emblem)
        self.poly([(x + 2 * s, y - 90 * s), (x + 16 * s, y - 87 * s), (x + 2 * s, y - 84 * s)], emblem)
        self.line([(x + 2 * s, y - 88 * s), (x + 46 * s, y - 16 * s)], "#2e2016", 0.8 * s, a=160)
        self.line([(x + 2 * s, y - 88 * s), (x - 40 * s, y - 20 * s)], "#2e2016", 0.8 * s, a=160)
