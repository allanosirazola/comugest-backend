import request from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/config/prisma';
import {
  cleanup,
  createCommunity,
  createUnit,
  createUser,
  setOccupant,
  setOwner,
} from './helpers';

const app = createApp();

describe('Announcements endpoints', () => {
  beforeAll(async () => {
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  describe('POST /api/v1/communities/:communityId/announcements', () => {
    it('admin crea anuncio (201)', async () => {
      const admin = await createUser({ role: 'ADMIN_FINCAS' });
      const community = await createCommunity({ adminId: admin.id });

      const res = await request(app)
        .post(`/api/v1/communities/${community.id}/announcements`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({
          title: 'Junta extraordinaria',
          body: 'El próximo lunes a las 19:00',
          pinned: true,
          notify: false, // evitar enviar email en tests
        });

      expect(res.status).toBe(201);
      expect(res.body.announcement.title).toBe('Junta extraordinaria');
      expect(res.body.announcement.pinned).toBe(true);
    });

    it('rechaza body vacío (400)', async () => {
      const admin = await createUser({ role: 'ADMIN_FINCAS' });
      const community = await createCommunity({ adminId: admin.id });
      const res = await request(app)
        .post(`/api/v1/communities/${community.id}/announcements`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ title: 'X', body: '' });
      expect(res.status).toBe(400);
    });

    it('vecino no puede crear (403)', async () => {
      const admin = await createUser({ role: 'ADMIN_FINCAS' });
      const vecino = await createUser({ role: 'VECINO' });
      const community = await createCommunity({ adminId: admin.id });
      const res = await request(app)
        .post(`/api/v1/communities/${community.id}/announcements`)
        .set('Authorization', `Bearer ${vecino.token}`)
        .send({ title: 'X', body: 'Y', notify: false });
      expect(res.status).toBe(403);
    });

    it('admin ajeno recibe 403', async () => {
      const owner = await createUser({ role: 'ADMIN_FINCAS' });
      const intruder = await createUser({ role: 'ADMIN_FINCAS' });
      const community = await createCommunity({ adminId: owner.id });
      const res = await request(app)
        .post(`/api/v1/communities/${community.id}/announcements`)
        .set('Authorization', `Bearer ${intruder.token}`)
        .send({ title: 'Hack', body: 'X', notify: false });
      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/v1/communities/:communityId/announcements', () => {
    it('lista con pinned primero, luego por publishedAt desc', async () => {
      const admin = await createUser({ role: 'ADMIN_FINCAS' });
      const community = await createCommunity({ adminId: admin.id });

      await prisma.announcement.createMany({
        data: [
          { communityId: community.id, authorId: admin.id, title: 'Viejo', body: 'a', pinned: false, publishedAt: new Date('2024-01-01') },
          { communityId: community.id, authorId: admin.id, title: 'Reciente', body: 'b', pinned: false, publishedAt: new Date() },
          { communityId: community.id, authorId: admin.id, title: 'Fijado', body: 'c', pinned: true, publishedAt: new Date('2023-01-01') },
        ],
      });

      const res = await request(app)
        .get(`/api/v1/communities/${community.id}/announcements`)
        .set('Authorization', `Bearer ${admin.token}`);
      expect(res.status).toBe(200);
      expect(res.body.announcements[0].title).toBe('Fijado'); // pinned primero
      expect(res.body.announcements[1].title).toBe('Reciente');
      expect(res.body.announcements[2].title).toBe('Viejo');
    });
  });

  describe('PATCH/DELETE /api/v1/announcements/:id', () => {
    it('admin actualiza pinned y title', async () => {
      const admin = await createUser({ role: 'ADMIN_FINCAS' });
      const community = await createCommunity({ adminId: admin.id });
      const a = await prisma.announcement.create({
        data: { communityId: community.id, authorId: admin.id, title: 'X', body: 'X' },
      });

      const res = await request(app)
        .patch(`/api/v1/announcements/${a.id}`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ title: 'Editado', pinned: true });
      expect(res.status).toBe(200);
      expect(res.body.announcement.title).toBe('Editado');
      expect(res.body.announcement.pinned).toBe(true);
    });

    it('borra y devuelve 204', async () => {
      const admin = await createUser({ role: 'ADMIN_FINCAS' });
      const community = await createCommunity({ adminId: admin.id });
      const a = await prisma.announcement.create({
        data: { communityId: community.id, authorId: admin.id, title: 'X', body: 'X' },
      });

      const res = await request(app)
        .delete(`/api/v1/announcements/${a.id}`)
        .set('Authorization', `Bearer ${admin.token}`);
      expect(res.status).toBe(204);
      const still = await prisma.announcement.findUnique({ where: { id: a.id } });
      expect(still).toBeNull();
    });

    it('404 si no existe', async () => {
      const admin = await createUser({ role: 'ADMIN_FINCAS' });
      const res = await request(app)
        .patch('/api/v1/announcements/ckxxxxxxxxxxxxxxxxxxxxxx')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ title: 'X' });
      expect(res.status).toBe(404);
    });

    it('admin ajeno no puede actualizar (403)', async () => {
      const owner = await createUser({ role: 'ADMIN_FINCAS' });
      const intruder = await createUser({ role: 'ADMIN_FINCAS' });
      const community = await createCommunity({ adminId: owner.id });
      const a = await prisma.announcement.create({
        data: { communityId: community.id, authorId: owner.id, title: 'X', body: 'X' },
      });
      const res = await request(app)
        .patch(`/api/v1/announcements/${a.id}`)
        .set('Authorization', `Bearer ${intruder.token}`)
        .send({ title: 'Hack' });
      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/v1/me/announcements (vecino)', () => {
    it('vecino ve los anuncios de sus comunidades, no de otras', async () => {
      const admin = await createUser({ role: 'ADMIN_FINCAS' });
      const vecino = await createUser({ role: 'VECINO' });
      const myCommunity = await createCommunity({ adminId: admin.id });
      const otherCommunity = await createCommunity({ adminId: admin.id });
      const unit = await createUnit(myCommunity.id);
      await setOwner(unit.id, vecino.id);

      await prisma.announcement.create({
        data: { communityId: myCommunity.id, authorId: admin.id, title: 'Mío', body: 'X' },
      });
      await prisma.announcement.create({
        data: { communityId: otherCommunity.id, authorId: admin.id, title: 'Ajeno', body: 'X' },
      });

      const res = await request(app)
        .get('/api/v1/me/announcements')
        .set('Authorization', `Bearer ${vecino.token}`);
      expect(res.status).toBe(200);
      expect(res.body.announcements).toHaveLength(1);
      expect(res.body.announcements[0].title).toBe('Mío');
    });

    it('vecino también ve por ocupación (no solo por propiedad)', async () => {
      const admin = await createUser({ role: 'ADMIN_FINCAS' });
      const vecino = await createUser({ role: 'VECINO' });
      const community = await createCommunity({ adminId: admin.id });
      const unit = await createUnit(community.id);
      await setOccupant(unit.id, vecino.id);
      await prisma.announcement.create({
        data: { communityId: community.id, authorId: admin.id, title: 'Para ocupante', body: 'X' },
      });

      const res = await request(app)
        .get('/api/v1/me/announcements')
        .set('Authorization', `Bearer ${vecino.token}`);
      expect(res.status).toBe(200);
      expect(res.body.announcements).toHaveLength(1);
    });

    it('sin pertenencia activa devuelve []', async () => {
      const vecino = await createUser({ role: 'VECINO' });
      const res = await request(app)
        .get('/api/v1/me/announcements')
        .set('Authorization', `Bearer ${vecino.token}`);
      expect(res.status).toBe(200);
      expect(res.body.announcements).toEqual([]);
    });
  });
});
