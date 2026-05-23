# Dharma Feed Agent Notes

This directory implements configured public podcast/archive feeds. Matthew
Brensilver artifacts live at `/dharma/brensilver/`, Rob Burbea artifacts at
`/dharma/burbea/`, and Alan Watts artifacts at `/dharma/watts/`.

For the whole content system, including local ingestion, QMD, recurring
automation, private Dharma Seed keys, and adding another teacher, read
`../brensilver-transcripts/docs/dharma-content-agent-runbook.md`.

## Edit Here, Generate There

- Hand-edit source code, tests, and config in `tools/dharma-feed/`.
- Do not hand-edit generated files under `dharma/{corpus}/`; regenerate them
  through the matching wrapper.
- Matthew wrapper: `scripts/build-brensilver-feed.py`
- Rob Burbea wrapper: `scripts/build-burbea-feed.py`
- Alan Watts wrapper: `scripts/build-watts-feed.py`
- Shared wrapper logic: `scripts/lib/dharma_feed_runner.py`

The wrappers seed from existing `dharma/{corpus}/talks.json` so archived talks
survive when an upstream source stops listing them.

## Source Merging

- Config files live in `tools/dharma-feed/config/`.
- `dharmaseed` sources parse RSS. Retreat feeds may contain several teachers,
  so use `include_speakers`.
- `dharmaseed_player` sources parse a single private player page. Configure
  private access through `access_key_env`; never hard-code the key.
- `audiodharma` scrapes speaker listings and can optionally probe audio lengths.
- `podcast_rss` parses normal RSS feeds and supports local `feed_path` sources
  such as `tools/dharma-feed/sources/watts.xml`.
- `merge_talks` dedupes by exact ID first, then by normalized date/title.

## Feed Split

- `feed.xml` is for Dharma talks.
- `guided-feed.xml` is for guided meditations, metta/heart practices, sitting
  instructions, and similar practice-first recordings.
- The split is title-pattern based in `dharma_feed.build`. Update
  `GUIDED_FEED_TITLE_PATTERNS` and tests together.

## Verification

Run from repo root:

```sh
PYTHONPATH=tools/dharma-feed/src python3 -m unittest tools/dharma-feed/tests/test_sources.py
python3 scripts/build-brensilver-feed.py --copy-artwork
python3 scripts/build-burbea-feed.py --copy-artwork
python3 scripts/build-watts-feed.py --copy-artwork
```

After adding or changing a source, continue into local ingestion. The feed
builder does not transcribe, correct, extract references, create episode
artwork, or update QMD. Use the relevant corpus runner, for example:

```sh
scripts/run-brensilver-ingestion.sh
```

Publishing should go through Git, not a direct Pages upload. Cloudflare Pages
deploys `main` automatically, so fetch and fast-forward or rebase before pushing
generated feed artifacts.
