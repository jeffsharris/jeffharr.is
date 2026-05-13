#!/bin/zsh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

mkdir -p .local-corpus/brensilver/logs

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

: "${BRENSILVER_INGEST_LIMIT:=20}"
: "${BRENSILVER_FEED_EVERY:=20}"
: "${BRENSILVER_MEDIA_BASE_URL:=https://jeffharr.is/brensilver/}"
: "${BRENSILVER_AUTO_PUBLISH:=0}"

if [[ "$BRENSILVER_AUTO_PUBLISH" == "1" ]]; then
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

echo "[$(date -Is)] Refreshing Brensilver source feeds"
python3 scripts/build-brensilver-feed.py --copy-artwork

echo "[$(date -Is)] Running local transcript/artwork ingestion"
PYTHONPATH=tools/brensilver-transcripts/src \
  python3 -m brensilver_transcripts.pipeline run-corpus \
  --limit "$BRENSILVER_INGEST_LIMIT" \
  --feed-every "$BRENSILVER_FEED_EVERY" \
  --media-base-url "$BRENSILVER_MEDIA_BASE_URL" \
  --copy-artwork \
  --update-qmd \
  --build-feedback-viewer

if [[ "$BRENSILVER_AUTO_PUBLISH" == "1" ]]; then
  echo "[$(date -Is)] Publishing generated Brensilver artifacts"
  git add brensilver
  if git diff --cached --quiet -- brensilver; then
    echo "No Brensilver generated artifact changes to publish."
    git pull --ff-only origin "$branch"
  else
    git commit -m "Update Brensilver generated feed artifacts"
    git fetch origin "$branch"
    git rebase "origin/$branch"
    git push origin "$branch"
  fi
fi

echo "[$(date -Is)] Brensilver ingestion complete"
