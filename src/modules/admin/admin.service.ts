import { prisma } from '../../config/prisma';
import type { UserRole } from '@prisma/client';
import { getManagedCommunityIds } from '../../utils/authz';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface AdminKpis {
  communities: number;
  units: number;
  residents: number;
  invoices: {
    totalPending: number;
    overdueCount: number;
  };
  expenses: {
    currentYearTotal: number;
  };
  procedures: {
    open: number;
  };
  tickets: {
    open: number;
  };
}

export async function getAdminKpis(userId: string, userRole: UserRole): Promise<AdminKpis> {
  const isSupport = userRole === 'SUPPORT';

  // Resolve scope: SUPPORT sees everything, ADMIN_FINCAS sees own communities
  const communityIds = isSupport ? null : await getManagedCommunityIds(userId);

  const communityFilter = communityIds === null ? {} : { id: { in: communityIds } };
  const communityIdFilter = communityIds === null ? {} : { communityId: { in: communityIds } };

  const now = new Date();
  const yearStart = new Date(now.getFullYear(), 0, 1);

  const [
    communityCount,
    unitCount,
    residentCount,
    invoiceItems,
    expenseAggregate,
    procedureCount,
    ticketCount,
  ] = await Promise.all([
    // Count of communities in scope
    prisma.community.count({ where: communityFilter }),

    // Count of units in those communities
    prisma.unit.count({ where: communityIdFilter }),

    // Count of unique active residents (owners with no endDate) in those communities
    prisma.ownership.count({
      where: {
        endDate: null,
        ...(communityIds !== null
          ? { unit: { communityId: { in: communityIds } } }
          : {}),
      },
    }),

    // Invoice items to compute pending/overdue totals
    prisma.invoiceItem.findMany({
      where: {
        invoice: {
          cancelledAt: null,
          ...(communityIds !== null ? { communityId: { in: communityIds } } : {}),
        },
      },
      select: {
        amount: true,
        invoice: { select: { dueDate: true } },
        payments: { select: { amount: true } },
      },
    }),

    // Sum of expenses for current year
    prisma.expense.aggregate({
      where: {
        ...communityIdFilter,
        expenseDate: { gte: yearStart },
      },
      _sum: { amount: true },
    }),

    // Open procedures (not COMPLETED or REJECTED)
    prisma.procedure.count({
      where: {
        ...communityIdFilter,
        status: { notIn: ['COMPLETED', 'REJECTED'] },
      },
    }),

    // Open tickets — platform-wide for SUPPORT, or tickets reported by residents
    // of managed communities for ADMIN_FINCAS
    isSupport
      ? prisma.ticket.count({ where: { status: { in: ['OPEN', 'IN_PROGRESS'] } } })
      : prisma.ticket.count({
          where: {
            status: { in: ['OPEN', 'IN_PROGRESS'] },
            reporter: {
              ownedUnits: {
                some: {
                  endDate: null,
                  unit: { communityId: { in: communityIds! } },
                },
              },
            },
          },
        }),
  ]);

  // Compute pending amount and overdue count from invoice items
  let totalPending = 0;
  let overdueCount = 0;
  for (const item of invoiceItems) {
    const paid = item.payments.reduce((acc, p) => acc + Number(p.amount), 0);
    const remaining = Number(item.amount) - paid;
    if (remaining > 0.005) {
      totalPending += remaining;
      if (item.invoice.dueDate < now) {
        overdueCount += 1;
      }
    }
  }

  return {
    communities: communityCount,
    units: unitCount,
    residents: residentCount,
    invoices: {
      totalPending: round2(totalPending),
      overdueCount,
    },
    expenses: {
      currentYearTotal: round2(Number(expenseAggregate._sum.amount ?? 0)),
    },
    procedures: {
      open: procedureCount,
    },
    tickets: {
      open: ticketCount,
    },
  };
}
