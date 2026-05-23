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
import { communityAreasRouter, areaActionsRouter, meReservationsRouter } from './modules/common-areas/common-areas.router';
import { communityMeetingsRouter, meetingsRouter, meMeetingsRouter } from './modules/meetings/meetings.router';
import { meProfileRouter } from './modules/me/me.router';
import { communityRecurringRouter } from './modules/recurring-invoices/recurring-invoices.router';
import { communityDocumentsRouter } from './modules/documents/documents.router';
import { communityReportsRouter } from './modules/reports/reports.router';
import { meDocumentsRouter } from './modules/me/me.router';
import { communityCoAdminsRouter } from './modules/co-admins/co-admins.router';
import { meetingPollsRouter } from './modules/polls/polls.router';
import { communityMeterReadingsRouter } from './modules/meter-readings/meter-readings.router';
import { communityCalendarRouter, meCalendarRouter } from './modules/calendar/calendar.router';
import { communitySupplierRouter } from './modules/suppliers/suppliers.router';
import { billingRouter } from './modules/billing/billing.router';
import { pushRouter } from './modules/push/push.router';
import notificationsRouter from './modules/notifications/notifications.router';
import { startScheduler } from './modules/scheduler/scheduler';

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

  // Raw body for Stripe webhook — must be before express.json()
  app.use('/api/v1/billing/webhook', express.raw({ type: 'application/json' }));

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
  app.use('/api/v1/communities/:communityId/recurring', communityRecurringRouter);
  app.use('/api/v1/communities/:communityId/documents', communityDocumentsRouter);
  app.use('/api/v1/communities/:communityId/reports', communityReportsRouter);
  app.use('/api/v1/communities/:communityId/co-admins', communityCoAdminsRouter);
  app.use('/api/v1/communities/:communityId/meter-readings', communityMeterReadingsRouter);
  app.use('/api/v1/communities/:communityId/suppliers', communitySupplierRouter);
  app.use('/api/v1/announcements', announcementsRoutes);
  app.use('/api/v1/expenses', expensesRoutes);
  app.use('/api/v1/messages', messagesRoutes);
  app.use('/api/v1/tickets', ticketsRoutes);
  app.use('/api/v1/procedures', proceduresRoutes);
  app.use('/api/v1/support', supportRouter);
  app.use('/api/v1/admin', adminRouter);
  app.use('/api/v1/admin/audit', auditRouter);
  app.use('/api/v1/communities/:communityId/areas', communityAreasRouter);
  app.use('/api/v1/areas', areaActionsRouter);
  app.use('/api/v1/communities/:communityId/meetings', communityMeetingsRouter);
  app.use('/api/v1/meetings', meetingsRouter);
  app.use('/api/v1/meetings/:meetingId/polls', meetingPollsRouter);
  // Vistas del propio vecino bajo /api/v1/me
  app.use('/api/v1/me', meInvoicesRouter);
  app.use('/api/v1/me', meAnnouncementsRouter);
  app.use('/api/v1/me', meCommunitiesRouter);
  app.use('/api/v1/me', meExpensesRouter);
  app.use('/api/v1/me', meTicketsRouter);
  app.use('/api/v1/me', meProceduresRouter);
  app.use('/api/v1/me', meProfileRouter);
  app.use('/api/v1/me', meReservationsRouter);
  app.use('/api/v1/me', meMeetingsRouter);
  app.use('/api/v1/me', meDocumentsRouter);
  app.use('/api/v1/communities/:communityId/calendar', communityCalendarRouter);
  app.use('/api/v1/me', meCalendarRouter);
  app.use('/api/v1/billing', billingRouter);
  app.use('/api/v1/push', pushRouter);
  app.use('/api/v1/me/notifications', notificationsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  startScheduler();

  return app;
}
