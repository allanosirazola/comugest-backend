-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SUPPLIER_CREATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SUPPLIER_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SUPPLIER_DELETED';

-- AlterTable: add supplierId to Expense
ALTER TABLE "Expense" ADD COLUMN "supplierId" TEXT;

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cif" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Supplier_communityId_idx" ON "Supplier"("communityId");

ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON UPDATE CASCADE;
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
