#!/usr/bin/env python3
"""Generate landing-tile images for each dharma teacher.

Each tile is a portrait-orientation backdrop rendered by gpt-image-2 in the
teacher's signature visual vocabulary (drawn from the corpus image_style
prompts in tools/brensilver-transcripts/config/). The teacher's existing
square podcast-cover is then composited into the bottom-right corner as a
thoughtfully framed inset, so the literal cover sits inside a larger scene
in its own style.

Usage:
    OPENAI_API_KEY=sk-... python3 scripts/generate-dharma-tiles.py
    # regenerate just one teacher
    OPENAI_API_KEY=sk-... python3 scripts/generate-dharma-tiles.py --teacher watts
    # overwrite existing tiles
    OPENAI_API_KEY=sk-... python3 scripts/generate-dharma-tiles.py --force
    # only run the compositing step against an existing backdrop
    python3 scripts/generate-dharma-tiles.py --teacher watts --composite-only
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

REPO_ROOT = Path(__file__).resolve().parent.parent
OPENAI_URL = "https://api.openai.com/v1/images/generations"
MODEL_FALLBACKS = ["gpt-image-2", "gpt-image-1.5", "gpt-image-1"]
SIZE = "1024x1536"          # portrait
QUALITY = "high"

# Compositing geometry (in pixels, relative to the 1024x1536 canvas)
INSET_SIZE = 460            # final width/height of the square inset
INSET_MARGIN = 60           # distance from bottom/right edges of the canvas
INSET_FRAME = 10            # white frame around the inset
INSET_CORNER_RADIUS = 18    # rounded corner radius for the inset
SHADOW_BLUR = 36
SHADOW_OFFSET_Y = 20
SHADOW_OPACITY = 140        # 0–255

TILES = {
    "brensilver": {
        "name": "Matthew Brensilver",
        "source_cover": REPO_ROOT / "dharma/brensilver/artwork/matthew-brensilver-podcast-cover.jpg",
        "backdrop_path": REPO_ROOT / "dharma/brensilver/artwork/brensilver-tile-backdrop.jpg",
        "tile_path": REPO_ROOT / "dharma/brensilver/artwork/brensilver-tile.jpg",
        "prompt": (
            "Editorial illustration in the style of a contemplative dharma podcast. "
            "Portrait orientation. Quiet pastoral backdrop: dawn light over gentle "
            "rolling hills, a single small tree, scattered leaves drifting on warm "
            "air, suggesting morning stillness and the unfolding of a clear day. "
            "Restrained palette of moss green, warm ochre, charcoal, muted blue, "
            "and bone white. Soft hand-painted paper texture, gentle gradients, no "
            "harsh outlines. The composition should leave the bottom-right quarter "
            "visually quiet and uncluttered — a soft empty area suitable for "
            "hosting a small square inset photograph. The whole scene feels "
            "meditative, inviting, and visually balanced around that emptiness. "
            "No text, no logos, no figures, no ornate religious iconography."
        ),
    },
    "burbea": {
        "name": "Rob Burbea",
        "source_cover": REPO_ROOT / "dharma/burbea/artwork/rob-burbea-podcast-cover.jpg",
        "backdrop_path": REPO_ROOT / "dharma/burbea/artwork/burbea-tile-backdrop.jpg",
        "tile_path": REPO_ROOT / "dharma/burbea/artwork/burbea-tile.jpg",
        "prompt": (
            "Editorial illustration in Imaginal Night Garden style. Portrait "
            "orientation. A deep indigo night garden with pearl-white star "
            "clusters, black-green leaves, muted gold seed-lights, subtle "
            "celestial geometry, and a winding luminous path receding into the "
            "upper distance. The mood is imaginal, dreamlike, tender, and "
            "spacious — a soulmaking garden at night. Soft print texture, "
            "restrained palette of deep indigo, black-green, pearl white, and "
            "muted gold. The composition should leave the bottom-right quarter "
            "visually quiet and uncluttered — a soft empty area suitable for "
            "hosting a small square inset photograph. No text, no logos, no "
            "figures, no ornate religious iconography."
        ),
    },
    "watts": {
        "name": "Alan Watts",
        "source_cover": REPO_ROOT / "dharma/watts/artwork/alan-watts-podcast-cover.jpg",
        "backdrop_path": REPO_ROOT / "dharma/watts/artwork/watts-tile-backdrop.jpg",
        "tile_path": REPO_ROOT / "dharma/watts/artwork/watts-tile.jpg",
        "prompt": (
            "Editorial illustration in zen modernist style. Portrait orientation. "
            "Vast open space on warm off-white paper, a single vermilion enso "
            "circle or sun mark in the upper portion of the composition, sparse "
            "muted jade brush textures, a disciplined geometric horizon line, "
            "indigo black ink with one vermilion accent. The mood is lucid, "
            "philosophical, mid-century book-cover sensibility, quiet. The "
            "composition should leave the bottom-right quarter visually quiet "
            "and uncluttered — a soft empty area suitable for hosting a small "
            "square inset photograph. No text, no logos, no figures, no ornate "
            "religious iconography."
        ),
    },
}


def call_openai(api_key: str, model: str, prompt: str) -> bytes:
    payload = {
        "model": model,
        "prompt": prompt,
        "size": SIZE,
        "quality": QUALITY,
        "output_format": "jpeg",
    }
    req = urllib.request.Request(
        OPENAI_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    last_error: Exception | None = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=300) as response:
                body = json.loads(response.read().decode("utf-8"))
            break
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")
            last_error = RuntimeError(f"HTTP {error.code}: {detail[:400]}")
            if error.code in {429, 500, 502, 503, 504} and attempt < 3:
                time.sleep(2**attempt)
                continue
            raise last_error
        except OSError as error:
            last_error = error
            if attempt < 3:
                time.sleep(2**attempt)
                continue
            raise
    else:
        if last_error:
            raise last_error
        raise RuntimeError("Image generation failed after retries")

    data = body.get("data") or []
    if not data:
        raise RuntimeError(f"OpenAI response had no image data: {body}")
    b64 = data[0].get("b64_json")
    if b64:
        return base64.b64decode(b64)
    url = data[0].get("url")
    if url:
        with urllib.request.urlopen(url, timeout=120) as resp:
            return resp.read()
    raise RuntimeError(f"OpenAI response missing image bytes: {data[0].keys()}")


def generate_backdrop(slug: str, force: bool) -> Path:
    spec = TILES[slug]
    out: Path = spec["backdrop_path"]
    if out.exists() and not force:
        print(f"  backdrop already exists: {out.relative_to(REPO_ROOT)}")
        return out

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise SystemExit("OPENAI_API_KEY is required")

    last_error: Exception | None = None
    for model in MODEL_FALLBACKS:
        print(f"  generating backdrop with {model}…")
        try:
            image_bytes = call_openai(api_key, model, spec["prompt"])
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_bytes(image_bytes)
            print(f"  wrote {out.relative_to(REPO_ROOT)} ({len(image_bytes):,} bytes)")
            return out
        except Exception as error:  # noqa: BLE001
            last_error = error
            message = str(error)
            print(f"  {model} failed: {message[:200]}")
            if "safety" in message.lower() or "rejected" in message.lower():
                break
    raise SystemExit(f"All models failed for {slug}: {last_error}")


def rounded_mask(size: int, radius: int) -> Image.Image:
    """Return an L-mode mask with rounded corners (white inside, black outside)."""
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return mask


def composite_tile(slug: str) -> Path:
    spec = TILES[slug]
    backdrop_path: Path = spec["backdrop_path"]
    source_cover_path: Path = spec["source_cover"]
    tile_path: Path = spec["tile_path"]

    if not backdrop_path.exists():
        raise SystemExit(f"backdrop missing for {slug}: {backdrop_path}")
    if not source_cover_path.exists():
        raise SystemExit(f"source cover missing for {slug}: {source_cover_path}")

    backdrop = Image.open(backdrop_path).convert("RGB")
    cover = Image.open(source_cover_path).convert("RGB")

    # Resize the cover to a clean square.
    cover_resized = cover.resize(
        (INSET_SIZE - 2 * INSET_FRAME, INSET_SIZE - 2 * INSET_FRAME),
        Image.LANCZOS,
    )

    # Build the framed inset card (white frame + rounded corners).
    inset_card = Image.new("RGBA", (INSET_SIZE, INSET_SIZE), (250, 247, 240, 255))
    inset_card.paste(cover_resized, (INSET_FRAME, INSET_FRAME))
    inset_card.putalpha(rounded_mask(INSET_SIZE, INSET_CORNER_RADIUS))

    # Drop-shadow layer (slightly larger than the card, blurred).
    shadow_pad = SHADOW_BLUR * 2
    shadow_size = INSET_SIZE + shadow_pad * 2
    shadow = Image.new("RGBA", (shadow_size, shadow_size), (0, 0, 0, 0))
    shadow_mask = rounded_mask(INSET_SIZE, INSET_CORNER_RADIUS).resize((INSET_SIZE, INSET_SIZE))
    shadow_layer = Image.new("RGBA", (INSET_SIZE, INSET_SIZE), (0, 0, 0, SHADOW_OPACITY))
    shadow_layer.putalpha(shadow_mask)
    shadow.paste(shadow_layer, (shadow_pad, shadow_pad), shadow_layer)
    shadow = shadow.filter(ImageFilter.GaussianBlur(SHADOW_BLUR))

    # Composite onto the backdrop at bottom-right with margin.
    canvas = backdrop.convert("RGBA")
    canvas_w, canvas_h = canvas.size
    inset_x = canvas_w - INSET_MARGIN - INSET_SIZE
    inset_y = canvas_h - INSET_MARGIN - INSET_SIZE

    # Shadow first, offset down for a soft drop.
    shadow_x = inset_x - shadow_pad
    shadow_y = inset_y - shadow_pad + SHADOW_OFFSET_Y
    canvas.alpha_composite(shadow, (shadow_x, shadow_y))
    canvas.alpha_composite(inset_card, (inset_x, inset_y))

    final = canvas.convert("RGB")
    tile_path.parent.mkdir(parents=True, exist_ok=True)
    final.save(tile_path, format="JPEG", quality=92)
    print(f"  composited {tile_path.relative_to(REPO_ROOT)} ({tile_path.stat().st_size:,} bytes)")
    return tile_path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--teacher",
        choices=list(TILES.keys()) + ["all"],
        default="all",
    )
    parser.add_argument("--force", action="store_true", help="Overwrite existing tile / backdrop")
    parser.add_argument(
        "--composite-only",
        action="store_true",
        help="Skip API generation; only run PIL compositing on the existing backdrop",
    )
    args = parser.parse_args()

    slugs = list(TILES.keys()) if args.teacher == "all" else [args.teacher]
    for slug in slugs:
        print(f"{slug} — {TILES[slug]['name']}")
        if not args.composite_only:
            generate_backdrop(slug, args.force)
        composite_tile(slug)
    return 0


if __name__ == "__main__":
    sys.exit(main())
