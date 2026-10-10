"""把小程序的规则引擎复制进云函数（云函数单独部署，不能 require 小程序目录里的文件）。

用法: python scripts/sync_cloud_engine.py
JS 测试会检查两份是否一致。
"""

from __future__ import annotations

import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "miniprogram" / "engine"
DST = ROOT / "cloudfunctions" / "ore" / "engine"
FILES = ["game.js", "ai.js", "data.js"]


def main() -> None:
    DST.mkdir(parents=True, exist_ok=True)
    for name in FILES:
        shutil.copyfile(SRC / name, DST / name)
    print(f"synced {', '.join(FILES)} -> {DST.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
