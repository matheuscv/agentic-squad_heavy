/**
 * Lista todos os jobs em execução (e pendentes/atrasados) em todas as filas,
 * cruzando com o status no banco de dados.
 *
 * Uso:
 *   npm run list-jobs
 */

import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import pg from 'pg';

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

// ─── Constantes ───────────────────────────────────────────────────────────────

const ALL_QUEUES = ['orchestrator', 'agent-po', 'agent-lt', 'agent-dev', 'agent-qa'];
const STATES = ['waiting', 'active', 'delayed', 'paused'] as const;

const STATE_ICON: Record<string, string> = {
  active:  '🟢',
  waiting: '🟡',
  delayed: '🕐',
  paused:  '⏸️ ',
};

function elapsed(ms: number): string {
  const s = Math.floor(Math.abs(ms) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  await pgClient.connect();

  const now = Date.now();
  let totalJobs = 0;
  const activeRunIds = new Set<string>();

  console.log('\n══════════════════════════════════════════════════════');
  console.log('  📋  Estado atual das filas — ' + new Date().toLocaleTimeString('pt-BR'));
  console.log('══════════════════════════════════════════════════════');

  for (const queueName of ALL_QUEUES) {
    const queue = new Queue(queueName, { connection });
    const jobs = await queue.getJobs(STATES, 0, 50);
    await queue.close();

    if (jobs.length === 0) continue;

    totalJobs += jobs.length;
    console.log(`\n  ┌─ ${queueName} (${jobs.length} job${jobs.length > 1 ? 's' : ''})`);

    for (const job of jobs) {
      const state = await job.getState();
      const icon = STATE_ICON[state] ?? '⬜';
      const jiraKey  = (job.data as Record<string, unknown>)?.jiraKey ?? '—';
      const runId    = (job.data as Record<string, unknown>)?.agentRunId as string | undefined;
      const corrMode = (job.data as Record<string, unknown>)?.correctionMode ? ' [correção]' : '';
      const attempt  = `tentativa ${job.attemptsMade + 1}/${job.opts.attempts ?? 1}`;
      const age      = job.processedOn ? elapsed(now - job.processedOn) : (job.timestamp ? elapsed(now - job.timestamp) : '—');

      if (runId) activeRunIds.add(runId);

      console.log(`  │`);
      console.log(`  │  ${icon} ${state.toUpperCase()}${corrMode}`);
      console.log(`  │     jiraKey  : ${jiraKey}`);
      console.log(`  │     job id   : ${job.id}`);
      if (runId) console.log(`  │     run id   : ${runId}`);
      console.log(`  │     ${attempt}   |   há ${age}`);

      // Status no banco (apenas confirma se está running/pending/completed/failed)
      if (runId) {
        const { rows } = await pgClient.query<{ status: string }>(
          `SELECT status FROM agent_runs WHERE id = $1`,
          [runId],
        );
        if (rows[0]) {
          console.log(`  │     banco    : status=${rows[0].status}`);
        }
      }
    }

    console.log(`  └${'─'.repeat(50)}`);
  }

  if (totalJobs === 0) {
    console.log('\n  ✅  Nenhum job ativo no momento — todas as filas estão vazias.\n');
  } else {
    console.log(`\n  Total: ${totalJobs} job(s) em execução/pendentes.\n`);
  }

  // Detecta órfãos reais: running/pending no banco SEM job correspondente no BullMQ
  const { rows: orphans } = await pgClient.query<{
    id: string;
    agent_type: string;
    status: string;
    jira_key: string | null;
  }>(`
    SELECT ar.id, ar.agent_type, ar.status, s.jira_key
    FROM agent_runs ar
    LEFT JOIN stories s ON s.id = ar.story_id
    WHERE ar.status IN ('running', 'pending')
      AND ar.agent_type IN ('qa', 'dev', 'po', 'lt')
    ORDER BY ar.created_at DESC
  `);

  const realOrphans = orphans.filter((r) => !activeRunIds.has(r.id));

  if (realOrphans.length > 0) {
    console.log('  ⚠️   Registros órfãos no banco (running/pending sem job no BullMQ):');
    console.log('  ┌' + '─'.repeat(50));
    for (const row of realOrphans) {
      console.log(`  │  [${row.status.toUpperCase()}] ${row.agent_type.toUpperCase()}  jiraKey=${row.jira_key ?? '—'}  id=${row.id}`);
    }
    console.log(`  └${'─'.repeat(50)}`);
    console.log(`  → Rode: npm run kill-jobs  para limpar.\n`);
  }

  await pgClient.end();
  await connection.quit();
}

main().catch((err: Error) => {
  console.error('Erro:', err.message);
  process.exit(1);
});
