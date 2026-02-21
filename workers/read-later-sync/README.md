# read-later-sync worker

Queue consumer for background Read Later work:
- Kindle sync attempts/retries
- Cover generation attempts/retries

## Important boundary
- This worker is separate from Cloudflare Pages Functions.
- Deploying Pages does not update this worker.

## Deploy
```sh
cd workers/read-later-sync
npx wrangler deploy
```

## Debug
```sh
cd workers/read-later-sync
npx wrangler tail --format json
npx wrangler queues info read-later-sync
npx wrangler queues resume-delivery read-later-sync
```

## Required bindings and secrets
- Defined in `workers/read-later-sync/wrangler.toml`: `READ_LATER`, `READ_LATER_SYNC_QUEUE`, `BROWSER`.
- Secrets/vars are managed on this worker separately from Pages.
