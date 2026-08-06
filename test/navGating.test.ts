import { describe, expect, it } from 'vitest'
import { filterNav, type NavGate } from '@/components/navigation/navConfig'
import { canAccessFinance } from '@/lib/authz'

type Item = NavGate & { id: string }

const items: Item[] = [
  { id: 'contacts' },                                   // sem gate: sempre visível
  { id: 'finance', module: 'finance', adminOnly: true },
  { id: 'projects', module: 'projects' },
]

describe('filterNav', () => {
  it('sem módulos definidos, mostra apenas itens sem gate', () => {
    const out = filterNav(items, { enabledModules: undefined, role: 'admin' })
    expect(out.map((i) => i.id)).toEqual(['contacts'])
  })

  it('finance ligado + admin vê o item finance', () => {
    const out = filterNav(items, { enabledModules: ['crm', 'finance'], role: 'admin' })
    expect(out.map((i) => i.id)).toEqual(['contacts', 'finance'])
  })

  it('finance ligado + user comum NÃO vê item adminOnly', () => {
    const out = filterNav(items, { enabledModules: ['crm', 'finance'], role: 'user' })
    expect(out.map((i) => i.id)).toEqual(['contacts'])
  })

  it('módulo desligado some mesmo para admin', () => {
    const out = filterNav(items, { enabledModules: ['crm'], role: 'admin' })
    expect(out.map((i) => i.id)).toEqual(['contacts'])
  })
})

describe('canAccessFinance', () => {
  it('exige admin E módulo finance', () => {
    expect(canAccessFinance({ role: 'admin', enabledModules: ['crm', 'finance'] })).toBe(true)
    expect(canAccessFinance({ role: 'user', enabledModules: ['crm', 'finance'] })).toBe(false)
    expect(canAccessFinance({ role: 'admin', enabledModules: ['crm'] })).toBe(false)
    expect(canAccessFinance({ role: null, enabledModules: null })).toBe(false)
  })
})
