import Anthropic from '@anthropic-ai/sdk';
import { Queue, Worker, type Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index';
import { updateStoryStatus } from '../db/stories';
import { redisConnection } from '../queue/index';
import { moveCardTo, addComment } from '../jira/client';
import { commitFile, readFile } from '../github/client';
import { childLogger } from '../lib/logger';
import { runAgentLoop } from '../lib/agent-loop';
import { LT_SYSTEM_PROMPT } from './prompts/lt-system-prompt';

const log = childLogger({ module: 'agent.lt' });

/** Remove preâmbulo e blocos de código que o modelo pode adicionar antes/ao redor do markdown. */
function extractMarkdownContent(raw: string): string {
  const fenceMatch = raw.match(/```markdown\r?\n([\s\S]*?)\r?\n```/);
  if (fenceMatch?.[1]) return fenceMatch[1].trim();

  const headingIndex = raw.search(/(^|\n)# /);
  if (headingIndex > 0) return raw.slice(headingIndex).replace(/^\n/, '').trim();

  return raw.trim();
}

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type LtAgentJobData = {
  storyId: string;
  jiraKey: string;
  agentRunId: string;
  summary: string;
  fromStatus: string | null;
};

// ─── Fila do agente LT ────────────────────────────────────────────────────────

export const ltAgentQueue = new Queue<LtAgentJobData>('agent-lt', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: { count: 50 },
    removeOnFail: { count: 25 },
  },
});

// ─── Definição das ferramentas ────────────────────────────────────────────────

const LT_TOOLS: Anthropic.Tool[] = [
  {
    name: 'read_github_file',
    description: 'Lê o conteúdo de um arquivo do repositório GitHub. Use branch para ler de branches específicos (ex: branch do PRD).',
    input_schema: {
      type: 'object' as const,
      properties: {
        file_path: {
          type: 'string',
          description: 'Caminho do arquivo a partir da raiz do repositório (ex: SCRUM-42/PRD.md, README.md)',
        },
        branch: {
          type: 'string',
          description: 'Branch do repositório (opcional). Use para ler o PRD do branch da história.',
        },
      },
      required: ['file_path'],
    },
  },
];

// ─── Loop de tool-use do agente LT ───────────────────────────────────────────

async function runLtAgent(
  jiraKey: string,
  summary: string,
  agentRunId: string,
): Promise<string> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const model = process.env.ANTHROPIC_MODEL ?? 'claude-opus-4-7';
  const prdBranch = `prd/${jiraKey.toLowerCase()}`;

  const today = new Date().toISOString().split('T')[0];

  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: `Data atual: ${today}
Gere o PLANO_DE_EXECUCAO.md para a história ${jiraKey}: "${summary}".

O PRD desta história está em: arquivo "${jiraKey}/PRD.md", branch "${prdBranch}".
Use as ferramentas disponíveis para coletar o contexto necessário antes de escrever.
Lembre-se: responda APENAS com o markdown do plano, começando com "# Plano de Execução —".`,
    },
  ];

  const jobLog = log.child({ jiraKey, agentRunId });
  jobLog.debug({ model, prdBranch }, 'iniciando loop de tool-use com Claude');

  const dispatchTool = async (block: Anthropic.ToolUseBlock): Promise<string> => {
    if (block.name === 'read_github_file') {
      const { file_path, branch } = block.input as { file_path: string; branch?: string };
      const content = await readFile(file_path, branch);
      jobLog.debug({ file_path, branch, found: content !== null }, 'ferramenta read_github_file executada');
      return content ?? '(arquivo não encontrado no repositório)';
    }

    return `Ferramenta desconhecida: ${block.name}`;
  };

  return runAgentLoop<string>({
    anthropic,
    redis: redisConnection,
    model,
    system: LT_SYSTEM_PROMPT,
    tools: LT_TOOLS,
    messages,
    maxTurns: 10,
    log: jobLog,
    label: 'LT',
    dispatchTool,
    onEndTurn: (response) => {
      const raw = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');

      const planContent = extractMarkdownContent(raw);
      if (!planContent) throw new Error('Claude retornou plano vazio');
      return planContent;
    },
  });
}

// ─── Processador do job LT ────────────────────────────────────────────────────

async function processLtJob(job: Job<LtAgentJobData>): Promise<unknown> {
  const { storyId, jiraKey, agentRunId, summary } = job.data;
  const startedAt = new Date();
  const jobLog = log.child({ jiraKey, agentRunId, storyId });

  jobLog.info('iniciando execução do agente LT');

  // 1. Marca run como 'running'
  await db
    .update(schema.agentRuns)
    .set({ status: 'running', startedAt })
    .where(eq(schema.agentRuns.id, agentRunId));

  try {
    // 2. Gera PLANO_DE_EXECUCAO.md via Claude (tool-use loop)
    const planContent = await runLtAgent(jiraKey, summary, agentRunId);
    jobLog.info({ planLength: planContent.length }, 'PLANO_DE_EXECUCAO.md gerado pelo Claude');

    // 3. Salva artifact no banco
    const planFilePath = `${jiraKey}/PLANO_DE_EXECUCAO.md`;
    const [artifact] = await db
      .insert(schema.artifacts)
      .values({
        storyId,
        agentRunId,
        artifactType: 'execution_plan',
        filePath: planFilePath,
        content: planContent,
      })
      .returning({ id: schema.artifacts.id });

    jobLog.info({ artifactId: artifact!.id, filePath: planFilePath }, 'artifact salvo no banco');

    // 4. Commita no mesmo branch do PRD (prd/<jiraKey>)
    const branch = `prd/${jiraKey.toLowerCase()}`;
    let githubCommitSha: string | undefined;
    let planGithubUrl: string | undefined;

    try {
      const commitResult = await commitFile(
        planFilePath,
        planContent,
        `docs(${jiraKey}): plano de execução gerado pelo Agente LT\n\n[Agente LT v1.0] — Squad Agêntica`,
        branch,
      );
      githubCommitSha = commitResult.sha;
      planGithubUrl = `https://github.com/${process.env.GITHUB_OWNER}/${process.env.GITHUB_REPO}/blob/${branch}/${planFilePath}`;

      await db
        .update(schema.artifacts)
        .set({ githubCommitSha })
        .where(eq(schema.artifacts.id, artifact!.id));

      jobLog.info({ githubCommitSha, branch, planGithubUrl }, 'PLANO_DE_EXECUCAO.md commitado no GitHub');
    } catch (err) {
      jobLog.warn({ err: (err as Error).message }, 'falha ao commitar no GitHub — continuando');
    }

    // 5. Move card Jira para "Aguardando Aceite Plano"
    try {
      await moveCardTo(jiraKey, 'Aguardando Aceite Plano');
      jobLog.info({ to: 'Aguardando Aceite Plano' }, 'card movido no Jira');
    } catch (err) {
      jobLog.error({ err: (err as Error).message }, 'falha ao mover card — abortando');
      throw err;
    }

    // 6. Sincroniza status no banco
    await updateStoryStatus(jiraKey, 'Aguardando Aceite Plano', {
      lastAgentType: 'lt',
      lastAgentRunId: agentRunId,
    });

    // 7. Comenta no Jira com link para o plano
    const githubLink = planGithubUrl ? `\n\n📎 Plano no GitHub: ${planGithubUrl}` : '';
    const comment =
      `🤖 *Agente LT* concluiu a decomposição técnica.\n\n` +
      `📋 Artifact: \`${planFilePath}\`` +
      githubLink +
      `\n\nAguardando revisão e aprovação do Tech Lead humano (Gate 2/5).`;

    try {
      await addComment(jiraKey, comment);
      jobLog.debug('comentário adicionado no Jira');
    } catch (err) {
      jobLog.warn({ err: (err as Error).message }, 'falha ao comentar — fluxo não interrompido');
    }

    // 8. Marca run como 'completed'
    const completedAt = new Date();
    const durationMs = completedAt.getTime() - startedAt.getTime();
    const output = { artifactId: artifact!.id, filePath: planFilePath, githubCommitSha, branch };

    await db
      .update(schema.agentRuns)
      .set({ status: 'completed', output, durationMs, completedAt })
      .where(eq(schema.agentRuns.id, agentRunId));

    jobLog.info({ durationMs, branch }, 'agente LT concluído');
    return output;

  } catch (err) {
    const errorMessage = (err as Error).message;
    const completedAt = new Date();
    const durationMs = completedAt.getTime() - startedAt.getTime();

    await db
      .update(schema.agentRuns)
      .set({ status: 'failed', errorMessage, durationMs, completedAt })
      .where(eq(schema.agentRuns.id, agentRunId));

    jobLog.error({ err: errorMessage, durationMs, attempt: job.attemptsMade + 1 }, 'agente LT falhou');
    throw err;
  }
}

// ─── Criação do Worker ────────────────────────────────────────────────────────

export function createLtAgentWorker() {
  const worker = new Worker<LtAgentJobData>('agent-lt', processLtJob, {
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
