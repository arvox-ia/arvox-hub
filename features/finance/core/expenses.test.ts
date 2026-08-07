import { describe, expect, it } from 'vitest'
import { generateFixedExpenseEntries, sumByCategory } from './expenses'

describe('generateFixedExpenseEntries', () => {
  it('gera um lançamento por mês, no dueDay informado, pelo número de meses pedido', () => {
    const out = generateFixedExpenseEntries(
      { amount: 1200, dueDay: 28, expenseId: 'exp-1' },
      { fromMonth: '2026-01', months: 3 }
    )

    expect(out).toEqual([
      { dueDate: '2026-01-28', amount: 1200, expenseId: 'exp-1' },
      { dueDate: '2026-02-28', amount: 1200, expenseId: 'exp-1' },
      { dueDate: '2026-03-28', amount: 1200, expenseId: 'exp-1' },
    ])
  })

  it('atravessa virada de ano corretamente', () => {
    const out = generateFixedExpenseEntries(
      { amount: 300, dueDay: 10, expenseId: 'exp-2' },
      { fromMonth: '2026-11', months: 4 }
    )

    expect(out.map((e) => e.dueDate)).toEqual(['2026-11-10', '2026-12-10', '2027-01-10', '2027-02-10'])
  })

  it('clampa dueDay 31 para o último dia de fevereiro (não-bissexto)', () => {
    const out = generateFixedExpenseEntries(
      { amount: 50, dueDay: 31, expenseId: 'exp-3' },
      { fromMonth: '2026-02', months: 1 }
    )

    expect(out).toEqual([{ dueDate: '2026-02-28', amount: 50, expenseId: 'exp-3' }])
  })

  it('clampa dueDay 31 para o último dia de fevereiro bissexto (29)', () => {
    const out = generateFixedExpenseEntries(
      { amount: 50, dueDay: 31, expenseId: 'exp-4' },
      { fromMonth: '2028-02', months: 1 }
    )

    expect(out).toEqual([{ dueDate: '2028-02-29', amount: 50, expenseId: 'exp-4' }])
  })

  it('months = 0 não gera nenhum lançamento', () => {
    const out = generateFixedExpenseEntries(
      { amount: 100, dueDay: 5, expenseId: 'exp-5' },
      { fromMonth: '2026-01', months: 0 }
    )

    expect(out).toEqual([])
  })

  it('carrega o expenseId da regra em cada lançamento gerado (seam com o core de projeção)', () => {
    const out = generateFixedExpenseEntries(
      { amount: 900, dueDay: 15, expenseId: 'expense-abc' },
      { fromMonth: '2026-05', months: 2 }
    )

    expect(out.every((e) => e.expenseId === 'expense-abc')).toBe(true)
  })
})

describe('sumByCategory', () => {
  it('soma valores agrupados por categoria', () => {
    const out = sumByCategory([
      { category: 'Ferramentas & APIs', amount: 100 },
      { category: 'Impostos', amount: 200 },
      { category: 'Ferramentas & APIs', amount: 50 },
    ])

    expect(out).toEqual({ 'Ferramentas & APIs': 150, Impostos: 200 })
  })

  it('lista vazia retorna objeto vazio', () => {
    expect(sumByCategory([])).toEqual({})
  })

  it('uma única categoria acumula corretamente', () => {
    const out = sumByCategory([
      { category: 'Outros', amount: 10 },
      { category: 'Outros', amount: 20 },
      { category: 'Outros', amount: 30 },
    ])

    expect(out).toEqual({ Outros: 60 })
  })
})
