import { sql, eq, and, inArray, isNotNull } from 'drizzle-orm';
import { db, schema } from '../db/index';

// ─── Tempo médio por fase (agente) ───────────────────────────────────────────

export async function getAvgDurationByAgent(projectKey?: string) {
  return db
    .select({
      agentType:     schema.agentRuns.agentType,
      avgDurationMs: sql<number>`round(avg(${schema.agentRuns.durationMs}))`,
      p50DurationMs: sql<number>`round(percentile_cont(0.5) within group (order by ${schema.agentRuns.durationMs}))`,
      p95DurationMs: sql<number>`round(percentile_cont(0.95) within group (order by ${schema.agentRuns.durationMs}))`,
      totalRuns:     sql<number>`count(*)`,
    })
    .from(schema.agentRuns)
    .innerJoin(schema.stories, eq(schema.agentRuns.storyId, schema.stories.id))
    .where(
      and(
        eq(schema.agentRuns.status, 'completed'),
        isNotNull(schema.agentRuns.durationMs),
        projectKey ? eq(schema.stories.projectKey, projectKey) : undefined,
      ),
    )
    .groupBy(schema.agentRuns.agentType);
}

// ─── Taxa de sucesso por agente ───────────────────────────────────────────────

export async function getSuccessRateByAgent(projectKey?: string) {
  return db
    .select({
      agentType: schema.agentRuns.agentType,
      total:     sql<number>`count(*)`,
      completed: sql<number>`count(*) filter (where ${schema.agentRuns.status} = 'completed')`,
      failed:    sql<number>`count(*) filter (where ${schema.agentRuns.status} = 'failed')`,
    })
    .from(schema.agentRuns)
    .innerJoin(schema.stories, eq(schema.agentRuns.storyId, schema.stories.id))
    .where(
      and(
        inArray(schema.agentRuns.status, ['completed', 'failed']),
        projectKey ? eq(schema.stories.projectKey, projectKey) : undefined,
      ),
    )
    .groupBy(schema.agentRuns.agentType);
}

// ─── Loops de correção por história ──────────────────────────────────────────

export async function getCorrectionLoopsByStory(projectKey?: string) {
  return db
    .select({
      jiraKey:     schema.stories.jiraKey,
      corrections: sql<number>`count(${schema.agentRuns.id})`,
    })
    .from(schema.agentRuns)
    .innerJoin(schema.stories, eq(schema.agentRuns.storyId, schema.stories.id))
    .where(
      and(
        eq(schema.agentRuns.agentType, 'dev'),
        sql`(${schema.agentRuns.input}->>'correctionMode')::boolean = true`,
        projectKey ? eq(schema.stories.projectKey, projectKey) : undefined,
      ),
    )
    .groupBy(schema.stories.jiraKey)
    .orderBy(sql`count(${schema.agentRuns.id}) desc`);
}

// ─── Custo total por projeto ──────────────────────────────────────────────────

export async function getCostByProject() {
  return db
    .select({
      projectKey: schema.stories.projectKey,
      totalCostUsd: sql<number>`coalesce(sum(${schema.agentRuns.costUsd}), 0)`,
      totalRuns:    sql<number>`count(${schema.agentRuns.id})`,
      totalStories: sql<number>`count(distinct ${schema.stories.id})`,
    })
    .from(schema.agentRuns)
    .innerJoin(schema.stories, eq(schema.agentRuns.storyId, schema.stories.id))
    .groupBy(schema.stories.projectKey)
    .orderBy(sql`sum(${schema.agentRuns.costUsd}) desc nulls last`);
}
