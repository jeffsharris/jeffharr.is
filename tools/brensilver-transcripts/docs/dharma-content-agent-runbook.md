# Dharma Content Agent Runbook

This project has two related but distinct layers:

1. Public podcast/static-site feed generation in `tools/brensilver-feed/`.
2. Local transcript, reference, artwork, and QMD indexing in
   `tools/brensilver-transcripts/`.

Do not treat a new source as complete after it appears in `feed.xml`. New talks
must also pass through local ingestion so they get corrected transcripts,
external-reference extraction, episode descriptions, chapter JSON, artwork,
markdown, and QMD embeddings.

## Current Brensilver Architecture

- Source config: `tools/brensilver-feed/config/sources.json`
- Feed builder wrapper: `scripts/build-brensilver-feed.py`
- Local ingestion runner: `scripts/run-brensilver-ingestion.sh`
- Generated public artifacts: `brensilver/`
- Local private corpus: `.local-corpus/brensilver/`
- QMD index: `dharma`
- QMD collection: `brensilver`
- Main Dharma-talk feed: `brensilver/feed.xml`
- Guided/practice feed: `brensilver/guided-feed.xml`

The feed builder discovers talks and writes static feed/site artifacts. The
local ingestion runner refreshes source feeds first, then runs `run-corpus`,
which consumes `brensilver/talks.json` and processes any talk missing local
enrichment artifacts.

## Normal Ongoing Operation

The Mac Mini should run this every six hours:

```sh
cd /Users/embergpt/code/flipper/brensilver/site
scripts/run-brensilver-ingestion.sh
```

The installed launchd job should use:

- label: `com.jeffharris.brensilver-transcripts`
- interval: `21600` seconds
- script: `/Users/embergpt/code/flipper/brensilver/site/scripts/run-brensilver-ingestion.sh`

For unattended publishing, the environment sets:

```sh
BRENSILVER_AUTO_PUBLISH=1
BRENSILVER_INGEST_LIMIT=20
BRENSILVER_FEED_EVERY=20
BRENSILVER_MEDIA_BASE_URL=https://jeffharr.is/brensilver/
```

The runner refuses to auto-publish from a dirty worktree. That is intentional:
scheduled jobs should not accidentally commit an agent's unrelated edits.

## Adding More Matthew Brensilver Sources

1. Add the source to `tools/brensilver-feed/config/sources.json`.
2. Add or update parser tests in `tools/brensilver-feed/tests/test_sources.py`.
3. Run:

   ```sh
   PYTHONPATH=tools/brensilver-feed/src python3 -m unittest tools/brensilver-feed/tests/test_sources.py
   scripts/run-brensilver-ingestion.sh
   ```

4. Verify:

   ```sh
   python3 - <<'PY'
   import json
   from pathlib import Path
   talks = json.loads(Path("brensilver/talks.json").read_text())
   print(len(talks), talks[0]["id"], talks[0]["title"])
   PY
   ```

5. Check that new talk IDs have:

   ```txt
   brensilver/talks/{safe_id}/index.html
   brensilver/chapters/{safe_id}.json
   brensilver/artwork/{safe_id}.jpg
   .local-corpus/brensilver/transcripts/corrected/{safe_id}.json
   .local-corpus/brensilver/references/{safe_id}.json
   .local-corpus/brensilver/transcripts/markdown/{safe_id}.md
   ```

6. Commit source changes plus generated public artifacts. Do not commit
   `.local-corpus/` unless Jeff explicitly asks.

## Private Dharma Seed Sources

Private Dharma Seed RSS/player sources should use `access_key_env` in
`sources.json`. Do not hard-code private keys in the source config.

Example:

```json
{
  "type": "dharmaseed_player",
  "name": "Dharma Seed",
  "talk_id": "96948",
  "player_url": "https://dharmaseed.org/talks/player/96948.html",
  "access_key_env": "DHARMASEED_RETREAT_6753_ACCESS_KEY",
  "include_speakers": ["Matthew Brensilver"]
}
```

The generated podcast enclosure may include the access key when Jeff explicitly
approves it. This is currently approved for the Matthew Brensilver private
retreat source because podcast clients need direct authenticated MP3 URLs.

## QMD Usage

Always use the dedicated Dharma index. Never use the default QMD index for this
corpus.

```sh
qmd --index dharma search "dukkha" -c brensilver --line-numbers
qmd --index dharma query "teachings on grief and compassion" -c brensilver
qmd --index dharma update
qmd --index dharma embed
```

For a new teacher, use the same `dharma` index but a separate collection name,
for example `goldstein`, `boorstein`, or another stable teacher slug.

## Adding A New Dharma Teacher

The Brensilver code is still partially teacher-specific: output paths, site URL,
QMD collection, generated teacher image, and some source config all assume
Matthew Brensilver. For another teacher, do not dump their talks into the
`brensilver` collection or feeds.

Use this plan:

1. Choose a teacher slug, e.g. `goldstein`.
2. Create a new public route/feed root, e.g. `brensilver/` becomes
   `dharma/{teacher_slug}/` or another agreed URL.
3. Create a separate local corpus root:
   `.local-corpus/{teacher_slug}/`.
4. Use the shared QMD index `dharma`, but create a separate collection:

   ```sh
   qmd --index dharma collection add \
     /path/to/.local-corpus/{teacher_slug}/transcripts/markdown \
     --name {teacher_slug}
   ```

5. Copy or refactor the feed config so `site.title`, `site.feed_url`,
   `site.image_url`, source IDs, and teacher names are teacher-specific.
6. Generate a teacher-level podcast image and per-episode artwork for that
   teacher.
7. Run the same ingestion sequence:

   ```sh
   python3 scripts/build-...-feed.py --copy-artwork
   PYTHONPATH=tools/.../src python3 -m ... run-corpus \
     --limit 20 \
     --feed-every 20 \
     --media-base-url https://jeffharr.is/{teacher_path}/ \
     --copy-artwork \
     --update-qmd \
     --build-feedback-viewer
   ```

8. Add an agent note for the new teacher explaining their source feeds, private
   keys, QMD collection name, and public feed URLs.

If this project grows beyond two teachers, refactor the tooling around a
teacher config file instead of cloning Brensilver-specific constants.
