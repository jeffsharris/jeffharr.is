# Observability and Wrangler Debugging

This repo uses structured JSON logs from Cloudflare Pages Functions. Every log line is a single JSON object with consistent fields so an agent can filter by source/event/stage and quickly isolate failures.

## Log format
Each event is a JSON object logged via `console.*` with these common keys:

- `timestamp`: ISO-8601
- `level`: `info` | `warn` | `error`
- `event`: short event name (see catalog below)
- `source`: logical service name (per function)
- `stage`: workflow phase (ex: `save`, `reader_fetch`, `cover_generation`)
- `requestId`: Cloudflare `cf-ray` when available (fallback generated id)
- `url`, `title`, `itemId`, `status`, `error`: present when relevant

## Wrangler tail (direct)
Use Wrangler to stream logs from production or preview:

```sh
npx wrangler pages deployment tail --project-name jeffharr-is --environment production --format json
```

Preview (if needed):

```sh
npx wrangler pages deployment tail --project-name jeffharr-is --environment preview --format json
```

Notes:
- `--format json` is required for structured parsing.
- All structured events are JSON strings inside log messages, so filtering is easiest with the script below.

## CLI helper (recommended)
Use `scripts/tail-logs.js` to parse Wrangler output and filter by event/source/level.

Examples:

```sh
node scripts/tail-logs.js --source read-later --level error --pretty
node scripts/tail-logs.js --event cover_generation_failed --pretty
node scripts/tail-logs.js --source letterboxd --level error
node scripts/tail-logs.js --request-id <cf-ray> --pretty
```

Sampling (if you need it):

```sh
node scripts/tail-logs.js --source read-later --sample 0.1 --pretty
```

If you need raw Wrangler output:

```sh
node scripts/tail-logs.js --raw
```

## Event catalog
### read-later (save/list/update/delete)
- `storage_unavailable` (init)
- `list_failed`
- `save_invalid_url` / `save_stream_invalid_url`
- `save_duplicate` / `save_stream_duplicate`
- `save_persisted` / `save_stream_persisted`
- `save_sync_complete` / `save_stream_sync_complete`
- `save_sync_failed` / `save_stream_sync_failed`
- `save_failed` / `save_stream_failed`
- `stream_write_failed`
- `update_invalid_payload`
- `update_item_missing`
- `update_failed`
- `delete_invalid_payload`
- `delete_item_missing`
- `delete_failed`

### read-later-reader (reader extraction)
- `storage_unavailable`
- `reader_missing_id`
- `reader_item_missing`
- `reader_fetch_failed`
- `browser_render_failed`
- `reader_parse_failed`
- `reader_unavailable`
- `reader_request_failed`

### read-later-kindle-sync (manual sync)
- `storage_unavailable`
- `method_not_allowed`
- `invalid_payload`
- `item_not_found`
- `kindle_sync_complete`
- `kindle_sync_failed`

### read-later-cover (regenerate cover)
- `storage_unavailable`
- `method_not_allowed`
- `invalid_payload`
- `item_not_found`
- `cover_exists`
- `reader_unavailable`
- `cover_generation_failed`
- `cover_generation_succeeded`
- `cover_regeneration_failed`

### read-later-progress (reader progress)
- `storage_unavailable`
- `method_not_allowed`
- `invalid_payload`
- `item_not_found`
- `progress_save_failed`

### read-later-restore (undo)
- `storage_unavailable`
- `method_not_allowed`
- `invalid_payload`
- `restore_succeeded`
- `restore_failed`

### kindle (send pipeline; emitted via read-later sources)
- `kindle_missing_url`
- `kindle_unsupported_youtube`
- `reader_fetch_failed`
- `reader_unavailable`
- `cover_api_key_missing`
- `cover_snippet_missing`
- `cover_response_failed`
- `cover_stream_missing`
- `cover_result_missing`
- `cover_missing_result`
- `cover_save_failed`
- `epub_build_failed`
- `kindle_send_config_missing`
- `kindle_send_response_failed`
- `kindle_send_succeeded`
- `kindle_send_failed`

### github
- `github_repos_failed`
- `github_commits_failed`
- `github_commits_error`
- `github_request_failed`

### letterboxd
- `letterboxd_recent_failed`
- `letterboxd_recent_error`
- `letterboxd_watchlist_failed`
- `letterboxd_watchlist_error`
- `letterboxd_request_failed`

### substack
- `substack_feed_failed`
- `substack_request_failed`

### goodreads
- `goodreads_shelf_failed`
- `goodreads_shelf_error`

## Common debug flows
- Kindle send errors:
  - Filter by `--event kindle_send_failed` or `--event kindle_send_response_failed`.
  - Look at `status` and `error` to see Resend response or timeout.

- Cover generation failures:
  - Filter by `--event cover_response_failed` for OpenAI errors.
  - `cover_api_key_missing` means no API key in environment.
  - `cover_snippet_missing` means extraction found too little text.

- Reader failures:
  - `reader_fetch_failed` indicates upstream fetch issues.
  - `browser_render_failed` indicates Puppeteer render issues.
  - `reader_parse_failed` indicates Readability/word count problems.

## Correlating a specific request
- Grab `cf-ray` from the response headers on the client.
- Then filter by `--request-id <cf-ray>` using the CLI helper.
