-- CreateEnum
CREATE TYPE "ChannelType" AS ENUM ('SERVERCHAN', 'PUSHPLUS', 'DINGTALK', 'TELEGRAM', 'WEBHOOK', 'SMTP', 'INBOX', 'BARK', 'GOTIFY', 'FEISHU', 'DISCORD', 'JPUSH');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'DELAYED');

-- CreateEnum
CREATE TYPE "MessageSource" AS ENUM ('OPEN_API', 'ADMIN_TEST', 'ADMIN_SEND', 'BACKUP_ALERT', 'RESEND', 'BATCH');

-- CreateEnum
CREATE TYPE "MessagePriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'CRITICAL');

-- CreateTable
CREATE TABLE "AdminUser" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "apiKeyHash" TEXT NOT NULL,
    "apiKeyPrefix" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "adminEmail" TEXT,
    "alertFailRatePct" INTEGER,
    "alertWindowMin" INTEGER NOT NULL DEFAULT 60,
    "lastFailAlertAt" TIMESTAMP(3),
    "dailyEmailQuota" INTEGER,
    "emailFailSuppressCount" INTEGER NOT NULL DEFAULT 5,
    "alertCooldownMin" INTEGER NOT NULL DEFAULT 10,
    "quietHoursEnabled" BOOLEAN NOT NULL DEFAULT false,
    "quietStart" TEXT,
    "quietEnd" TEXT,
    "quietTimezone" TEXT NOT NULL DEFAULT 'Asia/Shanghai',
    "rateLimitPerMin" INTEGER,
    "idempotencyTtlMin" INTEGER NOT NULL DEFAULT 30,
    "inboundToken" TEXT,
    "unreadEmailFallbackEnabled" BOOLEAN NOT NULL DEFAULT false,
    "unreadEmailFallbackHours" INTEGER NOT NULL DEFAULT 24,
    "unreadEmailTemplateCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectApiKey" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "apiKeyHash" TEXT NOT NULL,
    "apiKeyPrefix" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "messageId" TEXT,
    "response" JSONB,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventDefinition" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "defaultPriority" "MessagePriority" NOT NULL DEFAULT 'NORMAL',
    "pushTemplateCode" TEXT,
    "emailTemplateCode" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailSuppress" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "address" TEXT NOT NULL,
    "reason" TEXT,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailSuppress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "PartnerLink" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "logoUrl" TEXT,
    "description" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Channel" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ChannelType" NOT NULL,
    "config" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "lastHealthAt" TIMESTAMP(3),
    "lastHealthOk" BOOLEAN,
    "lastHealthError" TEXT,
    "lastHealthMs" INTEGER,
    "healthFailStreak" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Channel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectChannel" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isBackup" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailTemplate" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "htmlBody" TEXT NOT NULL,
    "textBody" TEXT,
    "variables" JSONB,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushTemplate" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "titleTpl" TEXT NOT NULL DEFAULT '',
    "contentTpl" TEXT NOT NULL,
    "variables" JSONB,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageLog" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "channelId" TEXT,
    "channelType" "ChannelType",
    "source" "MessageSource" NOT NULL,
    "status" "MessageStatus" NOT NULL DEFAULT 'PENDING',
    "priority" "MessagePriority" NOT NULL DEFAULT 'NORMAL',
    "title" TEXT,
    "content" TEXT,
    "payload" JSONB,
    "response" JSONB,
    "errorMessage" TEXT,
    "toAddress" TEXT,
    "templateCode" TEXT,
    "eventCode" TEXT,
    "dedupeKey" TEXT,
    "durationMs" INTEGER,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "attemptDetail" JSONB,
    "nextRetryAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "parentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessageLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduledMessage" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "channelId" TEXT,
    "channelType" "ChannelType",
    "kind" TEXT NOT NULL DEFAULT 'push',
    "title" TEXT,
    "content" TEXT,
    "html" TEXT,
    "toAddress" TEXT,
    "templateCode" TEXT,
    "variables" JSONB,
    "runAt" TIMESTAMP(3) NOT NULL,
    "cron" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "lastError" TEXT,
    "messageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduledMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resource" TEXT,
    "resourceId" TEXT,
    "resourceName" TEXT,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdminUser_username_key" ON "AdminUser"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Project_apiKeyHash_key" ON "Project"("apiKeyHash");

-- CreateIndex
CREATE UNIQUE INDEX "Project_inboundToken_key" ON "Project"("inboundToken");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectApiKey_apiKeyHash_key" ON "ProjectApiKey"("apiKeyHash");

-- CreateIndex
CREATE INDEX "ProjectApiKey_projectId_idx" ON "ProjectApiKey"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectApiKey_projectId_name_key" ON "ProjectApiKey"("projectId", "name");

-- CreateIndex
CREATE INDEX "IdempotencyRecord_expiresAt_idx" ON "IdempotencyRecord"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyRecord_projectId_key_key" ON "IdempotencyRecord"("projectId", "key");

-- CreateIndex
CREATE INDEX "EventDefinition_code_idx" ON "EventDefinition"("code");

-- CreateIndex
CREATE UNIQUE INDEX "EventDefinition_projectId_code_key" ON "EventDefinition"("projectId", "code");

-- CreateIndex
CREATE INDEX "EmailSuppress_address_idx" ON "EmailSuppress"("address");

-- CreateIndex
CREATE INDEX "EmailSuppress_projectId_createdAt_idx" ON "EmailSuppress"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmailSuppress_projectId_address_key" ON "EmailSuppress"("projectId", "address");

-- CreateIndex
CREATE INDEX "PartnerLink_enabled_displayOrder_idx" ON "PartnerLink"("enabled", "displayOrder");

-- CreateIndex
CREATE INDEX "Channel_type_idx" ON "Channel"("type");

-- CreateIndex
CREATE INDEX "ProjectChannel_projectId_enabled_idx" ON "ProjectChannel"("projectId", "enabled");

-- CreateIndex
CREATE INDEX "ProjectChannel_projectId_priority_idx" ON "ProjectChannel"("projectId", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectChannel_projectId_channelId_key" ON "ProjectChannel"("projectId", "channelId");

-- CreateIndex
CREATE INDEX "EmailTemplate_code_idx" ON "EmailTemplate"("code");

-- CreateIndex
CREATE UNIQUE INDEX "EmailTemplate_projectId_code_key" ON "EmailTemplate"("projectId", "code");

-- CreateIndex
CREATE INDEX "PushTemplate_code_idx" ON "PushTemplate"("code");

-- CreateIndex
CREATE UNIQUE INDEX "PushTemplate_projectId_code_key" ON "PushTemplate"("projectId", "code");

-- CreateIndex
CREATE INDEX "MessageLog_projectId_createdAt_idx" ON "MessageLog"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "MessageLog_status_createdAt_idx" ON "MessageLog"("status", "createdAt");

-- CreateIndex
CREATE INDEX "MessageLog_createdAt_idx" ON "MessageLog"("createdAt");

-- CreateIndex
CREATE INDEX "MessageLog_parentId_idx" ON "MessageLog"("parentId");

-- CreateIndex
CREATE INDEX "MessageLog_projectId_dedupeKey_idx" ON "MessageLog"("projectId", "dedupeKey");

-- CreateIndex
CREATE INDEX "MessageLog_toAddress_createdAt_idx" ON "MessageLog"("toAddress", "createdAt");

-- CreateIndex
CREATE INDEX "MessageLog_status_nextRetryAt_idx" ON "MessageLog"("status", "nextRetryAt");

-- CreateIndex
CREATE INDEX "MessageLog_eventCode_idx" ON "MessageLog"("eventCode");

-- CreateIndex
CREATE INDEX "ScheduledMessage_status_runAt_idx" ON "ScheduledMessage"("status", "runAt");

-- CreateIndex
CREATE INDEX "ScheduledMessage_projectId_idx" ON "ScheduledMessage"("projectId");

-- CreateIndex
CREATE INDEX "ActivityLog_createdAt_idx" ON "ActivityLog"("createdAt");

-- CreateIndex
CREATE INDEX "ActivityLog_action_idx" ON "ActivityLog"("action");

-- CreateIndex
CREATE INDEX "ActivityLog_resource_idx" ON "ActivityLog"("resource");

-- AddForeignKey
ALTER TABLE "ProjectApiKey" ADD CONSTRAINT "ProjectApiKey_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdempotencyRecord" ADD CONSTRAINT "IdempotencyRecord_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventDefinition" ADD CONSTRAINT "EventDefinition_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailSuppress" ADD CONSTRAINT "EmailSuppress_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectChannel" ADD CONSTRAINT "ProjectChannel_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectChannel" ADD CONSTRAINT "ProjectChannel_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailTemplate" ADD CONSTRAINT "EmailTemplate_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushTemplate" ADD CONSTRAINT "PushTemplate_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageLog" ADD CONSTRAINT "MessageLog_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageLog" ADD CONSTRAINT "MessageLog_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledMessage" ADD CONSTRAINT "ScheduledMessage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

