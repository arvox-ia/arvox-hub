import { lastDayOfMonth } from 'date-fns'
import type { ContractInput, GenerateReceivablesOptions, ReceivableEntry } from './types'

/**
 * Núcleo puro de geração de recebíveis de contrato (Fase 1B, spec §4.1).
 * Sem I/O, sem `Date.now()` — `today` e o horizonte de projeção são sempre
 * parâmetros. Datas de entrada e saída são strings `yyyy-MM-dd`; `Date` do
 * JS nunca cruza a fronteira pública para não sofrer deslocamento de
 * timezone (`new Date('2026-01-31')` parseia como UTC e pode "voltar" um
 * dia em fusos negativos). Internamente, string parsing é feito por split
 * puro (sem `Date`); o único uso de `Date`/date-fns é dentro de `clampDay`,
 * com data local sem ambiguidade (`new Date(year, monthIndex0, day)`).
 *
 * Atenção consumidores: os valores monetários retornados já vêm
 * arredondados ao centavo, mas são `number` (double). Ao SOMAR muitos
 * deles, o resultado pode carregar ruído de ponto flutuante (ex.:
 * `1000.0000000000001`) mesmo quando cada parcela individual está correta
 * — compare somas com tolerância (`toBeCloseTo` em teste, ou arredonde) ou,
 * se precisar de exatidão, some em centavos inteiros antes de dividir por 100.
 */

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`
}

function toISODate(year: number, monthIndex0: number, day: number): string {
  return `${year}-${pad2(monthIndex0 + 1)}-${pad2(day)}`
}

/**
 * Clampa `day` para o último dia válido do mês (year, monthIndex0) — ex.:
 * dia 31 em fevereiro vira 28 (ou 29 em ano bissexto). `monthIndex0` é
 * 0-based (janeiro = 0), como `Date.getMonth()`.
 */
export function clampDay(year: number, monthIndex0: number, day: number): string {
  const lastDay = lastDayOfMonth(new Date(year, monthIndex0, 1)).getDate()
  return toISODate(year, monthIndex0, Math.min(day, lastDay))
}

interface DateParts {
  year: number
  monthIndex0: number
  day: number
}

/** Parseia `yyyy-MM-dd` por split puro — nunca via `new Date(string)`. */
function parseISODate(dateStr: string): DateParts {
  const [year, month, day] = dateStr.split('-').map(Number)
  return { year, monthIndex0: month - 1, day }
}

/** Soma `monthsToAdd` meses a (year, monthIndex0), rolando o ano. */
function shiftMonth(year: number, monthIndex0: number, monthsToAdd: number): { year: number; monthIndex0: number } {
  const total = monthIndex0 + monthsToAdd
  const targetYear = year + Math.floor(total / 12)
  const targetMonthIndex0 = ((total % 12) + 12) % 12
  return { year: targetYear, monthIndex0: targetMonthIndex0 }
}

/**
 * Converte um valor em reais para centavos inteiros. `Math.round(value*100)`
 * sozinho mis-arredonda valores cujo double fica ínfimamente abaixo de uma
 * fronteira de meio-centavo — ex.: o literal `35.855` é armazenado como
 * `35.854999999999996874...` (erro de representação binária ~3e-15), então
 * `Math.round(35.855*100)` dá `3585` (35.85) em vez dos `3586` (35.86)
 * esperados. A tolerância de `1e-9` reais é ~6 ordens de grandeza maior que
 * esse erro de representação e ~6 ordens menor que 1 centavo: corrige a
 * fronteira sem afetar arredondamentos genuínos (valores que não estão
 * perto de um meio-centavo).
 */
function toCents(value: number): number {
  const epsilon = value >= 0 ? 1e-9 : -1e-9
  return Math.round(value * 100 + epsilon)
}

function fromCents(cents: number): number {
  return cents / 100
}

function round2(value: number): number {
  return fromCents(toCents(value))
}

/**
 * Divide `total` em `n` parcelas iguais (2 casas decimais); a última parcela
 * absorve o resto do arredondamento, garantindo que a soma seja exatamente
 * `total` (ex.: 5000/3 → 1666.67, 1666.67, 1666.66). Toda a divisão e
 * distribuição do resto é feita em centavos inteiros (aritmética exata,
 * sem ponto flutuante) — só se converte de volta para reais no final,
 * eliminando a classe inteira de erros de arredondamento por soma de
 * doubles intermediários.
 */
function splitEqualInstallments(total: number, n: number): number[] {
  if (n <= 0) return []
  const totalCents = toCents(total)
  const perCents = Math.round(totalCents / n)
  const installmentsCents = new Array(n).fill(perCents) as number[]
  installmentsCents[n - 1] = totalCents - perCents * (n - 1)
  return installmentsCents.map(fromCents)
}

export function generateReceivables(c: ContractInput, opts: GenerateReceivablesOptions): ReceivableEntry[] {
  const entries: ReceivableEntry[] = []

  // SETUP: N parcelas iguais, mensais consecutivas a partir de startDate,
  // preservando o dia original de startDate (com clamp de fim de mês).
  // setupValue = 0 → sem taxa de setup, nenhuma parcela é gerada.
  if (c.setupValue !== 0 && c.setupInstallments > 0) {
    const start = parseISODate(c.startDate)
    const amounts = splitEqualInstallments(c.setupValue, c.setupInstallments)
    amounts.forEach((amount, idx) => {
      const { year, monthIndex0 } = shiftMonth(start.year, start.monthIndex0, idx)
      entries.push({
        kind: 'SETUP',
        amount,
        dueDate: clampDay(year, monthIndex0, start.day),
        description: `Setup ${idx + 1}/${c.setupInstallments}`,
      })
    })
  }

  // MONTHLY: vence no billingDay de cada mês de vigência, começando no mês
  // de startDate se o dia de startDate <= billingDay, senão no mês seguinte.
  // monthlyValue = 0 → contrato sem recorrência, nenhuma mensalidade é gerada.
  if (c.monthlyValue !== 0) {
    const start = parseISODate(c.startDate)
    const firstMonth =
      start.day <= c.billingDay ? { year: start.year, monthIndex0: start.monthIndex0 } : shiftMonth(start.year, start.monthIndex0, 1)

    // Limite do horizonte (só usado quando durationMonths é null): today + horizonMonths,
    // preservando o dia de today. Comparação lexicográfica de strings yyyy-MM-dd
    // é equivalente à cronológica.
    const today = parseISODate(opts.today)
    const horizonEnd = shiftMonth(today.year, today.monthIndex0, opts.horizonMonths)
    const horizonEndDate = clampDay(horizonEnd.year, horizonEnd.monthIndex0, today.day)

    for (let idx = 0; c.durationMonths === null || idx < c.durationMonths; idx++) {
      const { year, monthIndex0 } = shiftMonth(firstMonth.year, firstMonth.monthIndex0, idx)
      const dueDate = clampDay(year, monthIndex0, c.billingDay)

      if (c.durationMonths === null && dueDate >= horizonEndDate) break

      entries.push({
        kind: 'MONTHLY',
        amount: c.monthlyValue,
        dueDate,
        description: 'Mensalidade',
      })
    }
  }

  return entries
}
