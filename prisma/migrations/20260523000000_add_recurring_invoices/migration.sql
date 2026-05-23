-- CreateEnum
CREATE TYPE "RecurringFrequency" AS ENUM ('MONTHLY', 'QUARTERLY', 'YEARLY');

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'RECURRING_INVOICE_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'RECURRING_INVOICE_TRIGGERED';

-- CreateTable
CREATE TABLE "RecurringInvoice" (
    "id" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "concept" TEXT NOT NULL,
    "description" TEXT,
    "frequency" "RecurringFrequency" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "dayOfMonth" INTEGER NOT NULL DEFAULT 1,
    "nextBillingAt" TIMESTAMP(3) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RecurringInvoice_pkey" PRIMARY KEY ("id")
);

-- AlterTable Invoice
ALTER TABLE "Invoice" ADD COLUMN "recurringSourceId" TEXT;

-- CreateIndex
CREATE INDEX "RecurringInvoice_communityId_idx" ON "RecurringInvoice"("communityId");
CREATE INDEX "RecurringInvoice_nextBillingAt_active_idx" ON "RecurringInvoice"("nextBillingAt", "active");

-- AddForeignKey
ALTER TABLE "RecurringInvoice" ADD CONSTRAINT "RecurringInvoice_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecurringInvoice" ADD CONSTRAINT "RecurringInvoice_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_recurringSourceId_fkey" FOREIGN KEY ("recurringSourceId") REFERENCES "RecurringInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
