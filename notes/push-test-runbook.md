# Push Test Runbook

Use this runbook when you need to send a manual iOS push notification and verify delivery quickly.

## Runtime boundaries
- `POST /api/push/test` runs on Pages Functions (`jeffharr-is`) and only enqueues a test message.
- APNs delivery runs only in `workers/push-delivery`.
- Do not debug APNs delivery from Pages logs; use `push-delivery` worker logs.

## Push payload contract (current)
Push messages should use a single, generic contract:

```json
{
  "type": "push.notification.test",
  "source": "read-later",
  "ownerId": "default",
  "itemId": "uuid-or-id",
  "eventId": "event-id",
  "savedAt": "2026-02-23T00:00:00Z",
  "notification": {
    "alert": {
      "title": "Saved to Read Later",
      "subtitle": "example.com",
      "body": "Article title"
    },
    "threadId": "read-later",
    "category": "read-later",
    "targetContentId": "optional",
    "interruptionLevel": "time-sensitive",
    "relevanceScore": 0.9,
    "mutableContent": true,
    "media": [
      {
        "type": "image",
        "url": "https://jeffharr.is/api/read-later/cover?id=<ITEM_ID>&v=<COVER_UPDATED_AT>"
      }
    ]
  },
  "data": {
    "channel": "read-later",
    "itemId": "<ITEM_ID>",
    "url": "https://example.com/article"
  }
}
```

Notes:
- Rich media depends on `notification.media` (no legacy top-level media fields).
- iOS app expects `notification.media` for image attachment in the notification service extension.
- `itemId` remains top-level for open-routing and can also be duplicated in `data`.

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

## Secret access rule (important)
- `PUSH_TEST_API_KEY` is a Cloudflare secret and is write-only.
- Agents can check whether it exists, but cannot read the current value back from Cloudflare.
- If the value is unknown locally, use the direct queue path below or rotate/set a new key in Pages.

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

3. Send the test push with multimedia fields:
```sh
cd /Users/jeffharris/code/jeffharr.is
export PUSH_TEST_API_KEY='<value from Cloudflare Pages>'
node scripts/send-test-push.js \
  --item-id <ITEM_ID> \
  --title "Saved to Read Later" \
  --subtitle "example.com" \
  --body "Manual test push" \
  --cover-url "https://jeffharr.is/api/read-later/cover?id=<ITEM_ID>&v=<COVER_UPDATED_AT>" \
  --thread-id "read-later" \
  --category "read-later" \
  --interruption-level "time-sensitive" \
  --relevance-score 0.9 \
  --mutable-content true \
  --data-json '{"channel":"read-later","itemId":"<ITEM_ID>"}'
```

4. Confirm logs show one of:
- Success: `ios_test_push_sent`
- Non-delivery: `ios_test_push_not_delivered`

## Fallback: send test push without `PUSH_TEST_API_KEY`
Use this when an agent cannot call `/api/push/test` because the key value is unknown.

```sh
export CLOUDFLARE_ACCOUNT_ID='<account id>'
export CLOUDFLARE_API_TOKEN='<api token with queues write>'

QUEUE_ID=$(curl -sS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/queues" \
  | jq -r '.result[] | select(.queue_name=="push-delivery") | .queue_id')

EVENT_ID="test_$(date +%s)"
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

curl -sS -X POST \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/queues/$QUEUE_ID/messages" \
  --data "{\"body\":{\"type\":\"push.notification.test\",\"source\":\"manual-cli\",\"ownerId\":\"default\",\"itemId\":\"<ITEM_ID>\",\"eventId\":\"$EVENT_ID\",\"savedAt\":\"$NOW\",\"notification\":{\"alert\":{\"title\":\"Saved to Read Later\",\"subtitle\":\"example.com\",\"body\":\"Manual test push\"},\"threadId\":\"read-later\",\"category\":\"read-later\",\"interruptionLevel\":\"time-sensitive\",\"relevanceScore\":0.9,\"mutableContent\":true,\"media\":[{\"type\":\"image\",\"url\":\"https://jeffharr.is/api/read-later/cover?id=<ITEM_ID>&v=<COVER_UPDATED_AT>\"}]},\"data\":{\"channel\":\"read-later\",\"itemId\":\"<ITEM_ID>\"}}}"
```

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
  - If key value is unknown, use the direct queue fallback above.
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
