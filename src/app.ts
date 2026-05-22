import express, { type Express, type Request, type Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { env } from './config/env';
import { errorHandler, notFoundHandler } from './middleware/error.middleware';
import authRoutes from './modules/auth/auth.routes';
import invitationsRoutes from './modules/invitations/invitations.routes';
import communitiesRoutes, { meCommunitiesRouter } from './modules/communities/communities.routes';
import unitsFlatRoutes, { nestedUnitsRouter } from './modules/units/units.routes';
import invoicesRoutes, { communityInvoicesRouter, meInvoicesRouter } from './modules/invoices/invoices.routes';
import announcementsRoutes, { communityAnnouncementsRouter, meAnnouncementsRouter } from './modules/announcements/announcements.routes';
import messagesRoutes from './modules/messages/messages.routes';
import expensesRoutes, { communityExpensesRouter, meExpensesRouter } from './modules/expenses/expenses.routes';
import ticketsRoutes, { meTicketsRouter, supportRouter } from './modules/tickets/tickets.routes';
import proceduresRoutes, { meProceduresRouter, communityProceduresRouter } from './modules/procedures/procedures.routes';
import { communityBudgetsRouter } from './modules/budgets/budgets.router';
import { adminRouter } from './modules/admin/admin.router';
import { auditRouter } from './modules/audit/audit.router';

import './types/express';

export function createApp(): Express {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGIN.split(',').map((s) => s.trim()),
      credentials: true,
    })
  );

  app.use(
    rateLimit({
      windowMs: env.RATE_LIMIT_WINDOW_MS,
      max: env.RATE_LIMIT_MAX,
      standardHeaders: true,
      legacyHeaders: false,
    })
  );

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/invitations', invitationsRoutes);
  app.use('/api/v1/communities', communitiesRoutes);
  app.use('/api/v1/communities/:communityId/units', nestedUnitsRouter);
  app.use('/api/v1/communities/:communityId/invoices', communityInvoicesRouter);
  app.use('/api/v1/units', unitsFlatRoutes);
  app.use('/api/v1/invoices', invoicesRoutes);
  app.use('/api/v1/communities/:communityId/announcements', communityAnnouncementsRouter);
  app.use('/api/v1/communities/:communityId/expenses', communityExpensesRouter);
  app.use('/api/v1/communities/:communityId/procedures', communityProceduresRouter);
  app.use('/api/v1/communities/:communityId/budgets', communityBudgetsRouter);
  app.use('/api/v1/announcements', announcementsRoutes);
  app.use('/api/v1/expenses', expensesRoutes);
  app.use('/api/v1/messages', messagesRoutes);
  app.use('/api/v1/tickets', ticketsRoutes);
  app.use('/api/v1/procedures', proceduresRoutes);
  app.use('/api/v1/support', supportRouter);
  app.use('/api/v1/admin', adminRouter);
  app.use('/api/v1/admin/audit', auditRouter);
  // Vistas del propio vecino bajo /api/v1/me
  app.use('/api/v1/me', meInvoicesRouter);
  app.use('/api/v1/me', meAnnouncementsRouter);
  app.use('/api/v1/me', meCommunitiesRouter);
  app.use('/api/v1/me', meExpensesRouter);
  app.use('/api/v1/me', meTicketsRouter);
  app.use('/api/v1/me', meProceduresRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
