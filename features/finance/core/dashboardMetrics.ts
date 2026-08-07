/**
 * Núcleo puro de agregações da Task 9 (Dashboard financeiro, Fase 1B). Sem
 * I/O, sem `Date.now()` — `today` é sempre parâmetro, listas já vêm
 * resolvidas do controller. Cobre 3 cálculos que a UI do dashboard precisa e
 * que não são "formatação trivial de display" (regra do módulo: qualquer
 * aritmética além disso vive num helper puro testado):
 *
 * - `computeMonthKpis`: os 4 StatCards do mês corrente.
 * - `computeProbableTaxProvision`: a provisão da curva PROVÁVEL — não existe
 *   como campo em `ProjectionPoint` (que só expõe a provisão da curva
 *   CONTRATADA em `taxProvision`, ver comentário de `ProjectionInput` em
 *   ./types.ts e o achado da revisão da Task 4). Mesma fórmula que o core
 *   usa internamente para compor `balanceProbable` (`probable × taxRate/100`,
 *   arredondada do mesmo jeito) — reimplementada aqui porque o core não a
 *   expõe, e a tela PRECISA dela pra mostrar as duas provisões lado a lado
 *   sem que uma pessoa conferindo o saldo provável na mão bata num número
 *   diferente.
 * - `filterUpcoming`: janela de vencimentos (recebíveis + lançamentos de
 *   despesa) dos próximos N dias, com atrasados sempre incluídos e
 *   destacados, independente da janela.
 */

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

// ============================================
// KPIs do mês corrente (4 StatCards)
// ============================================

/** Recebível/lançamento com status, shape mínimo aceito por `computeMonthKpis`. */
export interface MonthEntryLike {
  amount: number
  status: 'PENDING' | 'PAID'
}

export interface MonthKpis {
  /** Recebíveis do mês já com baixa (`status='PAID'`). */
  recebido: number
  /** Recebíveis do mês ainda pendentes (`status='PENDING'`). */
  aReceber: number
  /** Total de lançamentos de despesa do mês (qualquer status — mesmo racional do total da ExpensesTab). */
  despesas: number
  /** `recebido + aReceber - despesas - contractedProvision`. */
  resultado: number
}

/**
 * KPIs do mês corrente para os StatCards do dashboard. `contractedProvision`
 * é o `taxProvision` do `ProjectionPoint` do mês corrente — a provisão da
 * curva CONTRATADA, já calculada pelo core (`buildProjection`), nunca
 * recalculada aqui. `recebido + aReceber` é, por construção, o mesmo total
 * que `contracted` do mês corrente (o core soma recebíveis por vencimento
 * ignorando status) — por isso `resultado` fecha exatamente com a curva
 * piso (`balanceFloor`) do primeiro mês da projeção.
 */
export function computeMonthKpis(
  receivablesInMonth: MonthEntryLike[],
  expenseEntriesInMonth: { amount: number }[],
  contractedProvision: number
): MonthKpis {
  const recebido = round2(
    receivablesInMonth.filter(r => r.status === 'PAID').reduce((sum, r) => sum + r.amount, 0)
  )
  const aReceber = round2(
    receivablesInMonth.filter(r => r.status === 'PENDING').reduce((sum, r) => sum + r.amount, 0)
  )
  const despesas = round2(expenseEntriesInMonth.reduce((sum, e) => sum + e.amount, 0))
  const resultado = round2(recebido + aReceber - despesas - contractedProvision)

  return { recebido, aReceber, despesas, resultado }
}

// ============================================
// Provisão de imposto da curva PROVÁVEL
// ============================================

/**
 * Provisão de imposto sobre a receita PROVÁVEL do mês — `probable ×
 * taxRatePercent/100`. Mesma fórmula (e mesmo arredondamento) que o core usa
 * internamente pra compor `balanceProbable`; ver nota de arquivo acima.
 */
export function computeProbableTaxProvision(probable: number, taxRatePercent: number): number {
  return round2(probable * (taxRatePercent / 100))
}

// ============================================
// Janela de vencimentos (UpcomingList)
// ============================================

export type UpcomingKind = 'RECEIVABLE' | 'EXPENSE'

/** Item mínimo (recebível ou lançamento de despesa) aceito por `filterUpcoming`. */
export interface UpcomingItem {
  id: string
  kind: UpcomingKind
  description: string
  amount: number
  /** `yyyy-MM-dd` */
  dueDate: string
  status: 'PENDING' | 'PAID'
}

export interface UpcomingRow extends UpcomingItem {
  isOverdue: boolean
}

/**
 * Filtra `items` (recebíveis + lançamentos de despesa) para a janela de
 * vencimentos do dashboard: só `PENDING` (baixado não é "a vencer"); dentro
 * de `[today, today + windowDays]` (inclusive os dois extremos) OU vencido
 * (`dueDate < today`) — atrasado entra SEMPRE, mesmo bem antes de `today`,
 * porque é exatamente o que a UI precisa fixar no topo em destaque.
 * Ordenação: atrasados primeiro (vencimento mais antigo primeiro), depois os
 * que ainda vão vencer (vencimento mais próximo primeiro).
 */
export function filterUpcoming(items: UpcomingItem[], today: string, windowDays: number): UpcomingRow[] {
  const horizon = addDaysToISODate(today, windowDays)

  const rows: UpcomingRow[] = items
    .filter(item => item.status === 'PENDING')
    .filter(item => item.dueDate < today || item.dueDate <= horizon)
    .map(item => ({ ...item, isOverdue: item.dueDate < today }))

  return rows.sort((a, b) => {
    if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1
    return a.dueDate.localeCompare(b.dueDate)
  })
}

// ============================================
// Meta vs. realizado
// ============================================

/**
 * Percentual de progresso de `realizado` sobre `target`, clampado em
 * [0, 100] pra virar largura de barra de progresso direto — sem `target`
 * (`<= 0`, meta não definida ou zerada), retorna `0` em vez de dividir por
 * zero.
 */
export function computeGoalProgressPct(realizado: number, target: number): number {
  if (target <= 0) return 0
  const pct = (realizado / target) * 100
  return Math.min(100, Math.max(0, round2(pct)))
}

/** Soma `days` dias a uma data `yyyy-MM-dd`, local-safe (nunca via `new Date(string)`). */
function addDaysToISODate(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split('-').map(Number)
  const result = new Date(year, month - 1, day + days)
  const pad2 = (n: number): string => (n < 10 ? `0${n}` : `${n}`)
  return `${result.getFullYear()}-${pad2(result.getMonth() + 1)}-${pad2(result.getDate())}`
}
