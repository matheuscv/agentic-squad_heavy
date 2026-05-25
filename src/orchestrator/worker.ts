import { Worker, type Job } from 'bullmq';
import { db, schema } from '../db/index';
import { upsertStory } from '../db/stories';
import { redisConnection, type OrchestratorJobData } from '../queue/index';
import { moveCardTo } from '../jira/client';
import { poAgentQueue } from '../agents/po';
import { childLogger } from '../lib/logger';
import {
  handleTransition,
  getStateOrder,
  type JiraStatus,
} from './state-machine';

const log = childLogger({ module: 'orchestrator' });

// ─── Processador do job ───────────────────────────────────────────────────────

async function processJob(job: Job<OrchestratorJobData>) {
  const { jiraKey, fromStatus, toStatus, summary } = job.data;
  const t0 = Date.now();

  log.info({ jiraKey, from: fromStatus, to: toStatus }, 'processando transição');

  // 1. Idempotência — rejeita regressões ou movimentos sem progresso
  if (fromStatus && toStatus) {
    const fromOrder = getStateOrder(fromStatus);
    const toOrder = getStateOrder(toStatus);

    if (fromOrder !== -1 && toOrder !== -1 && toOrder <= fromOrder) {
      log.warn({ jiraKey, from: fromStatus, to: toStatus }, 'transição retroativa ignorada');
      return { skipped: true, reason: 'retrograde_transition' };
    }
  }

  // 2. Upsert da story no banco
  const story = await upsertStory(job.data);
  log.debug({ jiraKey, storyId: story.id }, 'story persistida');

  // 3. Decide ação via máquina de estados
  const action = handleTransition(toStatus ?? '');

  log.info(
    {
      jiraKey,
      storyId: story.id,
      actionType: action.type,
      ...(action.type === 'invoke_agent' && { agent: action.agent }),
      ...(action.type === 'human_gate' && { gate: action.gate }),
      ...(action.type === 'unknown' && { unknownStatus: action.status }),
    },
    'ação determinada',
  );

  // 4. Registra run do orquestrador no banco
  await db.insert(schema.agentRuns).values({
    storyId: story.id,
    agentType: 'orchestrator',
    status: 'completed',
    input: { fromStatus, toStatus, summary },
    output: action,
    startedAt: new Date(),
    completedAt: new Date(),
  });

  // 5. Despacha ação
  switch (action.type) {
    case 'invoke_agent':
      await dispatchAgent(action.agent, story.id, jiraKey, job.data, action.moveTo);
      break;

    case 'human_gate':
      log.info({ jiraKey, gate: action.gate }, 'aguardando aprovação humana');
      break;

    case 'in_progress':
      log.debug({ jiraKey }, 'em progresso — sem ação');
      break;

    case 'terminal':
      log.info({ jiraKey }, 'história concluída');
      break;

    case 'unknown':
      log.warn({ jiraKey, status: action.status }, 'status desconhecido recebido');
      break;
  }

  log.info({ jiraKey, storyId: story.id, durationMs: Date.now() - t0 }, 'job processado');
  return { action, storyId: story.id };
}

// ─── Dispatch de agentes ──────────────────────────────────────────────────────

async function dispatchAgent(
  agent: string,
  storyId: string,
  jiraKey: string,
  jobData: OrchestratorJobData,
  moveTo?: JiraStatus,
) {
  // 1. Move o card no Jira se a transição exigir (ex: "A Refinar" → "Em Refinamento")
  if (moveTo) {
    try {
      await moveCardTo(jiraKey, moveTo);
      log.info({ jiraKey, moveTo }, 'card movido no Jira');
    } catch (err) {
      log.error({ jiraKey, moveTo, err: (err as Error).message }, 'falha ao mover card');
      throw err;
    }
  }

  // 2. Registra run pendente no banco e obtém ID para rastreamento
  const [agentRun] = await db
    .insert(schema.agentRuns)
    .values({
      storyId,
      agentType: agent as typeof schema.agentRuns.$inferInsert['agentType'],
      status: 'pending',
      input: { jiraKey, fromStatus: jobData.fromStatus, toStatus: jobData.toStatus },
    })
    .returning({ id: schema.agentRuns.id });

  const agentRunId = agentRun!.id;
  log.info({ jiraKey, agent, agentRunId }, 'run pendente registrado');

  // 3. Enfileira na fila do agente correspondente
  switch (agent) {
    case 'po':
      await poAgentQueue.add(
        'po:run',
        { storyId, jiraKey, agentRunId, summary: jobData.summary, fromStatus: jobData.fromStatus },
        { jobId: `po-${jiraKey}-${agentRunId}` },
      );
      log.info({ jiraKey, agentRunId, queue: 'agent-po' }, 'job enfileirado para agente PO');
      break;

    default:
      log.warn({ jiraKey, agent }, 'agente ainda não implementado');
  }
}

// ─── Criação do Worker ────────────────────────────────────────────────────────

export function createOrchestratorWorker() {
  const worker = new Worker<OrchestratorJobData>(
    'orchestrator',
    processJob,
    { connection: redisConnection, concurrency: 5 },
  );

  worker.on('completed', (job, result) => {
    log.info({ jobId: job.id, result }, 'job concluído');
  });

  worker.on('failed', (job, err) => {
    log.error(
      { jobId: job?.id, attempt: job?.attemptsMade, maxAttempts: job?.opts.attempts, err: err.message },
      'job falhou',
    );
  });

  worker.on('error', (err) => {
    log.error({ err: err.message }, 'erro no worker');
  });

  log.info('worker iniciado — aguardando jobs');
  return worker;
}
