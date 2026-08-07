import { describe, expect, it } from 'vitest'
import { buildProjection, computeContractedTaxProvision } from './projection'
import type { ProjectionInput } from './types'

describe('computeContractedTaxProvision', () => {
  it('é taxRate% sobre o contratado', () => {
    expect(computeContractedTaxProvision(1000, 6)).toBe(60)
  })

  it('arredonda para 2 casas', () => {
    expect(computeContractedTaxProvision(89.99, 6)).toBe(5.4)
  })

  it('taxRate 0 → provisão 0, independente do contratado', () => {
    expect(computeContractedTaxProvision(5000, 0)).toBe(0)
  })

  it('é a MESMA fórmula usada internamente por buildProjection para taxProvision (não pode divergir)', () => {
    const input: ProjectionInput = {
      months: ['2026-01'],
      receivables: [{ dueDate: '2026-01-10', amount: 1234.56 }],
      expenseEntries: [],
      fixedRules: [],
      weighted: {},
      taxRate: 7.5,
      initialBalance: 0,
    }
    const [point] = buildProjection(input)
    expect(point.taxProvision).toBe(computeContractedTaxProvision(point.contracted, input.taxRate))
  })
})

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

describe('buildProjection — despesas: dedup por REGRA (expenseId), não por mês', () => {
  it('quando a MESMA regra fixa (mesmo expenseId) já foi materializada naquele mês, ela não é somada de novo (evita contagem em dobro)', () => {
    const input = makeInput({
      months: ['2026-01', '2026-02'],
      expenseEntries: [{ dueDate: '2026-01-05', amount: 200, expenseId: 'exp-aluguel' }],
      fixedRules: [{ amount: 200, dueDay: 5, expenseId: 'exp-aluguel' }],
    })
    const [jan, fev] = buildProjection(input)

    // Janeiro já materializado (mesmo expenseId): usa só o lançamento existente (200).
    expect(jan.expenses).toBe(200)
    // Fevereiro sem lançamento materializado para essa regra: usa a regra fixa (200).
    expect(fev.expenses).toBe(200)
  })

  it('CRÍTICO (cenário do revisor): um lançamento ONE_TIME (expenseId X) e uma regra FIXED não materializada (expenseId Y, diferente) no mesmo mês contam OS DOIS — a existência de um lançamento qualquer no mês não pode apagar despesas fixas não relacionadas', () => {
    const input = makeInput({
      months: ['2026-01'],
      expenseEntries: [{ dueDate: '2026-01-10', amount: 100, expenseId: 'exp-onetime-x' }],
      fixedRules: [{ amount: 500, dueDay: 5, expenseId: 'exp-fixed-y' }],
    })
    const [point] = buildProjection(input)

    // Bug antigo (dedup por mês): dropava a regra Y inteira só por existir o lançamento X → 100.
    // Correto (dedup por regra): X sempre conta, Y ainda não materializou → soma os dois.
    expect(point.expenses).toBe(600)
  })

  it('CRÍTICO (cenário do revisor): quando a regra FIXED Y já É materializada naquele mês, ela conta uma vez só (o lançamento existente), não duas (lançamento + regra)', () => {
    const input = makeInput({
      months: ['2026-01'],
      expenseEntries: [
        { dueDate: '2026-01-05', amount: 500, expenseId: 'exp-fixed-y' }, // regra Y já materializada
        { dueDate: '2026-01-10', amount: 100, expenseId: 'exp-onetime-x' }, // pontual não relacionado
      ],
      fixedRules: [{ amount: 500, dueDay: 5, expenseId: 'exp-fixed-y' }],
    })
    const [point] = buildProjection(input)

    // 500 (lançamento já materializado de Y) + 100 (pontual X) = 600 — NÃO 500 + 500 + 100 = 1100.
    expect(point.expenses).toBe(600)
  })

  it('múltiplas regras fixas distintas em mês não materializado somam todas', () => {
    const input = makeInput({
      months: ['2026-01'],
      fixedRules: [
        { amount: 200, dueDay: 5, expenseId: 'exp-aluguel' },
        { amount: 300, dueDay: 15, expenseId: 'exp-prolabore' },
      ],
    })
    const [point] = buildProjection(input)

    expect(point.expenses).toBe(500)
  })

  it('lançamentos pontuais (sem regra fixa correspondente) somam normalmente ao mês', () => {
    const input = makeInput({
      months: ['2026-01'],
      expenseEntries: [{ dueDate: '2026-01-10', amount: 150, expenseId: 'exp-onetime-1' }],
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
      expenseEntries: [{ dueDate: '2026-01-10', amount: 1000, expenseId: 'exp-grande' }],
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
