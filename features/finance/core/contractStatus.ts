import { addMonths, addDays, subDays, differenceInCalendarDays, parseISO, format } from 'date-fns'
import type { ReceivableEntry } from './types'

/**
 * Núcleo puro de UI-derivations sobre contrato (Fase 1B, Task 7). Sem I/O,
 * sem `Date.now()` — `today` é sempre parâmetro. Datas cruzam a fronteira
 * pública sempre como string `yyyy-MM-dd`. Internamente usa `date-fns`
 * (`parseISO`/`format`), que — diferente de `new Date(string)` — parseia
 * datas `yyyy-MM-dd` em componentes locais, sem passar por UTC; não sofre o
 * deslocamento de timezone documentado em `receivables.ts`.
 *
 * FIX (achado da revisão pós-Task 7): `computeContractEndDate` já foi uma
 * fórmula de calendário independente ("soma N meses, subtrai 1 dia") que
 * clampava fim de mês diferente do clamp por `billingDay` usado por
 * `generateReceivables` pra gerar as mensalidades de verdade. As duas
 * fórmulas discordavam exatamente quando ambas precisavam clampar fim de
 * mês no MESMO mês-alvo (ex.: início 29/01, duração 1, billingDay 28 — a
 * única mensalidade vence em 28/02, mas a fórmula de calendário achava que
 * a vigência terminava em 27/02) — na renovação isso prefillava um início
 * que colidia com a última cobrança do contrato anterior: cliente cobrado
 * duas vezes no mesmo dia. Agora TUDO que precisa do "fim do contrato"
 * deriva dos recebíveis REALMENTE gerados por `generateReceivables` (mesma
 * função, única fonte de verdade) — nunca mais uma fórmula paralela.
 */

/** Due date do recebível `MONTHLY` mais tardio entre `receivables`, ou `null` se não houver nenhum. */
export function lastMonthlyDueDate(receivables: ReceivableEntry[]): string | null {
  const dates = receivables.filter(r => r.kind === 'MONTHLY').map(r => r.dueDate)
  if (dates.length === 0) return null
  return dates.reduce((latest, d) => (d > latest ? d : latest))
}

/** Due date do recebível mais tardio entre `receivables`, de qualquer `kind` (setup ou mensalidade), ou `null` se vazio. */
export function lastReceivableDueDate(receivables: ReceivableEntry[]): string | null {
  if (receivables.length === 0) return null
  return receivables.reduce((latest, r) => (r.dueDate > latest ? r.dueDate : latest), receivables[0].dueDate)
}

/**
 * Último dia (inclusive) da vigência de um contrato de duração finita, ou
 * `null` se indeterminado (`durationMonths === null` — nunca "termina").
 * Fonte de verdade: o recebível `MONTHLY` mais tardio de `receivables`
 * (produzido por `generateReceivables` com os MESMOS dados do contrato) —
 * é a "realidade de cobrança" de fato, não uma fórmula de calendário
 * paralela. Só cai no cálculo por calendário (soma `durationMonths` meses a
 * partir de `startDate`, clampado, menos 1 dia) quando o contrato não tem
 * NENHUMA mensalidade gerada (`monthlyValue === 0`, contrato só de setup)
 * — nesse caso não há cadência mensal real de onde derivar, mas também não
 * há risco de colisão de cobrança na renovação (ver `lastReceivableDueDate`
 * pra esse caso, usado no cálculo de início de renovação).
 *
 * @example
 * ```typescript
 * // Início 29/01, duração 1 mês, billingDay 28: única mensalidade vence
 * // 28/02 (dia 29 > 28 desloca pro mês seguinte, clampado a 28) — o fim
 * // reflete isso, não um cálculo de calendário independente.
 * computeContractEndDate('2026-01-29', 1, receivables) // '2026-02-28'
 * computeContractEndDate('2026-01-15', null, receivables) // null
 * ```
 */
export function computeContractEndDate(
  startDate: string,
  durationMonths: number | null,
  receivables: ReceivableEntry[]
): string | null {
  if (durationMonths === null) return null
  const monthlyEnd = lastMonthlyDueDate(receivables)
  if (monthlyEnd) return monthlyEnd
  const start = parseISO(startDate)
  return format(subDays(addMonths(start, durationMonths), 1), 'yyyy-MM-dd')
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

/** Data de início do contrato de renovação: o dia seguinte ao recebível mais tardio (qualquer kind) do contrato anterior. */
export function computeRenewalStartDate(previousLastDueDate: string): string {
  return format(addDays(parseISO(previousLastDueDate), 1), 'yyyy-MM-dd')
}

/**
 * Guard anti-duplicidade de renovação (belt and braces): `true` quando a
 * data de início EFETIVA do form de renovação — depois de tudo que o
 * usuário possa ter editado (contato, valores, duração, dia de cobrança) —
 * gera um recebível cujo `dueDate` mais cedo colide (é igual ou anterior)
 * com o `dueDate` mais tardio do contrato anterior. O prefill de
 * `computeRenewalStartDate` já evita isso no caminho feliz, mas o usuário
 * pode editar a data/dia de cobrança livremente antes de salvar — por
 * isso este check tem que rodar de novo no submit, não só no prefill.
 */
export function collidesWithPreviousContract(
  newReceivables: ReceivableEntry[],
  previousLastDueDate: string | null
): boolean {
  if (!previousLastDueDate || newReceivables.length === 0) return false
  const earliestNew = newReceivables.reduce((min, r) => (r.dueDate < min ? r.dueDate : min), newReceivables[0].dueDate)
  return earliestNew <= previousLastDueDate
}
