from __future__ import annotations

import hashlib
import re
import xml.etree.ElementTree as ET
from datetime import timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any, Dict, Iterable, Optional
from urllib.parse import parse_qs, urlparse

from brensilver.fetch import fetch_text
from brensilver.models import Talk

ITUNES_NS = "http://www.itunes.com/dtds/podcast-1.0.dtd"


def fetch_podcast_rss_talks(source: Dict[str, Any]) -> Iterable[Talk]:
    xml_text = read_feed_text(source)
    return parse_podcast_rss_feed(xml_text, source)


def read_feed_text(source: Dict[str, Any]) -> str:
    if source.get("feed_path"):
        return Path(str(source["feed_path"])).read_text(encoding="utf-8")
    return fetch_text(str(source["feed_url"]))


def parse_podcast_rss_feed(xml_text: str, source: Dict[str, Any]) -> Iterable[Talk]:
    root = ET.fromstring(xml_text)
    channel = root.find("channel")
    if channel is None:
        return []

    image_url = _channel_image_url(channel)
    talks = []
    for item in channel.findall("item"):
        enclosure = item.find("enclosure")
        if enclosure is None or not enclosure.get("url"):
            continue

        raw_title = _text(item, "title")
        source_id = _source_id(item, raw_title, source)
        title = _clean_title(raw_title, source)
        speaker = _text(item, f"{{{ITUNES_NS}}}author") or source.get("speaker") or source.get("author")
        pub_date = parsedate_to_datetime(_text(item, "pubDate")).astimezone(timezone.utc)
        link = _text(item, "link") or enclosure.get("url", "")

        talks.append(
            Talk(
                id=f"{source.get('id_prefix', _slug(source.get('name', 'rss')))}:{source_id}",
                source=source.get("name", "Podcast RSS"),
                source_id=source_id,
                title=title,
                speaker=str(speaker or "Unknown"),
                published_at=pub_date,
                link=link,
                audio_url=enclosure.get("url", ""),
                audio_type=enclosure.get("type", "audio/mpeg"),
                audio_length=_optional_int(enclosure.get("length")),
                duration=_text(item, f"{{{ITUNES_NS}}}duration") or None,
                description=_text(item, "description") or None,
                image_url=_item_image_url(item) or image_url,
            )
        )
    return talks


def _source_id(item: ET.Element, raw_title: str, source: Dict[str, Any]) -> str:
    archive_id = _archive_id(raw_title, source)
    if archive_id:
        return _slug(archive_id)

    for value in [_text(item, "guid"), _text(item, "link")]:
        if value:
            drive_id = _google_drive_id(value)
            return _slug(drive_id or value)

    enclosure = item.find("enclosure")
    audio_url = enclosure.get("url", "") if enclosure is not None else ""
    drive_id = _google_drive_id(audio_url)
    if drive_id:
        return _slug(drive_id)
    return hashlib.sha1(audio_url.encode("utf-8")).hexdigest()[:16]


def _archive_id(raw_title: str, source: Dict[str, Any]) -> Optional[str]:
    pattern = source.get("archive_id_regex")
    if not pattern:
        return None
    match = re.match(str(pattern), raw_title.strip())
    if not match:
        return None
    return match.group(1)


def _clean_title(raw_title: str, source: Dict[str, Any]) -> str:
    title = " ".join(raw_title.split())
    pattern = source.get("title_prefix_regex") or source.get("archive_id_regex")
    if pattern and source.get("strip_title_prefix", True):
        title = re.sub(str(pattern), "", title).strip()
    replacements = source.get("title_replacements") or {}
    if isinstance(replacements, dict):
        title = str(replacements.get(title, title))
    if title.isupper():
        title = title.title()
    return title or raw_title


def _text(element: ET.Element, name: str) -> str:
    child = element.find(name)
    if child is None or child.text is None:
        return ""
    return " ".join(child.text.split())


def _channel_image_url(channel: ET.Element) -> Optional[str]:
    itunes_image = channel.find(f"{{{ITUNES_NS}}}image")
    if itunes_image is not None and itunes_image.get("href"):
        return itunes_image.get("href")

    image = channel.find("image")
    if image is not None:
        url = _text(image, "url")
        if url:
            return url
    return None


def _item_image_url(item: ET.Element) -> Optional[str]:
    itunes_image = item.find(f"{{{ITUNES_NS}}}image")
    if itunes_image is not None and itunes_image.get("href"):
        return itunes_image.get("href")
    return None


def _google_drive_id(url: str) -> Optional[str]:
    query = parse_qs(urlparse(url).query)
    values = query.get("id")
    if values and values[0]:
        return values[0]
    return None


def _optional_int(value: Optional[str]) -> Optional[int]:
    if value is None:
        return None
    try:
        return int(value)
    except ValueError:
        return None


def _slug(value: object) -> str:
    return re.sub(r"[^a-zA-Z0-9]+", "-", str(value).strip()).strip("-").lower()
