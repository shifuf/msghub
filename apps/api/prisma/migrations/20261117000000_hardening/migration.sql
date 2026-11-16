ALTER TABLE "AdminUser"
  ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "totpSecret" TEXT,
  ADD COLUMN "totpPendingSecret" TEXT,
  ADD COLUMN "totpEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "totpLastCounter" BIGINT;
ALTER TABLE "IdempotencyRecord" ADD COLUMN "owner" TEXT;
ALTER TABLE "MessageLog" ADD COLUMN "deliveredAt" TIMESTAMP(3), ADD COLUMN "fallbackSentAt" TIMESTAMP(3);
ALTER TABLE "ScheduledMessage" ADD COLUMN "leaseUntil" TIMESTAMP(3), ADD COLUMN "executionKey" TEXT, ADD COLUMN "attempt" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "EmailTemplate" ADD COLUMN "draft" JSONB, ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "PushTemplate" ADD COLUMN "draft" JSONB, ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;
CREATE TABLE "TemplateRevision" (
  "id" TEXT NOT NULL, "kind" TEXT NOT NULL, "templateId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL, "snapshot" JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TemplateRevision_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TemplateRevision_kind_templateId_revision_key" ON "TemplateRevision"("kind", "templateId", "revision");
CREATE INDEX "TemplateRevision_kind_templateId_createdAt_idx" ON "TemplateRevision"("kind", "templateId", "createdAt");
CREATE INDEX "MessageLog_updatedAt_id_idx" ON "MessageLog"("updatedAt", "id");
CREATE INDEX "ScheduledMessage_status_leaseUntil_idx" ON "ScheduledMessage"("status", "leaseUntil");

-- Preserve every duplicate row before resolving NULL-scope uniqueness. The newest
-- configuration remains active; archived JSON can be recovered by an operator.
CREATE TABLE IF NOT EXISTS "MigrationArchive" (
  "migration" TEXT NOT NULL, "tableName" TEXT NOT NULL, "rowId" TEXT NOT NULL,
  "snapshot" JSONB NOT NULL, "archivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("migration", "tableName", "rowId")
);
DO $$
DECLARE tbl TEXT; field TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['EventDefinition', 'EmailTemplate', 'PushTemplate', 'EmailSuppress'] LOOP
    field := CASE WHEN tbl = 'EmailSuppress' THEN 'address' ELSE 'code' END;
    EXECUTE format(
      'INSERT INTO "MigrationArchive" ("migration","tableName","rowId","snapshot")
       SELECT ''20261117000000_hardening'', %L, t.id, to_jsonb(t) FROM %I t
       WHERE t.id IN (SELECT id FROM (SELECT id, row_number() OVER (PARTITION BY %I ORDER BY "updatedAt" DESC, "createdAt" DESC, id DESC) rn FROM %I WHERE "projectId" IS NULL) r WHERE rn > 1)
       ON CONFLICT DO NOTHING', tbl, tbl, field, tbl);
    EXECUTE format('DELETE FROM %I WHERE id IN (SELECT "rowId" FROM "MigrationArchive" WHERE migration=''20261117000000_hardening'' AND "tableName"=%L)', tbl, tbl);
    EXECUTE format('CREATE UNIQUE INDEX %I ON %I (%I) WHERE "projectId" IS NULL', tbl || '_global_' || field || '_key', tbl, field);
  END LOOP;
END $$;

UPDATE "MessageLog" SET "deliveredAt" = "updatedAt" WHERE "status" = 'SUCCESS' AND "channelType" IS NOT NULL AND "channelType" <> 'INBOX';
-- Historical readAt values mixed genuine reads and fallback delivery. Preserve
-- them rather than guessing which were real clicks. New code uses distinct fields.
