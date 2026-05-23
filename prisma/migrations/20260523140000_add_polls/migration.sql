-- AlterEnum: add audit actions
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'POLL_CREATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'POLL_CLOSED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'VOTE_CAST';

-- CreateEnum
CREATE TYPE "VoteOption" AS ENUM ('FAVOR', 'CONTRA', 'ABSTENCION');

-- CreateEnum
CREATE TYPE "PollStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateTable Poll
CREATE TABLE "Poll" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "description" TEXT,
    "status" "PollStatus" NOT NULL DEFAULT 'OPEN',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Poll_pkey" PRIMARY KEY ("id")
);

-- CreateTable Vote
CREATE TABLE "Vote" (
    "id" TEXT NOT NULL,
    "pollId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "option" "VoteOption" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Vote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Poll_meetingId_idx" ON "Poll"("meetingId");
CREATE UNIQUE INDEX "Vote_pollId_userId_key" ON "Vote"("pollId", "userId");
CREATE INDEX "Vote_pollId_idx" ON "Vote"("pollId");

-- AddForeignKey
ALTER TABLE "Poll" ADD CONSTRAINT "Poll_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Poll" ADD CONSTRAINT "Poll_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON UPDATE CASCADE;
ALTER TABLE "Vote" ADD CONSTRAINT "Vote_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "Poll"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Vote" ADD CONSTRAINT "Vote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON UPDATE CASCADE;
