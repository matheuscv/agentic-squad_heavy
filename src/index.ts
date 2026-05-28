import { config } from 'dotenv';
config();

// Render free tier não suporta IPv6 de saída — força resolução DNS para IPv4
import { setDefaultResultOrder } from 'dns';
setDefaultResultOrder('ipv4first');

import express, { type Request, type Response } from 'express';
import pingRouter from './routes/ping';
import { logger } from './lib/logger';

// ─── Configuração do app Express (sem side-effects de I/O) ────────────────────

const app = express();

app.use(express.json());

// ─── Rotas estáticas (sem dependências externas) ──────────────────────────────

app.use('/ping', pingRouter); // liveness probe — sem dependências externas

// Placeholder de /health — será sobrescrito após bootstrap() com acesso real ao pool/redis
app.get('/health', (_req: Request, res: Response): void => {
  res.status(503).json({ status: 'degraded', message: 'servidor não inicializado' });
});

// ─── bootstrap — toda I/O real acontece aqui, nunca no nível do módulo ────────

export async function bootstrap(): Promise<void> {
  const port = Number(process.env.PORT ?? 3000);

  // ── Imports lazy (side-effects: conexões reais a banco, Redis, BullMQ) ──────
  const [
    { Pool },
    { default: IORedis },
    { sql, eq },
    { getAvgDurationByAgent, getSuccessRateByAgent, getCorrectionLoopsByStory },
    { default: jiraWebhookRouter },
    { createOrchestratorWorker, createReconciler },
    { createPoAgentWorker },
    { createLtAgentWorker },
    { createDevAgentWorker },
    { createQaAgentWorker },
    { db, schema },
  ] = await Promise.all([
    import('pg'),
    import('ioredis'),
    import('drizzle-orm'),
    import('./lib/metrics'),
    import('./webhooks/jira'),
    import('./orchestrator'),
    import('./agents/po'),
    import('./agents/lt'),
    import('./agents/dev-agent'),
    import('./agents/qa-agent'),
    import('./db/index'),
  ]);

  // ── Rotas dinâmicas (dependem de módulos com side-effects) ──────────────────
  app.use('/webhooks', jiraWebhookRouter);

  // ── Conexões externas ──────────────────────────────────────────────────────

  const dbPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 2,
    connectionTimeoutMillis: 8_000,
  });

  const rawRedisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
  const redisUrl =
    rawRedisUrl.includes('upstash.io') && rawRedisUrl.startsWith('redis://')
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

  // ── Handlers com acesso a pool/redis/db (registrados após conexões prontas) ─

  app.get('/health', async (_req: Request, res: Response): Promise<void> => {
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

  app.get('/metrics', async (_req: Request, res: Response): Promise<void> => {
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

  app.get('/metrics/cost', async (_req: Request, res: Response): Promise<void> => {
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

  // ── Workers BullMQ ─────────────────────────────────────────────────────────

  const orchestratorWorker = createOrchestratorWorker();
  const poAgentWorker      = createPoAgentWorker();
  const ltAgentWorker      = createLtAgentWorker();
  const devAgentWorker     = createDevAgentWorker();
  const qaAgentWorker      = createQaAgentWorker();
  const reconcilerInterval = createReconciler();

  // ── Servidor HTTP ──────────────────────────────────────────────────────────

  const server = app.listen(port, () => {
    logger.info({ port, env: process.env.NODE_ENV ?? 'development' }, 'servidor iniciado');
  });

  // ── Graceful shutdown ──────────────────────────────────────────────────────

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'sinal recebido — encerrando');
    server.close(async () => {
      clearInterval(reconcilerInterval);
      await Promise.allSettled([
        dbPool.end(),
        redis.quit(),
        orchestratorWorker.close(),
        poAgentWorker.close(),
        ltAgentWorker.close(),
        devAgentWorker.close(),
        qaAgentWorker.close(),
      ]);
      logger.info('servidor encerrado com sucesso');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT',  () => void shutdown('SIGINT'));
}

// ─── Entrypoint — só executa quando o arquivo é o ponto de entrada ────────────

const isMain =
  typeof process.argv[1] !== 'undefined' &&
  (process.argv[1].endsWith('index.ts') ||
    process.argv[1].endsWith('index.js') ||
    process.argv[1].endsWith('src/index'));

if (isMain) {
  void bootstrap();
}

export { app };
