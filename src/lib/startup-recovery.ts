import { eq } from 'drizzle-orm';
import type { Queue } from 'bullmq';
import { db, schema } from '../db/index';
import { childLogger } from './logger';

const log = childLogger({ module: 'startup-recovery' });

export type RecoveryQueues = {
  po: Queue;
  lt: Queue;
  dev: Queue;
  qa: Queue;
};

const JOB_NAMES = { po: 'po:run', lt: 'lt:run', dev: 'dev:run', qa: 'qa:run' } as const;

/**
 * Recupera agentRuns que estavam em status 'running' quando o processo encerrou
 * abruptamente. Reseta o status para 'pending' e re-enfileira com o mesmo jobId
 * — BullMQ deduplica automaticamente se o job já estiver na fila.
 *
 * Nota: agentRun.input armazena { jiraKey, fromStatus, toStatus } mas NÃO summary.
 * O summary é obtido de stories.jiraSummary para garantir dados completos mesmo
 * que o Redis tenha perdido o job original.
 */
export async function recoverInterruptedRuns(queues: RecoveryQueues): Promise<number> {
  let stuckRuns: Array<{
    id: string;
    storyId: string;
    agentType: typeof schema.agentRuns.$inferSelect['agentType'];
    input: unknown;
    jiraSummary: string;
    jiraKey: string;
  }>;

  try {
    stuckRuns = await db
      .select({
        id: schema.agentRuns.id,
        storyId: schema.agentRuns.storyId,
        agentType: schema.agentRuns.agentType,
        input: schema.agentRuns.input,
        // summary vem da tabela stories — agentRun.input não o armazena
        jiraSummary: schema.stories.jiraSummary,
        jiraKey: schema.stories.jiraKey,
      })
      .from(schema.agentRuns)
      .innerJoin(schema.stories, eq(schema.agentRuns.storyId, schema.stories.id))
      .where(eq(schema.agentRuns.status, 'running'));
  } catch (err) {
    log.error({ err: (err as Error).message }, 'falha ao consultar runs interrompidos — ignorando recovery');
    return 0;
  }

  if (stuckRuns.length === 0) {
    log.debug('nenhum run interrompido encontrado — startup limpo');
    return 0;
  }

  log.warn({ count: stuckRuns.length }, 'runs interrompidos detectados — iniciando recovery de startup');

  let recovered = 0;

  for (const run of stuckRuns) {
    try {
      const input = (run.input ?? {}) as Record<string, unknown>;
      const jiraKey = run.jiraKey;
      const summary = run.jiraSummary;
      const fromStatus = (input['fromStatus'] as string | null) ?? null;

      await db
        .update(schema.agentRuns)
        .set({ status: 'pending', startedAt: null })
        .where(eq(schema.agentRuns.id, run.id));

      const agentType = run.agentType as keyof RecoveryQueues;
      const queue = queues[agentType];

      if (!queue) {
        log.warn({ runId: run.id, agentType }, 'fila não disponível para este agente — skip');
        continue;
      }

      const jobName = JOB_NAMES[agentType];
      const jobId = `${agentType}-${jiraKey}-${run.id}`;
      const jobData = { storyId: run.storyId, jiraKey, agentRunId: run.id, summary, fromStatus };

      await queue.add(jobName, jobData, { jobId });

      log.info({ runId: run.id, agentType, jiraKey, jobId }, 'run reenfileirado com sucesso');
      recovered++;
    } catch (err) {
      log.error({ runId: run.id, err: (err as Error).message }, 'falha ao reprocessar run interrompido');
    }
  }

  log.info({ recovered, total: stuckRuns.length }, 'recovery de startup concluído');
  return recovered;
}
