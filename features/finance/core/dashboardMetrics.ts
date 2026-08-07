/**
 * Núcleo puro de agregações da Task 9 (Dashboard financeiro, Fase 1B). Sem
 * I/O, sem `Date.now()` — `today` é sempre parâmetro, listas já vêm
 * resolvidas (e filtradas por mês) do controller. Cobre os cálculos que a
 * UI do dashboard precisa e que não são "formatação trivial de display"
 * (regra do módulo: qualquer aritmética além disso vive num helper puro
 * testado):
 *
 * - `computeMonthKpis`: os 4 StatCards do mês corrente. `recebido` é
 *   baseado em DATA DE PAGAMENTO (`paidAt`), `aReceber` em DATA DE
 *   VENCIMENTO (`dueDate`) — ver achado da revisão no comentário da função.
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

/** Item com valor, shape mínimo aceito por `computeMonthKpis` pro total de despesas (só soma). */
export interface AmountLike {
  amount: number
}

/**
 * Recebível bruto (qualquer mês de vencimento) aceito por `computeMonthKpis`
 * — a função filtra internamente por `dueDate`/`paidAt` conforme o KPI, ver
 * comentário da função. `paidAt` é o timestamp ISO completo (`paid_at` do
 * banco) ou `null` enquanto `status='PENDING'`.
 */
export interface ReceivableForMonthKpis {
  amount: number
  status: 'PENDING' | 'PAID'
  /** `yyyy-MM-dd` */
  dueDate: string
  /** Timestamp ISO completo, ou `null` se ainda não pago. */
  paidAt: string | null
}

export interface MonthKpis {
  /** Recebíveis pagos DENTRO do mês corrente (por `paidAt`, não `dueDate`). */
  recebido: number
  /** Recebíveis ainda PENDING com vencimento (`dueDate`) no mês corrente. */
  aReceber: number
  /** Total de lançamentos de despesa do mês (qualquer status — mesmo racional do total da ExpensesTab). */
  despesas: number
  /** `recebido + aReceber - despesas - contractedProvision`. */
  resultado: number
}

/**
 * KPIs do mês corrente para os StatCards do dashboard. Recebe TODOS os
 * recebíveis relevantes (não só os que vencem no mês corrente — um
 * recebível pago este mês pode ter vencido em qualquer mês anterior) e
 * filtra internamente por `currentMonth` (`yyyy-MM`).
 *
 * ACHADO DA REVISÃO (crítico pra confiança nos números): `recebido` e
 * `aReceber` usam bases de data DIFERENTES, de propósito.
 * - `recebido` = recebíveis cujo PAGAMENTO (`paidAt`) caiu no mês corrente,
 *   INDEPENDENTE de quando venceram (`dueDate`). Um recebível vencido em
 *   julho e pago em agosto é "Recebido" de AGOSTO — nunca de julho (mês que
 *   o dashboard já passou) e nunca "recebido em nenhum mês" (o bug: filtrar
 *   por `dueDate` fazia esse valor sumir pra sempre, porque nem julho nem
 *   agosto batiam com o vencimento original).
 * - `aReceber` = recebíveis PENDING cujo VENCIMENTO (`dueDate`) cai no mês
 *   corrente — esse sim é genuinamente um conceito de vencimento ("o que eu
 *   espero receber este mês"), não de caixa.
 *
 * `contractedProvision` é o `taxProvision` do `ProjectionPoint` do mês
 * corrente — a provisão da curva CONTRATADA, já calculada pelo core
 * (`buildProjection`), nunca recalculada aqui. `resultado` é portanto uma
 * métrica de base MISTA (recebido por pagamento + a receber por
 * vencimento − despesas do mês − provisão sobre o contratado do mês) — ela
 * NÃO fecha mais com `contracted` nem com a curva piso (`balanceFloor`) do
 * primeiro mês da projeção (fechava antes, quando `recebido` também era por
 * vencimento); é uma leitura prática de "como foi o mês", não um ponto da
 * projeção. A UI deixa essa base explícita pro usuário (ver `DashboardTab`).
 */
export function computeMonthKpis(
  receivables: ReceivableForMonthKpis[],
  expenseEntriesInMonth: AmountLike[],
  contractedProvision: number,
  currentMonth: string
): MonthKpis {
  const recebido = round2(
    receivables
      .filter(r => r.paidAt !== null && r.paidAt.slice(0, 7) === currentMonth)
      .reduce((sum, r) => sum + r.amount, 0)
  )
  const aReceber = round2(
    receivables
      .filter(r => r.status === 'PENDING' && r.dueDate.slice(0, 7) === currentMonth)
      .reduce((sum, r) => sum + r.amount, 0)
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
