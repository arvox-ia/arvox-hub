import { describe, expect, it } from 'vitest'
import { clampDay, generateReceivables } from './receivables'
import type { ContractInput } from './types'

/** Contrato-base para os testes; cada teste sobrescreve só o que precisa. */
function makeContract(overrides: Partial<ContractInput> = {}): ContractInput {
  return {
    setupValue: 0,
    setupInstallments: 1,
    monthlyValue: 0,
    startDate: '2026-01-01',
    durationMonths: null,
    billingDay: 5,
    ...overrides,
  }
}

describe('clampDay', () => {
  it('clampa dia 31 para o último dia de fevereiro (não-bissexto)', () => {
    expect(clampDay(2026, 1, 31)).toBe('2026-02-28')
  })

  it('clampa dia 30 para 29 em fevereiro bissexto', () => {
    expect(clampDay(2028, 1, 30)).toBe('2028-02-29')
  })

  it('não altera um dia já válido no mês', () => {
    expect(clampDay(2026, 0, 15)).toBe('2026-01-15')
  })

  it('preserva dia 31 em mês de 31 dias', () => {
    expect(clampDay(2026, 2, 31)).toBe('2026-03-31')
  })
})

describe('generateReceivables — SETUP', () => {
  it('divide setup de R$5000 em 3 parcelas, última absorve o resto do arredondamento', () => {
    const contract = makeContract({ setupValue: 5000, setupInstallments: 3, startDate: '2026-01-10' })
    const out = generateReceivables(contract, { horizonMonths: 12, today: '2026-01-01' })
    const setup = out.filter((e) => e.kind === 'SETUP')

    expect(setup).toHaveLength(3)
    expect(setup.map((e) => e.amount)).toEqual([1666.67, 1666.67, 1666.66])
    // soma exata do valor total, sem drift de ponto flutuante
    expect(setup.reduce((sum, e) => sum + e.amount, 0)).toBeCloseTo(5000, 2)
  })

  it('parcelas de setup são mensais consecutivas a partir de startDate, com clamp de fim de mês', () => {
    const contract = makeContract({ setupValue: 300, setupInstallments: 3, startDate: '2026-01-31' })
    const out = generateReceivables(contract, { horizonMonths: 12, today: '2026-01-01' })
    const setup = out.filter((e) => e.kind === 'SETUP')

    expect(setup.map((e) => e.dueDate)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31'])
  })

  it('setup de parcela única cobre o valor cheio, sem resto', () => {
    const contract = makeContract({ setupValue: 1200, setupInstallments: 1, startDate: '2026-03-05' })
    const out = generateReceivables(contract, { horizonMonths: 12, today: '2026-01-01' })
    const setup = out.filter((e) => e.kind === 'SETUP')

    expect(setup).toEqual([
      { kind: 'SETUP', amount: 1200, dueDate: '2026-03-05', description: 'Setup 1/1' },
    ])
  })

  it('setupValue = 0 não gera nenhuma parcela de setup (contrato só com mensalidade)', () => {
    const contract = makeContract({ setupValue: 0, setupInstallments: 3, monthlyValue: 500, durationMonths: 2 })
    const out = generateReceivables(contract, { horizonMonths: 12, today: '2026-01-01' })

    expect(out.some((e) => e.kind === 'SETUP')).toBe(false)
    expect(out.every((e) => e.kind === 'MONTHLY')).toBe(true)
  })

  it('arredonda corretamente um valor no limite do meio-centavo (35.855 → 35.86, não 35.85)', () => {
    // O double do literal 35.855 é armazenado como 35.854999999999996874...,
    // então um Math.round(value*100) ingênuo arredondaria para baixo.
    const contract = makeContract({ setupValue: 35.855, setupInstallments: 1, startDate: '2026-01-05' })
    const out = generateReceivables(contract, { horizonMonths: 12, today: '2026-01-01' })
    const setup = out.filter((e) => e.kind === 'SETUP')

    expect(setup.map((e) => e.amount)).toEqual([35.86])
  })

  it('divide setup de R$1000 em 7 parcelas: soma exata em centavos, sem drift de doubles', () => {
    const contract = makeContract({ setupValue: 1000, setupInstallments: 7, startDate: '2026-01-05' })
    const out = generateReceivables(contract, { horizonMonths: 12, today: '2026-01-01' })
    const setup = out.filter((e) => e.kind === 'SETUP')

    expect(setup.map((e) => e.amount)).toEqual([142.86, 142.86, 142.86, 142.86, 142.86, 142.86, 142.84])
    expect(setup.reduce((sum, e) => sum + e.amount, 0)).toBeCloseTo(1000, 2)
  })

  it('divide setup de R$0,10 em 3 parcelas: soma exata em centavos', () => {
    const contract = makeContract({ setupValue: 0.1, setupInstallments: 3, startDate: '2026-01-05' })
    const out = generateReceivables(contract, { horizonMonths: 12, today: '2026-01-01' })
    const setup = out.filter((e) => e.kind === 'SETUP')

    expect(setup.map((e) => e.amount)).toEqual([0.03, 0.03, 0.04])
    expect(setup.reduce((sum, e) => sum + e.amount, 0)).toBeCloseTo(0.1, 2)
  })
})

describe('generateReceivables — MONTHLY', () => {
  it('contrato de 6 meses iniciando 2026-01-31 com billingDay 5: 1ª mensalidade em 2026-02-05', () => {
    const contract = makeContract({
      startDate: '2026-01-31',
      billingDay: 5,
      monthlyValue: 1000,
      durationMonths: 6,
    })
    const out = generateReceivables(contract, { horizonMonths: 12, today: '2026-01-01' })
    const monthly = out.filter((e) => e.kind === 'MONTHLY')

    expect(monthly).toHaveLength(6)
    expect(monthly.map((e) => e.dueDate)).toEqual([
      '2026-02-05',
      '2026-03-05',
      '2026-04-05',
      '2026-05-05',
      '2026-06-05',
      '2026-07-05',
    ])
    expect(monthly.every((e) => e.amount === 1000)).toBe(true)
  })

  it('startDate dia 3 com billingDay 5: 1ª mensalidade cai no mesmo mês de startDate', () => {
    const contract = makeContract({
      startDate: '2026-03-03',
      billingDay: 5,
      monthlyValue: 800,
      durationMonths: 1,
    })
    const out = generateReceivables(contract, { horizonMonths: 12, today: '2026-01-01' })
    const monthly = out.filter((e) => e.kind === 'MONTHLY')

    expect(monthly).toEqual([
      { kind: 'MONTHLY', amount: 800, dueDate: '2026-03-05', description: 'Mensalidade' },
    ])
  })

  it('durationMonths indeterminado (null) com horizonMonths=12 gera 12 mensalidades', () => {
    const contract = makeContract({
      startDate: '2026-01-01',
      billingDay: 1,
      monthlyValue: 300,
      durationMonths: null,
    })
    const out = generateReceivables(contract, { horizonMonths: 12, today: '2026-01-01' })
    const monthly = out.filter((e) => e.kind === 'MONTHLY')

    expect(monthly).toHaveLength(12)
    expect(monthly[0].dueDate).toBe('2026-01-01')
    expect(monthly[11].dueDate).toBe('2026-12-01')
  })

  it('mensalidades atravessam virada de ano corretamente', () => {
    const contract = makeContract({
      startDate: '2026-11-15',
      billingDay: 20,
      monthlyValue: 450,
      durationMonths: 4,
    })
    const out = generateReceivables(contract, { horizonMonths: 12, today: '2026-01-01' })
    const monthly = out.filter((e) => e.kind === 'MONTHLY')

    expect(monthly.map((e) => e.dueDate)).toEqual([
      '2026-11-20',
      '2026-12-20',
      '2027-01-20',
      '2027-02-20',
    ])
  })

  it('monthlyValue = 0 não gera nenhuma mensalidade (contrato só com setup)', () => {
    const contract = makeContract({ setupValue: 900, setupInstallments: 3, monthlyValue: 0, durationMonths: 6 })
    const out = generateReceivables(contract, { horizonMonths: 12, today: '2026-01-01' })

    expect(out.every((e) => e.kind === 'SETUP')).toBe(true)
    expect(out.filter((e) => e.kind === 'MONTHLY')).toHaveLength(0)
  })

  it('durationMonths = 1 gera exatamente uma mensalidade', () => {
    const contract = makeContract({
      startDate: '2026-05-01',
      billingDay: 10,
      monthlyValue: 250,
      durationMonths: 1,
    })
    const out = generateReceivables(contract, { horizonMonths: 12, today: '2026-01-01' })
    const monthly = out.filter((e) => e.kind === 'MONTHLY')

    expect(monthly).toHaveLength(1)
    expect(monthly[0].dueDate).toBe('2026-05-10')
  })

  it('parcela de setup pode cair em fevereiro bissexto sem estourar o mês', () => {
    const contract = makeContract({
      setupValue: 100,
      setupInstallments: 2,
      startDate: '2028-01-30',
    })
    const out = generateReceivables(contract, { horizonMonths: 12, today: '2028-01-01' })
    const setup = out.filter((e) => e.kind === 'SETUP')

    expect(setup.map((e) => e.dueDate)).toEqual(['2028-01-30', '2028-02-29'])
  })
})

describe('generateReceivables — combinação setup + mensal', () => {
  it('contrato com setup e mensalidade gera as duas séries juntas, com datas e valores corretos', () => {
    const contract = makeContract({
      setupValue: 1000,
      setupInstallments: 2,
      startDate: '2026-01-01',
      billingDay: 15,
      monthlyValue: 500,
      durationMonths: 2,
    })
    const out = generateReceivables(contract, { horizonMonths: 12, today: '2026-01-01' })

    expect(out).toEqual([
      { kind: 'SETUP', amount: 500, dueDate: '2026-01-01', description: 'Setup 1/2' },
      { kind: 'SETUP', amount: 500, dueDate: '2026-02-01', description: 'Setup 2/2' },
      { kind: 'MONTHLY', amount: 500, dueDate: '2026-01-15', description: 'Mensalidade' },
      { kind: 'MONTHLY', amount: 500, dueDate: '2026-02-15', description: 'Mensalidade' },
    ])
  })
})
