# push-delivery worker

Queue consumer for app push delivery work:
- APNs send attempts
- APNs token pruning on terminal failures

## Important boundary
- This worker is separate from Cloudflare Pages Functions.
- Deploying Pages does not update this worker.

## Deploy
```sh
cd workers/push-delivery
npx wrangler deploy
```

## Debug
```sh
cd workers/push-delivery
npx wrangler tail --format json
npx wrangler queues info push-delivery
npx wrangler queues resume-delivery push-delivery
```

## Required bindings and secrets
- Defined in `workers/push-delivery/wrangler.toml`: `READ_LATER`.
- Queue consumer: `push-delivery`.
- Secrets/vars managed on this worker:
  - `APNS_TEAM_ID`
  - `APNS_KEY_ID`
  - `APNS_PRIVATE_KEY_P8`
  - `APNS_TOPIC`
  - `PUSH_DEFAULT_OWNER_ID`
