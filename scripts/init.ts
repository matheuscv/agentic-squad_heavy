#!/usr/bin/env tsx
/**
 * agentic-squad init — Wizard de configuração da Squad Agêntica
 *
 * Uso:
 *   npx tsx scripts/init.ts
 *   npm run init
 *
 * O wizard coleta credenciais interativamente, valida todos os serviços
 * de infraestrutura, instala o workflow de CI no repo alvo, registra o
 * webhook no Jira e executa um smoke test end-to-end opcional.
 *
 * Serviços cobertos (11 steps):
 *   1.  Jira             — credenciais + project key + webhook secret
 *   2.  GitHub App       — owner, repo, app ID, installation ID, private key
 *   3.  Stack Detection  — linguagem, test/coverage commands (auto-detecção)
 *   4.  Supabase         — DATABASE_URL + validação SELECT 1 + migrations
 *   5.  Upstash Redis    — REDIS_URL + ping test
 *   6.  Anthropic        — API key + modelo por agente + validação
 *   7.  Betterstack      — SOURCE_TOKEN (opcional) + thresholds de custo
 *   8.  Render URL       — SERVICE_URL + health check
 *   9.  Workflow CI      — instala .github/workflows/agent-dev.yml
 *   10. Webhook Jira     — registro automático do webhook dinâmico
 *   11. Smoke test       — ponta a ponta opcional
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
import { validateJiraAccess, registerJiraWebhook }            from '../src/cli/jira-setup';
import {
  validateGitHubAccess,
  installAgentDevWorkflow,
  readPemFile,
  looksLikeFilePath,
}                                                               from '../src/cli/github-setup';
import { validateDatabaseAccess, runMigrations }               from '../src/cli/supabase-setup';
import { validateRedisAccess }                                  from '../src/cli/redis-setup';
import { validateAnthropicAccess, resolveModel, MODEL_DEFAULTS } from '../src/cli/anthropic-setup';
import { checkServiceHealth, runSmokeTest }                    from '../src/cli/smoke-test';
import { detectStackFromGitHub }                               from '../src/cli/stack-detector';

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
  const sections: string[] = [
    '# ── Modelos por agente ───────────────────────────────────────────────────────',
    ...['MODEL_ORCHESTRATOR', 'MODEL_PO', 'MODEL_LT', 'MODEL_QA', 'MODEL_DEV']
      .filter((k) => vars[k])
      .map((k) => `${k}=${vars[k]}`),
    '',
    '# ── Jira ────────────────────────────────────────────────────────────────────',
    ...['JIRA_BASE_URL', 'JIRA_EMAIL', 'JIRA_API_TOKEN', 'JIRA_PROJECT_KEY', 'JIRA_WEBHOOK_SECRET']
      .filter((k) => vars[k])
      .map((k) => `${k}=${vars[k]}`),
    '',
    '# ── GitHub App ──────────────────────────────────────────────────────────────',
    ...['GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY', 'GITHUB_APP_INSTALLATION_ID',
        'GITHUB_OWNER', 'GITHUB_REPO', 'GITHUB_DEFAULT_BRANCH']
      .filter((k) => vars[k])
      .map((k) => `${k}=${vars[k]}`),
    '',
    '# ── Banco de dados (Supabase) ───────────────────────────────────────────────',
    ...['DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']
      .filter((k) => vars[k])
      .map((k) => `${k}=${vars[k]}`),
    '',
    '# ── Redis (Upstash) ─────────────────────────────────────────────────────────',
    ...['REDIS_URL']
      .filter((k) => vars[k])
      .map((k) => `${k}=${vars[k]}`),
    '',
    '# ── Anthropic ───────────────────────────────────────────────────────────────',
    ...['ANTHROPIC_API_KEY']
      .filter((k) => vars[k])
      .map((k) => `${k}=${vars[k]}`),
    '',
    '# ── Observabilidade (Betterstack) ───────────────────────────────────────────',
    ...['BETTERSTACK_SOURCE_TOKEN']
      .filter((k) => vars[k])
      .map((k) => `${k}=${vars[k]}`),
    '',
    '# ── CI ──────────────────────────────────────────────────────────────────────',
    ...['CI_TEST_COMMAND', 'CI_COVERAGE_COMMAND', 'CI_COVERAGE_THRESHOLD']
      .filter((k) => vars[k])
      .map((k) => `${k}=${vars[k]}`),
    '',
    '# ── Agentes ─────────────────────────────────────────────────────────────────',
    ...['AGENTS_DEV_CONCURRENCY', 'COST_ALERT_THRESHOLD_USD', 'SERVICE_URL']
      .filter((k) => vars[k])
      .map((k) => `${k}=${vars[k]}`),
    '',
    '# ── Ambiente ────────────────────────────────────────────────────────────────',
    ...['NODE_ENV', 'PORT']
      .filter((k) => vars[k])
      .map((k) => `${k}=${vars[k]}`),
  ];

  // Inclui chaves que não entraram em nenhuma seção acima
  const covered = new Set(sections.filter((l) => l.includes('=')).map((l) => l.split('=')[0]));
  const extras = Object.entries(vars)
    .filter(([k]) => !covered.has(k))
    .map(([k, v]) => `${k}=${v}`);
  if (extras.length) {
    sections.push('', '# ── Demais variáveis ────────────────────────────────────────────────────────', ...extras);
  }

  writeFileSync(path, sections.join('\n') + '\n', 'utf-8');
}

// ─── Banner ───────────────────────────────────────────────────────────────────

function printBanner(): void {
  print('');
  print('┌──────────────────────────────────────────────────────┐');
  print('│  agentic-squad init  v2                              │');
  print('│  Wizard de configuração da Squad Agêntica            │');
  print('└──────────────────────────────────────────────────────┘');
  print('');
  print('Este wizard irá:');
  info(' 1. Coletar e validar credenciais Jira e GitHub');
  info(' 2. Detectar automaticamente a stack do repositório alvo');
  info(' 3. Validar conexão com Supabase e executar migrations');
  info(' 4. Validar conexão com Upstash Redis');
  info(' 5. Validar chave Anthropic e configurar modelos por agente');
  info(' 6. Configurar Betterstack (observabilidade — opcional)');
  info(' 7. Instalar o workflow de CI no repositório alvo');
  info(' 8. Registrar o webhook automático no Jira');
  info(' 9. Executar um smoke test de ponta a ponta (opcional)');
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
  const TOTAL_STEPS = 11;

  // ── Step 1: Jira ─────────────────────────────────────────────────────────

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
    if (!await confirm('Continuar mesmo assim?', false)) { closePrompts(); process.exit(1); }
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

  const githubOwner    = await ask('GITHUB_OWNER',               existing['GITHUB_OWNER'] ?? '');
  const githubRepo     = await ask('GITHUB_REPO',                existing['GITHUB_REPO'] ?? '');
  const githubAppId    = await ask('GITHUB_APP_ID',              existing['GITHUB_APP_ID'] ?? '');
  const installationId = await ask('GITHUB_APP_INSTALLATION_ID', existing['GITHUB_APP_INSTALLATION_ID'] ?? '');
  const defaultBranch  = await ask('GITHUB_DEFAULT_BRANCH',      existing['GITHUB_DEFAULT_BRANCH'] ?? 'main');

  let privateKey = existing['GITHUB_APP_PRIVATE_KEY'] ?? '';
  const keyInput = await ask(
    'GITHUB_APP_PRIVATE_KEY (caminho .pem ou inline com \\n)',
    privateKey ? '*** (manter existente)' : '',
  );
  if (keyInput && keyInput !== '*** (manter existente)') {
    privateKey = looksLikeFilePath(keyInput) ? readPemFile(keyInput) : keyInput;
  }

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
    if (!await confirm('Continuar mesmo assim?', false)) { closePrompts(); process.exit(1); }
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

  // ── Step 4: Supabase / PostgreSQL ─────────────────────────────────────────

  step(4, TOTAL_STEPS, 'Banco de dados — Supabase / PostgreSQL');

  info('Você precisará da Connection String do Supabase.');
  info('Supabase → Project Settings → Database → Connection string → URI');
  print('');

  const databaseUrl = await ask('DATABASE_URL', existing['DATABASE_URL'] ?? '');
  const supabaseUrl  = await ask('SUPABASE_URL (opcional)', existing['SUPABASE_URL'] ?? '');
  const anonKey      = await ask('SUPABASE_ANON_KEY (opcional)', existing['SUPABASE_ANON_KEY'] ?? '');
  const serviceKey   = await ask('SUPABASE_SERVICE_ROLE_KEY (opcional)', existing['SUPABASE_SERVICE_ROLE_KEY'] ?? '');

  if (databaseUrl) {
    info('Testando conexão com o banco de dados...');
    const dbResult = await validateDatabaseAccess(databaseUrl);

    if (!dbResult.ok) {
      fail(`Banco inacessível: ${dbResult.detail}`);
      if (!await confirm('Continuar mesmo assim?', false)) { closePrompts(); process.exit(1); }
      warn('Continuando sem validação do banco.');
    } else {
      ok('Conexão PostgreSQL estabelecida (SELECT 1 OK)');

      if (await confirm('Executar migrations do banco agora?', true)) {
        info('Executando migrations...');
        const migResult = await runMigrations(databaseUrl);
        if (!migResult.ok) {
          fail(`Migrations falharam: ${migResult.detail}`);
          warn('Execute manualmente: npm run migrate:run');
        } else {
          ok('Migrations aplicadas com sucesso');
        }
      } else {
        warn('Migrations puladas. Execute manualmente: npm run migrate:run');
      }
    }
  } else {
    warn('DATABASE_URL não informada — banco não configurado.');
    warn('O servidor não iniciará sem esta variável.');
  }

  if (databaseUrl)  collected['DATABASE_URL']                = databaseUrl;
  if (supabaseUrl)  collected['SUPABASE_URL']                = supabaseUrl;
  if (anonKey)      collected['SUPABASE_ANON_KEY']           = anonKey;
  if (serviceKey)   collected['SUPABASE_SERVICE_ROLE_KEY']   = serviceKey;

  // ── Step 5: Upstash Redis ─────────────────────────────────────────────────

  step(5, TOTAL_STEPS, 'Fila de jobs — Upstash Redis');

  info('Você precisará da Redis URL do Upstash.');
  info('Upstash Console → Database → REST URL → copie a Connection String (rediss://)');
  print('');

  const redisUrl = await ask('REDIS_URL', existing['REDIS_URL'] ?? '');

  if (redisUrl) {
    info('Testando conexão Redis (PING)...');
    const redisResult = await validateRedisAccess(redisUrl);

    if (!redisResult.ok) {
      fail(`Redis inacessível: ${redisResult.detail}`);
      if (!await confirm('Continuar mesmo assim?', false)) { closePrompts(); process.exit(1); }
      warn('Continuando sem validação Redis.');
    } else {
      ok('Redis respondeu PONG — BullMQ pronto');
    }

    collected['REDIS_URL'] = redisUrl;
  } else {
    warn('REDIS_URL não informada — BullMQ não funcionará sem esta variável.');
  }

  // ── Step 6: Anthropic ─────────────────────────────────────────────────────

  step(6, TOTAL_STEPS, 'Motor de IA — Anthropic API');

  info('Obtenha sua chave em: https://console.anthropic.com/settings/keys');
  print('');

  const anthropicKey = await ask('ANTHROPIC_API_KEY', existing['ANTHROPIC_API_KEY'] ?? '');

  if (anthropicKey) {
    info('Validando chave Anthropic (chamada mínima ~$0.00003)...');
    const aiResult = await validateAnthropicAccess(anthropicKey);

    if (!aiResult.ok) {
      fail(`Anthropic inacessível: ${aiResult.detail}`);
      if (!await confirm('Continuar mesmo assim?', false)) { closePrompts(); process.exit(1); }
      warn('Continuando sem validação Anthropic.');
    } else {
      ok('Chave Anthropic válida');
    }

    collected['ANTHROPIC_API_KEY'] = anthropicKey;
  } else {
    warn('ANTHROPIC_API_KEY não informada — todos os agentes falharão sem esta variável.');
  }

  print('');
  info('Configuração de modelos por agente:');
  info('Modelos disponíveis: opus (claude-opus-4-7) | sonnet (claude-sonnet-4-6) | haiku (claude-haiku-3-5)');
  info('Dica: DEV usa sonnet por padrão (melhor custo/performance para geração de código)');
  print('');

  const modelOrch = resolveModel(
    await ask('MODEL_ORCHESTRATOR', existing['MODEL_ORCHESTRATOR'] ?? MODEL_DEFAULTS['MODEL_ORCHESTRATOR']),
    MODEL_DEFAULTS['MODEL_ORCHESTRATOR'],
  );
  const modelPo   = resolveModel(
    await ask('MODEL_PO',           existing['MODEL_PO'] ?? MODEL_DEFAULTS['MODEL_PO']),
    MODEL_DEFAULTS['MODEL_PO'],
  );
  const modelLt   = resolveModel(
    await ask('MODEL_LT',           existing['MODEL_LT'] ?? MODEL_DEFAULTS['MODEL_LT']),
    MODEL_DEFAULTS['MODEL_LT'],
  );
  const modelQa   = resolveModel(
    await ask('MODEL_QA',           existing['MODEL_QA'] ?? MODEL_DEFAULTS['MODEL_QA']),
    MODEL_DEFAULTS['MODEL_QA'],
  );
  const modelDev  = resolveModel(
    await ask('MODEL_DEV',          existing['MODEL_DEV'] ?? MODEL_DEFAULTS['MODEL_DEV']),
    MODEL_DEFAULTS['MODEL_DEV'],
  );

  ok(`Modelos: Orchestrator=${modelOrch} | PO=${modelPo} | LT=${modelLt} | QA=${modelQa} | DEV=${modelDev}`);

  collected['MODEL_ORCHESTRATOR'] = modelOrch;
  collected['MODEL_PO']           = modelPo;
  collected['MODEL_LT']           = modelLt;
  collected['MODEL_QA']           = modelQa;
  collected['MODEL_DEV']          = modelDev;

  // ── Step 7: Betterstack ───────────────────────────────────────────────────

  step(7, TOTAL_STEPS, 'Observabilidade — Betterstack (opcional)');

  info('Obtenha o Source Token em: https://betterstack.com → Telemetry → Sources');
  info('Se deixado em branco, logs continuam funcionando localmente (stdout/stderr).');
  print('');

  const betterstackToken = await ask('BETTERSTACK_SOURCE_TOKEN', existing['BETTERSTACK_SOURCE_TOKEN'] ?? '');

  if (betterstackToken) {
    ok('Betterstack configurado — logs JSON serão enviados ao dashboard');
    collected['BETTERSTACK_SOURCE_TOKEN'] = betterstackToken;
  } else {
    info('Betterstack pulado — logs apenas locais (Pino stdout)');
  }

  print('');
  const devConcurrency = await ask(
    'AGENTS_DEV_CONCURRENCY (jobs paralelos)',
    existing['AGENTS_DEV_CONCURRENCY'] ?? '5',
  );
  const costAlert = await ask(
    'COST_ALERT_THRESHOLD_USD (alerta de custo por história)',
    existing['COST_ALERT_THRESHOLD_USD'] ?? '1.00',
  );

  collected['AGENTS_DEV_CONCURRENCY']   = devConcurrency || '5';
  collected['COST_ALERT_THRESHOLD_USD'] = costAlert || '1.00';

  // ── Step 8: Render — URL + variáveis de ambiente ─────────────────────────

  step(8, TOTAL_STEPS, 'Render — URL do serviço e variáveis de ambiente');

  info('Configure o Web Service no Render (https://render.com) antes de continuar.');
  info('Todas as variáveis abaixo deverão ser adicionadas em:');
  info('  Render → seu serviço → Environment → Add Environment Variable');
  print('');

  const serviceUrl = await ask('SERVICE_URL', existing['SERVICE_URL'] ?? 'https://agentic-squad.onrender.com');
  const nodeEnv    = await ask('NODE_ENV', existing['NODE_ENV'] ?? 'production');
  const port       = await ask('PORT',     existing['PORT'] ?? '3000');
  const webhookUrl = `${serviceUrl.replace(/\/$/, '')}/webhooks/jira?secret=${webhookSecret}`;

  collected['SERVICE_URL'] = serviceUrl;
  collected['NODE_ENV']    = nodeEnv;
  collected['PORT']        = port;

  // ── Revisão e coleta das variáveis do Render ──────────────────────────────
  //
  // Lista exata que o Render precisa — na mesma ordem usada no dashboard.
  // Variáveis já coletadas em steps anteriores são pré-preenchidas;
  // as ausentes são solicitadas agora.

  const RENDER_VARS: string[] = [
    'ANTHROPIC_API_KEY',
    'CI_COVERAGE_COMMAND',
    'CI_COVERAGE_THRESHOLD',
    'CI_TEST_COMMAND',
    'DATABASE_URL',
    'GITHUB_APP_ID',
    'GITHUB_APP_INSTALLATION_ID',
    'GITHUB_APP_PRIVATE_KEY',
    'GITHUB_DEFAULT_BRANCH',
    'GITHUB_OWNER',
    'GITHUB_REPO',
    'JIRA_API_TOKEN',
    'JIRA_BASE_URL',
    'JIRA_EMAIL',
    'JIRA_PROJECT_KEY',
    'JIRA_WEBHOOK_SECRET',
    'MODEL_DEV',
    'MODEL_LT',
    'MODEL_ORCHESTRATOR',
    'MODEL_PO',
    'MODEL_QA',
    'REDIS_URL',
    'SERVICE_URL',
    'SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_URL',
  ];

  // Chaves sensíveis — serão mascaradas no display
  const SENSITIVE = new Set([
    'ANTHROPIC_API_KEY', 'JIRA_API_TOKEN', 'JIRA_WEBHOOK_SECRET',
    'GITHUB_APP_PRIVATE_KEY', 'DATABASE_URL', 'REDIS_URL',
    'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY',
  ]);

  const mask = (key: string, val: string): string =>
    SENSITIVE.has(key) && val.length > 8
      ? `${val.slice(0, 6)}${'*'.repeat(6)}` : val;

  print('');
  print('  ┌─────────────────────────────────────────────────────────────┐');
  print('  │  Revisão das variáveis de ambiente do Render                │');
  print('  └─────────────────────────────────────────────────────────────┘');
  print('');

  const renderVars: Record<string, string> = {};
  let missing = 0;

  for (const key of RENDER_VARS) {
    const current = collected[key] ?? existing[key] ?? '';

    if (current) {
      // já coletada — confirma sem perguntar
      renderVars[key] = current;
      info(`✓  ${key.padEnd(34)} ${mask(key, current)}`);
    } else {
      // ausente — solicita agora
      print('');
      warn(`   ${key} — não foi informada nos steps anteriores`);
      const val = await ask(`   ${key}`, '');
      if (val) {
        renderVars[key] = val;
        collected[key]  = val;
        ok(`${key} definida`);
      } else {
        renderVars[key] = '';
        fail(`${key} ficou vazia — adicione manualmente no painel do Render`);
        missing++;
      }
    }
  }

  print('');
  if (missing > 0) {
    warn(`${missing} variável(is) ficaram vazias — complete no painel do Render antes do deploy.`);
  } else {
    ok('Todas as variáveis do Render estão preenchidas');
  }

  // Grava .env.render — bloco pronto para copiar/colar no Render
  const renderEnvPath = resolve(process.cwd(), '.env.render');
  const renderLines   = RENDER_VARS.map((k) => `${k}=${renderVars[k] ?? ''}`);
  writeFileSync(renderEnvPath, renderLines.join('\n') + '\n', 'utf-8');

  print('');
  ok(`.env.render gravado em ${renderEnvPath}`);
  info('Cole o conteúdo deste arquivo no Render → Environment → Add Environment Variable');
  info('(ou use o Render CLI: render env set --service <id> < .env.render)');
  print('');

  // Health check — feito após coleta para não bloquear o fluxo
  info('Verificando saúde do serviço...');
  const health = await checkServiceHealth(serviceUrl);

  if (!health.ok) {
    warn(`Serviço não respondeu — ${health.detail ?? 'timeout'}`);
    warn('Faça o deploy com as variáveis configuradas e execute novamente para o smoke test.');
  } else {
    ok(`Serviço respondeu: status=${health.status}`);
  }

  // ── Step 9: Instalar workflow de CI ───────────────────────────────────────

  step(9, TOTAL_STEPS, 'Instalando GitHub Actions workflow no repositório alvo');

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

  // ── Step 10: Registrar webhook no Jira ───────────────────────────────────

  step(10, TOTAL_STEPS, 'Registrando webhook no Jira');

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

  // ── Step 11: Smoke test ───────────────────────────────────────────────────

  step(11, TOTAL_STEPS, 'Smoke test (ponta a ponta)');

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
  info('3. Adicione as variáveis de ambiente no painel do Render');
  info('4. Faça deploy do serviço com as novas variáveis');
  info('5. No GitHub: Branch Protection → Require status check:');
  info('   "Lint · Typecheck · Build · Test · Coverage"');
  if (webhookRegistered) {
    info('6. Execute "npm run init" em ~30 dias para renovar o webhook dinâmico');
  }
  print('');
  print('UptimeRobot (monitoramento) — configuração manual:');
  info(`  https://uptimerobot.com → Add Monitor → HTTP → URL: ${serviceUrl}/health`);
  info('  Interval: 5 minutes | Alert: email/Slack');
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
