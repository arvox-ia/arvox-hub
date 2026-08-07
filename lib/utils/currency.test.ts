import { describe, expect, it } from 'vitest'
import { formatBRL } from '@/lib/utils/currency'

describe('formatBRL', () => {
  it('formata reais com separadores pt-BR', () => {
    expect(formatBRL(1234.5)).toBe('R$ 1.234,50')
    expect(formatBRL(0)).toBe('R$ 0,00')
    expect(formatBRL(-350)).toBe('-R$ 350,00')
  })
})
