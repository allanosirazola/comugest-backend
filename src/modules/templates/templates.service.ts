import { prisma } from '../../config/prisma';

export async function listTemplates(communityId: string) {
  return prisma.messageTemplate.findMany({
    where: { communityId },
    include: { createdBy: { select: { firstName: true, lastName: true } } },
    orderBy: { name: 'asc' },
  });
}

export async function createTemplate(
  communityId: string,
  createdById: string,
  data: { name: string; subject: string; body: string }
) {
  return prisma.messageTemplate.create({
    data: { ...data, communityId, createdById },
  });
}

export async function deleteTemplate(templateId: string) {
  return prisma.messageTemplate.delete({ where: { id: templateId } });
}
