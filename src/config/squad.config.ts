import { z } from 'zod';

// ─── Schema ───────────────────────────────────────────────────────────────────

const SquadConfigSchema = z.object({
  jira: z.object({
    baseUrl: z.string(),
    projectKey: z.string(),
    statusMap: z.record(z.string(), z.string()),
  }),
  github: z.object({
    owner: z.string(),
    repo: z.string(),
    defaultBranch: z.string(),
  }),
  ci: z.object({
    testCommand: z.string(),
    coverageCommand: z.string(),
    coverageThreshold: z.number().int().min(0).max(100),
  }),
  agents: z.object({
    devConcurrency: z.number().int().positive(),
    timeouts: z.object({
      ciMs: z.number().int().positive(),
      agentMs: z.number().int().positive(),
    }),
    models: z.object({
      default: z.string(),
      fast: z.string(),
    }),
  }),
  notifications: z.object({
    onGateReached: z.string().url().optional(),
    onError: z.string().url().optional(),
  }),
});

export type SquadConfig = z.infer<typeof SquadConfigSchema>;

// ─── Mapa de status do board ──────────────────────────────────────────────────
//
// Mapeia nomes de coluna do Jira para o status canônico no banco.
// Projetos com nomes de coluna diferentes podem sobrescrever via env JIRA_STATUS_MAP (JSON).

const DEFAULT_STATUS_MAP: Record<string, string> = {
  'Backlog':                 'backlog',
  'A Refinar':               'a_refinar',
  'Em Refinamento':          'em_refinamento',
  'Aguardando Aceite PRD':   'aguardando_aceite_prd',
  'PRD Aceito':              'prd_aceito',
  'Aguardando Aceite Plano': 'aguardando_aceite_plano',
  'Plano Validado':          'plano_validado',
  'Em Desenvolvimento':      'em_desenvolvimento',
  'Aguardando Aceite Dev':   'aguardando_aceite_dev',
  'Em QA':                   'em_qa',
  'Aguardando Aceite QA':    'aguardando_aceite_qa',
  'Validação Final':         'validacao_final',
  'Concluído':               'concluido',
};

// ─── Helpers de leitura de env ────────────────────────────────────────────────

function env(key: string): string {
  return process.env[key] ?? '';
}

function envOr(key: string, fallback: string): string {
  const val = process.env[key];
  return val && val.length > 0 ? val : fallback;
}

function envNumber(key: string, fallback: number): number {
  const val = process.env[key];
  if (!val) return fallback;
  const n = Number(val);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function envOptionalUrl(key: string): string | undefined {
  const val = process.env[key];
  return val && val.length > 0 ? val : undefined;
}

function envStatusMap(): Record<string, string> {
  const raw = process.env['JIRA_STATUS_MAP'];
  if (!raw) return DEFAULT_STATUS_MAP;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, string>;
    }
  } catch {
    // fallback silencioso — config inválida usa o padrão
  }
  return DEFAULT_STATUS_MAP;
}

// ─── Singleton exportado ──────────────────────────────────────────────────────

export const squadConfig: SquadConfig = SquadConfigSchema.parse({
  jira: {
    baseUrl:    env('JIRA_BASE_URL'),
    projectKey: envOr('JIRA_PROJECT_KEY', 'SCRUM'),
    statusMap:  envStatusMap(),
  },
  github: {
    owner:         env('GITHUB_OWNER'),
    repo:          env('GITHUB_REPO'),
    defaultBranch: envOr('GITHUB_DEFAULT_BRANCH', 'main'),
  },
  ci: {
    testCommand:        envOr('CI_TEST_COMMAND', 'npm test'),
    coverageCommand:    envOr('CI_COVERAGE_COMMAND', 'npm run test:coverage'),
    coverageThreshold:  envNumber('CI_COVERAGE_THRESHOLD', 85),
  },
  agents: {
    devConcurrency: envNumber('AGENTS_DEV_CONCURRENCY', 5),
    timeouts: {
      ciMs:    envNumber('AGENTS_TIMEOUT_CI_MS', 600_000),
      agentMs: envNumber('AGENTS_TIMEOUT_AGENT_MS', 300_000),
    },
    models: {
      default: envOr('AGENTS_MODEL_DEFAULT', 'claude-sonnet-4-6'),
      fast:    envOr('AGENTS_MODEL_FAST', 'claude-haiku-4-5-20251001'),
    },
  },
  notifications: {
    onGateReached: envOptionalUrl('NOTIFICATION_WEBHOOK_GATE'),
    onError:       envOptionalUrl('NOTIFICATION_WEBHOOK_ERROR'),
  },
});
