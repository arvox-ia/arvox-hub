import { toMonthKey } from './pipeline'
import type { MonthlyAmounts, ProjectionDueEntry, ProjectionInput, ProjectionPoint } from './types'

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
 * - Não-dupla-contagem de despesas: `expenseEntries` e `fixedRules` cobrem
 *   universos complementares por MÊS (não por regra individual). Se existe
 *   ao menos um lançamento materializado (`expenseEntries`) com vencimento
 *   naquele mês, assume-se que TODAS as regras fixas já foram
 *   materializadas para aquele mês (a geração de lançamentos fixos é feita
 *   em lote, para todas as regras ativas, no mesmo horizonte — Task 3) e as
 *   `fixedRules` são ignoradas nesse mês. Só quando o mês não tem nenhum
 *   lançamento materializado é que as `fixedRules` entram, somando
 *   `amount` de cada regra ativa (o `dueDay` de cada regra não afeta o
 *   agrupamento mensal, só a data exata do lançamento quando ele é
 *   materializado de fato).
 * - `taxProvision` (campo exposto) é a provisão do PISO: `taxRate`% sobre
 *   `contracted`. A curva provável usa sua PRÓPRIA provisão — `taxRate`%
 *   sobre `probable` — para compor `balanceProbable`; esse segundo valor
 *   não é exposto como campo à parte (o contrato só tem um `taxProvision`),
 *   só entra no cálculo do saldo provável.
 * - `balanceFloor`/`balanceProbable` partem de `initialBalance` e acumulam,
 *   mês a mês, (receita − despesas − provisão) da curva correspondente.
 *   Saldo negativo se propaga normalmente para os meses seguintes.
 */

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function sumByMonth(entries: ProjectionDueEntry[]): MonthlyAmounts {
  const map: MonthlyAmounts = {}
  for (const entry of entries) {
    const key = toMonthKey(entry.dueDate)
    map[key] = round2((map[key] ?? 0) + entry.amount)
  }
  return map
}

export function buildProjection(input: ProjectionInput): ProjectionPoint[] {
  const contractedByMonth = sumByMonth(input.receivables)
  const materializedExpensesByMonth = sumByMonth(input.expenseEntries)
  const materializedMonths = new Set(input.expenseEntries.map((entry) => toMonthKey(entry.dueDate)))
  const fixedRulesTotal = round2(input.fixedRules.reduce((sum, rule) => sum + rule.amount, 0))

  let balanceFloor = input.initialBalance
  let balanceProbable = input.initialBalance

  return input.months.map((month) => {
    const contracted = contractedByMonth[month] ?? 0
    const weightedForMonth = input.weighted[month] ?? 0
    const probable = round2(contracted + weightedForMonth)

    const materializedExpenses = materializedExpensesByMonth[month] ?? 0
    const expenses = materializedMonths.has(month) ? materializedExpenses : round2(materializedExpenses + fixedRulesTotal)

    const taxProvision = round2(contracted * (input.taxRate / 100))
    const probableProvision = round2(probable * (input.taxRate / 100))

    balanceFloor = round2(balanceFloor + (contracted - expenses - taxProvision))
    balanceProbable = round2(balanceProbable + (probable - expenses - probableProvision))

    return { month, contracted, probable, expenses, taxProvision, balanceFloor, balanceProbable }
  })
}
