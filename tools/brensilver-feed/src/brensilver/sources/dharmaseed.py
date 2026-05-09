from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime
from typing import Dict, Iterable, Optional

from brensilver.fetch import fetch_text
from brensilver.models import Talk

ITUNES_NS = "http://www.itunes.com/dtds/podcast-1.0.dtd"
TALK_ID_RE = re.compile(r"/talks/(\d+)/")


def fetch_dharmaseed_talks(source: Dict[str, str]) -> Iterable[Talk]:
    xml_text = fetch_text(source["feed_url"])
    return parse_dharmaseed_feed(xml_text, source)


def parse_dharmaseed_feed(xml_text: str, source: Dict[str, str]) -> Iterable[Talk]:
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
        pub_date = parsedate_to_datetime(_text(item, "pubDate"))
        audio_url = _normalize_audio_url(enclosure.get("url", ""))
        length = _optional_int(enclosure.get("length"))

        talks.append(
            Talk(
                id=f"dharmaseed:{source_id}",
                source=source.get("name", "Dharma Seed"),
                source_id=source_id,
                title=title,
                speaker=_text(item, f"{{{ITUNES_NS}}}author") or "Matthew Brensilver",
                published_at=pub_date,
                link=link,
                audio_url=audio_url,
                audio_type=enclosure.get("type", "audio/mpeg"),
                audio_length=length,
                duration=_text(item, f"{{{ITUNES_NS}}}duration") or None,
                description=_text(item, "description") or None,
                image_url=image_url,
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


def _normalize_audio_url(url: str) -> str:
    return url.replace("https://dharmaseed.org//", "https://dharmaseed.org/")


def _optional_int(value: Optional[str]) -> Optional[int]:
    if value is None:
        return None
    try:
        return int(value)
    except ValueError:
        return None
