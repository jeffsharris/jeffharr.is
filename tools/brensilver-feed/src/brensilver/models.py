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
    venue: Optional[str] = None
    series: Optional[str] = None
    tags: List[str] = field(default_factory=list)
    transcript: TranscriptRef = field(default_factory=TranscriptRef)

    def to_json_dict(self) -> Dict[str, Any]:
        data = asdict(self)
        data["published_at"] = self.published_at.isoformat()
        return data
