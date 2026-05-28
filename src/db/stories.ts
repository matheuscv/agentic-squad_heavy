import { eq, sql } from 'drizzle-orm';
import { db, schema } from './index';
import { isKnownStatus, JIRA_TO_DB_STATUS } from '../orchestrator/state-machine';
import type { OrchestratorJobData } from '../queue/index';

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type StoryMetadata = {
  lastAgentType?: string;
  lastAgentRunId?: string;
  lastGatePassed?: number;
  webhookReceivedAt?: string;
};

// ─── Helpers internos ─────────────────────────────────────────────────────────

function resolveDbStatus(jiraStatusName: string) {
  return isKnownStatus(jiraStatusName) ? JIRA_TO_DB_STATUS[jiraStatusName] : 'backlog' as const;
}

// ─── Funções públicas ─────────────────────────────────────────────────────────

/**
 * Cria ou atualiza uma história a partir dos dados do webhook.
 * Chamada pelo Orchestrator Worker a cada evento Jira recebido.
 */
export async function upsertStory(data: OrchestratorJobData) {
  const { jiraKey, projectKey, summary, toStatus, currentStatus } = data;
  const effectiveStatus = toStatus ?? currentStatus;
  const dbStatus = resolveDbStatus(effectiveStatus);

  const metadata: StoryMetadata = {
    webhookReceivedAt: data.receivedAt,
  };

  const [story] = await db
    .insert(schema.stories)
    .values({
      jiraKey,
      projectKey,
      jiraSummary: summary,
      status: dbStatus,
      jiraStatus: effectiveStatus,
      metadata,
    })
    .onConflictDoUpdate({
      target: schema.stories.jiraKey,
      set: {
        jiraSummary: summary,
        status: dbStatus,
        jiraStatus: effectiveStatus,
        metadata: sql`stories.metadata || ${JSON.stringify(metadata)}::jsonb`,
        updatedAt: sql`now()`,
      },
    })
    .returning();

  return story!;
}

/**
 * Atualiza o status de uma história no banco imediatamente após uma ação de agente.
 * Evita a janela de divergência entre a ação do agente e o próximo webhook.
 */
export async function updateStoryStatus(
  jiraKey: string,
  jiraStatusName: string,
  meta?: Partial<StoryMetadata>,
) {
  const dbStatus = resolveDbStatus(jiraStatusName);

  const sets: Record<string, unknown> = {
    status: dbStatus,
    jiraStatus: jiraStatusName,
    updatedAt: sql`now()`,
  };

  if (meta) {
    sets['metadata'] = sql`stories.metadata || ${JSON.stringify(meta)}::jsonb`;
  }

  const [story] = await db
    .update(schema.stories)
    .set(sets)
    .where(eq(schema.stories.jiraKey, jiraKey))
    .returning({ id: schema.stories.id, status: schema.stories.status });

  return story;
}

/**
 * Persiste a descrição da issue Jira na história (enriquecimento).
 * Chamada pelos agentes que precisam do conteúdo completo da história.
 */
export async function updateStoryDescription(jiraKey: string, description: string) {
  await db
    .update(schema.stories)
    .set({ jiraDescription: description, updatedAt: sql`now()` })
    .where(eq(schema.stories.jiraKey, jiraKey));
}

/**
 * Mescla dados no campo metadata (jsonb) sem sobrescrever campos existentes.
 */
export async function mergeStoryMetadata(jiraKey: string, meta: Partial<StoryMetadata>) {
  await db
    .update(schema.stories)
    .set({
      metadata: sql`stories.metadata || ${JSON.stringify(meta)}::jsonb`,
      updatedAt: sql`now()`,
    })
    .where(eq(schema.stories.jiraKey, jiraKey));
}
