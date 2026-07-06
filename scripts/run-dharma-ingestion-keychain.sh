#!/bin/zsh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SERVICE="com.jeffharris.dharma-ingestion"

read_secret() {
  local account="$1"
  local value
  if ! value="$(/usr/bin/security find-generic-password -s "$SERVICE" -a "$account" -w 2>/dev/null)"; then
    echo "Missing Keychain secret for $SERVICE account $account" >&2
    echo "Seed it in the user's login keychain before running the ingestion worker." >&2
    return 1
  fi
  if [[ -z "$value" ]]; then
    echo "Keychain secret for $SERVICE account $account is empty" >&2
    return 1
  fi
  print -rn -- "$value"
}

read_optional_secret() {
  local account="$1"
  /usr/bin/security find-generic-password -s "$SERVICE" -a "$account" -w 2>/dev/null || true
}

export OPENAI_API_KEY="$(read_secret OPENAI_API_KEY)"
export DHARMASEED_RETREAT_6753_ACCESS_KEY="$(read_secret DHARMASEED_RETREAT_6753_ACCESS_KEY)"

dharmaseed_retreat_6810_code="$(read_optional_secret DHARMASEED_RETREAT_6810_CODE)"
if [[ -n "$dharmaseed_retreat_6810_code" ]]; then
  export DHARMASEED_RETREAT_6810_CODE="$dharmaseed_retreat_6810_code"
fi

exec "$ROOT/scripts/run-dharma-ingestion.sh" brensilver
