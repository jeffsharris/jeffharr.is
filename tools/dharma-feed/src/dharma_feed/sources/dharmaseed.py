from __future__ import annotations

import ast
import os
import re
import xml.etree.ElementTree as ET
import urllib.parse
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Any, Dict, Iterable, Optional
from urllib.error import HTTPError, URLError

from dharma_feed.fetch import fetch_text, probe_content_length
from dharma_feed.models import Talk

ITUNES_NS = "http://www.itunes.com/dtds/podcast-1.0.dtd"
TALK_ID_RE = re.compile(r"/talks/(\d+)/")


def fetch_dharmaseed_talks(source: Dict[str, Any]) -> Iterable[Talk]:
    feed_url = _source_url(source, "feed_url")
    if feed_url is None:
        return []
    xml_text = fetch_text(feed_url)
    return parse_dharmaseed_feed(xml_text, source)


def fetch_dharmaseed_player_talks(source: Dict[str, Any]) -> Iterable[Talk]:
    player_url = _player_url(source)
    if player_url is None:
        return []
    try:
        html_text = fetch_text(player_url)
    except (HTTPError, URLError):
        if source.get("optional"):
            return []
        raise
    talk = parse_dharmaseed_player(html_text, source, player_url)
    return [talk] if talk is not None else []


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

        link = _source_url_value(source, _text(item, "link"))
        source_id = _talk_id_from_link(link) or _text(item, "guid") or enclosure.get("url", "")
        speaker = _text(item, f"{{{ITUNES_NS}}}author") or _source_speaker(source)
        title = _clean_title(_text(item, "title"), speaker=speaker)
        if not _speaker_allowed(source, speaker):
            continue

        pub_date = parsedate_to_datetime(_text(item, "pubDate"))
        audio_url = _source_url_value(
            source,
            _normalize_audio_url(enclosure.get("url", "")),
        )
        length = _optional_int(enclosure.get("length"))
        description = _text(item, "description") or None

        talks.append(
            Talk(
                id=f"dharmaseed:{source_id}",
                source=source.get("name", "Dharma Seed"),
                source_id=source_id,
                title=title,
                speaker=speaker,
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


def parse_dharmaseed_player(
    html_text: str,
    source: Dict[str, Any],
    player_url: str = "https://dharmaseed.org/talks/player/",
) -> Optional[Talk]:
    audio_path = _player_field(html_text, "mp3")
    if not audio_path:
        return None

    source_id = str(source.get("talk_id") or _talk_id_from_link(audio_path) or "")
    if not source_id:
        return None

    speaker = _player_field(html_text, "artist") or _source_speaker(source)
    if not _speaker_allowed(source, speaker):
        return None

    title = _clean_player_title(
        _player_field(html_text, "title") or _title_from_html(html_text),
        speaker=speaker,
    )
    published_at = _player_date(_player_field(html_text, "date"))
    audio_url = _normalize_audio_url(urllib.parse.urljoin("https://dharmaseed.org/", audio_path))
    audio_length = _optional_int(source.get("audio_length"))
    if audio_length is None and source.get("probe_length", True):
        audio_length = probe_content_length(audio_url)
    venue = _player_field(html_text, "venue") or None
    description = f"({venue})" if venue else None

    return Talk(
        id=f"dharmaseed:{source_id}",
        source=source.get("name", "Dharma Seed"),
        source_id=source_id,
        title=title,
        speaker=speaker,
        published_at=published_at,
        link=player_url,
        audio_url=audio_url,
        audio_type="audio/mpeg",
        audio_length=audio_length,
        duration=_player_field(html_text, "time") or None,
        description=description,
        image_url=_player_field(html_text, "thumb") or None,
        venue=venue,
    )


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


def _clean_title(title: str, speaker: str | None = None) -> str:
    title = " ".join(title.split())
    if speaker:
        title = re.sub(rf"^{re.escape(speaker)}\s*:\s*", "", title, flags=re.IGNORECASE)
    return title.strip()


def _clean_player_title(title: str, speaker: str | None = None) -> str:
    title = re.sub(r"^\d{1,2}:\d{2}(?::\d{2})?\s+", "", title).strip()
    return _clean_title(title, speaker=speaker)


def _player_date(value: str) -> datetime:
    try:
        return datetime.strptime(value, "%Y-%m-%d").replace(hour=12, tzinfo=timezone.utc)
    except ValueError:
        return datetime.now(timezone.utc)


def _player_field(html_text: str, name: str) -> str:
    match = re.search(rf"\b{name}\s*:\s*('(?:\\.|[^'])*')", html_text)
    if not match:
        return ""
    try:
        value = ast.literal_eval(match.group(1))
    except (SyntaxError, ValueError):
        return ""
    return " ".join(str(value).split())


def _title_from_html(html_text: str) -> str:
    match = re.search(r"<title>(.*?)</title>", html_text, flags=re.I | re.S)
    if not match:
        return ""
    return " ".join(match.group(1).split())


def _player_url(source: Dict[str, Any]) -> Optional[str]:
    return _source_url(source, "player_url")


def _source_url(source: Dict[str, Any], key: str) -> Optional[str]:
    return _source_url_value(source, source[key])


def _source_url_value(source: Dict[str, Any], url: str) -> str | None:
    access_key = source.get("access_key")
    env_name = source.get("access_key_env")
    if env_name:
        access_key = os.environ.get(str(env_name))
        if not access_key:
            return None
    if access_key:
        return _set_query_param(url, "access_key", str(access_key))
    return url


def _set_query_param(url: str, key: str, value: str) -> str:
    parts = urllib.parse.urlsplit(url)
    query = dict(urllib.parse.parse_qsl(parts.query, keep_blank_values=True))
    query[key] = value
    return urllib.parse.urlunsplit(
        (
            parts.scheme,
            parts.netloc,
            parts.path,
            urllib.parse.urlencode(query),
            parts.fragment,
        )
    )


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


def _source_speaker(source: Dict[str, Any]) -> str:
    speaker = source.get("speaker")
    if isinstance(speaker, str) and speaker.strip():
        return " ".join(speaker.split())

    allowed = source.get("include_speakers")
    if isinstance(allowed, str):
        return " ".join(allowed.split())
    if isinstance(allowed, list) and len(allowed) == 1:
        return " ".join(str(allowed[0]).split())
    return ""


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
