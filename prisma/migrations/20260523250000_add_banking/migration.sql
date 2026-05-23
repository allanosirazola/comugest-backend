CREATE TABLE "BankAccount" (
  "id" TEXT NOT NULL,
  "communityId" TEXT NOT NULL,
  "institutionName" TEXT NOT NULL,
  "iban" TEXT,
  "connectionId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "accessToken" TEXT,
  "accessExpiry" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BankAccount_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "BankTransaction" (
  "id" TEXT NOT NULL,
  "bankAccountId" TEXT NOT NULL,
  "transactionDate" TIMESTAMP(3) NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "description" TEXT NOT NULL,
  "reference" TEXT,
  "matchedItemId" TEXT,
  "reconciledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BankTransaction_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "BankAccount_communityId_idx" ON "BankAccount"("communityId");
CREATE INDEX "BankTransaction_bankAccountId_transactionDate_idx" ON "BankTransaction"("bankAccountId", "transactionDate");
ALTER TABLE "BankAccount" ADD CONSTRAINT "BankAccount_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
