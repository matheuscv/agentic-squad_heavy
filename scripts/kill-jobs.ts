/**
 * Remove todos os jobs das filas agent-qa e agent-dev e marca os agentRuns
 * correspondentes como 'failed' no banco para evitar registros órfãos.
 *
 * Uso:
 *   npm run kill-jobs
 *   npm run kill-jobs -- --queue agent-qa
 *   npm run kill-jobs -- --queue agent-dev
 */

import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { drizzle } from 'drizzle-orm/node-postgres';
import { inArray } from 'drizzle-orm';
import pg from 'pg';
import * as schema from '../src/db/schema';

// ─── Redis ────────────────────────────────────────────────────────────────────

const rawUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
const redisUrl =
  rawUrl.includes('upstash.io') && rawUrl.startsWith('redis://')
    ? rawUrl.replace('redis://', 'rediss://')
    : rawUrl;

const connection = new IORedis(redisUrl, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

// ─── DB ───────────────────────────────────────────────────────────────────────

const pgClient = new pg.Client({ connectionString: process.env.DATABASE_URL });

const STATES = ['waiting', 'active', 'delayed', 'failed', 'paused'] as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function inspectQueue(queue: Queue): Promise<{ count: number; runIds: string[] }> {
  const jobs = await queue.getJobs(STATES, 0, 100);
  if (jobs.length === 0) {
    console.log(`   (vazia)`);
    return { count: 0, runIds: [] };
  }

  const runIds: string[] = [];
  for (const job of jobs) {
    const state = await job.getState();
    const runId = (job.data as Record<string, unknown>)?.agentRunId as string | undefined;
    const jiraKey = (job.data as Record<string, unknown>)?.jiraKey ?? '—';
    const attempt = `${job.attemptsMade + 1}/${job.opts.attempts ?? 1}`;
    console.log(
      `   [${state.padEnd(7)}] id=${job.id}  jiraKey=${jiraKey}  runId=${String(runId ?? '—').slice(0, 8)}…  tentativa=${attempt}`,
    );
    if (runId) runIds.push(runId);
  }
  return { count: jobs.length, runIds };
}

async function killQueue(queueName: string, db: ReturnType<typeof drizzle>): Promise<string[]> {
  const queue = new Queue(queueName, { connection });
  console.log(`\n🔍 Fila "${queueName}":`);
  const { count, runIds } = await inspectQueue(queue);

  if (count === 0) {
    await queue.close();
    return [];
  }

  await queue.obliterate({ force: true });
  console.log(`   ✅ ${count} job(s) removidos de "${queueName}"`);
  await queue.close();
  return runIds;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const queueFlag = args.indexOf('--queue');
  const targetQueues =
    queueFlag !== -1 && args[queueFlag + 1]
      ? [args[queueFlag + 1]!]
      : ['agent-qa', 'agent-dev'];

  console.log('🗑️  kill-jobs — removendo jobs das filas:', targetQueues.join(', '));

  await pgClient.connect();
  const db = drizzle(pgClient, { schema });

  const allRunIds: string[] = [];
  for (const name of targetQueues) {
    const runIds = await killQueue(name, db);
    allRunIds.push(...runIds);
  }

  // Marca agentRuns correspondentes como 'failed' no banco
  if (allRunIds.length > 0) {
    console.log(`\n🗃️  Atualizando ${allRunIds.length} registro(s) no banco para status=failed...`);
    await db
      .update(schema.agentRuns)
      .set({
        status: 'failed',
        errorMessage: 'Job encerrado manualmente via kill-jobs',
        completedAt: new Date(),
      })
      .where(inArray(schema.agentRuns.id, allRunIds));
    console.log(`   ✅ Banco atualizado`);
  }

  // Limpa também quaisquer registros pending/running órfãos sem job no BullMQ
  // (pode acontecer quando o script é rodado após os jobs já terem sido removidos antes)
  console.log(`\n🗃️  Limpando registros pending/running órfãos no banco...`);
  const { rowCount } = await pgClient.query(`
    UPDATE agent_runs
    SET status = 'failed',
        error_message = 'Job encerrado manualmente via kill-jobs',
        completed_at = NOW()
    WHERE status IN ('running', 'pending')
      AND agent_type IN ('qa', 'dev')
  `);
  if ((rowCount ?? 0) > 0) {
    console.log(`   ✅ ${rowCount} registro(s) órfão(s) limpos`);
  } else {
    console.log(`   (nenhum órfão encontrado)`);
  }

  console.log('\n✅ Concluído.\n');
  await pgClient.end();
  await connection.quit();
}

main().catch((err: Error) => {
  console.error('Erro:', err.message);
  process.exit(1);
});
