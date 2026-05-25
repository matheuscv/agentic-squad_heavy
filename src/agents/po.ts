import Anthropic from '@anthropic-ai/sdk';
import { Queue, Worker, type Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index';
import { updateStoryStatus, updateStoryDescription } from '../db/stories';
import { redisConnection } from '../queue/index';
import { getIssue, moveCardTo, addComment } from '../jira/client';
import { commitFile, createBranch, readFile } from '../github/client';
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

// ─── Helpers de conteúdo ──────────────────────────────────────────────────────

function extractTextFromAdf(adf: unknown): string {
  if (!adf || typeof adf !== 'object') return '';
  const node = adf as Record<string, unknown>;
  if (node['type'] === 'text' && typeof node['text'] === 'string') return node['text'];
  const children = (node['content'] as unknown[]) ?? [];
  return children.map(extractTextFromAdf).join('');
}

// ─── System prompt ────────────────────────────────────────────────────────────

const PO_SYSTEM_PROMPT = `Você é um Product Owner sênior com mais de 10 anos de experiência em produtos B2B SaaS.
Sua missão é transformar histórias do Jira em PRDs completos, claros e com requisitos mensuráveis.

## Processo obrigatório
1. Chame get_jira_issue para ler a história completa (descrição, critérios, contexto)
2. Chame read_github_file com "README.md" para entender o produto
3. Se existir docs/GLOSSARIO.md, leia também para alinhar terminologia
4. Analise as informações coletadas e gere o PRD

## Estrutura obrigatória do PRD (siga exatamente)

\`\`\`markdown
# PRD — {título da história}

## Identificação
- **Jira Key**: {key}
- **Resumo**: {resumo}
- **Versão**: 1.0
- **Autor**: Agente PO (IA)
- **Data**: {data ISO}

## Contexto
{contexto do produto e do problema de negócio — 2 a 4 parágrafos}

## Problema
{declaração objetiva do problema que esta história resolve}

## Objetivos
- OBJ-01: {objetivo mensurável}
- OBJ-02: {objetivo mensurável}

## Escopo
{o que está incluído nesta entrega}

## Fora de Escopo
- {item explicitamente excluído}

## Requisitos Funcionais
| ID | Requisito | Prioridade |
|----|-----------|------------|
| RF-01 | {descrição do requisito} | Must Have |
| RF-02 | {descrição do requisito} | Should Have |

## Critérios de Aceite
- **CA-01**: Dado {contexto}, quando {ação do usuário}, então {resultado esperado e mensurável}
- **CA-02**: Dado {contexto}, quando {ação do usuário}, então {resultado esperado e mensurável}

## Riscos
| ID | Risco | Probabilidade | Impacto | Mitigação |
|----|-------|--------------|---------|-----------|
| R-01 | {descrição} | Alta/Média/Baixa | Alto/Médio/Baixo | {ação de mitigação} |

## Referências
- Jira: {jiraKey}
\`\`\`

## Regras de qualidade
- Requisitos funcionais: mínimo 3, máximo 10, sempre numerados RF-XX
- Critérios de aceite: mínimo 3, formato obrigatório Dado/Quando/Então
- Pelo menos 1 risco identificado com mitigação
- Linguagem técnica mas acessível ao time de desenvolvimento
- Retorne APENAS o conteúdo markdown do PRD, sem texto adicional antes ou depois`;

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
): Promise<string> {
  const jobLog = log.child({ jiraKey, agentRunId });
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const model = process.env.ANTHROPIC_MODEL ?? 'claude-opus-4-7';

  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: `Gere o PRD completo para a história ${jiraKey}: "${summary}".
Use as ferramentas disponíveis para coletar o contexto necessário antes de escrever.`,
    },
  ];

  jobLog.debug({ model, jiraKey }, 'iniciando loop de tool-use com Claude');

  for (let turn = 0; turn < 10; turn++) {
    const response = await anthropic.messages.create({
      model,
      max_tokens: 8192,
      system: PO_SYSTEM_PROMPT,
      tools: PO_TOOLS,
      messages,
    });

    jobLog.debug(
      { turn, stop_reason: response.stop_reason, usage: response.usage },
      'resposta do Claude recebida',
    );

    messages.push({ role: 'assistant', content: response.content });

    // Resposta final — extrai o texto do PRD
    if (response.stop_reason === 'end_turn') {
      const prdContent = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');

      if (!prdContent.trim()) throw new Error('Claude retornou PRD vazio');
      return prdContent;
    }

    // Executa as ferramentas solicitadas
    if (response.stop_reason === 'tool_use') {
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;

        let result: string;
        try {
          if (block.name === 'get_jira_issue') {
            const { issue_key } = block.input as { issue_key: string };
            const issue = await getIssue(issue_key);
            const description = extractTextFromAdf(issue.fields.description);
            result = JSON.stringify({
              key: issue.key,
              summary: issue.fields.summary,
              description: description || '(sem descrição)',
              status: issue.fields.status.name,
            });
            jobLog.debug({ issue_key }, 'ferramenta get_jira_issue executada');

          } else if (block.name === 'read_github_file') {
            const { file_path } = block.input as { file_path: string };
            const content = await readFile(file_path);
            result = content ?? '(arquivo não encontrado no repositório)';
            jobLog.debug({ file_path, found: content !== null }, 'ferramenta read_github_file executada');

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

  throw new Error('Agente PO excedeu o limite de 10 turnos sem gerar o PRD');
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
  const prdContent = await runPoAgent(jiraKey, summary, agentRunId);
  jobLog.info({ prdLength: prdContent.length }, 'PRD.md gerado pelo Claude');

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
    .set({ status: 'completed', output, durationMs, completedAt })
    .where(eq(schema.agentRuns.id, agentRunId));

  jobLog.info({ durationMs, branch }, 'agente PO concluído');
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
