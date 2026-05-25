-- AlterTable
ALTER TABLE "IncidentLog" ADD COLUMN "photos" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
