# Next task: Redis + HTTP integration

## Isolated Redis acquired

- Source: https://github.com/redis-windows/redis-windows/releases/tag/8.10.3 (community Windows port; upstream Redis has no native Windows build). Latest tporadowski release was only Redis5, unsuitable for current BullMQ, so not used.
- Asset Redis-8.10.3-Windows-x64-msys2.zip SHA256 `af16df340525b431e9ec8dabfd625d5e7a233f82805b5418819904ea909c447f` matches GitHub release API digest.
- Path `C:/Users/shifuf/AppData/Local/Temp/msghub-audit-redis-20261117`; config audit.conf binds only 127.0.0.1:56488, persistence off, maxmemory 128MB.
- First launch PID 24672 exited because MSYS2 treated a Windows absolute config path incorrectly; relaunched with relative audit.conf. Active hidden process PID 41916 (MSYS internal pid 625), PING verified PONG. Existing unrelated D:/Redis process PID5036 untouched. Logs stdout.log/stderr.log in same temp path. Teardown: `redis-cli.exe -h 127.0.0.1 -p 56488 shutdown nosave` using binary in server/Redis-8.10.3-Windows-x64-msys2. Confirm process command/path before any Stop-Process fallback. Do not stop PG.
- Tests use AUDIT_REDIS_URL=redis://127.0.0.1:56488 and AUDIT_DATABASE_URL=postgresql://audit@127.0.0.1:56487/msghub_audit?schema=public only.

## Verified integration results

- `tests/security-redis.integration.test.cjs` adds four explicitly opted-in tests; skips without environment URLs and rejects non-loopback/non-audit ports/database names.
- Real Redis atomic throttle: 40 concurrent requests across two storage instances, exactly 7 allowed.
- Real Redis pub/sub: two RealtimeService instances receive one local/remote event without duplicate delivery.
- Real PostgreSQL+Redis+BullMQ readiness: no worker gives 503, live worker gives ready, paused queue gives 503, process liveness stays up.
- Real Nest11 HTTP app imports actual auth/prisma/realtime modules with ignoreEnvFile:true; creates and deletes a uniquely named audit administrator. Login succeeds; realtime ticket is rejected as admin Bearer; open SSE connection closes on session revocation before disclosing a new message; old JWT receives 401; TOTP setup stores encrypted data; enable revokes current token; login needs a valid unused OTP; OTP replay fails; change password revokes the new JWT.
- Final command with explicit AUDIT URLs: `node --test tests/security-redis.integration.test.cjs scripts/security-followup.test.cjs scripts/security-regression.cjs` => 25/25 passing, zero skipped. `tsc --noEmit --incremental false` => exit 0. No NODE_PATH workaround now needed (root installed direct express).
- Leave temporary Redis running for root integration/final verification; no pre-existing Redis or PostgreSQL was stopped, and no business notification was sent. Root should shut down port 56488 after final verification using command above.

Please acquire/start an isolated loopback Redis (not existing service) using safe trusted package/download or installed tools. WSL list gave no useful distro output. Docker unavailable. Do not scan full disks. Test actual shared throttle atomicity, two RealtimeService instances cross-publish with Redis, readiness behavior, and real Nest boot/login/ticket/revoke/TOTP if practical. Use PG audit DB at postgresql://audit@127.0.0.1:56487/msghub_audit?schema=public ONLY; never real .env or user data. Add reproducible integration tests (skip unless explicit AUDIT_REDIS_URL/AUDIT_DATABASE_URL, enforce loopback). Root adds express dependency and runs final build; you can run TS via ts-node, no Nest build. Record server PID/port/path and teardown instructions in this file. Do not stop PG (other tests using). If Redis acquisition blocked document exact attempts and continue HTTP boot with isolated deps. Root handles docs/metrics/dependencies/CI.
