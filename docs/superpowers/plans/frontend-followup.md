# Frontend integration followup

Root is adding jsdom, draft-aware preview, unreadCount, dashboard DB aggregation now. Security agent owns Redis realtime fanout and readiness.

Dashboard charts now returns timezone:'UTC', metrics:{externalSuccessRate,fallbackRate,latencyP95Ms,queueWaitP95Ms,stalePending,inboxAccepted,externalAttempts,delivered}; byProject includes delivered/fallback/latencyP95Ms. Please expose useful metrics in dashboard with clear UTC day label and null latency = no samples. Error clusters capped 2000 sample; root will add sampled/totalFailed, please label samples when sampled=true. Avoid claiming SMTP delivery means actual human receipt.

Please inspect delivery-followup.md / delivery-contract.md and implement UI for newly added schedule UNCERTAIN resolution endpoint once available (acknowledge vs recreate, explicit duplicate warning). Review new frontend/backend route/shape compatibility, fix any issues in frontend only. Run tests/typecheck. Do not run API build or change dependencies/lock. Record evidence here. Also review Android receipt flow against backend receipt route/response and document any integration gap; preserve original source backup.

Implemented resolve UI with explicit duplicate-risk confirmation; delivered never requests retry. Added queue management page/nav, counts/failed/delayed, message detail links, retry/remove confirmations. Added settings activity/sensitive retention controls, switched all three retention writes to settings string contract. Read-only channel selection during schedule editing avoids unsupported DTO field.

Verification so far: new actual compiled Vue setup behavior tests (2) confirm no resolve call before approval and exact retry acknowledgment payload; vue-tsc passes. Android POST /api/public/messages/mark-read with {messageId,token}, response success:true matches actual backend ok(result). HTTP errors, non-JSON proxy 200, redirects and false-success retain pending receipts. New receiptBase pins arrival origin; legacy history predating this field uses current configured origin, documented limitation. Source originals preserved at sibling BrowserShell-hardening-backup-20261117.

Root integration resolved draft-aware previews, Redis fanout, unreadCount. jsdom is in package.json but symlink not installed when plain full tests ran; waiting on root install (no dependency/lock edits by frontend).

Latest test run with jsdom symlink now exists: preview suite fails `ERR_MODULE_NOT_FOUND @exodus/bytes/utf16.js imported by fallback/encoding.js` (pnpm @exodus+bytes@1.16.0). Eight other tests pass, vue-tsc passes. Looks like dependency materialization still in progress/incomplete; root should recheck install. Original Android source backup also copied to requested repo path docs/backups/20261117-msghub/BrowserShell/app (5 files; before edits).

Final follow-up verification: fresh `pnpm build` passed (vue-tsc + Vite, 4132 modules, Vite 17.11s). New 2 schedule tests and 6 notify tests pass. Full suite cannot pass until missing @exodus/bytes/utf16.js dependency file restored (not editing deps per requested ownership). Reported removeFailed missing failed-state check to delivery-contract. All requested frontend follow-up features implemented; no API build/dependency mutation performed.
