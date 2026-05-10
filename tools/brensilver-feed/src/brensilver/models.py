from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional


@dataclass(frozen=True)
class TranscriptRef:
    status: str = "pending"
    url: Optional[str] = None
    text_path: Optional[str] = None


@dataclass(frozen=True)
class PodcastChapter:
    start: float
    title: str
    description: Optional[str] = None
    url: Optional[str] = None
    img: Optional[str] = None
    toc: bool = True

    def to_chapter_json(self) -> Dict[str, Any]:
        data: Dict[str, Any] = {
            "startTime": round(float(self.start), 3),
            "title": self.title,
        }
        if self.url:
            data["url"] = self.url
        if self.img:
            data["img"] = self.img
        if self.toc is False:
            data["toc"] = False
        return data


@dataclass(frozen=True)
class Talk:
    id: str
    source: str
    source_id: str
    title: str
    speaker: str
    published_at: datetime
    link: str
    audio_url: str
    audio_type: str = "audio/mpeg"
    audio_length: Optional[int] = None
    duration: Optional[str] = None
    description: Optional[str] = None
    image_url: Optional[str] = None
    canonical_url: Optional[str] = None
    podcast_description: Optional[str] = None
    short_summary: Optional[str] = None
    episode_image_url: Optional[str] = None
    chapters_url: Optional[str] = None
    chapters: List[PodcastChapter] = field(default_factory=list)
    venue: Optional[str] = None
    series: Optional[str] = None
    tags: List[str] = field(default_factory=list)
    transcript: TranscriptRef = field(default_factory=TranscriptRef)

    def to_json_dict(self) -> Dict[str, Any]:
        data = asdict(self)
        data["published_at"] = self.published_at.isoformat()
        for key in [
            "canonical_url",
            "podcast_description",
            "short_summary",
            "episode_image_url",
            "chapters_url",
        ]:
            if data.get(key) is None:
                data.pop(key, None)
        if not data.get("chapters"):
            data.pop("chapters", None)
        return data
