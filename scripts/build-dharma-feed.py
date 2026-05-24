#!/usr/bin/env python3
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts" / "lib"))

from dharma_feed_runner import run_feed_builder


CORPORA = {
    "brensilver": {"config_name": "brensilver.json"},
    "burbea": {"config_name": "burbea.json", "local_corpus": "burbea"},
    "watts": {"config_name": "watts.json", "local_corpus": "watts"},
}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Build public Dharma feed/archive artifacts for a corpus.",
    )
    parser.add_argument("corpus", choices=sorted(CORPORA))
    args, builder_args = parser.parse_known_args(argv)

    settings = CORPORA[args.corpus]
    return run_feed_builder(
        corpus=args.corpus,
        config_name=settings["config_name"],
        local_corpus=settings.get("local_corpus"),
        argv=builder_args,
    )


if __name__ == "__main__":
    raise SystemExit(main())
