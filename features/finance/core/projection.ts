import { toMonthKey } from './pipeline'
import type { MonthlyAmounts, ProjectionDueEntry, ProjectionExpenseEntry, ProjectionInput, ProjectionPoint } from './types'

/**
 * Núcleo puro da projeção de caixa em duas curvas (Fase 1B, spec §4.2/§4.3).
 * Sem I/O, sem `Date.now()` — todo o estado (meses, recebíveis, despesas,
 * pipeline ponderado, saldo inicial) entra via `input`.
 *
 * Decisões de negócio fixadas aqui (ver testes em projection.test.ts):
 * - `contracted`/`expenses` agrupam por `dueDate` → mês, ignorando status
 *   (`PAID`/`PENDING`): a projeção usa TODOS os lançamentos por vencimento;
 *   é o dashboard (Task 9) que separa realizado × previsto dentro do mês
 *   corrente, não este core.
 * - `probable` = `contracted` + pipeline ponderado (`input.weighted`) do
 *   mês; mês sem entrada no mapa ponderado conta como 0.
 * - Não-dupla-contagem de despesas é por REGRA (`expenseId`), não por mês:
 *   `expenseEntries` sempre contribuem integralmente; uma `fixedRules[i]`
 *   só contribui num mês se NENHUM `expenseEntries` daquele mês tiver o
 *   mesmo `expenseId` (ou seja, aquela regra específica ainda não foi
 *   materializada ali). Um lançamento pontual não relacionado não pode
 *   "apagar" despesas fixas de outras regras — dedup por mês (versão
 *   anterior) fazia exatamente isso e subestimava despesas, superestimando
 *   o saldo piso.
 * - `taxProvision` (campo exposto) é a provisão do PISO: `taxRate`% sobre
 *   `contracted`. A curva provável usa sua PRÓPRIA provisão — `taxRate`%
 *   sobre `probable` — só para compor `balanceProbable`; ver Concerns do
 *   relatório da Task 4 para o detalhe do handoff a Task 9.
 * - `balanceFloor`/`balanceProbable` partem de `initialBalance` e acumulam,
 *   mês a mês, (receita − despesas − provisão) da curva correspondente.
 *   Saldo negativo se propaga normalmente para os meses seguintes.
 */

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

/**
 * Provisão de imposto sobre a receita CONTRATADA (curva piso) — `contracted × taxRatePercent/100`.
 * Extraída como função exportada (achado da revisão da Task 11) para ser a ÚNICA fonte de
 * verdade dessa fórmula: `buildProjection` a usa internamente para `taxProvision`, e qualquer
 * consumidor que precise da provisão de UM mês isolado sem rodar a projeção inteira (ex.:
 * `getFinanceOverview` em `lib/ai/financeTools.ts`) importa esta função em vez de reescrever
 * `contracted * (taxRate / 100)` — evita a IA e o dashboard divergirem se a fórmula um dia mudar
 * num lugar só. Irmã de `computeProbableTaxProvision` (`./dashboardMetrics.ts`), que faz o mesmo
 * para a curva provável.
 */
export function computeContractedTaxProvision(contracted: number, taxRatePercent: number): number {
  return round2(contracted * (taxRatePercent / 100))
}

function sumByMonth(entries: ProjectionDueEntry[]): MonthlyAmounts {
  const map: MonthlyAmounts = {}
  for (const entry of entries) {
    const key = toMonthKey(entry.dueDate)
    map[key] = round2((map[key] ?? 0) + entry.amount)
  }
  return map
}

/** Mapa `yyyy-MM` → conjunto de `expenseId` já materializados naquele mês. */
function materializedExpenseIdsByMonth(entries: ProjectionExpenseEntry[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>()
  for (const entry of entries) {
    const key = toMonthKey(entry.dueDate)
    const ids = map.get(key) ?? new Set<string>()
    ids.add(entry.expenseId)
    map.set(key, ids)
  }
  return map
}

export function buildProjection(input: ProjectionInput): ProjectionPoint[] {
  const contractedByMonth = sumByMonth(input.receivables)
  const materializedExpensesByMonth = sumByMonth(input.expenseEntries)
  const materializedIdsByMonth = materializedExpenseIdsByMonth(input.expenseEntries)

  let balanceFloor = input.initialBalance
  let balanceProbable = input.initialBalance

  return input.months.map((month) => {
    const contracted = contractedByMonth[month] ?? 0
    const weightedForMonth = input.weighted[month] ?? 0
    const probable = round2(contracted + weightedForMonth)

    // Lançamentos materializados sempre contam; regras fixas só entram se a MESMA regra
    // (mesmo expenseId) ainda não tiver um lançamento materializado nesse mês.
    const materializedExpenses = materializedExpensesByMonth[month] ?? 0
    const materializedIds = materializedIdsByMonth.get(month)
    const unmaterializedFixed = input.fixedRules
      .filter((rule) => !materializedIds?.has(rule.expenseId))
      .reduce((sum, rule) => sum + rule.amount, 0)
    const expenses = round2(materializedExpenses + unmaterializedFixed)

    const taxProvision = computeContractedTaxProvision(contracted, input.taxRate)
    const probableProvision = round2(probable * (input.taxRate / 100))

    balanceFloor = round2(balanceFloor + (contracted - expenses - taxProvision))
    balanceProbable = round2(balanceProbable + (probable - expenses - probableProvision))

    return { month, contracted, probable, expenses, taxProvision, balanceFloor, balanceProbable }
  })
}
