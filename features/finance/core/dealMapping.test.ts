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

describe('mapOpenDealForProjection — campos válidos presentes', () => {
  it('lê monthlyValue/durationMonths/expectedClose quando bem formados', () => {
    const out = mapOpenDealForProjection(
      makeDeal({
        customFields: { monthlyValue: 800, durationMonths: 12, expectedClose: '2026-05-10' },
      })
    )
    expect(out.monthlyValue).toBe(800)
    expect(out.durationMonths).toBe(12)
    expect(out.expectedClose).toBe('2026-05-10')
  })
})

describe('mapOpenDealForProjection — campos com tipo inesperado', () => {
  it('monthlyValue string, durationMonths negativo, expectedClose não-ISO → caem nos defaults', () => {
    const out = mapOpenDealForProjection(
      makeDeal({
        customFields: { monthlyValue: '800', durationMonths: -3, expectedClose: '10/05/2026' },
      })
    )
    expect(out.monthlyValue).toBe(0)
    expect(out.durationMonths).toBe(6)
    expect(out.expectedClose).toBeNull()
  })

  it('durationMonths 0 (não positivo) cai no default', () => {
    const out = mapOpenDealForProjection(makeDeal({ customFields: { durationMonths: 0 } }))
    expect(out.durationMonths).toBe(6)
  })

  it('monthlyValue NaN/Infinity cai no default', () => {
    const out = mapOpenDealForProjection(makeDeal({ customFields: { monthlyValue: NaN } }))
    expect(out.monthlyValue).toBe(0)
  })
})
