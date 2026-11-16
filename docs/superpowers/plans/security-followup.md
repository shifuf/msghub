# Security follow-up owned by security_fix

Root final review requires the following implementation before security completion. Read this file because tool messages are arriving blank.

1. Encrypt `totpSecret` and `totpPendingSecret` at rest using authenticated encryption, key derived from configured strong JWT/explicit encryption key. Return plain enrollment secret only in setup response. Reject tampered stored ciphertext. Add regression tests. This was in original scope but current AuthService stores plaintext.
2. Implement `/api/health/live` process liveness and `/api/health` / `ready` PostgreSQL + Redis + active queue worker readiness with bounded timeouts; health must bypass throttling. Coordinate queue ownership by reading current service; do not mutate delivery agent files.
3. Configure request body parser to allow up to 20MB only for authenticated admin backup endpoints (including preview) while retaining a small limit for other endpoints. Nest 11 Express v5 path matching needs real integration validation.
4. Add Redis multi-process SSE pub/sub in realtime.service (you own it now). Preserve constructor/test compatibility where sensible. Instance ID prevents duplicate local delivery, bounded reconnection; client incremental poll remains fallback. No real notifications.
5. Add TOTP-sensitive action race protection: setup/enable must not overwrite newer settings; no logs of secrets. Test revocation/expiry.
6. Current Prisma schema and migration already include tokenVersion, totpEnabled, totpLastCounter, totpPendingSecret, totpSecret. Do not edit schema. Dependencies Nest11, undici7 and ipaddr2 installed.
7. Do not run nest build concurrently; use tsc --noEmit. Append results to security-contract.md. Root will do full build.

Root handles seed safety and fixed proxy configuration, isolated PostgreSQL (127.0.0.1:56487 database msghub_audit), templates/backups/dependency audit.
