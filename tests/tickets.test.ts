import request from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/config/prisma';
import { cleanup, createUser } from './helpers';

const app = createApp();

describe('Tickets endpoints', () => {
  beforeAll(async () => {
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  describe('POST /api/v1/tickets', () => {
    it('vecino crea ticket (201)', async () => {
      const vecino = await createUser({ role: 'VECINO' });
      const res = await request(app)
        .post('/api/v1/tickets')
        .set('Authorization', `Bearer ${vecino.token}`)
        .send({
          category: 'BUG',
          subject: 'No carga la página de facturas',
          description: 'Al pulsar el menú no pasa nada',
        });
      expect(res.status).toBe(201);
      expect(res.body.ticket.status).toBe('OPEN');
      expect(res.body.ticket.priority).toBe('MEDIUM');
      expect(res.body.ticket.reporterId).toBe(vecino.id);
    });

    it('captura user-agent del header si no se envía explícito', async () => {
      const vecino = await createUser({ role: 'VECINO' });
      const res = await request(app)
        .post('/api/v1/tickets')
        .set('Authorization', `Bearer ${vecino.token}`)
        .set('user-agent', 'JestRunner/1.0')
        .send({
          category: 'QUESTION',
          subject: 'Duda',
          description: 'Pregunta',
        });
      expect(res.status).toBe(201);
      expect(res.body.ticket.userAgent).toBe('JestRunner/1.0');
    });

    it('rechaza categoría inválida (400)', async () => {
      const vecino = await createUser({ role: 'VECINO' });
      const res = await request(app)
        .post('/api/v1/tickets')
        .set('Authorization', `Bearer ${vecino.token}`)
        .send({ category: 'X', subject: 'a', description: 'b' });
      expect(res.status).toBe(400);
    });

    it('sin token responde 401', async () => {
      const res = await request(app).post('/api/v1/tickets').send({});
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/v1/me/tickets', () => {
    it('lista los tickets del reporter', async () => {
      const vecino = await createUser({ role: 'VECINO' });
      const otra = await createUser({ role: 'VECINO' });
      await prisma.ticket.create({
        data: { reporterId: vecino.id, category: 'BUG', subject: 'mío', description: 'x' },
      });
      await prisma.ticket.create({
        data: { reporterId: otra.id, category: 'BUG', subject: 'ajeno', description: 'x' },
      });

      const res = await request(app)
        .get('/api/v1/me/tickets')
        .set('Authorization', `Bearer ${vecino.token}`);
      expect(res.status).toBe(200);
      expect(res.body.tickets).toHaveLength(1);
      expect(res.body.tickets[0].subject).toBe('mío');
    });
  });

  describe('GET /api/v1/tickets/:id', () => {
    it('reporter ve su ticket (200) sin notas internas', async () => {
      const support = await createUser({ role: 'SUPPORT' });
      const vecino = await createUser({ role: 'VECINO' });
      const ticket = await prisma.ticket.create({
        data: {
          reporterId: vecino.id,
          category: 'BUG',
          subject: 'x',
          description: 'y',
          comments: {
            create: [
              { authorId: vecino.id, body: 'pública', internal: false },
              { authorId: support.id, body: 'nota interna', internal: true },
            ],
          },
        },
      });

      const res = await request(app)
        .get(`/api/v1/tickets/${ticket.id}`)
        .set('Authorization', `Bearer ${vecino.token}`);
      expect(res.status).toBe(200);
      expect(res.body.ticket.comments).toHaveLength(1);
      expect(res.body.ticket.comments[0].body).toBe('pública');
    });

    it('support ve todas las notas (internas incluidas)', async () => {
      const support = await createUser({ role: 'SUPPORT' });
      const vecino = await createUser({ role: 'VECINO' });
      const ticket = await prisma.ticket.create({
        data: {
          reporterId: vecino.id,
          category: 'BUG',
          subject: 'x',
          description: 'y',
          comments: {
            create: [
              { authorId: vecino.id, body: 'pública', internal: false },
              { authorId: support.id, body: 'interna', internal: true },
            ],
          },
        },
      });

      const res = await request(app)
        .get(`/api/v1/tickets/${ticket.id}`)
        .set('Authorization', `Bearer ${support.token}`);
      expect(res.status).toBe(200);
      expect(res.body.ticket.comments).toHaveLength(2);
    });

    it('vecino ajeno recibe 403', async () => {
      const owner = await createUser({ role: 'VECINO' });
      const intruder = await createUser({ role: 'VECINO' });
      const ticket = await prisma.ticket.create({
        data: { reporterId: owner.id, category: 'BUG', subject: 'x', description: 'y' },
      });
      const res = await request(app)
        .get(`/api/v1/tickets/${ticket.id}`)
        .set('Authorization', `Bearer ${intruder.token}`);
      expect(res.status).toBe(403);
    });
  });

  describe('PATCH /api/v1/tickets/:id (solo SUPPORT)', () => {
    it('support cambia status a RESOLVED y fija resolvedAt', async () => {
      const support = await createUser({ role: 'SUPPORT' });
      const vecino = await createUser({ role: 'VECINO' });
      const ticket = await prisma.ticket.create({
        data: { reporterId: vecino.id, category: 'BUG', subject: 'x', description: 'y' },
      });

      const res = await request(app)
        .patch(`/api/v1/tickets/${ticket.id}`)
        .set('Authorization', `Bearer ${support.token}`)
        .send({ status: 'RESOLVED' });
      expect(res.status).toBe(200);
      expect(res.body.ticket.status).toBe('RESOLVED');
      expect(res.body.ticket.resolvedAt).not.toBeNull();
    });

    it('reabrir (OPEN) limpia resolvedAt', async () => {
      const support = await createUser({ role: 'SUPPORT' });
      const vecino = await createUser({ role: 'VECINO' });
      const ticket = await prisma.ticket.create({
        data: {
          reporterId: vecino.id,
          category: 'BUG',
          subject: 'x',
          description: 'y',
          status: 'RESOLVED',
          resolvedAt: new Date(),
        },
      });
      const res = await request(app)
        .patch(`/api/v1/tickets/${ticket.id}`)
        .set('Authorization', `Bearer ${support.token}`)
        .send({ status: 'OPEN' });
      expect(res.status).toBe(200);
      expect(res.body.ticket.resolvedAt).toBeNull();
    });

    it('vecino no puede modificar (403)', async () => {
      const vecino = await createUser({ role: 'VECINO' });
      const ticket = await prisma.ticket.create({
        data: { reporterId: vecino.id, category: 'BUG', subject: 'x', description: 'y' },
      });
      const res = await request(app)
        .patch(`/api/v1/tickets/${ticket.id}`)
        .set('Authorization', `Bearer ${vecino.token}`)
        .send({ status: 'RESOLVED' });
      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/v1/tickets/:id/comments', () => {
    it('reporter añade comentario (201)', async () => {
      const vecino = await createUser({ role: 'VECINO' });
      const ticket = await prisma.ticket.create({
        data: { reporterId: vecino.id, category: 'BUG', subject: 'x', description: 'y' },
      });
      const res = await request(app)
        .post(`/api/v1/tickets/${ticket.id}/comments`)
        .set('Authorization', `Bearer ${vecino.token}`)
        .send({ body: 'Más detalle' });
      expect(res.status).toBe(201);
      expect(res.body.comment.body).toBe('Más detalle');
      expect(res.body.comment.internal).toBe(false);
    });

    it('reporter NO puede marcar comentario como interno', async () => {
      const vecino = await createUser({ role: 'VECINO' });
      const ticket = await prisma.ticket.create({
        data: { reporterId: vecino.id, category: 'BUG', subject: 'x', description: 'y' },
      });
      const res = await request(app)
        .post(`/api/v1/tickets/${ticket.id}/comments`)
        .set('Authorization', `Bearer ${vecino.token}`)
        .send({ body: 'X', internal: true });
      expect(res.status).toBe(400);
    });

    it('support puede crear nota interna', async () => {
      const support = await createUser({ role: 'SUPPORT' });
      const vecino = await createUser({ role: 'VECINO' });
      const ticket = await prisma.ticket.create({
        data: { reporterId: vecino.id, category: 'BUG', subject: 'x', description: 'y' },
      });
      const res = await request(app)
        .post(`/api/v1/tickets/${ticket.id}/comments`)
        .set('Authorization', `Bearer ${support.token}`)
        .send({ body: 'nota', internal: true });
      expect(res.status).toBe(201);
      expect(res.body.comment.internal).toBe(true);
    });

    it('vecino ajeno no puede comentar (403)', async () => {
      const owner = await createUser({ role: 'VECINO' });
      const intruder = await createUser({ role: 'VECINO' });
      const ticket = await prisma.ticket.create({
        data: { reporterId: owner.id, category: 'BUG', subject: 'x', description: 'y' },
      });
      const res = await request(app)
        .post(`/api/v1/tickets/${ticket.id}/comments`)
        .set('Authorization', `Bearer ${intruder.token}`)
        .send({ body: 'X' });
      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/v1/support/tickets y /support/metrics', () => {
    it('support lista todos con filtros', async () => {
      const support = await createUser({ role: 'SUPPORT' });
      const vecino = await createUser({ role: 'VECINO' });
      await prisma.ticket.createMany({
        data: [
          { reporterId: vecino.id, category: 'BUG', subject: 'a', description: 'x', status: 'OPEN' },
          { reporterId: vecino.id, category: 'QUESTION', subject: 'b', description: 'x', status: 'RESOLVED' },
        ],
      });
      const res = await request(app)
        .get('/api/v1/support/tickets?status=OPEN')
        .set('Authorization', `Bearer ${support.token}`);
      expect(res.status).toBe(200);
      expect(res.body.tickets.every((t: { status: string }) => t.status === 'OPEN')).toBe(true);
    });

    it('vecino no accede a /support/tickets (403)', async () => {
      const vecino = await createUser({ role: 'VECINO' });
      const res = await request(app)
        .get('/api/v1/support/tickets')
        .set('Authorization', `Bearer ${vecino.token}`);
      expect(res.status).toBe(403);
    });

    it('support recibe métricas estructuradas', async () => {
      const support = await createUser({ role: 'SUPPORT' });
      const res = await request(app)
        .get('/api/v1/support/metrics')
        .set('Authorization', `Bearer ${support.token}`);
      expect(res.status).toBe(200);
      expect(res.body.users).toBeDefined();
      expect(res.body.platform).toBeDefined();
      expect(res.body.tickets).toBeDefined();
      expect(Array.isArray(res.body.recentTickets)).toBe(true);
    });

    it('vecino no accede a /support/metrics (403)', async () => {
      const vecino = await createUser({ role: 'VECINO' });
      const res = await request(app)
        .get('/api/v1/support/metrics')
        .set('Authorization', `Bearer ${vecino.token}`);
      expect(res.status).toBe(403);
    });
  });
});
