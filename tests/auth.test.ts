import request from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/config/prisma';
import { generateVerificationToken } from '../src/utils/tokens';

const app = createApp();

const validUser = {
  email: 'test.vecino@example.com',
  password: 'TestPass123',
  firstName: 'Juan',
  lastName: 'García',
  role: 'VECINO' as const,
  locale: 'es' as const,
  gdprAccepted: true as const,
};

describe('Auth endpoints', () => {
  beforeAll(async () => {
    await prisma.verificationToken.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany({ where: { email: { contains: '@example.com' } } });
  });

  afterAll(async () => {
    await prisma.verificationToken.deleteMany();
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany({ where: { email: { contains: '@example.com' } } });
    await prisma.$disconnect();
  });

  describe('POST /api/v1/auth/register', () => {
    it('debe registrar y devolver 202 (requiere verificación)', async () => {
      const res = await request(app).post('/api/v1/auth/register').send(validUser);
      expect(res.status).toBe(202);
      expect(res.body.requiresEmailVerification).toBe(true);
      expect(res.body.email).toBe(validUser.email);
      expect(res.body.accessToken).toBeUndefined();
    });

    it('debe rechazar email duplicado (cuenta ya pendiente) con 409', async () => {
      const res = await request(app).post('/api/v1/auth/register').send(validUser);
      expect(res.status).toBe(409);
    });

    it('debe rechazar contraseña débil con 400', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({ ...validUser, email: 'weak@example.com', password: '123' });
      expect(res.status).toBe(400);
    });

    it('debe exigir aceptación de GDPR', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({ ...validUser, email: 'nogdpr@example.com', gdprAccepted: false });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/v1/auth/login (sin verificar)', () => {
    it('debe rechazar login con 403 mientras la cuenta esté PENDING', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: validUser.email, password: validUser.password });
      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/v1/auth/verify-email', () => {
    it('debe verificar el email con un token válido y devolver tokens', async () => {
      // Inyectamos un token directamente en BD para testear (en real lo crea el servicio al registrar)
      const user = await prisma.user.findUnique({ where: { email: validUser.email } });
      expect(user).not.toBeNull();

      const { token, tokenHash } = generateVerificationToken();
      await prisma.verificationToken.create({
        data: {
          tokenHash,
          type: 'EMAIL_VERIFICATION',
          userId: user!.id,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
      });

      const res = await request(app).post('/api/v1/auth/verify-email').send({ token });
      expect(res.status).toBe(200);
      expect(res.body.accessToken).toBeDefined();
      expect(res.body.user.status).toBe('ACTIVE');
    });

    it('debe rechazar un token inválido con 404', async () => {
      const res = await request(app).post('/api/v1/auth/verify-email').send({ token: 'invalid' });
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/v1/auth/login (verificado)', () => {
    it('debe loguear correctamente tras verificar', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: validUser.email, password: validUser.password });
      expect(res.status).toBe(200);
      expect(res.body.accessToken).toBeDefined();
    });

    it('debe rechazar contraseña incorrecta con 401', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: validUser.email, password: 'BadPassword123' });
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/v1/auth/me', () => {
    it('debe devolver datos del usuario autenticado', async () => {
      const login = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: validUser.email, password: validUser.password });

      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${login.body.accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.user.email).toBe(validUser.email);
    });

    it('debe rechazar sin token con 401', async () => {
      const res = await request(app).get('/api/v1/auth/me');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/v1/auth/refresh', () => {
    it('debe rotar el refresh token', async () => {
      const login = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: validUser.email, password: validUser.password });

      const res = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: login.body.refreshToken });

      expect(res.status).toBe(200);
      expect(res.body.refreshToken).not.toBe(login.body.refreshToken);

      const reuse = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: login.body.refreshToken });
      expect(reuse.status).toBe(401);
    });
  });
});
