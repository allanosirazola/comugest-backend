import request from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/config/prisma';
import {
  cleanup,
  createCommunity,
  createUnit,
  createUser,
  setOwner,
} from './helpers';

const app = createApp();

const FUTURE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

describe('Invoices endpoints', () => {
  beforeAll(async () => {
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  describe('POST /api/v1/communities/:communityId/invoices (DERRAMA)', () => {
    it('reparte por coeficiente y la suma de items cuadra al céntimo', async () => {
      const admin = await createUser({ role: 'ADMIN_FINCAS' });
      const community = await createCommunity({ adminId: admin.id });
      await createUnit(community.id, { label: 'A', coefficient: 33.33 });
      await createUnit(community.id, { label: 'B', coefficient: 33.33 });
      await createUnit(community.id, { label: 'C', coefficient: 33.34 });

      const res = await request(app)
        .post(`/api/v1/communities/${community.id}/invoices`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({
          type: 'DERRAMA',
          concept: 'Derrama ascensor',
          totalAmount: 1000,
          dueDate: FUTURE,
        });

      expect(res.status).toBe(201);
      expect(res.body.invoice.items).toHaveLength(3);
      const sum = res.body.invoice.items.reduce(
        (acc: number, it: { amount: string }) => acc + Number(it.amount),
        0
      );
      expect(Math.round(sum * 100)).toBe(100000); // 1000.00€ exactos
    });

    it('reparte solo entre las unidades indicadas (unitIds)', async () => {
      const admin = await createUser({ role: 'ADMIN_FINCAS' });
      const community = await createCommunity({ adminId: admin.id });
      const u1 = await createUnit(community.id, { coefficient: 50 });
      const u2 = await createUnit(community.id, { coefficient: 50 });
      const u3 = await createUnit(community.id, { coefficient: 0, type: 'GARAJE' });

      const res = await request(app)
        .post(`/api/v1/communities/${community.id}/invoices`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({
          type: 'DERRAMA',
          concept: 'Solo viviendas',
          totalAmount: 600,
          dueDate: FUTURE,
          unitIds: [u1.id, u2.id],
        });

      expect(res.status).toBe(201);
      expect(res.body.invoice.items).toHaveLength(2);
      const ids = res.body.invoice.items.map((it: { unitId: string }) => it.unitId).sort();
      expect(ids).toEqual([u1.id, u2.id].sort());
      // Garaje (u3) excluido
      expect(ids).not.toContain(u3.id);
    });

    it('rechaza derrama si la comunidad no tiene unidades', async () => {
      const admin = await createUser({ role: 'ADMIN_FINCAS' });
      const community = await createCommunity({ adminId: admin.id });

      const res = await request(app)
        .post(`/api/v1/communities/${community.id}/invoices`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({
          type: 'DERRAMA',
          concept: 'Derrama imposible',
          totalAmount: 100,
          dueDate: FUTURE,
        });

      expect(res.status).toBe(400);
    });

    it('rechaza derrama si todas las unidades seleccionadas tienen coef 0', async () => {
      const admin = await createUser({ role: 'ADMIN_FINCAS' });
      const community = await createCommunity({ adminId: admin.id });
      const g1 = await createUnit(community.id, { coefficient: 0, type: 'GARAJE' });
      const g2 = await createUnit(community.id, { coefficient: 0, type: 'GARAJE' });

      const res = await request(app)
        .post(`/api/v1/communities/${community.id}/invoices`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({
          type: 'DERRAMA',
          concept: 'Derrama garajes',
          totalAmount: 100,
          dueDate: FUTURE,
          unitIds: [g1.id, g2.id],
        });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/v1/communities/:communityId/invoices (INDIVIDUAL)', () => {
    it('crea factura INDIVIDUAL con totalAmount = suma de items', async () => {
      const admin = await createUser({ role: 'ADMIN_FINCAS' });
      const community = await createCommunity({ adminId: admin.id });
      const u1 = await createUnit(community.id, { coefficient: 50 });
      const u2 = await createUnit(community.id, { coefficient: 50 });

      const res = await request(app)
        .post(`/api/v1/communities/${community.id}/invoices`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({
          type: 'INDIVIDUAL',
          concept: 'Agua Q1',
          dueDate: FUTURE,
          items: [
            { unitId: u1.id, amount: 12.5, consumptionValue: 3, consumptionUnit: 'm3' },
            { unitId: u2.id, amount: 30.25, consumptionValue: 7.5, consumptionUnit: 'm3' },
          ],
        });

      expect(res.status).toBe(201);
      expect(Number(res.body.invoice.totalAmount)).toBeCloseTo(42.75, 2);
      expect(res.body.invoice.items).toHaveLength(2);
    });

    it('rechaza items con unidad de OTRA comunidad', async () => {
      const admin = await createUser({ role: 'ADMIN_FINCAS' });
      const comA = await createCommunity({ adminId: admin.id });
      const comB = await createCommunity({ adminId: admin.id });
      const otherUnit = await createUnit(comB.id);

      const res = await request(app)
        .post(`/api/v1/communities/${comA.id}/invoices`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({
          type: 'INDIVIDUAL',
          concept: 'Mal',
          dueDate: FUTURE,
          items: [{ unitId: otherUnit.id, amount: 10 }],
        });

      expect(res.status).toBe(400);
    });

    it('rechaza items con unitIds duplicados', async () => {
      const admin = await createUser({ role: 'ADMIN_FINCAS' });
      const community = await createCommunity({ adminId: admin.id });
      const u = await createUnit(community.id);

      const res = await request(app)
        .post(`/api/v1/communities/${community.id}/invoices`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({
          type: 'INDIVIDUAL',
          concept: 'Dup',
          dueDate: FUTURE,
          items: [
            { unitId: u.id, amount: 5 },
            { unitId: u.id, amount: 5 },
          ],
        });

      expect(res.status).toBe(400);
    });

    it('un vecino no puede crear facturas (403)', async () => {
      const admin = await createUser({ role: 'ADMIN_FINCAS' });
      const vecino = await createUser({ role: 'VECINO' });
      const community = await createCommunity({ adminId: admin.id });
      const u = await createUnit(community.id);

      const res = await request(app)
        .post(`/api/v1/communities/${community.id}/invoices`)
        .set('Authorization', `Bearer ${vecino.token}`)
        .send({
          type: 'INDIVIDUAL',
          concept: 'Hack',
          dueDate: FUTURE,
          items: [{ unitId: u.id, amount: 5 }],
        });

      expect(res.status).toBe(403);
    });
  });

  describe('Pagos', () => {
    async function setupInvoiceItem(amount = 100): Promise<{
      adminToken: string;
      itemId: string;
      invoiceId: string;
      communityId: string;
    }> {
      const admin = await createUser({ role: 'ADMIN_FINCAS' });
      const community = await createCommunity({ adminId: admin.id });
      const unit = await createUnit(community.id, { coefficient: 100 });
      const invoice = await prisma.invoice.create({
        data: {
          communityId: community.id,
          type: 'INDIVIDUAL',
          concept: 'Test',
          totalAmount: amount,
          dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          issuedById: admin.id,
          items: { create: [{ unitId: unit.id, amount }] },
        },
        include: { items: true },
      });
      return {
        adminToken: admin.token,
        itemId: invoice.items[0].id,
        invoiceId: invoice.id,
        communityId: community.id,
      };
    }

    it('un pago parcial deja la factura PARTIALLY_PAID', async () => {
      const ctx = await setupInvoiceItem(100);

      const pay = await request(app)
        .post(`/api/v1/invoices/items/${ctx.itemId}/payments`)
        .set('Authorization', `Bearer ${ctx.adminToken}`)
        .send({ amount: 40, method: 'BANK_TRANSFER' });

      expect(pay.status).toBe(201);

      const detail = await request(app)
        .get(`/api/v1/invoices/${ctx.invoiceId}`)
        .set('Authorization', `Bearer ${ctx.adminToken}`);
      expect(detail.status).toBe(200);
      expect(detail.body.invoice.status).toBe('PARTIALLY_PAID');
    });

    it('un pago total deja la factura PAID', async () => {
      const ctx = await setupInvoiceItem(50);

      const pay = await request(app)
        .post(`/api/v1/invoices/items/${ctx.itemId}/payments`)
        .set('Authorization', `Bearer ${ctx.adminToken}`)
        .send({ amount: 50 });

      expect(pay.status).toBe(201);

      const detail = await request(app)
        .get(`/api/v1/invoices/${ctx.invoiceId}`)
        .set('Authorization', `Bearer ${ctx.adminToken}`);
      expect(detail.body.invoice.status).toBe('PAID');
    });

    it('rechaza sobrepago con 400', async () => {
      const ctx = await setupInvoiceItem(20);

      const pay = await request(app)
        .post(`/api/v1/invoices/items/${ctx.itemId}/payments`)
        .set('Authorization', `Bearer ${ctx.adminToken}`)
        .send({ amount: 30 });

      expect(pay.status).toBe(400);
    });

    it('borrar un pago devuelve 204 y la factura vuelve a PENDING', async () => {
      const ctx = await setupInvoiceItem(40);

      const pay = await request(app)
        .post(`/api/v1/invoices/items/${ctx.itemId}/payments`)
        .set('Authorization', `Bearer ${ctx.adminToken}`)
        .send({ amount: 40 });
      const paymentId = pay.body.payment.id;

      const del = await request(app)
        .delete(`/api/v1/invoices/payments/${paymentId}`)
        .set('Authorization', `Bearer ${ctx.adminToken}`);
      expect(del.status).toBe(204);

      const detail = await request(app)
        .get(`/api/v1/invoices/${ctx.invoiceId}`)
        .set('Authorization', `Bearer ${ctx.adminToken}`);
      expect(detail.body.invoice.status).toBe('PENDING');
    });
  });

  describe('Cancelación', () => {
    it('cancela factura sin pagos y la marca con cancelledAt', async () => {
      const admin = await createUser({ role: 'ADMIN_FINCAS' });
      const community = await createCommunity({ adminId: admin.id });
      const unit = await createUnit(community.id);
      const invoice = await prisma.invoice.create({
        data: {
          communityId: community.id,
          type: 'INDIVIDUAL',
          concept: 'A cancelar',
          totalAmount: 50,
          dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          issuedById: admin.id,
          items: { create: [{ unitId: unit.id, amount: 50 }] },
        },
      });

      const res = await request(app)
        .delete(`/api/v1/invoices/${invoice.id}`)
        .set('Authorization', `Bearer ${admin.token}`);
      expect(res.status).toBe(200);
      expect(res.body.invoice.cancelledAt).not.toBeNull();
    });

    it('rechaza cancelar si hay pagos registrados (409)', async () => {
      const admin = await createUser({ role: 'ADMIN_FINCAS' });
      const community = await createCommunity({ adminId: admin.id });
      const unit = await createUnit(community.id);
      const invoice = await prisma.invoice.create({
        data: {
          communityId: community.id,
          type: 'INDIVIDUAL',
          concept: 'Con pago',
          totalAmount: 50,
          dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          issuedById: admin.id,
          items: { create: [{ unitId: unit.id, amount: 50 }] },
        },
        include: { items: true },
      });
      await prisma.payment.create({
        data: { invoiceItemId: invoice.items[0].id, amount: 10, registeredById: admin.id },
      });

      const res = await request(app)
        .delete(`/api/v1/invoices/${invoice.id}`)
        .set('Authorization', `Bearer ${admin.token}`);
      expect(res.status).toBe(409);
    });
  });

  describe('Morosos', () => {
    it('agrupa items vencidos por propietario con totalPending', async () => {
      const admin = await createUser({ role: 'ADMIN_FINCAS' });
      const vecino = await createUser({ role: 'VECINO' });
      const community = await createCommunity({ adminId: admin.id });
      const unit = await createUnit(community.id, { coefficient: 100 });
      await setOwner(unit.id, vecino.id);

      await prisma.invoice.create({
        data: {
          communityId: community.id,
          type: 'INDIVIDUAL',
          concept: 'Atrasada',
          totalAmount: 100,
          issueDate: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
          dueDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
          issuedById: admin.id,
          items: { create: [{ unitId: unit.id, amount: 100 }] },
        },
      });

      const res = await request(app)
        .get(`/api/v1/communities/${community.id}/invoices/overdue`)
        .set('Authorization', `Bearer ${admin.token}`);

      expect(res.status).toBe(200);
      expect(res.body.overdueByOwner).toHaveLength(1);
      expect(res.body.overdueByOwner[0].owner.id).toBe(vecino.id);
      expect(res.body.overdueByOwner[0].totalPending).toBeCloseTo(100, 2);
    });

    it('no incluye items pagados ni dentro de plazo', async () => {
      const admin = await createUser({ role: 'ADMIN_FINCAS' });
      const vecino = await createUser({ role: 'VECINO' });
      const community = await createCommunity({ adminId: admin.id });
      const unit = await createUnit(community.id, { coefficient: 100 });
      await setOwner(unit.id, vecino.id);

      // Factura aún en plazo
      await prisma.invoice.create({
        data: {
          communityId: community.id,
          type: 'INDIVIDUAL',
          concept: 'En plazo',
          totalAmount: 60,
          dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          issuedById: admin.id,
          items: { create: [{ unitId: unit.id, amount: 60 }] },
        },
      });

      const res = await request(app)
        .get(`/api/v1/communities/${community.id}/invoices/overdue`)
        .set('Authorization', `Bearer ${admin.token}`);
      expect(res.status).toBe(200);
      expect(res.body.overdueByOwner).toEqual([]);
    });
  });

  describe('Listados con filtro de estado', () => {
    it('UNPAID excluye facturas totalmente pagadas', async () => {
      const admin = await createUser({ role: 'ADMIN_FINCAS' });
      const community = await createCommunity({ adminId: admin.id });
      const unit = await createUnit(community.id, { coefficient: 100 });

      const paid = await prisma.invoice.create({
        data: {
          communityId: community.id,
          type: 'INDIVIDUAL',
          concept: 'Pagada total',
          totalAmount: 30,
          dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          issuedById: admin.id,
          items: { create: [{ unitId: unit.id, amount: 30 }] },
        },
        include: { items: true },
      });
      await prisma.payment.create({
        data: { invoiceItemId: paid.items[0].id, amount: 30, registeredById: admin.id },
      });

      const pending = await prisma.invoice.create({
        data: {
          communityId: community.id,
          type: 'INDIVIDUAL',
          concept: 'Pendiente',
          totalAmount: 20,
          dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          issuedById: admin.id,
          items: { create: [{ unitId: unit.id, amount: 20 }] },
        },
      });

      const res = await request(app)
        .get(`/api/v1/communities/${community.id}/invoices?status=UNPAID`)
        .set('Authorization', `Bearer ${admin.token}`);
      expect(res.status).toBe(200);
      const ids = res.body.invoices.map((i: { id: string }) => i.id);
      expect(ids).toContain(pending.id);
      expect(ids).not.toContain(paid.id);
    });
  });

  describe('GET /api/v1/me/invoice-items (vista del vecino)', () => {
    it('el vecino ve sus items y nada más', async () => {
      const admin = await createUser({ role: 'ADMIN_FINCAS' });
      const vecinoA = await createUser({ role: 'VECINO' });
      const vecinoB = await createUser({ role: 'VECINO' });
      const community = await createCommunity({ adminId: admin.id });
      const unitA = await createUnit(community.id, { coefficient: 50 });
      const unitB = await createUnit(community.id, { coefficient: 50 });
      await setOwner(unitA.id, vecinoA.id);
      await setOwner(unitB.id, vecinoB.id);

      await prisma.invoice.create({
        data: {
          communityId: community.id,
          type: 'INDIVIDUAL',
          concept: 'Para A',
          totalAmount: 20,
          dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          issuedById: admin.id,
          items: { create: [{ unitId: unitA.id, amount: 20 }] },
        },
      });
      await prisma.invoice.create({
        data: {
          communityId: community.id,
          type: 'INDIVIDUAL',
          concept: 'Para B',
          totalAmount: 35,
          dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          issuedById: admin.id,
          items: { create: [{ unitId: unitB.id, amount: 35 }] },
        },
      });

      const res = await request(app)
        .get('/api/v1/me/invoice-items')
        .set('Authorization', `Bearer ${vecinoA.token}`);
      expect(res.status).toBe(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].unit.id).toBe(unitA.id);
    });

    it('sin token responde 401', async () => {
      const res = await request(app).get('/api/v1/me/invoice-items');
      expect(res.status).toBe(401);
    });
  });

  describe('Autorización', () => {
    it('admin AJENO no ve la factura (403)', async () => {
      const owner = await createUser({ role: 'ADMIN_FINCAS' });
      const intruder = await createUser({ role: 'ADMIN_FINCAS' });
      const community = await createCommunity({ adminId: owner.id });
      const unit = await createUnit(community.id);
      const invoice = await prisma.invoice.create({
        data: {
          communityId: community.id,
          type: 'INDIVIDUAL',
          concept: 'X',
          totalAmount: 10,
          dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          issuedById: owner.id,
          items: { create: [{ unitId: unit.id, amount: 10 }] },
        },
      });

      const res = await request(app)
        .get(`/api/v1/invoices/${invoice.id}`)
        .set('Authorization', `Bearer ${intruder.token}`);
      expect(res.status).toBe(403);
    });
  });
});

