import type { Request, Response } from 'express';
import { z } from 'zod';
import { UnauthorizedError } from '../../utils/errors';
import * as bankingService from './banking.service';

function requireUser(req: Request): { id: string; role: 'SUPPORT' | 'ADMIN_FINCAS' | 'VECINO' } {
  if (!req.user) throw new UnauthorizedError();
  return req.user;
}

const communityIdSchema = z.object({ communityId: z.string().cuid() });

export async function listBankAccounts(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { communityId } = communityIdSchema.parse(req.params);
  const accounts = await bankingService.listBankAccounts(user.id, user.role, communityId);
  res.json({ accounts });
}

export async function addBankAccount(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { communityId } = communityIdSchema.parse(req.params);
  const input = z.object({
    institutionName: z.string().min(1),
    iban: z.string().optional(),
  }).parse(req.body);
  const account = await bankingService.addBankAccount(user.id, user.role, communityId, input);
  res.status(201).json({ account });
}

export async function listTransactions(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { communityId, bankAccountId } = z.object({
    communityId: z.string().cuid(),
    bankAccountId: z.string().cuid(),
  }).parse(req.params);
  const transactions = await bankingService.listTransactions(user.id, user.role, communityId, bankAccountId);
  res.json({ transactions });
}

export async function reconcileTransaction(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const { communityId, transactionId } = z.object({
    communityId: z.string().cuid(),
    transactionId: z.string().cuid(),
  }).parse(req.params);
  const { invoiceItemId } = z.object({ invoiceItemId: z.string().cuid() }).parse(req.body);
  const transaction = await bankingService.reconcileTransaction(user.id, user.role, communityId, transactionId, invoiceItemId);
  res.json({ transaction });
}
