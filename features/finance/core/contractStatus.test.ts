import { describe, expect, it } from 'vitest'
import { computeContractEndDate, computeRenewalStartDate, daysUntil, isEndingSoon } from './contractStatus'

describe('computeContractEndDate', () => {
  it('retorna null para contrato indeterminado', () => {
    expect(computeContractEndDate('2026-01-15', null)).toBeNull()
  })

  it('soma durationMonths meses e subtrai 1 dia', () => {
    expect(computeContractEndDate('2026-01-15', 3)).toBe('2026-04-14')
  })

  it('clampa fim de mês (31/01 + 1 mês -> 28/02, -1 dia -> 27/02)', () => {
    expect(computeContractEndDate('2026-01-31', 1)).toBe('2026-02-27')
  })

  it('duração de 1 mês termina 1 dia antes do mesmo dia no mês seguinte', () => {
    expect(computeContractEndDate('2026-03-01', 1)).toBe('2026-03-31')
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
