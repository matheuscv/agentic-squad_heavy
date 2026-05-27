# PRD — Adicionar função utilitária formatBytes(bytes, decimals?) ao módulo src/utils/bytes.ts

## Identificação
- **Jira Key**: SCRUM-19
- **Resumo**: Adicionar função utilitária `formatBytes(bytes, decimals?)` ao módulo `src/utils/bytes.ts`
- **Versão**: 1.0
- **Autor**: Agente PO (IA)
- **Data**: 2026-05-27

## Contexto
O **Squad Agêntica** é um sistema B2B SaaS que orquestra agentes de IA autônomos (PO, LT, DEV, QA) para automatizar o pipeline de desenvolvimento de software. A plataforma processa histórias do Jira e gera artefatos commitados diretamente no GitHub, transitando por gates humanos de aprovação. O backend é construído em **Node.js 22 / TypeScript 5** com Express 5, BullMQ, Redis e PostgreSQL, e adota Vitest como framework de testes com cobertura v8.

O projeto já possui um padrão consolidado de funções utilitárias tipadas e documentadas — exemplificado pelo módulo `src/utils/date.ts` e sua função `formatDate`, descrita no glossário oficial. Esse padrão estabelece contratos claros de assinatura, tratamento de erros com `TypeError`, testes unitários e re-exportação centralizada via `src/utils/index`.

Em diversas etapas do pipeline — logs de execução de agentes, monitoramento de tamanho de artefatos commitados e rastreamento de payloads trafegados — surgem valores numéricos brutos em bytes que precisam ser apresentados de forma legível para operadores humanos e interfaces de monitoramento. Atualmente não existe utilitário padronizado para essa conversão, forçando cada módulo a implementar sua própria lógica ad hoc ou a exibir valores brutos ininteligíveis.

A criação do módulo `src/utils/bytes.ts` com a função `formatBytes` segue diretamente o padrão arquitetural já adotado no projeto, unificando essa responsabilidade em um único ponto reutilizável, testável e documentado, alinhado à linguagem ubíqua registrada no glossário da squad.

## Problema
Não existe no projeto uma função utilitária centralizada e tipada para formatar valores numéricos de bytes em representações legíveis por humanos (ex.: `1024` → `"1 KB"`). Isso leva a implementações duplicadas e inconsistentes em diferentes módulos, dificultando manutenção e aumentando a superfície de bugs quando esses valores precisam ser exibidos em logs estruturados, comentários no Jira ou interfaces de monitoramento.

## Objetivos
- **OBJ-01**: Disponibilizar a função `formatBytes` em `src/utils/bytes.ts` e re-exportá-la via `src/utils/index`, de modo que 100% dos módulos do projeto passem a consumir uma única implementação centralizada de formatação de bytes.
- **OBJ-02**: Garantir cobertura de testes unitários ≥ 90% (branches + statements) para `src/utils/bytes.ts` via Vitest, validando os casos de uso essenciais (zero bytes, decimais padrão, decimais customizados, unidades KB, MB, GB, TB e lançamento de erro para entradas inválidas).

## Escopo
Criação do arquivo `src/utils/bytes.ts` contendo exclusivamente a função exportada `formatBytes(bytes: number, decimals?: number): string`, com JSDoc completo, tratamento de erros e testes unitários em arquivo dedicado (ex.: `src/utils/bytes.test.ts` ou `tests/utils/bytes.test.ts`). A função deverá ser re-exportada no barrel `src/utils/index.ts`. O glossário `docs/GLOSSARIO.md` deverá ser atualizado com a documentação pública da nova função, seguindo o padrão já estabelecido para `formatDate`.

## Fora de Escopo
- Refatoração ou alteração de quaisquer componentes, módulos ou agentes existentes para consumir a nova função — essa demanda deve ser aberta como história separada pelo solicitante.
- Suporte a sistemas de unidades binário (KiB, MiB, GiB) vs. decimal (KB, MB, GB) configurável — a entrega adota apenas uma convenção (decimal base-1000 ou binária base-1024, a definir pelo LT no plano de execução).
- Criação de endpoint HTTP ou exposição da função via API REST.
- Internacionalização (i18n) do separador decimal ou do sufixo de unidade.

## Requisitos Funcionais
| ID | Requisito | Prioridade |
|----|-----------|------------|
| RF-01 | A função `formatBytes(bytes: number, decimals?: number): string` deve ser criada e exportada nominalmente em `src/utils/bytes.ts`. | Must Have |
| RF-02 | Quando `decimals` for omitido, a função deve utilizar **2** casas decimais como valor padrão (ex.: `formatBytes(1536)` → `"1.50 KB"`). | Must Have |
| RF-03 | Quando `bytes === 0`, a função deve retornar a string `"0 Bytes"` independentemente do valor de `decimals`. | Must Have |
| RF-04 | Para entradas negativas ou não numéricas (ex.: `NaN`, `Infinity`), a função deve lançar um `TypeError` com mensagem descritiva que inclua o valor recebido, seguindo o padrão já adotado por `formatDate`. | Must Have |
| RF-05 | A função deve suportar corretamente as unidades: `Bytes`, `KB`, `MB`, `GB`, `TB`, `PB`, `EB`, `ZB` e `YB`, selecionando automaticamente a unidade mais legível com base no valor de entrada. | Must Have |
| RF-06 | O parâmetro `decimals` deve aceitar apenas inteiros ≥ 0; caso receba valor negativo ou não inteiro, deve ser tratado (via `Math.max(0, Math.round(decimals))`) sem lançar erro. | Should Have |
| RF-07 | A função deve ser re-exportada no arquivo barrel `src/utils/index.ts` para consumo centralizado por todos os módulos. | Must Have |
| RF-08 | A função deve ser documentada com bloco JSDoc contendo: descrição, parâmetros (`@param`), retorno (`@returns`), exceções (`@throws`) e pelo menos 3 exemplos (`@example`). | Should Have |
| RF-09 | O arquivo `docs/GLOSSARIO.md` deve ser atualizado com a entrada do módulo `src/utils/bytes` seguindo o mesmo padrão da entrada `src/utils/date` já documentada. | Should Have |
| RF-10 | Testes unitários devem cobrir: `bytes = 0`, valor em KB, MB, GB, `decimals` customizado, `decimals` omitido, entrada negativa e entrada `NaN`, atingindo cobertura ≥ 90% de branches e statements. | Must Have |

## Critérios de Aceite
- **CA-01**: Dado que o módulo `src/utils/bytes.ts` foi criado, quando `formatBytes(0)` é chamado, então a função retorna exatamente a string `"0 Bytes"`, sem lançar exceção.
- **CA-02**: Dado que `decimals` não é fornecido, quando `formatBytes(1048576)` é chamado (1 MB em base-1024), então a função retorna uma string com o valor formatado com 2 casas decimais e o sufixo de unidade correspondente (ex.: `"1.00 MB"`).
- **CA-03**: Dado que `decimals = 3` é fornecido, quando `formatBytes(1536, 3)` é chamado, então a função retorna uma string com exatamente 3 casas decimais e a unidade correta (ex.: `"1.500 KB"`).
- **CA-04**: Dado que um valor negativo é passado como `bytes`, quando `formatBytes(-512)` é chamado, então a função lança um `TypeError` cuja mensagem contém o valor `-512`, sem retornar string alguma.
- **CA-05**: Dado que `formatBytes` é re-exportada em `src/utils/index.ts`, quando qualquer módulo importa `import { formatBytes } from '../utils'`, então a importação é resolvida sem erro e a função se comporta identicamente à exportação direta de `src/utils/bytes.ts`.
- **CA-06**: Dado que os testes unitários são executados com `npm run test:coverage`, quando o relatório de cobertura é gerado, então `src/utils/bytes.ts` apresenta cobertura ≥ 90% em statements e branches.

## Riscos
| ID | Risco | Probabilidade | Impacto | Mitigação |
|----|-------|--------------|---------|-----------|
| R-01 | Inconsistência na escolha da base de cálculo (base-1000 decimal vs. base-1024 binária) pode gerar outputs divergentes dos valores esperados pelos consumidores internos do sistema (ex.: logs de tamanho de arquivo do GitHub Contents API). | Média | Médio | O Agente LT deve explicitar no Plano de Execução qual base será adotada; a decisão deve ser registrada no JSDoc e no Glossário para servir como contrato público imutável desta versão. |
| R-02 | Conflito de nomes ou re-exportação duplicada no barrel `src/utils/index.ts` caso já exista alguma exportação com o identificador `formatBytes`. | Baixa | Médio | O Agente DEV deve verificar o conteúdo atual de `src/utils/index.ts` antes de adicionar a re-exportação, garantindo que não haja colisão de identificadores. |
| R-03 | Cobertura de testes abaixo do limiar de 90% caso cenários de borda (ex.: `Infinity`, `NaN`, valores muito grandes como `YB`) não sejam contemplados. | Média | Baixo | Incluir explicitamente no arquivo de testes casos para `NaN`, `Infinity`, `0` e o maior índice de unidade suportado, conforme RF-10. |

## Referências
- Jira: SCRUM-19