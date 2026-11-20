ALTER TABLE "MessageLog"
  ADD COLUMN "providerAcceptedAt" TIMESTAMP(3),
  ADD COLUMN "deviceReceivedAt" TIMESTAMP(3),
  ADD COLUMN "deviceDisplayedAt" TIMESTAMP(3),
  ADD COLUMN "conversationActivityAt" TIMESTAMP(3),
  ADD COLUMN "conversationClosedAt" TIMESTAMP(3);

UPDATE "MessageLog" AS message
SET "conversationActivityAt" = latest."activityAt"
FROM (
  SELECT "messageId", MAX("createdAt") AS "activityAt"
  FROM "MessageReply"
  GROUP BY "messageId"
) AS latest
WHERE message.id = latest."messageId";

CREATE INDEX "MessageLog_channelType_conversationActivityAt_idx"
  ON "MessageLog"("channelType", "conversationActivityAt");
CREATE INDEX "MessageLog_deviceReceivedAt_deviceDisplayedAt_idx"
  ON "MessageLog"("deviceReceivedAt", "deviceDisplayedAt");

ALTER TABLE "ScheduledMessage"
  ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'Asia/Shanghai';

CREATE TABLE "ScheduleExecution" (
  "id" TEXT NOT NULL,
  "scheduleId" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "finishedAt" TIMESTAMP(3),
  "status" TEXT NOT NULL,
  "messageId" TEXT,
  "error" TEXT,
  CONSTRAINT "ScheduleExecution_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ScheduleExecution_scheduleId_startedAt_idx"
  ON "ScheduleExecution"("scheduleId", "startedAt");

ALTER TABLE "ScheduleExecution"
  ADD CONSTRAINT "ScheduleExecution_scheduleId_fkey"
    FOREIGN KEY ("scheduleId") REFERENCES "ScheduledMessage"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "DevicePairingCode" (
  "id" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "appKey" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DevicePairingCode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DevicePairingCode_codeHash_key"
  ON "DevicePairingCode"("codeHash");
CREATE INDEX "DevicePairingCode_expiresAt_consumedAt_idx"
  ON "DevicePairingCode"("expiresAt", "consumedAt");

CREATE TABLE "JpushDevice" (
  "id" TEXT NOT NULL,
  "registrationId" TEXT NOT NULL,
  "appKey" TEXT NOT NULL,
  "credentialHash" TEXT NOT NULL,
  "name" TEXT,
  "appVersion" TEXT,
  "osVersion" TEXT,
  "notificationsEnabled" BOOLEAN,
  "channelEnabled" BOOLEAN,
  "connected" BOOLEAN NOT NULL DEFAULT false,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "JpushDevice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "JpushDevice_registrationId_key"
  ON "JpushDevice"("registrationId");
CREATE UNIQUE INDEX "JpushDevice_credentialHash_key"
  ON "JpushDevice"("credentialHash");
CREATE INDEX "JpushDevice_appKey_revokedAt_idx"
  ON "JpushDevice"("appKey", "revokedAt");
CREATE INDEX "JpushDevice_lastSeenAt_idx"
  ON "JpushDevice"("lastSeenAt");

CREATE TABLE "DeviceReceipt" (
  "id" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "registrationId" TEXT NOT NULL,
  "arrivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "displayedAt" TIMESTAMP(3),
  CONSTRAINT "DeviceReceipt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DeviceReceipt_messageId_fkey"
    FOREIGN KEY ("messageId") REFERENCES "MessageLog"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "DeviceReceipt_messageId_registrationId_key"
  ON "DeviceReceipt"("messageId", "registrationId");
CREATE INDEX "DeviceReceipt_registrationId_arrivedAt_idx"
  ON "DeviceReceipt"("registrationId", "arrivedAt");
