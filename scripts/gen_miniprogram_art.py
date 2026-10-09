"""生成小程序「矿石」的油画风美术资源到 miniprogram/assets/。

用法: python scripts/gen_miniprogram_art.py      （需要 pillow、numpy）

- art/cards/<color><tier>.jpg  发展卡插画（5 种矿石 × 3 层：矿脉 / 商路 / 城邦）
- art/nobles/<id>.jpg          贵族侧面肖像
- art/backs/tier<n>.jpg        三层卡背（烫金皮革）
- art/coins/<color>.png        矿石钱币（代币）
- art/ores/<color>.png         矿石图标（卡牌右上角）
- art/table.jpg / art/wall.jpg 牌桌呢布、锦缎墙纸
- crown.svg                    声望图标

全部为程序生成，固定种子，重复运行结果一致。
"""

from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from PIL import Image  # noqa: E402

from oreart.cards import card_art  # noqa: E402
from oreart.portraits import portrait  # noqa: E402
from oreart.props import card_back, coin, ore_icon, table_felt, wall  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "miniprogram" / "assets"
COLORS = ["white", "blue", "green", "red", "black"]

CROWN = (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">'
    '<defs><linearGradient id="c" x1="0" y1="0" x2="0" y2="1">'
    '<stop offset="0" stop-color="#ffe58a"/><stop offset="1" stop-color="#d08f0c"/></linearGradient></defs>'
    '<path d="M3,18 L4.5,7 L9,12 L12,4.5 L15,12 L19.5,7 L21,18 Z" fill="url(#c)" stroke="#7a5200" '
    'stroke-width="1.1" stroke-linejoin="round"/>'
    '<rect x="3" y="18.5" width="18" height="2.6" rx="1" fill="url(#c)" stroke="#7a5200" stroke-width="0.8"/></svg>\n'
)


def main() -> None:
    art = OUT / "art"
    if art.exists():
        shutil.rmtree(art)
    for sub in ("cards", "nobles", "backs", "coins", "ores"):
        (art / sub).mkdir(parents=True)

    for color in COLORS:
        for tier in (1, 2, 3):
            card_art(color, tier).save(art / "cards" / f"{color}{tier}.jpg", quality=80, optimize=True, progressive=True)
            print(".", end="", flush=True)
    nobles = json.loads((ROOT / "splendor" / "data" / "nobles.json").read_text(encoding="utf-8"))
    for i, n in enumerate(nobles):
        portrait(i, list(n["requirement"].keys())).save(art / "nobles" / f"{n['id']}.jpg", quality=82, optimize=True)
    for tier in (1, 2, 3):
        card_back(tier).save(art / "backs" / f"tier{tier}.jpg", quality=82, optimize=True, progressive=True)
    for color in [*COLORS, "gold"]:
        # 带透明的 PNG 量化为 8 位调色板，体积约为原来的 1/3
        coin(color, size=140).quantize(colors=160, method=Image.FASTOCTREE, dither=Image.NONE).save(
            art / "coins" / f"{color}.png", optimize=True
        )
        ore_icon(color, size=84).quantize(colors=96, method=Image.FASTOCTREE, dither=Image.NONE).save(
            art / "ores" / f"{color}.png", optimize=True
        )
    table_felt().save(art / "table.jpg", quality=78, optimize=True)
    wall().save(art / "wall.jpg", quality=72, optimize=True)
    (OUT / "crown.svg").write_text(CROWN, encoding="utf-8")

    total = sum(p.stat().st_size for p in OUT.rglob("*") if p.is_file())
    print(f"\nwrote assets to {OUT.relative_to(ROOT)} ({total / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
