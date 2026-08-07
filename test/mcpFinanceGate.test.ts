// @vitest-environment node
/**
 * Testa a decisão de registro do financeiro no servidor MCP:
 * `registerAllMcpTools` (lib/mcp/registerAllTools.ts) só chama
 * `registerFinanceTools` quando `keyGrantsFinance(ctx)` autoriza, com `ctx`
 * vindo do `mcpContextStorage` real (mesmo mecanismo usado em produção por
 * `app/api/[transport]/route.ts`).
 *
 * Usa um McpServer FAKE (só captura os nomes registrados via
 * `registerTool`) — real o suficiente pra exercitar o código de produção
 * (`registerAllMcpTools`, `registerFinanceTools`, `keyGrantsFinance`,
 * `mcpContextStorage`) sem precisar de um servidor MCP de verdade nem de
 * rede/banco: `registerFinanceTools`/`registerExistingCrmTools` só CONSTROEM
 * os objetos de tool na hora do registro (Zod schema + closures) — nenhuma
 * query roda até o `execute` de uma tool ser chamado, o que este teste nunca
 * faz.
 */
import { describe, expect, it, vi } from 'vitest';

// `registerExistingCrmTools`/`registerFinanceTools` constroem tools "de
// schema" na hora do registro chamando `createCRMTools`/`createFinanceTools`,
// que por sua vez chamam `createStaticAdminClient()` de forma EAGER (mesmo só
// pra extrair o schema Zod — nenhuma query roda). Isso exige credenciais reais
// do Supabase mesmo em ambientes sem `.env.local` (ex.: CI). Como este teste
// nunca chama `execute()` de tool nenhuma, o client nunca é usado de fato —
// mockar deixa o teste hermético e independente de segredo configurado.
vi.mock('@/lib/supabase/staticAdminClient', () => ({
  createStaticAdminClient: () => ({}),
}));

import { mcpContextStorage, type McpRequestContext } from '@/lib/mcp/context';
import { registerAllMcpTools } from '@/lib/mcp/registerAllTools';
import { FINANCE_TOOL_CATALOG } from '@/lib/mcp/financeToolCatalog';

const ALL_FINANCE_TOOL_NAMES = [
  ...Object.values(FINANCE_TOOL_CATALOG).map((entry) => entry.name),
  'finance.contracts.list',
];

function fakeServer() {
  const registered: string[] = [];
  return {
    server: {
      registerTool: (name: string) => {
        registered.push(name);
      },
    } as any,
    registered,
  };
}

const BASE_CTX = {
  organizationId: 'org-1',
  userId: 'user-1',
} as const;

describe('registerAllMcpTools — gate do financeiro', () => {
  it('caso feliz: escopo finance + criador admin + módulo ligado → todas as tools financeiras aparecem', () => {
    const { server, registered } = fakeServer();
    const ctx: McpRequestContext = {
      ...BASE_CTX,
      scopes: ['crm', 'finance'],
      creatorRole: 'admin',
      enabledModules: ['crm', 'finance'],
    };

    mcpContextStorage.run(ctx, () => registerAllMcpTools(server));

    for (const name of ALL_FINANCE_TOOL_NAMES) {
      expect(registered).toContain(name);
    }
    // CRM continua registrado normalmente, sem interferência do gate.
    expect(registered).toContain('crm.pipeline.analyze');
  });

  it('sem escopo finance na chave → nenhuma tool financeira aparece (nem em tools/list)', () => {
    const { server, registered } = fakeServer();
    const ctx: McpRequestContext = {
      ...BASE_CTX,
      scopes: ['crm'],
      creatorRole: 'admin',
      enabledModules: ['crm', 'finance'],
    };

    mcpContextStorage.run(ctx, () => registerAllMcpTools(server));

    expect(registered.some((n) => n.startsWith('finance.'))).toBe(false);
    expect(registered).toContain('crm.pipeline.analyze');
  });

  it('escopo finance mas criador vendedor (rebaixado depois de criar a chave) → nega', () => {
    const { server, registered } = fakeServer();
    const ctx: McpRequestContext = {
      ...BASE_CTX,
      scopes: ['crm', 'finance'],
      creatorRole: 'vendedor',
      enabledModules: ['crm', 'finance'],
    };

    mcpContextStorage.run(ctx, () => registerAllMcpTools(server));

    expect(registered.some((n) => n.startsWith('finance.'))).toBe(false);
  });

  it('escopo finance + criador admin, mas módulo finance desligado na org → nega', () => {
    const { server, registered } = fakeServer();
    const ctx: McpRequestContext = {
      ...BASE_CTX,
      scopes: ['crm', 'finance'],
      creatorRole: 'admin',
      enabledModules: ['crm'],
    };

    mcpContextStorage.run(ctx, () => registerAllMcpTools(server));

    expect(registered.some((n) => n.startsWith('finance.'))).toBe(false);
  });

  it('creatorRole null (created_by removido/inexistente) → nega mesmo com escopo finance', () => {
    const { server, registered } = fakeServer();
    const ctx: McpRequestContext = {
      ...BASE_CTX,
      scopes: ['crm', 'finance'],
      creatorRole: null,
      enabledModules: ['crm', 'finance'],
    };

    mcpContextStorage.run(ctx, () => registerAllMcpTools(server));

    expect(registered.some((n) => n.startsWith('finance.'))).toBe(false);
  });

  it('sem contexto MCP disponível (fora do run()) → não registra financeiro, mas não derruba as demais tools', () => {
    const { server, registered } = fakeServer();

    registerAllMcpTools(server);

    expect(registered.some((n) => n.startsWith('finance.'))).toBe(false);
    expect(registered).toContain('crm.pipeline.analyze');
  });
});
