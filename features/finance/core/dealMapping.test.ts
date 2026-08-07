import { describe, expect, it } from 'vitest'
import { mapOpenDealForProjection } from './dealMapping'
import type { RawProjectionDeal } from './dealMapping'

function makeDeal(overrides: Partial<RawProjectionDeal> = {}): RawProjectionDeal {
  return {
    value: 1000,
    probability: 50,
    customFields: {},
    ...overrides,
  }
}

describe('mapOpenDealForProjection — value/probability', () => {
  it('repassa value e probability direto da linha do deal', () => {
    const out = mapOpenDealForProjection(makeDeal({ value: 2500, probability: 80 }))
    expect(out.value).toBe(2500)
    expect(out.probability).toBe(80)
  })
})

describe('mapOpenDealForProjection — defaults quando custom_fields ausente', () => {
  it('customFields vazio → monthlyValue 0, durationMonths 6, expectedClose null', () => {
    const out = mapOpenDealForProjection(makeDeal({ customFields: {} }))
    expect(out.monthlyValue).toBe(0)
    expect(out.durationMonths).toBe(6)
    expect(out.expectedClose).toBeNull()
  })
})

describe('mapOpenDealForProjection — campos válidos presentes (convenção real, ver dealFields.ts)', () => {
  it('lê valorMensal/duracaoMeses/previsaoFechamento quando bem formados (valores number)', () => {
    const out = mapOpenDealForProjection(
      makeDeal({
        customFields: { valorMensal: 800, duracaoMeses: 12, previsaoFechamento: '2026-05-10' },
      })
    )
    expect(out.monthlyValue).toBe(800)
    expect(out.durationMonths).toBe(12)
    expect(out.expectedClose).toBe('2026-05-10')
  })

  it('lê os mesmos campos quando vêm como string (formato real do <input> da UI de deals)', () => {
    const out = mapOpenDealForProjection(
      makeDeal({
        customFields: { valorMensal: '800', duracaoMeses: '12', previsaoFechamento: '2026-05-10' },
      })
    )
    expect(out.monthlyValue).toBe(800)
    expect(out.durationMonths).toBe(12)
    expect(out.expectedClose).toBe('2026-05-10')
  })
})

describe('mapOpenDealForProjection — campos com tipo/valor inesperado', () => {
  it('duracaoMeses negativo e previsaoFechamento não-ISO caem nos defaults', () => {
    const out = mapOpenDealForProjection(
      makeDeal({
        customFields: { valorMensal: '800', duracaoMeses: -3, previsaoFechamento: '10/05/2026' },
      })
    )
    expect(out.monthlyValue).toBe(800)
    expect(out.durationMonths).toBe(6)
    expect(out.expectedClose).toBeNull()
  })

  it('duracaoMeses 0 (não positivo) cai no default', () => {
    const out = mapOpenDealForProjection(makeDeal({ customFields: { duracaoMeses: 0 } }))
    expect(out.durationMonths).toBe(6)
  })

  it('valorMensal NaN/Infinity/negativo cai no default', () => {
    expect(mapOpenDealForProjection(makeDeal({ customFields: { valorMensal: NaN } })).monthlyValue).toBe(0)
    expect(mapOpenDealForProjection(makeDeal({ customFields: { valorMensal: Infinity } })).monthlyValue).toBe(0)
    expect(mapOpenDealForProjection(makeDeal({ customFields: { valorMensal: -50 } })).monthlyValue).toBe(0)
  })

  it('valorMensal não-numérico cai no default', () => {
    expect(mapOpenDealForProjection(makeDeal({ customFields: { valorMensal: 'abc' } })).monthlyValue).toBe(0)
  })
})
