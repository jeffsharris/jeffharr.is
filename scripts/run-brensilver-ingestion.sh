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
  else
    git commit -m "Update Brensilver generated feed artifacts"
    git push origin "$(git branch --show-current)"
  fi
fi

echo "[$(date -Is)] Brensilver ingestion complete"
