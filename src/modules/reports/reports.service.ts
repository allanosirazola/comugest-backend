import PDFDocument from 'pdfkit';
import type { Response } from 'express';
import { prisma } from '../../config/prisma';

function setupDoc(res: Response, filename: string): InstanceType<typeof PDFDocument> {
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  doc.pipe(res);
  return doc;
}

function header(doc: InstanceType<typeof PDFDocument>, title: string, subtitle: string) {
  doc.fontSize(20).font('Helvetica-Bold').text(title, { align: 'left' });
  doc.fontSize(10).font('Helvetica').fillColor('#666').text(subtitle);
  doc.fillColor('#000').moveDown(1);
}

export async function generateMorososReport(communityId: string, res: Response) {
  const community = await prisma.community.findUniqueOrThrow({
    where: { id: communityId },
    select: { name: true, address: true },
  });

  // Get all invoice items with payments, find unpaid ones
  const invoices = await prisma.invoice.findMany({
    where: { communityId, cancelledAt: null },
    include: {
      items: { include: { payments: true, unit: { select: { label: true, type: true } } } },
    },
  });

  const now = new Date();
  type MorosoRow = { unit: string; concept: string; amount: number; paid: number; owed: number; daysOverdue: number };
  const rows: MorosoRow[] = [];

  for (const inv of invoices) {
    for (const item of inv.items) {
      const paid = item.payments.reduce((s, p) => s + Number(p.amount), 0);
      const amount = Number(item.amount);
      const owed = amount - paid;
      if (owed <= 0.005) continue;
      const dueDate = inv.dueDate ? new Date(inv.dueDate) : null;
      const daysOverdue = dueDate && dueDate < now ? Math.floor((now.getTime() - dueDate.getTime()) / 86400000) : 0;
      rows.push({
        unit: `${item.unit?.type ?? ''} ${item.unit?.label ?? ''}`.trim(),
        concept: inv.concept,
        amount,
        paid,
        owed,
        daysOverdue,
      });
    }
  }

  const doc = setupDoc(res, `morosos-${community.name.replace(/\s+/g, '_')}.pdf`);
  header(doc, community.name, `Listado de morosos · ${now.toLocaleDateString('es-ES')}`);

  if (rows.length === 0) {
    doc.fontSize(12).text('No hay recibos pendientes de pago.');
  } else {
    const totalOwed = rows.reduce((s, r) => s + r.owed, 0);
    doc.fontSize(10).font('Helvetica-Bold')
      .text('Unidad', 40, doc.y, { width: 100, continued: true })
      .text('Concepto', { width: 160, continued: true })
      .text('Importe', { width: 70, align: 'right', continued: true })
      .text('Pagado', { width: 70, align: 'right', continued: true })
      .text('Pendiente', { width: 70, align: 'right', continued: true })
      .text('Días', { width: 50, align: 'right' });

    doc.moveTo(40, doc.y).lineTo(555, doc.y).stroke('#ccc');
    doc.font('Helvetica').fontSize(9);

    for (const row of rows) {
      doc.text(row.unit, 40, doc.y, { width: 100, continued: true })
        .text(row.concept, { width: 160, continued: true })
        .text(`${row.amount.toFixed(2)} €`, { width: 70, align: 'right', continued: true })
        .text(`${row.paid.toFixed(2)} €`, { width: 70, align: 'right', continued: true })
        .text(`${row.owed.toFixed(2)} €`, { width: 70, align: 'right', continued: true })
        .text(row.daysOverdue > 0 ? `${row.daysOverdue}d` : '—', { width: 50, align: 'right' });
    }

    doc.moveTo(40, doc.y).lineTo(555, doc.y).stroke('#ccc');
    doc.moveDown(0.5).font('Helvetica-Bold').fontSize(10)
      .text(`Total pendiente: ${totalOwed.toFixed(2)} €`, { align: 'right' });
  }

  doc.end();
}

export async function generateBudgetReport(communityId: string, res: Response) {
  const community = await prisma.community.findUniqueOrThrow({
    where: { id: communityId },
    select: { name: true },
  });

  const now = new Date();
  const year = now.getFullYear();

  const budgets = await prisma.budget.findMany({
    where: { communityId, year },
    include: { lines: true },
  });

  const expenses = await prisma.expense.findMany({
    where: {
      communityId,
      expenseDate: { gte: new Date(`${year}-01-01`), lte: new Date(`${year}-12-31`) },
    },
    select: { category: true, amount: true },
  });

  const expenseByCategory: Record<string, number> = {};
  for (const e of expenses) {
    expenseByCategory[e.category] = (expenseByCategory[e.category] ?? 0) + Number(e.amount);
  }

  const doc = setupDoc(res, `presupuesto-${year}-${community.name.replace(/\s+/g, '_')}.pdf`);
  header(doc, community.name, `Presupuesto vs Real ${year} · ${now.toLocaleDateString('es-ES')}`);

  if (budgets.length === 0) {
    doc.fontSize(12).text(`No hay presupuesto definido para ${year}.`);
  } else {
    doc.fontSize(10).font('Helvetica-Bold')
      .text('Categoría', 40, doc.y, { width: 200, continued: true })
      .text('Presupuestado', { width: 120, align: 'right', continued: true })
      .text('Real', { width: 100, align: 'right', continued: true })
      .text('Desviación', { width: 100, align: 'right' });

    doc.moveTo(40, doc.y).lineTo(555, doc.y).stroke('#ccc');
    doc.font('Helvetica').fontSize(9);

    let totalBudget = 0;
    let totalReal = 0;

    for (const budget of budgets) {
      for (const line of budget.lines) {
        const real = expenseByCategory[line.category] ?? 0;
        const deviation = real - Number(line.amount);
        totalBudget += Number(line.amount);
        totalReal += real;
        doc.text(line.category, 40, doc.y, { width: 200, continued: true })
          .text(`${Number(line.amount).toFixed(2)} €`, { width: 120, align: 'right', continued: true })
          .text(`${real.toFixed(2)} €`, { width: 100, align: 'right', continued: true })
          .fillColor(deviation > 0 ? '#c0392b' : '#27ae60')
          .text(`${deviation >= 0 ? '+' : ''}${deviation.toFixed(2)} €`, { width: 100, align: 'right' })
          .fillColor('#000');
      }
    }

    doc.moveTo(40, doc.y).lineTo(555, doc.y).stroke('#ccc');
    const totalDev = totalReal - totalBudget;
    doc.moveDown(0.5).font('Helvetica-Bold').fontSize(10)
      .text('TOTAL', 40, doc.y, { width: 200, continued: true })
      .text(`${totalBudget.toFixed(2)} €`, { width: 120, align: 'right', continued: true })
      .text(`${totalReal.toFixed(2)} €`, { width: 100, align: 'right', continued: true })
      .fillColor(totalDev > 0 ? '#c0392b' : '#27ae60')
      .text(`${totalDev >= 0 ? '+' : ''}${totalDev.toFixed(2)} €`, { width: 100, align: 'right' })
      .fillColor('#000');
  }

  doc.end();
}

export async function generatePaymentsReport(communityId: string, from: Date | undefined, to: Date | undefined, res: Response) {
  const community = await prisma.community.findUniqueOrThrow({
    where: { id: communityId },
    select: { name: true },
  });

  const payments = await prisma.payment.findMany({
    where: {
      invoiceItem: { invoice: { communityId } },
      ...(from || to ? { paidAt: { ...(from && { gte: from }), ...(to && { lte: to }) } } : {}),
    },
    include: {
      invoiceItem: {
        include: {
          invoice: { select: { concept: true } },
          unit: { select: { label: true, type: true } },
        },
      },
    },
    orderBy: { paidAt: 'desc' },
  });

  const now = new Date();
  const doc = setupDoc(res, `pagos-${community.name.replace(/\s+/g, '_')}.pdf`);
  const rangeLabel = from || to
    ? `${from?.toLocaleDateString('es-ES') ?? '—'} → ${to?.toLocaleDateString('es-ES') ?? 'hoy'}`
    : 'Todo el histórico';
  header(doc, community.name, `Histórico de pagos · ${rangeLabel} · ${now.toLocaleDateString('es-ES')}`);

  if (payments.length === 0) {
    doc.fontSize(12).text('No hay pagos en el período seleccionado.');
  } else {
    const total = payments.reduce((s, p) => s + Number(p.amount), 0);

    doc.fontSize(10).font('Helvetica-Bold')
      .text('Fecha', 40, doc.y, { width: 80, continued: true })
      .text('Unidad', { width: 100, continued: true })
      .text('Concepto', { width: 180, continued: true })
      .text('Método', { width: 80, continued: true })
      .text('Importe', { width: 70, align: 'right' });

    doc.moveTo(40, doc.y).lineTo(555, doc.y).stroke('#ccc');
    doc.font('Helvetica').fontSize(9);

    for (const p of payments) {
      const unit = p.invoiceItem.unit;
      doc.text(new Date(p.paidAt).toLocaleDateString('es-ES'), 40, doc.y, { width: 80, continued: true })
        .text(unit ? `${unit.type} ${unit.label}` : '—', { width: 100, continued: true })
        .text(p.invoiceItem.invoice.concept, { width: 180, continued: true })
        .text(p.method ?? '—', { width: 80, continued: true })
        .text(`${Number(p.amount).toFixed(2)} €`, { width: 70, align: 'right' });
    }

    doc.moveTo(40, doc.y).lineTo(555, doc.y).stroke('#ccc');
    doc.moveDown(0.5).font('Helvetica-Bold').fontSize(10)
      .text(`Total cobrado: ${total.toFixed(2)} €`, { align: 'right' });
  }

  doc.end();
}
