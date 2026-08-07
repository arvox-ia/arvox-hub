import { describe, expect, it } from 'vitest'
import { generateReceivables } from './receivables'
import {
  collidesWithPreviousContract,
  computeContractEndDate,
  computeRenewalStartDate,
  daysUntil,
  isEndingSoon,
  lastMonthlyDueDate,
  lastReceivableDueDate,
} from './contractStatus'
import type { ContractInput, ReceivableEntry } from './types'

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

const HORIZON = { horizonMonths: 12, today: '2026-01-01' }

describe('lastMonthlyDueDate', () => {
  it('retorna null quando não há nenhum recebível MONTHLY', () => {
    const receivables = generateReceivables(makeContract({ setupValue: 900, setupInstallments: 3, durationMonths: 3 }), HORIZON)
    expect(lastMonthlyDueDate(receivables)).toBeNull()
  })

  it('retorna o due date da última mensalidade gerada', () => {
    const receivables = generateReceivables(
      makeContract({ monthlyValue: 500, startDate: '2026-01-10', billingDay: 10, durationMonths: 3 }),
      HORIZON
    )
    expect(lastMonthlyDueDate(receivables)).toBe('2026-03-10')
  })
})

describe('lastReceivableDueDate', () => {
  it('retorna null pra lista vazia', () => {
    expect(lastReceivableDueDate([])).toBeNull()
  })

  it('retorna o due date mais tardio entre setup e mensalidade', () => {
    const receivables: ReceivableEntry[] = [
      { kind: 'SETUP', amount: 100, dueDate: '2026-01-10', description: 'Setup 1/1' },
      { kind: 'MONTHLY', amount: 50, dueDate: '2026-03-10', description: 'Mensalidade' },
      { kind: 'MONTHLY', amount: 50, dueDate: '2026-02-10', description: 'Mensalidade' },
    ]
    expect(lastReceivableDueDate(receivables)).toBe('2026-03-10')
  })
})

describe('computeContractEndDate', () => {
  it('retorna null para contrato indeterminado', () => {
    expect(computeContractEndDate('2026-01-15', null, [])).toBeNull()
  })

  it('usa a última mensalidade real gerada (não uma fórmula de calendário)', () => {
    const receivables = generateReceivables(
      makeContract({ monthlyValue: 500, startDate: '2026-01-15', billingDay: 10, durationMonths: 3 }),
      HORIZON
    )
    // start=15, billingDay=10 -> primeira mensalidade só no mês seguinte (fev), depois mar, abr
    expect(computeContractEndDate('2026-01-15', 3, receivables)).toBe('2026-04-10')
  })

  it('cai no cálculo por calendário quando não há mensalidade (contrato só de setup)', () => {
    const receivables = generateReceivables(
      makeContract({ setupValue: 900, setupInstallments: 3, startDate: '2026-01-15', durationMonths: 3 }),
      HORIZON
    )
    expect(computeContractEndDate('2026-01-15', 3, receivables)).toBe('2026-04-14')
  })

  describe('repro do bug de dupla cobrança na renovação (início 29-31 + billingDay 28)', () => {
    it('início 29/01, duração 1, billingDay 28: fim é 28/02 (o due date real), não 27/02', () => {
      const receivables = generateReceivables(
        makeContract({ monthlyValue: 500, startDate: '2026-01-29', billingDay: 28, durationMonths: 1 }),
        HORIZON
      )
      expect(receivables.filter(r => r.kind === 'MONTHLY').map(r => r.dueDate)).toEqual(['2026-02-28'])
      expect(computeContractEndDate('2026-01-29', 1, receivables)).toBe('2026-02-28')
    })

    it.each([29, 30, 31])('início %i/01, duração 1, billingDay 28: renovação começa DEPOIS da última cobrança (sem colisão)', startDay => {
      const startDate = `2026-01-${startDay}`
      const contract = makeContract({ monthlyValue: 500, startDate, billingDay: 28, durationMonths: 1 })
      const receivables = generateReceivables(contract, HORIZON)
      const previousLast = lastReceivableDueDate(receivables)
      expect(previousLast).not.toBeNull()

      const renewalStart = computeRenewalStartDate(previousLast as string)
      const renewalReceivables = generateReceivables(
        makeContract({ monthlyValue: 500, startDate: renewalStart, billingDay: 28, durationMonths: 1 }),
        { horizonMonths: 12, today: renewalStart }
      )

      // A cobrança de renovação nunca pode cair em cima (ou antes) da última do contrato anterior.
      expect(collidesWithPreviousContract(renewalReceivables, previousLast)).toBe(false)
      for (const r of renewalReceivables) {
        expect(r.dueDate > (previousLast as string)).toBe(true)
      }
    })
  })

  it('caso comum (início dia 10, billingDay 5, duração 6): renovação também começa limpa, sem sombra de dúvida', () => {
    const contract = makeContract({ monthlyValue: 800, startDate: '2026-01-10', billingDay: 5, durationMonths: 6 })
    const receivables = generateReceivables(contract, HORIZON)
    const previousLast = lastReceivableDueDate(receivables)
    expect(previousLast).toBe('2026-07-05')

    const renewalStart = computeRenewalStartDate(previousLast as string)
    expect(renewalStart).toBe('2026-07-06')

    const renewalReceivables = generateReceivables(
      makeContract({ monthlyValue: 800, startDate: renewalStart, billingDay: 5, durationMonths: 6 }),
      { horizonMonths: 12, today: renewalStart }
    )
    expect(collidesWithPreviousContract(renewalReceivables, previousLast)).toBe(false)
    expect(renewalReceivables[0].dueDate).toBe('2026-08-05')
  })

  it('sweep início 28-31 x billingDay 28: renovação nunca colide', () => {
    for (const startDay of [28, 29, 30, 31]) {
      const startDate = `2026-01-${startDay}`
      const contract = makeContract({ monthlyValue: 300, startDate, billingDay: 28, durationMonths: 2 })
      const receivables = generateReceivables(contract, HORIZON)
      const previousLast = lastReceivableDueDate(receivables) as string
      const renewalStart = computeRenewalStartDate(previousLast)
      const renewalReceivables = generateReceivables(
        makeContract({ monthlyValue: 300, startDate: renewalStart, billingDay: 28, durationMonths: 2 }),
        { horizonMonths: 12, today: renewalStart }
      )
      expect(collidesWithPreviousContract(renewalReceivables, previousLast)).toBe(false)
    }
  })
})

describe('collidesWithPreviousContract', () => {
  it('false quando não há contrato anterior (previousLastDueDate null)', () => {
    expect(collidesWithPreviousContract([{ kind: 'MONTHLY', amount: 1, dueDate: '2026-02-28', description: '' }], null)).toBe(false)
  })

  it('false quando não há recebíveis novos', () => {
    expect(collidesWithPreviousContract([], '2026-02-28')).toBe(false)
  })

  it('true quando o recebível novo mais cedo é EXATAMENTE a última data do contrato anterior (o bug original)', () => {
    const newReceivables: ReceivableEntry[] = [{ kind: 'MONTHLY', amount: 500, dueDate: '2026-02-28', description: 'Mensalidade' }]
    expect(collidesWithPreviousContract(newReceivables, '2026-02-28')).toBe(true)
  })

  it('true quando o recebível novo mais cedo é ANTERIOR à última data do contrato anterior', () => {
    const newReceivables: ReceivableEntry[] = [{ kind: 'SETUP', amount: 100, dueDate: '2026-02-01', description: 'Setup 1/1' }]
    expect(collidesWithPreviousContract(newReceivables, '2026-02-28')).toBe(true)
  })

  it('false quando todos os recebíveis novos são estritamente posteriores', () => {
    const newReceivables: ReceivableEntry[] = [{ kind: 'MONTHLY', amount: 500, dueDate: '2026-03-01', description: 'Mensalidade' }]
    expect(collidesWithPreviousContract(newReceivables, '2026-02-28')).toBe(false)
  })
})

describe('daysUntil', () => {
  it('positivo quando a data está no futuro', () => {
    expect(daysUntil('2026-02-10', '2026-02-01')).toBe(9)
  })

  it('zero quando a data é hoje', () => {
    expect(daysUntil('2026-02-01', '2026-02-01')).toBe(0)
  })

  it('negativo quando a data já passou', () => {
    expect(daysUntil('2026-01-20', '2026-02-01')).toBe(-12)
  })
})

describe('isEndingSoon', () => {
  it('false para contrato indeterminado (endDate null)', () => {
    expect(isEndingSoon(null, '2026-02-01')).toBe(false)
  })

  it('true quando faltam exatamente 30 dias (limiar inclusive)', () => {
    expect(isEndingSoon('2026-03-03', '2026-02-01', 30)).toBe(true)
  })

  it('false quando faltam 31 dias (acima do limiar)', () => {
    expect(isEndingSoon('2026-03-04', '2026-02-01', 30)).toBe(false)
  })

  it('true quando vence hoje (0 dias)', () => {
    expect(isEndingSoon('2026-02-01', '2026-02-01')).toBe(true)
  })

  it('false quando já venceu (dias negativos)', () => {
    expect(isEndingSoon('2026-01-20', '2026-02-01')).toBe(false)
  })
})

describe('computeRenewalStartDate', () => {
  it('retorna o dia seguinte ao fim do contrato anterior', () => {
    expect(computeRenewalStartDate('2026-04-14')).toBe('2026-04-15')
  })

  it('rola o mês corretamente no fim do mês', () => {
    expect(computeRenewalStartDate('2026-01-31')).toBe('2026-02-01')
  })

  it('rola o ano corretamente em 31/12', () => {
    expect(computeRenewalStartDate('2026-12-31')).toBe('2027-01-01')
  })
})
