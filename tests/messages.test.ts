import request from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/config/prisma';
import {
  cleanup,
  createCommunity,
  createUnit,
  createUser,
  setOccupant,
} from './helpers';

const app = createApp();

describe('Messages endpoints', () => {
  beforeAll(async () => {
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  async function setupTrio(): Promise<{
    admin: Awaited<ReturnType<typeof createUser>>;
    vecino: Awaited<ReturnType<typeof createUser>>;
    community: Awaited<ReturnType<typeof createCommunity>>;
  }> {
    const admin = await createUser({ role: 'ADMIN_FINCAS' });
    const vecino = await createUser({ role: 'VECINO' });
    const community = await createCommunity({ adminId: admin.id });
    const unit = await createUnit(community.id);
    await setOccupant(unit.id, vecino.id);
    return { admin, vecino, community };
  }

  describe('POST /api/v1/messages/conversations', () => {
    it('vecino inicia conversación con su comunidad (201)', async () => {
      const { vecino, community } = await setupTrio();
      const res = await request(app)
        .post('/api/v1/messages/conversations')
        .set('Authorization', `Bearer ${vecino.token}`)
        .send({ communityId: community.id });
      expect(res.status).toBe(201);
      expect(res.body.conversation.communityId).toBe(community.id);
      expect(res.body.conversation.residentId).toBe(vecino.id);
    });

    it('reusa la conversación existente (idempotente)', async () => {
      const { vecino, community } = await setupTrio();
      const r1 = await request(app)
        .post('/api/v1/messages/conversations')
        .set('Authorization', `Bearer ${vecino.token}`)
        .send({ communityId: community.id });
      const r2 = await request(app)
        .post('/api/v1/messages/conversations')
        .set('Authorization', `Bearer ${vecino.token}`)
        .send({ communityId: community.id });
      expect(r1.body.conversation.id).toBe(r2.body.conversation.id);
    });

    it('rechaza vecino que no pertenece a la comunidad (403)', async () => {
      const { community } = await setupTrio();
      const outsider = await createUser({ role: 'VECINO' });
      const res = await request(app)
        .post('/api/v1/messages/conversations')
        .set('Authorization', `Bearer ${outsider.token}`)
        .send({ communityId: community.id });
      expect(res.status).toBe(403);
    });
  });

  describe('POST /conversations/:id/messages (envío) y GET (lectura)', () => {
    async function startConv(vecino: { token: string }, communityId: string): Promise<string> {
      const r = await request(app)
        .post('/api/v1/messages/conversations')
        .set('Authorization', `Bearer ${vecino.token}`)
        .send({ communityId });
      return r.body.conversation.id;
    }

    it('vecino envía mensaje con fromAdmin=false', async () => {
      const { vecino, community } = await setupTrio();
      const convId = await startConv(vecino, community.id);
      const res = await request(app)
        .post(`/api/v1/messages/conversations/${convId}/messages`)
        .set('Authorization', `Bearer ${vecino.token}`)
        .send({ body: 'Hola admin' });
      expect(res.status).toBe(201);
      expect(res.body.message.fromAdmin).toBe(false);
      expect(res.body.message.body).toBe('Hola admin');
    });

    it('admin responde con fromAdmin=true', async () => {
      const { admin, vecino, community } = await setupTrio();
      const convId = await startConv(vecino, community.id);
      const res = await request(app)
        .post(`/api/v1/messages/conversations/${convId}/messages`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ body: 'Buenos días' });
      expect(res.status).toBe(201);
      expect(res.body.message.fromAdmin).toBe(true);
    });

    it('al leer, los mensajes del otro lado se marcan como leídos', async () => {
      const { admin, vecino, community } = await setupTrio();
      const convId = await startConv(vecino, community.id);
      // Vecino envía dos mensajes
      await request(app)
        .post(`/api/v1/messages/conversations/${convId}/messages`)
        .set('Authorization', `Bearer ${vecino.token}`)
        .send({ body: 'a' });
      await request(app)
        .post(`/api/v1/messages/conversations/${convId}/messages`)
        .set('Authorization', `Bearer ${vecino.token}`)
        .send({ body: 'b' });

      // Antes de que el admin los lea, deberían estar sin readAt
      const unreadBefore = await prisma.message.count({
        where: { conversationId: convId, readAt: null, fromAdmin: false },
      });
      expect(unreadBefore).toBe(2);

      const res = await request(app)
        .get(`/api/v1/messages/conversations/${convId}/messages`)
        .set('Authorization', `Bearer ${admin.token}`);
      expect(res.status).toBe(200);
      expect(res.body.isAdmin).toBe(true);

      const unreadAfter = await prisma.message.count({
        where: { conversationId: convId, readAt: null, fromAdmin: false },
      });
      expect(unreadAfter).toBe(0);
    });

    it('tercero ajeno no puede enviar ni leer (403)', async () => {
      const { vecino, community } = await setupTrio();
      const intruder = await createUser({ role: 'VECINO' });
      const convId = await startConv(vecino, community.id);

      const r1 = await request(app)
        .get(`/api/v1/messages/conversations/${convId}/messages`)
        .set('Authorization', `Bearer ${intruder.token}`);
      expect(r1.status).toBe(403);

      const r2 = await request(app)
        .post(`/api/v1/messages/conversations/${convId}/messages`)
        .set('Authorization', `Bearer ${intruder.token}`)
        .send({ body: 'hack' });
      expect(r2.status).toBe(403);
    });

    it('rechaza body vacío (400)', async () => {
      const { vecino, community } = await setupTrio();
      const convId = await startConv(vecino, community.id);
      const res = await request(app)
        .post(`/api/v1/messages/conversations/${convId}/messages`)
        .set('Authorization', `Bearer ${vecino.token}`)
        .send({ body: '' });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/v1/messages/conversations (listar)', () => {
    it('vecino ve sus conversaciones con unreadCount correcto', async () => {
      const { admin, vecino, community } = await setupTrio();
      const convRes = await request(app)
        .post('/api/v1/messages/conversations')
        .set('Authorization', `Bearer ${vecino.token}`)
        .send({ communityId: community.id });
      const convId = convRes.body.conversation.id;

      // admin envía mensaje (no leído por el vecino)
      await request(app)
        .post(`/api/v1/messages/conversations/${convId}/messages`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ body: 'hola' });

      const res = await request(app)
        .get('/api/v1/messages/conversations')
        .set('Authorization', `Bearer ${vecino.token}`);
      expect(res.status).toBe(200);
      expect(res.body.conversations).toHaveLength(1);
      expect(res.body.conversations[0].unreadCount).toBe(1);
    });

    it('admin ve solo conversaciones de sus comunidades', async () => {
      const { admin, vecino, community } = await setupTrio();
      // Otro admin, otra comunidad, otra conversación
      const otherAdmin = await createUser({ role: 'ADMIN_FINCAS' });
      const otherCommunity = await createCommunity({ adminId: otherAdmin.id });
      const otherUnit = await createUnit(otherCommunity.id);
      const otherVecino = await createUser({ role: 'VECINO' });
      await setOccupant(otherUnit.id, otherVecino.id);

      await request(app)
        .post('/api/v1/messages/conversations')
        .set('Authorization', `Bearer ${vecino.token}`)
        .send({ communityId: community.id });
      await request(app)
        .post('/api/v1/messages/conversations')
        .set('Authorization', `Bearer ${otherVecino.token}`)
        .send({ communityId: otherCommunity.id });

      const res = await request(app)
        .get('/api/v1/messages/conversations')
        .set('Authorization', `Bearer ${admin.token}`);
      expect(res.status).toBe(200);
      expect(res.body.conversations).toHaveLength(1);
      expect(res.body.conversations[0].communityId).toBe(community.id);
    });

    it('support ve todas las conversaciones', async () => {
      const support = await createUser({ role: 'SUPPORT' });
      const { vecino, community } = await setupTrio();
      await request(app)
        .post('/api/v1/messages/conversations')
        .set('Authorization', `Bearer ${vecino.token}`)
        .send({ communityId: community.id });

      const res = await request(app)
        .get('/api/v1/messages/conversations')
        .set('Authorization', `Bearer ${support.token}`);
      expect(res.status).toBe(200);
      expect(res.body.conversations.length).toBeGreaterThanOrEqual(1);
    });
  });
});
