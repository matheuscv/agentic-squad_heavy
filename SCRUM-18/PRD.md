# PRD — Adicionar função utilitária formatDate(date, style?) ao módulo src/utils/date.ts

## Identificação
- **Jira Key**: SCRUM-18
- **Resumo**: Adicionar função utilitária formatDate(date, style?) ao módulo src/utils/date.ts
- **Versão**: 1.0
- **Autor**: Agente PO (IA)
- **Data**: 2026-05-27

## Contexto
O sistema **agentic-squad-heavy** é uma plataforma de desenvolvimento de software orientada a agentes de IA autônomos. O pipeline orquestra agentes (PO → LT → DEV → QA) e persiste dados ricos de execução — incluindo timestamps de início e término de execuções (`agentRuns.startedAt`, `agentRuns.completedAt`), carimbos de tempo em comentários do Jira e entradas de log estruturado via Pino.

Hoje, toda camada da aplicação que precisa exibir ou serializar uma data implementa sua própria lógica de formatação ad hoc. Isso gera inconsistência visual entre interfaces, duplicação de código e dificulta mudanças globais de formato (ex.: internacionalização futura ou ajuste de timezone). O padrão já foi estabelecido na história SCRUM-17, onde `Intl.NumberFormat` foi encapsulado em uma função utilitária centralizada para valores monetários em `src/utils/`.

A criação de `formatDate` em `src/utils/date.ts` segue exatamente essa mesma filosofia: encapsular `Intl.DateTimeFormat` em um único ponto de verdade para formatação de datas, garantindo consistência de comportamento e facilitando manutenção futura. A migração dos componentes existentes para consumir a nova função é explicitamente **fora do escopo** desta história e deverá ser demandada separadamente.

## Problema
Não existe uma função centralizada de formatação de datas no projeto. Cada módulo que precisa exibir um timestamp implementa sua própria lógica isolada, resultando em formatos inconsistentes, código duplicado e ausência de um contrato claro de formatação entre camadas da aplicação.

## Objetivos
- **OBJ-01**: Disponibilizar a função `formatDate(date, style?)` em `src/utils/date.ts`, tornando-a o único ponto de formatação de datas da aplicação, com cobertura de testes ≥ 90% (alinhado ao padrão de cobertura do projeto via Vitest + v8).
- **OBJ-02**: Garantir que a função suporte ao menos três estilos de formatação distintos (`short`, `medium`, `long`) via parâmetro opcional `style`, eliminando a necessidade de lógica de formatação duplicada em novos módulos a partir do merge desta história.

## Escopo
Criação do arquivo `src/utils/date.ts` (ou adição da função ao arquivo caso já exista) contendo exclusivamente a implementação de `formatDate(date, style?)`, utilizando `Intl.DateTimeFormat` como motor de formatação. Inclui também a criação de arquivo de testes unitários correspondente (`src/utils/date.test.ts` ou equivalente segundo convenção do projeto), exportação pública da função pelo módulo utilitário e documentação inline (JSDoc) descrevendo parâmetros, retorno e exemplos de uso.

## Fora de Escopo
- Alteração de qualquer componente, agente ou módulo existente para consumir a nova função `formatDate` (a ser tratado em história separada)
- Implementação de outros utilitários de data (ex.: `parseDate`, `diffDate`, `addDays`)
- Suporte a bibliotecas externas de data (ex.: `date-fns`, `dayjs`, `luxon`) — a implementação deve depender apenas de `Intl.DateTimeFormat` nativo
- Internacionalização dinâmica com troca de locale em runtime via configuração de usuário
- Formatação de intervalos de tempo ou durações relativas (ex.: "há 2 horas")

## Requisitos Funcionais

| ID | Requisito | Prioridade |
|----|-----------|------------|
| RF-01 | A função `formatDate(date: Date \| string \| number, style?: 'short' \| 'medium' \| 'long')` deve ser criada e exportada publicamente a partir de `src/utils/date.ts` | Must Have |
| RF-02 | O parâmetro `style` deve ser opcional; quando omitido, o comportamento padrão deve aplicar o estilo `medium` | Must Have |
| RF-03 | A função deve utilizar `Intl.DateTimeFormat` internamente para formatar a data, sem dependências de bibliotecas externas | Must Have |
| RF-04 | A função deve aceitar o parâmetro `date` nos tipos `Date`, `string` (ISO 8601) e `number` (Unix timestamp em ms), convertendo internamente para `Date` quando necessário | Must Have |
| RF-05 | A função deve lançar um `TypeError` com mensagem descritiva quando receber um valor de `date` inválido (ex.: string não parseável, `NaN`) | Should Have |
| RF-06 | A função deve ser coberta por testes unitários com cobertura de linha ≥ 90%, utilizando Vitest, validando ao menos: os três estilos, o comportamento padrão, os três tipos de entrada aceitos e o lançamento de erro para entrada inválida | Must Have |
| RF-07 | A função deve ser documentada com JSDoc contendo descrição, `@param`, `@returns` e ao menos um `@example` por estilo suportado | Should Have |
| RF-08 | O locale padrão utilizado por `Intl.DateTimeFormat` deve ser `pt-BR`, podendo ser sobrescrito futuramente por parâmetro adicional sem quebra de contrato (design para extensibilidade) | Should Have |

## Critérios de Aceite

- **CA-01**: Dado que `formatDate` é importada de `src/utils/date.ts`, quando chamada com um objeto `Date` válido e `style` omitido, então retorna uma string de data formatada no estilo `medium` em `pt-BR` (ex.: `"27 de mai. de 2026"`) sem lançar exceções.
- **CA-02**: Dado que `formatDate` é chamada com o mesmo timestamp nos três estilos (`short`, `medium`, `long`), quando os resultados são comparados, então as três strings retornadas são distintas entre si e cada uma corresponde ao formato esperado pelo `Intl.DateTimeFormat` com o respectivo estilo.
- **CA-03**: Dado que `formatDate` é chamada com `date` nos formatos `Date`, `string ISO 8601` e `number` (Unix ms) representando o mesmo instante, quando os resultados são comparados, então as três chamadas retornam strings idênticas, confirmando equivalência de entrada.
- **CA-04**: Dado que `formatDate` é chamada com um valor de `date` inválido (ex.: `"não-é-uma-data"` ou `NaN`), quando a função é executada, então um `TypeError` é lançado com mensagem contendo a descrição do valor inválido recebido.
- **CA-05**: Dado que o comando `npm run test:coverage` é executado no repositório após a implementação, quando o relatório de cobertura v8 é gerado para `src/utils/date.ts`, então a cobertura de linhas do arquivo é igual ou superior a 90%.

## Riscos

| ID | Risco | Probabilidade | Impacto | Mitigação |
|----|-------|--------------|---------|-----------|
| R-01 | Comportamento de `Intl.DateTimeFormat` pode variar entre versões do Node.js (o projeto usa Node.js 22), gerando snapshots de teste frágeis atrelados a uma saída de string exata | Média | Médio | Escrever testes que validem estrutura e presença de componentes da data (dia, mês, ano) em vez de igualdade exata de string; documentar a versão do Node.js requerida no JSDoc |
| R-02 | O arquivo `src/utils/date.ts` pode não existir ainda no repositório, exigindo criação do módulo e possível ajuste nos barrel exports (`src/utils/index.ts`) | Baixa | Baixo | O Agente LT deve verificar a existência do arquivo e do barrel export como primeiro passo do plano de execução |
| R-03 | Ausência de glossário de terminologia pode causar divergência de nomenclatura entre esta função e futuras funções utilitárias de data adicionadas por outros agentes | Baixa | Médio | Criar ou atualizar `docs/GLOSSARIO.md` com a definição dos estilos de formatação suportados como parte desta entrega |

## Referências
- Jira: SCRUM-18