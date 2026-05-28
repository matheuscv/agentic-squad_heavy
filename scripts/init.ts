#!/usr/bin/env tsx
/**
 * agentic-squad init — Wizard de configuração da Squad Agêntica
 *
 * Uso:
 *   npx tsx scripts/init.ts
 *   npm run init
 *
 * O wizard coleta credenciais interativamente, valida os acessos,
 * instala o workflow de CI no repo alvo, registra o webhook no Jira
 * e executa um smoke test end-to-end opcional.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { randomBytes } from 'crypto';
import {
  ask,
  confirm,
  closePrompts,
  print,
  step,
  ok,
  fail,
  warn,
  info,
} from '../src/cli/prompts';
import { validateJiraAccess, registerJiraWebhook } from '../src/cli/jira-setup';
import {
  validateGitHubAccess,
  installAgentDevWorkflow,
  readPemFile,
  looksLikeFilePath,
} from '../src/cli/github-setup';
import { checkServiceHealth, runSmokeTest } from '../src/cli/smoke-test';
import { detectStackFromGitHub } from '../src/cli/stack-detector';

// ─── Utilitários de .env ──────────────────────────────────────────────────────

function parseEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const content = readFileSync(path, 'utf-8');
  const result: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    result[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return result;
}

function writeEnvFile(path: string, vars: Record<string, string>): void {
  const lines = Object.entries(vars).map(([k, v]) => `${k}=${v}`);
  writeFileSync(path, lines.join('\n') + '\n', 'utf-8');
}

// ─── Banner ───────────────────────────────────────────────────────────────────

function printBanner(): void {
  print('');
  print('┌──────────────────────────────────────────────────────┐');
  print('│  agentic-squad init                                  │');
  print('│  Wizard de configuração da Squad Agêntica            │');
  print('└──────────────────────────────────────────────────────┘');
  print('');
  print('Este wizard irá:');
  info('1. Coletar e validar credenciais Jira e GitHub');
  info('2. Instalar o workflow de CI no repositório alvo');
  info('3. Registrar o webhook automático no Jira');
  info('4. Executar um smoke test de ponta a ponta (opcional)');
  print('');
  warn('Nota: entradas serão visíveis no terminal. Use ambiente seguro.');
  print('');
}

// ─── Wizard principal ─────────────────────────────────────────────────────────

async function main(): Promise<void> {
  printBanner();

  const envPath = resolve(process.cwd(), '.env');
  const existing = parseEnvFile(envPath);
  const collected: Record<string, string> = {};
  const TOTAL_STEPS = 7;

  // ── Step 1: Jira ──────────────────────────────────────────────────────────

  step(1, TOTAL_STEPS, 'Configuração do Jira');

  const jiraBaseUrl   = await ask('JIRA_BASE_URL',    existing['JIRA_BASE_URL'] ?? 'https://org.atlassian.net');
  const jiraEmail     = await ask('JIRA_EMAIL',       existing['JIRA_EMAIL'] ?? '');
  const jiraToken     = await ask('JIRA_API_TOKEN',   existing['JIRA_API_TOKEN'] ?? '');
  const projectKey    = await ask('JIRA_PROJECT_KEY', existing['JIRA_PROJECT_KEY'] ?? 'SCRUM');
  const webhookSecret = await ask(
    'JIRA_WEBHOOK_SECRET (Enter = gerar)',
    existing['JIRA_WEBHOOK_SECRET'] ?? randomBytes(32).toString('hex'),
  );

  info('Validando acesso ao Jira...');
  const jiraValidation = await validateJiraAccess(jiraBaseUrl, jiraEmail, jiraToken, projectKey);

  if (!jiraValidation.ok) {
    fail(`Jira inacessível: ${jiraValidation.detail}`);
    if (!await confirm('Continuar mesmo assim?', false)) {
      closePrompts();
      process.exit(1);
    }
    warn('Continuando sem validação Jira.');
  } else {
    ok(`Jira conectado — projeto ${projectKey} encontrado`);
  }

  collected['JIRA_BASE_URL']       = jiraBaseUrl;
  collected['JIRA_EMAIL']          = jiraEmail;
  collected['JIRA_API_TOKEN']      = jiraToken;
  collected['JIRA_PROJECT_KEY']    = projectKey;
  collected['JIRA_WEBHOOK_SECRET'] = webhookSecret;

  // ── Step 2: GitHub App ────────────────────────────────────────────────────

  step(2, TOTAL_STEPS, 'Configuração do GitHub App');

  const githubOwner    = await ask('GITHUB_OWNER',          existing['GITHUB_OWNER'] ?? '');
  const githubRepo     = await ask('GITHUB_REPO',           existing['GITHUB_REPO'] ?? '');
  const githubAppId    = await ask('GITHUB_APP_ID',         existing['GITHUB_APP_ID'] ?? '');
  const installationId = await ask('GITHUB_APP_INSTALLATION_ID', existing['GITHUB_APP_INSTALLATION_ID'] ?? '');
  const defaultBranch  = await ask('GITHUB_DEFAULT_BRANCH', existing['GITHUB_DEFAULT_BRANCH'] ?? 'main');

  let privateKey = existing['GITHUB_APP_PRIVATE_KEY'] ?? '';
  const keyInput = await ask(
    'GITHUB_APP_PRIVATE_KEY (caminho .pem ou inline com \\n)',
    privateKey ? '*** (manter existente)' : '',
  );
  if (keyInput && keyInput !== '*** (manter existente)') {
    privateKey = looksLikeFilePath(keyInput) ? readPemFile(keyInput) : keyInput;
  }

  // Popula process.env para que o cliente GitHub funcione
  Object.assign(process.env, {
    GITHUB_OWNER:               githubOwner,
    GITHUB_REPO:                githubRepo,
    GITHUB_APP_ID:              githubAppId,
    GITHUB_APP_PRIVATE_KEY:     privateKey,
    GITHUB_APP_INSTALLATION_ID: installationId,
  });

  info('Validando acesso ao GitHub App...');
  const ghValidation = await validateGitHubAccess();

  if (!ghValidation.ok) {
    fail(`GitHub inacessível: ${ghValidation.detail}`);
    if (!await confirm('Continuar mesmo assim?', false)) {
      closePrompts();
      process.exit(1);
    }
    warn('Continuando sem validação GitHub.');
  } else {
    ok(`GitHub App autenticado — ${githubOwner}/${githubRepo} acessível`);
  }

  collected['GITHUB_OWNER']               = githubOwner;
  collected['GITHUB_REPO']                = githubRepo;
  collected['GITHUB_APP_ID']              = githubAppId;
  collected['GITHUB_APP_PRIVATE_KEY']     = privateKey;
  collected['GITHUB_APP_INSTALLATION_ID'] = installationId;
  collected['GITHUB_DEFAULT_BRANCH']      = defaultBranch;

  // ── Step 3: Detecção de stack ─────────────────────────────────────────────

  step(3, TOTAL_STEPS, `Detecção de stack — ${githubOwner}/${githubRepo}`);

  info('Lendo arquivos do repositório...');
  const stack = await detectStackFromGitHub(defaultBranch === 'main' ? undefined : defaultBranch);

  if (!stack.detected) {
    warn('Stack não detectada automaticamente — preencha os comandos manualmente.');
  } else {
    ok(`Stack detectada: ${stack.language} / ${stack.buildTool} / ${stack.testFramework}`);
    info(`Manifests encontrados: ${stack.manifests.join(', ')}`);
  }

  const testCommand = await ask('CI_TEST_COMMAND', existing['CI_TEST_COMMAND'] ?? stack.testCommand);
  const coverageCommand = await ask(
    'CI_COVERAGE_COMMAND',
    existing['CI_COVERAGE_COMMAND'] ?? stack.coverageCommand,
  );
  const coverageThreshold = Number(
    await ask(
      'CI_COVERAGE_THRESHOLD (%)',
      String(existing['CI_COVERAGE_THRESHOLD'] ?? stack.coverageThreshold),
    ),
  );

  ok(`CI configurado: test="${testCommand}" | coverage="${coverageCommand}" | threshold=${coverageThreshold}%`);

  collected['CI_TEST_COMMAND']       = testCommand;
  collected['CI_COVERAGE_COMMAND']   = coverageCommand;
  collected['CI_COVERAGE_THRESHOLD'] = String(Number.isFinite(coverageThreshold) ? coverageThreshold : 80);

  // ── Step 4: URL do serviço ────────────────────────────────────────────────

  step(4, TOTAL_STEPS, 'URL do serviço (onde o agentic-squad está hospedado)');

  const serviceUrl = await ask('SERVICE_URL', existing['SERVICE_URL'] ?? 'https://agentic-squad.onrender.com');
  const webhookUrl = `${serviceUrl.replace(/\/$/, '')}/webhooks/jira?secret=${webhookSecret}`;

  info('Verificando saúde do serviço...');
  const health = await checkServiceHealth(serviceUrl);

  if (!health.ok) {
    warn(`Serviço não respondeu — ${health.detail ?? 'timeout'}`);
    warn('O smoke test será pulado. Valide o deploy antes de testar.');
  } else {
    ok(`Serviço respondeu: status=${health.status}`);
  }

  collected['SERVICE_URL'] = serviceUrl;

  // ── Step 5: Instalar workflow de CI ───────────────────────────────────────

  step(5, TOTAL_STEPS, 'Instalando GitHub Actions workflow no repositório alvo');

  if (await confirm(`Instalar .github/workflows/agent-dev.yml em ${githubOwner}/${githubRepo}?`, true)) {
    info('Instalando workflow...');
    const wfResult = await installAgentDevWorkflow();
    if (!wfResult.ok) {
      fail(`Falha ao instalar workflow: ${wfResult.detail}`);
      warn('Instale manualmente o arquivo .github/workflows/agent-dev.yml no repositório.');
    } else {
      ok(`Workflow instalado — commit ${wfResult.sha?.slice(0, 7)}`);
      if (wfResult.url) info(`URL: ${wfResult.url}`);
    }
  } else {
    warn('Instalação do workflow pulada. Instale manualmente antes de usar o Agente DEV.');
  }

  // ── Step 6: Registrar webhook no Jira ────────────────────────────────────

  step(6, TOTAL_STEPS, 'Registrando webhook no Jira');

  info(`URL do webhook: ${webhookUrl}`);
  info(`Filtro JQL: project = "${projectKey}" | Eventos: jira:issue_updated`);

  let webhookRegistered = false;

  if (await confirm('Registrar webhook no Jira agora?', true)) {
    info('Registrando...');
    const whResult = await registerJiraWebhook(jiraBaseUrl, jiraEmail, jiraToken, webhookUrl, projectKey);

    if (!whResult.ok) {
      fail(`Falha ao registrar webhook: ${whResult.detail}`);
      warn('Configure manualmente em Jira Admin → System → WebHooks:');
      info(`URL: ${webhookUrl}`);
    } else {
      ok(`Webhook registrado (ID: ${whResult.webhookId ?? 'desconhecido'})`);
      webhookRegistered = true;
      warn('Webhooks dinâmicos expiram em 30 dias — re-execute "npm run init" para renovar.');
    }
  } else {
    warn('Registro de webhook pulado. Configure manualmente:');
    info(`URL: ${webhookUrl}`);
  }

  // ── Step 7: Smoke test ────────────────────────────────────────────────────

  step(7, TOTAL_STEPS, 'Smoke test (ponta a ponta)');

  if (!health.ok) {
    warn('Smoke test pulado — serviço não está acessível.');
  } else if (await confirm('Criar história de teste no Jira e validar o fluxo?', true)) {
    info('Criando história de teste...');
    const smoke = await runSmokeTest({
      jiraBaseUrl,
      jiraEmail,
      jiraToken,
      jiraProjectKey: projectKey,
      serviceUrl,
      webhookSecret,
    });

    if (smoke.issue) info(`História criada: ${smoke.issue.key}`);

    if (smoke.ok) {
      ok('Webhook respondeu com { queued: true }');
      ok('Pipeline de eventos funcionando corretamente');
      ok(smoke.cleaned ? `História ${smoke.issue?.key} removida` : 'Limpeza concluída');
    } else {
      fail(`Smoke test falhou: ${smoke.detail}`);
      if (!smoke.cleaned && smoke.issue) {
        warn(`Remova manualmente a história ${smoke.issue.key} no Jira.`);
      }
      if (smoke.webhookResponse) {
        info(`Resposta: ${JSON.stringify(smoke.webhookResponse)}`);
      }
    }
  } else {
    info('Smoke test pulado.');
  }

  // ── Salva variáveis ───────────────────────────────────────────────────────

  print('');
  print('─'.repeat(56));

  const outputPath = resolve(process.cwd(), '.env.init');
  writeEnvFile(outputPath, collected);

  ok(`Variáveis salvas em ${outputPath}`);
  print('');
  print('Próximos passos:');
  info('1. Revise o arquivo .env.init');
  info('2. Copie as variáveis para o .env (ou substitua-o)');
  info('3. Faça deploy do serviço com as novas variáveis');
  info('4. No GitHub: Branch Protection → Require status check:');
  info('   "Lint · Typecheck · Build · Test · Coverage"');
  if (webhookRegistered) {
    info('5. Execute "npm run init" em ~30 dias para renovar o webhook dinâmico');
  }
  print('');
}

// ─── Entry point ──────────────────────────────────────────────────────────────

main()
  .catch((err: Error) => {
    console.error('\n✗ Erro inesperado:', err.message);
    process.exit(1);
  })
  .finally(() => {
    closePrompts();
  });
