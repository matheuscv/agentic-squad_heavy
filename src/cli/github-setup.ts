import { readFileSync } from 'fs';
import { resolve } from 'path';

// ─── Validação de acesso ──────────────────────────────────────────────────────
//
// Usa o cliente GitHub existente. Requer que process.env tenha sido populado
// com GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, GITHUB_APP_INSTALLATION_ID,
// GITHUB_OWNER, GITHUB_REPO antes da chamada.

export type ValidationResult = { ok: boolean; detail?: string };

export async function validateGitHubAccess(): Promise<ValidationResult> {
  try {
    const { listDirectory } = await import('../github/client');
    await listDirectory('');
    return { ok: true };
  } catch (err) {
    return { ok: false, detail: (err as Error).message };
  }
}

// ─── Instalação do workflow de CI ─────────────────────────────────────────────
//
// Commit do workflow Agent DEV no repositório alvo.
// O conteúdo é lido do template embarcado; branches do agente seguem
// o padrão "agent/task-*" definido pelo orquestrador.

const AGENT_DEV_WORKFLOW = `# Workflow de CI para branches geradas pelo Agente DEV.
#
# Pré-requisito no GitHub (Branch Protection -> master):
#   Settings -> Branches -> Add rule -> Require status checks:
#   "Lint · Typecheck · Build · Test · Coverage"

name: Agent DEV — CI

on:
  push:
    branches:
      - 'agent/task-*'
  pull_request:
    branches:
      - master
      - main

concurrency:
  group: agent-dev-ci-\${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: write
  pull-requests: write
  checks: write

jobs:
  quality-gate:
    name: Lint · Typecheck · Build · Test · Coverage
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js 22
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - name: Instalar dependências
        run: npm ci

      - name: Typecheck
        run: npm run typecheck

      - name: Lint
        run: npm run lint

      - name: Build
        run: npm run build

      - name: Testes com cobertura
        run: npm run test:coverage

      - name: Persiste .qa-coverage.json no branch
        if: always() && github.event_name == 'push'
        run: |
          if [ ! -f coverage/coverage-summary.json ]; then
            echo "coverage-summary.json não encontrado — pulando persistência"
            exit 0
          fi
          cp coverage/coverage-summary.json .qa-coverage.json
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add .qa-coverage.json
          git diff --staged --quiet && echo "nenhuma mudança na cobertura" && exit 0
          git commit -m "ci: atualiza .qa-coverage.json [skip ci]"
          git push

      - name: Upload relatório de cobertura
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: coverage-\${{ github.run_id }}
          path: coverage/
          retention-days: 14
`;

export type WorkflowInstallResult = { ok: boolean; sha?: string; url?: string; detail?: string };

export async function installAgentDevWorkflow(): Promise<WorkflowInstallResult> {
  try {
    const { commitFile } = await import('../github/client');
    const result = await commitFile(
      '.github/workflows/agent-dev.yml',
      AGENT_DEV_WORKFLOW,
      'ci: instala workflow Agent DEV (agentic-squad init)',
    );
    return { ok: true, sha: result.sha, url: result.url };
  } catch (err) {
    return { ok: false, detail: (err as Error).message };
  }
}

// ─── Utilitários ──────────────────────────────────────────────────────────────

/** Lê um arquivo PEM e converte para o formato de linha única usado no .env. */
export function readPemFile(filePath: string): string {
  const absPath = filePath.startsWith('~')
    ? filePath.replace('~', process.env['HOME'] ?? process.env['USERPROFILE'] ?? '')
    : resolve(filePath);
  const content = readFileSync(absPath, 'utf-8');
  return content.trim().replace(/\r\n/g, '\n').replace(/\n/g, '\\n');
}

/** Retorna true se a string parece um caminho de arquivo (não uma chave PEM inline). */
export function looksLikeFilePath(s: string): boolean {
  return (
    s.startsWith('/') ||
    s.startsWith('./') ||
    s.startsWith('../') ||
    s.startsWith('~') ||
    s.endsWith('.pem') ||
    /^[A-Za-z]:[/\\]/.test(s)   // Windows path: C:\...
  );
}
