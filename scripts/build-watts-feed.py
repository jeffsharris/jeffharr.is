#!/usr/bin/env python3
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TOOL_ROOT = ROOT / "tools" / "brensilver-feed"
sys.path.insert(0, str(TOOL_ROOT / "src"))

from brensilver.build import main


if __name__ == "__main__":
    args = [
        "--config",
        str(TOOL_ROOT / "config" / "watts.json"),
        "--out-dir",
        str(ROOT / "watts"),
        "--corpus-dir",
        str(ROOT / ".local-corpus" / "watts"),
    ]
    existing_talks = ROOT / "watts" / "talks.json"
    if existing_talks.exists():
        args.extend(["--seed-talks-json", str(existing_talks)])

    raise SystemExit(main(args + sys.argv[1:]))
