# COST_GUIDE — Guia de Custos

Referência completa para entender, monitorar e controlar o custo de tokens dos agentes.

---

## Tabela de Preços por Modelo

| Modelo | Input (por 1M tokens) | Output (por 1M tokens) | Uso típico |
|---|---|---|---|
| `claude-opus-4-7` | USD 15,00 | USD 75,00 | PO, LT, DEV, QA (padrão) |
| `claude-sonnet-4-6` | USD 3,00 | USD 15,00 | Alternativa de menor custo |
| `claude-haiku-4-5-20251001` | USD 0,25 | USD 1,25 | Tarefas simples, rascunhos |

> Preços de referência em 2026-05-28. Consulte [anthropic.com/pricing](https://www.anthropic.com/pricing) para valores atualizados.

---

## Custo Estimado por História

Baseado em medições reais do projeto `SCRUM` (histórias médias, ~500 linhas de código):

| Agente | Tokens entrada | Tokens saída | Custo estimado |
|---|---|---|---|
| Orchestrator | ~2.000 | ~500 | ~USD 0,007 |
| PO (PRD.md) | ~8.000 | ~3.000 | ~USD 0,345 |
| LT (PLANO) | ~12.000 | ~4.000 | ~USD 0,480 |
| DEV (código) | ~25.000 | ~8.000 | ~USD 0,975 |
| QA (testes) | ~20.000 | ~6.000 | ~USD 0,750 |
| **Total (sem correção)** | **~67.000** | **~21.500** | **~USD 2,56** |
| DEV correction ×1 | +~15.000 | +~5.000 | +~USD 0,600 |
| DEV correction ×2 | +~30.000 | +~10.000 | +~USD 1,200 |

---

## Consultando Custos via API

### Custo total e por agente

```bash
curl https://<host>/metrics/cost
```

```json
{
  "summary": {
    "totalInputTokens": 184320,
    "totalOutputTokens": 42100,
    "totalCostUsd": 0.312845
  },
  "byAgent": {
    "po":  { "costUsd": 0.045, "runs": 3 },
    "lt":  { "costUsd": 0.062, "runs": 3 },
    "dev": { "costUsd": 0.148, "runs": 8 },
    "qa":  { "costUsd": 0.057, "runs": 4 }
  },
  "byStory": [
    { "jiraKey": "SCRUM-17", "costUsd": 0.089, "runs": 5 },
    { "jiraKey": "SCRUM-18", "costUsd": 0.073, "runs": 4 }
  ]
}
```

### Custo por projeto (multi-project)

```bash
# Via psql direto (ou Drizzle Studio)
SELECT project_key, 
       ROUND(SUM(ar.cost_usd)::numeric, 4) AS total_usd,
       COUNT(DISTINCT s.id) AS stories
FROM agent_runs ar
JOIN stories s ON ar.story_id = s.id
GROUP BY project_key
ORDER BY total_usd DESC;
```

---

## Alertas de Custo

### Configurar threshold por história

```bash
# No .env ou variável de ambiente Render
COST_ALERT_THRESHOLD_USD=2.00
```

Quando o custo acumulado de **uma história** ultrapassa esse valor:
1. Log estruturado com `event: cost_threshold_exceeded` e `projectKey`
2. Alerta HTTP para o Betterstack com todos os detalhes
3. Comentário automático na issue Jira com o valor atual e o threshold

### Onde ver os alertas

- **Betterstack**: filtrar por `event = "cost_threshold_exceeded"`
- **Jira**: comentário `⚠️ Alerta de Custo — Squad Agêntica` na issue afetada
- **Logs**: `grep '"event":"cost_threshold_exceeded"'`

---

## Estratégias de Redução de Custo

### 1. Trocar modelo para histórias simples

```bash
# No .env
AGENTS_MODEL_DEFAULT=claude-sonnet-4-6   # 5× mais barato que Opus
AGENTS_MODEL_FAST=claude-haiku-4-5-20251001  # 60× mais barato que Opus
```

**Impacto esperado:** 60–80% de redução de custo com qualidade ligeiramente menor em histórias complexas.

### 2. Reduzir loops de correção QA → DEV

O loop de correção representa 20–40% do custo total quando ativado. Causas comuns:

- CI com testes instáveis (flaky) → corrigir o CI antes do onboarding
- Threshold de cobertura muito alto → reduzir `CI_COVERAGE_THRESHOLD`
- Código legado com baixa cobertura inicial → aumentar gradualmente

```bash
# Reduzir threshold para projetos em transição
CI_COVERAGE_THRESHOLD=70
```

### 3. Limitar concorrência de DEVs

Mais concorrência = mais histórias em paralelo = mais custo simultâneo. Ajuste conforme o orçamento mensal:

```bash
AGENTS_DEV_CONCURRENCY=2   # padrão: 5
```

### 4. Usar cache de prompt (Anthropic)

Para prompts de sistema longos (DEV, QA), o cache de prompt da Anthropic reduz tokens de entrada repetidos em ~90%. Ativado automaticamente via `cache_control: { type: "ephemeral" }` nos system prompts.

---

## Orçamento Mensal — Estimativas

Baseado em 1 história/dia útil (20 histórias/mês), sem loops de correção:

| Modelo | Custo/história | Custo mensal (20 histórias) |
|---|---|---|
| Opus 4.7 (padrão) | ~USD 2,56 | ~USD 51,00 |
| Sonnet 4.6 | ~USD 0,51 | ~USD 10,20 |
| Haiku 4.5 | ~USD 0,04 | ~USD 0,85 |
| Opus + 1 correção | ~USD 3,16 | ~USD 63,20 |

---

## Monitoramento Contínuo

### Dashboard recomendado (Betterstack)

Criar dashboard com os seguintes widgets:

1. **Custo acumulado do mês** — query: `event = "agent_completed"`, soma `tokenCostUsd`
2. **Alertas de threshold** — filtro: `event = "cost_threshold_exceeded"`
3. **Custo por projeto** — group by `projectKey`
4. **Média de custo por agente** — group by `agent`

### Alerta proativo de custo mensal

Adicionar cron no Betterstack ou script externo para consultar `GET /metrics/cost` uma vez por dia e alertar se `summary.totalCostUsd` ultrapassar o budget mensal definido.

```bash
# Exemplo: alerta se custo total > USD 50
COST=$(curl -s https://<host>/metrics/cost | jq '.summary.totalCostUsd')
if (( $(echo "$COST > 50" | bc -l) )); then
  echo "⚠️ Custo mensal USD $COST excedeu USD 50"
fi
```
