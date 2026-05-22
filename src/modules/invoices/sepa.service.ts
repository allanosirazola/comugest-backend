import { prisma } from '../../config/prisma';
import { assertCommunityAccess } from '../../utils/authz';
import type { UserRole } from '@prisma/client';

interface SepaParams {
  communityId: string;
  invoiceId: string;
  creditorName: string;      // community name or admin name
  creditorIban: string;      // e.g. "ES7921000813610123456789"
  creditorBic: string;       // e.g. "CAIXESBBXXX"
}

export async function generateSepaXml(
  userId: string,
  userRole: UserRole,
  params: SepaParams
): Promise<string> {
  await assertCommunityAccess(userId, userRole, params.communityId);

  const invoice = await prisma.invoice.findUniqueOrThrow({
    where: { id: params.invoiceId },
    include: {
      items: {
        where: { payments: { none: {} } }, // unpaid items only
        include: {
          unit: {
            include: {
              ownerships: {
                where: { endDate: null },
                take: 1,
                include: { owner: true },
              },
            },
          },
          payments: { select: { amount: true } },
        },
      },
    },
  });

  const now = new Date();
  const msgId = `COMU-${params.invoiceId.slice(0, 8)}-${now.getTime()}`;
  const creationDateTime = now.toISOString().replace(/\.\d+Z$/, 'Z');

  // Build transaction entries
  const transactions = invoice.items
    .map((item) => {
      const paid = item.payments.reduce((s, p) => s + Number(p.amount), 0);
      const pending = Number(item.amount) - paid;
      if (pending <= 0.005) return null;

      const owner = item.unit.ownerships[0]?.owner;
      if (!owner) return null;

      const debtorName = `${owner.firstName} ${owner.lastName}`.trim();
      const amount = pending.toFixed(2);
      const endToEndId = `${params.invoiceId.slice(0, 8)}-${item.id.slice(0, 8)}`;

      return `
      <CdtTrfTxInf>
        <PmtId><EndToEndId>${endToEndId}</EndToEndId></PmtId>
        <Amt><InstdAmt Ccy="EUR">${amount}</InstdAmt></Amt>
        <Cdtr><Nm>${escapeXml(params.creditorName)}</Nm></Cdtr>
        <CdtrAcct><Id><IBAN>${escapeXml(params.creditorIban)}</IBAN></Id></CdtrAcct>
        <CdtrAgt><FinInstnId><BIC>${escapeXml(params.creditorBic)}</BIC></FinInstnId></CdtrAgt>
        <Dbtr><Nm>${escapeXml(debtorName)}</Nm></Dbtr>
        <RmtInf><Ustrd>${escapeXml(invoice.concept)} - ${escapeXml(item.unit.label)}</Ustrd></RmtInf>
      </CdtTrfTxInf>`;
    })
    .filter(Boolean);

  if (transactions.length === 0) {
    throw new Error('No hay importes pendientes para exportar');
  }

  const totalAmount = invoice.items
    .reduce((sum, item) => {
      const paid = item.payments.reduce((s, p) => s + Number(p.amount), 0);
      return sum + Math.max(0, Number(item.amount) - paid);
    }, 0)
    .toFixed(2);

  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03">
  <CstmrCdtTrfInitn>
    <GrpHdr>
      <MsgId>${msgId}</MsgId>
      <CreDtTm>${creationDateTime}</CreDtTm>
      <NbOfTxs>${transactions.length}</NbOfTxs>
      <CtrlSum>${totalAmount}</CtrlSum>
      <InitgPty><Nm>${escapeXml(params.creditorName)}</Nm></InitgPty>
    </GrpHdr>
    <PmtInf>
      <PmtInfId>${msgId}-1</PmtInfId>
      <PmtMtd>TRF</PmtMtd>
      <NbOfTxs>${transactions.length}</NbOfTxs>
      <CtrlSum>${totalAmount}</CtrlSum>
      <PmtTpInf><SvcLvl><Cd>SEPA</Cd></SvcLvl></PmtTpInf>
      <ReqdExctnDt>${now.toISOString().split('T')[0]}</ReqdExctnDt>
      <Dbtr><Nm>${escapeXml(params.creditorName)}</Nm></Dbtr>
      <DbtrAcct><Id><IBAN>${escapeXml(params.creditorIban)}</IBAN></Id></DbtrAcct>
      <DbtrAgt><FinInstnId><BIC>${escapeXml(params.creditorBic)}</BIC></FinInstnId></DbtrAgt>
      ${transactions.join('')}
    </PmtInf>
  </CstmrCdtTrfInitn>
</Document>`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
