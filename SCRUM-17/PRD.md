# PRD — Adicionar função utilitária formatCurrency ao módulo src/utils/currency.ts

## Identificação
- **Jira Key**: SCRUM-17
- **Resumo**: Adicionar função utilitária formatCurrency ao módulo src/utils/currency.ts
- **Versão**: 1.0
- **Autor**: Agente PO (IA)
- **Data**: 2026-05-27

## Contexto
O sistema **agentic-squad-heavy** é uma plataforma B2B SaaS de desenvolvimento de software orientado a agentes de IA autônomos, construída em Node.js 22 com TypeScript 5. O pipeline orquestra agentes (PO → LT → DEV → QA) com gates de aprovação humana entre cada etapa, persistindo artefatos no GitHub e rastreando o ciclo de vida via Jira.

À medida que o produto evolui e passa a exibir valores monetários em interfaces, logs, relatórios e comentários automáticos gerados pelos agentes (por exemplo, estimativas de custo de chamadas à API da Anthropic, cobranças de uso, dashboards financeiros), torna-se essencial garantir que esses valores sejam formatados de forma consistente e correta em toda a base de código.

Atualmente, a formatação de valores monetários é feita de forma ad hoc — cada módulo que precisa exibir um valor de moeda aplica sua própria lógica inline, resultando em inconsistências de locale, símbolo de moeda e casas decimais. Isso gera risco de dados mal formatados sendo expostos em comentários do Jira, logs Pino e respostas de API, comprometendo a confiabilidade percebida da plataforma.

A criação de um módulo centralizado `src/utils/currency.ts` com a função `formatCurrency` elimina essa dispersão, oferece um contrato tipado e testável, e estabelece o padrão de utilitários reutilizáveis que o time de agentes poderá consumir de forma segura.

## Problema
Não existe uma função utilitária centralizada e padronizada para formatar valores monetários no repositório. A ausência desse utilitário força cada módulo a reimplementar lógica de formatação de forma inconsistente, introduzindo divergências de locale, símbolo e precisão numérica que afetam a qualidade dos artefatos gerados pelos agentes e a integridade das saídas exibidas ao usuário.

## Objetivos
- **OBJ-01**: Disponibilizar a função `formatCurrency` no módulo `src/utils/currency.ts`, exportada e tipada em TypeScript 5, com suporte a pelo menos 3 combinações de moeda/locale (ex.: BRL/pt-BR, USD/en-US, EUR/de-DE) sem nenhum erro de compilação no build de produção.
- **OBJ-02**: Atingir cobertura de testes unitários de 100% de branches e linhas para o módulo `src/utils/currency.ts`, validada pelo relatório Vitest + v8 coverage, garantindo que todos os cenários de entrada (valores positivos, negativos, zero e inválidos) sejam cobertos.

## Escopo
Esta entrega contempla exclusivamente a criação do arquivo `src/utils/currency.ts` com a implementação da função `formatCurrency`, a exportação correta do módulo, os testes unitários correspondentes (ex.: `src/utils/currency.test.ts` ou equivalente na estrutura de testes do projeto) e a documentação inline (JSDoc) da função. Inclui também a integração passiva com os módulos existentes, no sentido de que a função estará disponível para importação — sem, contudo, refatorar código legado nesta entrega.

## Fora de Escopo
- Refatoração ou substituição de formatações de moeda já existentes em outros módulos do repositório
- Criação de outros utilitários monetários (ex.: parseCurrency, convertCurrency, cálculo de taxas de câmbio)
- Integração com APIs externas de câmbio ou serviços de localização dinâmica
- Exposição de endpoint REST para formatação de moeda
- Internacionalização (i18n) de outros campos além de valores monetários
- Alterações no schema do banco de dados (Drizzle/PostgreSQL)

## Requisitos Funcionais
| ID | Requisito | Prioridade |
|----|-----------|------------|
| RF-01 | A função `formatCurrency(value: number, currency: string, locale: string): string` deve ser implementada e exportada nominalmente a partir de `src/utils/currency.ts`, recebendo o valor numérico, o código ISO 4217 da moeda e o locale BCP 47, retornando a string formatada. | Must Have |
| RF-02 | A formatação deve utilizar a API nativa `Intl.NumberFormat` do Node.js 22, garantindo precisão de 2 casas decimais por padrão e comportamento correto de agrupamento de milhares conforme o locale informado. | Must Have |
| RF-03 | A função deve suportar obrigatoriamente as combinações BRL/pt-BR, USD/en-US e EUR/de-DE, retornando os símbolos e formatos corretos para cada par (ex.: `R$ 1.234,56`, `$1,234.56`, `1.234,56 €`). | Must Have |
| RF-04 | A função deve tratar entradas inválidas de forma segura: valores `NaN`, `Infinity` e `-Infinity` devem lançar um `TypeError` com mensagem descritiva em vez de retornar strings corrompidas. | Must Have |
| RF-05 | O módulo deve ser totalmente tipado em TypeScript 5, sem uso de `any`, e compilar sem erros ou warnings com as configurações `strict` já existentes no projeto. | Must Have |
| RF-06 | A função deve aceitar um parâmetro opcional `fractionDigits: number` (padrão: `2`) para permitir formatação com precisão customizada (ex.: 0 casas para exibição arredondada, 4 casas para cálculos de alta precisão). | Should Have |
| RF-07 | Deve existir um arquivo de testes unitários cobrindo: valor positivo, valor negativo, valor zero, valor com fracionDigits customizado, e cada uma das 3 combinações obrigatórias de moeda/locale, além dos casos de erro com entradas inválidas. | Must Have |
| RF-08 | A função deve possuir documentação JSDoc completa, incluindo descrição, `@param`, `@returns`, `@throws` e pelo menos um `@example` por caso de uso principal. | Should Have |

## Critérios de Aceite
- **CA-01**: Dado que o módulo `src/utils/currency.ts` existe e está corretamente exportado, quando um agente ou módulo interno importar `formatCurrency` e chamar `formatCurrency(1234.56, 'BRL', 'pt-BR')`, então a função deve retornar exatamente a string `'R$\u00a01.234,56'` (ou equivalente conforme `Intl.NumberFormat` do Node.js 22), sem erros de compilação TypeScript.
- **CA-02**: Dado que a função é chamada com a combinação `formatCurrency(1234.56, 'USD', 'en-US')`, quando o valor é um número positivo finito, então o retorno deve ser `'$1,234.56'`, confirmando o agrupamento de milhares com vírgula e separador decimal com ponto.
- **CA-03**: Dado que a função recebe um valor inválido como `NaN` ou `Infinity`, quando `formatCurrency` é invocada com esses argumentos, então um `TypeError` deve ser lançado com mensagem contendo a descrição do valor inválido, e nenhuma string deve ser retornada.
- **CA-04**: Dado que o relatório de cobertura é gerado via `npm run test:coverage`, quando o módulo `src/utils/currency.ts` for analisado pelo Vitest + v8, então as métricas de **lines**, **functions** e **branches** devem estar todas em **100%** para esse arquivo.
- **CA-05**: Dado que o parâmetro opcional `fractionDigits` é omitido na chamada, quando `formatCurrency(1000, 'USD', 'en-US')` é executada, então o retorno deve conter exatamente 2 casas decimais (`'$1,000.00'`), confirmando o valor padrão do parâmetro opcional.
- **CA-06**: Dado que o parâmetro `fractionDigits: 0` é explicitamente informado, quando `formatCurrency(1234.56, 'USD', 'en-US', 0)` é chamada, então o retorno deve ser `'$1,235'`, confirmando arredondamento sem casas decimais.

## Riscos
| ID | Risco | Probabilidade | Impacto | Mitigação |
|----|-------|--------------|---------|-----------|
| R-01 | O comportamento de `Intl.NumberFormat` pode diferir sutilmente entre versões do Node.js (ex.: espaço narrow no símbolo de moeda em pt-BR), causando falha nos testes ao comparar strings exatas em diferentes ambientes de CI. | Média | Médio | Fixar a versão do Node.js em `22.x` no ambiente de CI/CD (Render) e usar `toContain` ou normalização de caracteres Unicode nos asserts críticos, em vez de `toBe` com string literal exata. |
| R-02 | A adição do novo módulo sem refatorar os pontos de uso existentes pode gerar duplicidade de lógica temporária, com desenvolvedores continuando a usar formatações inline por desconhecimento da nova utilidade. | Alta | Baixo | Incluir referência ao módulo no README interno do diretório `src/utils/` e comunicar a disponibilidade da função no comentário da transição de status da história no Jira. |
| R-03 | Parâmetros de locale ou código de moeda inválidos passados pelo chamador (ex.: locale `'xx-XX'` não suportado) podem gerar exceções não tratadas propagadas silenciosamente em produção. | Baixa | Alto | Implementar validação defensiva do locale e do código de moeda na entrada da função, lançando `RangeError` com mensagem clara antes de delegar ao `Intl.NumberFormat`. |

## Referências
- Jira: SCRUM-17