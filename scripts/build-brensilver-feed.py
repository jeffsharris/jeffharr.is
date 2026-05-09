#!/usr/bin/env python3
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TOOL_ROOT = ROOT / "tools" / "brensilver-feed"
sys.path.insert(0, str(TOOL_ROOT / "src"))

from brensilver.build import main


if __name__ == "__main__":
    raise SystemExit(
        main(
            [
                "--config",
                str(TOOL_ROOT / "config" / "sources.json"),
                "--out-dir",
                str(ROOT / "brensilver"),
            ]
            + sys.argv[1:]
        )
    )
