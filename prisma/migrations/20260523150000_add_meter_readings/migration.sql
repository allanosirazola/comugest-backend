-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'METER_READING_ADDED';

-- CreateEnum
CREATE TYPE "MeterType" AS ENUM ('AGUA', 'LUZ', 'GAS', 'OTRO');

-- CreateTable
CREATE TABLE "MeterReading" (
    "id" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "type" "MeterType" NOT NULL DEFAULT 'AGUA',
    "readingDate" TIMESTAMP(3) NOT NULL,
    "value" DECIMAL(12,3) NOT NULL,
    "consumption" DECIMAL(12,3),
    "notes" TEXT,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MeterReading_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MeterReading_unitId_type_readingDate_idx" ON "MeterReading"("unitId", "type", "readingDate");

ALTER TABLE "MeterReading" ADD CONSTRAINT "MeterReading_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MeterReading" ADD CONSTRAINT "MeterReading_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON UPDATE CASCADE;
