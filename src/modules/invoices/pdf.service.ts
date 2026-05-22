import PDFDocument from 'pdfkit';
import { prisma } from '../../config/prisma';
import { assertCommunityAccess } from '../../utils/authz';
import type { UserRole } from '@prisma/client';

export async function generateInvoicePdf(
  userId: string,
  userRole: UserRole,
  communityId: string,
  invoiceId: string
): Promise<Buffer> {
  await assertCommunityAccess(userId, userRole, communityId);

  const invoice = await prisma.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    include: {
      community: { select: { name: true, address: true, city: true } },
      items: {
        include: {
          unit: { select: { label: true } },
          payments: { select: { amount: true } },
        },
        orderBy: { unit: { label: 'asc' } },
      },
    },
  });

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header
    doc.fontSize(20).font('Helvetica-Bold').text('Comugest', 50, 50);
    doc.fontSize(12).font('Helvetica').text(invoice.community.name, 50, 78);
    doc.text(invoice.community.address ?? '', 50, 94);

    doc.fontSize(16).font('Helvetica-Bold').text(invoice.concept, 50, 130);
    doc.fontSize(10).font('Helvetica');
    doc.text(`Emisión: ${invoice.issueDate?.toISOString().split('T')[0] ?? '—'}`, 50, 155);
    doc.text(`Vencimiento: ${invoice.dueDate.toISOString().split('T')[0]}`, 50, 170);

    // Table header
    const tableTop = 210;
    doc.font('Helvetica-Bold').fontSize(10);
    doc.text('Unidad', 50, tableTop);
    doc.text('Importe', 200, tableTop, { width: 80, align: 'right' });
    doc.text('Pagado', 290, tableTop, { width: 80, align: 'right' });
    doc.text('Pendiente', 380, tableTop, { width: 80, align: 'right' });

    doc.moveTo(50, tableTop + 15).lineTo(545, tableTop + 15).stroke();

    // Table rows
    let y = tableTop + 25;
    let totalAmount = 0;
    let totalPaid = 0;

    for (const item of invoice.items) {
      const amount = Number(item.amount);
      const paid = item.payments.reduce((s, p) => s + Number(p.amount), 0);
      const pending = Math.max(0, amount - paid);
      totalAmount += amount;
      totalPaid += paid;

      doc.font('Helvetica').fontSize(10);
      doc.text(item.unit.label, 50, y);
      doc.text(`${amount.toFixed(2)} €`, 200, y, { width: 80, align: 'right' });
      doc.text(`${paid.toFixed(2)} €`, 290, y, { width: 80, align: 'right' });
      doc.text(`${pending.toFixed(2)} €`, 380, y, { width: 80, align: 'right' });
      y += 20;
    }

    // Total row
    doc.moveTo(50, y).lineTo(545, y).stroke();
    y += 10;
    doc.font('Helvetica-Bold').fontSize(10);
    doc.text('TOTAL', 50, y);
    doc.text(`${totalAmount.toFixed(2)} €`, 200, y, { width: 80, align: 'right' });
    doc.text(`${totalPaid.toFixed(2)} €`, 290, y, { width: 80, align: 'right' });
    doc.text(`${(totalAmount - totalPaid).toFixed(2)} €`, 380, y, { width: 80, align: 'right' });

    doc.end();
  });
}
