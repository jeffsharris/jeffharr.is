#!/usr/bin/env python3
"""Generate static social preview cards from existing local assets."""

from __future__ import annotations

import json
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

REPO_ROOT = Path(__file__).resolve().parent.parent
CARD_SIZE = (1200, 630)
OUT_DIR = REPO_ROOT / "images/social"

FONT_CANDIDATES = {
    "regular": [
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ],
    "bold": [
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    ],
}


def font(size: int, weight: str = "regular") -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for path in FONT_CANDIDATES[weight]:
        if Path(path).exists():
            return ImageFont.truetype(path, size=size)
    return ImageFont.load_default()


def rounded_mask(size: tuple[int, int], radius: int) -> Image.Image:
    mask = Image.new("L", size, 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle((0, 0, size[0] - 1, size[1] - 1), radius=radius, fill=255)
    return mask


def paste_rounded(canvas: Image.Image, image: Image.Image, box: tuple[int, int], radius: int) -> None:
    image = image.convert("RGBA")
    image.putalpha(rounded_mask(image.size, radius))
    canvas.alpha_composite(image, box)


def save_card(image: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.convert("RGB").save(path, format="JPEG", quality=92, optimize=True)
    print(f"wrote {path.relative_to(REPO_ROOT)}")


def generate_poems_card() -> None:
    manifest = json.loads((REPO_ROOT / "poems/manifest.json").read_text())
    image_paths = [REPO_ROOT / path.lstrip("/") for path in manifest["images"].values()]
    chosen = random.SystemRandom().sample(image_paths, 8)

    canvas = Image.new("RGBA", CARD_SIZE, (247, 245, 239, 255))
    margin = 24
    gutter = 12
    cols = 4
    rows = 2
    cell_w = (CARD_SIZE[0] - margin * 2 - gutter * (cols - 1)) // cols
    cell_h = (CARD_SIZE[1] - margin * 2 - gutter * (rows - 1)) // rows

    for index, path in enumerate(chosen):
        col = index % cols
        row = index // cols
        x = margin + col * (cell_w + gutter)
        y = margin + row * (cell_h + gutter)
        image = Image.open(path).convert("RGB")
        tile = ImageOps.fit(image, (cell_w, cell_h), method=Image.LANCZOS)
        paste_rounded(canvas, tile, (x, y), 18)

    # A light edge keeps the collage readable when cropped by preview clients.
    draw = ImageDraw.Draw(canvas)
    draw.rounded_rectangle(
        (12, 12, CARD_SIZE[0] - 13, CARD_SIZE[1] - 13),
        radius=28,
        outline=(255, 255, 255, 185),
        width=4,
    )
    save_card(canvas, OUT_DIR / "poems-card.jpg")
    print("poem sample:", ", ".join(path.stem for path in chosen))


def draw_read_later_card() -> None:
    base = Image.open(REPO_ROOT / "images/collections/read-later-tile.jpg").convert("RGB")
    background = ImageOps.fit(base, CARD_SIZE, method=Image.LANCZOS, centering=(0.5, 0.34))
    background = background.filter(ImageFilter.GaussianBlur(3)).convert("RGBA")
    overlay = Image.new("RGBA", CARD_SIZE, (26, 31, 38, 138))
    canvas = Image.alpha_composite(background, overlay)
    draw = ImageDraw.Draw(canvas)

    draw.rounded_rectangle((76, 84, 500, 546), radius=24, fill=(250, 249, 244, 238))
    draw.text((122, 160), "Read Later", font=font(70, "bold"), fill=(31, 37, 45, 255))
    draw.text((126, 244), "My queue", font=font(36), fill=(82, 91, 103, 255))
    draw.line((126, 314, 438, 314), fill=(204, 198, 185, 255), width=3)

    card_specs = [
        ((612, 102, 1088, 238), "Long essay", "Saved for a quiet read"),
        ((562, 268, 1038, 404), "Video", "Watch when there is time"),
        ((642, 434, 1118, 570), "Article", "Queued from the web"),
    ]
    for bounds, title, subtitle in card_specs:
        x0, y0, x1, y1 = bounds
        draw.rounded_rectangle((x0 + 10, y0 + 16, x1 + 10, y1 + 16), radius=18, fill=(0, 0, 0, 42))
        draw.rounded_rectangle(bounds, radius=18, fill=(255, 255, 255, 236))
        draw.rounded_rectangle((x0 + 28, y0 + 28, x0 + 96, y0 + 96), radius=14, fill=(218, 226, 231, 255))
        draw.text((x0 + 122, y0 + 34), title, font=font(30, "bold"), fill=(30, 36, 43, 255))
        draw.text((x0 + 122, y0 + 78), subtitle, font=font(22), fill=(101, 109, 118, 255))

    save_card(canvas, OUT_DIR / "read-later-card.jpg")


def draw_share_card() -> None:
    canvas = Image.new("RGBA", CARD_SIZE, (244, 248, 247, 255))
    draw = ImageDraw.Draw(canvas)

    draw.rectangle((0, 0, CARD_SIZE[0], CARD_SIZE[1]), fill=(244, 248, 247, 255))
    draw.rounded_rectangle((62, 70, 528, 560), radius=28, fill=(33, 43, 49, 255))
    draw.text((112, 152), "Share", font=font(78, "bold"), fill=(250, 250, 246, 255))
    draw.text((116, 248), "One link for every listener.", font=font(32), fill=(202, 220, 214, 255))
    draw.line((116, 330, 462, 330), fill=(119, 168, 151, 255), width=4)

    cards = [
        ((604, 78, 1086, 226), "Podcast episode", (115, 168, 150), "audio, artwork, show notes"),
        ((554, 252, 1036, 400), "X thread", (61, 128, 180), "media, replies, context"),
        ((634, 426, 1116, 574), "Link", (181, 121, 70), "title, image, source"),
    ]
    for bounds, title, accent, subtitle in cards:
        x0, y0, x1, y1 = bounds
        draw.rounded_rectangle((x0 + 12, y0 + 16, x1 + 12, y1 + 16), radius=22, fill=(24, 36, 38, 36))
        draw.rounded_rectangle(bounds, radius=22, fill=(255, 255, 255, 245))
        draw.ellipse((x0 + 30, y0 + 36, x0 + 92, y0 + 98), fill=accent + (255,))
        draw.text((x0 + 118, y0 + 36), title, font=font(30, "bold"), fill=(31, 40, 45, 255))
        draw.text((x0 + 118, y0 + 78), subtitle, font=font(22), fill=(99, 110, 115, 255))
        draw.line((x0 + 30, y1 - 28, x1 - 34, y1 - 28), fill=(221, 229, 226, 255), width=3)

    save_card(canvas, OUT_DIR / "share-card.jpg")


def main() -> int:
    generate_poems_card()
    draw_read_later_card()
    draw_share_card()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
