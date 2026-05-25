import { inArray } from 'drizzle-orm';
import { db, schema } from '../db/index';
import { orchestratorQueue } from '../queue/index';
import { fetchActiveIssues } from '../jira/client';
import { isKnownStatus, getStateOrder, JIRA_TO_DB_STATUS } from './state-machine';

// ─── Intervalo de polling ─────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 90_000; // 90 segundos

// ─── Status que representam issues "em voo" (não terminais, não Backlog) ──────

const IN_FLIGHT_DB_STATUSES: (typeof schema.storyStatusEnum.enumValues)[number][] = [
  'a_refinar',
  'em_refinamento',
  'aguardando_aceite_prd',
  'prd_aceito',
  'aguardando_aceite_plano',
  'plano_validado',
  'em_desenvolvimento',
  'aguardando_aceite_dev',
  'em_qa',
  'aguardando_aceite_qa',
  'validacao_final',
];

// ─── Lógica de reconciliação ──────────────────────────────────────────────────

async function reconcile(): Promise<void> {
  const projectKey = process.env.JIRA_PROJECT_KEY;
  if (!projectKey) {
    console.warn('[reconciler] JIRA_PROJECT_KEY não configurado — pulando ciclo');
    return;
  }

  console.log('[reconciler] iniciando ciclo de reconciliação...');

  // 1. Busca issues em andamento no banco
  const dbStories = await db
    .select({
      id: schema.stories.id,
      jiraKey: schema.stories.jiraKey,
      jiraStatus: schema.stories.jiraStatus,
      status: schema.stories.status,
    })
    .from(schema.stories)
    .where(inArray(schema.stories.status, IN_FLIGHT_DB_STATUSES));

  if (dbStories.length === 0) {
    console.log('[reconciler] nenhuma story em andamento — ciclo encerrado');
    return;
  }

  console.log(`[reconciler] ${dbStories.length} story(ies) em andamento no banco`);

  // 2. Busca estado real no Jira
  let jiraIssues;
  try {
    jiraIssues = await fetchActiveIssues(projectKey);
  } catch (err) {
    console.error('[reconciler] erro ao buscar issues do Jira:', (err as Error).message);
    return;
  }

  // Indexa por key para lookup O(1)
  const jiraByKey = new Map(jiraIssues.map((i) => [i.key, i]));

  // 3. Compara e detecta divergências
  let divergences = 0;

  for (const story of dbStories) {
    const jiraIssue = jiraByKey.get(story.jiraKey);

    if (!jiraIssue) {
      // Issue não encontrada no Jira (pode ter sido concluída ou removida do filtro)
      console.log(
        `[reconciler] ${story.jiraKey} não retornada pelo Jira — provavelmente concluída ou backlog`,
      );
      continue;
    }

    const jiraCurrentStatus = jiraIssue.fields.status.name;

    // Sem divergência
    if (jiraCurrentStatus === story.jiraStatus) {
      continue;
    }

    // Verifica se o Jira está à frente do banco (webhook perdido)
    const dbOrder = getStateOrder(story.jiraStatus);
    const jiraOrder = getStateOrder(jiraCurrentStatus);

    if (!isKnownStatus(jiraCurrentStatus)) {
      console.warn(
        `[reconciler] ${story.jiraKey} — status Jira desconhecido: "${jiraCurrentStatus}"`,
      );
      continue;
    }

    if (jiraOrder > dbOrder) {
      divergences++;
      console.warn(
        `[reconciler] DIVERGÊNCIA detectada em ${story.jiraKey}: banco="${story.jiraStatus}" ← Jira="${jiraCurrentStatus}" — enfileirando reconciliação`,
      );

      // Reencaminha como se fosse um webhook que nunca chegou
      await orchestratorQueue.add(
        'jira:transition',
        {
          jiraKey: story.jiraKey,
          issueId: jiraIssue.id,
          summary: jiraIssue.fields.summary,
          fromStatus: story.jiraStatus,
          toStatus: jiraCurrentStatus,
          currentStatus: jiraCurrentStatus,
          receivedAt: new Date().toISOString(),
        },
        {
          // jobId único evita duplicatas se o reconciler rodar antes do worker processar
          jobId: `reconcile-${story.jiraKey}-${JIRA_TO_DB_STATUS[jiraCurrentStatus]}`,
          // Remove após 24h para não acumular jobs de reconciliação antigos
          removeOnComplete: { age: 86_400 },
        },
      );
    } else if (jiraOrder < dbOrder) {
      // Banco está à frente do Jira — situação incomum, apenas loga
      console.warn(
        `[reconciler] ${story.jiraKey} — banco (${story.jiraStatus}) está à frente do Jira (${jiraCurrentStatus}): aguardando Jira atualizar`,
      );
    }
  }

  console.log(
    `[reconciler] ciclo concluído — ${divergences} divergência(s) corrigida(s)`,
  );
}

// ─── Criação do Reconciler ────────────────────────────────────────────────────

export function createReconciler(): NodeJS.Timeout {
  // Primeiro ciclo após 30s (dar tempo ao servidor inicializar)
  const initial = setTimeout(() => {
    void reconcile();
  }, 30_000);
  // Mantém o timeout não bloqueante
  initial.unref();

  const interval = setInterval(() => {
    void reconcile();
  }, POLL_INTERVAL_MS);
  interval.unref();

  console.log(
    `[reconciler] agendado — primeiro ciclo em 30s, depois a cada ${POLL_INTERVAL_MS / 1_000}s`,
  );

  return interval;
}
