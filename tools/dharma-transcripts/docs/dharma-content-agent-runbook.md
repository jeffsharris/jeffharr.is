# Dharma Content Agent Runbook

This project has two related but distinct layers:

1. Public podcast/static-site feed generation in `tools/dharma-feed/`.
2. Local transcript, reference, artwork, and QMD indexing in
   `tools/dharma-transcripts/`.

Do not treat a new source as complete after it appears in `feed.xml`. New talks
must also pass through local ingestion so they get corrected transcripts,
external-reference extraction, episode descriptions, chapter JSON, artwork,
markdown, and QMD embeddings.

## Current Brensilver Architecture

- Source config: `tools/dharma-feed/config/brensilver.json`
- Feed builder: `scripts/build-dharma-feed.py brensilver`
- Local ingestion runner: `scripts/run-dharma-ingestion.sh brensilver`
- Generated public artifacts: `dharma/brensilver/`
- Local private corpus: `.local-corpus/brensilver/`
- QMD index: `dharma`
- QMD collection: `brensilver`
- Main Dharma-talk feed: `dharma/brensilver/feed.xml`
- Guided/practice feed: `dharma/brensilver/guided-feed.xml`

The feed builder discovers talks and writes static feed/site artifacts. The
local ingestion runner refreshes source feeds first, then runs `run-corpus`,
which consumes `dharma/brensilver/talks.json` and processes any talk missing local
enrichment artifacts.

## Normal Ongoing Operation

The Mac Mini should run this every two hours:

```sh
cd <repo-root>
scripts/run-dharma-ingestion.sh brensilver
```

The installed launchd job should use:

- label: `com.jeffharris.dharma-ingestion`
- interval: `7200` seconds
- script: `<repo-root>/scripts/run-dharma-ingestion-keychain.sh`

The launchd job must be able to run without interactive 1Password access. Seed
the user's login keychain with generic-password items using service
`com.jeffharris.dharma-ingestion` and accounts:

```txt
OPENAI_API_KEY
DHARMASEED_RETREAT_6753_ACCESS_KEY
DHARMASEED_RETREAT_6810_CODE
```

The keychain wrapper reads those values, exports them only for the ingestion
process, then runs `scripts/run-dharma-ingestion.sh brensilver`.

For unattended publishing, the environment sets:

```sh
BRENSILVER_AUTO_PUBLISH=1
BRENSILVER_INGEST_LIMIT=20
BRENSILVER_FEED_EVERY=20
BRENSILVER_MEDIA_BASE_URL=https://jeffharr.is/dharma/brensilver/
BRENSILVER_ARTWORK_BASE_URL=https://jeffharr.is/dharma/brensilver/
BRENSILVER_CHAPTERS_BASE_URL=https://jeffharr.is/dharma/brensilver/
```

`BRENSILVER_MEDIA_BASE_URL` is retained for existing jobs. Prefer explicit
artwork/chapter bases for new automation; keep both same-site for preview mode,
or move only artwork to media/R2 once that upload path exists.

The runner refuses to auto-publish when staged changes already exist. Unrelated
unstaged local edits should not block ingestion; the runner stages and commits
only generated `dharma/<corpus>/` artifacts.

Cloudflare Pages deploys the site from GitHub pushes to `main`. Normal
Brensilver publishing should therefore commit generated `dharma/brensilver/` artifacts
and push, not run an ad hoc Pages deployment. Before any push that should
publish the site, fetch the remote and fast-forward or rebase onto
`origin/main`; if that cannot be done cleanly, stop and resolve the branch state
first. The unattended runner pulls before ingestion starts and rebases its
generated commit onto the latest remote immediately before pushing, which avoids
publishing stale local files if another project changes the site during a long
ingestion run.

The GitHub Actions Brensilver workflow is a read-only monitor/validator, not a
publisher. It rebuilds from checked-in `dharma/brensilver/talks.json`, verifies
generated artifacts are deterministic and enriched, and alerts if the latest
public upstream source remains absent after the grace window. New talk discovery,
local transcript/artwork ingestion, generated artifact commits, and pushes all
belong to the Mac Mini runner.

## Adding More Matthew Brensilver Sources

1. Add the source to `tools/dharma-feed/config/brensilver.json`.
2. Add or update parser tests in `tools/dharma-feed/tests/test_sources.py`.
3. Run:

   ```sh
   PYTHONPATH=tools/dharma-feed/src python3 -m unittest tools/dharma-feed/tests/test_sources.py
   scripts/run-dharma-ingestion.sh brensilver
   ```

4. Verify:

   ```sh
   python3 - <<'PY'
   import json
   from pathlib import Path
   talks = json.loads(Path("dharma/brensilver/talks.json").read_text())
   print(len(talks), talks[0]["id"], talks[0]["title"])
   PY
   ```

5. Check that new talk IDs have:

   ```txt
   dharma/brensilver/talks/{safe_id}/index.html
   dharma/brensilver/chapters/{safe_id}.json
   dharma/brensilver/artwork/{safe_id}.jpg
   .local-corpus/brensilver/transcripts/corrected/{safe_id}.json
   .local-corpus/brensilver/references/{safe_id}.json
   .local-corpus/brensilver/transcripts/markdown/{safe_id}.md
   ```

6. Fetch the latest remote, rebase or fast-forward onto `origin/main`, then
   commit source changes plus generated public artifacts. Do not commit
   `.local-corpus/` unless Jeff explicitly asks.

## Private Dharma Seed Sources

Private Dharma Seed RSS/player sources should use `access_key_env` in the
corpus feed config. Do not hard-code private keys in the source config.

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

The public feed builder is corpus-configurable, but each corpus still needs its
own output path, site URL, local corpus directory, QMD collection, source config,
and corpus-specific invocation of the generic feed/ingestion scripts. Do not
treat the `brensilver` collection or feeds as generic defaults.

Use this plan:

1. Choose a teacher slug, e.g. `goldstein`.
2. Create a new public route/feed root, usually `dharma/{teacher_slug}/`.
3. Create a separate local corpus root:
   `.local-corpus/{teacher_slug}/`.
4. Use the shared QMD index `dharma`, but create a separate collection:

   ```sh
   qmd --index dharma collection add \
     /path/to/.local-corpus/{teacher_slug}/transcripts/markdown \
     --name {teacher_slug}
   ```

5. Add a feed config under `tools/dharma-feed/config/` so `site.title`,
   `site.feed_url`, `site.image_url`, source IDs, and teacher names are
   teacher-specific.
6. Add the corpus to `scripts/build-dharma-feed.py` so it maps to the new feed
   config.
7. Generate a teacher-level podcast image and per-episode artwork for that
   teacher.
8. Run the same ingestion sequence:

   ```sh
   python3 scripts/build-...-feed.py --copy-artwork
   PYTHONPATH=tools/.../src python3 -m ... run-corpus \
     --limit 20 \
     --feed-every 20 \
     --artwork-base-url https://jeffharr.is/dharma/{teacher_slug}/ \
     --chapters-base-url https://jeffharr.is/dharma/{teacher_slug}/ \
     --copy-artwork \
     --update-qmd \
     --build-feedback-viewer
   ```

9. Add an agent note for the new teacher explaining their source feeds, private
   keys, QMD collection name, and public feed URLs.

## Rob Burbea Corpus

- Source config: `tools/dharma-feed/config/burbea.json`
- Feed builder: `scripts/build-dharma-feed.py burbea`
- Local ingestion runner: `scripts/run-dharma-ingestion.sh burbea`
- Generated public artifacts: `dharma/burbea/`
- Local private corpus: `.local-corpus/burbea/`
- QMD collection: `burbea`
- Main Dharma-talk feed: `dharma/burbea/feed.xml`
- Guided/practice feed: `dharma/burbea/guided-feed.xml`

Rob Burbea uses the Dharma Seed teacher archive feed only:

```txt
https://www.dharmaseed.org/feeds/teacher_all/210/
```

The guided/practice split intentionally uses the same title heuristics as the
Brensilver feed. Episode artwork and teacher cover art should follow the
Imaginal Night Garden direction: deep indigo, black-green, pearl, muted gold,
dreamlike botanical/celestial forms, soft print texture, and subtle luminous
symbols.
