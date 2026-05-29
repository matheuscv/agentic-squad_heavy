import { Worker, type Job } from 'bullmq';
import { and, eq, inArray } from 'drizzle-orm';
import { db, schema } from '../db/index';
import { upsertStory } from '../db/stories';
import { redisConnection, type OrchestratorJobData } from '../queue/index';
import { moveCardTo } from '../jira/client';
import { readFile } from '../github/client';
import { poAgentQueue } from '../agents/po';
import { ltAgentQueue } from '../agents/lt';
import { devAgentQueue, DEV_JOB_PRIORITY } from '../agents/dev-agent';
import { qaAgentQueue } from '../agents/qa-agent';
import { childLogger } from '../lib/logger';
import {
  handleTransition,
  getStateOrder,
  type JiraStatus,
} from './state-machine';

const log = childLogger({ module: 'orchestrator' });

// ─── Helper — parseia ondas do PLANO_DE_EXECUCAO.md ──────────────────────────
// Formato esperado: "Onda N (paralelo): TASK-01, TASK-02"
// Retorna array de tasks por onda (ex: ['TASK-01, TASK-02', 'TASK-03']), cap 5.
// Array vazio = PLANO sem ondas → fallback para 1 DEV.
function parsePlanWaves(content: string): string[] {
  const matches = content.match(/^Onda\s+\d+[^:]*:\s*(.+)$/gim) ?? [];
  return matches
    .map(line => (line.match(/:\s*(.+)$/) ?? [])[1]?.trim() ?? '')
    .filter(Boolean)
    .slice(0, 5);
}

// ─── Processador do job ───────────────────────────────────────────────────────

async function processJob(job: Job<OrchestratorJobData>) {
  const { jiraKey, projectKey, fromStatus, toStatus, summary } = job.data;
  const t0 = Date.now();

  log.info({ jiraKey, projectKey, from: fromStatus, to: toStatus }, 'processando transição');

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
  // DEV tem lógica própria: lê o PLANO e despacha 1 agente por onda (até 5)
  if (agent === 'dev') {
    await dispatchDevAgents(storyId, jiraKey, jobData, moveTo);
    return;
  }

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

  // 2. Deduplicação — ignora se já existe job ativo do mesmo agente para esta story
  const activeRuns = await db
    .select({ id: schema.agentRuns.id })
    .from(schema.agentRuns)
    .where(
      and(
        eq(schema.agentRuns.storyId, storyId),
        eq(schema.agentRuns.agentType, agent as typeof schema.agentRuns.$inferInsert['agentType']),
        inArray(schema.agentRuns.status, ['pending', 'running']),
      ),
    )
    .limit(1);

  if (activeRuns.length > 0) {
    log.warn(
      { jiraKey, agent, existingRunId: activeRuns[0]!.id },
      'agente já ativo para esta story — enfileiramento ignorado',
    );
    return;
  }

  // 3. Registra run pendente no banco e obtém ID para rastreamento
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

  // 4. Enfileira na fila do agente correspondente
  switch (agent) {
    case 'po':
      await poAgentQueue.add(
        'po:run',
        { storyId, jiraKey, projectKey: jobData.projectKey, agentRunId, summary: jobData.summary, fromStatus: jobData.fromStatus },
        { jobId: `po-${jiraKey}-${agentRunId}` },
      );
      log.info({ jiraKey, projectKey: jobData.projectKey, agentRunId, queue: 'agent-po' }, 'job enfileirado para agente PO');
      break;

    case 'lt':
      await ltAgentQueue.add(
        'lt:run',
        { storyId, jiraKey, projectKey: jobData.projectKey, agentRunId, summary: jobData.summary, fromStatus: jobData.fromStatus },
        { jobId: `lt-${jiraKey}-${agentRunId}` },
      );
      log.info({ jiraKey, projectKey: jobData.projectKey, agentRunId, queue: 'agent-lt' }, 'job enfileirado para agente LT');
      break;

    case 'qa':
      await qaAgentQueue.add(
        'qa:run',
        { storyId, jiraKey, projectKey: jobData.projectKey, agentRunId, summary: jobData.summary, fromStatus: jobData.fromStatus },
        { jobId: `qa-${jiraKey}-${agentRunId}` },
      );
      log.info({ jiraKey, projectKey: jobData.projectKey, agentRunId, queue: 'agent-qa' }, 'job enfileirado para agente QA');
      break;

    default:
      log.warn({ jiraKey, agent }, 'agente ainda não implementado');
  }
}

// ─── Dispatch paralelo de agentes DEV (1 por onda do PLANO, até 5) ───────────

async function dispatchDevAgents(
  storyId: string,
  jiraKey: string,
  jobData: OrchestratorJobData,
  moveTo?: JiraStatus,
) {
  // 1. Move o card no Jira
  if (moveTo) {
    try {
      await moveCardTo(jiraKey, moveTo);
      log.info({ jiraKey, moveTo }, 'card movido no Jira');
    } catch (err) {
      log.error({ jiraKey, moveTo, err: (err as Error).message }, 'falha ao mover card');
      throw err;
    }
  }

  // 2. Deduplicação — ignora se já existe qualquer run DEV ativo para esta story
  const activeRuns = await db
    .select({ id: schema.agentRuns.id })
    .from(schema.agentRuns)
    .where(
      and(
        eq(schema.agentRuns.storyId, storyId),
        eq(schema.agentRuns.agentType, 'dev'),
        inArray(schema.agentRuns.status, ['pending', 'running']),
      ),
    )
    .limit(1);

  if (activeRuns.length > 0) {
    log.warn(
      { jiraKey, existingRunId: activeRuns[0]!.id },
      'agente DEV já ativo para esta story — enfileiramento ignorado',
    );
    return;
  }

  // 3. Lê PLANO_DE_EXECUCAO.md e parseia ondas; fallback para 1 DEV se não encontrar
  const prdBranch = `prd/${jiraKey.toLowerCase()}`;
  let waves: string[] = [];
  try {
    const planContent = await readFile(`${jiraKey}/PLANO_DE_EXECUCAO.md`, prdBranch);
    if (planContent) waves = parsePlanWaves(planContent);
  } catch (err) {
    log.warn({ jiraKey, err: (err as Error).message }, 'falha ao ler PLANO — fallback para 1 DEV');
  }

  const totalTasks = Math.max(waves.length, 1);
  log.info({ jiraKey, totalTasks, waves }, 'despachando agentes DEV em paralelo');

  // 4. Cria 1 agentRun + 1 job por onda
  for (let i = 0; i < totalTasks; i++) {
    const taskIndex = i + 1;
    const taskScope = waves[i]; // undefined quando sem ondas (totalTasks === 1)

    const [agentRun] = await db
      .insert(schema.agentRuns)
      .values({
        storyId,
        agentType: 'dev',
        status: 'pending',
        input: { jiraKey, fromStatus: jobData.fromStatus, toStatus: jobData.toStatus, taskIndex, totalTasks, taskScope },
      })
      .returning({ id: schema.agentRuns.id });

    const agentRunId = agentRun!.id;

    await devAgentQueue.add(
      'dev:run',
      {
        storyId,
        jiraKey,
        projectKey: jobData.projectKey,
        agentRunId,
        summary: jobData.summary,
        fromStatus: jobData.fromStatus,
        taskIndex,
        totalTasks,
        taskScope,
      },
      { jobId: `dev-${jiraKey}-${agentRunId}`, priority: DEV_JOB_PRIORITY.NORMAL },
    );

    log.info(
      { jiraKey, agentRunId, taskIndex, totalTasks, taskScope, queue: 'agent-dev' },
      'job enfileirado para agente DEV',
    );
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
