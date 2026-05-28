import { config } from 'dotenv';
config();

// Render free tier não suporta IPv6 de saída — força resolução DNS para IPv4
import { setDefaultResultOrder } from 'dns';
setDefaultResultOrder('ipv4first');

import express, { type Request, type Response } from 'express';
import { Pool } from 'pg';
import IORedis from 'ioredis';
import { sql, eq } from 'drizzle-orm';
import { getAvgDurationByAgent, getSuccessRateByAgent, getCorrectionLoopsByStory } from './lib/metrics';
import jiraWebhookRouter from './webhooks/jira';
import { createOrchestratorWorker, createReconciler } from './orchestrator';
import { createPoAgentWorker } from './agents/po';
import { createLtAgentWorker } from './agents/lt';
import { createDevAgentWorker } from './agents/dev-agent';
import { createQaAgentWorker } from './agents/qa-agent';
import { poAgentQueue } from './agents/po';
import { ltAgentQueue } from './agents/lt';
import { devAgentQueue } from './agents/dev-agent';
import { qaAgentQueue } from './agents/qa-agent';
import { orchestratorQueue, agentDlqQueue } from './queue/index';
import { db, schema } from './db/index';
import { logger } from './lib/logger';
import { recoverInterruptedRuns } from './lib/startup-recovery';

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

app.get('/health/detailed', async (_req: Request, res: Response) => {
  const checks: Record<string, unknown> = {};

  // ── Banco de dados ─────────────────────────────────────────────────────────
  try {
    await dbPool.query('SELECT 1');
    checks['database'] = 'ok';
  } catch (err) {
    checks['database'] = 'error';
    logger.error({ err: (err as Error).message }, 'health/detailed: falha no banco');
  }

  // ── Redis ──────────────────────────────────────────────────────────────────
  try {
    await redis.ping();
    checks['redis'] = 'ok';
  } catch {
    checks['redis'] = 'error';
  }

  // ── Filas BullMQ ───────────────────────────────────────────────────────────
  const allQueues: Record<string, typeof orchestratorQueue> = {
    orchestrator: orchestratorQueue,
    'agent-po':  poAgentQueue,
    'agent-lt':  ltAgentQueue,
    'agent-dev': devAgentQueue,
    'agent-qa':  qaAgentQueue,
    'agent-dlq': agentDlqQueue,
  };

  const queueStats: Record<string, unknown> = {};
  await Promise.allSettled(
    Object.entries(allQueues).map(async ([name, queue]) => {
      try {
        const counts = await queue.getJobCounts('waiting', 'active', 'failed', 'delayed', 'completed');
        queueStats[name] = counts;
      } catch (err) {
        queueStats[name] = { error: (err as Error).message };
      }
    }),
  );
  checks['queues'] = queueStats;

  // DLQ com jobs aguardando = atenção humana necessária
  const dlqWaiting = (queueStats['agent-dlq'] as Record<string, number> | undefined)?.['waiting'] ?? 0;
  const infra_ok = checks['database'] === 'ok' && checks['redis'] === 'ok';
  const status = !infra_ok ? 'degraded' : dlqWaiting > 0 ? 'attention' : 'ok';

  res.status(infra_ok ? 200 : 503).json({
    status,
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    checks,
  });
});

app.get('/metrics', async (_req: Request, res: Response) => {
  try {
    const [durationRows, statusRows, correctionRows] = await Promise.all([
      getAvgDurationByAgent(),
      getSuccessRateByAgent(),
      getCorrectionLoopsByStory(),
    ]);

    const avgDurationByPhase = Object.fromEntries(
      durationRows.map((r) => [
        r.agentType,
        {
          avgDurationMs: Number(r.avgDurationMs),
          p50DurationMs: Number(r.p50DurationMs),
          p95DurationMs: Number(r.p95DurationMs),
          totalRuns:     Number(r.totalRuns),
        },
      ]),
    );

    const successRate = Object.fromEntries(
      statusRows.map((r) => {
        const total     = Number(r.total);
        const completed = Number(r.completed);
        const failed    = Number(r.failed);
        return [
          r.agentType,
          { total, completed, failed, rate: total > 0 ? parseFloat((completed / total).toFixed(4)) : 0 },
        ];
      }),
    );

    res.json({
      avgDurationByPhase,
      successRate,
      correctionLoopsByStory: correctionRows.map((r) => ({
        jiraKey:     r.jiraKey,
        corrections: Number(r.corrections),
      })),
    });
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'falha ao calcular métricas');
    res.status(500).json({ error: 'falha ao calcular métricas' });
  }
});

app.get('/metrics/cost', async (_req: Request, res: Response) => {
  try {
    const [byAgentRows, byStoryRows] = await Promise.all([
      db
        .select({
          agentType: schema.agentRuns.agentType,
          inputTokens:  sql<number>`coalesce(sum(${schema.agentRuns.inputTokens}), 0)`,
          outputTokens: sql<number>`coalesce(sum(${schema.agentRuns.outputTokens}), 0)`,
          costUsd:      sql<number>`coalesce(sum(${schema.agentRuns.costUsd}), 0)`,
          runs:         sql<number>`count(*)`,
        })
        .from(schema.agentRuns)
        .where(eq(schema.agentRuns.status, 'completed'))
        .groupBy(schema.agentRuns.agentType),

      db
        .select({
          jiraKey:      schema.stories.jiraKey,
          inputTokens:  sql<number>`coalesce(sum(${schema.agentRuns.inputTokens}), 0)`,
          outputTokens: sql<number>`coalesce(sum(${schema.agentRuns.outputTokens}), 0)`,
          costUsd:      sql<number>`coalesce(sum(${schema.agentRuns.costUsd}), 0)`,
          runs:         sql<number>`count(*)`,
        })
        .from(schema.agentRuns)
        .innerJoin(schema.stories, eq(schema.agentRuns.storyId, schema.stories.id))
        .where(eq(schema.agentRuns.status, 'completed'))
        .groupBy(schema.stories.jiraKey)
        .orderBy(sql`sum(${schema.agentRuns.costUsd}) desc nulls last`),
    ]);

    const totalInputTokens  = byAgentRows.reduce((s, r) => s + Number(r.inputTokens),  0);
    const totalOutputTokens = byAgentRows.reduce((s, r) => s + Number(r.outputTokens), 0);
    const totalCostUsd      = byAgentRows.reduce((s, r) => s + Number(r.costUsd),      0);

    res.json({
      summary: {
        totalInputTokens,
        totalOutputTokens,
        totalCostUsd: parseFloat(totalCostUsd.toFixed(6)),
      },
      byAgent: Object.fromEntries(
        byAgentRows.map((r) => [
          r.agentType,
          {
            inputTokens:  Number(r.inputTokens),
            outputTokens: Number(r.outputTokens),
            costUsd:      parseFloat(Number(r.costUsd).toFixed(6)),
            runs:         Number(r.runs),
          },
        ]),
      ),
      byStory: byStoryRows.map((r) => ({
        jiraKey:      r.jiraKey,
        inputTokens:  Number(r.inputTokens),
        outputTokens: Number(r.outputTokens),
        costUsd:      parseFloat(Number(r.costUsd).toFixed(6)),
        runs:         Number(r.runs),
      })),
    });
  } catch (err) {
    logger.error({ err: (err as Error).message }, 'falha ao calcular métricas de custo');
    res.status(500).json({ error: 'falha ao calcular métricas de custo' });
  }
});

// ─── Inicialização ────────────────────────────────────────────────────────────

const orchestratorWorker = createOrchestratorWorker();
const poAgentWorker = createPoAgentWorker();
const ltAgentWorker = createLtAgentWorker();
const devAgentWorker = createDevAgentWorker();
const qaAgentWorker = createQaAgentWorker();
const reconcilerInterval = createReconciler();

const server = app.listen(port, () => {
  logger.info({ port, env: process.env.NODE_ENV ?? 'development' }, 'servidor iniciado');
  // Recupera jobs interrompidos por crash/restart anterior (idempotente via jobId BullMQ)
  void recoverInterruptedRuns({ po: poAgentQueue, lt: ltAgentQueue, dev: devAgentQueue, qa: qaAgentQueue });
});

// ─── Graceful shutdown ────────────────────────────────────────────────────────
//
// Sequência: para HTTP → pausa workers → drena jobs ativos (máx 30s) → fecha conexões.
// Se o timeout expirar, os workers são fechados forçadamente e o processo sai com código 1.

const SHUTDOWN_TIMEOUT_MS = 30_000;

const shutdown = async (signal: string) => {
  logger.info({ signal }, 'sinal recebido — iniciando graceful shutdown');

  // 1. Para de aceitar novas conexões HTTP e cancela o reconciler
  server.close();
  clearInterval(reconcilerInterval);

  // 2. Timer de segurança: força saída se o drain demorar demais
  const forceExitTimer = setTimeout(() => {
    logger.warn({ timeoutMs: SHUTDOWN_TIMEOUT_MS }, 'timeout de graceful shutdown — saindo forçado');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExitTimer.unref();

  // 3. Drena workers (espera jobs ativos concluírem; close() já inclui pause interno)
  logger.info('aguardando jobs ativos concluírem...');
  await Promise.allSettled([
    orchestratorWorker.close(),
    poAgentWorker.close(),
    ltAgentWorker.close(),
    devAgentWorker.close(),
    qaAgentWorker.close(),
  ]);
  logger.info('workers drenados');

  // 4. Fecha filas e conexões
  await Promise.allSettled([
    orchestratorQueue.close(),
    poAgentQueue.close(),
    ltAgentQueue.close(),
    devAgentQueue.close(),
    qaAgentQueue.close(),
    agentDlqQueue.close(),
    dbPool.end(),
    redis.quit(),
  ]);

  clearTimeout(forceExitTimer);
  logger.info('encerramento concluído');
  process.exit(0);
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

export { app };
