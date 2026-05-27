import Anthropic from '@anthropic-ai/sdk';
import { Queue, Worker, type Job } from 'bullmq';
import { and, eq, inArray } from 'drizzle-orm';
import { db, schema } from '../db/index';
import { updateStoryStatus } from '../db/stories';
import { redisConnection } from '../queue/index';
import { moveCardTo, addComment } from '../jira/client';
import {
  readFile,
  listDirectory,
  commitFiles,
  getLatestWorkflowRun,
  waitForWorkflowCompletion,
  getPrFiles,
  type PrFileEntry,
} from '../github/client';
import { devAgentQueue } from './dev-agent';
import { childLogger } from '../lib/logger';
import { runAgentLoop } from '../lib/agent-loop';
import { QA_SYSTEM_PROMPT } from './prompts/qa-system-prompt';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const log = childLogger({ module: 'agent.qa' });

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type QaAgentJobData = {
  storyId: string;
  jiraKey: string;
  agentRunId: string;
  summary: string;
  fromStatus: string | null;
};

type QaAgentResult = {
  passed: boolean;
  iterations: number;
  finalCoverage: Record<string, unknown> | null;
  testsWritten: string[];
  summary: string;
};

// ─── Fila do agente QA ────────────────────────────────────────────────────────

export const qaAgentQueue = new Queue<QaAgentJobData>('agent-qa', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 4,
    backoff: { type: 'exponential', delay: 60_000 },
    removeOnComplete: { count: 25 },
    removeOnFail: { count: 10 },
  },
});

// ─── Definição das ferramentas ────────────────────────────────────────────────

const QA_TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_pr_files',
    description:
      'Retorna a lista EXATA de arquivos modificados no PR do branch DEV. Use como PRIMEIRO passo para focar a revisão apenas nos arquivos alterados — não revise a codebase inteira.',
    input_schema: {
      type: 'object' as const,
      properties: {
        branch: {
          type: 'string',
          description: 'Branch do agente DEV (ex: agent/task-scrum-16)',
        },
      },
      required: ['branch'],
    },
  },
  {
    name: 'get_workflow_run_result',
    description:
      'Obtém o resultado do CI mais recente no branch e a cobertura atual (.qa-coverage.json). Chame sempre antes de escrever novos testes.',
    input_schema: {
      type: 'object' as const,
      properties: {
        branch: {
          type: 'string',
          description: 'Nome do branch (ex: agent/task-scrum-15)',
        },
      },
      required: ['branch'],
    },
  },
  {
    name: 'read_github_file',
    description: 'Lê o conteúdo de um arquivo do repositório. Use APENAS para arquivos retornados por get_pr_files ou o arquivo .test.ts correspondente ao mesmo caminho de um módulo do PR — nunca para arquivos fora desse escopo.',
    input_schema: {
      type: 'object' as const,
      properties: {
        file_path: {
          type: 'string',
          description: 'Caminho do arquivo a partir da raiz do repositório',
        },
        branch: {
          type: 'string',
          description: 'Branch opcional (padrão: branch do agente DEV)',
        },
      },
      required: ['file_path'],
    },
  },
  {
    name: 'list_github_directory',
    description: 'Lista arquivos em um diretório ESPECÍFICO. Use APENAS para verificar se o arquivo de teste correspondente a um módulo do PR já existe (ex: "src/utils" para checar se currency.test.ts existe) — nunca para varrer "src" inteiro ou diretórios fora do escopo do PR.',
    input_schema: {
      type: 'object' as const,
      properties: {
        dir_path: {
          type: 'string',
          description: 'Diretório ESPECÍFICO de um módulo retornado por get_pr_files — NUNCA "src" sozinho',
        },
        branch: {
          type: 'string',
          description: 'Branch opcional',
        },
      },
      required: ['dir_path'],
    },
  },
  {
    name: 'write_github_file',
    description:
      'Prepara (staging) um arquivo de teste. Apenas *.test.ts ou *.spec.ts são permitidos. Não modifique código de produção.',
    input_schema: {
      type: 'object' as const,
      properties: {
        file_path: {
          type: 'string',
          description: 'Caminho do arquivo — deve terminar em .test.ts ou .spec.ts',
        },
        content: {
          type: 'string',
          description: 'Conteúdo COMPLETO do arquivo de teste',
        },
      },
      required: ['file_path', 'content'],
    },
  },
  {
    name: 'create_github_commit',
    description: 'Cria commit atômico com todos os arquivos de teste preparados via write_github_file.',
    input_schema: {
      type: 'object' as const,
      properties: {
        commit_message: {
          type: 'string',
          description: 'Ex: "test(QA-iter-1): aumenta cobertura em módulo auth"',
        },
      },
      required: ['commit_message'],
    },
  },
  {
    name: 'wait_for_ci',
    description:
      'Aguarda a conclusão do próximo run do CI após escrever novos testes (bloqueia até 10 min). Use o run_id retornado por get_workflow_run_result.',
    input_schema: {
      type: 'object' as const,
      properties: {
        branch: {
          type: 'string',
          description: 'Nome do branch',
        },
        current_run_id: {
          type: 'number',
          description: 'ID do run atual — aguarda um run com ID maior que este',
        },
      },
      required: ['branch', 'current_run_id'],
    },
  },
  {
    name: 'create_correction_request',
    description:
      'Cria CORRECTION_REQUEST.md no branch com o pedido de correção e aciona o Agente DEV para implementar as correções. Retorna o agentRunId para uso em wait_for_dev_correction.',
    input_schema: {
      type: 'object' as const,
      properties: {
        iteration: {
          type: 'number',
          description: 'Número do ciclo de correção (1, 2 ou 3)',
        },
        description: {
          type: 'string',
          description: 'Descrição clara e objetiva do problema detectado e o que precisa ser corrigido',
        },
        files_with_issues: {
          type: 'array',
          items: { type: 'string' },
          description: 'Lista de arquivos com problemas de código ou cobertura',
        },
        failing_tests: {
          type: 'array',
          items: { type: 'string' },
          description: 'Nomes dos testes que estão falhando (se houver regressão)',
        },
        coverage_gaps: {
          type: 'object',
          description: 'Módulos/métricas com cobertura abaixo de 80% (ex: { "src/auth/jwt.ts": { "statements": 60 } })',
        },
      },
      required: ['iteration', 'description'],
    },
  },
  {
    name: 'wait_for_dev_correction',
    description:
      'Aguarda a conclusão do job de correção do Agente DEV (bloqueia até 20 min). Use o agentRunId retornado por create_correction_request.',
    input_schema: {
      type: 'object' as const,
      properties: {
        agent_run_id: {
          type: 'string',
          description: 'UUID do agentRun do Agente DEV retornado por create_correction_request',
        },
      },
      required: ['agent_run_id'],
    },
  },
  {
    name: 'escalate_to_human',
    description:
      'Registra que algum arquivo do PR não atingiu 80% de cobertura após 3 iterações e notifica via Jira. Chame ANTES de finish_qa_review quando esgotadas as tentativas.',
    input_schema: {
      type: 'object' as const,
      properties: {
        reason: {
          type: 'string',
          description: 'Explicação do problema e quais módulos ficaram com cobertura insuficiente',
        },
        final_coverage: {
          type: 'object',
          description: 'Métricas finais de cobertura obtidas (objeto com statements/branches/functions/lines)',
        },
      },
      required: ['reason'],
    },
  },
  {
    name: 'finish_qa_review',
    description:
      'Finaliza a revisão QA. SEMPRE chame como última ferramenta, independente do resultado.',
    input_schema: {
      type: 'object' as const,
      properties: {
        passed: {
          type: 'boolean',
          description: 'true se todos os arquivos do PR têm cobertura ≥ 80% em todas as métricas, false se escalado para humano',
        },
        coverage: {
          type: 'object',
          description: 'Métricas finais { statements: {pct}, branches: {pct}, functions: {pct}, lines: {pct} }',
        },
        summary: {
          type: 'string',
          description: 'Relatório QA em markdown: estado do CI, cobertura inicial vs final, regressões detectadas, conclusão',
        },
        tests_written: {
          type: 'array',
          items: { type: 'string' },
          description: 'Lista de arquivos de teste criados ou modificados',
        },
        iterations: {
          type: 'number',
          description: 'Número de iterações de escrita de testes realizadas (0 se cobertura já estava OK)',
        },
      },
      required: ['passed', 'summary', 'iterations'],
    },
  },
];

// ─── Loop de tool-use do agente QA ───────────────────────────────────────────

async function runQaAgent(
  jiraKey: string,
  summary: string,
  agentRunId: string,
  storyId: string,
): Promise<QaAgentResult> {
  const devBranch = `agent/task-${jiraKey.toLowerCase()}`;
  const jobLog = log.child({ jiraKey, agentRunId, devBranch });
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const model = process.env.ANTHROPIC_MODEL ?? 'claude-opus-4-7';

  const stagedFiles = new Map<string, string>();
  let qaResult: QaAgentResult | null = null;
  // Filenames dos arquivos fonte modificados no PR (populado pelo handler get_pr_files)
  let prSourceFiles: string[] = [];

  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content:
        `Data: ${new Date().toISOString().split('T')[0]}\n` +
        `História: ${jiraKey} — "${summary}"\n` +
        `Branch DEV: ${devBranch}\n\n` +
        `Execute a revisão QA completa conforme suas instruções. ` +
        `Comece chamando get_pr_files e get_workflow_run_result em paralelo no mesmo turno.`,
    },
  ];

  jobLog.info({ model }, 'iniciando loop de tool-use QA com Claude');

  const dispatchTool = async (block: Anthropic.ToolUseBlock): Promise<string> => {
    if (block.name === 'get_pr_files') {
      const { branch } = block.input as { branch: string };
      const files = await getPrFiles(branch);
      jobLog.debug({ branch, fileCount: files.length }, 'ferramenta get_pr_files executada');
      if (!files.length) return '(nenhum arquivo encontrado no PR — verifique se o PR foi criado pelo Agente DEV)';
      // Guarda filenames dos arquivos fonte (não-teste) para filtrar cobertura por arquivo do PR
      prSourceFiles = (files as PrFileEntry[])
        .map(f => f.filename)
        .filter(n => !n.endsWith('.test.ts') && !n.endsWith('.spec.ts'));
      return JSON.stringify(files);
    }

    if (block.name === 'get_workflow_run_result') {
      const { branch } = block.input as { branch: string };
      const run = await getLatestWorkflowRun(branch);
      const coverageRaw = await readFile('.qa-coverage.json', branch);
      const coverageParsed = coverageRaw ? (JSON.parse(coverageRaw) as Record<string, unknown>) : null;

      let coverage: Record<string, unknown> | null = null;
      if (coverageParsed) {
        const { total, ...perFile } = coverageParsed;
        coverage = { total };

        if (prSourceFiles.length > 0) {
          // Filtra cobertura para os arquivos do PR (chaves do JSON são caminhos absolutos)
          const filesCoverage: Record<string, unknown> = {};
          for (const prFile of prSourceFiles) {
            const normalizedPrFile = prFile.replace(/\\/g, '/');
            const absKey = Object.keys(perFile).find(k => k.replace(/\\/g, '/').endsWith(`/${normalizedPrFile}`));
            if (absKey) filesCoverage[prFile] = perFile[absKey];
          }
          if (Object.keys(filesCoverage).length > 0) coverage.files = filesCoverage;
        } else {
          // get_pr_files ainda não processado neste turno — agente deve re-chamar get_workflow_run_result no próximo turno
          coverage.note = 'coverage.files indisponível: get_pr_files ainda não foi processado. Re-chame get_workflow_run_result no próximo turno para obter cobertura por arquivo do PR.';
        }
      }

      jobLog.debug({ branch, runId: run?.runId, conclusion: run?.conclusion }, 'workflow run obtido');
      return JSON.stringify({ run, coverage });
    }

    if (block.name === 'read_github_file') {
      const { file_path, branch } = block.input as { file_path: string; branch?: string };
      const content = await readFile(file_path, branch ?? devBranch);
      return content ?? '(arquivo não encontrado)';
    }

    if (block.name === 'list_github_directory') {
      const { dir_path, branch } = block.input as { dir_path: string; branch?: string };
      const entries = await listDirectory(dir_path, branch ?? devBranch);
      return JSON.stringify(entries);
    }

    if (block.name === 'write_github_file') {
      const { file_path, content } = block.input as { file_path: string; content: string };
      if (!file_path.endsWith('.test.ts') && !file_path.endsWith('.spec.ts')) {
        return JSON.stringify({ error: 'Apenas arquivos .test.ts ou .spec.ts são permitidos' });
      }
      stagedFiles.set(file_path, content);
      jobLog.debug({ file_path }, 'arquivo de teste preparado para staging');
      return JSON.stringify({ staged: true, file_path, total_staged: stagedFiles.size });
    }

    if (block.name === 'create_github_commit') {
      const { commit_message } = block.input as { commit_message: string };
      if (stagedFiles.size === 0) {
        return JSON.stringify({ success: false, reason: 'nenhum arquivo em staging' });
      }
      const batch = Array.from(stagedFiles.entries()).map(([path, content]) => ({ path, content }));
      const commitResult = await commitFiles(batch, commit_message, devBranch);
      stagedFiles.clear();
      jobLog.info({ sha: commitResult.sha, files: batch.length }, 'commit atômico de testes criado');
      return JSON.stringify({ success: true, sha: commitResult.sha, files_committed: batch.length });
    }

    if (block.name === 'wait_for_ci') {
      const { branch, current_run_id } = block.input as { branch: string; current_run_id: number };
      jobLog.info({ branch, current_run_id }, 'aguardando próximo run do CI');
      const newRun = await waitForWorkflowCompletion(branch, current_run_id, 600_000);
      jobLog.info({ newRun }, 'espera pelo CI concluída');
      return newRun ? JSON.stringify(newRun) : JSON.stringify({ timeout: true });
    }

    if (block.name === 'create_correction_request') {
      const { iteration, description, files_with_issues, failing_tests, coverage_gaps } = block.input as {
        iteration: number;
        description: string;
        files_with_issues?: string[];
        failing_tests?: string[];
        coverage_gaps?: Record<string, unknown>;
      };

      // 1. Gera e persiste CORRECTION_REQUEST.md no branch
      const correctionDoc = [
        `# Pedido de Correção — Iteração ${iteration}/3`,
        '',
        `## Problema detectado`,
        description,
        '',
        files_with_issues?.length
          ? `## Arquivos com problemas\n${files_with_issues.map((f) => `- \`${f}\``).join('\n')}`
          : '',
        failing_tests?.length
          ? `## Testes falhando\n${failing_tests.map((t) => `- ${t}`).join('\n')}`
          : '',
        coverage_gaps
          ? `## Cobertura insuficiente\n\`\`\`json\n${JSON.stringify(coverage_gaps, null, 2)}\n\`\`\``
          : '',
        '',
        `---`,
        `_Gerado pelo Agente QA em ${new Date().toISOString()}_`,
      ].filter(Boolean).join('\n');

      await commitFiles(
        [{ path: 'CORRECTION_REQUEST.md', content: correctionDoc }],
        `chore(QA-iter-${iteration}): cria pedido de correção DEV`,
        devBranch,
      );

      // 2. Deduplicação — reutiliza DEV correction já ativo para esta story
      const activeDevRuns = await db
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

      let correctionRunId: string;

      if (activeDevRuns.length > 0) {
        correctionRunId = activeDevRuns[0]!.id;
        jobLog.warn({ correctionRunId, iteration }, 'DEV correction já ativo — reutilizando agentRunId existente');
      } else {
        // 3. Registra agentRun pendente para o DEV correction
        const [corrRun] = await db
          .insert(schema.agentRuns)
          .values({
            storyId,
            agentType: 'dev',
            status: 'pending',
            input: { jiraKey, correctionMode: true, iteration },
          })
          .returning({ id: schema.agentRuns.id });

        correctionRunId = corrRun!.id;

        // 4. Enfileira job DEV no modo correção
        await devAgentQueue.add(
          'dev:correction',
          {
            storyId,
            jiraKey,
            agentRunId: correctionRunId,
            summary,
            fromStatus: 'Em QA',
            correctionMode: true,
            correctionIteration: iteration,
          },
          { jobId: `dev-correction-${jiraKey}-${correctionRunId}` },
        );
      }

      // 5. Comenta no Jira
      try {
        await addComment(
          jiraKey,
          `🔄 *Agente QA* — pedido de correção (iteração ${iteration}/3).\n\n` +
            `*Problema:* ${description}\n\n` +
            `O Agente DEV irá implementar as correções.`,
        );
      } catch (err) {
        jobLog.warn({ err: (err as Error).message }, 'falha ao comentar pedido de correção');
      }

      jobLog.info({ correctionRunId, iteration }, 'pedido de correção criado e DEV enfileirado');
      return JSON.stringify({ agentRunId: correctionRunId, requested: true, iteration });
    }

    if (block.name === 'wait_for_dev_correction') {
      const { agent_run_id } = block.input as { agent_run_id: string };
      const deadline = Date.now() + 1_200_000; // 20 min
      const pollInterval = parseInt(process.env['QA_POLL_INTERVAL_MS'] ?? '30000', 10);
      let pollResult: string | null = null;

      while (Date.now() < deadline) {
        await sleep(pollInterval);
        const rows = await db
          .select({
            status: schema.agentRuns.status,
            output: schema.agentRuns.output,
            errorMessage: schema.agentRuns.errorMessage,
          })
          .from(schema.agentRuns)
          .where(eq(schema.agentRuns.id, agent_run_id));

        const run = rows[0];
        if (run?.status === 'completed' || run?.status === 'failed') {
          pollResult = JSON.stringify({ status: run.status, output: run.output, error: run.errorMessage });
          break;
        }
      }

      jobLog.info({ agent_run_id }, `espera por DEV correction: ${pollResult ? 'resolvido' : 'timeout'}`);
      return pollResult ?? JSON.stringify({ timeout: true });
    }

    if (block.name === 'escalate_to_human') {
      const { reason, final_coverage } = block.input as {
        reason: string;
        final_coverage?: Record<string, unknown>;
      };
      jobLog.warn({ reason, final_coverage }, 'QA escalando para humano — cobertura insuficiente');
      try {
        await addComment(
          jiraKey,
          `⚠️ *Agente QA* — cobertura insuficiente após 3 iterações.\n\n` +
            `*Motivo:* ${reason}\n\n` +
            `*Cobertura final:* \`${JSON.stringify(final_coverage ?? {})}\`\n\n` +
            `Ação necessária: aumentar manualmente a cobertura de testes antes de mover o card.`,
        );
      } catch (err) {
        jobLog.warn({ err: (err as Error).message }, 'falha ao escalar via Jira — continuando');
      }
      return JSON.stringify({ escalated: true });
    }

    if (block.name === 'finish_qa_review') {
      const { passed, coverage, summary: qaSummary, tests_written, iterations } = block.input as {
        passed: boolean;
        coverage?: Record<string, unknown>;
        summary: string;
        tests_written?: string[];
        iterations: number;
      };
      qaResult = {
        passed,
        iterations,
        finalCoverage: coverage ?? null,
        testsWritten: tests_written ?? [],
        summary: qaSummary,
      };
      jobLog.info({ passed, iterations, testsWritten: tests_written?.length ?? 0 }, 'QA review finalizado');
      return JSON.stringify({ finalized: true });
    }

    return `Ferramenta desconhecida: ${block.name}`;
  };

  return runAgentLoop<QaAgentResult>({
    anthropic,
    redis: redisConnection,
    model,
    system: QA_SYSTEM_PROMPT,
    tools: QA_TOOLS,
    messages,
    maxTurns: 100,
    maxTokens: 16_384,
    log: jobLog,
    label: 'QA',
    maxToolResultChars: 4_000,
    dispatchTool,
    onEndTurn: () => {
      if (!qaResult) {
        throw new Error('Agente QA encerrou sem chamar finish_qa_review');
      }
      return qaResult;
    },
  });
}

// ─── Processador do job QA ────────────────────────────────────────────────────

async function processQaJob(job: Job<QaAgentJobData>): Promise<unknown> {
  const { storyId, jiraKey, agentRunId, summary } = job.data;
  const startedAt = new Date();
  const jobLog = log.child({ jiraKey, agentRunId, storyId });

  jobLog.info('iniciando execução do agente QA');

  await db
    .update(schema.agentRuns)
    .set({ status: 'running', startedAt })
    .where(eq(schema.agentRuns.id, agentRunId));

  try {
    const qaResult = await runQaAgent(jiraKey, summary, agentRunId, storyId);

    // Salva relatório de testes
    await db.insert(schema.artifacts).values({
      storyId,
      agentRunId,
      artifactType: 'test_report',
      filePath: `agent/task-${jiraKey.toLowerCase()}/.qa-report.md`,
      content: qaResult.summary,
    });

    // Salva cobertura se disponível
    if (qaResult.finalCoverage) {
      await db.insert(schema.artifacts).values({
        storyId,
        agentRunId,
        artifactType: 'coverage_report',
        filePath: `agent/task-${jiraKey.toLowerCase()}/.qa-coverage.json`,
        content: JSON.stringify(qaResult.finalCoverage),
      });
    }

    jobLog.info({ testsWritten: qaResult.testsWritten.length, passed: qaResult.passed }, 'artefatos QA salvos');

    // Move card para "Aguardando Aceite QA"
    try {
      await moveCardTo(jiraKey, 'Aguardando Aceite QA');
      jobLog.info({ to: 'Aguardando Aceite QA' }, 'card movido no Jira');
    } catch (err) {
      jobLog.error({ err: (err as Error).message }, 'falha ao mover card — abortando');
      throw err;
    }

    await updateStoryStatus(jiraKey, 'Aguardando Aceite QA', {
      lastAgentType: 'qa',
      lastAgentRunId: agentRunId,
    });

    // Comenta no Jira
    const statusIcon = qaResult.passed ? '✅' : '⚠️';
    const coverageStatus = qaResult.passed ? 'aprovada (≥ 80% por arquivo do PR)' : 'insuficiente (escalado para humano)';

    const comment =
      `🤖 *Agente QA* concluiu a revisão.\n\n` +
      `${statusIcon} Cobertura: ${coverageStatus}\n` +
      `🔄 Iterações realizadas: ${qaResult.iterations}\n` +
      `📝 Testes escritos/ajustados: ${qaResult.testsWritten.length}\n\n` +
      `Aguardando revisão e aprovação do QA humano (Gate 4/5).`;

    try {
      await addComment(jiraKey, comment);
      jobLog.debug('comentário adicionado no Jira');
    } catch (err) {
      jobLog.warn({ err: (err as Error).message }, 'falha ao comentar — fluxo não interrompido');
    }

    // Marca run como 'completed'
    const completedAt = new Date();
    const durationMs = completedAt.getTime() - startedAt.getTime();
    const output = {
      passed: qaResult.passed,
      iterations: qaResult.iterations,
      testsWritten: qaResult.testsWritten,
    };

    await db
      .update(schema.agentRuns)
      .set({ status: 'completed', output, durationMs, completedAt })
      .where(eq(schema.agentRuns.id, agentRunId));

    jobLog.info({ durationMs, passed: qaResult.passed }, 'agente QA concluído');
    return output;

  } catch (err) {
    const errorMessage = (err as Error).message;
    const completedAt = new Date();
    const durationMs = completedAt.getTime() - startedAt.getTime();

    await db
      .update(schema.agentRuns)
      .set({ status: 'failed', errorMessage, durationMs, completedAt })
      .where(eq(schema.agentRuns.id, agentRunId));

    jobLog.error({ err: errorMessage, durationMs, attempt: job.attemptsMade + 1 }, 'agente QA falhou');
    throw err;
  }
}

// ─── Criação do Worker ────────────────────────────────────────────────────────

export function createQaAgentWorker() {
  const worker = new Worker<QaAgentJobData>('agent-qa', processQaJob, {
    connection: redisConnection,
    concurrency: 2,
    lockDuration: 5_400_000, // 90 min — comporta 3 ciclos: correção DEV (20 min) + CI wait (10 min) cada
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

  log.info('worker QA iniciado — aguardando jobs');
  return worker;
}
