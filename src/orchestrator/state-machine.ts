import type { StoryStatus } from '../db/schema';

// ─── Status canônicos — espelham exatamente as colunas do board Jira ──────────

export const JIRA_STATUSES = [
  'Backlog',
  'A Refinar',
  'Em Refinamento',
  'Aguardando Aceite PRD',
  'PRD Aceito',
  'Aguardando Aceite Plano',
  'Plano Validado',
  'Em Desenvolvimento',
  'Aguardando Aceite Dev',
  'Em QA',
  'Aguardando Aceite QA',
  'Validação Final',
  'Concluído',
] as const;

export type JiraStatus = (typeof JIRA_STATUSES)[number];

// ─── Mapeamento Jira (texto) → enum do banco ──────────────────────────────────

export const JIRA_TO_DB_STATUS: Record<JiraStatus, StoryStatus> = {
  'Backlog':                'backlog',
  'A Refinar':              'a_refinar',
  'Em Refinamento':         'em_refinamento',
  'Aguardando Aceite PRD':  'aguardando_aceite_prd',
  'PRD Aceito':             'prd_aceito',
  'Aguardando Aceite Plano':'aguardando_aceite_plano',
  'Plano Validado':         'plano_validado',
  'Em Desenvolvimento':     'em_desenvolvimento',
  'Aguardando Aceite Dev':  'aguardando_aceite_dev',
  'Em QA':                  'em_qa',
  'Aguardando Aceite QA':   'aguardando_aceite_qa',
  'Validação Final':        'validacao_final',
  'Concluído':              'concluido',
};

// ─── Tipos de resultado da máquina de estados ─────────────────────────────────

export type AgentType = 'po' | 'lt' | 'dev' | 'qa';

export type TransitionResult =
  | { type: 'invoke_agent'; agent: AgentType; moveTo?: JiraStatus; description: string }
  | { type: 'human_gate';   gate: number; description: string }
  | { type: 'in_progress';  description: string }
  | { type: 'terminal';     description: string }
  | { type: 'unknown';      status: string };

// ─── Mapa de transições ───────────────────────────────────────────────────────
//
// Chave  = status que CHEGOU via webhook (toStatus)
// Valor  = ação que o Orquestrador executa em resposta

const TRANSITION_MAP: Partial<Record<JiraStatus, TransitionResult>> = {

  // Humano move o card → Orquestrador automaticamente avança e invoca PO
  'A Refinar': {
    type: 'invoke_agent',
    agent: 'po',
    moveTo: 'Em Refinamento',
    description: 'Mover card para "Em Refinamento" e invocar Agente PO',
  },

  // Orquestrador moveu para cá → PO está trabalhando, sem nova ação
  'Em Refinamento': {
    type: 'in_progress',
    description: 'Agente PO em execução — aguardando geração do PRD.md',
  },

  // PO terminou → gate humano 1/5
  'Aguardando Aceite PRD': {
    type: 'human_gate',
    gate: 1,
    description: 'Gate 1/5 — PRD.md gerado. Aguardando aprovação do PO humano',
  },

  // Humano aprovou PRD → Orquestrador invoca LT
  'PRD Aceito': {
    type: 'invoke_agent',
    agent: 'lt',
    description: 'Invocar Agente LT para decompor PRD em tasks técnicas',
  },

  // LT terminou → gate humano 2/5
  'Aguardando Aceite Plano': {
    type: 'human_gate',
    gate: 2,
    description: 'Gate 2/5 — PLANO_DE_EXECUCAO.md gerado. Aguardando aprovação do LT humano',
  },

  // Humano aprovou plano → Orquestrador invoca DEVs (até 5 paralelos)
  'Plano Validado': {
    type: 'invoke_agent',
    agent: 'dev',
    moveTo: 'Em Desenvolvimento',
    description: 'Mover card para "Em Desenvolvimento" e invocar Agentes DEV (até 5 paralelos)',
  },

  // Orquestrador moveu para cá → DEVs trabalhando, sem nova ação
  'Em Desenvolvimento': {
    type: 'in_progress',
    description: 'Agentes DEV em execução — implementando tasks',
  },

  // DEVs terminaram → gate humano 3/5
  'Aguardando Aceite Dev': {
    type: 'human_gate',
    gate: 3,
    description: 'Gate 3/5 — Código gerado. Aguardando revisão do DEV humano',
  },

  // Humano aprovou dev → Orquestrador invoca QA
  'Em QA': {
    type: 'invoke_agent',
    agent: 'qa',
    description: 'Invocar Agente QA para executar testes e medir cobertura (≥85%)',
  },

  // QA terminou → gate humano 4/5
  'Aguardando Aceite QA': {
    type: 'human_gate',
    gate: 4,
    description: 'Gate 4/5 — QA concluído. Aguardando aprovação do QA humano',
  },

  // Humano aprovou QA → gate humano 5/5 (validação final)
  'Validação Final': {
    type: 'human_gate',
    gate: 5,
    description: 'Gate 5/5 — Validação final. Aguardando aprovação do responsável',
  },

  // Concluído → estado terminal
  'Concluído': {
    type: 'terminal',
    description: 'História concluída com sucesso',
  },
};

// ─── Funções públicas ─────────────────────────────────────────────────────────

export function isKnownStatus(status: string): status is JiraStatus {
  return JIRA_STATUSES.includes(status as JiraStatus);
}

/** Retorna a posição ordinal do status no fluxo (0 = Backlog, 12 = Concluído). */
export function getStateOrder(status: string): number {
  return JIRA_STATUSES.indexOf(status as JiraStatus);
}

/** Decide o que o Orquestrador deve fazer dado o status de destino recebido. */
export function handleTransition(toStatus: string): TransitionResult {
  if (!isKnownStatus(toStatus)) {
    return { type: 'unknown', status: toStatus };
  }
  return (
    TRANSITION_MAP[toStatus] ?? {
      type: 'in_progress',
      description: `Status "${toStatus}" sem ação explícita definida`,
    }
  );
}
