#!/bin/zsh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

timestamp() {
  date -u +"%Y-%m-%dT%H:%M:%SZ"
}

usage() {
  echo "Usage: $0 <brensilver|burbea|watts>" >&2
}

corpus="${1:-}"
if [[ -z "$corpus" ]]; then
  usage
  exit 2
fi
shift

if [[ $# -gt 0 ]]; then
  echo "Unexpected arguments: $*" >&2
  usage
  exit 2
fi

case "$corpus" in
  brensilver)
    label="Brensilver"
    env_prefix="BRENSILVER"
    corpus_config="tools/dharma-transcripts/config/brensilver-corpus.json"
    default_limit="20"
    default_feed_every="20"
    default_media_base_url="https://jeffharr.is/dharma/brensilver/"
    ;;
  burbea)
    label="Burbea"
    env_prefix="BURBEA"
    corpus_config="tools/dharma-transcripts/config/burbea-corpus.json"
    default_limit="1000"
    default_feed_every="20"
    default_media_base_url="https://jeffharr.is/dharma/burbea/"
    ;;
  watts)
    label="Watts"
    env_prefix="WATTS"
    corpus_config="tools/dharma-transcripts/config/watts-corpus.json"
    default_limit="50"
    default_feed_every="10"
    default_media_base_url="https://jeffharr.is/dharma/watts/"
    ;;
  *)
    echo "Unknown Dharma corpus: $corpus" >&2
    usage
    exit 2
    ;;
esac

build_script="scripts/build-dharma-feed.py"

mkdir -p ".local-corpus/$corpus/logs"

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

limit_name="${env_prefix}_INGEST_LIMIT"
feed_every_name="${env_prefix}_FEED_EVERY"
media_base_name="${env_prefix}_MEDIA_BASE_URL"
artwork_base_name="${env_prefix}_ARTWORK_BASE_URL"
chapters_base_name="${env_prefix}_CHAPTERS_BASE_URL"
auto_publish_name="${env_prefix}_AUTO_PUBLISH"

limit="${(P)limit_name:-$default_limit}"
feed_every="${(P)feed_every_name:-$default_feed_every}"
media_base_url="${(P)media_base_name:-$default_media_base_url}"
artwork_base_url="${(P)artwork_base_name:-$media_base_url}"
chapters_base_url="${(P)chapters_base_name:-$media_base_url}"
auto_publish="${(P)auto_publish_name:-0}"

if [[ "$auto_publish" == "1" ]]; then
  if ! git diff --cached --quiet; then
    echo "Staged changes are present; refusing unattended auto-publish." >&2
    git status --short >&2
    exit 1
  fi

  branch="$(git branch --show-current)"
  if [[ -z "$branch" ]]; then
    echo "Cannot auto-publish from a detached HEAD." >&2
    exit 1
  fi
  git pull --ff-only --autostash origin "$branch"
fi

echo "[$(timestamp)] Refreshing $label source feeds"
python3 "$build_script" "$corpus" \
  --artwork-base-url "$artwork_base_url" \
  --chapters-base-url "$chapters_base_url" \
  --copy-artwork

echo "[$(timestamp)] Running local $label transcript/artwork ingestion"
PYTHONPATH=tools/dharma-transcripts/src \
  python3 -m dharma_transcripts.pipeline \
  --corpus-config "$corpus_config" \
  run-corpus \
  --limit "$limit" \
  --feed-every "$feed_every" \
  --media-base-url "$media_base_url" \
  --artwork-base-url "$artwork_base_url" \
  --chapters-base-url "$chapters_base_url" \
  --copy-artwork \
  --update-qmd \
  --build-feedback-viewer

if [[ "$auto_publish" == "1" ]]; then
  echo "[$(timestamp)] Publishing generated $label artifacts"
  git add "dharma/$corpus"
  if git diff --cached --quiet -- "dharma/$corpus"; then
    echo "No $label generated artifact changes to publish."
    git pull --ff-only --autostash origin "$branch"
  else
    git commit -m "Update $label generated feed artifacts"
    git fetch origin "$branch"
    git rebase --autostash "origin/$branch"
    git push origin "$branch"
  fi
fi

echo "[$(timestamp)] $label ingestion complete"
