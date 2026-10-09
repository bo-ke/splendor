"""油画质感渲染：笔触模拟（多尺度、沿边缘走向）+ 厚涂高光 + 画布纹理 + 老化清漆。"""

from __future__ import annotations

import math
import zlib

import numpy as np
from PIL import Image, ImageDraw, ImageFilter


def stable_seed(*parts) -> int:
    """与 PYTHONHASHSEED 无关的稳定种子，保证每次生成的图一致。"""
    return zlib.crc32("|".join(map(str, parts)).encode())


def to_arr(img: Image.Image) -> np.ndarray:
    return np.asarray(img.convert("RGB")).astype(np.float32) / 255.0


def to_img(arr: np.ndarray) -> Image.Image:
    return Image.fromarray((np.clip(arr, 0, 1) * 255 + 0.5).astype(np.uint8))


def smooth_noise(rng: np.random.Generator, h: int, w: int, cell: float) -> np.ndarray:
    """低频平滑噪声，取值约 0..1。"""
    sh, sw = max(2, int(h / cell) + 2), max(2, int(w / cell) + 2)
    small = Image.fromarray((rng.random((sh, sw)) * 255).astype(np.uint8))
    big = small.resize((w, h), Image.BICUBIC)
    return np.asarray(big).astype(np.float32) / 255.0


def painterly(
    img: Image.Image,
    rng: np.random.Generator,
    sizes=(10, 5, 2.5),
    threshold: float = 0.06,
    base_angle: float = 0.6,
):
    """多尺度笔触重绘。返回 (画面, 笔触高度图)。"""
    w, h = img.size
    canvas = img.filter(ImageFilter.GaussianBlur(sizes[0]))
    height = Image.new("L", (w, h), 128)
    for level, r in enumerate(sizes):
        ref_img = img.filter(ImageFilter.GaussianBlur(max(0.6, r * 0.5)))
        ref = to_arr(ref_img)
        lum = ref @ np.array([0.3, 0.59, 0.11], dtype=np.float32)
        lum_s = to_arr(Image.fromarray((lum * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(r)).convert("RGB"))[..., 0]
        gy, gx = np.gradient(lum_s)
        mag = np.hypot(gx, gy)
        cur = to_arr(canvas)
        diff = np.abs(cur - ref).sum(axis=2)

        step = max(1, int(round(r)))
        pts = []
        for y in range(0, h, step):
            for x in range(0, w, step):
                jx = min(w - 1, max(0, x + int(rng.integers(-step // 2, step // 2 + 1))))
                jy = min(h - 1, max(0, y + int(rng.integers(-step // 2, step // 2 + 1))))
                if level == 0 or diff[jy, jx] > threshold:
                    pts.append((jx, jy))
        order = rng.permutation(len(pts))

        draw = ImageDraw.Draw(canvas, "RGBA")
        hd = ImageDraw.Draw(height)
        width = max(1, int(round(r * 1.5)))
        for i in order:
            x, y = pts[i]
            c = ref[y, x] + rng.normal(0, 0.022, 3)
            if mag[y, x] > 0.004:
                ang = math.atan2(gy[y, x], gx[y, x]) + math.pi / 2
            else:
                ang = base_angle + rng.normal(0, 0.35)
            length = r * rng.uniform(1.6, 3.4)
            dx, dy = math.cos(ang) * length / 2, math.sin(ang) * length / 2
            col = tuple(int(v) for v in np.clip(c, 0, 1) * 255)
            seg = [(x - dx, y - dy), (x + dx, y + dy)]
            draw.line(seg, fill=col + (230,), width=width)
            hd.line(seg, fill=int(rng.integers(70, 210)), width=width)
    return canvas, height


def impasto(canvas: Image.Image, height: Image.Image, strength: float = 0.55) -> np.ndarray:
    """根据笔触高度图做浮雕光照，模拟颜料厚度。"""
    hmap = np.asarray(height.filter(ImageFilter.GaussianBlur(0.8))).astype(np.float32) / 255.0
    gy, gx = np.gradient(hmap)
    shade = 1.0 + strength * (-gx * 0.7 - gy * 0.7)
    return to_arr(canvas) * shade[..., None]


def canvas_weave(arr: np.ndarray, rng: np.random.Generator, amount: float = 0.03) -> np.ndarray:
    h, w = arr.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    weave = np.sin(xx * 2.1) * np.sin(yy * 2.1)
    grain = rng.normal(0, 1, (h, w)).astype(np.float32)
    t = 0.7 * weave + 0.3 * grain
    return arr * (1 - amount * 0.5 + amount * 0.5 * t)[..., None]


def varnish(arr: np.ndarray, warmth: float = 0.45, vignette: float = 0.5, contrast: float = 1.15) -> np.ndarray:
    """老化清漆：暖黄偏色、暗部偏棕、暗角。"""
    h, w = arr.shape[:2]
    a = np.clip(arr, 0, 1) ** contrast
    a = a + 0.18 * (a - 0.5) * (1 - np.abs(a - 0.5) * 2)  # S 曲线：亮处更亮、暗处更暗
    warm = a * np.array([1.04, 0.96, 0.80], dtype=np.float32)
    a = a * (1 - warmth) + warm * warmth
    umber = np.array([0.10, 0.06, 0.03], dtype=np.float32)
    lum = a.mean(axis=2, keepdims=True)
    a = a + (1 - lum) ** 3 * umber * 0.6
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    d = np.sqrt(((xx - w / 2) / (w / 2)) ** 2 + ((yy - h / 2) / (h / 2)) ** 2) / math.sqrt(2)
    a = a * (1 - vignette * np.clip(d - 0.35, 0, 1) ** 1.6)[..., None]
    return a


def craquelure(arr: np.ndarray, rng: np.random.Generator, n: int = 60, alpha: float = 0.07) -> np.ndarray:
    """细微龟裂纹。"""
    h, w = arr.shape[:2]
    layer = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(layer)
    for _ in range(n):
        x, y = rng.uniform(0, w), rng.uniform(0, h)
        ang = rng.uniform(0, math.tau)
        pts = [(x, y)]
        for _ in range(int(rng.integers(4, 10))):
            ang += rng.normal(0, 0.7)
            step = rng.uniform(4, 12)
            x, y = x + math.cos(ang) * step, y + math.sin(ang) * step
            pts.append((x, y))
        d.line(pts, fill=255, width=1)
    m = np.asarray(layer).astype(np.float32) / 255.0
    return arr * (1 - alpha * m)[..., None]


def oil_finish(
    img: Image.Image,
    seed: int,
    sizes=(10, 5, 2.5),
    warmth: float = 0.45,
    vignette: float = 0.5,
    crackle: bool = True,
) -> Image.Image:
    rng = np.random.default_rng(seed)
    canvas, height = painterly(img, rng, sizes=sizes)
    arr = impasto(canvas, height)
    arr = canvas_weave(arr, rng)
    arr = varnish(arr, warmth=warmth, vignette=vignette)
    if crackle:
        arr = craquelure(arr, rng)
    return to_img(arr)
