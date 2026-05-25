import { config } from 'dotenv';
config();

// Render free tier não suporta IPv6 de saída — força resolução DNS para IPv4
import { setDefaultResultOrder } from 'dns';
setDefaultResultOrder('ipv4first');

import express, { type Request, type Response } from 'express';
import { Pool } from 'pg';
import IORedis from 'ioredis';
import jiraWebhookRouter from './webhooks/jira';
import { createOrchestratorWorker, createReconciler } from './orchestrator';
import { createPoAgentWorker } from './agents/po';
import { createLtAgentWorker } from './agents/lt';
import { logger } from './lib/logger';

const app = express();
const port = Number(process.env.PORT ?? 3000);

app.use(express.json());

// ─── Conexões ─────────────────────────────────────────────────────────────────

const dbPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 2,
  connectionTimeoutMillis: 8_000,
});

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
  logger.error({ err: err.message }, 'erro de conexão Redis');
});

// ─── Rotas ────────────────────────────────────────────────────────────────────

app.use('/webhooks', jiraWebhookRouter);

app.get('/health', async (_req: Request, res: Response) => {
  const checks: Record<string, 'ok' | 'error'> = {};

  let dbError: string | undefined;
  try {
    await dbPool.query('SELECT 1');
    checks.database = 'ok';
  } catch (err) {
    dbError = (err as Error).message;
    logger.error({ err: dbError }, 'health check: falha no banco');
    checks.database = 'error';
  }

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
    ...(dbError && { dbError }),
  });
});

// ─── Inicialização ────────────────────────────────────────────────────────────

const orchestratorWorker = createOrchestratorWorker();
const poAgentWorker = createPoAgentWorker();
const ltAgentWorker = createLtAgentWorker();
const reconcilerInterval = createReconciler();

const server = app.listen(port, () => {
  logger.info({ port, env: process.env.NODE_ENV ?? 'development' }, 'servidor iniciado');
});

// ─── Graceful shutdown ────────────────────────────────────────────────────────

const shutdown = async (signal: string) => {
  logger.info({ signal }, 'sinal recebido — encerrando');
  server.close(async () => {
    clearInterval(reconcilerInterval);
    await Promise.allSettled([
      dbPool.end(),
      redis.quit(),
      orchestratorWorker.close(),
      poAgentWorker.close(),
      ltAgentWorker.close(),
    ]);
    logger.info('servidor encerrado com sucesso');
    process.exit(0);
  });
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

export { app };
