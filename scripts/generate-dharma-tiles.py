#!/usr/bin/env python3
"""Generate landing-tile images for each dharma teacher.

Each teacher gets a chunky portrait-style tile that places them inside a
richer scene rendered in their signature visual vocabulary (drawn from the
corpus image_style prompts in tools/brensilver-transcripts/config/).

Usage:
    OPENAI_API_KEY=sk-... python3 scripts/generate-dharma-tiles.py
    # or pass --teacher to regenerate just one
    OPENAI_API_KEY=sk-... python3 scripts/generate-dharma-tiles.py --teacher watts
    # add --force to overwrite an existing tile
    OPENAI_API_KEY=sk-... python3 scripts/generate-dharma-tiles.py --force
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

REPO_ROOT = Path(__file__).resolve().parent.parent
OPENAI_URL = "https://api.openai.com/v1/images/generations"
MODEL_FALLBACKS = ["gpt-image-1.5", "gpt-image-1"]
SIZE = "1024x1024"
QUALITY = "high"

TILES = {
    "brensilver": {
        "name": "Matthew Brensilver",
        "tile_path": REPO_ROOT / "dharma/brensilver/artwork/brensilver-tile.jpg",
        "prompt": (
            "Editorial illustration in the style of a contemplative dharma podcast — "
            "Matthew Brensilver, a contemporary insight meditation teacher "
            "(clean-shaven, kind alert eyes, gentle present quality), rendered as a "
            "respectful semi-abstract figure positioned slightly off-center in the "
            "lower portion of the composition, soft head-and-shoulders with subtle "
            "features. The surrounding space is a quiet pastoral backdrop: dawn "
            "light over gentle hills, a single small tree, scattered leaves "
            "drifting, suggesting morning stillness and the unfolding of a clear "
            "day. Restrained palette of moss green, warm ochre, charcoal, muted "
            "blue, and bone white. Soft hand-painted paper texture, gentle "
            "gradients, no harsh outlines. The whole composition feels meditative "
            "and inviting. No text, no logos, no ornate religious iconography."
        ),
    },
    "burbea": {
        "name": "Rob Burbea",
        "tile_path": REPO_ROOT / "dharma/burbea/artwork/burbea-tile.jpg",
        "prompt": (
            "Editorial illustration in Imaginal Night Garden style — Rob Burbea, a "
            "contemporary contemplative teacher (warm eyes, glasses, slight beard, "
            "an air of tender depth), rendered as a luminous semi-abstract figure "
            "positioned in the lower center of the composition. Around him: a deep "
            "indigo night garden with pearl-white star clusters, black-green "
            "leaves, muted gold seed-lights, subtle celestial geometry, a winding "
            "luminous path receding into mystery. The mood is imaginal, dreamlike, "
            "tender, spacious — a soulmaking garden at night. Soft print texture, "
            "restrained palette of deep indigo, black-green, pearl white, and "
            "muted gold. No text, no logos, no ornate religious iconography."
        ),
    },
    "watts": {
        "name": "Alan Watts",
        "tile_path": REPO_ROOT / "dharma/watts/artwork/watts-tile.jpg",
        "prompt": (
            "Editorial illustration in zen modernist style — Alan Watts, "
            "mid-20th-century Anglo-American philosopher (contemplative gaze, "
            "slight smile, period-appropriate features, calm presence), rendered "
            "in spare ink-wash strokes positioned off-center in the lower portion "
            "of the composition. The surrounding space is vast, open, and "
            "disciplined: a single vermilion enso circle or sun mark, sparse muted "
            "jade brush textures, geometric horizon line, warm off-white paper. "
            "The mood is lucid, philosophical, mid-century book-cover "
            "sensibility, quiet. Indigo black ink with one vermilion accent. No "
            "text, no logos, no ornate religious iconography."
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


def generate_tile(slug: str, force: bool) -> None:
    spec = TILES[slug]
    out: Path = spec["tile_path"]
    if out.exists() and not force:
        print(f"  skip ({out.relative_to(REPO_ROOT)} exists — use --force to overwrite)")
        return

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise SystemExit("OPENAI_API_KEY is required")

    last_error: Exception | None = None
    for model in MODEL_FALLBACKS:
        print(f"  generating with {model}...")
        try:
            image_bytes = call_openai(api_key, model, spec["prompt"])
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_bytes(image_bytes)
            print(f"  wrote {out.relative_to(REPO_ROOT)} ({len(image_bytes):,} bytes)")
            return
        except Exception as error:  # noqa: BLE001
            last_error = error
            message = str(error)
            print(f"  {model} failed: {message[:200]}")
            if "safety" in message.lower() or "rejected" in message.lower():
                break
    raise SystemExit(f"All models failed for {slug}: {last_error}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--teacher",
        choices=list(TILES.keys()) + ["all"],
        default="all",
        help="Which teacher tile to generate (default: all)",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Overwrite existing tile files",
    )
    args = parser.parse_args()

    slugs = list(TILES.keys()) if args.teacher == "all" else [args.teacher]
    for slug in slugs:
        print(f"{slug} — {TILES[slug]['name']}")
        generate_tile(slug, args.force)
    return 0


if __name__ == "__main__":
    sys.exit(main())
