# Pedido de Correção — Iteração 1/3
## Problema detectado
O CI está falhando (conclusion: 'failure') e ambos os arquivos-fonte do PR têm cobertura 0%, indicando que os testes não estão sendo executados corretamente.

**Arquivos afetados:**
- `src/routes/ping.ts` → 0% em todas as métricas (statements, branches, functions, lines)
- `src/index.ts` → 0% em todas as métricas

**Possíveis causas a investigar e corrigir:**

1. **`src/index.ts`**: Este arquivo importa diretamente `pg`, `ioredis`, `bullmq`, workers, orchestrators, e faz conexões reais ao banco/Redis ao ser carregado. Isso provavelmente faz o CI falhar por ausência de variáveis de ambiente (DATABASE_URL, REDIS_URL) ou por tentativas de conexão que dão timeout. O arquivo precisa ser refatorado para que as conexões e inicializações sejam feitas em uma função `bootstrap()` exportada separadamente, e o `app.listen()` seja chamado apenas quando `require.main === module` (ou `import.meta.url === ...`), permitindo que o módulo seja importado em testes sem efeitos colaterais.

2. **`src/routes/ping.test.ts`**: Os testes de `ping.ts` estão bem escritos, mas o mock de `../lib/logger` pode não estar sendo aplicado corretamente antes do import do módulo. Verifique se `vi.mock('../lib/logger', ...)` está posicionado corretamente no topo do arquivo de teste (já parece estar, mas confirme).

3. **Erros de compilação TypeScript**: Verifique se há erros de tipagem que impedem a execução dos testes.

**O que o DEV deve fazer:**
- Inspecionar os logs de erro do CI para identificar exatamente qual teste/arquivo está causando a falha
- Refatorar `src/index.ts` para separar a configuração do app Express da inicialização das conexões externas (DB, Redis, BullMQ workers), garantindo que o módulo possa ser importado sem side-effects em ambiente de teste
- Garantir que `src/routes/ping.ts` e seu teste passem com 100% de cobertura após a correção
- Garantir que os mocks de todas as dependências externas em `src/index.ts` estejam configurados no vitest.config.ts ou nos arquivos de setup de teste
## Arquivos com problemas
- `src/index.ts`
- `src/routes/ping.ts`
- `src/routes/ping.test.ts`
## Testes falhando
- src/routes/ping.test.ts — todos os testes (cobertura 0%, CI falhou)
## Cobertura insuficiente
```json
{
  "src/routes/ping.ts": {
    "statements": 0,
    "branches": 0,
    "functions": 0,
    "lines": 0
  },
  "src/index.ts": {
    "statements": 0,
    "branches": 0,
    "functions": 0,
    "lines": 0
  }
}
```
---
_Gerado pelo Agente QA em 2026-05-28T12:25:01.553Z_