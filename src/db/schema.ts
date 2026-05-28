import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  integer,
  jsonb,
  real,
  index,
} from 'drizzle-orm/pg-core';

// ─── Enums ───────────────────────────────────────────────────────────────────

export const storyStatusEnum = pgEnum('story_status', [
  'backlog',
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
  'concluido',
]);

export const agentTypeEnum = pgEnum('agent_type', [
  'orchestrator',
  'po',
  'lt',
  'dev',
  'qa',
]);

export const agentRunStatusEnum = pgEnum('agent_run_status', [
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled',
]);

export const artifactTypeEnum = pgEnum('artifact_type', [
  'prd',
  'execution_plan',
  'code',
  'test_report',
  'coverage_report',
]);

// ─── Tabelas ─────────────────────────────────────────────────────────────────

export const stories = pgTable(
  'stories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jiraKey: text('jira_key').notNull().unique(),
    projectKey: text('project_key').notNull().default('SCRUM'),
    jiraSummary: text('jira_summary').notNull(),
    jiraDescription: text('jira_description'),
    status: storyStatusEnum('status').notNull().default('backlog'),
    jiraStatus: text('jira_status').notNull(),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('stories_jira_key_idx').on(t.jiraKey),
    index('stories_status_idx').on(t.status),
    index('stories_project_key_idx').on(t.projectKey),
  ],
);

export const agentRuns = pgTable(
  'agent_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storyId: uuid('story_id')
      .notNull()
      .references(() => stories.id, { onDelete: 'cascade' }),
    agentType: agentTypeEnum('agent_type').notNull(),
    status: agentRunStatusEnum('status').notNull().default('pending'),
    iteration: integer('iteration').notNull().default(1),
    input: jsonb('input'),
    output: jsonb('output'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    costUsd: real('cost_usd'),
    durationMs: integer('duration_ms'),
    errorMessage: text('error_message'),
    startedAt: timestamp('started_at'),
    completedAt: timestamp('completed_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('agent_runs_story_id_idx').on(t.storyId),
    index('agent_runs_agent_type_idx').on(t.agentType),
    index('agent_runs_status_idx').on(t.status),
  ],
);

export const artifacts = pgTable(
  'artifacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storyId: uuid('story_id')
      .notNull()
      .references(() => stories.id, { onDelete: 'cascade' }),
    agentRunId: uuid('agent_run_id').references(() => agentRuns.id, {
      onDelete: 'set null',
    }),
    artifactType: artifactTypeEnum('artifact_type').notNull(),
    filePath: text('file_path').notNull(),
    githubCommitSha: text('github_commit_sha'),
    content: text('content'),
    storageUrl: text('storage_url'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('artifacts_story_id_idx').on(t.storyId),
    index('artifacts_agent_run_id_idx').on(t.agentRunId),
  ],
);

// ─── Tipos inferidos ──────────────────────────────────────────────────────────

export type Story = typeof stories.$inferSelect;
export type NewStory = typeof stories.$inferInsert;
export type StoryStatus = (typeof storyStatusEnum.enumValues)[number];

export type AgentRun = typeof agentRuns.$inferSelect;
export type NewAgentRun = typeof agentRuns.$inferInsert;
export type AgentType = (typeof agentTypeEnum.enumValues)[number];
export type AgentRunStatus = (typeof agentRunStatusEnum.enumValues)[number];

export type Artifact = typeof artifacts.$inferSelect;
export type NewArtifact = typeof artifacts.$inferInsert;
export type ArtifactType = (typeof artifactTypeEnum.enumValues)[number];
