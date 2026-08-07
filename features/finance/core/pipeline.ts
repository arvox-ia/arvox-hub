import { addDays } from 'date-fns'
import type { MonthlyAmounts, OpenDeal, WeightDealsOptions } from './types'

/**
 * Núcleo puro de ponderação do pipeline de vendas (Fase 1B, spec §4.2). Sem
 * I/O, sem `Date.now()` — `today` e o horizonte são sempre parâmetros.
 * Datas de entrada são strings `yyyy-MM-dd`/`yyyy-MM`; `Date` do JS só é
 * usado internamente para somar dias, sempre a partir de componentes locais
 * (`new Date(year, monthIndex0, day)`), nunca via `new Date(string)`, para
 * não sofrer deslocamento de timezone.
 *
 * Decisões de negócio fixadas aqui (ver testes em pipeline.test.ts):
 * - Sem `expectedClose`, assume-se fechamento em `today + defaultCloseDays`.
 * - O setup pondera no MÊS DE FECHAMENTO: value × probability/100.
 * - A mensalidade pondera nos `durationMonths` meses APÓS o mês de
 *   fechamento (o próprio mês de fechamento nunca recebe mensalidade) —
 *   modela o contrato como: fecha, paga setup, e só a partir do mês
 *   seguinte é que a recorrência começa a entrar (onboarding/faturamento).
 * - `probability` 0 não contribui nada (nem é criada a chave do mês).
 * - Só contribuições cujo mês caia dentro de [mês de `today`, mês de
 *   `today` + horizonMonths − 1] (a janela do horizonte, `horizonMonths`
 *   meses incluindo o mês corrente) são somadas; qualquer mês fora dessa
 *   janela — inclusive mensalidades que "vazam" para além do fim do
 *   horizonte — é descartado silenciosamente, mês a mês (não o deal
 *   inteiro).
 */

function parseISODate(dateStr: string): { year: number; monthIndex0: number; day: number } {
  const [year, month, day] = dateStr.split('-').map(Number)
  return { year, monthIndex0: month - 1, day }
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`
}

/** Extrai a chave de mês `yyyy-MM` de uma data `yyyy-MM-dd`. */
export function toMonthKey(dateStr: string): string {
  const { year, monthIndex0 } = parseISODate(dateStr)
  return `${year}-${pad2(monthIndex0 + 1)}`
}

/** Soma `n` meses a uma chave de mês `yyyy-MM` (`n` pode ser negativo), rolando o ano. */
export function addMonthsToKey(monthKey: string, n: number): string {
  const [year, month] = monthKey.split('-').map(Number)
  const total = month - 1 + n
  const targetYear = year + Math.floor(total / 12)
  const targetMonthIndex0 = ((total % 12) + 12) % 12
  return `${targetYear}-${pad2(targetMonthIndex0 + 1)}`
}

/** Soma `days` dias a uma data `yyyy-MM-dd`. Local-safe: nunca parseia a string via `new Date`. */
function addDaysToISODate(dateStr: string, days: number): string {
  const { year, monthIndex0, day } = parseISODate(dateStr)
  const result = addDays(new Date(year, monthIndex0, day), days)
  return `${result.getFullYear()}-${pad2(result.getMonth() + 1)}-${pad2(result.getDate())}`
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function addAmount(map: MonthlyAmounts, monthKey: string, amount: number): void {
  if (amount === 0) return
  map[monthKey] = round2((map[monthKey] ?? 0) + amount)
}

export function weightDeals(deals: OpenDeal[], opts: WeightDealsOptions): MonthlyAmounts {
  const weighted: MonthlyAmounts = {}
  const horizonStart = toMonthKey(opts.today)
  const horizonEnd = addMonthsToKey(horizonStart, opts.horizonMonths - 1)

  for (const deal of deals) {
    if (deal.probability <= 0) continue
    const factor = deal.probability / 100

    const closeDate = deal.expectedClose ?? addDaysToISODate(opts.today, opts.defaultCloseDays)
    const closeMonth = toMonthKey(closeDate)

    if (closeMonth >= horizonStart && closeMonth <= horizonEnd) {
      addAmount(weighted, closeMonth, deal.value * factor)
    }

    for (let i = 1; i <= deal.durationMonths; i++) {
      const monthKey = addMonthsToKey(closeMonth, i)
      if (monthKey < horizonStart || monthKey > horizonEnd) continue
      addAmount(weighted, monthKey, deal.monthlyValue * factor)
    }
  }

  return weighted
}
