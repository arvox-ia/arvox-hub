import { describe, expect, it } from 'vitest'
import { buildProjection } from './projection'
import type { ProjectionInput } from './types'

/** Input-base para os testes; cada teste sobrescreve só o que precisa. */
function makeInput(overrides: Partial<ProjectionInput> = {}): ProjectionInput {
  return {
    months: ['2026-01'],
    receivables: [],
    expenseEntries: [],
    fixedRules: [],
    weighted: {},
    taxRate: 0,
    initialBalance: 0,
    ...overrides,
  }
}

describe('buildProjection — entrada vazia', () => {
  it('months vazio → nenhum ponto', () => {
    expect(buildProjection(makeInput({ months: [] }))).toEqual([])
  })
})

describe('buildProjection — contracted e probable', () => {
  it('contracted soma recebíveis por mês de vencimento; probable = contracted + pipeline ponderado do mês', () => {
    const input = makeInput({
      months: ['2026-01'],
      receivables: [
        { dueDate: '2026-01-05', amount: 600 },
        { dueDate: '2026-01-20', amount: 400 },
      ],
      weighted: { '2026-01': 500 },
    })
    const [point] = buildProjection(input)

    expect(point.contracted).toBe(1000)
    expect(point.probable).toBe(1500)
  })

  it('mês sem entrada no pipeline ponderado: probable = contracted', () => {
    const input = makeInput({
      months: ['2026-01'],
      receivables: [{ dueDate: '2026-01-05', amount: 300 }],
      weighted: {},
    })
    const [point] = buildProjection(input)

    expect(point.contracted).toBe(300)
    expect(point.probable).toBe(300)
  })

  it('recebível fora do mês da projeção não é contado', () => {
    const input = makeInput({
      months: ['2026-01'],
      receivables: [{ dueDate: '2026-02-05', amount: 999 }],
    })
    const [point] = buildProjection(input)

    expect(point.contracted).toBe(0)
  })
})

describe('buildProjection — provisão de imposto', () => {
  it('taxRate 0 → taxProvision zerada e saldo = receita − despesas', () => {
    const input = makeInput({
      months: ['2026-01'],
      receivables: [{ dueDate: '2026-01-05', amount: 1000 }],
      taxRate: 0,
      initialBalance: 0,
    })
    const [point] = buildProjection(input)

    expect(point.taxProvision).toBe(0)
    expect(point.balanceFloor).toBe(1000)
    expect(point.balanceProbable).toBe(1000)
  })

  it('taxProvision é calculada sobre `contracted` (piso); a curva provável usa provisão própria sobre `probable`, não exposta como campo separado', () => {
    const input = makeInput({
      months: ['2026-01'],
      receivables: [{ dueDate: '2026-01-05', amount: 1000 }],
      weighted: { '2026-01': 500 }, // probable = 1500
      taxRate: 10,
      initialBalance: 0,
    })
    const [point] = buildProjection(input)

    expect(point.taxProvision).toBe(100) // 10% de contracted (1000), não de probable (1500)
    expect(point.balanceFloor).toBe(900) // 1000 - 0 - 100
    expect(point.balanceProbable).toBe(1350) // 1500 - 0 - 150 (10% de 1500, provisão própria da curva provável)
  })

  it('taxRate 100: provisão consome toda a receita do mês (sem despesas, saldo fica em zero, não negativo)', () => {
    const input = makeInput({
      months: ['2026-01'],
      receivables: [{ dueDate: '2026-01-05', amount: 1000 }],
      taxRate: 100,
      initialBalance: 0,
    })
    const [point] = buildProjection(input)

    expect(point.taxProvision).toBe(1000)
    expect(point.balanceFloor).toBe(0)
    expect(point.balanceProbable).toBe(0)
  })
})

describe('buildProjection — despesas: lançamentos materializados vs. regras fixas', () => {
  it('quando o mês já tem lançamento de despesa materializado, as regras fixas não são somadas de novo (evita contagem em dobro)', () => {
    const input = makeInput({
      months: ['2026-01', '2026-02'],
      expenseEntries: [{ dueDate: '2026-01-05', amount: 200 }],
      fixedRules: [{ amount: 200, dueDay: 5 }],
    })
    const [jan, fev] = buildProjection(input)

    // Janeiro já materializado: usa só o lançamento existente (200), não soma a regra fixa de novo.
    expect(jan.expenses).toBe(200)
    // Fevereiro sem lançamento materializado: usa a regra fixa (200).
    expect(fev.expenses).toBe(200)
  })

  it('múltiplas regras fixas em mês não materializado somam todas', () => {
    const input = makeInput({
      months: ['2026-01'],
      fixedRules: [
        { amount: 200, dueDay: 5 },
        { amount: 300, dueDay: 15 },
      ],
    })
    const [point] = buildProjection(input)

    expect(point.expenses).toBe(500)
  })

  it('lançamentos pontuais (fora de qualquer regra fixa) somam normalmente ao mês', () => {
    const input = makeInput({
      months: ['2026-01'],
      expenseEntries: [{ dueDate: '2026-01-10', amount: 150 }],
      fixedRules: [],
    })
    const [point] = buildProjection(input)

    expect(point.expenses).toBe(150)
  })
})

describe('buildProjection — saldo acumulado', () => {
  it('saldo parte de initialBalance e acumula (receita − despesas − provisão) mês a mês', () => {
    const input = makeInput({
      months: ['2026-01', '2026-02'],
      receivables: [
        { dueDate: '2026-01-05', amount: 1000 },
        { dueDate: '2026-02-05', amount: 1000 },
      ],
      initialBalance: 500,
      taxRate: 0,
    })
    const [jan, fev] = buildProjection(input)

    expect(jan.balanceFloor).toBe(1500) // 500 + 1000
    expect(fev.balanceFloor).toBe(2500) // 1500 + 1000
  })

  it('saldo negativo propaga para os meses seguintes (o alerta depende disso)', () => {
    const input = makeInput({
      months: ['2026-01', '2026-02', '2026-03'],
      receivables: [{ dueDate: '2026-01-05', amount: 100 }],
      expenseEntries: [{ dueDate: '2026-01-10', amount: 1000 }],
      initialBalance: 0,
      taxRate: 0,
    })
    const [jan, fev, mar] = buildProjection(input)

    expect(jan.balanceFloor).toBe(-900) // 0 + (100 - 1000)
    expect(fev.balanceFloor).toBe(-900) // sem movimento em fevereiro, saldo negativo se mantém
    expect(mar.balanceFloor).toBe(-900)
  })

  it('months de comprimento 1 retorna exatamente um ponto com o saldo daquele mês', () => {
    const input = makeInput({
      months: ['2026-06'],
      receivables: [{ dueDate: '2026-06-01', amount: 200 }],
      initialBalance: 100,
      taxRate: 0,
    })
    const out = buildProjection(input)

    expect(out).toHaveLength(1)
    expect(out[0].month).toBe('2026-06')
    expect(out[0].balanceFloor).toBe(300)
    expect(out[0].balanceProbable).toBe(300)
  })
})
