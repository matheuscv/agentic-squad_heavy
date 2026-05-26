# PRD — Adicionar função utilitária formatCurrency(value, currency) ao módulo src/utils/currency.ts

## Identificação
- **Jira Key**: SCRUM-16
- **Resumo**: Adicionar função utilitária formatCurrency(value, currency) ao módulo src/utils/currency.ts
- **Versão**: 1.0
- **Autor**: Agente PO (IA)
- **Data**: 2026-05-26

## Contexto
O **agentic-squad-heavy** é um sistema de desenvolvimento de software orientado a agentes de IA autônomos, orquestrados via Jira. O pipeline envolve múltiplos agentes especializados (PO, LT, DEV, QA) que produzem e consomem artefatos textuais e de código ao longo do ciclo de vida de cada história. A stack é baseada em **Node.js 22 / TypeScript 5**, com Express 5, PostgreSQL via Drizzle ORM, BullMQ e a API da Anthropic.

À medida que o sistema evolui e passa a lidar com dados financeiros — como custos de execução de agentes, tarifas de uso de APIs ou valores monetários registrados no banco de dados — surge a necessidade de exibir e formatar esses valores de forma consistente e internacionalizada. Sem uma função utilitária centralizada, cada parte do código que precise exibir valores monetários implementará sua própria lógica de formatação, gerando inconsistências visuais, riscos de erros e dificuldade de manutenção.

A criação do módulo `src/utils/currency.ts` com a função `formatCurrency(value, currency)` estabelece uma camada de utilitários financeiros padronizada para o projeto, seguindo o mesmo padrão organizacional já adotado para logs (`src/lib/logger.ts`) e demais módulos utilitários. Isso garante que toda representação monetária no sistema seja gerada por uma única fonte de verdade, reutilizável por agentes, rotas HTTP, workers e qualquer outro componente da aplicação.

## Problema
O projeto não possui uma função centralizada para formatação de valores monetários. Isso expõe o sistema ao risco de formatações inconsistentes, não-internacionalizadas e difíceis de manter à medida que o produto cresce e passa a exibir ou registrar dados financeiros em múltiplas partes da aplicação.

## Objetivos
- **OBJ-01**: Disponibilizar a função `formatCurrency(value, currency)` no módulo `src/utils/currency.ts`, cobrindo ao menos 3 moedas distintas (ex.: BRL, USD, EUR), eliminando 100% da necessidade de lógica de formatação monetária inline em outros módulos.
- **OBJ-02**: Garantir cobertura de testes unitários de no mínimo 90% (branches + statements) para o módulo `src/utils/currency.ts`, executados via Vitest, integrados ao pipeline de qualidade existente.

## Escopo
Esta entrega cobre a criação do arquivo `src/utils/currency.ts` contendo a função exportada `formatCurrency(value, currency)`, utilizando a API nativa `Intl.NumberFormat` do Node.js 22 para formatação internacionalizada. Inclui também a criação dos testes unitários correspondentes em Vitest, cobrindo casos de uso essenciais (valores positivos, negativos, zero, diferentes moedas). A função deve ser tipada em TypeScript, com assinatura clara e exportação nomeada.

## Fora de Escopo
- Criação de outros utilitários financeiros além de `formatCurrency` (ex.: conversão de moedas, parsing de strings monetárias)
- Integração com APIs externas de câmbio ou cotação de moedas
- Alteração de componentes existentes para consumir a nova função (refatoração de callers)
- Criação de endpoints HTTP específicos para formatação de moeda
- Internacionalização (i18n) de outros módulos da aplicação além do utilitário de moeda

## Requisitos Funcionais

| ID | Requisito | Prioridade |
|----|-----------|------------|
| RF-01 | A função `formatCurrency(value: number, currency: string): string` deve ser exportada nominalmente pelo módulo `src/utils/currency.ts` e retornar uma string formatada segundo o padrão `Intl.NumberFormat` do Node.js, respeitando o locale associado à moeda informada. | Must Have |
| RF-02 | A função deve suportar ao menos as moedas BRL (Real Brasileiro), USD (Dólar Americano) e EUR (Euro), retornando o símbolo, separadores decimais e de milhar corretos para cada uma. | Must Have |
| RF-03 | A função deve tratar corretamente valores extremos: zero (`0`), valores negativos e números de ponto flutuante com mais de 2 casas decimais (arredondando conforme padrão ISO 4217 da moeda). | Must Have |
| RF-04 | Caso o parâmetro `currency` receba um código de moeda inválido ou não reconhecido pelo `Intl.NumberFormat`, a função deve lançar um `Error` com mensagem descritiva, evitando falhas silenciosas. | Should Have |
| RF-05 | O módulo deve exportar um tipo TypeScript `CurrencyCode` (union type ou enum) listando os códigos de moeda suportados oficialmente, promovendo type-safety nos pontos de chamada. | Should Have |
| RF-06 | A suíte de testes unitários (arquivo `src/utils/currency.test.ts` ou equivalente) deve cobrir: formatação correta de BRL, USD e EUR; comportamento com valor zero; valor negativo; valor com casas decimais excedentes; e lançamento de erro para moeda inválida. | Must Have |

## Critérios de Aceite

- **CA-01**: Dado que o módulo `src/utils/currency.ts` foi importado, quando a função `formatCurrency(1234.5, 'BRL')` é invocada, então o retorno deve ser a string `"R$ 1.234,50"` (ou equivalente exato do `Intl.NumberFormat` com locale `pt-BR`).
- **CA-02**: Dado que a função é chamada com `formatCurrency(9999.99, 'USD')`, quando o resultado é avaliado, então deve retornar a string `"$9,999.99"` (ou equivalente exato do `Intl.NumberFormat` com locale `en-US`), sem nenhum arredondamento indevido.
- **CA-03**: Dado que a função é chamada com `formatCurrency(-500, 'EUR')`, quando o resultado é avaliado, então deve retornar a representação negativa correta no formato europeu (ex.: `"-€500.00"` ou equivalente do `Intl.NumberFormat` com locale `de-DE` ou `fr-FR`), indicando visualmente que o valor é negativo.
- **CA-04**: Dado que a função é chamada com `formatCurrency(0, 'BRL')`, quando o resultado é avaliado, então deve retornar `"R$ 0,00"` (ou equivalente), sem erros ou retorno de string vazia.
- **CA-05**: Dado que a função é chamada com um código de moeda inválido, como `formatCurrency(100, 'XYZ')`, quando o `Intl.NumberFormat` não reconhece o código, então a função deve lançar uma instância de `Error` com mensagem contendo o código inválido (ex.: `"Moeda inválida: XYZ"`), e nenhuma string de formatação deve ser retornada.
- **CA-06**: Dado que o comando `npm run test:coverage` é executado, quando o Vitest processa `src/utils/currency.ts`, então o relatório de cobertura v8 deve indicar ≥ 90% de statements e ≥ 90% de branches cobertos para esse arquivo.

## Riscos

| ID | Risco | Probabilidade | Impacto | Mitigação |
|----|-------|--------------|---------|-----------|
| R-01 | O comportamento exato de `Intl.NumberFormat` pode variar entre versões do Node.js ou entre ambientes (CI vs. Render free tier), causando falhas intermitentes nos testes que validam strings formatadas literalmente. | Média | Médio | Fixar a versão do Node.js em `.nvmrc` (Node 22 LTS) e, nos testes, validar a estrutura da string (presença do símbolo, separadores corretos) em vez de igualdade literal exata, ou usar `toLocaleString` como oráculo de comparação no próprio teste. |
| R-02 | O escopo reduzido da história pode levar o time a não documentar a função com JSDoc, dificultando o reuso futuro pelos agentes DEV e QA que consomem artefatos gerados automaticamente. | Média | Baixo | Incluir no Definition of Done a exigência de ao menos um bloco JSDoc com `@param`, `@returns` e `@throws` na assinatura da função. |
| R-03 | A ausência de um `CurrencyCode` tipado pode resultar em callers passando strings arbitrárias em tempo de compilação, contornando a validação em runtime e propagando erros para produção. | Baixa | Alto | Tornar o tipo `CurrencyCode` obrigatório na assinatura da função (RF-05) e configurar o compilador TypeScript em modo `strict` para rejeitar strings não tipadas. |

## Referências
- Jira: SCRUM-16