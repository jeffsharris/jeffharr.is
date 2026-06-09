from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from dataclasses import replace
from datetime import datetime, timezone
from email.utils import format_datetime
from typing import Dict, Iterable, List, Optional

from dharma_feed.models import Talk

ATOM_NS = "http://www.w3.org/2005/Atom"
ITUNES_NS = "http://www.itunes.com/dtds/podcast-1.0.dtd"
MEDIA_NS = "http://search.yahoo.com/mrss/"
PODCAST_NS = "https://podcastindex.org/namespace/1.0"

ET.register_namespace("atom", ATOM_NS)
ET.register_namespace("itunes", ITUNES_NS)
ET.register_namespace("media", MEDIA_NS)
ET.register_namespace("podcast", PODCAST_NS)


def merge_talks(talks: Iterable[Talk]) -> List[Talk]:
    by_id: Dict[str, Talk] = {}
    by_key: Dict[str, Talk] = {}

    for talk in talks:
        if talk.id in by_id:
            existing = by_id[talk.id]
            combined = _fill_missing_metadata(existing, talk)
            by_id[talk.id] = combined
            by_key[_dedupe_key(existing)] = combined
            continue

        key = _dedupe_key(talk)
        existing = by_key.get(key)
        if existing is None:
            by_key[key] = talk
            by_id[talk.id] = talk
            continue

        preferred = _prefer(existing, talk)
        fallback = talk if preferred is existing else existing
        preferred = _fill_missing_metadata(preferred, fallback)
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

    _text(channel, f"{{{ITUNES_NS}}}author", site.get("author") or site.get("title"))
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
        _text(item, f"{{{ITUNES_NS}}}author", site.get("author") or talk.speaker)
        _text(item, f"{{{ITUNES_NS}}}explicit", "no")
        if talk.duration:
            _text(item, f"{{{ITUNES_NS}}}duration", talk.duration)
        _text(item, f"{{{ITUNES_NS}}}summary", _summary(talk))
        image_url = talk.episode_image_url or talk.image_url
        if image_url:
            ET.SubElement(item, f"{{{ITUNES_NS}}}image", {"href": image_url})
            ET.SubElement(
                item,
                f"{{{MEDIA_NS}}}thumbnail",
                {"url": image_url, "width": "1024", "height": "1024"},
            )
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
    source_description = _source_description(talk)
    if source_description:
        parts.append(source_description)
    parts.extend(_source_metadata_lines(talk))
    parts.append(f"Source: {talk.source}")
    parts.append(f"Original page: {talk.link}")
    return "\n\n".join(parts)


def _summary(talk: Talk) -> str:
    if talk.podcast_description:
        return _podcast_description(talk)
    details = []
    source_description = _source_description(talk)
    if source_description:
        details.append(source_description)
    details.extend(_source_metadata_lines(talk))
    if details:
        return f"{' '.join(_as_sentence(detail) for detail in details)} Source: {talk.source}."
    return f"{talk.speaker} Dharma talk from {talk.source}."


def _podcast_description(talk: Talk) -> str:
    parts = [talk.podcast_description or ""]
    parts.extend(_source_metadata_lines(talk))
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


def _source_metadata_lines(talk: Talk) -> List[str]:
    lines: List[str] = []
    if talk.venue:
        lines.append(f"Location: {talk.venue}")
    if talk.co_teachers:
        lines.append(f"Additional teachers: {', '.join(talk.co_teachers)}")
    return lines


def _source_description(talk: Talk) -> Optional[str]:
    if not talk.description:
        return None
    if talk.venue and talk.description.strip() == f"({talk.venue})":
        return None
    return talk.description


def _as_sentence(value: str) -> str:
    text = value.strip()
    if re.search(r"[.!?]$", text):
        return text
    return f"{text}."


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
    title = re.sub(r"^[a-z][a-z .'-]{2,60}:\s*", "", title, flags=re.IGNORECASE)
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


def _fill_missing_metadata(primary: Talk, fallback: Talk) -> Talk:
    return replace(
        primary,
        audio_length=primary.audio_length if primary.audio_length is not None else fallback.audio_length,
        duration=primary.duration or fallback.duration,
        description=primary.description or fallback.description,
        image_url=primary.image_url or fallback.image_url,
        link=_prefer_access_key_url(primary.link, fallback.link),
        audio_url=_prefer_access_key_url(primary.audio_url, fallback.audio_url),
        canonical_url=primary.canonical_url or fallback.canonical_url,
        podcast_description=primary.podcast_description or fallback.podcast_description,
        short_summary=primary.short_summary or fallback.short_summary,
        episode_image_url=primary.episode_image_url or fallback.episode_image_url,
        chapters_url=primary.chapters_url or fallback.chapters_url,
        chapters=primary.chapters or fallback.chapters,
        venue=primary.venue or fallback.venue,
        series=primary.series or fallback.series,
        co_teachers=primary.co_teachers or fallback.co_teachers,
        tags=primary.tags or fallback.tags,
        transcript=(
            primary.transcript
            if _transcript_has_data(primary.transcript)
            else fallback.transcript
        ),
    )


def _transcript_has_data(transcript: object) -> bool:
    return any(
        [
            getattr(transcript, "status", "pending") != "pending",
            getattr(transcript, "url", None),
            getattr(transcript, "text_path", None),
        ]
    )


def _prefer_access_key_url(primary: str, fallback: str) -> str:
    if "access_key=" in fallback and "access_key=" not in primary:
        return fallback
    return primary
