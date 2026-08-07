import { addMonths, addDays, subDays, differenceInCalendarDays, parseISO, format } from 'date-fns'

/**
 * Núcleo puro de UI-derivations sobre contrato (Fase 1B, Task 7). Sem I/O,
 * sem `Date.now()` — `today` é sempre parâmetro. Datas cruzam a fronteira
 * pública sempre como string `yyyy-MM-dd`. Internamente usa `date-fns`
 * (`parseISO`/`format`), que — diferente de `new Date(string)` — parseia
 * datas `yyyy-MM-dd` em componentes locais, sem passar por UTC; não sofre o
 * deslocamento de timezone documentado em `receivables.ts`.
 */

/**
 * Último dia (inclusive) da vigência de um contrato, ou `null` se
 * indeterminado. `durationMonths` meses a partir de `startDate`, mesmo dia
 * do mês (clampado pelo calendário — ex.: 31/01 + 1 mês vira 28 ou 29/02),
 * menos 1 dia.
 *
 * @example
 * ```typescript
 * computeContractEndDate('2026-01-15', 3) // '2026-04-14'
 * computeContractEndDate('2026-01-15', null) // null
 * ```
 */
export function computeContractEndDate(startDate: string, durationMonths: number | null): string | null {
  if (durationMonths === null) return null
  const start = parseISO(startDate)
  const end = subDays(addMonths(start, durationMonths), 1)
  return format(end, 'yyyy-MM-dd')
}

/** Diferença em dias de calendário entre `dateStr` e `today` (positivo = no futuro). */
export function daysUntil(dateStr: string, today: string): number {
  return differenceInCalendarDays(parseISO(dateStr), parseISO(today))
}

/**
 * `true` quando `endDate` está a até `thresholdDays` dias no futuro
 * (inclusive hoje e o próprio limiar), usado pelo badge "vence em Xd" da
 * lista de contratos. Contratos indeterminados (`endDate === null`) ou já
 * vencidos nunca contam como "vencendo em breve" aqui — vencido é outro
 * estado (tratado separadamente pela UI).
 */
export function isEndingSoon(endDate: string | null, today: string, thresholdDays = 30): boolean {
  if (!endDate) return false
  const days = daysUntil(endDate, today)
  return days >= 0 && days <= thresholdDays
}

/** Data de início do contrato de renovação: o dia seguinte ao fim do contrato anterior. */
export function computeRenewalStartDate(previousEndDate: string): string {
  return format(addDays(parseISO(previousEndDate), 1), 'yyyy-MM-dd')
}
