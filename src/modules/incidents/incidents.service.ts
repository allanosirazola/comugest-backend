import { prisma } from '../../config/prisma';
import type { IncidentLog, UserRole } from '@prisma/client';
import { assertCommunityAccess } from '../../utils/authz';
import { ValidationError, NotFoundError } from '../../utils/errors';

const MAX_PHOTOS = 5;
const MAX_BASE64_BYTES = 600 * 1024; // 600 KB

export async function listIncidents(userId: string, userRole: UserRole, communityId: string) {
  await assertCommunityAccess(userId, userRole, communityId);
  return prisma.incidentLog.findMany({
    where: { communityId },
    include: { reportedBy: { select: { firstName: true, lastName: true } } },
    orderBy: { number: 'desc' },
  });
}

export async function createIncident(
  userId: string,
  userRole: UserRole,
  communityId: string,
  input: { title: string; description: string; category?: string; photos?: string[] }
) {
  await assertCommunityAccess(userId, userRole, communityId);
  // Get next correlative number
  const last = await prisma.incidentLog.findFirst({
    where: { communityId },
    orderBy: { number: 'desc' },
    select: { number: true },
  });
  const number = (last?.number ?? 0) + 1;
  return prisma.incidentLog.create({
    data: {
      communityId,
      number,
      reportedById: userId,
      title: input.title,
      description: input.description,
      category: input.category ?? 'GENERAL',
      photos: input.photos ?? [],
    },
    include: { reportedBy: { select: { firstName: true, lastName: true } } },
  });
}

export async function updateIncidentStatus(
  userId: string,
  userRole: UserRole,
  communityId: string,
  incidentId: string,
  input: { status: string; resolution?: string }
) {
  await assertCommunityAccess(userId, userRole, communityId);
  return prisma.incidentLog.update({
    where: { id: incidentId, communityId },
    data: {
      status: input.status,
      resolution: input.resolution,
      resolvedAt:
        input.status === 'RESOLVED' || input.status === 'CLOSED' ? new Date() : undefined,
    },
  });
}

export async function addIncidentPhoto(
  incidentId: string,
  dataUri: string
): Promise<IncidentLog> {
  if (!dataUri.startsWith('data:image/')) {
    throw new ValidationError('dataUri must be a valid image data URI (starts with data:image/)');
  }
  // Check base64 payload size
  const base64Part = dataUri.split(',')[1] ?? '';
  const sizeBytes = Math.ceil((base64Part.length * 3) / 4);
  if (sizeBytes > MAX_BASE64_BYTES) {
    throw new ValidationError(`Image exceeds maximum size of ${MAX_BASE64_BYTES / 1024} KB`);
  }

  const incident = await prisma.incidentLog.findUnique({
    where: { id: incidentId },
    select: { photos: true },
  });
  if (!incident) {
    throw new NotFoundError('Incident not found');
  }
  if (incident.photos.length >= MAX_PHOTOS) {
    throw new ValidationError(`Cannot add more than ${MAX_PHOTOS} photos per incident`);
  }

  return prisma.incidentLog.update({
    where: { id: incidentId },
    data: { photos: [...incident.photos, dataUri] },
  });
}

export async function removeIncidentPhoto(
  incidentId: string,
  photoIndex: number,
  userId: string,
  userRole: UserRole,
  communityId: string
): Promise<IncidentLog> {
  await assertCommunityAccess(userId, userRole, communityId);

  const incident = await prisma.incidentLog.findUnique({
    where: { id: incidentId, communityId },
    select: { photos: true },
  });
  if (!incident) {
    throw new NotFoundError('Incident not found');
  }
  if (photoIndex < 0 || photoIndex >= incident.photos.length) {
    throw new ValidationError(
      `Invalid photo index: ${photoIndex}. Incident has ${incident.photos.length} photo(s).`
    );
  }

  const updated = [...incident.photos];
  updated.splice(photoIndex, 1);

  return prisma.incidentLog.update({
    where: { id: incidentId },
    data: { photos: updated },
  });
}
