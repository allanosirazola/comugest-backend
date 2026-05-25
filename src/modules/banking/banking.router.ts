import { Router } from 'express';
import { authenticate, requireRole } from '../../middleware/auth.middleware';
import { asyncHandler } from '../../utils/asyncHandler';
import * as ctrl from './banking.controller';

const router = Router({ mergeParams: true });
router.use(authenticate);

// Bank accounts
router.get('/', requireRole('ADMIN_FINCAS', 'SUPPORT'), asyncHandler(ctrl.listBankAccounts));
router.post('/', requireRole('ADMIN_FINCAS', 'SUPPORT'), asyncHandler(ctrl.addBankAccount));

// Transactions under a bank account
router.get('/:bankAccountId/transactions', requireRole('ADMIN_FINCAS', 'SUPPORT'), asyncHandler(ctrl.listTransactions));

// Reconcile a transaction
router.patch('/:bankAccountId/transactions/:transactionId/reconcile', requireRole('ADMIN_FINCAS', 'SUPPORT'), asyncHandler(ctrl.reconcileTransaction));

export default router;
