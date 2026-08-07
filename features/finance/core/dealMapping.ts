import type { OpenDeal } from './types'
import { parseDealFinanceFields } from './dealFields'

/**
 * Núcleo puro de mapeamento de um deal aberto (linha crua da API) para o
 * `OpenDeal` que `weightDeals` (./pipeline.ts) espera. Sem I/O, sem
 * `Date.now()`.
 *
 * A Task 9 criou este mapper com defaults provisórios (schema de
 * `custom_fields` ainda não existia). A Task 10 fechou a convenção real de
 * chaves — ver o comentário de arquivo de `./dealFields.ts`, a ÚNICA fonte
 * de verdade dela — e este mapper agora só repassa `value`/`probability`
 * (que já vêm direto da linha do deal) e delega o parsing dos 3 campos
 * financeiros para `parseDealFinanceFields`.
 */

/** Shape mínimo de um deal aberto necessário para o mapeamento. */
export interface RawProjectionDeal {
  value: number
  probability: number
  customFields: Record<string, unknown>
}

export function mapOpenDealForProjection(deal: RawProjectionDeal): OpenDeal {
  const { monthlyValue, durationMonths, expectedClose } = parseDealFinanceFields(deal.customFields)

  return {
    value: deal.value,
    probability: deal.probability,
    monthlyValue,
    durationMonths,
    expectedClose,
  }
}
