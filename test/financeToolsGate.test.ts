import { describe, expect, it, vi } from 'vitest';
import { composeChatTools } from '@/lib/ai/composeChatTools';

const crmTools = { searchDeals: 'crm-tool-1', createDeal: 'crm-tool-2' };
const financeTools = { getFinanceOverview: 'fin-tool-1', prepareCreateExpense: 'fin-tool-2' };

describe('composeChatTools', () => {
  it('vendedor não recebe nenhuma tool financeira, mesmo com o módulo finance ligado na org', () => {
    const financeFactory = vi.fn(() => financeTools);
    const out = composeChatTools(crmTools, { role: 'vendedor', enabledModules: ['crm', 'finance'] }, financeFactory);

    expect(Object.keys(out).sort()).toEqual(Object.keys(crmTools).sort());
    expect(financeFactory).not.toHaveBeenCalled();
  });

  it('admin com o módulo finance ligado recebe CRM + tools financeiras', () => {
    const financeFactory = vi.fn(() => financeTools);
    const out = composeChatTools(crmTools, { role: 'admin', enabledModules: ['crm', 'finance'] }, financeFactory);

    expect(Object.keys(out).sort()).toEqual([...Object.keys(crmTools), ...Object.keys(financeTools)].sort());
    expect(financeFactory).toHaveBeenCalledTimes(1);
  });

  it('admin SEM o módulo finance ligado na org não recebe tools financeiras', () => {
    const financeFactory = vi.fn(() => financeTools);
    const out = composeChatTools(crmTools, { role: 'admin', enabledModules: ['crm'] }, financeFactory);

    expect(Object.keys(out).sort()).toEqual(Object.keys(crmTools).sort());
    expect(financeFactory).not.toHaveBeenCalled();
  });

  it('sem enabledModules (undefined/null), admin não recebe tools financeiras', () => {
    const financeFactory = vi.fn(() => financeTools);
    const outUndefined = composeChatTools(crmTools, { role: 'admin', enabledModules: undefined }, financeFactory);
    const outNull = composeChatTools(crmTools, { role: 'admin', enabledModules: null }, financeFactory);

    expect(Object.keys(outUndefined).sort()).toEqual(Object.keys(crmTools).sort());
    expect(Object.keys(outNull).sort()).toEqual(Object.keys(crmTools).sort());
    expect(financeFactory).not.toHaveBeenCalled();
  });

  it('sem role (null/undefined), nunca recebe tools financeiras', () => {
    const financeFactory = vi.fn(() => financeTools);
    const out = composeChatTools(crmTools, { role: null, enabledModules: ['finance'] }, financeFactory);

    expect(Object.keys(out).sort()).toEqual(Object.keys(crmTools).sort());
    expect(financeFactory).not.toHaveBeenCalled();
  });

  it('as tools do CRM nunca são descartadas, independente do gate financeiro', () => {
    const financeFactory = vi.fn(() => financeTools);
    const out = composeChatTools(crmTools, { role: 'admin', enabledModules: ['crm', 'finance'] }, financeFactory);

    expect(out.searchDeals).toBe('crm-tool-1');
    expect(out.createDeal).toBe('crm-tool-2');
  });
});
