# Dharma Feed Tool

Builds configured public podcast and archive artifacts under `/dharma/{corpus}/`.
The same builder currently serves Matthew Brensilver, Rob Burbea, and Alan
Watts.

For each corpus, the builder writes:

- `/dharma/{corpus}/feed.xml`
- `/dharma/{corpus}/guided-feed.xml`
- `/dharma/{corpus}/talks.json`
- `/dharma/{corpus}/dharma-talks.json`
- `/dharma/{corpus}/guided-talks.json`
- `/dharma/{corpus}/index.html`
- `/dharma/{corpus}/talks/{safe_id}/index.html`
- `/dharma/{corpus}/chapters/{safe_id}.json` when local episode metadata exists
- `/dharma/{corpus}/artwork/{safe_id}.jpg` when `--copy-artwork` is used

## Entry Points

Run wrapper scripts from the repo root:

```sh
python3 scripts/build-brensilver-feed.py
python3 scripts/build-burbea-feed.py
python3 scripts/build-watts-feed.py
```

The wrappers are intentionally small and delegate shared argument construction
to `scripts/lib/dharma_feed_runner.py`. Keep the existing wrapper names stable:
the transcript pipeline configs call them directly.

Each wrapper points at one config file in `tools/dharma-feed/config/`, writes to
`dharma/{corpus}/`, and seeds from the existing `dharma/{corpus}/talks.json`
when it is present. That seed preserves the archive when upstream feeds shrink
or stop listing older talks. Live source records are loaded first and win on
duplicate IDs; seed-only records are kept.

## Source Layout

Supported source types:

- `dharmaseed`: RSS feeds from Dharma Seed teacher or retreat URLs.
- `dharmaseed_player`: a single private Dharma Seed player page, used when a
  recording is playable with an access key but not listed in retreat RSS.
- `audiodharma`: AudioDharma speaker listings.
- `podcast_rss`: ordinary RSS feeds, including local `feed_path` source files
  such as `tools/dharma-feed/sources/watts.xml`.

Retreat feeds can contain several teachers. Add `include_speakers` to keep only
the intended teacher's talks. The parser filters by `<itunes:author>` after
normalizing case and punctuation.

For private Dharma Seed RSS feeds or player items, put the key in an
environment variable with `access_key_env`; do not commit the key into config.
Generated RSS enclosure URLs may still contain the key because podcast clients
need direct authenticated MP3 URLs.

When changing a source:

1. Update the relevant config file in `tools/dharma-feed/config/`.
2. Update parser/classifier tests in `tools/dharma-feed/tests/test_sources.py`.
3. Rebuild through the corpus wrapper.
4. Audit `dharma/{corpus}/dharma-talks.json` and
   `dharma/{corpus}/guided-talks.json` before committing generated artifacts.

## Local Podcast Metadata

When `.local-corpus/{corpus}/` exists, the builder can merge locally generated
episode metadata into RSS, talk pages, chapters, and copied artwork:

```sh
python3 scripts/build-brensilver-feed.py \
  --talks-json dharma/brensilver/talks.json \
  --media-base-url https://jeffharr.is/dharma/brensilver/ \
  --copy-artwork
```

Use the same pattern for `burbea` or `watts` with their wrapper script and
public path. Same-site preview URLs are useful while reviewing generated
artifacts. For production artwork at scale, prefer an R2 media base such as
`https://media.jeffharr.is/brensilver/`.

Each enriched RSS item can include:

- generated description and timestamp lines
- episode artwork or a corpus fallback image
- Podcasting 2.0 chapter JSON
- a canonical `/dharma/{corpus}/talks/{safe_id}/` web-player link

## Feed Split

`feed.xml` is the Dharma-talk feed. `guided-feed.xml` is the companion feed for
guided meditations, metta/heart practices, retreat sitting instructions,
practice sessions, and similar practice-first recordings.

The split is title-pattern based in `dharma_feed.build`. If a new source
introduces practice-first titles that do not match existing patterns, add a
focused pattern and a classifier test.

## Transcript Pipeline

This tool only discovers talks and builds public feed/archive artifacts. Local
transcripts, reference extraction, artwork generation, markdown, QMD indexing,
and batch rebuild orchestration live in `tools/brensilver-transcripts/`. That
package name is historical, but the pipeline is corpus-configurable.
