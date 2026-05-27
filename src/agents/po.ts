import Anthropic from '@anthropic-ai/sdk';
import { Queue, Worker, type Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index';
import { updateStoryStatus, updateStoryDescription } from '../db/stories';
import { redisConnection } from '../queue/index';
import { getIssue, moveCardTo, addComment } from '../jira/client';
import { commitFile, createBranch, readFile } from '../github/client';
import { childLogger } from '../lib/logger';
import { runAgentLoop } from '../lib/agent-loop';
import { calculateCostUsd, checkAndAlertIfOverBudget } from '../lib/cost';
import { PO_SYSTEM_PROMPT } from './prompts/po-system-prompt';

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

// ─── Helpers de conteúdo ──────────────────────────────────────────────────────

function extractTextFromAdf(adf: unknown): string {
  if (!adf || typeof adf !== 'object') return '';
  const node = adf as Record<string, unknown>;
  if (node['type'] === 'text' && typeof node['text'] === 'string') return node['text'];
  const children = (node['content'] as unknown[]) ?? [];
  return children.map(extractTextFromAdf).join('');
}

/** Remove preâmbulo e blocos de código que o modelo pode adicionar antes/ao redor do markdown. */
function extractMarkdownContent(raw: string): string {
  // Caso 1: modelo envolveu em ```markdown ... ``` (especificador obrigatório)
  const fenceMatch = raw.match(/```markdown\r?\n([\s\S]*?)\r?\n```/);
  if (fenceMatch?.[1]) return fenceMatch[1].trim();

  // Caso 2: há texto antes do primeiro heading — descarta o preâmbulo
  const headingIndex = raw.search(/(^|\n)# /);
  if (headingIndex > 0) return raw.slice(headingIndex).replace(/^\n/, '').trim();

  return raw.trim();
}

// ─── Definição das ferramentas ────────────────────────────────────────────────

const PO_TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_jira_issue',
    description: 'Busca os dados completos de uma história do Jira: resumo, descrição, status e tipo.',
    input_schema: {
      type: 'object' as const,
      properties: {
        issue_key: {
          type: 'string',
          description: 'Chave da issue no Jira (ex: SCRUM-42)',
        },
      },
      required: ['issue_key'],
    },
  },
  {
    name: 'read_github_file',
    description: 'Lê o conteúdo de um arquivo do repositório GitHub (README, glossário, PRDs anteriores).',
    input_schema: {
      type: 'object' as const,
      properties: {
        file_path: {
          type: 'string',
          description: 'Caminho do arquivo a partir da raiz do repositório (ex: README.md, docs/GLOSSARIO.md)',
        },
      },
      required: ['file_path'],
    },
  },
];

// ─── Loop de tool-use do agente PO ───────────────────────────────────────────

async function runPoAgent(
  jiraKey: string,
  summary: string,
  agentRunId: string,
): Promise<{ prdContent: string; inputTokens: number; outputTokens: number }> {
  const jobLog = log.child({ jiraKey, agentRunId });
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const model = process.env.ANTHROPIC_MODEL ?? 'claude-opus-4-7';

  const today = new Date().toISOString().split('T')[0];

  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: `Data atual: ${today}
Gere o PRD completo para a história ${jiraKey}: "${summary}".
Use as ferramentas disponíveis para coletar o contexto necessário antes de escrever.
Lembre-se: responda APENAS com o markdown do PRD, começando com "# PRD —".`,
    },
  ];

  jobLog.debug({ model, jiraKey }, 'iniciando loop de tool-use com Claude');

  const dispatchTool = async (block: Anthropic.ToolUseBlock): Promise<string> => {
    if (block.name === 'get_jira_issue') {
      const { issue_key } = block.input as { issue_key: string };
      const issue = await getIssue(issue_key);
      const description = extractTextFromAdf(issue.fields.description);
      jobLog.debug({ issue_key }, 'ferramenta get_jira_issue executada');
      return JSON.stringify({
        key: issue.key,
        summary: issue.fields.summary,
        description: description || '(sem descrição)',
        status: issue.fields.status.name,
      });
    }

    if (block.name === 'read_github_file') {
      const { file_path } = block.input as { file_path: string };
      const content = await readFile(file_path);
      jobLog.debug({ file_path, found: content !== null }, 'ferramenta read_github_file executada');
      return content ?? '(arquivo não encontrado no repositório)';
    }

    return `Ferramenta desconhecida: ${block.name}`;
  };

  const { result, inputTokens, outputTokens } = await runAgentLoop<string>({
    anthropic,
    redis: redisConnection,
    model,
    system: PO_SYSTEM_PROMPT,
    tools: PO_TOOLS,
    messages,
    maxTurns: 10,
    log: jobLog,
    label: 'PO',
    dispatchTool,
    onEndTurn: (response) => {
      const raw = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');

      const prdContent = extractMarkdownContent(raw);
      if (!prdContent) throw new Error('Claude retornou PRD vazio');
      return prdContent;
    },
  });
  return { prdContent: result, inputTokens, outputTokens };
}

// ─── Processador do job PO ────────────────────────────────────────────────────

async function processPoJob(job: Job<PoAgentJobData>): Promise<unknown> {
  const { storyId, jiraKey, agentRunId, summary } = job.data;
  const startedAt = new Date();
  const model = process.env.ANTHROPIC_MODEL ?? 'claude-opus-4-7';
  const jobLog = log.child({ jiraKey, agentRunId, storyId });

  jobLog.info('iniciando execução do agente PO');

  // 1. Marca run como 'running'
  await db
    .update(schema.agentRuns)
    .set({ status: 'running', startedAt })
    .where(eq(schema.agentRuns.id, agentRunId));

  try {
    // 2. Persiste descrição Jira (melhor esforço — agente lerá via ferramenta)
    try {
      const issue = await getIssue(jiraKey);
      const description = extractTextFromAdf(issue.fields.description);
      if (description) {
        await updateStoryDescription(jiraKey, description);
        jobLog.debug({ descriptionLength: description.length }, 'descrição Jira persistida');
      }
    } catch (err) {
      jobLog.warn({ err: (err as Error).message }, 'falha ao pré-carregar descrição — Claude buscará via ferramenta');
    }

    // 3. Gera PRD via Claude (tool-use loop)
    const { prdContent, inputTokens, outputTokens } = await runPoAgent(jiraKey, summary, agentRunId);
    const costUsd = calculateCostUsd(model, inputTokens, outputTokens);
    jobLog.info({ prdLength: prdContent.length, inputTokens, outputTokens, costUsd }, 'PRD.md gerado pelo Claude');

    // 4. Salva artifact no banco
    const prdFilePath = `${jiraKey}/PRD.md`;
    const [artifact] = await db
      .insert(schema.artifacts)
      .values({
        storyId,
        agentRunId,
        artifactType: 'prd',
        filePath: prdFilePath,
        content: prdContent,
      })
      .returning({ id: schema.artifacts.id });

    jobLog.info({ artifactId: artifact!.id, filePath: prdFilePath }, 'artifact PRD salvo no banco');

    // 5. Cria branch e commita PRD.md
    const branch = `prd/${jiraKey.toLowerCase()}`;
    let githubCommitSha: string | undefined;
    let prdGithubUrl: string | undefined;

    try {
      await createBranch(branch);
      jobLog.debug({ branch }, 'branch criado');

      const commitResult = await commitFile(
        prdFilePath,
        prdContent,
        `docs(${jiraKey}): PRD gerado pelo Agente PO\n\n[Agente PO v2.0] — Squad Agêntica`,
        branch,
      );
      githubCommitSha = commitResult.sha;
      prdGithubUrl = `https://github.com/${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}/blob/${branch}/${prdFilePath}`;

      await db
        .update(schema.artifacts)
        .set({ githubCommitSha })
        .where(eq(schema.artifacts.id, artifact!.id));

      jobLog.info({ githubCommitSha, branch, prdGithubUrl }, 'PRD.md commitado no GitHub');
    } catch (err) {
      jobLog.warn({ err: (err as Error).message }, 'falha ao commitar no GitHub — continuando');
    }

    // 6. Move card Jira para "Aguardando Aceite PRD"
    try {
      await moveCardTo(jiraKey, 'Aguardando Aceite PRD');
      jobLog.info({ to: 'Aguardando Aceite PRD' }, 'card movido no Jira');
    } catch (err) {
      jobLog.error({ err: (err as Error).message }, 'falha ao mover card — abortando');
      throw err;
    }

    // 7. Sincroniza status no banco
    await updateStoryStatus(jiraKey, 'Aguardando Aceite PRD', {
      lastAgentType: 'po',
      lastAgentRunId: agentRunId,
    });

    // 8. Comenta no Jira com link para o PRD
    const githubLink = prdGithubUrl
      ? `\n\n📎 PRD no GitHub: ${prdGithubUrl}`
      : '';
    const comment =
      `🤖 *Agente PO* concluiu a geração do PRD.\n\n` +
      `📄 Artifact: \`${prdFilePath}\`` +
      githubLink +
      `\n\nAguardando revisão e aprovação do PO humano (Gate 1/5).`;

    try {
      await addComment(jiraKey, comment);
      jobLog.debug('comentário adicionado no Jira');
    } catch (err) {
      jobLog.warn({ err: (err as Error).message }, 'falha ao comentar — fluxo não interrompido');
    }

    // 9. Marca run como 'completed'
    const completedAt = new Date();
    const durationMs = completedAt.getTime() - startedAt.getTime();
    const output = { artifactId: artifact!.id, filePath: prdFilePath, githubCommitSha, branch };

    await db
      .update(schema.agentRuns)
      .set({ status: 'completed', output, durationMs, completedAt, inputTokens, outputTokens, costUsd })
      .where(eq(schema.agentRuns.id, agentRunId));

    await checkAndAlertIfOverBudget(storyId, jiraKey, jobLog);

    jobLog.info({ durationMs, branch, inputTokens, outputTokens, costUsd }, 'agente PO concluído');
    return output;

  } catch (err) {
    const errorMessage = (err as Error).message;
    const completedAt = new Date();
    const durationMs = completedAt.getTime() - startedAt.getTime();

    await db
      .update(schema.agentRuns)
      .set({ status: 'failed', errorMessage, durationMs, completedAt })
      .where(eq(schema.agentRuns.id, agentRunId));

    jobLog.error({ err: errorMessage, durationMs, attempt: job.attemptsMade + 1 }, 'agente PO falhou');
    throw err;
  }
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
