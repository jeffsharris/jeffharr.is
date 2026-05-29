#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
SIZE = 180


STATIC_ICONS = [
    ("images/jeff-editorial-portrait.jpg", "apple-touch-icon.png"),
    ("images/collections/dharma-tile.jpg", "dharma/apple-touch-icon.png"),
    ("images/collections/poems-tile.jpg", "poems/apple-touch-icon.png"),
    ("images/collections/read-later-tile.jpg", "read-later/apple-touch-icon.png"),
    (
        "dharma/brensilver/artwork/matthew-brensilver-podcast-cover.jpg",
        "dharma/brensilver/apple-touch-icon.png",
    ),
    (
        "dharma/burbea/artwork/rob-burbea-podcast-cover.jpg",
        "dharma/burbea/apple-touch-icon.png",
    ),
    (
        "dharma/watts/artwork/alan-watts-podcast-cover.jpg",
        "dharma/watts/apple-touch-icon.png",
    ),
]


def main() -> int:
    for source, destination in STATIC_ICONS:
        write_icon(ROOT / source, ROOT / destination)
    write_share_icon(ROOT / "share-assets/apple-touch-icon.png")
    return 0


def write_icon(source: Path, destination: Path) -> None:
    image = Image.open(source).convert("RGB")
    width, height = image.size
    side = min(width, height)
    left = (width - side) // 2
    top = (height - side) // 2
    image = image.crop((left, top, left + side, top + side))
    image = image.resize((SIZE, SIZE), Image.Resampling.LANCZOS)
    destination.parent.mkdir(parents=True, exist_ok=True)
    image.save(destination, "PNG", optimize=True)


def write_share_icon(destination: Path) -> None:
    scale = 4
    canvas_size = SIZE * scale
    image = Image.new("RGB", (canvas_size, canvas_size), "#B87925")
    draw = ImageDraw.Draw(image)

    def point(value: float) -> float:
        return value / 64 * canvas_size

    for cx, cy, r in [(22, 22, 7), (44, 18, 7), (42, 44, 7)]:
        draw.ellipse(
            (point(cx - r), point(cy - r), point(cx + r), point(cy + r)),
            fill="white",
        )

    stroke_width = round(point(5))
    draw.line(
        (point(28), point(21), point(38), point(18.5)),
        fill="white",
        width=stroke_width,
    )
    draw.line(
        (point(27.5), point(26.5), point(37), point(38.5)),
        fill="white",
        width=stroke_width,
    )

    image = image.resize((SIZE, SIZE), Image.Resampling.LANCZOS)
    destination.parent.mkdir(parents=True, exist_ok=True)
    image.save(destination, "PNG", optimize=True)


if __name__ == "__main__":
    raise SystemExit(main())
