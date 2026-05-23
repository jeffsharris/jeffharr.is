#!/usr/bin/env python3
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts" / "lib"))

from dharma_feed_runner import run_feed_builder


if __name__ == "__main__":
    raise SystemExit(
        run_feed_builder(
            corpus="watts",
            config_name="watts.json",
            local_corpus="watts",
            argv=sys.argv[1:],
        )
    )
