import { describe, expect, it } from 'vitest'
import { formatCompactBRL } from './chartFormatting'

describe('formatCompactBRL', () => {
  it('valores abaixo de mil: sem sufixo, sem casas decimais', () => {
    expect(formatCompactBRL(0)).toBe('R$ 0')
    expect(formatCompactBRL(500)).toBe('R$ 500')
    expect(formatCompactBRL(999)).toBe('R$ 999')
  })

  it('milhares: sufixo "k", sem casas decimais', () => {
    expect(formatCompactBRL(1000)).toBe('R$ 1k')
    expect(formatCompactBRL(1500)).toBe('R$ 2k')
    expect(formatCompactBRL(45_000)).toBe('R$ 45k')
    expect(formatCompactBRL(999_999)).toBe('R$ 1000k')
  })

  it('milhões: sufixo "M", 1 casa decimal com vírgula pt-BR', () => {
    expect(formatCompactBRL(1_000_000)).toBe('R$ 1,0M')
    expect(formatCompactBRL(2_500_000)).toBe('R$ 2,5M')
    expect(formatCompactBRL(12_340_000)).toBe('R$ 12,3M')
  })

  it('negativos: sinal antes de "R$", mesma convenção de formatBRL/Intl', () => {
    expect(formatCompactBRL(-500)).toBe('-R$ 500')
    expect(formatCompactBRL(-2500)).toBe('-R$ 3k')
    expect(formatCompactBRL(-1_500_000)).toBe('-R$ 1,5M')
  })
})
