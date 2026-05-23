import { prisma } from '../../config/prisma';
import type { UserRole } from '@prisma/client';
import { assertCommunityAccess } from '../../utils/authz';

export async function listBankAccounts(userId: string, userRole: UserRole, communityId: string) {
  await assertCommunityAccess(userId, userRole, communityId);
  return prisma.bankAccount.findMany({
    where: { communityId },
    include: { _count: { select: { transactions: true } } },
    orderBy: { createdAt: 'desc' },
  });
}

export async function listTransactions(userId: string, userRole: UserRole, communityId: string, bankAccountId: string) {
  await assertCommunityAccess(userId, userRole, communityId);
  return prisma.bankTransaction.findMany({
    where: { bankAccountId, bankAccount: { communityId } },
    orderBy: { transactionDate: 'desc' },
    take: 200,
  });
}

export async function addBankAccount(userId: string, userRole: UserRole, communityId: string, input: { institutionName: string; iban?: string }) {
  await assertCommunityAccess(userId, userRole, communityId);
  return prisma.bankAccount.create({
    data: { communityId, institutionName: input.institutionName, iban: input.iban, status: 'PENDING' },
  });
}

export async function reconcileTransaction(userId: string, userRole: UserRole, communityId: string, transactionId: string, invoiceItemId: string) {
  await assertCommunityAccess(userId, userRole, communityId);
  return prisma.bankTransaction.update({
    where: { id: transactionId },
    data: { matchedItemId: invoiceItemId, reconciledAt: new Date() },
  });
}
