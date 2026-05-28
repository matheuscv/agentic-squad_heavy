import Anthropic from '@anthropic-ai/sdk';
import { Queue, Worker, type Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index';
import { updateStoryStatus } from '../db/stories';
import { redisConnection, agentDlqQueue } from '../queue/index';
import { moveCardTo, addComment } from '../jira/client';
import { sanitizeForLlm } from '../lib/sanitize';
import { createBranch, readFile, listDirectory, commitFiles, createPullRequest, type PullRequestResult } from '../github/client';
import { childLogger, logAgentStarted, logAgentCompleted, logAgentFailed } from '../lib/logger';
import { runAgentLoop } from '../lib/agent-loop';
import { calculateCostUsd, checkAndAlertIfOverBudget } from '../lib/cost';
import { sendBetterstackAlert } from '../lib/betterstack';
import { DEV_SYSTEM_PROMPT } from './prompts/dev-system-prompt';

const log = childLogger({ module: 'agent.dev', agent: 'dev' });

// ─── Prioridades de job ───────────────────────────────────────────────────────
// Valores menores = processados primeiro pelo BullMQ.

export const DEV_JOB_PRIORITY = {
  CRITICAL: 1,   // reservado para histórias bloqueantes de alto impacto
  HIGH: 10,      // correções requisitadas pelo Agente QA (bloqueiam o ciclo de QA)
  NORMAL: 100,   // implementação padrão de histórias
  LOW: 1000,     // trabalho opcional ou de baixa urgência
} as const;

export type DevJobPriority = typeof DEV_JOB_PRIORITY[keyof typeof DEV_JOB_PRIORITY];

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type DevAgentJobData = {
  storyId: string;
  jiraKey: string;
  projectKey: string;
  agentRunId: string;
  summary: string;
  fromStatus: string | null;
  correctionMode?: boolean;     // true quando invocado pelo Agente QA para corrigir falhas
  correctionIteration?: number; // ciclo de correção (1–3)
  priority?: DevJobPriority;    // prioridade na fila (padrão: NORMAL)
};

type DevAgentResult = {
  prNumber: number;
  prUrl: string;
  prHtmlUrl: string;
  filesWritten: string[];
  branch: string;
};

// ─── Fila do agente DEV ───────────────────────────────────────────────────────

export const devAgentQueue = new Queue<DevAgentJobData>('agent-dev', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 4,
    backoff: { type: 'exponential', delay: 60_000 },
    removeOnComplete: { count: 25 },
    removeOnFail: { count: 10 },
  },
});

// ─── Definição das ferramentas ────────────────────────────────────────────────

const DEV_TOOLS: Anthropic.Tool[] = [
  {
    name: 'read_github_file',
    description: 'Lê o conteúdo de um arquivo do repositório GitHub. Use o parâmetro branch para ler de branches específicos (ex: branch do plano).',
    input_schema: {
      type: 'object' as const,
      properties: {
        file_path: {
          type: 'string',
          description: 'Caminho de um arquivo listado nas tasks do PLANO ou de contexto do projeto (ex: "SCRUM-16/PLANO_DE_EXECUCAO.md", "README.md", "package.json") — nunca um arquivo não mencionado no PLANO',
        },
        branch: {
          type: 'string',
          description: 'Branch opcional. Use para ler o PLANO_DE_EXECUCAO.md do branch do plano (ex: "prd/scrum-15").',
        },
      },
      required: ['file_path'],
    },
  },
  {
    name: 'list_github_directory',
    description: 'Lista arquivos em um diretório ESPECÍFICO já nomeado no PLANO. Use APENAS para verificar se um arquivo ou subdiretório mencionado nas tasks já existe — nunca para explorar "src" inteiro ou diretórios não listados no PLANO.',
    input_schema: {
      type: 'object' as const,
      properties: {
        dir_path: {
          type: 'string',
          description: 'Caminho ESPECÍFICO a partir da raiz — deve ser um diretório mencionado nas tasks do PLANO (ex: "src/utils", "src/auth") — NUNCA "src" sozinho',
        },
        branch: {
          type: 'string',
          description: 'Branch opcional (padrão: branch principal)',
        },
      },
      required: ['dir_path'],
    },
  },
  {
    name: 'write_github_file',
    description: 'Prepara (staging) um arquivo para o próximo commit. Use APENAS para arquivos explicitamente listados nas tasks do PLANO_DE_EXECUCAO.md e seus arquivos de teste correspondentes — nunca para arquivos fora do escopo do PLANO. Chame create_github_commit quando quiser persistir.',
    input_schema: {
      type: 'object' as const,
      properties: {
        file_path: {
          type: 'string',
          description: 'Caminho completo do arquivo a partir da raiz do repositório (ex: "src/auth/handlers/register.ts")',
        },
        content: {
          type: 'string',
          description: 'Conteúdo COMPLETO do arquivo — inclua todo o código, não apenas o trecho alterado',
        },
      },
      required: ['file_path', 'content'],
    },
  },
  {
    name: 'create_github_commit',
    description: 'Cria um commit atômico com todos os arquivos preparados via write_github_file. Chame após preparar um conjunto lógico de arquivos (ex: módulo + testes).',
    input_schema: {
      type: 'object' as const,
      properties: {
        commit_message: {
          type: 'string',
          description: 'Mensagem do commit seguindo a convenção Conventional Commits (ex: "feat(TASK-01): migration Drizzle tabelas users")',
        },
      },
      required: ['commit_message'],
    },
  },
  {
    name: 'create_pull_request',
    description: 'Cria um Pull Request do branch de desenvolvimento para o branch principal. Chame SOMENTE após escrever todos os arquivos.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: {
          type: 'string',
          description: 'Título do PR no formato "[JIRA-KEY] descrição" (ex: "[SCRUM-15] Implementar autenticação JWT")',
        },
        body: {
          type: 'string',
          description: 'Corpo do PR em markdown com seções: Resumo, Tasks implementadas, Arquivos, Próximos passos',
        },
      },
      required: ['title', 'body'],
    },
  },
];

// ─── Loop de tool-use do agente DEV ──────────────────────────────────────────

async function runDevAgent(
  jiraKey: string,
  summary: string,
  agentRunId: string,
  devBranch: string,
  correctionMode: boolean = false,
  correctionIteration: number = 1,
  signal?: AbortSignal,
): Promise<DevAgentResult & { inputTokens: number; outputTokens: number }> {
  const jobLog = log.child({ jiraKey, agentRunId, devBranch, correctionMode });
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const model = process.env.ANTHROPIC_MODEL ?? 'claude-opus-4-7';

  const prdBranch = `prd/${jiraKey.toLowerCase()}`;
  const today = new Date().toISOString().split('T')[0];

  // Estado local por execução — cada invocação cria seu próprio contexto,
  // garantindo isolamento total entre workers paralelos sem vazamento de estado.
  const filesWritten: string[] = [];
  const stagedFiles = new Map<string, string>(); // path → content
  let prResult: PullRequestResult | null = null;

  const initialMessage = correctionMode
    ? `Data atual: ${today}
História: ${jiraKey} — "${summary}"
Branch: ${devBranch}
Ciclo de correção: ${correctionIteration}/3

O Agente QA detectou problemas que precisam ser corrigidos neste branch.

Siga estas etapas:
1. Leia "CORRECTION_REQUEST.md" no branch "${devBranch}" para entender o que precisa ser corrigido
2. Leia com read_github_file APENAS os arquivos explicitamente listados no CORRECTION_REQUEST.md — não explore outros arquivos
3. Implemente as correções nos arquivos listados
4. Crie os commits com create_github_commit
5. NÃO chame create_pull_request — o PR já existe e será reutilizado`
    : `Data atual: ${today}
História: ${jiraKey} — "${summary}"
Branch do plano: ${prdBranch}
Branch de desenvolvimento: ${devBranch} (já criado, baseado em master)

Implemente completamente todos os requisitos do PLANO_DE_EXECUCAO.md desta história.

Lembre-se:
1. Leia o PLANO_DE_EXECUCAO.md em "${jiraKey}/PLANO_DE_EXECUCAO.md" no branch "${prdBranch}"
2. Leia APENAS os arquivos nomeados nas tasks do PLANO antes de escrevê-los — não explore a codebase por conta própria
3. Implemente na ordem das Ondas de Execução do PLANO
4. Escreva testes unitários para cada módulo implementado
5. Finalize obrigatoriamente com create_pull_request`;

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: initialMessage },
  ];

  jobLog.debug({ model }, 'iniciando loop de tool-use com Claude');

  const dispatchTool = async (block: Anthropic.ToolUseBlock): Promise<string> => {
    if (block.name === 'read_github_file') {
      const { file_path, branch } = block.input as { file_path: string; branch?: string };
      const content = await readFile(file_path, branch);
      jobLog.debug({ file_path, branch, found: content !== null }, 'read_github_file executado');
      return content !== null ? sanitizeForLlm(content) : '(arquivo não encontrado)';
    }

    if (block.name === 'list_github_directory') {
      const { dir_path, branch } = block.input as { dir_path: string; branch?: string };
      const entries = await listDirectory(dir_path, branch);
      jobLog.debug({ dir_path, count: entries.length }, 'list_github_directory executado');
      return JSON.stringify(entries);
    }

    if (block.name === 'write_github_file') {
      const { file_path, content } = block.input as { file_path: string; content: string };
      stagedFiles.set(file_path, content);
      jobLog.debug({ file_path, total_staged: stagedFiles.size }, 'arquivo preparado para commit');
      return JSON.stringify({ staged: true, file_path, total_staged: stagedFiles.size });
    }

    if (block.name === 'create_github_commit') {
      const { commit_message } = block.input as { commit_message: string };
      if (stagedFiles.size === 0) {
        return JSON.stringify({ success: false, reason: 'nenhum arquivo preparado para commit' });
      }
      const batch = Array.from(stagedFiles.entries()).map(([path, content]) => ({ path, content }));
      const commitResult = await commitFiles(batch, commit_message, devBranch);
      for (const { path } of batch) filesWritten.push(path);
      stagedFiles.clear();
      jobLog.info({ sha: commitResult.sha, files: batch.length }, 'commit atômico criado');
      return JSON.stringify({ success: true, sha: commitResult.sha, files_committed: batch.length });
    }

    if (block.name === 'create_pull_request') {
      const { title, body } = block.input as { title: string; body: string };
      // Commit automático de arquivos ainda em staging antes de criar o PR
      if (stagedFiles.size > 0) {
        const remaining = Array.from(stagedFiles.entries()).map(([path, content]) => ({ path, content }));
        const autoCommit = await commitFiles(remaining, 'chore: commit final de arquivos pendentes', devBranch);
        for (const { path } of remaining) filesWritten.push(path);
        stagedFiles.clear();
        jobLog.info({ sha: autoCommit.sha, files: remaining.length }, 'auto-commit de arquivos pendentes antes do PR');
      }
      prResult = await createPullRequest(title, body, devBranch);
      jobLog.info({ prNumber: prResult.number, prHtmlUrl: prResult.html_url }, 'PR criado');
      return JSON.stringify(prResult);
    }

    return `Ferramenta desconhecida: ${block.name}`;
  };

  const { result, inputTokens, outputTokens } = await runAgentLoop<DevAgentResult>({
    anthropic,
    redis: redisConnection,
    model,
    system: DEV_SYSTEM_PROMPT,
    tools: DEV_TOOLS,
    messages,
    maxTurns: correctionMode ? 60 : 40,
    log: jobLog,
    label: 'DEV',
    dispatchTool,
    signal,
    onEndTurn: () => {
      if (!correctionMode && !prResult) {
        throw new Error('Agente DEV encerrou sem criar o Pull Request — verifique o loop de tools');
      }
      jobLog.info(
        { correctionMode, prNumber: prResult?.number ?? 0, filesWritten: filesWritten.length },
        'agente DEV concluiu',
      );
      return {
        prNumber: prResult?.number ?? 0,
        prUrl: prResult?.url ?? '',
        prHtmlUrl: prResult?.html_url ?? '',
        filesWritten,
        branch: devBranch,
      };
    },
  });
  return { ...result, inputTokens, outputTokens };
}

// ─── Processador do job DEV ───────────────────────────────────────────────────

async function processDevJob(job: Job<DevAgentJobData>): Promise<unknown> {
  const { storyId, jiraKey, projectKey, agentRunId, summary, correctionMode, correctionIteration } = job.data;
  const startedAt = new Date();
  const model = process.env.ANTHROPIC_MODEL ?? 'claude-opus-4-7';
  const jobLog = log.child({ jiraKey, projectKey, agentRunId, storyId, correctionMode });
  const phase = correctionMode ? 'dev_correction' : 'development';

  logAgentStarted(jobLog, { storyId, jiraKey, projectKey, agentRunId, agent: 'dev', phase });

  // 1. Marca run como 'running'
  await db
    .update(schema.agentRuns)
    .set({ status: 'running', startedAt })
    .where(eq(schema.agentRuns.id, agentRunId));

  try {
    // 2. Cria (ou reutiliza) branch de desenvolvimento
    const devBranch = `agent/task-${jiraKey.toLowerCase()}`;
    await createBranch(devBranch); // idempotente: ignora 422 se branch já existe
    jobLog.debug({ devBranch }, 'branch verificado/criado');

    // 3. Executa o agente DEV — timeout de 15 min configurável
    const agentTimeoutMs = Number(process.env.DEV_AGENT_TIMEOUT_MS ?? 900_000);
    const signal = AbortSignal.timeout(agentTimeoutMs);
    const devResult = await runDevAgent(
      jiraKey, summary, agentRunId, devBranch,
      correctionMode ?? false, correctionIteration ?? 1,
      signal,
    );

    jobLog.info(
      { filesWritten: devResult.filesWritten.length, prNumber: devResult.prNumber },
      correctionMode ? 'correção concluída pelo Claude' : 'implementação concluída pelo Claude',
    );

    // Modo correção: apenas persiste o resultado e retorna — QA assume o controle
    if (correctionMode) {
      const completedAt = new Date();
      const durationMs = completedAt.getTime() - startedAt.getTime();
      const costUsd = calculateCostUsd(model, devResult.inputTokens, devResult.outputTokens);
      const output = { correctionMode: true, filesWritten: devResult.filesWritten, iteration: correctionIteration };
      await db
        .update(schema.agentRuns)
        .set({ status: 'completed', output, durationMs, completedAt,
               inputTokens: devResult.inputTokens, outputTokens: devResult.outputTokens, costUsd })
        .where(eq(schema.agentRuns.id, agentRunId));
      await checkAndAlertIfOverBudget(storyId, jiraKey, jobLog);
      logAgentCompleted(jobLog, { storyId, jiraKey, agentRunId, agent: 'dev', phase, durationMs, inputTokens: devResult.inputTokens, outputTokens: devResult.outputTokens, tokenCostUsd: costUsd });
      return output;
    }

    // 4. Salva artifact no banco
    const [artifact] = await db
      .insert(schema.artifacts)
      .values({
        storyId,
        agentRunId,
        artifactType: 'code',
        filePath: devBranch,
        content: JSON.stringify({ filesWritten: devResult.filesWritten }),
        storageUrl: devResult.prHtmlUrl,
        githubCommitSha: devResult.branch,
      })
      .returning({ id: schema.artifacts.id });

    jobLog.info({ artifactId: artifact!.id }, 'artifact code salvo no banco');

    // 5. Move card para "Aguardando Aceite Dev"
    try {
      await moveCardTo(jiraKey, 'Aguardando Aceite Dev');
      jobLog.info({ to: 'Aguardando Aceite Dev' }, 'card movido no Jira');
    } catch (err) {
      jobLog.error({ err: (err as Error).message }, 'falha ao mover card — abortando');
      throw err;
    }

    // 6. Sincroniza status no banco
    await updateStoryStatus(jiraKey, 'Aguardando Aceite Dev', {
      lastAgentType: 'dev',
      lastAgentRunId: agentRunId,
    });

    // 7. Comenta no Jira com link para o PR
    const comment =
      `🤖 *Agente DEV* concluiu a implementação.\n\n` +
      `📦 Pull Request: ${devResult.prHtmlUrl}\n` +
      `📝 Arquivos implementados: ${devResult.filesWritten.length}\n` +
      `🌿 Branch: \`${devResult.branch}\`\n\n` +
      `Aguardando revisão e aprovação do DEV humano (Gate 3/5).`;

    try {
      await addComment(jiraKey, comment);
      jobLog.debug('comentário adicionado no Jira');
    } catch (err) {
      jobLog.warn({ err: (err as Error).message }, 'falha ao comentar — fluxo não interrompido');
    }

    // 8. Marca run como 'completed'
    const completedAt = new Date();
    const durationMs = completedAt.getTime() - startedAt.getTime();
    const costUsd = calculateCostUsd(model, devResult.inputTokens, devResult.outputTokens);
    const output = {
      prNumber: devResult.prNumber,
      prUrl: devResult.prHtmlUrl,
      branch: devResult.branch,
      filesWritten: devResult.filesWritten,
    };

    await db
      .update(schema.agentRuns)
      .set({ status: 'completed', output, durationMs, completedAt,
             inputTokens: devResult.inputTokens, outputTokens: devResult.outputTokens, costUsd })
      .where(eq(schema.agentRuns.id, agentRunId));

    await checkAndAlertIfOverBudget(storyId, jiraKey, jobLog);

    logAgentCompleted(jobLog, { storyId, jiraKey, agentRunId, agent: 'dev', phase, durationMs, inputTokens: devResult.inputTokens, outputTokens: devResult.outputTokens, tokenCostUsd: costUsd });
    return output;

  } catch (err) {
    const errorMessage = (err as Error).message;
    const completedAt = new Date();
    const durationMs = completedAt.getTime() - startedAt.getTime();

    await db
      .update(schema.agentRuns)
      .set({ status: 'failed', errorMessage, durationMs, completedAt })
      .where(eq(schema.agentRuns.id, agentRunId));

    logAgentFailed(jobLog, { storyId, jiraKey, agentRunId, agent: 'dev', phase, durationMs, error: errorMessage });
    void sendBetterstackAlert({ level: 'error', event: 'agent_failed', message: `[${jiraKey}] agente DEV falhou: ${errorMessage}`, jiraKey, storyId, agentRunId, phase, durationMs });
    throw err;
  }
}

// ─── Criação do Worker ────────────────────────────────────────────────────────

export function createDevAgentWorker() {
  const worker = new Worker<DevAgentJobData>('agent-dev', processDevJob, {
    connection: redisConnection,
    concurrency: 5,          // até 5 histórias implementadas em paralelo
    lockDuration: 960_000,   // 16 min — margem sobre o timeout de 15 min do agente
  });

  worker.on('completed', (job, result) => {
    log.info({ jobId: job.id, result }, 'job concluído');
  });

  worker.on('failed', (job, err) => {
    const isFinalAttempt = job != null && job.attemptsMade >= (job.opts.attempts ?? 1);
    log.error(
      { jobId: job?.id, attempt: job?.attemptsMade, maxAttempts: job?.opts.attempts, err: err.message, finalAttempt: isFinalAttempt },
      'job falhou',
    );
    if (isFinalAttempt && job) {
      const { jiraKey, storyId, agentRunId } = job.data;
      void agentDlqQueue.add('dead-letter', {
        originalQueue: 'agent-dev', jobId: job.id, jobData: job.data,
        failedAt: new Date().toISOString(), errorMessage: err.message, attemptsMade: job.attemptsMade,
      });
      void addComment(jiraKey,
        `⚠️ *Agente DEV* falhou após ${job.attemptsMade} tentativas e requer intervenção humana.\n\n` +
        `Erro: ${err.message}\n\nJob ID: ${job.id ?? 'n/a'} | Run ID: ${agentRunId ?? 'n/a'} | Story: ${storyId}`,
      ).catch(() => {});
    }
  });

  worker.on('error', (err) => {
    log.error({ err: err.message }, 'erro no worker');
  });

  log.info('worker DEV iniciado — aguardando jobs');
  return worker;
}
