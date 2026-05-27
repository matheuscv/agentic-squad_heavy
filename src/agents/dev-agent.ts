import Anthropic from '@anthropic-ai/sdk';
import { Queue, Worker, type Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index';
import { updateStoryStatus } from '../db/stories';
import { redisConnection } from '../queue/index';
import { moveCardTo, addComment } from '../jira/client';
import { createBranch, readFile, listDirectory, commitFiles, createPullRequest, type PullRequestResult } from '../github/client';
import { childLogger } from '../lib/logger';
import { runAgentLoop } from '../lib/agent-loop';
import { DEV_SYSTEM_PROMPT } from './prompts/dev-system-prompt';

const log = childLogger({ module: 'agent.dev' });

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type DevAgentJobData = {
  storyId: string;
  jiraKey: string;
  agentRunId: string;
  summary: string;
  fromStatus: string | null;
  correctionMode?: boolean;     // true quando invocado pelo Agente QA para corrigir falhas
  correctionIteration?: number; // ciclo de correção (1–3)
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
          description: 'Caminho do arquivo a partir da raiz do repositório (ex: src/db/schema.ts, SCRUM-15/PRD.md)',
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
    description: 'Lista os arquivos e subdiretórios em um caminho do repositório. Use para mapear a estrutura de pastas antes de escrever arquivos.',
    input_schema: {
      type: 'object' as const,
      properties: {
        dir_path: {
          type: 'string',
          description: 'Caminho do diretório a partir da raiz (ex: "src", "src/auth", "src/lib")',
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
    description: 'Prepara (staging) um arquivo para o próximo commit. Chame create_github_commit quando quiser persistir um conjunto de arquivos de uma vez.',
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
): Promise<DevAgentResult> {
  const jobLog = log.child({ jiraKey, agentRunId, devBranch, correctionMode });
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const model = process.env.ANTHROPIC_MODEL ?? 'claude-opus-4-7';

  const prdBranch = `prd/${jiraKey.toLowerCase()}`;
  const today = new Date().toISOString().split('T')[0];

  // Estado acumulado durante a execução
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
2. Explore os arquivos mencionados no request com read_github_file e list_github_directory
3. Implemente as correções nos arquivos de código e/ou testes necessários
4. Crie os commits com create_github_commit
5. NÃO chame create_pull_request — o PR já existe e será reutilizado`
    : `Data atual: ${today}
História: ${jiraKey} — "${summary}"
Branch do plano: ${prdBranch}
Branch de desenvolvimento: ${devBranch} (já criado, baseado em master)

Implemente completamente todos os requisitos do PLANO_DE_EXECUCAO.md desta história.

Lembre-se:
1. Leia o PLANO_DE_EXECUCAO.md em "${jiraKey}/PLANO_DE_EXECUCAO.md" no branch "${prdBranch}"
2. Explore o código existente antes de escrever qualquer arquivo
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
      return content ?? '(arquivo não encontrado)';
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

  return runAgentLoop<DevAgentResult>({
    anthropic,
    redis: redisConnection,
    model,
    system: DEV_SYSTEM_PROMPT,
    tools: DEV_TOOLS,
    messages,
    maxTurns: 40,
    log: jobLog,
    label: 'DEV',
    dispatchTool,
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
}

// ─── Processador do job DEV ───────────────────────────────────────────────────

async function processDevJob(job: Job<DevAgentJobData>): Promise<unknown> {
  const { storyId, jiraKey, agentRunId, summary, correctionMode, correctionIteration } = job.data;
  const startedAt = new Date();
  const jobLog = log.child({ jiraKey, agentRunId, storyId, correctionMode });

  jobLog.info(correctionMode ? 'iniciando correção DEV (modo correção)' : 'iniciando execução do agente DEV');

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

    // 3. Executa o agente DEV
    const devResult = await runDevAgent(
      jiraKey, summary, agentRunId, devBranch,
      correctionMode ?? false, correctionIteration ?? 1,
    );

    jobLog.info(
      { filesWritten: devResult.filesWritten.length, prNumber: devResult.prNumber },
      correctionMode ? 'correção concluída pelo Claude' : 'implementação concluída pelo Claude',
    );

    // Modo correção: apenas persiste o resultado e retorna — QA assume o controle
    if (correctionMode) {
      const completedAt = new Date();
      const durationMs = completedAt.getTime() - startedAt.getTime();
      const output = { correctionMode: true, filesWritten: devResult.filesWritten, iteration: correctionIteration };
      await db
        .update(schema.agentRuns)
        .set({ status: 'completed', output, durationMs, completedAt })
        .where(eq(schema.agentRuns.id, agentRunId));
      jobLog.info({ durationMs, files: devResult.filesWritten.length }, 'correção DEV concluída');
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
    const output = {
      prNumber: devResult.prNumber,
      prUrl: devResult.prHtmlUrl,
      branch: devResult.branch,
      filesWritten: devResult.filesWritten,
    };

    await db
      .update(schema.agentRuns)
      .set({ status: 'completed', output, durationMs, completedAt })
      .where(eq(schema.agentRuns.id, agentRunId));

    jobLog.info({ durationMs, prNumber: devResult.prNumber }, 'agente DEV concluído');
    return output;

  } catch (err) {
    const errorMessage = (err as Error).message;
    const completedAt = new Date();
    const durationMs = completedAt.getTime() - startedAt.getTime();

    await db
      .update(schema.agentRuns)
      .set({ status: 'failed', errorMessage, durationMs, completedAt })
      .where(eq(schema.agentRuns.id, agentRunId));

    jobLog.error({ err: errorMessage, durationMs, attempt: job.attemptsMade + 1 }, 'agente DEV falhou');
    throw err;
  }
}

// ─── Criação do Worker ────────────────────────────────────────────────────────

export function createDevAgentWorker() {
  const worker = new Worker<DevAgentJobData>('agent-dev', processDevJob, {
    connection: redisConnection,
    concurrency: 2,
    lockDuration: 600_000, // 10 min — DEV pode levar bastante tempo
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

  log.info('worker DEV iniciado — aguardando jobs');
  return worker;
}
