import type Anthropic from '@anthropic-ai/sdk';

// ─── Histórias reais de baixa complexidade ────────────────────────────────────

export const SCRUM_50 = {
  storyId:    'aaaaaaaa-0000-0000-0000-000000000050',
  jiraKey:    'SCRUM-50',
  agentRunId: 'bbbbbbbb-0000-0000-0000-000000000050',
  summary:    'Adicionar função formatDate() ao módulo de utilitários',
  branch:     'agent/task-scrum-50',
} as const;

export const SCRUM_51 = {
  storyId:    'aaaaaaaa-0000-0000-0000-000000000051',
  jiraKey:    'SCRUM-51',
  agentRunId: 'bbbbbbbb-0000-0000-0000-000000000051',
  summary:    'Adicionar endpoint GET /ping independente do /health',
  branch:     'agent/task-scrum-51',
} as const;

// ─── Builders de mensagem Claude ─────────────────────────────────────────────

let _msgId = 0;
let _toolId = 0;

export function makeToolUseMsg(
  name: string,
  input: Record<string, unknown>,
): Anthropic.Message {
  return {
    id: `msg_${++_msgId}`,
    type: 'message',
    role: 'assistant',
    content: [{ type: 'tool_use', id: `tool_${++_toolId}`, name, input }],
    model: 'claude-opus-4-7',
    stop_reason: 'tool_use',
    stop_sequence: null,
    usage: { input_tokens: 200, output_tokens: 50 } as Anthropic.Usage,
  };
}

export function makeEndTurnMsg(text = 'Concluído.'): Anthropic.Message {
  return {
    id: `msg_${++_msgId}`,
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text, citations: [] } as Anthropic.TextBlock],
    model: 'claude-opus-4-7',
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 200, output_tokens: 50 } as Anthropic.Usage,
  };
}

// ─── Sequências Claude para o Agente DEV ─────────────────────────────────────

/** SCRUM-50: DEV implementa módulo utils/date.ts */
export const SCRUM_50_DEV_SEQUENCE: Anthropic.Message[] = [
  makeToolUseMsg('read_github_file', {
    file_path: 'SCRUM-50/PLANO_DE_EXECUCAO.md',
    branch: 'prd/scrum-50',
  }),
  makeToolUseMsg('list_github_directory', { dir_path: 'src' }),
  makeToolUseMsg('write_github_file', {
    file_path: 'src/utils/date.ts',
    content: [
      "/**",
      " * Formata um Date como string no formato YYYY-MM-DD.",
      " */",
      "export function formatDate(d: Date): string {",
      "  return d.toISOString().split('T')[0];",
      "}",
      "",
    ].join('\n'),
  }),
  makeToolUseMsg('write_github_file', {
    file_path: 'src/utils/date.test.ts',
    content: [
      "import { describe, it, expect } from 'vitest';",
      "import { formatDate } from './date';",
      "",
      "describe('formatDate', () => {",
      "  it('formata data no formato YYYY-MM-DD', () => {",
      "    expect(formatDate(new Date('2026-05-25T12:00:00Z'))).toBe('2026-05-25');",
      "  });",
      "  it('aceita datas passadas', () => {",
      "    expect(formatDate(new Date('2000-01-01'))).toBe('2000-01-01');",
      "  });",
      "});",
      "",
    ].join('\n'),
  }),
  makeToolUseMsg('create_github_commit', {
    commit_message: 'feat(SCRUM-50): adiciona formatDate() ao módulo utils',
  }),
  makeToolUseMsg('create_pull_request', {
    title: '[SCRUM-50] Adicionar função formatDate() ao módulo de utilitários',
    body: [
      '## Resumo',
      'Implementa `formatDate()` conforme PLANO_DE_EXECUCAO.md.',
      '',
      '## Arquivos',
      '- `src/utils/date.ts` — implementação',
      '- `src/utils/date.test.ts` — testes unitários',
    ].join('\n'),
  }),
  makeEndTurnMsg('SCRUM-50: formatDate() implementado e PR criado.'),
];

/** SCRUM-51: DEV em modo correção — lê CORRECTION_REQUEST.md, não cria PR */
export const SCRUM_51_DEV_CORRECTION_SEQUENCE: Anthropic.Message[] = [
  makeToolUseMsg('read_github_file', {
    file_path: 'CORRECTION_REQUEST.md',
    branch: 'agent/task-scrum-51',
  }),
  makeToolUseMsg('read_github_file', {
    file_path: 'src/routes/ping.ts',
    branch: 'agent/task-scrum-51',
  }),
  makeToolUseMsg('write_github_file', {
    file_path: 'src/routes/ping.ts',
    content: [
      "import { Router, type Request, type Response } from 'express';",
      "const router = Router();",
      "router.get('/', (_req: Request, res: Response) => res.json({ pong: true, ts: Date.now() }));",
      "export default router;",
      "",
    ].join('\n'),
  }),
  makeToolUseMsg('create_github_commit', {
    commit_message: 'fix(SCRUM-51): corrige handler /ping conforme CORRECTION_REQUEST',
  }),
  makeEndTurnMsg('Correção SCRUM-51 implementada sem criar novo PR.'),
];

// ─── Sequências Claude para o Agente QA ──────────────────────────────────────

/** QA happy path: CI passa com cobertura 91% — sem iterações */
export const QA_HAPPY_PATH_SEQUENCE: Anthropic.Message[] = [
  makeToolUseMsg('get_workflow_run_result', { branch: 'agent/task-scrum-50' }),
  makeToolUseMsg('finish_qa_review', {
    passed: true,
    coverage: {
      total: {
        statements: { pct: 91.2 },
        branches:   { pct: 87.5 },
        functions:  { pct: 90.0 },
        lines:      { pct: 92.3 },
      },
    },
    summary: [
      '## Revisão QA — SCRUM-50',
      '',
      'CI passou. Cobertura ≥ 85% em todas as métricas.',
      '- Statements: 91.2% ✅',
      '- Branches: 87.5% ✅',
      '- Functions: 90.0% ✅',
      '- Lines: 92.3% ✅',
      '',
      '**APROVADO**',
    ].join('\n'),
    tests_written: [],
    iterations: 0,
  }),
  makeEndTurnMsg('SCRUM-50 aprovado pelo QA.'),
];

/** QA: 1 ciclo de correção → CI falha → DEV corrige → CI passa */
export const QA_ONE_CORRECTION_SEQUENCE: Anthropic.Message[] = [
  // Turno 1: obtém resultado do CI (falhou)
  makeToolUseMsg('get_workflow_run_result', { branch: 'agent/task-scrum-51' }),
  // Turno 2: lê o arquivo com problema
  makeToolUseMsg('read_github_file', { file_path: 'src/routes/ping.ts', branch: 'agent/task-scrum-51' }),
  // Turno 3: cria pedido de correção → dispara DEV
  makeToolUseMsg('create_correction_request', {
    iteration: 1,
    description: 'A rota /ping retorna 500. O handler usa Request sem import correto.',
    files_with_issues: ['src/routes/ping.ts'],
    failing_tests: ['src/routes/ping.test.ts > GET /ping > retorna 200 com { pong: true }'],
  }),
  // Turno 4: aguarda DEV correction concluir
  makeToolUseMsg('wait_for_dev_correction', { agent_run_id: 'correction-run-uuid-1' }),
  // Turno 5: aguarda novo CI
  makeToolUseMsg('wait_for_ci', { branch: 'agent/task-scrum-51', current_run_id: 101 }),
  // Turno 6: verifica novo resultado (passou)
  makeToolUseMsg('get_workflow_run_result', { branch: 'agent/task-scrum-51' }),
  // Turno 7: finaliza aprovado
  makeToolUseMsg('finish_qa_review', {
    passed: true,
    coverage: {
      total: {
        statements: { pct: 88.5 },
        branches:   { pct: 85.0 },
        functions:  { pct: 90.0 },
        lines:      { pct: 88.0 },
      },
    },
    summary: [
      '## Revisão QA — SCRUM-51',
      '',
      '1 ciclo de correção realizado. CI passou após fix do handler /ping.',
      '',
      '**APROVADO**',
    ].join('\n'),
    tests_written: [],
    iterations: 0,
  }),
  makeEndTurnMsg('SCRUM-51 aprovado após 1 ciclo de correção.'),
];

/** QA: 3 ciclos falhados → escalação para humano */
export const QA_ESCALATION_SEQUENCE: Anthropic.Message[] = [
  makeToolUseMsg('get_workflow_run_result', { branch: 'agent/task-scrum-51' }),
  makeToolUseMsg('read_github_file', { file_path: 'src/routes/ping.ts' }),
  // Ciclo 1
  makeToolUseMsg('create_correction_request', { iteration: 1, description: 'CI falha — erro 500 no handler' }),
  makeToolUseMsg('wait_for_dev_correction', { agent_run_id: 'correction-run-uuid-1' }),
  makeToolUseMsg('wait_for_ci', { branch: 'agent/task-scrum-51', current_run_id: 101 }),
  makeToolUseMsg('get_workflow_run_result', { branch: 'agent/task-scrum-51' }),
  // Ciclo 2
  makeToolUseMsg('create_correction_request', { iteration: 2, description: 'CI ainda falha após ciclo 1' }),
  makeToolUseMsg('wait_for_dev_correction', { agent_run_id: 'correction-run-uuid-2' }),
  makeToolUseMsg('wait_for_ci', { branch: 'agent/task-scrum-51', current_run_id: 102 }),
  makeToolUseMsg('get_workflow_run_result', { branch: 'agent/task-scrum-51' }),
  // Ciclo 3
  makeToolUseMsg('create_correction_request', { iteration: 3, description: 'CI falha — problema estrutural' }),
  makeToolUseMsg('wait_for_dev_correction', { agent_run_id: 'correction-run-uuid-3' }),
  makeToolUseMsg('wait_for_ci', { branch: 'agent/task-scrum-51', current_run_id: 103 }),
  makeToolUseMsg('get_workflow_run_result', { branch: 'agent/task-scrum-51' }),
  // Escalação
  makeToolUseMsg('escalate_to_human', {
    reason: 'CI falhou em 3 ciclos consecutivos. Handler /ping apresenta problema estrutural.',
    final_coverage: { total: { statements: { pct: 55 }, branches: { pct: 40 } } },
  }),
  makeToolUseMsg('finish_qa_review', {
    passed: false,
    summary: [
      '## Revisão QA — SCRUM-51',
      '',
      '3 ciclos de correção DEV realizados. CI persistiu com falhas.',
      '',
      '**ESCALADO PARA HUMANO**',
    ].join('\n'),
    tests_written: [],
    iterations: 0,
  }),
  makeEndTurnMsg('SCRUM-51 escalado para revisão humana.'),
];

// ─── Mock de cobertura (coverage-summary.json) ───────────────────────────────

export const COVERAGE_OK = JSON.stringify({
  total: {
    statements: { pct: 91.2, total: 100, covered: 91 },
    branches:   { pct: 87.5, total: 80,  covered: 70 },
    functions:  { pct: 90.0, total: 50,  covered: 45 },
    lines:      { pct: 92.3, total: 100, covered: 92 },
  },
});

export const COVERAGE_LOW = JSON.stringify({
  total: {
    statements: { pct: 55.0, total: 100, covered: 55 },
    branches:   { pct: 40.0, total: 80,  covered: 32 },
    functions:  { pct: 60.0, total: 50,  covered: 30 },
    lines:      { pct: 57.0, total: 100, covered: 57 },
  },
});
