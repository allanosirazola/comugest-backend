import { prisma } from '../../config/prisma';
import { Prisma, type UserRole } from '@prisma/client';
import { ForbiddenError, NotFoundError, ValidationError } from '../../utils/errors';
import type {
  CreateTicketInput,
  UpdateTicketInput,
  AddCommentInput,
  ListTicketsQuery,
} from './tickets.schemas';

function isSupport(role: UserRole): boolean {
  return role === 'SUPPORT';
}

// ─── Crear (cualquier usuario autenticado) ──────────────────

export async function createTicket(userId: string, input: CreateTicketInput) {
  return prisma.ticket.create({
    data: {
      reporterId: userId,
      category: input.category,
      subject: input.subject,
      description: input.description,
      pageUrl: input.pageUrl ?? null,
      userAgent: input.userAgent ?? null,
    },
  });
}

// ─── Listar mis tickets (reporter) ──────────────────────────

export async function listMyTickets(userId: string) {
  return prisma.ticket.findMany({
    where: { reporterId: userId },
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { comments: true } } },
  });
}

// ─── Listar todos (SUPPORT) ─────────────────────────────────

export async function listAllTickets(userRole: UserRole, filter: ListTicketsQuery) {
  if (!isSupport(userRole)) throw new ForbiddenError('Solo el equipo de soporte puede ver todos los tickets');

  const where: Prisma.TicketWhereInput = {};
  if (filter.status) where.status = filter.status;
  if (filter.category) where.category = filter.category;
  if (filter.priority) where.priority = filter.priority;

  return prisma.ticket.findMany({
    where,
    orderBy: [{ status: 'asc' }, { priority: 'desc' }, { createdAt: 'desc' }],
    include: {
      reporter: { select: { id: true, firstName: true, lastName: true, email: true, role: true } },
      assignedTo: { select: { id: true, firstName: true, lastName: true } },
      _count: { select: { comments: true } },
    },
  });
}

// ─── Detalle ────────────────────────────────────────────────

export async function getTicket(userId: string, userRole: UserRole, ticketId: string) {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: {
      reporter: { select: { id: true, firstName: true, lastName: true, email: true, role: true } },
      assignedTo: { select: { id: true, firstName: true, lastName: true } },
      comments: {
        orderBy: { createdAt: 'asc' },
        include: { author: { select: { id: true, firstName: true, lastName: true, role: true } } },
      },
    },
  });
  if (!ticket) throw new NotFoundError('Ticket no encontrado');

  const support = isSupport(userRole);
  if (!support && ticket.reporterId !== userId) {
    throw new ForbiddenError('No tienes acceso a este ticket');
  }

  // El reporter no ve las notas internas
  const comments = support ? ticket.comments : ticket.comments.filter((c) => !c.internal);

  return { ...ticket, comments };
}

// ─── Actualizar (SUPPORT) ───────────────────────────────────

export async function updateTicket(userRole: UserRole, ticketId: string, input: UpdateTicketInput) {
  if (!isSupport(userRole)) throw new ForbiddenError('Solo soporte puede modificar tickets');

  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
  if (!ticket) throw new NotFoundError('Ticket no encontrado');

  // Si se marca como RESOLVED/CLOSED por primera vez, fijar resolvedAt
  const resolving = (input.status === 'RESOLVED' || input.status === 'CLOSED') && !ticket.resolvedAt;

  return prisma.ticket.update({
    where: { id: ticketId },
    data: {
      status: input.status,
      priority: input.priority,
      assignedToId: input.assignedToId,
      resolvedAt: resolving ? new Date() : input.status === 'OPEN' || input.status === 'IN_PROGRESS' ? null : undefined,
    },
  });
}

// ─── Comentarios ────────────────────────────────────────────

export async function addComment(userId: string, userRole: UserRole, ticketId: string, input: AddCommentInput) {
  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
  if (!ticket) throw new NotFoundError('Ticket no encontrado');

  const support = isSupport(userRole);
  if (!support && ticket.reporterId !== userId) {
    throw new ForbiddenError('No puedes comentar en este ticket');
  }
  // Solo SUPPORT puede marcar una nota como interna
  if (input.internal && !support) {
    throw new ValidationError('No puedes crear notas internas');
  }

  return prisma.ticketComment.create({
    data: {
      ticketId,
      authorId: userId,
      body: input.body,
      internal: support ? input.internal : false,
    },
    include: { author: { select: { id: true, firstName: true, lastName: true, role: true } } },
  });
}

// ─── Métricas (SUPPORT) ─────────────────────────────────────

export async function getMetrics(userRole: UserRole) {
  if (!isSupport(userRole)) throw new ForbiddenError('Solo soporte puede ver métricas');

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [
    usersByRole,
    totalCommunities,
    totalUnits,
    totalInvoices,
    ticketsByStatus,
    ticketsByCategory,
    newUsers30d,
    recentTickets,
  ] = await Promise.all([
    prisma.user.groupBy({ by: ['role'], _count: true }),
    prisma.community.count(),
    prisma.unit.count(),
    prisma.invoice.count({ where: { cancelledAt: null } }),
    prisma.ticket.groupBy({ by: ['status'], _count: true }),
    prisma.ticket.groupBy({ by: ['category'], _count: true }),
    prisma.user.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
    prisma.ticket.findMany({
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { id: true, subject: true, status: true, priority: true, createdAt: true },
    }),
  ]);

  const roleCount = (r: string): number => usersByRole.find((u) => u.role === r)?._count ?? 0;
  const statusCount = (s: string): number => ticketsByStatus.find((t) => t.status === s)?._count ?? 0;

  return {
    users: {
      total: usersByRole.reduce((acc, u) => acc + u._count, 0),
      admins: roleCount('ADMIN_FINCAS'),
      residents: roleCount('VECINO'),
      support: roleCount('SUPPORT'),
      newLast30Days: newUsers30d,
    },
    platform: {
      communities: totalCommunities,
      units: totalUnits,
      activeInvoices: totalInvoices,
    },
    tickets: {
      open: statusCount('OPEN'),
      inProgress: statusCount('IN_PROGRESS'),
      resolved: statusCount('RESOLVED'),
      closed: statusCount('CLOSED'),
      byCategory: ticketsByCategory.map((c) => ({ category: c.category, count: c._count })),
    },
    recentTickets,
  };
}
