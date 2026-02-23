# Push Platform Boundaries

## Purpose
Push delivery is an app-level platform capability. `read-later` is one producer of push events, not the owner of the push channel.

## API Namespace
- Device registration: `POST /api/push/devices`
- Device unregister: `DELETE /api/push/devices`
- Manual test push: `POST /api/push/test`
- Operator runbook: `notes/push-test-runbook.md`

## Runtime Config
- Pages Functions (`/api/push/*`):
  - `PUSH_DEFAULT_OWNER_ID` (default `default`)
  - `PUSH_TEST_API_KEY`
  - Queue producer binding: `PUSH_DELIVERY_QUEUE`
- Push delivery worker (`workers/push-delivery`):
  - `PUSH_DEFAULT_OWNER_ID` (default `default`)
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
- Queue producer binding for push events: `PUSH_DELIVERY_QUEUE`.
- Push queue consumer worker: `workers/push-delivery`.
- Read Later queue worker (`workers/read-later-sync`) no longer delivers APNs events.
- `POST /api/push/test` enqueues `push.notification.test` messages; APNs delivery always happens in `workers/push-delivery`.
