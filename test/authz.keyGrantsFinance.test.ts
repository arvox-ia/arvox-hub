import { describe, expect, it } from 'vitest'
import { keyGrantsFinance } from '@/lib/authz'

describe('keyGrantsFinance', () => {
  it('sem escopo nenhum, nega mesmo com criador admin e módulo ligado', () => {
    expect(
      keyGrantsFinance({ scopes: [], creatorRole: 'admin', enabledModules: ['crm', 'finance'] })
    ).toBe(false)
  })

  it('com escopo finance mas criador vendedor, nega', () => {
    expect(
      keyGrantsFinance({ scopes: ['crm', 'finance'], creatorRole: 'vendedor', enabledModules: ['crm', 'finance'] })
    ).toBe(false)
  })

  it('com escopo finance e criador admin, mas módulo finance desligado, nega', () => {
    expect(
      keyGrantsFinance({ scopes: ['crm', 'finance'], creatorRole: 'admin', enabledModules: ['crm'] })
    ).toBe(false)
  })

  it('caso feliz: escopo finance + criador admin + módulo ligado, concede', () => {
    expect(
      keyGrantsFinance({ scopes: ['crm', 'finance'], creatorRole: 'admin', enabledModules: ['crm', 'finance'] })
    ).toBe(true)
  })

  it('creatorRole null (ex.: created_by apagado/SET NULL), nega mesmo com escopo finance', () => {
    expect(
      keyGrantsFinance({ scopes: ['finance'], creatorRole: null, enabledModules: ['crm', 'finance'] })
    ).toBe(false)
  })

  it('scopes vazio ou ausente nega (chave da LP: default {crm}, nunca finance)', () => {
    expect(keyGrantsFinance({ scopes: [], creatorRole: 'admin', enabledModules: ['crm', 'finance'] })).toBe(false)
    expect(keyGrantsFinance({ creatorRole: 'admin', enabledModules: ['crm', 'finance'] })).toBe(false)
  })

  it('falha fechado com tudo nulo/indefinido', () => {
    expect(keyGrantsFinance({})).toBe(false)
    expect(
      keyGrantsFinance({ scopes: null, creatorRole: undefined, enabledModules: undefined })
    ).toBe(false)
  })
})
