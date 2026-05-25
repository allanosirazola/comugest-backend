import { prisma } from '../../config/prisma';

function icsDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function escIcs(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

export async function generateCommunityIcs(communityId: string): Promise<string> {
  const [meetings, reservations] = await Promise.all([
    prisma.meeting.findMany({
      where: { communityId },
      select: { id: true, title: true, scheduledAt: true, location: true },
    }),
    prisma.reservation.findMany({
      where: { area: { communityId }, status: 'CONFIRMED' },
      select: {
        id: true,
        startAt: true,
        endAt: true,
        area: { select: { name: true } },
        user: { select: { firstName: true, lastName: true } },
      },
    }).catch(() => [] as never[]),
  ]);

  const now = icsDate(new Date());
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Comugest//Community Calendar//ES',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];

  for (const m of meetings) {
    const start = new Date(m.scheduledAt);
    const end = new Date(start.getTime() + 2 * 60 * 60 * 1000); // 2h default
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:meeting-${m.id}@comugest.app`);
    lines.push(`DTSTAMP:${now}`);
    lines.push(`DTSTART:${icsDate(start)}`);
    lines.push(`DTEND:${icsDate(end)}`);
    lines.push(`SUMMARY:${escIcs(m.title)}`);
    if (m.location) lines.push(`LOCATION:${escIcs(m.location)}`);
    lines.push('END:VEVENT');
  }

  for (const r of reservations) {
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:reservation-${r.id}@comugest.app`);
    lines.push(`DTSTAMP:${now}`);
    lines.push(`DTSTART:${icsDate(new Date(r.startAt))}`);
    lines.push(`DTEND:${icsDate(new Date(r.endAt))}`);
    lines.push(`SUMMARY:${escIcs(`${r.area.name} – ${r.user.firstName} ${r.user.lastName}`)}`);
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
