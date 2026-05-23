from __future__ import annotations

from typing import Optional
from urllib.error import HTTPError
from urllib.request import Request, urlopen

USER_AGENT = (
    "dharma-feed/0.1 "
    "(https://jeffharr.is/dharma/brensilver/; podcast feed merger for personal archive)"
)


def fetch_text(url: str, timeout: int = 30) -> str:
    request = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "*/*"})
    with urlopen(request, timeout=timeout) as response:
        content_type = response.headers.get_content_charset() or "utf-8"
        return response.read().decode(content_type, errors="replace")


def probe_content_length(url: str, timeout: int = 15) -> Optional[int]:
    request = Request(url, method="HEAD", headers={"User-Agent": USER_AGENT})
    try:
        with urlopen(request, timeout=timeout) as response:
            header = response.headers.get("Content-Length")
    except HTTPError:
        return None

    if not header:
        return None
    try:
        return int(header)
    except ValueError:
        return None
