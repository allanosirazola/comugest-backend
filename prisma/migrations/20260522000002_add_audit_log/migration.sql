-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM (
  'INVOICE_CREATED',
  'INVOICE_CANCELLED',
  'PAYMENT_RECORDED',
  'PAYMENT_DELETED',
  'RESIDENT_INVITED',
  'RESIDENT_ACTIVATED',
  'COMMUNITY_CREATED',
  'COMMUNITY_DELETED',
  'ANNOUNCEMENT_PUBLISHED',
  'EXPENSE_CREATED',
  'EXPENSE_DELETED',
  'PROCEDURE_SUBMITTED',
  'PROCEDURE_STATUS_CHANGED',
  'TICKET_CREATED',
  'TICKET_STATUS_CHANGED',
  'BUDGET_UPSERTED',
  'USER_LOGIN',
  'USER_ROLE_CHANGED'
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id"          TEXT NOT NULL,
    "action"      "AuditAction" NOT NULL,
    "actorId"     TEXT,
    "targetType"  TEXT,
    "targetId"    TEXT,
    "communityId" TEXT,
    "meta"        JSONB,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_communityId_createdAt_idx" ON "AuditLog"("communityId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
