#!/usr/bin/env python3
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TOOL_ROOT = ROOT / "tools" / "brensilver-feed"
sys.path.insert(0, str(TOOL_ROOT / "src"))

from brensilver.build import main


if __name__ == "__main__":
    out_dir = ROOT / "dharma" / "brensilver"
    args = [
        "--config",
        str(TOOL_ROOT / "config" / "sources.json"),
        "--out-dir",
        str(out_dir),
    ]
    for existing_talks in [
        out_dir / "talks.json",
        ROOT / "brensilver" / "talks.json",
    ]:
        if existing_talks.exists():
            args.extend(["--seed-talks-json", str(existing_talks)])
            break

    raise SystemExit(main(args + sys.argv[1:]))
