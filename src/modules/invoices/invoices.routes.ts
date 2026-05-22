import { Router } from 'express';
import * as controller from './invoices.controller';
import { asyncHandler } from '../../utils/asyncHandler';
import { authenticate, requireRole } from '../../middleware/auth.middleware';

// ─── Bajo /communities/:communityId/invoices ─────────────────
export const communityInvoicesRouter: Router = Router({ mergeParams: true });
communityInvoicesRouter.use(authenticate);
communityInvoicesRouter.use(requireRole('ADMIN_FINCAS', 'SUPPORT'));
communityInvoicesRouter.get('/', asyncHandler(controller.listByCommunity));
communityInvoicesRouter.post('/', asyncHandler(controller.create));
communityInvoicesRouter.get('/overdue', asyncHandler(controller.overdue));
communityInvoicesRouter.post('/:invoiceId/sepa', asyncHandler(controller.exportSepa));
communityInvoicesRouter.get('/:invoiceId/pdf', asyncHandler(controller.exportPdf));

// ─── Bajo /invoices ─────────────────────────────────────────
const invoicesRouter = Router();
invoicesRouter.use(authenticate);
invoicesRouter.get('/:id', requireRole('ADMIN_FINCAS', 'SUPPORT'), asyncHandler(controller.getOne));
invoicesRouter.delete('/:id', requireRole('ADMIN_FINCAS', 'SUPPORT'), asyncHandler(controller.cancel));

// Pagos
invoicesRouter.post(
  '/items/:itemId/payments',
  requireRole('ADMIN_FINCAS', 'SUPPORT'),
  asyncHandler(controller.recordPayment)
);
invoicesRouter.delete(
  '/payments/:paymentId',
  requireRole('ADMIN_FINCAS', 'SUPPORT'),
  asyncHandler(controller.deletePayment)
);

// ─── Vecino ─────────────────────────────────────────────────
export const meInvoicesRouter: Router = Router();
meInvoicesRouter.use(authenticate);
meInvoicesRouter.get('/invoice-items', asyncHandler(controller.myInvoiceItems));

export default invoicesRouter;
