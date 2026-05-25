import Anthropic from '@anthropic-ai/sdk';
import { Queue, Worker, type Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index';
import { updateStoryStatus } from '../db/stories';
import { redisConnection } from '../queue/index';
import { moveCardTo, addComment } from '../jira/client';
import { commitFile, readFile } from '../github/client';
import { childLogger } from '../lib/logger';

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

// ─── System prompt ────────────────────────────────────────────────────────────

const LT_SYSTEM_PROMPT = `Você é um Tech Lead sênior com mais de 12 anos de experiência em desenvolvimento de software B2B SaaS.
Sua missão é transformar um PRD em um plano de execução técnico detalhado com tasks numeradas, estimativas e mapa de dependências.

## Processo obrigatório
1. Leia o PRD da história com read_github_file (informe o branch e o caminho corretos)
2. Leia o README.md para identificar a stack tecnológica existente
3. Leia o package.json para identificar dependências e frameworks instalados
4. Se existir src/db/schema.ts, leia-o para entender o modelo de dados atual
5. Se existir src/index.ts, leia-o para entender a estrutura do servidor
6. Analise as informações e decomponha o PRD em tasks técnicas TASK-XX
7. Gere o PLANO_DE_EXECUCAO.md seguindo EXATAMENTE a estrutura abaixo

## REGRAS DE FORMATO — OBRIGATÓRIAS
- Responda SOMENTE com o conteúdo markdown do plano, começando diretamente com "# Plano de Execução —"
- NÃO escreva nenhum texto antes do heading — sem introduções, sem comentários sobre arquivos encontrados ou não
- NÃO envolva o conteúdo em blocos de código (não use \`\`\`markdown)
- NÃO escreva nada após o "## Referências" final
- Se um arquivo não for encontrado, use o que tiver disponível e não mencione isso

## Critérios de qualidade das tasks
- Cada task deve ser implementável por um único desenvolvedor em no máximo 1 dia
- Tasks de utilitários puros (ex: módulo de hash de senha, módulo JWT) NÃO dependem do schema do banco — declare como independentes quando for o caso
- Dependências explícitas entre tasks (TASK-XX depende de TASK-YY) somente quando houver dependência técnica real
- Estimativas realistas: P (< 2h), M (2–4h), G (4–8h)
- Critérios de aceite técnicos e verificáveis (ex: "endpoint retorna 201 com schema X")
- Identificar quais tasks podem ser executadas em paralelo
- Se o PRD mencionar rate limiting, segurança ou logging como requisito, incluir task dedicada

## Estrutura obrigatória do PLANO_DE_EXECUCAO.md (siga exatamente)

\`\`\`markdown
# Plano de Execução — {jiraKey}: {título}

## Identificação
- **Jira Key**: {key}
- **Resumo**: {resumo}
- **Versão**: 1.0
- **Autor**: Agente LT (IA)
- **Data**: {data ISO}

## Stack Detectada
- **Runtime**: {ex: Node.js 22 / TypeScript}
- **Framework**: {ex: Express 5}
- **Banco de Dados**: {ex: PostgreSQL via Drizzle ORM}
- **Fila**: {ex: BullMQ / Redis}
- **Testes**: {ex: Vitest}

## Visão Geral

| ID | Descrição resumida | Estimativa | Dependências | Paralelo |
|----|-------------------|------------|-------------|---------|
| TASK-01 | {resumo} | P/M/G | — | Sim/Não |
| TASK-02 | {resumo} | P/M/G | TASK-01 | Sim/Não |

## Tasks Detalhadas

### TASK-01 — {Título da Task}
**Descrição**: {o que deve ser implementado, com contexto técnico suficiente}
**Arquivos Afetados**:
- \`src/...\`
**Critério de Aceite Técnico**: {verificável, ex: "função X retorna Y dado Z"}
**Estimativa**: P — < 2h
**Dependências**: Nenhuma
**Paralelizável**: Sim

### TASK-02 — {Título da Task}
...

## Ordem de Execução

\`\`\`
TASK-01 ──► TASK-02 ──► TASK-04
            TASK-03 ──┘
\`\`\`

(Tasks na mesma coluna podem rodar em paralelo)

## Estimativa Total
- Tasks P (< 2h): {N} tasks
- Tasks M (2–4h): {N} tasks
- Tasks G (4–8h): {N} tasks
- **Estimativa total**: {X}–{Y} horas

## Referências
- PRD: {jiraKey}/PRD.md
- Jira: {jiraKey}
\`\`\`

## Regras de qualidade
- Mínimo 3 tasks, máximo 15
- Toda task com critério de aceite técnico mensurável
- Toda task com estimativa e lista de arquivos afetados
- Diagrama de dependências obrigatório
- Retorne APENAS o conteúdo markdown do plano, sem texto adicional antes ou depois`;

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

  for (let turn = 0; turn < 10; turn++) {
    const response = await anthropic.messages.create({
      model,
      max_tokens: 8192,
      system: LT_SYSTEM_PROMPT,
      tools: LT_TOOLS,
      messages,
    });

    jobLog.debug(
      { turn, stop_reason: response.stop_reason, usage: response.usage },
      'resposta do Claude recebida',
    );

    messages.push({ role: 'assistant', content: response.content });

    if (response.stop_reason === 'end_turn') {
      const raw = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');

      const planContent = extractMarkdownContent(raw);
      if (!planContent) throw new Error('Claude retornou plano vazio');
      return planContent;
    }

    if (response.stop_reason === 'tool_use') {
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;

        let result: string;
        try {
          if (block.name === 'read_github_file') {
            const { file_path, branch } = block.input as { file_path: string; branch?: string };
            const content = await readFile(file_path, branch);
            result = content ?? '(arquivo não encontrado no repositório)';
            jobLog.debug({ file_path, branch, found: content !== null }, 'ferramenta read_github_file executada');
          } else {
            result = `Ferramenta desconhecida: ${block.name}`;
          }
        } catch (err) {
          result = `Erro ao executar ferramenta: ${(err as Error).message}`;
          jobLog.warn({ tool: block.name, err: (err as Error).message }, 'ferramenta retornou erro');
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: result,
        });
      }

      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    throw new Error(`stop_reason inesperado: ${response.stop_reason}`);
  }

  throw new Error('Agente LT excedeu o limite de 10 turnos sem gerar o plano');
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
