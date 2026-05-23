from __future__ import annotations

import json
import re
import shutil
from dataclasses import replace
from pathlib import Path
from typing import Iterable, List, Optional

from dharma_feed.models import PodcastChapter, Talk


def enrich_talks(
    talks: Iterable[Talk],
    corpus_dir: Path,
    media_base_url: str,
    site_base_url: str,
) -> List[Talk]:
    return [
        enrich_talk(
            talk,
            corpus_dir=corpus_dir,
            media_base_url=media_base_url,
            site_base_url=site_base_url,
        )
        for talk in talks
    ]


def enrich_talk(
    talk: Talk,
    corpus_dir: Path,
    media_base_url: str,
    site_base_url: str,
) -> Talk:
    safe = safe_id(talk.id)
    canonical_url = join_url(site_base_url, f"talks/{safe}/")
    metadata = load_json(corpus_dir / "episode-metadata" / f"{safe}.json")
    image_path = corpus_dir / "artwork" / "images" / f"{safe}.jpg"
    chapters = build_podcast_chapters(metadata.get("chapters", []), canonical_url)
    episode_image_url = (
        join_url(media_base_url, f"artwork/{safe}.jpg")
        if image_path.exists()
        else None
    )
    chapters_url = join_url(media_base_url, f"chapters/{safe}.json") if chapters else None

    return replace(
        talk,
        canonical_url=canonical_url,
        podcast_description=metadata.get("description") or None,
        short_summary=metadata.get("short_summary") or None,
        episode_image_url=episode_image_url,
        chapters_url=chapters_url,
        chapters=chapters,
    )


def write_episode_media(
    talks: Iterable[Talk],
    out_dir: Path,
    corpus_dir: Path,
    copy_artwork: bool = False,
) -> dict[str, int]:
    chapters_written = 0
    artwork_copied = 0
    manifest: dict[str, list[dict[str, str]]] = {"chapters": [], "artwork": []}
    chapters_dir = out_dir / "chapters"
    artwork_dir = out_dir / "artwork"

    for talk in talks:
        safe = safe_id(talk.id)
        if talk.chapters:
            chapters_dir.mkdir(parents=True, exist_ok=True)
            chapter_path = chapters_dir / f"{safe}.json"
            chapter_path.write_text(
                json.dumps(
                    {
                        "version": "1.2.0",
                        "chapters": [chapter.to_chapter_json() for chapter in talk.chapters],
                    },
                    indent=2,
                    ensure_ascii=False,
                )
                + "\n",
                encoding="utf-8",
            )
            chapters_written += 1
            manifest["chapters"].append(
                {
                    "talk_id": talk.id,
                    "key": f"chapters/{safe}.json",
                    "source_path": str(chapter_path.relative_to(out_dir)),
                    "url": talk.chapters_url or "",
                }
            )

        if copy_artwork and talk.episode_image_url:
            source = corpus_dir / "artwork" / "images" / f"{safe}.jpg"
            if source.exists():
                artwork_dir.mkdir(parents=True, exist_ok=True)
                artwork_path = artwork_dir / f"{safe}.jpg"
                shutil.copyfile(source, artwork_path)
                artwork_copied += 1
                manifest["artwork"].append(
                    {
                        "talk_id": talk.id,
                        "key": f"artwork/{safe}.jpg",
                        "source_path": str(artwork_path.relative_to(out_dir)),
                        "url": talk.episode_image_url,
                    }
                )
        elif talk.episode_image_url:
            source = corpus_dir / "artwork" / "images" / f"{safe}.jpg"
            if source.exists():
                manifest["artwork"].append(
                    {
                        "talk_id": talk.id,
                        "key": f"artwork/{safe}.jpg",
                        "source_path": str(source),
                        "url": talk.episode_image_url,
                    }
                )

    if manifest["chapters"] or manifest["artwork"]:
        (out_dir / "media-manifest.json").write_text(
            json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )

    return {"chapters": chapters_written, "artwork": artwork_copied}


def build_podcast_chapters(raw_chapters: object, canonical_url: str) -> List[PodcastChapter]:
    if not isinstance(raw_chapters, list):
        return []
    chapters: List[PodcastChapter] = []
    for item in raw_chapters:
        if not isinstance(item, dict):
            continue
        start = coerce_float(item.get("start"))
        title = clean_text(item.get("title")) or "Section"
        description = clean_text(item.get("description"))
        chapters.append(
            PodcastChapter(
                start=start,
                title=title,
                description=description,
                url=join_url(canonical_url, f"?t={int(round(start))}"),
            )
        )
    chapters.sort(key=lambda chapter: chapter.start)
    return chapters


def safe_id(talk_id: str) -> str:
    return re.sub(r"[^a-zA-Z0-9]+", "-", talk_id).strip("-").lower()


def load_json(path: Path) -> dict:
    if not path.exists():
        return {}
    with path.open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    return data if isinstance(data, dict) else {}


def join_url(base_url: str, path: str) -> str:
    if path.startswith("?"):
        return f"{base_url.rstrip('/')}/{path}"
    return f"{base_url.rstrip('/')}/{path.lstrip('/')}"


def clean_text(value: object) -> Optional[str]:
    if value is None:
        return None
    text = " ".join(str(value).split())
    return text or None


def coerce_float(value: object) -> float:
    try:
        return max(0.0, float(value))
    except (TypeError, ValueError):
        return 0.0
