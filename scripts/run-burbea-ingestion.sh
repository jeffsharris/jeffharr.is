#!/bin/zsh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

mkdir -p .local-corpus/burbea/logs

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

: "${BURBEA_INGEST_LIMIT:=1000}"
: "${BURBEA_FEED_EVERY:=20}"
: "${BURBEA_MEDIA_BASE_URL:=https://jeffharr.is/dharma/burbea/}"
: "${BURBEA_AUTO_PUBLISH:=0}"

if [[ "$BURBEA_AUTO_PUBLISH" == "1" ]]; then
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

echo "[$(timestamp)] Refreshing Burbea source feed"
python3 scripts/build-burbea-feed.py --copy-artwork

echo "[$(timestamp)] Running local Burbea transcript/artwork ingestion"
PYTHONPATH=tools/brensilver-transcripts/src \
  python3 -m brensilver_transcripts.pipeline \
  --corpus-config tools/brensilver-transcripts/config/burbea-corpus.json \
  run-corpus \
  --limit "$BURBEA_INGEST_LIMIT" \
  --feed-every "$BURBEA_FEED_EVERY" \
  --media-base-url "$BURBEA_MEDIA_BASE_URL" \
  --copy-artwork \
  --update-qmd \
  --build-feedback-viewer

if [[ "$BURBEA_AUTO_PUBLISH" == "1" ]]; then
  echo "[$(timestamp)] Publishing generated Burbea artifacts"
  git add dharma/burbea
  if git diff --cached --quiet -- dharma/burbea; then
    echo "No Burbea generated artifact changes to publish."
    git pull --ff-only origin "$branch"
  else
    git commit -m "Update Burbea generated feed artifacts"
    git fetch origin "$branch"
    git rebase "origin/$branch"
    git push origin "$branch"
  fi
fi

echo "[$(timestamp)] Burbea ingestion complete"
