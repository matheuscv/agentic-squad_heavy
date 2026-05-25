import { Worker, type Job } from 'bullmq';
import { sql } from 'drizzle-orm';
import { db, schema } from '../db/index';
import { redisConnection, type OrchestratorJobData } from '../queue/index';
import { moveCardTo } from '../jira/client';
import { poAgentQueue } from '../agents/po';
import {
  handleTransition,
  getStateOrder,
  isKnownStatus,
  JIRA_TO_DB_STATUS,
  type JiraStatus,
} from './state-machine';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function upsertStory(data: OrchestratorJobData) {
  const { jiraKey, summary, toStatus, currentStatus } = data;

  const dbStatus =
    toStatus && isKnownStatus(toStatus)
      ? JIRA_TO_DB_STATUS[toStatus]
      : isKnownStatus(currentStatus)
        ? JIRA_TO_DB_STATUS[currentStatus]
        : 'backlog';

  const [story] = await db
    .insert(schema.stories)
    .values({
      jiraKey,
      jiraSummary: summary,
      status: dbStatus,
      jiraStatus: toStatus ?? currentStatus,
    })
    .onConflictDoUpdate({
      target: schema.stories.jiraKey,
      set: {
        jiraSummary: summary,
        status: dbStatus,
        jiraStatus: toStatus ?? currentStatus,
        updatedAt: sql`now()`,
      },
    })
    .returning();

  return story!;
}

// ─── Processador do job ───────────────────────────────────────────────────────

async function processJob(job: Job<OrchestratorJobData>) {
  const { jiraKey, fromStatus, toStatus, summary } = job.data;

  console.log(
    `[orchestrator] processando ${jiraKey} :: "${fromStatus}" → "${toStatus}"`,
  );

  // 1. Idempotência — rejeita regressões ou movimentos sem progresso
  if (fromStatus && toStatus) {
    const fromOrder = getStateOrder(fromStatus);
    const toOrder = getStateOrder(toStatus);

    if (fromOrder !== -1 && toOrder !== -1 && toOrder <= fromOrder) {
      console.warn(
        `[orchestrator] ${jiraKey} ignorado — transição retroativa (${fromStatus} → ${toStatus})`,
      );
      return { skipped: true, reason: 'retrograde_transition' };
    }
  }

  // 2. Upsert da story no banco
  const story = await upsertStory(job.data);
  console.log(`[orchestrator] story upserted — id: ${story.id} :: ${jiraKey}`);

  // 3. Decide ação via máquina de estados
  const action = handleTransition(toStatus ?? '');

  const actionDesc = 'description' in action ? action.description : `status desconhecido: "${action.status}"`;
  console.log(
    `[orchestrator] ação: ${action.type}${
      action.type === 'invoke_agent'
        ? ` (${action.agent})`
        : action.type === 'human_gate'
          ? ` (gate ${action.gate}/5)`
          : ''
    } — ${actionDesc}`,
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
      console.log(
        `[orchestrator] ${jiraKey} — aguardando aprovação humana (gate ${action.gate}/5)`,
      );
      break;

    case 'in_progress':
      console.log(`[orchestrator] ${jiraKey} — em progresso, sem ação`);
      break;

    case 'terminal':
      console.log(`[orchestrator] ${jiraKey} — concluído!`);
      break;

    case 'unknown':
      console.warn(
        `[orchestrator] ${jiraKey} — status desconhecido: "${action.status}"`,
      );
      break;
  }

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
      console.log(`[orchestrator] ${jiraKey} movido para "${moveTo}"`);
    } catch (err) {
      console.error(`[orchestrator] falha ao mover ${jiraKey} para "${moveTo}":`, (err as Error).message);
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
  console.log(`[orchestrator] run pendente criado — agente "${agent}", runId: ${agentRunId}`);

  // 3. Enfileira na fila do agente correspondente
  switch (agent) {
    case 'po':
      await poAgentQueue.add(
        'po:run',
        { storyId, jiraKey, agentRunId, summary: jobData.summary, fromStatus: jobData.fromStatus },
        { jobId: `po-${jiraKey}-${agentRunId}` },
      );
      console.log(`[orchestrator] job enfileirado em "agent:po" para ${jiraKey}`);
      break;

    default:
      console.warn(`[orchestrator] agente "${agent}" ainda não implementado — run registrado como pendente`);
  }
}

// ─── Criação do Worker ────────────────────────────────────────────────────────

export function createOrchestratorWorker() {
  const worker = new Worker<OrchestratorJobData>(
    'orchestrator',
    processJob,
    {
      connection: redisConnection,
      concurrency: 5,
    },
  );

  worker.on('completed', (job, result) => {
    console.log(`[orchestrator] job ${job.id} concluído:`, JSON.stringify(result));
  });

  worker.on('failed', (job, err) => {
    console.error(
      `[orchestrator] job ${job?.id} falhou (tentativa ${job?.attemptsMade}/${job?.opts.attempts}):`,
      err.message,
    );
  });

  worker.on('error', (err) => {
    console.error('[orchestrator] erro no worker:', err.message);
  });

  console.log('[orchestrator] worker iniciado — aguardando jobs');

  return worker;
}
