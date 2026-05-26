import Anthropic from '@anthropic-ai/sdk';
import { Queue, Worker, type Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index';
import { updateStoryStatus } from '../db/stories';
import { redisConnection } from '../queue/index';
import { moveCardTo, addComment } from '../jira/client';
import { createBranch, readFile, listDirectory, commitFile, createPullRequest, type PullRequestResult } from '../github/client';
import { childLogger } from '../lib/logger';
import { DEV_SYSTEM_PROMPT } from './prompts/dev-system-prompt';

const log = childLogger({ module: 'agent.dev' });

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type DevAgentJobData = {
  storyId: string;
  jiraKey: string;
  agentRunId: string;
  summary: string;
  fromStatus: string | null;
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
    attempts: 2,
    backoff: { type: 'exponential', delay: 10_000 },
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
    description: 'Escreve ou atualiza um arquivo no branch de desenvolvimento e cria um commit. Leia o arquivo existente antes de sobrescrevê-lo.',
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
        commit_message: {
          type: 'string',
          description: 'Mensagem do commit seguindo a convenção (ex: "feat(TASK-01): migration Drizzle tabelas users")',
        },
      },
      required: ['file_path', 'content', 'commit_message'],
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
): Promise<DevAgentResult> {
  const jobLog = log.child({ jiraKey, agentRunId, devBranch });
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const model = process.env.ANTHROPIC_MODEL ?? 'claude-opus-4-7';

  const prdBranch = `prd/${jiraKey.toLowerCase()}`;
  const today = new Date().toISOString().split('T')[0];

  // Estado acumulado durante a execução
  const filesWritten: string[] = [];
  let prResult: PullRequestResult | null = null;

  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: `Data atual: ${today}
História: ${jiraKey} — "${summary}"
Branch do plano: ${prdBranch}
Branch de desenvolvimento: ${devBranch} (já criado, baseado em master)

Implemente completamente todos os requisitos do PLANO_DE_EXECUCAO.md desta história.

Lembre-se:
1. Leia o PLANO_DE_EXECUCAO.md em "${jiraKey}/PLANO_DE_EXECUCAO.md" no branch "${prdBranch}"
2. Explore o código existente antes de escrever qualquer arquivo
3. Implemente na ordem das Ondas de Execução do PLANO
4. Escreva testes unitários para cada módulo implementado
5. Finalize obrigatoriamente com create_pull_request`,
    },
  ];

  jobLog.debug({ model }, 'iniciando loop de tool-use com Claude');

  for (let turn = 0; turn < 40; turn++) {
    const response = await anthropic.messages.create({
      model,
      max_tokens: 8192,
      system: DEV_SYSTEM_PROMPT,
      tools: DEV_TOOLS,
      messages,
    });

    jobLog.debug(
      { turn, stop_reason: response.stop_reason, usage: response.usage },
      'resposta do Claude recebida',
    );

    messages.push({ role: 'assistant', content: response.content });

    // Resposta final
    if (response.stop_reason === 'end_turn') {
      if (!prResult) {
        throw new Error('Agente DEV encerrou sem criar o Pull Request — verifique o loop de tools');
      }
      jobLog.info(
        { prNumber: prResult.number, filesWritten: filesWritten.length },
        'agente DEV concluiu a implementação',
      );
      return {
        prNumber: prResult.number,
        prUrl: prResult.url,
        prHtmlUrl: prResult.html_url,
        filesWritten,
        branch: devBranch,
      };
    }

    // Executa ferramentas
    if (response.stop_reason === 'tool_use') {
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;

        let result: string;
        try {
          if (block.name === 'read_github_file') {
            const { file_path, branch } = block.input as { file_path: string; branch?: string };
            const content = await readFile(file_path, branch);
            result = content ?? '(arquivo não encontrado)';
            jobLog.debug({ file_path, branch, found: content !== null }, 'read_github_file executado');

          } else if (block.name === 'list_github_directory') {
            const { dir_path, branch } = block.input as { dir_path: string; branch?: string };
            const entries = await listDirectory(dir_path, branch);
            result = JSON.stringify(entries);
            jobLog.debug({ dir_path, count: entries.length }, 'list_github_directory executado');

          } else if (block.name === 'write_github_file') {
            const { file_path, content, commit_message } = block.input as {
              file_path: string;
              content: string;
              commit_message: string;
            };
            const commitResult = await commitFile(file_path, content, commit_message, devBranch);
            filesWritten.push(file_path);
            result = JSON.stringify({ success: true, sha: commitResult.sha, file_path });
            jobLog.info({ file_path, sha: commitResult.sha }, 'arquivo escrito no branch');

          } else if (block.name === 'create_pull_request') {
            const { title, body } = block.input as { title: string; body: string };
            prResult = await createPullRequest(title, body, devBranch);
            result = JSON.stringify(prResult);
            jobLog.info({ prNumber: prResult.number, prHtmlUrl: prResult.html_url }, 'PR criado');

          } else {
            result = `Ferramenta desconhecida: ${block.name}`;
          }
        } catch (err) {
          result = `Erro ao executar ferramenta ${block.name}: ${(err as Error).message}`;
          jobLog.warn({ tool: block.name, err: (err as Error).message }, 'ferramenta retornou erro');
        }

        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });
      }

      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    throw new Error(`stop_reason inesperado: ${response.stop_reason}`);
  }

  throw new Error('Agente DEV excedeu o limite de 40 turnos sem concluir a implementação');
}

// ─── Processador do job DEV ───────────────────────────────────────────────────

async function processDevJob(job: Job<DevAgentJobData>): Promise<unknown> {
  const { storyId, jiraKey, agentRunId, summary } = job.data;
  const startedAt = new Date();
  const jobLog = log.child({ jiraKey, agentRunId, storyId });

  jobLog.info('iniciando execução do agente DEV');

  // 1. Marca run como 'running'
  await db
    .update(schema.agentRuns)
    .set({ status: 'running', startedAt })
    .where(eq(schema.agentRuns.id, agentRunId));

  try {
    // 2. Cria branch de desenvolvimento
    const devBranch = `dev/${jiraKey.toLowerCase()}`;
    await createBranch(devBranch);
    jobLog.debug({ devBranch }, 'branch de desenvolvimento criado');

    // 3. Executa o agente DEV
    const devResult = await runDevAgent(jiraKey, summary, agentRunId, devBranch);

    jobLog.info(
      { filesWritten: devResult.filesWritten.length, prNumber: devResult.prNumber },
      'implementação concluída pelo Claude',
    );

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
