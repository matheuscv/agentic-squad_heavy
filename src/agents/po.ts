import { Queue, Worker, type Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index';
import { updateStoryStatus, updateStoryDescription } from '../db/stories';
import { redisConnection } from '../queue/index';
import { getIssue, moveCardTo, addComment } from '../jira/client';
import { commitFile } from '../github/client';
import { childLogger } from '../lib/logger';

const log = childLogger({ module: 'agent.po' });

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type PoAgentJobData = {
  storyId: string;
  jiraKey: string;
  agentRunId: string;
  summary: string;
  fromStatus: string | null;
};

// ─── Fila do agente PO ────────────────────────────────────────────────────────

export const poAgentQueue = new Queue<PoAgentJobData>('agent-po', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: { count: 50 },
    removeOnFail: { count: 25 },
  },
});

// ─── Helpers de conteúdo ─────────────────────────────────────────────────────

/** Extrai texto plano do Atlassian Document Format (ADF). */
function extractTextFromAdf(adf: unknown): string {
  if (!adf || typeof adf !== 'object') return '';
  const node = adf as Record<string, unknown>;

  if (node['type'] === 'text' && typeof node['text'] === 'string') {
    return node['text'];
  }

  const children = (node['content'] as unknown[]) ?? [];
  return children.map(extractTextFromAdf).join('');
}

// ─── Geração do PRD (stub) ────────────────────────────────────────────────────

function buildPrdContent(jiraKey: string, summary: string, description = ''): string {
  const now = new Date().toISOString();
  const descSection = description.trim()
    ? description.trim()
    : '[A ser preenchido pelo Agente PO com IA]';

  return `# PRD — ${summary}

## Identificação
- **Jira Key**: ${jiraKey}
- **Resumo**: ${summary}
- **Gerado em**: ${now}

## Contexto
> ⚠️ Este é um PRD gerado pelo Agente PO (versão stub — Fase 1).
> O conteúdo completo com análise de requisitos via IA será produzido na Fase 2.

## Descrição da História (Jira)
${descSection}

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
  const jobLog = log.child({ jiraKey, agentRunId, storyId });

  jobLog.info('iniciando execução do agente PO');

  // 1. Marca run como 'running'
  await db
    .update(schema.agentRuns)
    .set({ status: 'running', startedAt })
    .where(eq(schema.agentRuns.id, agentRunId));

  // 2. Enriquece a história com a descrição real do Jira
  let fullDescription = '';
  try {
    const issue = await getIssue(jiraKey);
    const descBlock = issue.fields.description;
    fullDescription = extractTextFromAdf(descBlock) ?? '';
    if (fullDescription) {
      await updateStoryDescription(jiraKey, fullDescription);
      jobLog.debug({ descriptionLength: fullDescription.length }, 'descrição Jira persistida');
    }
  } catch (err) {
    jobLog.warn({ err: (err as Error).message }, 'falha ao buscar descrição — continuando sem ela');
  }

  // 3. Gera PRD.md (stub)
  const prdContent = buildPrdContent(jiraKey, summary, fullDescription);
  jobLog.debug({ prdLength: prdContent.length }, 'PRD.md gerado');

  // 4. Salva artifact no banco
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

  jobLog.info({ artifactId: artifact!.id, filePath: `${jiraKey}/PRD.md` }, 'artifact PRD salvo');

  // 5. Commita PRD.md no repositório GitHub
  let githubCommitSha: string | undefined;
  try {
    const commitResult = await commitFile(
      `${jiraKey}/PRD.md`,
      prdContent,
      `docs(${jiraKey}): PRD gerado pelo Agente PO (stub)\n\n[Agente PO v0.1-stub] — Squad Agêntica`,
    );
    githubCommitSha = commitResult.sha;

    // Atualiza artifact com o SHA do commit
    await db
      .update(schema.artifacts)
      .set({ githubCommitSha })
      .where(eq(schema.artifacts.id, artifact!.id));

    jobLog.info({ githubCommitSha, commitUrl: commitResult.url }, 'PRD.md commitado no GitHub');
  } catch (err) {
    // Commit GitHub falhou — não bloqueia o fluxo (artifact já está no banco)
    jobLog.warn({ err: (err as Error).message }, 'falha ao commitar no GitHub — continuando');
  }

  // 6. Move card Jira para "Aguardando Aceite PRD"
  try {
    await moveCardTo(jiraKey, 'Aguardando Aceite PRD');
    jobLog.info({ to: 'Aguardando Aceite PRD' }, 'card movido no Jira');
  } catch (err) {
    jobLog.error({ err: (err as Error).message, to: 'Aguardando Aceite PRD' }, 'falha ao mover card');
    throw err;
  }

  // 5a. Atualiza status no banco imediatamente — não espera o próximo webhook
  await updateStoryStatus(jiraKey, 'Aguardando Aceite PRD', {
    lastAgentType: 'po',
    lastAgentRunId: agentRunId,
  });
  jobLog.debug('status do banco sincronizado → Aguardando Aceite PRD');

  // 6. Adiciona comentário no Jira
  const comment =
    `🤖 *Agente PO (stub)* concluiu a geração do PRD.\n\n` +
    `📄 Artifact: \`${jiraKey}/PRD.md\`\n\n` +
    `Aguardando revisão e aprovação do PO humano (Gate 1/5).`;

  try {
    await addComment(jiraKey, comment);
    jobLog.debug('comentário adicionado no Jira');
  } catch (err) {
    jobLog.warn({ err: (err as Error).message }, 'falha ao comentar — fluxo não interrompido');
  }

  // 7. Marca run como 'completed'
  const completedAt = new Date();
  const durationMs = completedAt.getTime() - startedAt.getTime();
  const output = { artifactId: artifact!.id, filePath: `${jiraKey}/PRD.md`, githubCommitSha };

  await db
    .update(schema.agentRuns)
    .set({ status: 'completed', output, durationMs, completedAt })
    .where(eq(schema.agentRuns.id, agentRunId));

  jobLog.info({ durationMs, output }, 'agente PO concluído');
  return output;
}

// ─── Criação do Worker ────────────────────────────────────────────────────────

export function createPoAgentWorker() {
  const worker = new Worker<PoAgentJobData>('agent-po', processPoJob, {
    connection: redisConnection,
    concurrency: 3,
  });

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
