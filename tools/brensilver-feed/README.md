# Brensilver Feed Tool

Builds the static podcast artifacts served from `/brensilver/`:

- `/brensilver/feed.xml`
- `/brensilver/guided-feed.xml`
- `/brensilver/talks.json`
- `/brensilver/dharma-talks.json`
- `/brensilver/guided-talks.json`
- `/brensilver/index.html`
- `/brensilver/talks/{safe_id}/index.html`
- `/brensilver/chapters/{safe_id}.json` when local episode metadata exists
- `/brensilver/artwork/{safe_id}.jpg` in same-site preview mode
- `/brensilver/artwork/matthew-brensilver-podcast-cover.jpg` as the canonical
  feed and fallback talk image

Run from the repo root:

```sh
python3 scripts/build-brensilver-feed.py
```

The wrapper script points at `tools/brensilver-feed/config/sources.json`, writes
to `/brensilver/`, and seeds from the existing `/brensilver/talks.json` when it
is present. That seed is intentional: source feeds can shrink or change history,
but this project treats previously generated talks as an archive. Live source
records are loaded first and win on duplicate IDs; seed-only records are kept.

The data model intentionally includes a transcript placeholder so a later
transcription job can attach transcript output without changing the RSS merge
logic.

## Source Layout

Feed sources are configured in `config/sources.json`. The current source types
are:

- `dharmaseed`: RSS feeds from Dharma Seed teacher or retreat URLs.
- `audiodharma`: Matthew's AudioDharma speaker listing.

Dharma Seed retreat feeds can contain multiple teachers. Add
`"include_speakers": ["Matthew Brensilver"]` to a retreat source to keep only
Matthew's talks. The parser filters by `<itunes:author>` after normalizing case
and punctuation.

To add another Dharma Seed stream:

1. Add a source entry in `config/sources.json`.
2. Use `include_speakers` unless the feed is already Matthew-only.
3. Update or add parser tests in `tests/test_sources.py` with a kept item and,
   for retreat feeds, a skipped non-Matthew item.
4. Rebuild with `python3 scripts/build-brensilver-feed.py --copy-artwork` when
   `.local-corpus/brensilver/` is available locally.
5. Check `brensilver/dharma-talks.json` and `brensilver/guided-talks.json` to
   confirm the feed split before committing generated files.

## Local Podcast Metadata

When `.local-corpus/brensilver/` exists, the builder can merge locally generated
episode metadata into the public RSS feed:

```sh
python3 scripts/build-brensilver-feed.py \
  --talks-json brensilver/talks.json \
  --media-base-url https://jeffharr.is/brensilver/ \
  --copy-artwork
```

That preview mode copies pilot artwork into `/brensilver/artwork/` and points
RSS image/chapter URLs at the same site. It is useful for the 20-talk pilot.
The generated `/brensilver/index.html` page includes a direct Overcast add link,
RSS/copy affordances for custom-feed podcast players, and player icons from the
Simple Icons CDN.

For the full corpus, prefer Cloudflare R2 for generated images:

```sh
python3 scripts/build-brensilver-feed.py \
  --talks-json brensilver/talks.json \
  --media-base-url https://media.jeffharr.is/brensilver/
```

In that mode, the feed and talk pages are static Pages files, while artwork URLs
point to R2. Chapter JSON is small enough to keep in GitHub/Pages, though it can
also be uploaded beside artwork if we want all podcast media under the same R2
origin.

Each enriched RSS item includes:

- `<description>` and `<itunes:summary>` with the generated talk description and
  timestamp lines.
- `<itunes:image>` pointing to episode artwork when available, otherwise the
  generated teacher portrait stored in each talk's `image_url` field.
- `<podcast:chapters>` pointing to Podcasting 2.0 chapter JSON.
- A canonical `/brensilver/talks/{safe_id}/` link whose `?t=seconds` parameter
  seeks the web audio player.

The main `feed.xml` is the Dharma-talk feed. `guided-feed.xml` is the companion
feed for guided meditations, guided metta/heart practices, retreat sitting
instructions, practice sessions, and similar practice-first recordings. The
builder writes `dharma-talks.json` and `guided-talks.json` so the split can be
audited without parsing RSS.

The guided split is title-pattern based in `build.py`. If a new source introduces
practice-first titles that do not begin with phrases like `Guided Meditation`,
add a focused pattern and a classifier test.

For incremental local corpus processing, prefer the transcript tool's
`run-corpus` command. It processes pending talks and calls this feed builder
every 20 talks by default:

```sh
PYTHONPATH=tools/brensilver-transcripts/src \
  python3 -m brensilver_transcripts.pipeline run-corpus \
  --limit 20 \
  --feed-every 20 \
  --media-base-url https://jeffharr.is/brensilver/ \
  --copy-artwork \
  --update-qmd
```
