import { config } from 'dotenv';
config();

import express, { type Request, type Response } from 'express';
import { Pool } from 'pg';
import IORedis from 'ioredis';

const app = express();
const port = Number(process.env.PORT ?? 3000);

app.use(express.json());

// ─── Conexões ─────────────────────────────────────────────────────────────────

const dbPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 2,
  connectionTimeoutMillis: 3_000,
});

const redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: 1,
  connectTimeout: 3_000,
  lazyConnect: true,
});

redis.on('error', (err: Error) => {
  console.error('[redis] erro de conexão:', err.message);
});

// ─── Rotas ────────────────────────────────────────────────────────────────────

app.get('/health', async (_req: Request, res: Response) => {
  const checks: Record<string, 'ok' | 'error'> = {};

  // Verifica banco
  try {
    await dbPool.query('SELECT 1');
    checks.database = 'ok';
  } catch {
    checks.database = 'error';
  }

  // Verifica Redis
  try {
    await redis.ping();
    checks.redis = 'ok';
  } catch {
    checks.redis = 'error';
  }

  const healthy = Object.values(checks).every((v) => v === 'ok');

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    checks,
  });
});

// ─── Inicialização ────────────────────────────────────────────────────────────

const server = app.listen(port, () => {
  console.log(`[server] rodando na porta ${port} (${process.env.NODE_ENV ?? 'development'})`);
});

// ─── Graceful shutdown ────────────────────────────────────────────────────────

const shutdown = async (signal: string) => {
  console.log(`[server] ${signal} recebido — encerrando...`);
  server.close(async () => {
    await Promise.allSettled([dbPool.end(), redis.quit()]);
    console.log('[server] encerrado com sucesso');
    process.exit(0);
  });
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

export { app };
