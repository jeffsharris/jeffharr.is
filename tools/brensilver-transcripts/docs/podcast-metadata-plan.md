# Podcast Metadata, Chapters, and Artwork Plan

This is the next pipeline layer after transcript correction and reference
extraction. It should stay idempotent and batchable, just like transcription.

## Pipeline Shape

1. `transcribe`: Whisper segment timestamps from source audio.
2. `correct`: GPT-5.4 mini transcript accuracy pass.
3. `clean`: local silence-hallucination and boilerplate cleanup.
4. `extract-references`: person, work, selected material, and teaching-reference
   moments.
5. `summarize-episode`: GPT-5.4 mini podcast metadata pass.
6. `generate-artwork-prompt`: GPT-5.4 mini visual prompt synthesis.
7. `generate-artwork`: GPT Image model creates episode image.
8. `publish-media`: upload approved artwork and chapter JSON to public storage.
9. `feed`: RSS generator merges description, timestamps, image URL, and optional
   Podcasting 2.0 chapter JSON URL.

## New Local Artifacts

```txt
.local-corpus/brensilver/
  episode-metadata/{talk_id}.json
  artwork/prompts/{talk_id}.json
  artwork/images/{talk_id}.jpg
  artwork/manifests/{talk_id}.json
  chapters/{talk_id}.json
```

`episode-metadata` is the canonical local output. Feed generation should read
from that file, not scrape text from markdown.

## Episode Metadata JSON

Each talk should produce:

- `description`: 2-4 sentences, podcast-ready, no hype.
- `chapters`: 4-9 sections, each with `start`, `end`, `title`, and a one-sentence
  description.
- `description_with_timestamps`: plain text / HTML-safe text for podcast
  episode notes.
- `image_brief`: a short conceptual image direction.
- `image_prompt`: final generation prompt with the shared style.
- `source_caveats`: uncertainties or transcript concerns that should not be
  hidden.

## Metadata Prompt Direction

Use corrected transcript segments plus extracted references. Ask GPT-5.4 mini
to describe the actual movement of the talk, not just restate the title.
Chapters should reflect meaningful shifts in the teaching or meditation, not
every quote or every paragraph.

Rules:

- Use only supplied transcript/reference data.
- Keep descriptions concrete and restrained.
- Make chapters useful in a podcast player.
- Prefer section titles under 7 words.
- If the talk is guided meditation, chapter around practice phases and long
  silent stretches.
- If a transcript looks suspicious, add `source_caveats` rather than pretending
  certainty.

## Artwork Style

Shared style: simple square editorial illustration, quiet natural forms,
restrained palette, soft paper texture, no text, no logos, no faces unless the
talk specifically needs a human figure, no literal Buddha statue by default.

The image should feel like a clear visual metaphor for the talk: a path, bowl,
water, light, seed, branch, doorway, stone, or field. Keep composition simple
enough to remain legible as a small podcast thumbnail.

## Model Choice

Use GPT-5.4 mini for text metadata and image prompt synthesis. Keep the image
model configurable with `--image-model`.

The user requested `gpt-image-2`. Keep model choice configurable. The manifest
records both `requested_image_model` and the model that actually generated the
image.

## Storage

Generated originals stay local. Public podcast images need stable HTTPS URLs.

Preferred public storage:

- Cloudflare R2 bucket such as `brensilver-media`
- public/custom URL shape:
  `https://media.jeffharr.is/brensilver/artwork/{safe_id}.jpg`

For the 20-talk pilot, static Pages assets are acceptable if R2 setup slows us
down. The full 647-talk corpus should use R2 or equivalent object storage. At
the current 1024px JPEG size, the corpus is probably manageable in raw bytes,
but GitHub is still the wrong long-term media store because regenerated artwork
bloats repo history and makes Pages deploys carry media churn.

## Feed Integration

Extend `tools/brensilver-feed` so each RSS item can merge optional metadata:

- `<description>` / `<itunes:summary>` from `description_with_timestamps`
- `<itunes:image href="...">` from the published artwork URL
- optional `<podcast:chapters url="..." type="application/json+chapters">`

Keep timestamp lines directly in the description as the compatibility fallback.
Podcasting 2.0 chapter JSON can be added alongside it for clients that support
chapters.

## Pilot Sequence

1. Generate metadata and chapters for the existing 20 talks.
2. Review descriptions and chapter boundaries in the feedback viewer.
3. Generate all 20 pilot images once style is approved enough for a batch.
4. Publish pilot media and update the feed for those 20 items.
5. Scale to the next batch only after transcript QA, metadata QA, and image
   style QA all look stable.
