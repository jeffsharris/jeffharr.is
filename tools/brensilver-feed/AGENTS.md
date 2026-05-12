# Brensilver Feed Agent Notes

This directory is the implementation for the public Matthew Brensilver podcast
feeds. The deployed/generated artifacts live outside this tool at
`/brensilver/`.

## Edit Here, Generate There

- Hand-edit source code, tests, and config in `tools/brensilver-feed/`.
- Do not hand-edit `/brensilver/feed.xml`, `/brensilver/guided-feed.xml`,
  `/brensilver/*.json`, `/brensilver/index.html`, or
  `/brensilver/talks/*/index.html`; regenerate them.
- The repo-root wrapper is `scripts/build-brensilver-feed.py`. It supplies this
  tool's config and output path.
- The wrapper also seeds from existing `/brensilver/talks.json` so old archived
  talks survive when an upstream feed stops listing them.

## Source Merging

- Source config is `config/sources.json`.
- `dharmaseed` sources parse RSS. Teacher feeds are usually Matthew-only.
  Retreat feeds may contain several teachers, so use `include_speakers`.
  Private feeds can use `access_key_env`; generated feed URLs will include the
  key because podcast clients fetch enclosures directly.
- `dharmaseed_player` sources parse a single private player page. Configure
  private access through `access_key_env`; never hard-code the key in source
  config. Generated RSS/audio URLs will contain the key for podcast clients.
- `audiodharma` scrapes the speaker page and can optionally probe audio lengths.
- `merge_talks` dedupes by exact ID first, then by normalized date/title.
  Dharma Seed is preferred over AudioDharma when both sources expose the same
  recording.

## Feed Split

- `feed.xml` is for Dharma talks.
- `guided-feed.xml` is for guided meditations, guided metta, sitting
  instructions, and similar practice-first recordings.
- The split is title-pattern based in `build.py`. Update
  `GUIDED_FEED_TITLE_PATTERNS` and tests together.

## Verification

Run from repo root:

```sh
PYTHONPATH=tools/brensilver-feed/src python3 -m unittest tools/brensilver-feed/tests/test_sources.py
python3 scripts/build-brensilver-feed.py --copy-artwork
```

After adding or changing a source, continue into local ingestion. The feed
builder only discovers talks and rebuilds static feed artifacts; it does not
transcribe, correct, extract references, create episode artwork, or update QMD.
Use the repo-root runner:

```sh
scripts/run-brensilver-ingestion.sh
```

That command refreshes configured sources, then runs `run-corpus` against any
pending talks in `brensilver/talks.json`. For unattended scheduling, set
`BRENSILVER_AUTO_PUBLISH=1` in the environment so the generated `brensilver/`
artifacts are committed and pushed after a successful run.

After a rebuild, audit:

- New IDs appear in `brensilver/talks.json`.
- Dharma-talk IDs land in `brensilver/dharma-talks.json`.
- Guided/practice IDs land in `brensilver/guided-talks.json`.
- New `/brensilver/talks/{safe_id}/index.html` pages exist.
