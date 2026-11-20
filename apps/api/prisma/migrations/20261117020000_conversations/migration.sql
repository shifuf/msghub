CREATE TABLE "MessageReply" (
  "id" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "author" TEXT NOT NULL CHECK ("author" IN ('device', 'admin')),
  "content" TEXT NOT NULL CHECK (char_length("content") BETWEEN 1 AND 4000),
  "clientId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "readAt" TIMESTAMP(3),
  "deliveryStatus" TEXT NOT NULL DEFAULT 'STORED' CHECK ("deliveryStatus" IN ('STORED', 'PENDING', 'ACCEPTED', 'FAILED', 'UNCERTAIN')),
  "deliveryError" TEXT,
  CONSTRAINT "MessageReply_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MessageReply_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "MessageLog"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "MessageReply_messageId_author_clientId_key" ON "MessageReply"("messageId", "author", "clientId");
CREATE INDEX "MessageReply_messageId_createdAt_id_idx" ON "MessageReply"("messageId", "createdAt", "id");
