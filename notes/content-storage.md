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
- Read Later D1/R2 repository: `functions/api/read-later/repository.js`
- Shared item storage: `functions/api/content-library/share-store.js`
- Push device storage: `functions/api/push/device-store.js`

## Runtime Surfaces

- Pages Functions (`functions/api/*`) serve API routes and use `wrangler.toml`.
- `workers/read-later-sync/` consumes `read-later-sync` for Kindle sync and cover generation. It needs `CONTENT_DB`, `CONTENT_ASSETS`, `READ_LATER_SYNC_QUEUE`, `PUSH_DELIVERY_QUEUE`, and `BROWSER`.
- `workers/push-delivery/` consumes `push-delivery` for APNs delivery. It needs `CONTENT_DB` and APNs secrets.

Pages deploys do not deploy either worker. When changing queue behavior, deploy the affected worker explicitly.

## Current Content Shapes

- Read Later article/video saves create or reuse an `items` row, add/update a `list_entries` row in `lst_read_later`, store state in `read_state`, and store extracted reader/cover assets in R2 via `assets`.
- Shared items create or reuse an `items` row, upsert one `share_details` row by share slug, and append `share_events`.
- Shared Dharma talks resolve from static Dharma corpus JSON through `functions/api/content-library/resolve.js`, then store a canonical `items` row plus `dharma_talk_details` and relevant assets.
- iOS push device tokens live in D1 `push_devices`; push delivery updates Read Later push status through `read_state.push_channels_json`.
