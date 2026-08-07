// @vitest-environment node
/**
 * `finance.contracts.list` é a única tool NOVA em `lib/mcp/tools/finance.ts`
 * (as outras 9 só reaproveitam `lib/ai/financeTools.ts`, já testado em
 * `financeToolsSummaries.test.ts`/`financeToolsExpenseIdempotency.test.ts`).
 * Como o client é service-role (sem RLS), o escopo de organização é MANUAL
 * — este teste garante que a query real usa `.eq('organization_id', ...)`
 * com o organizationId do CONTEXTO da requisição, não um valor fixo/errado.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const ORG_ID = 'org-financeiro-1';
const OTHER_ORG_ID = 'org-outro-2';

function makeChainableBuilder(result: { data: any; error: any }) {
  const builder: any = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    // Supabase's real query builder is thenable — `await query` resolves it
    // directly, without a terminal method call (no `.single()`/`.range()` here).
    then: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject),
  };
  return builder;
}

let currentResult: { data: any; error: any } = { data: [], error: null };
let builder: ReturnType<typeof makeChainableBuilder>;
const fromMock = vi.fn(() => builder);

vi.mock('@/lib/supabase/staticAdminClient', () => ({
  createStaticAdminClient: () => ({ from: fromMock }),
}));

import { mcpContextStorage, type McpRequestContext } from '@/lib/mcp/context';
import { registerFinanceTools } from '@/lib/mcp/tools/finance';

function ctxFor(organizationId: string): McpRequestContext {
  return {
    organizationId,
    userId: 'user-1',
    scopes: ['crm', 'finance'],
    creatorRole: 'admin',
    enabledModules: ['crm', 'finance'],
  };
}

function registerAndCapture() {
  const handlers: Record<string, (args: any) => Promise<any>> = {};
  const fakeServer: any = {
    registerTool: (name: string, _config: any, handler: (args: any) => Promise<any>) => {
      handlers[name] = handler;
    },
  };
  registerFinanceTools(fakeServer);
  return handlers;
}

describe('finance.contracts.list — escopo de organização manual', () => {
  beforeEach(() => {
    currentResult = { data: [], error: null };
    builder = makeChainableBuilder(currentResult);
    fromMock.mockClear();
  });

  it('consulta finance_contracts filtrando por organization_id do contexto (não um valor fixo)', async () => {
    const handlers = registerAndCapture();
    const handler = handlers['finance.contracts.list'];
    expect(handler).toBeDefined();

    await mcpContextStorage.run(ctxFor(ORG_ID), () => handler({}));

    expect(fromMock).toHaveBeenCalledWith('finance_contracts');
    const eqCalls = builder.eq.mock.calls;
    expect(eqCalls).toContainEqual(['organization_id', ORG_ID]);
    // Nunca deveria filtrar por outra org por acidente (ex.: valor hardcoded).
    expect(eqCalls).not.toContainEqual(['organization_id', OTHER_ORG_ID]);

    // Soft-delete respeitado.
    expect(builder.is).toHaveBeenCalledWith('deleted_at', null);
  });

  it('duas orgs diferentes no contexto geram filtros diferentes (sem vazamento entre tenants)', async () => {
    const handlers = registerAndCapture();
    const handler = handlers['finance.contracts.list'];

    await mcpContextStorage.run(ctxFor(ORG_ID), () => handler({}));
    const firstOrgFilterCalls = [...builder.eq.mock.calls];

    builder = makeChainableBuilder(currentResult);
    fromMock.mockClear();
    await mcpContextStorage.run(ctxFor(OTHER_ORG_ID), () => handler({}));
    const secondOrgFilterCalls = [...builder.eq.mock.calls];

    expect(firstOrgFilterCalls).toContainEqual(['organization_id', ORG_ID]);
    expect(secondOrgFilterCalls).toContainEqual(['organization_id', OTHER_ORG_ID]);
  });

  it('aplica filtro opcional de status quando informado', async () => {
    const handlers = registerAndCapture();
    const handler = handlers['finance.contracts.list'];

    await mcpContextStorage.run(ctxFor(ORG_ID), () => handler({ status: 'ACTIVE' }));

    expect(builder.eq.mock.calls).toContainEqual(['status', 'ACTIVE']);
  });

  it('propaga erro do Supabase como resultado isError, sem lançar exceção', async () => {
    currentResult = { data: null, error: { message: 'boom' } };
    builder = makeChainableBuilder(currentResult);
    const handlers = registerAndCapture();
    const handler = handlers['finance.contracts.list'];

    const result = await mcpContextStorage.run(ctxFor(ORG_ID), () => handler({}));

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('boom');
  });
});
