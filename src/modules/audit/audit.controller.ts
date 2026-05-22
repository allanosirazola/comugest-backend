import type { Request, Response } from 'express';
import { prisma } from '../../config/prisma';
import { UnauthorizedError } from '../../utils/errors';
import type { AuditAction, Prisma } from '@prisma/client';

export async function list(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new UnauthorizedError();

  const { communityId, action, limit = '50', cursor } = req.query as Record<string, string>;

  const take = Math.min(Number(limit) || 50, 200);

  const where: Prisma.AuditLogWhereInput = {};
  if (communityId) where.communityId = communityId;
  if (action) where.action = action as AuditAction;

  // ADMIN_FINCAS can only see their own communities
  if (req.user.role === 'ADMIN_FINCAS') {
    const managed = await prisma.communityAdmin.findMany({
      where: { userId: req.user.id },
      select: { communityId: true },
    });
    const ids = managed.map((m) => m.communityId);
    where.communityId = communityId && ids.includes(communityId)
      ? communityId
      : { in: ids };
  }

  const logs = await prisma.auditLog.findMany({
    where,
    take,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    orderBy: { createdAt: 'desc' },
    include: {
      actor: { select: { id: true, firstName: true, lastName: true, role: true } },
    },
  });

  const nextCursor = logs.length === take ? logs[logs.length - 1].id : null;
  res.json({ logs, nextCursor });
}
