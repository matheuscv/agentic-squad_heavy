# Pedido de Correção — Iteração 3/3
## Problema detectado
O CI falha após 2 ciclos de correção com cobertura 0% em ambos os arquivos do PR (src/index.ts e src/routes/ping.ts). Há dois problemas críticos que impedem os testes de rodar:

1. **`src/index.ts` não exporta `app`**: O arquivo declara `const app = express()` mas não possui `export { app }` nem `export const app`. O arquivo `src/index.test.ts` tenta importar `{ app, bootstrap }` de './index', mas sem o export de `app`, o módulo retorna `undefined` para `app`, causando falha silenciosa nos testes. 

   **Correção necessária**: Adicionar `export { app }` logo após a declaração `const app = express()`, ou transformar em `export const app = express()`. O arquivo já exporta corretamente `bootstrap` com `export async function bootstrap()`.

2. **Top-level side-effects ainda presentes**: As linhas no topo de `src/index.ts`:
   ```ts
   import { config } from 'dotenv';
   config();
   import { setDefaultResultOrder } from 'dns';
   setDefaultResultOrder('ipv4first');
   ```
   São executadas no momento do import (mesmo com vi.mock), o que pode causar erros no ambiente de teste CI.

   **Correção necessária**: Mover `config()` e `setDefaultResultOrder('ipv4first')` para dentro da função `bootstrap()`.

Por favor, aplique APENAS essas duas correções em `src/index.ts` sem alterar nenhum outro arquivo de produção.",
<parameter name="files_with_issues">["src/index.ts"]
## Testes falhando
- src/index.test.ts — todos os testes falham porque app é undefined
- src/routes/ping.test.ts — cobertura 0%
## Cobertura insuficiente
```json
{
  "src/index.ts": {
    "statements": 0,
    "branches": 0,
    "functions": 0,
    "lines": 0
  },
  "src/routes/ping.ts": {
    "statements": 0,
    "branches": 0,
    "functions": 0,
    "lines": 0
  }
}
```
---
_Gerado pelo Agente QA em 2026-05-28T12:44:19.396Z_