# Brensilver Transcript Pipeline

Local transcription, correction, reference extraction, viewer generation, and
QMD indexing for Matthew Brensilver talks.

This tool is intentionally local-first. It writes generated audio, raw transcript
JSON, corrected transcript JSON, reference JSON, markdown, viewer files, and
review files under:

```txt
site/.local-corpus/brensilver/
```

That directory is gitignored so full transcripts are not accidentally deployed or
committed. The checked-in files here are the repeatable pipeline, prompts,
sample selection, and agent documentation.

## Requirements

- `ffmpeg` and `ffprobe` on `PATH`
- `qmd` on `PATH` for indexing
- `OPENAI_API_KEY` in the environment for transcription, correction, and
  reference extraction

No Python package dependencies are required.

You can also put the key in a gitignored file at `site/.env.local`:

```txt
OPENAI_API_KEY=sk-...
```

## Pilot

Run from `site/`:

```sh
PYTHONPATH=tools/brensilver-transcripts/src \
  python3 -m brensilver_transcripts.pipeline pilot
```

The pilot processes the five talks listed in `config/pilot-talks.json`.

To validate download and chunking without spending API calls:

```sh
PYTHONPATH=tools/brensilver-transcripts/src \
  python3 -m brensilver_transcripts.pipeline pilot --prepare-only
```

To process a specific talk:

```sh
PYTHONPATH=tools/brensilver-transcripts/src \
  python3 -m brensilver_transcripts.pipeline sync --talk-id audiodharma:25235
```

To process new talks on an ongoing schedule:

```sh
PYTHONPATH=tools/brensilver-transcripts/src \
  python3 -m brensilver_transcripts.pipeline sync --limit 3 --update-qmd
```

The `sync` command skips completed talks unless `--force` is passed.

## 20-Talk Batch

The first broader validation batch is listed in `config/twenty-talks.json`.

```sh
PYTHONPATH=tools/brensilver-transcripts/src \
  python3 -m brensilver_transcripts.pipeline batch \
  --config tools/brensilver-transcripts/config/twenty-talks.json \
  --update-qmd
```

The batch command runs each step in order:

1. download source audio
2. chunk audio below API size limits
3. transcribe with `whisper-1` and segment timestamps
4. correct transcript accuracy with GPT-5.4 mini
5. extract external reference moments with a separate GPT-5.4 mini pass
6. generate episode descriptions, chapters, and image prompts with GPT-5.4 mini
7. generate square episode artwork with `gpt-image-2`
8. write markdown for QMD
9. rebuild the public feed when requested by `run-corpus`

The correction and reference passes are intentionally separate. Correction
should only fix ASR errors and uncertain Dharma terms. Reference extraction is
more interpretive and can safely be rerun or tuned without rewriting the
transcript. References are modeled as jumpable teaching moments, not exact
quote spans: each one tries to identify the person, work, selected material,
and qualitative role the reference plays in the talk.

After correction, the pipeline also applies a conservative local cleanup pass
for Whisper silence hallucinations. It uses ffmpeg silence detection plus exact
phrase repetition to remove rows such as repeated text during long silent sits.
Suppressed rows are kept in `suppressed_segments` inside the corrected JSON for
review, but they are not written into markdown, QMD, or the viewer.

To rerun only transcript correction from existing raw segments:

```sh
PYTHONPATH=tools/brensilver-transcripts/src \
  python3 -m brensilver_transcripts.pipeline correct \
  --batch \
  --config tools/brensilver-transcripts/config/twenty-talks.json \
  --update-qmd
```

To rerun only reference extraction from existing corrected transcripts:

```sh
PYTHONPATH=tools/brensilver-transcripts/src \
  python3 -m brensilver_transcripts.pipeline extract-references \
  --batch \
  --config tools/brensilver-transcripts/config/twenty-talks.json \
  --update-qmd
```

To generate podcast metadata, chapters, and image prompts from corrected
transcripts plus references:

```sh
PYTHONPATH=tools/brensilver-transcripts/src \
  python3 -m brensilver_transcripts.pipeline metadata \
  --batch \
  --config tools/brensilver-transcripts/config/twenty-talks.json \
  --build-feedback-viewer
```

To generate episode artwork after metadata exists:

```sh
PYTHONPATH=tools/brensilver-transcripts/src \
  python3 -m brensilver_transcripts.pipeline generate-artwork \
  --batch \
  --config tools/brensilver-transcripts/config/twenty-talks.json \
  --image-model gpt-image-2 \
  --image-quality low \
  --build-feedback-viewer
```

## Full Corpus Batches

Use `run-corpus` for production-style incremental processing. It selects talks
that do not yet have corrected transcripts, references, episode metadata,
markdown, and artwork, then rebuilds the public feed every `--feed-every` talks.

```sh
PYTHONPATH=tools/brensilver-transcripts/src \
  python3 -m brensilver_transcripts.pipeline run-corpus \
  --limit 20 \
  --feed-every 20 \
  --media-base-url https://jeffharr.is/dharma/brensilver/ \
  --copy-artwork \
  --update-qmd \
  --build-feedback-viewer
```

The same-site `--media-base-url` plus `--copy-artwork` path is the simple
preview/deploy mode: generated artwork is copied into `dharma/brensilver/artwork/`,
chapter JSON is written into `dharma/brensilver/chapters/`, and the RSS feed points at
`https://jeffharr.is/dharma/brensilver/`.

Once Cloudflare R2 media hosting is wired, use the R2 origin instead and omit
`--copy-artwork`:

```sh
PYTHONPATH=tools/brensilver-transcripts/src \
  python3 -m brensilver_transcripts.pipeline run-corpus \
  --limit 20 \
  --feed-every 20 \
  --media-base-url https://media.jeffharr.is/brensilver/ \
  --update-qmd
```

If a talk fails, `run-corpus` marks that talk `failed` in
`state/pipeline-state.json`, keeps earlier artifacts, and continues by default.
Pass `--stop-on-error` while debugging a specific failure.

To apply only local cleanup to an already corrected talk, without another API
call:

```sh
PYTHONPATH=tools/brensilver-transcripts/src \
  python3 -m brensilver_transcripts.pipeline clean \
  --talk-id audiodharma:18176 \
  --update-qmd
```

## Local Viewer

Build the standalone local viewer after transcripts have been corrected:

```sh
PYTHONPATH=tools/brensilver-transcripts/src \
  python3 -m brensilver_transcripts.pipeline build-viewer \
  --config tools/brensilver-transcripts/config/twenty-talks.json
```

The viewer is written to:

```txt
.local-corpus/brensilver/viewer/index.html
```

It embeds the processed transcript/reference data and streams audio directly
from the original online source URLs. Clicking a transcript segment or extracted
reference seeks the audio player to that timestamp.

## Feedback Viewer

Build the review queue for transcript, reference, metadata, and artwork QA:

```sh
PYTHONPATH=tools/brensilver-transcripts/src \
  python3 -m brensilver_transcripts.pipeline build-feedback-viewer \
  --config tools/brensilver-transcripts/config/twenty-talks.json
```

The feedback viewer is written to:

```txt
.local-corpus/brensilver/feedback-viewer/index.html
```

It gathers suppressed transcript spans, uncertain correction terms, all
reference moments, episode descriptions/chapters, and generated artwork.
Each item is tagged with a review priority (`needs_review` or `audit`) so the
queue can focus on the moments most likely to need human judgment. Feedback is
stored in browser localStorage and can be exported as JSON from the page.

## Podcast Metadata Plan

The current metadata/artwork layer and the remaining feed-publication work are
documented in `docs/podcast-metadata-plan.md`. It covers episode descriptions,
podcast chapters, image prompt synthesis, generated artwork, public media
storage, and feed integration.

## QMD Setup

QMD should use a dedicated Dharma index, separate from any personal or work
notes:

```sh
PYTHONPATH=tools/brensilver-transcripts/src \
  python3 -m brensilver_transcripts.pipeline setup-qmd
```

That runs the equivalent of:

```sh
qmd --index dharma collection add site/.local-corpus/brensilver/transcripts/markdown --name brensilver
qmd --index dharma context add qmd://brensilver "Timestamped Matthew Brensilver Dharma talk transcripts."
qmd --index dharma update
qmd --index dharma embed
```

Search examples:

```sh
qmd --index dharma search "dukkha" -c brensilver --line-numbers
qmd --index dharma query "teachings on grief and compassion" -c brensilver
```

## Outputs

Per-talk artifacts:

```txt
.local-corpus/brensilver/
  audio/{talk_id}.mp3
  chunks/{talk_id}/manifest.json
  transcripts/raw/{talk_id}.json
  transcripts/segments/{talk_id}.jsonl
  transcripts/corrected/{talk_id}.json
  references/{talk_id}.json
  episode-metadata/{talk_id}.json
  chapters/{talk_id}.json
  artwork/prompts/{talk_id}.json
  artwork/images/{talk_id}.jpg
  artwork/manifests/{talk_id}.json
  transcripts/markdown/{talk_id}.md
  review/pilot-review.md
  review/reference-report.md
  viewer/index.html
  feedback-viewer/index.html
```

The raw files preserve OpenAI Whisper output. Corrected JSON and markdown are
derived from the transcript correction and reference extraction passes. If a
later step fails for a talk, the earlier artifacts remain intact and the
pipeline can be rerun safely.

## Ongoing Operation

The intended recurring job on the Mac Mini is the repo-root ingestion runner:

```sh
cd <repo-root>
scripts/run-brensilver-ingestion.sh
```

That script first runs `scripts/build-brensilver-feed.py --copy-artwork` to
refresh all configured source feeds into `dharma/brensilver/talks.json`, then runs
`run-corpus` so any pending talks get transcripts, correction, reference
extraction, episode metadata, artwork, markdown, QMD indexing, and rebuilt
feeds. This order matters: `run-corpus` consumes `dharma/brensilver/talks.json`; it
does not discover new upstream source items by itself.

Useful environment variables:

```sh
BRENSILVER_INGEST_LIMIT=20
BRENSILVER_FEED_EVERY=20
BRENSILVER_MEDIA_BASE_URL=https://jeffharr.is/dharma/brensilver/
BRENSILVER_AUTO_PUBLISH=1
```

Use `launchd` or a Codex automation for the actual schedule on macOS. A limit of
20 gives the feed a useful new batch while keeping a transient API or network
issue from turning one run into a large failure surface. Set
`BRENSILVER_AUTO_PUBLISH=1` only for the unattended job that should commit and
push generated `dharma/brensilver/` artifacts after a successful run.

A launchd template lives at `launchd/com.jeffharris.brensilver-transcripts.plist.example`.
Install it only after `.env.local` exists and the pilot has been reviewed.

## Notes For Future Agents

- Start with `docs/dharma-content-agent-runbook.md` when adding a source, using
  QMD, touching automation, or extending this pattern to another teacher.
- Public podcast feed generation still lives in `tools/dharma-feed/`.
- `run-corpus` consumes `dharma/brensilver/talks.json` and calls the feed builder after
  each batch; it does not fetch new source listings by itself.
- If an agent adds a new Dharma Seed or AudioDharma source, they must run
  `scripts/run-brensilver-ingestion.sh` before publishing so new talks are not
  left with only feed entries and no transcript/artwork/index artifacts.
- Full transcripts are local until Jeff explicitly decides what should be
  published.
- QMD isolation depends on always passing `--index dharma`.
- Do not query or mutate the default QMD index for this project.
- `prompts/correct_transcript.md` is only for transcript accuracy.
- `prompts/extract_references.md` is for people, works, stories, poems, quoted
  teachings, and timestamped external references.
- Reference extraction is allowed to produce `needs_review` items. Those should
  remain jumpable and visible, but low-confidence items are excluded from the
  people/work indexes.
- `clean` is the API-free repair command for local transcript artifacts. Use it
  when Whisper hallucinated text into silence or produced obvious boilerplate
  during a quiet stretch.
