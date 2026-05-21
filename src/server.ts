import { createApp } from './app';
import { env } from './config/env';
import { logger } from './config/logger';
import { prisma } from './config/prisma';

async function main(): Promise<void> {
  // Verificar conexión a BD antes de arrancar
  try {
    await prisma.$connect();
    logger.info('✅ Conexión a base de datos establecida');
  } catch (err) {
    logger.error('❌ No se pudo conectar a la base de datos', { err });
    process.exit(1);
  }

  const app = createApp();

  const server = app.listen(env.PORT, () => {
    logger.info(`🚀 Comugest API arrancado en http://localhost:${env.PORT} [${env.NODE_ENV}]`);
  });

  // Graceful shutdown
  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`Señal ${signal} recibida, cerrando servidor...`);
    server.close(async () => {
      await prisma.$disconnect();
      logger.info('Servidor cerrado limpiamente.');
      process.exit(0);
    });
    setTimeout(() => {
      logger.error('Forzando cierre tras 10s sin shutdown limpio.');
      process.exit(1);
    }, 10_000).unref();
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error('Fallo fatal al arrancar', { err });
  process.exit(1);
});
