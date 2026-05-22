// Variables de entorno mínimas para tests (antes de cargar env.ts)
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://comugest:comugest@localhost:5432/comugest_test';
process.env.JWT_ACCESS_SECRET = 'test_access_secret_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
process.env.JWT_REFRESH_SECRET = 'test_refresh_secret_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
process.env.JWT_ACCESS_EXPIRES_IN = '15m';
process.env.JWT_REFRESH_EXPIRES_IN = '30d';
// 10 es el mínimo que permite env.ts; lo más rápido sin tocar la validación.
process.env.BCRYPT_ROUNDS = '10';
process.env.LOG_LEVEL = 'error';
// Eleva el rate-limit para que múltiples suites no provoquen 429 espurios.
process.env.RATE_LIMIT_MAX = '100000';
