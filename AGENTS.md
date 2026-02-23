# AGENTS.md

## Working in this repo
- Static site with Cloudflare Pages Functions under `functions/api`.
- Preserve API response shapes; frontend expects the current JSON fields.
- Avoid adding production dependencies without explicit approval.

## Read Later architecture (critical)
- There are two deploy targets for Read Later:
- `Pages Functions` in this repo (`functions/api/*`) for API routes.
- Separate queue consumer Worker at `workers/read-later-sync/` for background Kindle/cover sync.
- Separate queue consumer Worker at `workers/push-delivery/` for APNs push delivery.
- A Pages deploy does **not** deploy `workers/read-later-sync`.
- A Pages deploy does **not** deploy `workers/push-delivery`.
- If background sync behavior changes, deploy both surfaces as needed.

## Queue worker gotchas
- Queue consumer code path: `workers/read-later-sync/index.js`.
- Push queue consumer code path: `workers/push-delivery/index.js`.
- Worker secrets/vars are independent from Pages env vars. Keep both in sync when required (for example `OPENAI_API_KEY`, `X_API_BEARER_TOKEN`, `RESEND_API_KEY`, Kindle emails).
- If items stay `pending`/`retrying`, verify:
- consumer is deployed (`cd workers/read-later-sync && npx wrangler deploy`)
- queue delivery is not paused (`npx wrangler queues resume-delivery read-later-sync`)
- consumer binding exists on queue (`npx wrangler queues info read-later-sync`)
- If iOS pushes fail to deliver, verify:
- consumer is deployed (`cd workers/push-delivery && npx wrangler deploy`)
- queue delivery is not paused (`npx wrangler queues resume-delivery push-delivery`)
- consumer binding exists on queue (`npx wrangler queues info push-delivery`)

## Cloudflare Pages build notes
- When adding dependencies used by Pages Functions, update both `package.json` (root) and `functions/package.json` so Pages can resolve them during the root install (missing entries cause build failures).
- If functions use Node built-ins (ex: puppeteer), keep `wrangler.toml` valid with `pages_build_output_dir = "."` and `compatibility_flags = ["nodejs_compat"]` so Pages applies the config (otherwise deploy fails with `node:*` module errors).

## Tests
- Run `npm test` (uses `node --test tests`).
- Tests are unit-only and should not require network access.

## Manual checks (when UI behavior changes)
- `index.html`: theme toggle persists, system preference is respected when no local override, panel open/close, deep links via `?view=`, and history back/forward close the panel.
- `poems/index.html`: manifest loads, search/filter works, modal open/close, deep links via `?poem=`, and copy/share actions behave gracefully when APIs are unavailable.

## Reliability notes
- Prefer fetch timeouts for external APIs.
- When errors occur, functions should return empty results with cache headers rather than throw.
