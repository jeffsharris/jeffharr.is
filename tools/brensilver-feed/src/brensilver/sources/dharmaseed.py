from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime
from typing import Any, Dict, Iterable, Optional

from brensilver.fetch import fetch_text
from brensilver.models import Talk

ITUNES_NS = "http://www.itunes.com/dtds/podcast-1.0.dtd"
TALK_ID_RE = re.compile(r"/talks/(\d+)/")


def fetch_dharmaseed_talks(source: Dict[str, Any]) -> Iterable[Talk]:
    xml_text = fetch_text(source["feed_url"])
    return parse_dharmaseed_feed(xml_text, source)


def parse_dharmaseed_feed(xml_text: str, source: Dict[str, Any]) -> Iterable[Talk]:
    root = ET.fromstring(xml_text)
    channel = root.find("channel")
    if channel is None:
        return []

    image_url = _channel_image_url(channel)
    talks = []
    for item in channel.findall("item"):
        enclosure = item.find("enclosure")
        if enclosure is None:
            continue

        link = _text(item, "link")
        source_id = _talk_id_from_link(link) or _text(item, "guid") or enclosure.get("url", "")
        title = _clean_title(_text(item, "title"))
        speaker = _text(item, f"{{{ITUNES_NS}}}author")
        if not _speaker_allowed(source, speaker):
            continue

        pub_date = parsedate_to_datetime(_text(item, "pubDate"))
        audio_url = _normalize_audio_url(enclosure.get("url", ""))
        length = _optional_int(enclosure.get("length"))
        description = _text(item, "description") or None

        talks.append(
            Talk(
                id=f"dharmaseed:{source_id}",
                source=source.get("name", "Dharma Seed"),
                source_id=source_id,
                title=title,
                speaker=speaker or "Matthew Brensilver",
                published_at=pub_date,
                link=link,
                audio_url=audio_url,
                audio_type=enclosure.get("type", "audio/mpeg"),
                audio_length=length,
                duration=_text(item, f"{{{ITUNES_NS}}}duration") or None,
                description=description,
                image_url=image_url,
                venue=_venue_from_description(description),
            )
        )
    return talks


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


def _talk_id_from_link(link: str) -> Optional[str]:
    match = TALK_ID_RE.search(link)
    if match:
        return match.group(1)
    return None


def _clean_title(title: str) -> str:
    return re.sub(r"^Matthew Brensilver:\s*", "", title).strip()


def _speaker_allowed(source: Dict[str, Any], speaker: str) -> bool:
    allowed = source.get("include_speakers")
    if not allowed:
        return True
    if isinstance(allowed, str):
        allowed = [allowed]

    normalized_speaker = _normalize_person_name(speaker)
    if not normalized_speaker:
        return False

    return any(
        normalized_allowed in normalized_speaker
        for normalized_allowed in (_normalize_person_name(str(name)) for name in allowed)
        if normalized_allowed
    )


def _normalize_person_name(value: str) -> str:
    return " ".join(re.sub(r"[^a-z0-9]+", " ", value.lower()).split())


def _normalize_audio_url(url: str) -> str:
    return url.replace("https://dharmaseed.org//", "https://dharmaseed.org/")


def _optional_int(value: Optional[str]) -> Optional[int]:
    if value is None:
        return None
    try:
        return int(value)
    except ValueError:
        return None


def _venue_from_description(description: Optional[str]) -> Optional[str]:
    if not description:
        return None
    match = re.match(r"^\(([^)]+)\)", description.strip())
    if not match:
        return None
    venue = " ".join(match.group(1).split())
    return venue or None
