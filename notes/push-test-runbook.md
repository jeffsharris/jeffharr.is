# Push Test Runbook

Use this runbook when you need to send a manual iOS push notification and verify delivery quickly.

## Runtime boundaries
- `POST /api/push/test` runs on Pages Functions (`jeffharr-is`) and only enqueues a test message.
- APNs delivery runs only in `workers/push-delivery`.
- Do not debug APNs delivery from Pages logs; use `push-delivery` worker logs.

## Required configuration
- Pages project `jeffharr-is`:
  - `PUSH_TEST_API_KEY`
  - `PUSH_DEFAULT_OWNER_ID` (usually `default`)
  - Queue producer binding: `PUSH_DELIVERY_QUEUE -> push-delivery`
- Worker `push-delivery`:
  - `PUSH_DEFAULT_OWNER_ID` (usually `default`)
  - `APNS_TEAM_ID`
  - `APNS_KEY_ID`
  - `APNS_PRIVATE_KEY_P8`
  - `APNS_TOPIC`
  - KV binding `READ_LATER`

## Quick test flow
1. Find a target item id:
```sh
curl -sS https://jeffharr.is/api/read-later \
  | jq -r '.items[] | select(.read == false) | "\(.id)\t\(.title)\t\(.url)"' \
  | head -20
```

2. Start push worker log tail:
```sh
cd /Users/jeffharris/code/jeffharr.is/workers/push-delivery
npx wrangler tail --format json --search ios_test_push
```

3. Send the test push:
```sh
cd /Users/jeffharris/code/jeffharr.is
export PUSH_TEST_API_KEY='<value from Cloudflare Pages>'
node scripts/send-test-push.js \
  --item-id <ITEM_ID> \
  --title "Saved to Read Later" \
  --subtitle "example.com" \
  --body "Manual test push"
```

4. Confirm logs show one of:
- Success: `ios_test_push_sent`
- Non-delivery: `ios_test_push_not_delivered`

## Optional: target one device
- Include `--device-id <DEVICE_ID>` in `send-test-push.js`.
- Device ids are from iOS registration payloads stored in KV keys:
  - `push_device:<ownerId>:<deviceId>`

## Event map (expected)
- Pages API:
  - `ios_test_push_queued`
  - `ios_test_push_queue_failed`
- Push worker:
  - `ios_test_push_sent`
  - `ios_test_push_not_delivered`

## Common failures
- `Push queue unavailable` from `/api/push/test`:
  - Missing `PUSH_DELIVERY_QUEUE` producer binding on Pages.
- `Unauthorized` from `/api/push/test`:
  - Wrong or missing `PUSH_TEST_API_KEY`.
- `ios_test_push_not_delivered` with `reason: "no_devices"`:
  - No registered iOS device tokens for the owner id.
- `ios_test_push_not_delivered` with `reason: "auth_failed"`:
  - APNs secrets missing/invalid on `push-delivery` worker.

## Deploy notes after push changes
- Pages API code changed:
```sh
cd /Users/jeffharris/code/jeffharr.is
npx wrangler pages deploy . --project-name jeffharr-is
```
- Push worker code changed:
```sh
cd /Users/jeffharris/code/jeffharr.is/workers/push-delivery
npx wrangler deploy
```
