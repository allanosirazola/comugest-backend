import crypto from 'crypto';
import { prisma } from '../../config/prisma';
import { audit } from '../audit/audit.service';
import { ForbiddenError, NotFoundError, ValidationError, UnauthorizedError } from '../../utils/errors';
import { assertCommunityAccess } from '../../utils/authz';
import type { UserRole } from '@prisma/client';
import type { CreateMeetingInput, UpdateMeetingInput, UpdateAttendanceInput } from './meetings.schemas';
import type { Meeting } from '@prisma/client';
import { verifySync, NobleCryptoPlugin, ScureBase32Plugin } from 'otplib';
import { sendToCommunity } from '../push/push.service';
import { createNotificationsForCommunity } from '../notifications/notifications.service';

const totpPlugins = {
  crypto: new NobleCryptoPlugin(),
  encoding: new ScureBase32Plugin(),
};

export async function listMeetings(communityId: string) {
  return prisma.meeting.findMany({
    where: { communityId },
    orderBy: { scheduledAt: 'desc' },
    include: {
      _count: {
        select: {
          attendees: true,
        },
      },
    },
  });
}

export async function getMeeting(meetingId: string, _requesterId: string) {
  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    include: {
      attendees: {
        include: {
          user: {
            select: { id: true, firstName: true, lastName: true },
          },
        },
      },
    },
  });
  if (!meeting) throw new NotFoundError('Reunión no encontrada');
  return meeting;
}

export async function createMeeting(
  adminId: string,
  communityId: string,
  input: CreateMeetingInput
) {
  // Verify adminId manages communityId
  const link = await prisma.communityAdmin.findUnique({
    where: { communityId_userId: { communityId, userId: adminId } },
  });
  if (!link) throw new ForbiddenError('No gestionas esta comunidad');

  const meeting = await prisma.meeting.create({
    data: {
      communityId,
      organizedById: adminId,
      title: input.title,
      type: input.type,
      scheduledAt: input.scheduledAt,
      location: input.location ?? null,
      agenda: input.agenda ?? null,
    },
  });

  // Bulk-create attendee rows for all active occupants/owners of this community
  const occupancies = await prisma.occupancy.findMany({
    where: { unit: { communityId }, endDate: null },
    select: { occupantId: true },
    distinct: ['occupantId'],
  });

  const attendeeData = occupancies.map((o) => ({
    meetingId: meeting.id,
    userId: o.occupantId,
    status: 'PENDING' as const,
  }));

  if (attendeeData.length > 0) {
    await prisma.meetingAttendee.createMany({ data: attendeeData, skipDuplicates: true });
  }

  void audit({
    action: 'MEETING_CREATED',
    actorId: adminId,
    targetType: 'Meeting',
    targetId: meeting.id,
    communityId,
    meta: { title: meeting.title, type: meeting.type },
  });

  void sendToCommunity(communityId, {
    title: input.title,
    body: `Nueva junta convocada para el ${new Date(input.scheduledAt).toLocaleDateString('es-ES')}`,
    url: `/communities/${communityId}/meetings/${meeting.id}`,
  });
  void createNotificationsForCommunity(communityId, {
    title: input.title,
    body: `Nueva junta convocada para el ${new Date(input.scheduledAt).toLocaleDateString('es-ES')}`,
    url: `/communities/${communityId}/meetings/${meeting.id}`,
  });

  return meeting;
}

export async function updateMeeting(
  adminId: string,
  meetingId: string,
  input: UpdateMeetingInput
) {
  const existing = await prisma.meeting.findUnique({ where: { id: meetingId } });
  if (!existing) throw new NotFoundError('Reunión no encontrada');

  // Verify adminId manages the meeting's community
  const link = await prisma.communityAdmin.findUnique({
    where: { communityId_userId: { communityId: existing.communityId, userId: adminId } },
  });
  if (!link) throw new ForbiddenError('No gestionas esta comunidad');

  const meeting = await prisma.meeting.update({
    where: { id: meetingId },
    data: {
      ...(input.title !== undefined && { title: input.title }),
      ...(input.type !== undefined && { type: input.type }),
      ...(input.scheduledAt !== undefined && { scheduledAt: input.scheduledAt }),
      ...(input.location !== undefined && { location: input.location }),
      ...(input.agenda !== undefined && { agenda: input.agenda }),
      ...(input.status !== undefined && { status: input.status }),
      ...(input.minutes !== undefined && { minutes: input.minutes }),
      ...(input.minutesUrl !== undefined && { minutesUrl: input.minutesUrl }),
    },
  });

  void audit({
    action: 'MEETING_UPDATED',
    actorId: adminId,
    targetType: 'Meeting',
    targetId: meeting.id,
    communityId: existing.communityId,
    meta: { updatedFields: Object.keys(input) },
  });

  return meeting;
}

export async function listMyMeetings(userId: string) {
  return prisma.meeting.findMany({
    where: {
      attendees: { some: { userId } },
    },
    orderBy: { scheduledAt: 'desc' },
    include: {
      attendees: {
        where: { userId },
        select: { status: true },
      },
    },
  });
}

export async function updateAttendance(
  userId: string,
  meetingId: string,
  input: UpdateAttendanceInput
) {
  const attendee = await prisma.meetingAttendee.findUnique({
    where: { meetingId_userId: { meetingId, userId } },
  });
  if (!attendee) throw new NotFoundError('No estás registrado como asistente de esta reunión');

  if (input.status === 'DELEGATED' && (!input.proxy || input.proxy.trim().length === 0)) {
    throw new ValidationError('proxy es obligatorio cuando el estado es DELEGATED');
  }

  return prisma.meetingAttendee.update({
    where: { meetingId_userId: { meetingId, userId } },
    data: {
      status: input.status,
      proxy: input.proxy ?? null,
    },
  });
}

export async function saveMinutes(
  actorId: string,
  actorRole: UserRole,
  meetingId: string,
  minutes: string,
) {
  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    select: { id: true, communityId: true },
  });
  if (!meeting) throw new NotFoundError('Meeting not found');
  await assertCommunityAccess(actorId, actorRole, meeting.communityId);

  const updated = await prisma.meeting.update({
    where: { id: meetingId },
    data: { minutes, minutesUpdatedAt: new Date() },
    select: { id: true, title: true, minutes: true, minutesUpdatedAt: true, minutesPublished: true },
  });

  void audit({ action: 'MINUTES_SAVED', actorId, communityId: meeting.communityId, meta: { meetingId } });
  return updated;
}

export async function publishMinutes(
  actorId: string,
  actorRole: UserRole,
  meetingId: string,
  published: boolean,
) {
  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    select: { id: true, communityId: true },
  });
  if (!meeting) throw new NotFoundError('Meeting not found');
  await assertCommunityAccess(actorId, actorRole, meeting.communityId);

  const updated = await prisma.meeting.update({
    where: { id: meetingId },
    data: { minutesPublished: published },
    select: { id: true, title: true, minutes: true, minutesUpdatedAt: true, minutesPublished: true },
  });

  void audit({ action: 'MINUTES_PUBLISHED', actorId, communityId: meeting.communityId, meta: { meetingId, published } });
  return updated;
}

export async function signMinutes(actorId: string, actorRole: UserRole, meetingId: string, totpCode: string): Promise<Meeting> {
  const meeting = await prisma.meeting.findUniqueOrThrow({
    where: { id: meetingId },
    include: { community: true },
  });
  await assertCommunityAccess(actorId, actorRole, meeting.communityId);

  if (!meeting.minutes) throw new ValidationError('No hay acta redactada para firmar');
  if (meeting.minutesSignedAt) throw new ValidationError('El acta ya está firmada');

  // Verify TOTP
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: actorId },
    select: { totpSecret: true, totpEnabled: true },
  });
  if (!user.totpEnabled || !user.totpSecret) {
    throw new ValidationError('Debes tener 2FA activado para firmar el acta');
  }
  const result = verifySync({ ...totpPlugins, secret: user.totpSecret, token: totpCode, strategy: 'totp' });
  if (!result.valid) throw new UnauthorizedError('Código 2FA incorrecto');

  const now = new Date();
  const payload = `${meeting.minutes}|${actorId}|${now.toISOString()}`;
  const hash = crypto.createHash('sha256').update(payload).digest('hex');

  const updated = await prisma.meeting.update({
    where: { id: meetingId },
    data: {
      minutesSignedAt: now,
      minutesSignedById: actorId,
      minutesSignatureHash: hash,
    },
    include: { minutesSignedBy: { select: { firstName: true, lastName: true, email: true } } },
  });

  void audit({ actorId, communityId: meeting.communityId, action: 'MINUTES_PUBLISHED', targetId: meetingId, meta: { signed: true, hash: hash.slice(0, 16) } });
  return updated;
}

export async function exportMinutesPdf(actorId: string, actorRole: UserRole, meetingId: string): Promise<Buffer> {
  const meeting = await prisma.meeting.findUniqueOrThrow({
    where: { id: meetingId },
    include: {
      community: true,
      minutesSignedBy: { select: { firstName: true, lastName: true, email: true } },
    },
  });
  await assertCommunityAccess(actorId, actorRole, meeting.communityId);
  if (!meeting.minutes) throw new Error('No hay acta redactada');
  if (!meeting.minutesPublished) throw new Error('El acta no está publicada');

  const PDFDocument = (await import('pdfkit')).default;
  const doc = new PDFDocument({ margin: 60 });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));

  return new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header
    doc.fontSize(20).font('Helvetica-Bold').text('ACTA DE JUNTA DE PROPIETARIOS', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(12).font('Helvetica').text(meeting.community.name, { align: 'center' });
    doc.moveDown(0.3);
    doc.fontSize(10).text(`Fecha: ${new Date(meeting.scheduledAt).toLocaleDateString('es-ES')}`, { align: 'center' });
    if (meeting.location) doc.text(`Lugar: ${meeting.location}`, { align: 'center' });
    doc.moveDown(1.5);

    // Minutes content
    doc.fontSize(11).font('Helvetica').text(meeting.minutes ?? '', { lineGap: 4 });
    doc.moveDown(2);

    // Signature block
    if (meeting.minutesSignedAt && meeting.minutesSignedBy) {
      doc.moveTo(60, doc.y).lineTo(535, doc.y).stroke('#cccccc');
      doc.moveDown(0.5);
      doc.fontSize(9).font('Helvetica').fillColor('#666666')
        .text(`Firmado digitalmente el ${new Date(meeting.minutesSignedAt).toLocaleString('es-ES')}`, { align: 'center' })
        .text(`por ${meeting.minutesSignedBy.firstName} ${meeting.minutesSignedBy.lastName} (${meeting.minutesSignedBy.email})`, { align: 'center' })
        .moveDown(0.3);
      doc.font('Courier').text(`SHA-256: ${meeting.minutesSignatureHash}`, { align: 'center' });
    }

    doc.end();
  });
}

export async function exportConvocatoriaPdf(actorId: string, actorRole: UserRole, meetingId: string): Promise<Buffer> {
  const meeting = await prisma.meeting.findUniqueOrThrow({
    where: { id: meetingId },
    include: {
      community: { include: { units: { include: { ownerships: { where: { endDate: null }, include: { owner: { select: { firstName: true, lastName: true } } } } } } } },
    },
  });
  await assertCommunityAccess(actorId, actorRole, meeting.communityId);

  const PDFDocument = (await import('pdfkit')).default;
  const doc = new PDFDocument({ margin: 60, size: 'A4' });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));

  return new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const locale = 'es-ES';
    const dateStr = new Date(meeting.scheduledAt).toLocaleDateString(locale, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const timeStr = new Date(meeting.scheduledAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });

    doc.fontSize(14).font('Helvetica-Bold').text('CONVOCATORIA DE JUNTA DE PROPIETARIOS', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(12).font('Helvetica-Bold').text(meeting.community.name, { align: 'center' });
    doc.moveDown(1.5);

    doc.fontSize(11).font('Helvetica')
      .text(`Por medio de la presente, se convoca a todos los propietarios de la Comunidad de Propietarios ${meeting.community.name} a la celebración de la:`)
      .moveDown(0.5)
      .font('Helvetica-Bold').text(`JUNTA ${meeting.title.toUpperCase()}`, { align: 'center' })
      .moveDown(0.5)
      .font('Helvetica')
      .text(`Fecha: ${dateStr}`)
      .text(`Hora: ${timeStr}`)
      .text(`Lugar: ${meeting.location ?? 'Por determinar'}`)
      .moveDown(1);

    if (meeting.agenda) {
      doc.font('Helvetica-Bold').text('ORDEN DEL DÍA:').moveDown(0.3);
      doc.font('Helvetica').text(meeting.agenda).moveDown(1);
    }

    doc.font('Helvetica')
      .text('Y para que conste a los efectos oportunos, se emite la presente convocatoria.')
      .moveDown(1)
      .text(`Emitida el ${new Date().toLocaleDateString(locale)}`)
      .moveDown(2);

    // Attendance list
    const owners = meeting.community.units
      .flatMap(u => u.ownerships.map(o => ({ unit: u.label, name: `${o.owner.firstName} ${o.owner.lastName}` })));

    if (owners.length > 0) {
      doc.addPage();
      doc.fontSize(12).font('Helvetica-Bold').text('LISTA DE PROPIETARIOS', { align: 'center' });
      doc.moveDown(1);
      owners.forEach(({ unit, name }) => {
        doc.fontSize(10).font('Helvetica').text(`${unit} — ${name}`);
        doc.moveDown(0.3);
      });
    }

    doc.end();
  });
}

// ─── In-memory QR token store (resets on restart, fine for meeting use) ──────

const qrTokens = new Map<string, { meetingId: string; expiresAt: number }>();

export async function generateQrToken(
  actorId: string,
  actorRole: UserRole,
  meetingId: string,
): Promise<{ token: string; url: string }> {
  const meeting = await prisma.meeting.findUnique({
    where: { id: meetingId },
    select: { communityId: true },
  });
  if (!meeting) throw new NotFoundError('Reunión no encontrada');
  await assertCommunityAccess(actorId, actorRole, meeting.communityId);

  const token = crypto.randomBytes(24).toString('hex');
  qrTokens.set(token, { meetingId, expiresAt: Date.now() + 4 * 60 * 60 * 1000 });
  return { token, url: `/meetings/qr-check-in/${token}` };
}

export async function checkInWithQr(token: string, userId: string): Promise<void> {
  const entry = qrTokens.get(token);
  if (!entry || Date.now() > entry.expiresAt) throw new ValidationError('QR inválido o expirado');
  qrTokens.delete(token);

  // Mark attendance as CONFIRMED
  const existing = await prisma.meetingAttendee.findFirst({
    where: { meetingId: entry.meetingId, userId },
  });
  if (existing) {
    await prisma.meetingAttendee.update({
      where: { id: existing.id },
      data: { status: 'CONFIRMED' },
    });
  } else {
    await prisma.meetingAttendee.create({
      data: { meetingId: entry.meetingId, userId, status: 'CONFIRMED' },
    });
  }
}
