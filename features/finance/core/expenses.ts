import { clampDay } from './receivables'
import type { FixedExpenseEntry, FixedExpenseRule, GenerateFixedExpenseEntriesOptions } from './types'

/** Parseia `yyyy-MM` por split puro — nunca via `new Date(string)`. */
function parseYearMonth(yearMonth: string): { year: number; monthIndex0: number } {
  const [year, month] = yearMonth.split('-').map(Number)
  return { year, monthIndex0: month - 1 }
}

/**
 * Gera os lançamentos mensais de uma despesa fixa: um por mês, no `dueDay`
 * informado (com clamp de fim de mês), a partir de `fromMonth` por `months`
 * meses. Puro — sem I/O, sem `Date.now()`.
 */
export function generateFixedExpenseEntries(
  rule: FixedExpenseRule,
  opts: GenerateFixedExpenseEntriesOptions
): FixedExpenseEntry[] {
  const { year, monthIndex0 } = parseYearMonth(opts.fromMonth)
  const entries: FixedExpenseEntry[] = []

  for (let i = 0; i < opts.months; i++) {
    const total = monthIndex0 + i
    const targetYear = year + Math.floor(total / 12)
    const targetMonthIndex0 = ((total % 12) + 12) % 12
    entries.push({
      dueDate: clampDay(targetYear, targetMonthIndex0, rule.dueDay),
      amount: rule.amount,
      expenseId: rule.expenseId,
    })
  }

  return entries
}

/** Item com categoria + valor — shape mínimo aceito por `sumByCategory`. */
export interface CategorizedAmount {
  category: string
  amount: number
}

/**
 * Soma valores agrupados por categoria. Puro, genérico o bastante pra
 * qualquer lista de itens com `category`/`amount` (usado pela ExpensesTab
 * para os totais por categoria do mês selecionado).
 */
export function sumByCategory(items: CategorizedAmount[]): Record<string, number> {
  const totals: Record<string, number> = {}
  for (const item of items) {
    totals[item.category] = (totals[item.category] ?? 0) + item.amount
  }
  return totals
}
