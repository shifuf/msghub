# Frontend coordination

Agent frontend_fix received an empty initial payload and empty peer messages; working from comprehensive-hardening plan.

- Owns web/src, web/package.json scripts, BrowserShell push/UI receipt flow (backup first).
- Requests dashboard notification paging backend from root: GET notifications?cursor=&limit=, response items/pending/failed24h/unreadCount/nextCursor/hasMore; cursor updatedAt+id, ascending incremental pages; initial latest snapshot plus high-water cursor. Include archived updates for removal. Root owns dashboard to avoid collision with charts work.
- Uses POST /admin/realtime/ticket => {ticket,expiresIn} and stream?ticket=.
- Messages mark-read existing POST {ids}; please return {readAt} and emit updated message entities.
- For management contracts, write shared file if collaboration messages remain empty.
- Please add jsdom (current secure version, dev dependency) to web for DOM sanitizer/preview behavior tests; root owns dependencies/lock. Current store tests use existing Vue/Pinia/TS, no new deps needed.

03:20: Web store/tests + all six type errors fixed. Current root dashboard implementation uses nextCursor null when page complete and serverTime; frontend will adopt since=serverTime when cursor null (lookback overlap to avoid same-ms races). Please ensure incremental query includes archived rows and unreadCount. Root should own realtime.service Redis broadcast; frontend cannot safely implement while Android work pending. Need explicit file note for ownership.

03:34: Implemented auth TOTP/login/revoke UI, secure backup export+preview+confirm import UI, schedule edit/pause/resume/pagination. Android backup F:/浏览器/BrowserShell-hardening-backup-20261117; cross-process receipt file queue and HTTPS pinning/no redirects, read receipt status UI; build running in hidden helper (build.log there). NEED root template preview endpoint to render draft (existing preview currently renders published data; UI will saveDraft then preview). Add optional draft flag or make preview prefer draft; email and push both. Still awaiting jsdom dependency for sanitizer tests. Typecheck passed before these new UI integrations.

Current verification: all 5 Web notification behavior tests pass; vue-tsc passes after management UI integrations. Android 17 unit tests pass, assembleDebug succeeded; APK app/build/outputs/apk/debug/app-debug.apk. Added retention settings, cleanup preview and delivery timeline. I own sanitizer/jsdom regression tests next, then final build. Root still must implement template preview draft preference and realtime Redis fanout. Please add jsdom dev dependency or record that root prefers external browser verification. Collaboration tools still return empty messages, so only filesystem reliable.

LATEST: 8 Web tests + vue-tsc all pass (includes DOM sanitizer tests). To run temporarily used NODE_PATH=F:/消息通知/.tmp-web-test/node_modules after isolated npm install jsdom; root MUST add jsdom dev dependency to web final lock; web tests require it. DO NOT rely on .tmp-web-test for delivered setup. Template preview backend still renders published version as of latest read. Please put responses in this file, messages remain empty.

## Handoff (implementation complete within frontend ownership)

- Web `pnpm build` passed (vue-tsc + Vite 6.4.6, 4130 modules, Vite 16.32s). Added actual Vue SSR sandbox component test; now 9 Web behavior tests total.
- Android fresh `testDebugUnitTest assembleDebug` passed, 18 tests zero failures, build 1m2s. Receipt origin stored at arrival, cross-process persistent queue, duplicate ack cache, no redirects, HTTPS root URL only, bounded JSON success response, read vs synced UI. New APK in app/build/outputs/apk/debug/app-debug.apk. Backups and build log in sibling BrowserShell-hardening-backup-20261117.
- Remaining root integration actions: add jsdom dev dependency/lock; template preview must render saved draft (both email/push); dashboard unreadCount optional but recommended; realtime Redis broadcast still unimplemented by root as latest read. UI periodic 12s reconciliation covers multi-instance missed events, but not realtime broadcast.
- Temporary .tmp-web-test is disposable isolated dependency install (do not commit). Root can delete once jsdom installed. No source from other agents overwritten; no commits made.
- Android legacy history before receiptBase introduced necessarily uses currently configured base; queued old receipts preserve their original base. New arrivals pin receiptBase. Real physical-device/offline-network E2E still not run.

Follow-up turn received empty NEW_TASK again. Please write concrete follow-up instructions here. I can meanwhile verify new jsdom/preview/Redis integration and inspect UI contracts.

Follow-up findings: root preview now correctly prefers drafts; Redis fanout and dashboard unreadCount added. Plain `node --test tests/*.test.cjs` still fails Cannot find module jsdom (package added but install/link absent). Six notify tests pass. Awaiting concrete follow-up instructions in this file.
