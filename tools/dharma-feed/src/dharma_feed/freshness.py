from __future__ import annotations

import argparse
import json
import os
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Iterable, Sequence

from dharma_feed.fetch import fetch_text
from dharma_feed.metadata import safe_id
from dharma_feed.models import Talk
from dharma_feed.sources.audiodharma import parse_audiodharma_listing
from dharma_feed.sources.dharmaseed import parse_dharmaseed_feed

ITUNES_NS = "http://www.itunes.com/dtds/podcast-1.0.dtd"
PODCAST_NS = "https://podcastindex.org/namespace/1.0"


@dataclass(frozen=True)
class FreshnessExpectation:
    id: str
    source: str
    title: str
    upstream_url: str


@dataclass(frozen=True)
class GeneratedFeedItem:
    id: str
    title: str
    feed_name: str
    episode_image_url: str | None
    chapters_url: str | None


@dataclass(frozen=True)
class EnrichmentIssue:
    id: str
    title: str
    missing_requirements: tuple[str, ...]


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Check that latest Brensilver upstream items are present in generated feeds.",
    )
    parser.add_argument("--config", default="tools/dharma-feed/config/brensilver.json")
    parser.add_argument("--out-dir", default="dharma/brensilver")
    parser.add_argument(
        "--require-enriched-feed-items",
        action="store_true",
        help=(
            "Fail if any generated feed item is missing local ingestion metadata, "
            "episode artwork, chapter JSON, or matching RSS item media tags."
        ),
    )
    args = parser.parse_args(list(argv) if argv is not None else None)

    config_path = Path(args.config)
    out_dir = Path(args.out_dir)
    config = json.loads(config_path.read_text(encoding="utf-8"))
    expectations = latest_upstream_expectations(config)
    feed_guids = generated_feed_guids(out_dir)
    missing = [expectation for expectation in expectations if expectation.id not in feed_guids]
    status = 0

    print("Freshness expectations:")
    for expectation in expectations:
        expectation_status = "ok" if expectation.id in feed_guids else "missing"
        print(f"- {expectation_status}: {expectation.source} {expectation.id} {expectation.title}")

    if missing:
        print("\nGenerated feeds are missing latest upstream item(s):")
        for expectation in missing:
            print(f"- {expectation.source} {expectation.id} {expectation.upstream_url}")
        status = 1
    else:
        print("Generated Brensilver feeds include the latest checked upstream items.")

    if args.require_enriched_feed_items:
        issues = feed_enrichment_issues(out_dir)
        if issues:
            print("\nGenerated feed item(s) are not fully enriched:")
            for issue in issues:
                missing_text = ", ".join(issue.missing_requirements)
                print(f"- {issue.id} {issue.title}: {missing_text}")
            status = 1
        else:
            print("Generated feed items have ingestion metadata, artwork, and chapters.")

    return status


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
    return {item.id for item in generated_feed_items(out_dir)}


def generated_feed_items(out_dir: Path) -> list[GeneratedFeedItem]:
    items: list[GeneratedFeedItem] = []
    for name in ["feed.xml", "guided-feed.xml"]:
        feed_path = out_dir / name
        if not feed_path.exists():
            continue
        root = ET.fromstring(feed_path.read_text(encoding="utf-8"))
        channel = root.find("channel")
        if channel is None:
            continue
        for item in channel.findall("item"):
            guid = clean_text(item.findtext("guid"))
            if not guid:
                continue
            image = item.find(f"{{{ITUNES_NS}}}image")
            chapters = item.find(f"{{{PODCAST_NS}}}chapters")
            items.append(
                GeneratedFeedItem(
                    id=guid,
                    title=clean_text(item.findtext("title")) or "",
                    feed_name=name,
                    episode_image_url=clean_text(image.get("href")) if image is not None else None,
                    chapters_url=clean_text(chapters.get("url")) if chapters is not None else None,
                )
            )
    return items


def feed_enrichment_issues(out_dir: Path) -> list[EnrichmentIssue]:
    feed_items = generated_feed_items(out_dir)
    talks = load_talks_by_id(out_dir / "talks.json")
    issues: list[EnrichmentIssue] = []

    for feed_item in feed_items:
        talk = talks.get(feed_item.id)
        if talk is None:
            issues.append(
                EnrichmentIssue(
                    id=feed_item.id,
                    title=feed_item.title,
                    missing_requirements=("talks.json entry",),
                )
            )
            continue

        safe = safe_id(feed_item.id)
        expected_image_url = clean_text(talk.get("episode_image_url"))
        expected_chapters_url = clean_text(talk.get("chapters_url"))
        missing: list[str] = []

        if not clean_text(talk.get("podcast_description")):
            missing.append("podcast_description")
        if not expected_image_url:
            missing.append("episode_image_url")
        if not expected_chapters_url:
            missing.append("chapters_url")
        if not has_chapters(talk):
            missing.append("chapters")

        artwork_path = out_dir / "artwork" / f"{safe}.jpg"
        if expected_image_url:
            if not artwork_path.exists():
                missing.append(f"artwork/{safe}.jpg")
            if feed_item.episode_image_url != expected_image_url:
                missing.append("rss itunes:image")

        chapters_path = out_dir / "chapters" / f"{safe}.json"
        if expected_chapters_url:
            if not chapters_path.exists():
                missing.append(f"chapters/{safe}.json")
            elif not chapter_file_has_chapters(chapters_path):
                missing.append(f"chapters/{safe}.json chapters")
            if feed_item.chapters_url != expected_chapters_url:
                missing.append("rss podcast:chapters")

        if missing:
            issues.append(
                EnrichmentIssue(
                    id=feed_item.id,
                    title=clean_text(talk.get("title")) or feed_item.title,
                    missing_requirements=tuple(missing),
                )
            )

    return issues


def load_talks_by_id(path: Path) -> dict[str, dict[str, Any]]:
    if not path.exists():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, list):
        raise RuntimeError(f"Expected a list in {path}")

    talks: dict[str, dict[str, Any]] = {}
    for item in data:
        if not isinstance(item, dict):
            continue
        talk_id = clean_text(item.get("id"))
        if talk_id:
            talks[talk_id] = item
    return talks


def has_chapters(talk: dict[str, Any]) -> bool:
    chapters = talk.get("chapters")
    return isinstance(chapters, list) and bool(chapters)


def chapter_file_has_chapters(path: Path) -> bool:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return False
    chapters = data.get("chapters") if isinstance(data, dict) else None
    return isinstance(chapters, list) and bool(chapters)


def clean_text(value: object) -> str | None:
    if value is None:
        return None
    text = " ".join(str(value).split())
    return text or None


if __name__ == "__main__":
    raise SystemExit(main())
