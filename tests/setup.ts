// Variables de entorno mínimas para tests (antes de cargar env.ts)
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://comugest:comugest@localhost:5432/comugest_test';
process.env.JWT_ACCESS_SECRET = 'test_access_secret_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
process.env.JWT_REFRESH_SECRET = 'test_refresh_secret_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
process.env.JWT_ACCESS_EXPIRES_IN = '15m';
process.env.JWT_REFRESH_EXPIRES_IN = '30d';
process.env.BCRYPT_ROUNDS = '4'; // Más rápido para tests
process.env.LOG_LEVEL = 'error';
