CREATE TABLE "IncidentLog" (
  "id" TEXT NOT NULL,
  "communityId" TEXT NOT NULL,
  "number" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "category" TEXT NOT NULL DEFAULT 'GENERAL',
  "reportedById" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "resolvedAt" TIMESTAMP(3),
  "resolution" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IncidentLog_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "IncidentLog_communityId_number_key" ON "IncidentLog"("communityId", "number");
CREATE INDEX "IncidentLog_communityId_status_idx" ON "IncidentLog"("communityId", "status");
ALTER TABLE "IncidentLog" ADD CONSTRAINT "IncidentLog_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IncidentLog" ADD CONSTRAINT "IncidentLog_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
