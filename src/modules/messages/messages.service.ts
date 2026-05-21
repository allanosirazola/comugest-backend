import { prisma } from '../../config/prisma';
import type { UserRole } from '@prisma/client';
import { ForbiddenError, NotFoundError, ValidationError } from '../../utils/errors';
import { getManagedCommunityIds } from '../../utils/authz';

// ─── Acceso ─────────────────────────────────────────────────

/**
 * Determina si un usuario puede acceder a una conversación, y en qué calidad.
 * Devuelve { isAdmin } o lanza ForbiddenError.
 */
async function resolveAccess(
  userId: string,
  userRole: UserRole,
  conversationId: string
): Promise<{ conversation: { id: string; communityId: string; residentId: string }; isAdmin: boolean }> {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { id: true, communityId: true, residentId: true },
  });
  if (!conversation) throw new NotFoundError('Conversación no encontrada');

  // ¿Es el vecino dueño de la conversación?
  if (conversation.residentId === userId) {
    return { conversation, isAdmin: false };
  }
  // ¿Es admin de la comunidad?
  if (userRole === 'SUPPORT') return { conversation, isAdmin: true };
  if (userRole === 'ADMIN_FINCAS') {
    const link = await prisma.communityAdmin.findUnique({
      where: { communityId_userId: { communityId: conversation.communityId, userId } },
    });
    if (link) return { conversation, isAdmin: true };
  }
  throw new ForbiddenError('Sin acceso a esta conversación');
}

// ─── Vecino: iniciar/recuperar conversación ─────────────────

export async function getOrCreateConversation(residentId: string, communityId: string) {
  // Verificar que el vecino pertenece a la comunidad (propietario u ocupante activo)
  const belongs =
    (await prisma.ownership.count({ where: { ownerId: residentId, endDate: null, unit: { communityId } } })) > 0 ||
    (await prisma.occupancy.count({ where: { occupantId: residentId, endDate: null, unit: { communityId } } })) > 0;
  if (!belongs) {
    throw new ForbiddenError('No perteneces a esta comunidad');
  }

  const existing = await prisma.conversation.findUnique({
    where: { communityId_residentId: { communityId, residentId } },
  });
  if (existing) return existing;

  return prisma.conversation.create({
    data: { communityId, residentId },
  });
}

// ─── Listar conversaciones ──────────────────────────────────

/**
 * Para un vecino: sus conversaciones (una por comunidad).
 * Para un admin: todas las conversaciones de sus comunidades.
 */
export async function listConversations(userId: string, userRole: UserRole) {
  let where;
  if (userRole === 'VECINO') {
    where = { residentId: userId };
  } else if (userRole === 'SUPPORT') {
    where = {};
  } else {
    const communityIds = await getManagedCommunityIds(userId);
    where = { communityId: { in: communityIds } };
  }

  const conversations = await prisma.conversation.findMany({
    where,
    orderBy: { lastMessageAt: 'desc' },
    include: {
      community: { select: { id: true, name: true } },
      resident: { select: { id: true, firstName: true, lastName: true, email: true } },
      messages: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
  });

  const isAdminView = userRole !== 'VECINO';

  // Conteo de no leídos: mensajes que no envió este "lado" y sin readAt
  return Promise.all(
    conversations.map(async (c) => {
      const unread = await prisma.message.count({
        where: {
          conversationId: c.id,
          readAt: null,
          // Si soy admin, no leídos son los del vecino (fromAdmin=false)
          // Si soy vecino, no leídos son los del admin (fromAdmin=true)
          fromAdmin: isAdminView ? false : true,
        },
      });
      return {
        id: c.id,
        communityId: c.communityId,
        community: c.community,
        resident: c.resident,
        lastMessage: c.messages[0] ?? null,
        lastMessageAt: c.lastMessageAt,
        unreadCount: unread,
      };
    })
  );
}

// ─── Mensajes de una conversación ───────────────────────────

export async function listMessages(userId: string, userRole: UserRole, conversationId: string) {
  const { conversation, isAdmin } = await resolveAccess(userId, userRole, conversationId);

  const messages = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'asc' },
  });

  // Marcar como leídos los mensajes del otro lado
  await prisma.message.updateMany({
    where: {
      conversationId,
      readAt: null,
      fromAdmin: isAdmin ? false : true, // el admin lee los del vecino y viceversa
    },
    data: { readAt: new Date() },
  });

  return {
    conversation: { id: conversation.id, communityId: conversation.communityId, residentId: conversation.residentId },
    isAdmin,
    messages,
  };
}

export async function sendMessage(userId: string, userRole: UserRole, conversationId: string, body: string) {
  const { isAdmin } = await resolveAccess(userId, userRole, conversationId);
  if (!body.trim()) throw new ValidationError('El mensaje no puede estar vacío');

  const [message] = await prisma.$transaction([
    prisma.message.create({
      data: {
        conversationId,
        senderId: userId,
        fromAdmin: isAdmin,
        body: body.trim(),
      },
    }),
    prisma.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: new Date() },
    }),
  ]);

  return message;
}
