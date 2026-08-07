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
    })
  }

  return entries
}
