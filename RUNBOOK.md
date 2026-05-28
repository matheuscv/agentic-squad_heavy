# RUNBOOK — agentic-squad-heavy

Guia operacional para quem está de plantão. Cobre alertas, incidentes, deploy, rollback e tarefas de manutenção rotineiras.

---

## Saúde do Sistema

### Verificação rápida

```bash
# Status básico (DB + Redis)
curl https://<seu-host>/health

# Status completo (filas BullMQ + métricas)
curl https://<seu-host>/health/detailed
```

Respostas esperadas:

| Campo `status` | Significado | Ação |
|---|---|---|
| `ok` | Tudo saudável | Nenhuma |
| `degraded` | DB ou Redis inacessível | Ver §Incidentes de Infraestrutura |
| `attention` | DLQ com jobs aguardando | Ver §DLQ — Dead Letter Queue |

### Logs em tempo real (Render)

```bash
# Via CLI do Render
render logs --service agentic-squad-heavy --tail

# Filtrar por projeto específico
render logs --service agentic-squad-heavy --tail | grep '"projectKey":"SCRUM"'

# Filtrar apenas erros de agente
render logs --service agentic-squad-heavy --tail | grep '"event":"agent_failed"'
```

### Logs localmente legíveis

```bash
npm run dev | npx pino-pretty --colorize
```

---

## Alertas Betterstack

### Alertas ativos

| Evento | Gatilho | Ação imediata |
|---|---|---|
| `cost_threshold_exceeded` | Custo da história > `COST_ALERT_THRESHOLD_USD` | Ver §Controle de Custos |
| `agent_failed` | Agente esgotou todas as tentativas (retry) | Ver §Agente Travado |
| `DLQ com jobs` | `/health/detailed` mostra `agent-dlq.waiting > 0` | Ver §DLQ |

---

## Incidentes Frequentes

### Agente Travado (job stuck)

**Sintoma:** História parada no mesmo status há mais de 30 min; sem logs de progresso.

```bash
# 1. Ver jobs ativos por fila
npm run list-jobs

# 2. Identificar o jobId do job preso
curl https://<host>/health/detailed | jq '.checks.queues'

# 3. Matar jobs travados (use com cuidado)
npm run kill-jobs
```

Se o job estava em `Em Desenvolvimento` ou `Em QA`, o Reconciler detectará a divergência e reenfileirará automaticamente em até 90 segundos.

---

### DLQ — Dead Letter Queue

Jobs no DLQ esgotaram todas as tentativas (`attempts` configurado por fila). Requerem atenção manual.

```bash
# Ver quantidade de jobs na DLQ
curl https://<host>/health/detailed | jq '.checks.queues["agent-dlq"]'
```

**Causas comuns:**

| Causa | Diagnóstico | Correção |
|---|---|---|
| Timeout da API Anthropic | Log com `err: "Request timed out"` | Aumentar `AGENTS_TIMEOUT_AGENT_MS` |
| CI do repositório quebrado | Log com `conclusion: "failure"` | Corrigir o CI no repo alvo |
| GitHub rate limit | Log com `err: "secondary rate limit"` | Aguardar reset (1h) ou reduzir `AGENTS_DEV_CONCURRENCY` |
| Jira inacessível | Log com `err: "401"` ou `"403"` | Renovar `JIRA_API_TOKEN` |

**Re-processar um job da DLQ:**

Mova o card da história no Jira de volta para o status anterior e avance novamente. O Reconciler detectará e reenfileirará.

---

### Banco de Dados Inacessível

```bash
# Testar conexão direta
psql $DATABASE_URL -c "SELECT 1"

# Se Supabase estiver fora: verificar status em
# https://status.supabase.com
```

A aplicação volta a funcionar automaticamente assim que o banco se recuperar. Jobs pendentes no Redis são preservados.

---

### Redis Inacessível

```bash
# Testar via ioredis
node -e "const IORedis=require('ioredis'); const r=new IORedis(process.env.REDIS_URL); r.ping().then(console.log)"
```

Se Upstash estiver fora: verificar `https://status.upstash.com`. Jobs em execução no momento serão reenfileirados automaticamente no próximo restart.

---

### Webhook Jira não chega

**Verificar em ordem:**

1. URL do webhook no Jira: `Jira Admin → System → WebHooks`
   - Deve apontar para `https://<host>/webhooks/jira?secret=<JIRA_WEBHOOK_SECRET>`
   - Evento configurado: `jira:issue_updated`
   - Filtro JQL: `project = "<JIRA_PROJECT_KEY>"`

2. Secret correto:
   ```bash
   # Verificar que o secret bate com o .env
   curl -X POST "https://<host>/webhooks/jira?secret=VALOR_ERRADO" \
     -H "Content-Type: application/json" -d '{}'
   # Resposta esperada: 401 unauthorized
   ```

3. Webhooks dinâmicos do Jira expiram em **30 dias**. Re-registrar:
   ```bash
   npm run init
   # O wizard re-registra o webhook no Step 6
   ```

---

## Deploy e Rollback

### Deploy padrão

```bash
# Deploy para produção via CLI do Render
npm run render:deploy
```

O Render executa `npm run build && npm start`. O servidor implementa **graceful shutdown**: drena jobs ativos em até 30 segundos antes de trocar a instância.

### Rollback

```bash
# Via dashboard Render: Deployments → selecionar deploy anterior → Rollback
# Ou via CLI:
render deploys rollback --service agentic-squad-heavy --deployment <deploy-id>
```

### Migrações de schema

**Sempre verificar antes de aplicar em produção:**

```bash
# 1. Ver o que está pendente
agentic-squad migrate status

# 2. Pré-visualizar SQL
agentic-squad migrate dry-run

# 3. Verificar operações destrutivas
agentic-squad migrate check

# 4. Aplicar (bloqueia em destrutivas sem --force)
agentic-squad migrate run
```

**Se a migração falhar em produção:** o Drizzle usa transações atômicas por statement. Verifique o log de erro, corrija o SQL e re-aplique.

---

## Onboarding de Novo Projeto (< 10 minutos)

```
Tempo estimado por step:
  Step 1 — Jira credentials    : ~1 min
  Step 2 — GitHub App           : ~2 min
  Step 3 — Detecção de stack   : ~30 seg (automático)
  Step 4 — URL do serviço      : ~30 seg
  Step 5 — Instalar workflow CI : ~30 seg (automático)
  Step 6 — Registrar webhook   : ~30 seg (automático)
  Step 7 — Smoke test          : ~2 min
  ─────────────────────────────────────────────────────
  Total                        : ~7 minutos
```

```bash
# Para adicionar um segundo projeto (ex: PROJ) à mesma instância:
# 1. Criar um novo .env para o projeto
cp .env .env.proj

# 2. Editar JIRA_PROJECT_KEY e GITHUB_REPO no novo arquivo
# 3. Rodar o wizard com o novo env
DOTENV_CONFIG_PATH=.env.proj agentic-squad init

# 4. O motor não precisa de alteração — projectKey isola tudo
```

---

## Tarefas de Manutenção

### Renovar webhook Jira (expiram em 30 dias)

```bash
agentic-squad init
# O wizard detecta o webhook existente e o renova
```

### Atualizar tokens de API

1. Gerar novo token em `id.atlassian.com` ou `console.anthropic.com`
2. Atualizar no Render: `Dashboard → Environment → JIRA_API_TOKEN`
3. Fazer novo deploy para aplicar

### Gerar changelog antes de um release

```bash
agentic-squad changelog --dry-run    # pré-visualizar
agentic-squad changelog               # gravar em CHANGELOG.md
git add CHANGELOG.md && git commit -m "chore: atualiza changelog para v$(node -p "require('./package.json').version")"
```

### Monitorar custo mensal

```bash
curl https://<host>/metrics/cost | jq '.summary'
```

Ver `COST_GUIDE.md` para interpretação detalhada e estratégias de otimização.

---

## Checklist de Plantão Diário

- [ ] `GET /health` retorna `status: ok`
- [ ] `GET /health/detailed` mostra `agent-dlq.waiting: 0`
- [ ] Nenhum alerta `cost_threshold_exceeded` não investigado no Betterstack
- [ ] Webhooks Jira ativos (verificar data de expiração — 30 dias)
- [ ] `GET /metrics` — taxa de sucesso por agente ≥ 90%
