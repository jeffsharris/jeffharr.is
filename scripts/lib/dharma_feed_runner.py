from __future__ import annotations

import sys
from pathlib import Path
from typing import Iterable

ROOT = Path(__file__).resolve().parents[2]
TOOL_ROOT = ROOT / "tools" / "dharma-feed"
sys.path.insert(0, str(TOOL_ROOT / "src"))

from dharma_feed.build import main as build_main


def run_feed_builder(
    *,
    corpus: str,
    config_name: str,
    local_corpus: str | None = None,
    argv: Iterable[str] = (),
) -> int:
    out_dir = ROOT / "dharma" / corpus
    args = [
        "--config",
        str(TOOL_ROOT / "config" / config_name),
        "--out-dir",
        str(out_dir),
    ]
    if local_corpus:
        args.extend(["--corpus-dir", str(ROOT / ".local-corpus" / local_corpus)])

    for existing_talks in [out_dir / "talks.json", ROOT / corpus / "talks.json"]:
        if existing_talks.exists():
            args.extend(["--seed-talks-json", str(existing_talks)])
            break

    return build_main(args + list(argv))
