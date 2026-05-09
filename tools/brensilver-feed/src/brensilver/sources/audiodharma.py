from __future__ import annotations

import re
from datetime import datetime, timezone
from html.parser import HTMLParser
from typing import Dict, Iterable, List, Optional
from urllib.parse import urljoin

from brensilver.fetch import fetch_text, probe_content_length
from brensilver.models import Talk

BASE_URL = "https://www.audiodharma.org"
SPEAKER_IMAGE = "https://audiodharma.us-east-1.linodeobjects.com/speakers/231/MatthewBrensilver_small.jpg"
DATE_RE = re.compile(r"^\d{4}\.\d{2}\.\d{2}$")
DURATION_RE = re.compile(r"^\d{1,2}:\d{2}(?::\d{2})?$")
PAGE_RE = re.compile(r"[?&]page=(\d+)")


def fetch_audiodharma_talks(
    source: Dict[str, str], probe_lengths: bool = False
) -> Iterable[Talk]:
    first_html = fetch_text(source["listing_url"])
    first_parser = AudioDharmaListingParser(source["listing_url"])
    first_parser.feed(first_html)

    talks = list(_talks_from_entries(first_parser.entries, source, probe_lengths))
    for page in range(2, first_parser.max_page + 1):
        html = fetch_text(f"{source['listing_url']}?page={page}")
        parser = AudioDharmaListingParser(source["listing_url"])
        parser.feed(html)
        talks.extend(_talks_from_entries(parser.entries, source, probe_lengths))
    return talks


def parse_audiodharma_listing(
    html_text: str, source: Dict[str, str], probe_lengths: bool = False
) -> Iterable[Talk]:
    parser = AudioDharmaListingParser(source["listing_url"])
    parser.feed(html_text)
    return list(_talks_from_entries(parser.entries, source, probe_lengths))


class AudioDharmaListingParser(HTMLParser):
    def __init__(self, page_url: str) -> None:
        super().__init__(convert_charrefs=True)
        self.page_url = page_url
        self.entries: List[Dict[str, str]] = []
        self.max_page = 1
        self._row: Optional[Dict[str, str]] = None
        self._cell_classes: List[str] = []
        self._cell_text: List[str] = []
        self._in_cell = False

    def handle_starttag(self, tag: str, attrs: List[tuple]) -> None:
        attrs_dict = {key: value or "" for key, value in attrs}

        if tag == "tr":
            self._row = {}
            return

        if tag == "td" and self._row is not None:
            self._in_cell = True
            self._cell_classes = attrs_dict.get("class", "").split()
            self._cell_text = []
            return

        if tag == "a":
            href = attrs_dict.get("href", "")
            self._capture_page_number(href)

            if self._row is None:
                return

            classes = attrs_dict.get("class", "").split()
            if "js-audio-select" in classes:
                self._row["audio_url"] = attrs_dict.get("data-url", "")
                self._row["download_url"] = attrs_dict.get("data-download-url", "")
                self._row["title"] = attrs_dict.get("data-title", "")
                self._row["source_id"] = attrs_dict.get("data-id", "")
                self._row["audio_type"] = _normalize_audio_type(attrs_dict.get("data-type", ""))

            if href.startswith("/talks/") and "/download" not in href and "/related" not in href:
                self._row.setdefault("link", href)

    def handle_data(self, data: str) -> None:
        if self._in_cell:
            self._cell_text.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag == "td" and self._row is not None:
            text = " ".join("".join(self._cell_text).split())
            if "playable-table-date" in self._cell_classes and DATE_RE.match(text):
                self._row["date"] = text
            elif "d-none" in self._cell_classes and "d-md-table-cell" in self._cell_classes:
                if DURATION_RE.match(text):
                    self._row.setdefault("duration", text)

            self._in_cell = False
            self._cell_classes = []
            self._cell_text = []
            return

        if tag == "tr" and self._row is not None:
            if self._row.get("audio_url") and self._row.get("source_id"):
                self.entries.append(self._row)
            self._row = None

    def _capture_page_number(self, href: str) -> None:
        match = PAGE_RE.search(href)
        if not match:
            return
        self.max_page = max(self.max_page, int(match.group(1)))


def _talks_from_entries(
    entries: List[Dict[str, str]], source: Dict[str, str], probe_lengths: bool
) -> Iterable[Talk]:
    talks = []
    for entry in entries:
        published_at = _parse_date(entry.get("date", ""))
        source_id = entry["source_id"]
        audio_url = entry["audio_url"]
        audio_length = probe_content_length(audio_url) if probe_lengths else None

        talks.append(
            Talk(
                id=f"audiodharma:{source_id}",
                source=source.get("name", "AudioDharma"),
                source_id=source_id,
                title=entry.get("title", "").strip(),
                speaker="Matthew Brensilver",
                published_at=published_at,
                link=urljoin(BASE_URL, entry.get("link", f"/talks/{source_id}")),
                audio_url=audio_url,
                audio_type=entry.get("audio_type") or "audio/mpeg",
                audio_length=audio_length,
                duration=entry.get("duration") or None,
                description="AudioDharma talk by Matthew Brensilver.",
                image_url=SPEAKER_IMAGE,
            )
        )
    return talks


def _parse_date(value: str) -> datetime:
    parsed = datetime.strptime(value, "%Y.%m.%d")
    return parsed.replace(hour=12, minute=0, second=0, tzinfo=timezone.utc)


def _normalize_audio_type(value: str) -> str:
    if value == "audio/mp3":
        return "audio/mpeg"
    return value or "audio/mpeg"
