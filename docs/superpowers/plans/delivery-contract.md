# Delivery integration contract

Agent delivery_fix owns task 2. Collaboration messages received by this agent have EMPTY payloads, including root instructions. Using filesystem contract for reliable coordination.

ROOT UPDATE: deliveryStartedAt now added with separate 20261117010000 migration. Root will generate/apply. Please read delivery-followup.md next.

Root schema requests (please add and generate client):
- ScheduledMessage: leaseUntil DateTime?, executionKey String?, attempt Int @default(0).
- MessageLog: deliveryStartedAt DateTime?.
- IdempotencyRecord: existing owner String? accepted; implementing with owner.

UI contracts:
- GET /admin/schedules with page/pageSize returns {items,total,page,pageSize}; no pagination parameters keeps array compatibility.
- PATCH /admin/schedules/:id edits PENDING/PAUSED task fields; POST :id/pause and :id/resume.
- Message cleanup body preview:true returns {matched,deleted:0}.
- Project unreadEmailFallbackMinutes aliases historical Hours (both mean minutes).
- SMTP acceptance does NOT set source readAt. Existing POST /admin/messages/read remains authoritative.

Verification: node --test scripts/delivery-regression.test.cjs now loads real TypeScript through ts-node (avoids shared dist build races). 16/16 passed at 03:27.

Observed schema leaseUntil/executionKey/attempt now present; MessageLog.deliveryStartedAt still needed (code temporarily casts until root schema adds it). No separate ownerToken needed.

Additional shipped contracts: GET/POST /admin/messages/retention => {days}, 0 disables; POST body {days:int 0..3650}. GET /admin/messages/:id/timeline => {messageId,attempts}. Expired RUNNING schedules become UNCERTAIN (never blind resend); UI should display that status. Read API now returns readAt.

Build attempts blocked while root dependency upgrade removes/relinks node_modules; last pre-upgrade errors in delivery fixed. Full regression pending reinstall. Need deliveryStartedAt schema/migration before real DB test.

Frontend review request: deviceHistory currently still has `const unread = !m.readAt && !fb.used` and readVia=email_fallback. Please change unread to solely !readAt; separate fallback status/canResend policy. UI now shows readAt alone and separate email fallback. Also markRead route is `/admin/messages/mark-read` as existing API wrapper.

Frontend follow-up queue review: QueueAdminService.removeFailed currently job.remove() without checking getState==='failed'; its route says failed/:jobId/remove but can remove waiting/delayed jobs if called directly, and UI stale row could race retry. Please require failed state before removal to honor route semantics. UI now added queue stats/failed/delayed/retry/remove with confirmation, uncertain failures disable retry and backend remains authoritative.

03:27: source regression 16/16 PASS. API build timed out while parallel processes rebuilding dependencies/dist. No claim full typecheck passed yet. Still REQUIRE MessageLog.deliveryStartedAt DateTime? in schema + migration (only outstanding schema field).

03:28: API `node node_modules/typescript/bin/tsc --noEmit --incremental false --pretty false` PASS, delivery regression now 19/19 PASS. Root must add `deliveryStartedAt DateTime?` to MessageLog + SQL migration; otherwise runtime Prisma rejects delivery updates despite temporary any casts passing TS. Please confirm in this file. Existing owner used correctly. New `POST /api/webhook/dry-run` validates API key/template/dispatch plan without logs/send.

Operational semantic: dailyEmailQuota now counts all reserved SMTP attempts in UTC calendar day (failed sends also consume reservation, avoids release race/abuse). Channel health probes are configuration-only (`scope:'configuration',deliveryVerified:false`); explicit admin channel test still sends on request. Pending fallback schedule IDs are deterministic `unread-${messageId}`. Incomplete idempotency reservations are retained after expiry for manual audit, never silently reassigned; completed records can expire normally.

03:30: API Nest build PASS (13.2s); delivery tests PASS 19/19; scoped git diff --check PASS. Main implementation ready for root integration/review. User-visible schema prerequisite remains above. Real PostgreSQL/Redis crash/restart/concurrent quota test should be run by root against isolated services; mocks verify state semantics only. Current root package has no test script yet; add this regression to CI/test command.

03:38 follow-up: schema deliveryStartedAt now present. New `POST /admin/schedules/:id/resolve` validated DTO `{action:'delivered'|'retry',acknowledgeDuplicateRisk?:boolean}`. Retry requires acknowledgement exactly true; CAS only UNCERTAIN. Delivered marks SUCCESS; retry requeues immediately and records administrator decision. Frontend should add UNCERTAIN resolution actions.

Manual queue retry now CAS-resets only definite FAILED rows with deliveryStartedAt null and no DELIVERY_UNKNOWN prefix before retrying Bull job. Unknown outcomes reject. Async failover uses foLog identity/token in payload AND database, preserves priority/event/dedupe/parent, creates deterministic unread reminder for successful fallback. Device history unread/readAt/readVia now depend solely on actual readAt; email fallback still blocks redundant resend separately.

Executed real isolated PostgreSQL tests at postgresql://audit@127.0.0.1:56487/msghub_audit: 5/5 PASS (3-way atomic quota1, cancellation/claim races, JSON DbNull+owner expiry/release, queued/reference cleanup, UNCERTAIN resolution CAS). Source regression 24/24 PASS including persisted _deliveryMode, fallback read token and manual retry semantics. Tests live tests/delivery-database.integration.test.cjs and scripts/delivery-regression.test.cjs.

03:39: Full current root Node suite with isolated database `node --test tests/*.test.cjs scripts/delivery-regression.test.cjs` PASS 40/40, no skips. API tsc --noEmit PASS. Added compatibility POST /admin/messages/cleanup-preview and wrote new resolve contract in frontend-root-contract.md. Follow-up requested items all implemented; UI rendering delegated to frontend owner. No parallel Nest build run.
