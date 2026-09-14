# Content Storage

This repo uses one content storage path:

- D1 binding `CONTENT_DB` stores content metadata, list membership, read state, share pages, Dharma talk details, and push device registrations.
- R2 binding `CONTENT_ASSETS` stores larger generated or extracted blobs, such as reader HTML JSON and generated Read Later cover images.
- There is no Read Later or Share KV fallback. If old KV migration code is needed, use git history.

## Main Tables

- `items`: canonical content records across types. Current kinds include `article`, `video`, `x_post`, podcast share kinds, and `dharma_talk`.
- `assets`: item-linked media or documents. Assets may point at an external `url` or an R2 `r2_key`.
- `lists`: named item collections. System rows currently include `read-later` and `starred`.
- `list_entries`: item membership in a list. Read Later entries use list id `lst_read_later`; status `active` means queued/unread and `done` means archived/read.
- `read_state`: Read Later state attached to a `list_entries.id`, including progress, Kindle sync, cover sync, and push channel JSON.
- `article_details`: reader metadata for extracted articles, including word count and reader asset link.
- `share_details` and `share_events`: public share pages and their history events.
- `dharma_talk_details`: structured Dharma talk metadata for talks saved through the content resolver.
- `item_sources`: provenance for imported/resolved items.
- `push_devices`: APNs device registrations for the app push platform.

Current schema lives in `migrations/`. Apply all migrations; `0004_drop_migration_audit.sql` removes the one-time migration audit table from the active schema.

## Code Paths

- Shared D1 helpers: `functions/api/content-library/db.js`
- Stable ids and URL keys: `functions/api/content-library/ids.js`
- Generic item resolution, including Dharma talks: `functions/api/content-library/resolve.js`
- Read Later list/state: `functions/api/content-library/read-later-store.js`
- Read Later reader/cover R2 assets: `functions/api/read-later/asset-store.js`
- Read Later async storage assembly: `functions/api/read-later/stores.js`
- Shared item storage: `functions/api/content-library/share-store.js`
- Push device storage: `functions/api/push/device-store.js`

## Runtime Surfaces

### Read And Watch Queues

Read and Watch are filters over the same `lst_read_later` entries. Archive still combines both. The website uses `?feed=watch` and `?feed=read` for Watch and Archive; an omitted feed selects Read.

The Read Later API adds nullable `video` metadata and derives `kind: video` for known video links without changing read/archive semantics. `items.extra_json.video` stores an optional playable URL, content type, and provider; `videoCheckedAt` caches X metadata checks, including text-only negative results. X enrichment uses the existing Pages `X_API_BEARER_TOKEN` and runs in `waitUntil` on list reads so provider latency does not delay the queue. No schema migration is needed. Previously saved X videos may move to Watch on the next list refresh after enrichment.

`GET /api/read-later/video?id=<entry-id>` resolves a saved item's native stream and refreshes older X media metadata. Missing credentials, unavailable streams, or provider restrictions preserve the source link as a fallback. YouTube URLs are not downloadable media URLs and must not be sent to the default Cast receiver. The iOS app uses provider playback/handoff for YouTube and native AirPlay/Chromecast for accessible MP4/HLS streams. The website uses HTML video controls where native streams exist.

This feature deploys through Pages only; no queue-consumer behavior or schema was changed. Run `npm test`, then check Read/Watch/Archive, deep-link restoration, and video teardown at desktop and mobile widths before publishing.

- Pages Functions (`functions/api/*`) serve API routes and use `wrangler.toml`.
- `workers/read-later-sync/` consumes `read-later-sync` for Kindle sync and cover generation. It needs `CONTENT_DB`, `CONTENT_ASSETS`, `READ_LATER_SYNC_QUEUE`, `PUSH_DELIVERY_QUEUE`, and `BROWSER`.
- `workers/push-delivery/` consumes `push-delivery` for APNs delivery. It needs `CONTENT_DB` and APNs secrets.

Pages deploys do not deploy either worker. When changing queue behavior, deploy the affected worker explicitly.

## Current Content Shapes

- Read Later article/video saves create or reuse an `items` row, add/update a `list_entries` row in `lst_read_later`, store state in `read_state`, and store extracted reader/cover assets in R2 via `assets`.
- Shared items create or reuse an `items` row, upsert one `share_details` row by share slug, and append `share_events`.
- Shared Dharma talks resolve from static Dharma corpus JSON through `functions/api/content-library/resolve.js`, then store a canonical `items` row plus `dharma_talk_details` and relevant assets.
- iOS push device tokens live in D1 `push_devices`; push delivery updates Read Later push status through `read_state.push_channels_json`.
