# Final delivery fix

Frontend found QueueAdminService.removeFailed lacks failed state guard. Please fix with regression, also ensure races with retry/active work cannot lose pending logs (stable recovery). Review queue retry recovery interactions. Own queue file only, no root tests database fixture (fixed OPEN_API/SMTP). Run targeted tests. Record here.

Completed 03:50: removeFailed rejects non-failed jobs before removal; BullMQ lock check protects active jobs. If concurrent retry moves a failed job to waiting before removal, no DB row is deleted/changed and existing recoverPending rebuilds stable send-${messageId}. New regression exercises actual recovery after this interleaving.

Also fixed retry failure acknowledgement race: job.retry may succeed in Redis then throw due lost reply; previous catch reset DB FAILED, causing queued worker to skip. Now preserves durable PENDING and returns {id,retried:false,recoveryPending:true}, enabling worker or periodic recovery to continue. New regression first failed then passes.

Verification: all delivery regressions 27/27 PASS; full API tsc --noEmit --incremental false PASS. Only production file touched in this followup is queue/queue-admin.service.ts. Root database fixture untouched.
