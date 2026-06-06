#!/usr/bin/env python3
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools" / "dharma-feed" / "src"))

from dharma_feed.freshness import main


if __name__ == "__main__":
    raise SystemExit(main())
