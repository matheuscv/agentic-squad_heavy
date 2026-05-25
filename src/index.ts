import { config } from 'dotenv';
config();

import express, { type Request, type Response } from 'express';
import { Pool } from 'pg';
import IORedis from 'ioredis';

const app = express();
const port = Number(process.env.PORT ?? 3000);

app.use(express.json());

// ─── Conexões ─────────────────────────────────────────────────────────────────

// Supabase exige SSL em produção — rejectUnauthorized:false aceita o certificado deles
const dbPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 2,
  connectionTimeoutMillis: 8_000,
});

// Upstash exige TLS — garante rediss:// independente do que estiver no .env
const rawRedisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
const redisUrl = rawRedisUrl.includes('upstash.io') && rawRedisUrl.startsWith('redis://')
  ? rawRedisUrl.replace('redis://', 'rediss://')
  : rawRedisUrl;

const redis = new IORedis(redisUrl, {
  maxRetriesPerRequest: 1,
  connectTimeout: 8_000,
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
  } catch (err) {
    console.error('[health] db error:', (err as Error).message);
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
