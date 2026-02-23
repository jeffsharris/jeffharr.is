# Push Platform Boundaries

## Purpose
Push delivery is an app-level platform capability. `read-later` is one producer of push events, not the owner of the push channel.

## API Namespace
- Device registration: `POST /api/push/devices`
- Device unregister: `DELETE /api/push/devices`
- Manual test push: `POST /api/push/test`

## Runtime Config
- `PUSH_DEFAULT_OWNER_ID` (default `default`)
- `PUSH_TEST_API_KEY`
- `APNS_TEAM_ID`
- `APNS_KEY_ID`
- `APNS_PRIVATE_KEY_P8`
- `APNS_TOPIC`

## Current Producer Model
- Read Later computes `article-push-ready` on item state (`pushChannels.readiness`).
- When ready, Read Later emits queue payloads with:
  - `type: "push.notification.requested"`
  - `source: "read-later"`
  - `itemId`, `eventId`, and alert metadata.

## Worker Topology (Current)
- Queue routing still runs in `workers/read-later-sync`.
- That worker now dispatches push messages to `functions/api/push/ios-push-service.js`.

This is intentionally a staging point before splitting push delivery into its own worker.
