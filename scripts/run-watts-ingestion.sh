#!/bin/zsh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

mkdir -p .local-corpus/watts/logs

timestamp() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

if [[ -f "$HOME/.zshrc" ]]; then
  set +u
  source "$HOME/.zshrc"
  set -u
fi

if [[ -f ".env.local" ]]; then
  set -a
  source ".env.local"
  set +a
fi

: "${WATTS_INGEST_LIMIT:=50}"
: "${WATTS_FEED_EVERY:=10}"
: "${WATTS_MEDIA_BASE_URL:=https://jeffharr.is/watts/}"
: "${WATTS_AUTO_PUBLISH:=0}"

if [[ "$WATTS_AUTO_PUBLISH" == "1" ]]; then
  if [[ -n "$(git status --porcelain)" ]]; then
    echo "Working tree is not clean; refusing unattended auto-publish." >&2
    git status --short >&2
    exit 1
  fi

  branch="$(git branch --show-current)"
  if [[ -z "$branch" ]]; then
    echo "Cannot auto-publish from a detached HEAD." >&2
    exit 1
  fi
  git pull --ff-only origin "$branch"
fi

echo "[$(timestamp)] Refreshing Watts source feeds"
python3 scripts/build-watts-feed.py --copy-artwork

echo "[$(timestamp)] Running local Watts transcript/artwork ingestion"
PYTHONPATH=tools/brensilver-transcripts/src \
  python3 -m brensilver_transcripts.pipeline \
  --corpus-config tools/brensilver-transcripts/config/watts-corpus.json \
  run-corpus \
  --limit "$WATTS_INGEST_LIMIT" \
  --feed-every "$WATTS_FEED_EVERY" \
  --media-base-url "$WATTS_MEDIA_BASE_URL" \
  --copy-artwork \
  --update-qmd \
  --build-feedback-viewer

if [[ "$WATTS_AUTO_PUBLISH" == "1" ]]; then
  echo "[$(timestamp)] Publishing generated Watts artifacts"
  git add watts
  if git diff --cached --quiet -- watts; then
    echo "No Watts generated artifact changes to publish."
  else
    git commit -m "Update Watts generated feed artifacts"
    git push origin "$branch"
  fi
fi

echo "[$(timestamp)] Watts ingestion complete"
