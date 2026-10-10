"""把 splendor/data/*.json 同步为小程序可 require 的 miniprogram/engine/data.js。

用法: python scripts/gen_miniprogram_data.py
（小程序对 require JSON 的支持不稳定，因此生成 CommonJS 模块。）
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "splendor" / "data"
OUT = ROOT / "miniprogram" / "engine" / "data.js"


def main() -> None:
    cards = json.loads((SRC / "development_cards.json").read_text(encoding="utf-8"))
    nobles = json.loads((SRC / "nobles.json").read_text(encoding="utf-8"))
    body = (
        "// 由 scripts/gen_miniprogram_data.py 从 splendor/data/*.json 生成，请勿手改。\n"
        f"const CARDS = {json.dumps(cards, ensure_ascii=False, separators=(',', ':'))};\n"
        f"const NOBLES = {json.dumps(nobles, ensure_ascii=False, separators=(',', ':'))};\n"
        "module.exports = { CARDS, NOBLES };\n"
    )
    OUT.write_text(body, encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)}: {len(cards)} cards, {len(nobles)} nobles")


if __name__ == "__main__":
    main()
