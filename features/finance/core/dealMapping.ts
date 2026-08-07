import type { OpenDeal } from './types'

/**
 * Núcleo puro de mapeamento de um deal aberto (linha crua da API, Fase 1B
 * Task 9) para o `OpenDeal` que `weightDeals` (./pipeline.ts) espera. Sem
 * I/O, sem `Date.now()`.
 *
 * O schema oficial de `custom_fields` para deals financeiros ainda não
 * existe — a Task 10 vai defini-lo (formulário de deal + parsing dedicado).
 * Até lá, esta função lê defensivamente os 3 campos que faltam em `OpenDeal`
 * (setup `value`/`probability` já vêm direto da linha do deal) e cai em
 * defaults sãos sempre que o campo estiver ausente ou com tipo inesperado —
 * nunca lança, nunca bloqueia a projeção por causa de um deal com
 * `custom_fields` incompleto ou malformado.
 */

/** Shape mínimo de um deal aberto necessário para o mapeamento. */
export interface RawProjectionDeal {
  value: number
  probability: number
  customFields: Record<string, unknown>
}

/** Mensalidade assumida quando o deal ainda não tem `custom_fields.monthlyValue` numérico. */
const DEFAULT_MONTHLY_VALUE = 0
/** Duração assumida quando o deal ainda não tem `custom_fields.durationMonths` numérico > 0. */
const DEFAULT_DURATION_MONTHS = 6

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * TODO(Task 10): substituir esta leitura defensiva pelo parsing oficial de
 * `custom_fields.monthlyValue` / `durationMonths` / `expectedClose` assim
 * que o schema desses campos for fechado (form de deal + validação). Até
 * lá, um deal sem esses campos (todo deal hoje, já que nada os popula ainda)
 * pondera no pipeline como setup-only com duração padrão de 6 meses — não é
 * "correto" a longo prazo, mas mantém o dashboard funcional em vez de
 * bloqueado à espera da Task 10.
 */
export function mapOpenDealForProjection(deal: RawProjectionDeal): OpenDeal {
  const cf = deal.customFields ?? {}

  const monthlyValue =
    typeof cf.monthlyValue === 'number' && Number.isFinite(cf.monthlyValue) ? cf.monthlyValue : DEFAULT_MONTHLY_VALUE

  const durationMonths =
    typeof cf.durationMonths === 'number' && Number.isFinite(cf.durationMonths) && cf.durationMonths > 0
      ? cf.durationMonths
      : DEFAULT_DURATION_MONTHS

  const expectedClose = typeof cf.expectedClose === 'string' && ISO_DATE_RE.test(cf.expectedClose) ? cf.expectedClose : null

  return {
    value: deal.value,
    probability: deal.probability,
    monthlyValue,
    durationMonths,
    expectedClose,
  }
}
