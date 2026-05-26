import { inArray } from 'drizzle-orm';
import { db, schema } from '../db/index';
import { orchestratorQueue } from '../queue/index';
import { fetchActiveIssues } from '../jira/client';
import { childLogger } from '../lib/logger';
import { isKnownStatus, getStateOrder, JIRA_TO_DB_STATUS } from './state-machine';

const log = childLogger({ module: 'reconciler' });

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
    log.warn('JIRA_PROJECT_KEY não configurado — ciclo ignorado');
    return;
  }

  const t0 = Date.now();
  log.debug('iniciando ciclo de reconciliação');

  // 1. Busca issues em andamento no banco
  let dbStories: { id: string; jiraKey: string; jiraStatus: string | null; status: string }[];
  try {
    dbStories = await db
      .select({
        id: schema.stories.id,
        jiraKey: schema.stories.jiraKey,
        jiraStatus: schema.stories.jiraStatus,
        status: schema.stories.status,
      })
      .from(schema.stories)
      .where(inArray(schema.stories.status, IN_FLIGHT_DB_STATUSES));
  } catch (err) {
    log.error({ err: (err as Error).message }, 'falha ao buscar stories no banco');
    return;
  }

  if (dbStories.length === 0) {
    log.debug('nenhuma story em andamento — ciclo encerrado');
    return;
  }

  log.debug({ count: dbStories.length }, 'stories em andamento encontradas');

  // 2. Busca estado real no Jira
  let jiraIssues;
  try {
    jiraIssues = await fetchActiveIssues(projectKey);
  } catch (err) {
    log.error({ err: (err as Error).message }, 'falha ao buscar issues do Jira');
    return;
  }

  const jiraByKey = new Map(jiraIssues.map((i) => [i.key, i]));

  // 3. Compara e detecta divergências
  let divergences = 0;

  for (const story of dbStories) {
    const jiraIssue = jiraByKey.get(story.jiraKey);

    if (!jiraIssue) {
      log.debug({ jiraKey: story.jiraKey }, 'issue não retornada pelo Jira — concluída ou backlog');
      continue;
    }

    const jiraCurrentStatus = jiraIssue.fields.status.name;

    if (jiraCurrentStatus === story.jiraStatus) continue;

    const dbOrder = getStateOrder(story.jiraStatus);
    const jiraOrder = getStateOrder(jiraCurrentStatus);

    if (!isKnownStatus(jiraCurrentStatus)) {
      log.warn({ jiraKey: story.jiraKey, status: jiraCurrentStatus }, 'status Jira desconhecido');
      continue;
    }

    if (jiraOrder > dbOrder) {
      divergences++;
      log.warn(
        { jiraKey: story.jiraKey, dbStatus: story.jiraStatus, jiraStatus: jiraCurrentStatus },
        'divergência detectada — webhook perdido, reenfileirando',
      );

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
          jobId: `reconcile-${story.jiraKey}-${JIRA_TO_DB_STATUS[jiraCurrentStatus]}`,
          removeOnComplete: { age: 86_400 },
        },
      );
    } else if (jiraOrder < dbOrder) {
      log.warn(
        { jiraKey: story.jiraKey, dbStatus: story.jiraStatus, jiraStatus: jiraCurrentStatus },
        'banco à frente do Jira — aguardando Jira atualizar',
      );
    }
  }

  log.info({ divergences, durationMs: Date.now() - t0, storiesChecked: dbStories.length }, 'ciclo concluído');
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

  log.info({ firstCycleDelayMs: 30_000, intervalMs: POLL_INTERVAL_MS }, 'reconciler agendado');

  return interval;
}
