import { Queue, Worker, type Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index';
import { redisConnection } from '../queue/index';
import { moveCardTo, addComment } from '../jira/client';

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type PoAgentJobData = {
  storyId: string;
  jiraKey: string;
  agentRunId: string;
  summary: string;
  fromStatus: string | null;
};

// ─── Fila do agente PO ────────────────────────────────────────────────────────

export const poAgentQueue = new Queue<PoAgentJobData>('agent:po', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: { count: 50 },
    removeOnFail: { count: 25 },
  },
});

// ─── Geração do PRD (stub) ────────────────────────────────────────────────────

function buildPrdContent(jiraKey: string, summary: string): string {
  const now = new Date().toISOString();

  return `# PRD — ${summary}

## Identificação
- **Jira Key**: ${jiraKey}
- **Resumo**: ${summary}
- **Gerado em**: ${now}

## Contexto
> ⚠️ Este é um PRD gerado pelo Agente PO (versão stub — Fase 1).
> O conteúdo completo com análise de requisitos via IA será produzido na Fase 2.

## Problema
[A ser preenchido pelo Agente PO com IA]

## Solução Proposta
[A ser preenchido pelo Agente PO com IA]

## Critérios de Aceite
- [ ] [A ser definido]
- [ ] [A ser definido]

## Fora de Escopo
- [A ser definido]

## Referências
- Jira: ${jiraKey}

---
*Agente PO v0.1-stub | Squad Agêntica*
`;
}

// ─── Processador do job PO ────────────────────────────────────────────────────

async function processPoJob(job: Job<PoAgentJobData>): Promise<unknown> {
  const { storyId, jiraKey, agentRunId, summary } = job.data;
  const startedAt = new Date();

  console.log(`[agent:po] iniciando para ${jiraKey} (run: ${agentRunId})`);

  // 1. Marca run como 'running'
  await db
    .update(schema.agentRuns)
    .set({ status: 'running', startedAt })
    .where(eq(schema.agentRuns.id, agentRunId));

  // 2. Gera PRD.md (stub)
  const prdContent = buildPrdContent(jiraKey, summary);
  console.log(`[agent:po] PRD.md gerado (${prdContent.length} chars)`);

  // 3. Salva artifact no banco
  const [artifact] = await db
    .insert(schema.artifacts)
    .values({
      storyId,
      agentRunId,
      artifactType: 'prd',
      filePath: `${jiraKey}/PRD.md`,
      content: prdContent,
    })
    .returning({ id: schema.artifacts.id });

  console.log(`[agent:po] artifact salvo — id: ${artifact!.id}`);

  // 4. Move card Jira para "Aguardando Aceite PRD"
  try {
    await moveCardTo(jiraKey, 'Aguardando Aceite PRD');
    console.log(`[agent:po] ${jiraKey} movido para "Aguardando Aceite PRD"`);
  } catch (err) {
    console.error(`[agent:po] falha ao mover ${jiraKey}:`, (err as Error).message);
    throw err;
  }

  // 5. Adiciona comentário no Jira
  const comment =
    `🤖 *Agente PO (stub)* concluiu a geração do PRD.\n\n` +
    `📄 Artifact: \`${jiraKey}/PRD.md\`\n\n` +
    `Aguardando revisão e aprovação do PO humano (Gate 1/5).`;

  try {
    await addComment(jiraKey, comment);
    console.log(`[agent:po] comentário adicionado em ${jiraKey}`);
  } catch (err) {
    // Comentário falhou — não bloqueia o fluxo
    console.warn(`[agent:po] falha ao comentar em ${jiraKey}:`, (err as Error).message);
  }

  // 6. Marca run como 'completed'
  const completedAt = new Date();
  const output = { artifactId: artifact!.id, filePath: `${jiraKey}/PRD.md` };

  await db
    .update(schema.agentRuns)
    .set({
      status: 'completed',
      output,
      durationMs: completedAt.getTime() - startedAt.getTime(),
      completedAt,
    })
    .where(eq(schema.agentRuns.id, agentRunId));

  console.log(`[agent:po] run ${agentRunId} concluído em ${completedAt.getTime() - startedAt.getTime()}ms`);

  return output;
}

// ─── Criação do Worker ────────────────────────────────────────────────────────

export function createPoAgentWorker() {
  const worker = new Worker<PoAgentJobData>('agent:po', processPoJob, {
    connection: redisConnection,
    concurrency: 3,
  });

  worker.on('completed', (job, result) => {
    console.log(`[agent:po] job ${job.id} concluído:`, JSON.stringify(result));
  });

  worker.on('failed', (job, err) => {
    console.error(
      `[agent:po] job ${job?.id} falhou (tentativa ${job?.attemptsMade}/${job?.opts.attempts}):`,
      err.message,
    );
  });

  worker.on('error', (err) => {
    console.error('[agent:po] erro no worker:', err.message);
  });

  console.log('[agent:po] worker iniciado — aguardando jobs');

  return worker;
}
