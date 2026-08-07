import { describe, expect, it } from 'vitest'
import { weightDeals } from './pipeline'
import type { OpenDeal, WeightDealsOptions } from './types'

/** Deal-base para os testes; cada teste sobrescreve só o que precisa. */
function makeDeal(overrides: Partial<OpenDeal> = {}): OpenDeal {
  return {
    value: 0,
    probability: 100,
    monthlyValue: 0,
    durationMonths: 0,
    expectedClose: null,
    ...overrides,
  }
}

function makeOpts(overrides: Partial<WeightDealsOptions> = {}): WeightDealsOptions {
  return {
    today: '2026-01-15',
    horizonMonths: 12,
    defaultCloseDays: 30,
    assumedBillingDay: 5,
    ...overrides,
  }
}

describe('weightDeals — entrada vazia', () => {
  it('nenhum deal → mapa vazio', () => {
    expect(weightDeals([], makeOpts())).toEqual({})
  })
})

describe('weightDeals — expectedClose ausente', () => {
  it('deal sem expectedClose fecha em today + defaultCloseDays (30 dias)', () => {
    const deal = makeDeal({ value: 1000, probability: 100, expectedClose: null })
    // today 2026-01-15 + 30 dias = 2026-02-14 → mês 2026-02
    const out = weightDeals([deal], makeOpts({ today: '2026-01-15', defaultCloseDays: 30 }))

    expect(out).toEqual({ '2026-02': 1000 })
  })
})

describe('weightDeals — probability 0', () => {
  it('deal com probability 0 não contribui em nada', () => {
    const deal = makeDeal({
      value: 1000,
      probability: 0,
      monthlyValue: 500,
      durationMonths: 3,
      expectedClose: '2026-03-01',
    })
    const out = weightDeals([deal], makeOpts())

    expect(out).toEqual({})
  })
})

describe('weightDeals — setup', () => {
  it('setup contribui value × probability/100 no mês de fechamento', () => {
    const deal = makeDeal({ value: 2000, probability: 50, expectedClose: '2026-04-01' })
    const out = weightDeals([deal], makeOpts())

    expect(out).toEqual({ '2026-04': 1000 })
  })
})

describe('weightDeals — mensalidade', () => {
  it('mensalidade contribui monthlyValue × probability/100 nos durationMonths meses APÓS o mês de fechamento (mês de fechamento não recebe mensalidade)', () => {
    const deal = makeDeal({
      value: 0,
      probability: 100,
      monthlyValue: 300,
      durationMonths: 3,
      expectedClose: '2026-01-10',
    })
    const out = weightDeals([deal], makeOpts())

    // Mês de fechamento (2026-01) não aparece: setup=0 e mensalidade só começa depois.
    expect(out).toEqual({ '2026-02': 300, '2026-03': 300, '2026-04': 300 })
  })

  it('setup e mensalidade ponderados juntos, no mesmo deal (fechamento além do assumedBillingDay)', () => {
    const deal = makeDeal({
      value: 1000,
      probability: 50,
      monthlyValue: 200,
      durationMonths: 2,
      expectedClose: '2026-05-20', // dia 20 > assumedBillingDay (5) → mensalidade só no mês seguinte
    })
    const out = weightDeals([deal], makeOpts())

    expect(out).toEqual({ '2026-05': 500, '2026-06': 100, '2026-07': 100 })
  })
})

describe('weightDeals — onset da mensalidade alinhado ao contrato real (assumedBillingDay)', () => {
  it('fechamento no dia 3 (<= assumedBillingDay): mensalidade começa no PRÓPRIO mês de fechamento — mesma regra de generateReceivables (Task 3)', () => {
    const deal = makeDeal({
      value: 0,
      probability: 100,
      monthlyValue: 200,
      durationMonths: 2,
      expectedClose: '2026-03-03',
    })
    const out = weightDeals([deal], makeOpts({ assumedBillingDay: 5 }))

    expect(out).toEqual({ '2026-03': 200, '2026-04': 200 })
  })

  it('fechamento no dia 20 (> assumedBillingDay): mensalidade começa no mês SEGUINTE ao fechamento', () => {
    const deal = makeDeal({
      value: 0,
      probability: 100,
      monthlyValue: 200,
      durationMonths: 2,
      expectedClose: '2026-03-20',
    })
    const out = weightDeals([deal], makeOpts({ assumedBillingDay: 5 }))

    expect(out).toEqual({ '2026-04': 200, '2026-05': 200 })
  })

  it('assumedBillingDay é parametrizável: dia 15 com assumedBillingDay 20 ainda cai no ramo "mesmo mês"', () => {
    const deal = makeDeal({
      value: 0,
      probability: 100,
      monthlyValue: 200,
      durationMonths: 1,
      expectedClose: '2026-03-15',
    })
    const out = weightDeals([deal], makeOpts({ assumedBillingDay: 20 }))

    expect(out).toEqual({ '2026-03': 200 })
  })
})

describe('weightDeals — horizonte', () => {
  it('deal fechando exatamente no último mês do horizonte é incluído', () => {
    const deal = makeDeal({ value: 100, probability: 100, expectedClose: '2026-03-15' })
    const out = weightDeals([deal], makeOpts({ today: '2026-01-01', horizonMonths: 3 }))

    expect(out).toEqual({ '2026-03': 100 })
  })

  it('deal fechando um mês além do horizonte não contribui nada', () => {
    const deal = makeDeal({ value: 100, probability: 100, expectedClose: '2026-04-01' })
    const out = weightDeals([deal], makeOpts({ today: '2026-01-01', horizonMonths: 3 }))

    expect(out).toEqual({})
  })

  it('mensalidade é truncada no limite do horizonte (meses além do horizonte são descartados, não o deal inteiro)', () => {
    const deal = makeDeal({
      value: 0,
      probability: 100,
      monthlyValue: 100,
      durationMonths: 3,
      expectedClose: '2026-02-10', // dia 10 > assumedBillingDay (5): isola o teste ao horizonte, sem misturar com o onset
    })
    // horizonte = 2026-01..2026-03. Mensalidade cairia em mar/abr/mai; só mar está no horizonte.
    const out = weightDeals([deal], makeOpts({ today: '2026-01-01', horizonMonths: 3 }))

    expect(out).toEqual({ '2026-03': 100 })
  })
})

describe('weightDeals — múltiplos deals', () => {
  it('soma contribuições de deals diferentes que caem no mesmo mês', () => {
    const dealA = makeDeal({ value: 1000, probability: 100, expectedClose: '2026-06-01' })
    const dealB = makeDeal({ value: 500, probability: 100, expectedClose: '2026-06-15' })
    const out = weightDeals([dealA, dealB], makeOpts())

    expect(out).toEqual({ '2026-06': 1500 })
  })
})
