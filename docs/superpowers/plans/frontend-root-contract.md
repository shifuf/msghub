# Root contracts for frontend_fix

Read this because collaboration messages are arriving blank. Existing UI file ownership remains yours.

## Notifications (implemented)
- GET `/admin/dashboard/notifications` without since/cursor returns latest items, serverTime, pending, failed24h.
- With `since=ISO&limit=100`: updates ordered by updatedAt,id ascending, inclusive of boundary time; includes archived records.
- Returns `{items,hasMore,nextCursor,serverTime,pending,failed24h}`. While hasMore use cursor=nextCursor. After whole batch save FIRST page serverTime as next since (not last page). Remove archivedAt items locally.
- Root owns dashboard backend. security_fix will own realtime.service Redis pub/sub.

## Backup (implemented)
- GET `/admin/backup/export`: plain v3.
- POST `/admin/backup/export` `{password?:string,redact?:boolean}`: password >=12 yields encrypted envelope; redacted export cannot restore credentials.
- POST `/admin/backup/preview` and `/import`: `{data:backupObject,password?:string}`.
- Response groups channels/projects/emailTemplates/pushTemplates/systemSettings/emailSuppress/schedules/eventDefinitions/partners each `{created,updated,skipped}`, plus warnings. Require preview confirmation before import; new schedules PAUSED.

## Template versions (implemented)
- Both `/admin/templates` and `/admin/push-templates` support GET `/:id/versions` (array revision,snapshot,createdAt), PUT `/:id/draft` (UpdateDto), POST `/:id/publish`, POST `/:id/rollback` `{revision:number}`.
- Existing PATCH remains immediate publish with history. GET includes draft and revision. Draft does not alter live fields.
- Add draft save/publish/history rollback UI in editor/modal.

## Security (implemented; read security-contract.md)
- login optional six-digit code; auth/me.totpEnabled.
- POST auth/totp/setup {password} -> secret,uri; POST /enable {code}; POST /disable {password,code}; POST auth/revoke-sessions.
- Password minimum12 max72; password/TOTP/revoke success requires logout.
- POST `/admin/realtime/ticket` -> {ticket,expiresIn}; GET stream?ticket.

## Delivery (agent implementing)
- Schedules GET ?page&pageSize -> {items,total,page,pageSize}; PATCH /:id; POST /:id/pause and /resume. States include PAUSED,UNCERTAIN.
- Delivery follow-up implemented `POST /admin/schedules/:id/resolve` `{action:'delivered'|'retry',acknowledgeDuplicateRisk?:boolean}`. Retry requires explicit true and confirmation of possible duplicate; delivered acknowledges independently verified delivery. Only UNCERTAIN accepted via CAS.
- Messages POST /cleanup-preview matches cleanup DTO -> {matched}; add preview count before destructive action.
- Root will implement retention settings in `/admin/settings`: messageRetentionDays/activityRetentionDays/sensitiveRetentionDays strings, 0 disables. Keep UI compatible.
- Root expects UI entry for existing queue stats/failed/delayed/retry/remove APIs, with uncertain delivery handled explicitly.

## BrowserShell
- Preserve modified files under docs/backups/20261117-msghub/ and validate actual push/read receipt behavior; no real sends.
- Please record changes/tests and remaining missing UI here or separate frontend-contract.md, not only tool messages.
