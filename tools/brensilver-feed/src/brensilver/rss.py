from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import format_datetime
from typing import Dict, Iterable, List, Optional

from brensilver.models import Talk

ATOM_NS = "http://www.w3.org/2005/Atom"
ITUNES_NS = "http://www.itunes.com/dtds/podcast-1.0.dtd"
PODCAST_NS = "https://podcastindex.org/namespace/1.0"

ET.register_namespace("atom", ATOM_NS)
ET.register_namespace("itunes", ITUNES_NS)
ET.register_namespace("podcast", PODCAST_NS)


def merge_talks(talks: Iterable[Talk]) -> List[Talk]:
    by_id: Dict[str, Talk] = {}
    by_key: Dict[str, Talk] = {}

    for talk in talks:
        if talk.id in by_id:
            continue

        key = _dedupe_key(talk)
        existing = by_key.get(key)
        if existing is None:
            by_key[key] = talk
            by_id[talk.id] = talk
            continue

        preferred = _prefer(existing, talk)
        by_key[key] = preferred
        by_id.pop(existing.id, None)
        by_id.pop(talk.id, None)
        by_id[preferred.id] = preferred

    return sorted(by_id.values(), key=lambda talk: (talk.published_at, talk.title), reverse=True)


def build_rss(talks: Iterable[Talk], site: Dict[str, str]) -> str:
    talk_list = list(talks)
    last_build = max((talk.published_at for talk in talk_list), default=datetime.now(timezone.utc))
    rss = ET.Element("rss", {"version": "2.0"})
    channel = ET.SubElement(rss, "channel")

    _text(channel, "title", site["title"])
    _text(channel, "link", site["base_url"])
    _text(channel, "description", site["description"])
    _text(channel, "language", site.get("language", "en"))
    _text(channel, "lastBuildDate", format_datetime(last_build))
    ET.SubElement(
        channel,
        f"{{{ATOM_NS}}}link",
        {"href": site["feed_url"], "rel": "self", "type": "application/rss+xml"},
    )

    image_url = site.get("image_url")
    if image_url:
        image = ET.SubElement(channel, "image")
        _text(image, "url", image_url)
        _text(image, "title", site["title"])
        _text(image, "link", site["base_url"])

    _text(channel, f"{{{ITUNES_NS}}}author", site.get("author", "Matthew Brensilver"))
    _text(channel, f"{{{ITUNES_NS}}}summary", site["description"])
    _text(channel, f"{{{ITUNES_NS}}}explicit", "no")
    if image_url:
        ET.SubElement(channel, f"{{{ITUNES_NS}}}image", {"href": image_url})

    category = site.get("category")
    subcategory = site.get("subcategory")
    if category:
        category_node = ET.SubElement(channel, f"{{{ITUNES_NS}}}category", {"text": category})
        if subcategory:
            ET.SubElement(category_node, f"{{{ITUNES_NS}}}category", {"text": subcategory})

    for talk in talk_list:
        item = ET.SubElement(channel, "item")
        _text(item, "title", talk.title)
        _text(item, "link", talk.canonical_url or talk.link)
        _text(item, "pubDate", format_datetime(talk.published_at))
        ET.SubElement(item, "guid", {"isPermaLink": "false"}).text = talk.id
        _text(item, "description", _description(talk))
        ET.SubElement(
            item,
            "enclosure",
            {
                "url": talk.audio_url,
                "length": str(talk.audio_length or 0),
                "type": talk.audio_type or "audio/mpeg",
            },
        )
        _text(item, f"{{{ITUNES_NS}}}author", talk.speaker)
        _text(item, f"{{{ITUNES_NS}}}explicit", "no")
        if talk.duration:
            _text(item, f"{{{ITUNES_NS}}}duration", talk.duration)
        _text(item, f"{{{ITUNES_NS}}}summary", _summary(talk))
        image_url = talk.episode_image_url or talk.image_url
        if image_url:
            ET.SubElement(item, f"{{{ITUNES_NS}}}image", {"href": image_url})
        if talk.chapters_url:
            ET.SubElement(
                item,
                f"{{{PODCAST_NS}}}chapters",
                {"url": talk.chapters_url, "type": "application/json+chapters"},
            )

    xml = ET.tostring(rss, encoding="utf-8", xml_declaration=True)
    return xml.decode("utf-8")


def _text(parent: ET.Element, name: str, value: Optional[str]) -> None:
    if value is None:
        return
    ET.SubElement(parent, name).text = value


def _description(talk: Talk) -> str:
    if talk.podcast_description:
        return _podcast_description(talk)
    parts = []
    if talk.description:
        parts.append(talk.description)
    parts.append(f"Source: {talk.source}")
    parts.append(f"Original page: {talk.link}")
    return "\n\n".join(parts)


def _summary(talk: Talk) -> str:
    if talk.podcast_description:
        return _podcast_description(talk)
    if talk.description:
        return f"{talk.description} Source: {talk.source}."
    return f"Matthew Brensilver Dharma talk from {talk.source}."


def _podcast_description(talk: Talk) -> str:
    parts = [talk.podcast_description or ""]
    if talk.chapters:
        parts.append(
            "Chapters:\n"
            + "\n".join(
                f"{_format_timestamp(chapter.start)} {chapter.title}"
                for chapter in talk.chapters
            )
        )
    parts.append(f"Source: {talk.source}")
    parts.append(f"Original page: {talk.link}")
    return "\n\n".join(part for part in parts if part)


def _format_timestamp(seconds: float) -> str:
    total = int(round(max(0, seconds)))
    hours, remainder = divmod(total, 3600)
    minutes, secs = divmod(remainder, 60)
    if hours:
        return f"{hours:02d}:{minutes:02d}:{secs:02d}"
    return f"{minutes:02d}:{secs:02d}"


def _dedupe_key(talk: Talk) -> str:
    date = talk.published_at.date().isoformat()
    return f"{date}:{_normalize_title(talk.title)}"


def _normalize_title(title: str) -> str:
    title = re.sub(r"^matthew brensilver:\s*", "", title, flags=re.IGNORECASE)
    title = re.sub(r"\s*\((?:retreat at|online retreat at)[^)]+\)\s*", " ", title, flags=re.I)
    title = re.sub(r"[^a-z0-9]+", " ", title.lower())
    return " ".join(title.split())


def _prefer(left: Talk, right: Talk) -> Talk:
    source_rank = {"Dharma Seed": 2, "AudioDharma": 1}
    left_score = source_rank.get(left.source, 0) + (1 if left.audio_length else 0)
    right_score = source_rank.get(right.source, 0) + (1 if right.audio_length else 0)
    if right_score > left_score:
        return right
    return left
