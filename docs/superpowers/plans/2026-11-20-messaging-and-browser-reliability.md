# Messaging and Browser Reliability Implementation Plan

> **For agentic workers:** Use this plan to implement, review, and verify the approved notification-reliability work.

**Goal:** Keep notification threads and scheduled messages safe, show real Android and browser delivery states, and provide useful recovery, backup, and version status in the administration UI.

**Architecture:** Preserve MsgHub's PostgreSQL, Redis, BullMQ, JPush, NestJS, Vue, Docker Compose, and centralized Android updater. Add forward-only database migrations, HMAC-scoped device receipts and expiring single-use pairing, and a separately isolated backup runner. Android callbacks report receipt separately from verified notification display and reading; the inbox uses authenticated SSE plus HTTP recovery.

**Tech Stack:** Prisma/PostgreSQL, NestJS/TypeScript, Vue/TypeScript, BullMQ/Redis, Android/Kotlin/JPush, POSIX shell, age-encrypted PostgreSQL and Redis backups.

**Spec:** Approved scope includes protected active conversations during cleanup, reliable schedule failure recovery and history, authenticated conversation inbox and updates, delivery/read state, device pairing and health, backup and restore validation, incident grouping and recovery, build revision visibility, and real channel health semantics.

## Global Constraints

- All MsgHub project/deploy and backup files stay under `/www/wwwroot/msg`; GitHub uses `main`.
- Production database, Redis data, signing/JWT keys, administrator accounts, JPush channel key and existing UFM share identities remain in place.
- BrowserShell remains signed with the existing certificate, uses the existing fixed unified file platform download and manifest identities, and upgrades version 2.2.2/code 35 to 2.2.3/code 36.
- Provider acceptance, device receipt, display, and user reading are separate states; do not claim a later stage without its own evidence.
- A delivery-receipt HMAC binds each message, RID, and expiration; credentials and receipt capabilities never appear in logs or stored message payloads.
- No business message is sent to a real production phone as a connectivity test. Device delivery claims require an explicitly identified test device.
- A recurring schedule continues only after a definite failed occurrence. Ambiguous external delivery remains `UNCERTAIN` until safely resolved.
- Automated restore validation uses a temporary isolated PostgreSQL and Redis instance. The backup runner receives no Docker socket, API public port, signing key, or host database mount.
- Run tests against PostgreSQL and Redis isolated on localhost ports `56487` and `56488`.

## Files and Ownership

- `apps/api/prisma/schema.prisma`, a timestamped additive migration, and `apps/api/src/devices/` define pairing, device credentials, heartbeats, revocation, delivery-receipt persistence, and receipt controllers.
- `apps/api/src/common/token.util.ts`, `apps/api/src/adapters/jpush-audience.ts`, `apps/api/src/messages/messages.service.ts`, `apps/api/src/queue/send.processor.ts`, and `apps/api/src/channels/` supply signed JPush receipts and distinguish configured checks from actual deliveries.
- `apps/api/src/messages/` and `apps/api/src/realtime/realtime.service.ts` protect ongoing conversations and emit metadata-only conversation events; the conversation owner implements the inbox, replies, pagination and tests.
- `apps/api/src/schedules/`, the additive migration, and `apps/web/src/views/SchedulesView.vue` record every schedule occurrence and safely resume a recurring schedule after a definite delivery failure.
- `apps/api/src/operations/`, `scripts/backup*.sh`, the backup Dockerfile, `docker-compose.yml`, and `apps/web` operations UI add isolated encrypted backup, restore verification and runtime version status.
- `apps/web/src/stores/notify.ts`, `apps/web/src/layouts/AdminLayout.vue`, `apps/web/src/views/DevicePushHistoryView.vue`, `apps/web/src/views/ChannelsView.vue`, and `apps/web/src/router/index.ts` expose arrival, display, unread, device health and conversation recovery.
- `F:\浏览器\BrowserShell\app\src\main\java\com\shifuf\prism\push\`, the settings screen, and `app/build.gradle.kts` provide secure enrollment, renewable device health, reliable delivery reports, permission troubleshooting and the signed release build.
- `tests/device-notification-tokens.test.cjs`, existing conversation/schedule/operations tests, and `tests/device-http.integration.test.cjs` cover tokens, retries, endpoint security and delivery-state transitions.

## Approaches

1. Keep the current single `SUCCESS` status and retry blind pushes. This hides whether the app or OS actually displayed a message and cannot diagnose the user's complaint.
2. Add expiring enrolled-device credentials, message-scoped signed receipt capabilities, deduplicated monotonic receipt state, Android runtime display evidence, and a separate admin device-health view. Chosen: accurately separates independently observable stages, retains single-notification opt-outs, and needs no private keys in the mobile package.
3. Give each installed browser a static server API key and mark every JPush acceptance as displayed. Rejected: exposes reusable credentials in the APK and reports a stage no client observed.

## Task Sequence

1. Write failing signed-token tests; implement time-limited HMAC receipt tokens and safe removal of signing tokens from persisted JPush payloads.
2. Add device and receipt models plus additive migration; implement admin-scoped ten-minute one-use pairing, hashed long-lived device tokens, authenticated heartbeats and rate-limited idempotent receipt reports.
3. Include signed device receipts in synchronous, queued, and failover JPush payloads. Propagate receipt and conversation events through SSE without sending content or tokens.
4. Write failing endpoint tests; enforce app-key-bound enrollment, credential revocation, token expiration, target matching, invalid-permission reporting, and monotonic arrival-to-display state.
5. Render provider acknowledgement, app receipt, OS notification display and user reading in device message history. Add safe single-use code and revocation UI and actionable permission/channel health.
6. Protect active conversation roots and pending or ambiguous delivery records from retention and deletion. Preserve transactional closures and unread status; wire realtime recovery polling and inbox navigation.
7. Persist schedule occurrence history. Test simultaneous claims, definite failures, uncertain outcomes, timezone and recurrence boundaries and manual uncertainty resolution.
8. Isolate the backup runner from the Docker API. Back up encrypted database, Redis, application revision and environment secrets within protected project backup paths; only verify into a private disposable database without production restore credentials.
9. Group actionable incidents, publish resolved/recovered state after a successful service check, expose verified deployment and migration versions, and report actual provider outcomes separately from configuration health checks.
10. Build the Android app at 2.2.3/code 36 using the release signing key and perform emulator/device testing only on the installed named test device. Publish to existing UFM identities after checking artifact SHA-256 and manifest revision.
11. Run `pnpm check`, migration deployment and `AUDIT_COMPILED=true` integration checks against the isolated database/Redis. Review diffs, push the verified commit to GitHub `main`, back up production, deploy strictly under `/www/wwwroot/msg`, and verify health and committed revision online.

## Review Focus

- Invalid, expired, reused, malformed or cross-message device capabilities must be rejected and must never reveal notification content.
- Revoked/stale credentials, changed JPush application IDs, RID rotation and reinstallation must not report notifications against a different app or device.
- Notifications denied in Android settings, on notification channels, or by the app's explicit pause switch must be reported clearly and preserve the user's choice.
- Schedule retries and client duplicate submissions must not deliver the same externally accepted occurrence twice; ambiguous outcomes must preserve an administrator-visible uncertainty state.
- Database or backup verification failures must never delete production data, expose decrypted credentials to the API, or grant a public restore endpoint.
