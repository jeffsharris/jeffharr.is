from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, List

from dharma_feed.metadata import safe_id
from dharma_feed.models import Talk


PROTECTED_ARTWORK_SUFFIXES = (
    "-podcast-cover.jpg",
    "-tile.jpg",
    "-tile-backdrop.jpg",
)

ARTWORK_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}


@dataclass(frozen=True)
class GeneratedArtifactPruneReport:
    out_dir: Path
    stale_talk_pages: List[Path]
    stale_chapters: List[Path]
    stale_artwork: List[Path]
    protected_artwork: List[Path]

    @property
    def has_stale_artifacts(self) -> bool:
        return bool(self.stale_talk_pages or self.stale_chapters or self.stale_artwork)


def plan_generated_artifact_prune(
    talks: Iterable[Talk],
    out_dir: Path,
    copy_artwork: bool = False,
) -> GeneratedArtifactPruneReport:
    talk_list = list(talks)
    expected_talk_ids = {safe_id(talk.id) for talk in talk_list if talk.id}
    expected_chapter_ids = {safe_id(talk.id) for talk in talk_list if talk.id and talk.chapters}
    expected_artwork_ids = (
        {safe_id(talk.id) for talk in talk_list if talk.id and talk.episode_image_url}
        if copy_artwork
        else set()
    )

    stale_talk_pages = [
        page
        for page in sorted((out_dir / "talks").glob("*/index.html"))
        if page.parent.name not in expected_talk_ids
    ]
    stale_chapters = [
        chapter
        for chapter in sorted((out_dir / "chapters").glob("*.json"))
        if chapter.stem not in expected_chapter_ids
    ]

    stale_artwork: List[Path] = []
    protected_artwork: List[Path] = []
    artwork_dir = out_dir / "artwork"
    if artwork_dir.exists():
        for artwork in sorted(artwork_dir.iterdir()):
            if not artwork.is_file() or artwork.suffix.lower() not in ARTWORK_EXTENSIONS:
                continue
            if is_protected_artwork(artwork):
                protected_artwork.append(artwork)
            elif artwork.stem not in expected_artwork_ids:
                stale_artwork.append(artwork)

    return GeneratedArtifactPruneReport(
        out_dir=out_dir,
        stale_talk_pages=stale_talk_pages,
        stale_chapters=stale_chapters,
        stale_artwork=stale_artwork,
        protected_artwork=protected_artwork,
    )


def format_prune_report(report: GeneratedArtifactPruneReport, max_paths: int = 25) -> str:
    lines = [
        f"Generated artifact prune report for {report.out_dir}",
        f"stale talk pages: {len(report.stale_talk_pages)}",
    ]
    lines.extend(format_path_list(report.out_dir, report.stale_talk_pages, max_paths))
    lines.append(f"stale chapter files: {len(report.stale_chapters)}")
    lines.extend(format_path_list(report.out_dir, report.stale_chapters, max_paths))
    lines.append(f"stale artwork files: {len(report.stale_artwork)}")
    lines.extend(format_path_list(report.out_dir, report.stale_artwork, max_paths))
    lines.append(f"protected artwork files: {len(report.protected_artwork)}")
    return "\n".join(lines)


def format_path_list(out_dir: Path, paths: List[Path], max_paths: int) -> List[str]:
    if not paths:
        return []
    visible = paths[:max_paths]
    lines = [f"  - {path.relative_to(out_dir)}" for path in visible]
    remaining = len(paths) - len(visible)
    if remaining > 0:
        lines.append(f"  ... {remaining} more")
    return lines


def is_protected_artwork(path: Path) -> bool:
    name = path.name.lower()
    return any(name.endswith(suffix) for suffix in PROTECTED_ARTWORK_SUFFIXES)
