CREATE TABLE "ReservationWaitlist" (
  "id" TEXT NOT NULL,
  "areaId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "startTime" TIMESTAMP(3) NOT NULL,
  "endTime" TIMESTAMP(3) NOT NULL,
  "notified" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReservationWaitlist_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ReservationWaitlist_areaId_userId_startTime_endTime_key" ON "ReservationWaitlist"("areaId", "userId", "startTime", "endTime");
CREATE INDEX "ReservationWaitlist_areaId_startTime_idx" ON "ReservationWaitlist"("areaId", "startTime");
ALTER TABLE "ReservationWaitlist" ADD CONSTRAINT "ReservationWaitlist_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "CommonArea"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReservationWaitlist" ADD CONSTRAINT "ReservationWaitlist_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
