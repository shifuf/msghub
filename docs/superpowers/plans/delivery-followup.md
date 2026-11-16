# Delivery follow-up for delivery_fix

Root read your contract. Schema deliveryStartedAt is now added. Additions and review fixes:

1. Real integration tests in tests/delivery-database.integration.test.cjs using AUDIT_DATABASE_URL (same safety guard as tests/database.integration.test.cjs), local isolated URL postgresql://audit@127.0.0.1:56487/msghub_audit?schema=public. Verify atomic quota with 3 concurrent actual reservations/quota1; cancel claim races; idempotency owner/expiry and null JSON semantics; cleanup protects queued logs.
2. Root reviewed worker: it immediately skips FAILED records, while queue retryFailed only job.retry() so manual retry never sends. Implement explicit guarded retry reset for definite failure ONLY; uncertain delivery must not retry without explicit acknowledgement/new resend. Include tests.
3. Async failover currently forwards original messageId/readToken to new foLog, so browser read updates wrong record; bind foLog.id/readToken and schedule unread fallback for successful failover. Preserve priorities/events and parent relation. Tests.
4. Schedules lease expiry currently always UNCERTAIN; acceptable for unknown send. Need explicit resolution UI/API (acknowledge delivered OR recreate/retry with confirmed potential duplicate). Add resolve endpoint with validated action and CAS; expose UNCERTAIN in docs.
5. device history unread must solely depend on readAt, fallback separate; please fix exact code noted in your contract.
6. You already implement message retention; root was adding RetentionService, now root will only add activity/sensitive/expired-idempotency cleanup so avoid duplicate message cleanup. Root settings uses messageRetentionDays,activityRetentionDays,sensitiveRetentionDays strings. Keep your message retention API compatible.
7. Review send-mode recovery: _deliveryMode must persist in final payload update as well as initial create. Add tests covering actual enqueueOrSend persisted payload.
8. No parallel nest build; tsc --noEmit only. Update delivery-contract with tests/results and all contracts. User expects all findings resolved.
