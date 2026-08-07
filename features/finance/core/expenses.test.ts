import { describe, expect, it } from 'vitest'
import { generateFixedExpenseEntries } from './expenses'

describe('generateFixedExpenseEntries', () => {
  it('gera um lançamento por mês, no dueDay informado, pelo número de meses pedido', () => {
    const out = generateFixedExpenseEntries({ amount: 1200, dueDay: 28 }, { fromMonth: '2026-01', months: 3 })

    expect(out).toEqual([
      { dueDate: '2026-01-28', amount: 1200 },
      { dueDate: '2026-02-28', amount: 1200 },
      { dueDate: '2026-03-28', amount: 1200 },
    ])
  })

  it('atravessa virada de ano corretamente', () => {
    const out = generateFixedExpenseEntries({ amount: 300, dueDay: 10 }, { fromMonth: '2026-11', months: 4 })

    expect(out.map((e) => e.dueDate)).toEqual(['2026-11-10', '2026-12-10', '2027-01-10', '2027-02-10'])
  })

  it('clampa dueDay 31 para o último dia de fevereiro (não-bissexto)', () => {
    const out = generateFixedExpenseEntries({ amount: 50, dueDay: 31 }, { fromMonth: '2026-02', months: 1 })

    expect(out).toEqual([{ dueDate: '2026-02-28', amount: 50 }])
  })

  it('clampa dueDay 31 para o último dia de fevereiro bissexto (29)', () => {
    const out = generateFixedExpenseEntries({ amount: 50, dueDay: 31 }, { fromMonth: '2028-02', months: 1 })

    expect(out).toEqual([{ dueDate: '2028-02-29', amount: 50 }])
  })

  it('months = 0 não gera nenhum lançamento', () => {
    const out = generateFixedExpenseEntries({ amount: 100, dueDay: 5 }, { fromMonth: '2026-01', months: 0 })

    expect(out).toEqual([])
  })
})
