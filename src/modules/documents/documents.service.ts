import { prisma } from '../../config/prisma';
import { audit } from '../audit/audit.service';
import { assertCommunityAccess } from '../../utils/authz';
import { NotFoundError } from '../../utils/errors';
import type { UserRole } from '@prisma/client';
import type { CreateDocumentInput, UpdateDocumentInput } from './documents.schemas';

const docSelect = {
  id: true,
  name: true,
  description: true,
  category: true,
  url: true,
  publicForResidents: true,
  createdAt: true,
  uploadedBy: { select: { id: true, firstName: true, lastName: true } },
} as const;

export async function listDocuments(communityId: string, isAdmin: boolean) {
  return prisma.document.findMany({
    where: { communityId, ...(!isAdmin && { publicForResidents: true }) },
    select: docSelect,
    orderBy: [{ category: 'asc' }, { createdAt: 'desc' }],
  });
}

export async function createDocument(
  adminId: string,
  adminRole: UserRole,
  communityId: string,
  input: CreateDocumentInput,
) {
  await assertCommunityAccess(adminId, adminRole, communityId);
  const doc = await prisma.document.create({
    data: { communityId, uploadedById: adminId, ...input },
    select: docSelect,
  });
  void audit({
    action: 'DOCUMENT_CREATED',
    actorId: adminId,
    communityId,
    meta: { documentId: doc.id, name: doc.name },
  });
  return doc;
}

export async function updateDocument(
  adminId: string,
  adminRole: UserRole,
  documentId: string,
  input: UpdateDocumentInput,
) {
  const existing = await prisma.document.findUnique({
    where: { id: documentId },
    select: { id: true, communityId: true },
  });
  if (!existing) throw new NotFoundError('Document not found');
  await assertCommunityAccess(adminId, adminRole, existing.communityId);
  return prisma.document.update({ where: { id: documentId }, data: input, select: docSelect });
}

export async function deleteDocument(
  adminId: string,
  adminRole: UserRole,
  documentId: string,
) {
  const existing = await prisma.document.findUnique({
    where: { id: documentId },
    select: { id: true, communityId: true, name: true },
  });
  if (!existing) throw new NotFoundError('Document not found');
  await assertCommunityAccess(adminId, adminRole, existing.communityId);
  await prisma.document.delete({ where: { id: documentId } });
  void audit({
    action: 'DOCUMENT_DELETED',
    actorId: adminId,
    communityId: existing.communityId,
    meta: { documentId, name: existing.name },
  });
}
