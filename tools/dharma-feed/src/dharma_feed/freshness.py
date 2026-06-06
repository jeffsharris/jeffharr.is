from __future__ import annotations

import argparse
import json
import os
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Iterable, Sequence

from dharma_feed.fetch import fetch_text
from dharma_feed.models import Talk
from dharma_feed.sources.audiodharma import parse_audiodharma_listing
from dharma_feed.sources.dharmaseed import parse_dharmaseed_feed


@dataclass(frozen=True)
class FreshnessExpectation:
    id: str
    source: str
    title: str
    upstream_url: str


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Check that latest Brensilver upstream items are present in generated feeds.",
    )
    parser.add_argument("--config", default="tools/dharma-feed/config/brensilver.json")
    parser.add_argument("--out-dir", default="dharma/brensilver")
    args = parser.parse_args(list(argv) if argv is not None else None)

    config_path = Path(args.config)
    out_dir = Path(args.out_dir)
    config = json.loads(config_path.read_text(encoding="utf-8"))
    expectations = latest_upstream_expectations(config)
    feed_guids = generated_feed_guids(out_dir)
    missing = [expectation for expectation in expectations if expectation.id not in feed_guids]

    print("Freshness expectations:")
    for expectation in expectations:
        status = "ok" if expectation.id in feed_guids else "missing"
        print(f"- {status}: {expectation.source} {expectation.id} {expectation.title}")

    if missing:
        print("\nGenerated feeds are missing latest upstream item(s):")
        for expectation in missing:
            print(f"- {expectation.source} {expectation.id} {expectation.upstream_url}")
        return 1

    print("Generated Brensilver feeds include the latest checked upstream items.")
    return 0


def latest_upstream_expectations(
    config: dict[str, Any],
    fetcher: Callable[[str], str] = fetch_text,
) -> list[FreshnessExpectation]:
    expectations: list[FreshnessExpectation] = []
    for source in config.get("sources", []):
        source_type = source.get("type")
        if source_type == "audiodharma":
            latest = latest_audiodharma_talk(source, fetcher)
            if latest is None:
                raise RuntimeError(f"No AudioDharma talks parsed from {source.get('listing_url')}")
        elif source_type == "dharmaseed" and source.get("teacher_id"):
            latest = latest_dharmaseed_teacher_talk(source, fetcher)
            if latest is None:
                raise RuntimeError(f"No Dharma Seed teacher talks parsed from {source.get('feed_url')}")
        else:
            continue

        expectations.append(
            FreshnessExpectation(
                id=latest.id,
                source=latest.source,
                title=latest.title,
                upstream_url=latest.link,
            )
        )
    if not expectations:
        raise RuntimeError("No freshness sources were checked.")
    return expectations


def latest_audiodharma_talk(
    source: dict[str, Any],
    fetcher: Callable[[str], str] = fetch_text,
) -> Talk | None:
    listing_url = str(source["listing_url"])
    talks = list(parse_audiodharma_listing(fetcher(listing_url), source))
    return latest_talk(talks)


def latest_dharmaseed_teacher_talk(
    source: dict[str, Any],
    fetcher: Callable[[str], str] = fetch_text,
) -> Talk | None:
    if source.get("access_key_env") and not os.environ.get(str(source["access_key_env"])):
        return None
    feed_url = str(source["feed_url"])
    talks = list(parse_dharmaseed_feed(fetcher(feed_url), source))
    return latest_talk(talks)


def latest_talk(talks: Iterable[Talk]) -> Talk | None:
    talk_list = list(talks)
    if not talk_list:
        return None
    return max(talk_list, key=lambda talk: (talk.published_at, talk.title, talk.id))


def generated_feed_guids(out_dir: Path) -> set[str]:
    guids: set[str] = set()
    for name in ["feed.xml", "guided-feed.xml"]:
        feed_path = out_dir / name
        if not feed_path.exists():
            continue
        root = ET.fromstring(feed_path.read_text(encoding="utf-8"))
        channel = root.find("channel")
        if channel is None:
            continue
        for item in channel.findall("item"):
            guid = item.findtext("guid")
            if guid:
                guids.add(guid.strip())
    return guids


if __name__ == "__main__":
    raise SystemExit(main())
