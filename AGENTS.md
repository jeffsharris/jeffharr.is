# AGENTS.md

## Working in this repo
- Static site with Cloudflare Pages Functions under `functions/api`.
- Preserve API response shapes; frontend expects the current JSON fields.
- Avoid adding production dependencies without explicit approval.

## Tests
- Run `npm test` (uses `node --test tests`).
- Tests are unit-only and should not require network access.

## Manual checks (when UI behavior changes)
- `index.html`: theme toggle persists, system preference is respected when no local override, panel open/close, deep links via `?view=`, and history back/forward close the panel.
- `poems/index.html`: manifest loads, search/filter works, modal open/close, deep links via `?poem=`, and copy/share actions behave gracefully when APIs are unavailable.

## Reliability notes
- Prefer fetch timeouts for external APIs.
- When errors occur, functions should return empty results with cache headers rather than throw.
