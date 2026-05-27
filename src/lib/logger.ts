import pino from 'pino';

// ─── Configuração ─────────────────────────────────────────────────────────────
//
// Sempre emite JSON para stdout — zero dependência de worker threads ou
// pino-pretty no container, o que garante compatibilidade com Alpine Linux.
//
// Betterstack recebe logs de duas formas:
//   1. Drain do Render (todos os logs): Dashboard → Sources → Connect source → Render
//   2. HTTP direto (alertas críticos): via src/lib/betterstack.ts com BETTERSTACK_SOURCE_TOKEN
//
// Em desenvolvimento, para output legível:
//   npm run dev | npx pino-pretty --colorize

export const logger = pino({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  base: { service: 'agentic-squad-heavy' },
  timestamp: pino.stdTimeFunctions.isoTime,
});

// ─── Factory de child loggers com contexto fixo ───────────────────────────────

export function childLogger(ctx: Record<string, unknown>) {
  return logger.child(ctx);
}

// ─── Campos obrigatórios de log de evento de agente ───────────────────────────

export interface AgentEventFields {
  storyId: string;
  jiraKey: string;
  agentRunId: string;
  agent: string;
  phase: string;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  tokenCostUsd?: number;
  error?: string;
}

export type AgentLogger = ReturnType<typeof childLogger>;

export function logAgentStarted(log: AgentLogger, fields: Omit<AgentEventFields, 'durationMs' | 'inputTokens' | 'outputTokens' | 'tokenCostUsd' | 'error'>): void {
  log.info({ ...fields, event: 'agent_started' }, `agente ${fields.agent} iniciado`);
}

export function logAgentCompleted(log: AgentLogger, fields: AgentEventFields): void {
  log.info({ ...fields, event: 'agent_completed' }, `agente ${fields.agent} concluído`);
}

export function logAgentFailed(log: AgentLogger, fields: AgentEventFields): void {
  log.error({ ...fields, event: 'agent_failed' }, `agente ${fields.agent} falhou`);
}
