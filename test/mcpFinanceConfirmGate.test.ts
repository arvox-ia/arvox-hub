// @vitest-environment node
/**
 * `registerFinanceTools` (lib/mcp/tools/finance.ts) não deve registrar os 3
 * `*.confirm` (escrita de fato) quando `INTERNAL_API_SECRET` está ausente —
 * achado da revisão pós-Task-2: sem o segredo, `computeConfirmationToken`
 * (`lib/ai/financeToolsSummaries.ts`) cai para SHA-256 sem segredo,
 * computável por qualquer client HTTP que tenha a API key (o MCP expõe as
 * tools a QUALQUER caller com a chave, diferente do chat da Hub). As
 * leituras e os `prepare*` (que não escrevem nada) continuam disponíveis.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mesma justificativa de `mcpFinanceGate.test.ts`: `createFinanceTools`
// chama `createStaticAdminClient()` de forma eager (só constrói os objetos
// de tool, nenhuma query roda) — mockar evita depender de credenciais reais.
vi.mock('@/lib/supabase/staticAdminClient', () => ({
  createStaticAdminClient: () => ({}),
}));

import { registerFinanceTools } from '@/lib/mcp/tools/finance';

const CONFIRM_TOOL_NAMES = [
  'finance.expense.confirm',
  'finance.receivable.markPaid.confirm',
  'finance.goal.set.confirm',
];

const PREPARE_TOOL_NAMES = [
  'finance.expense.prepare',
  'finance.receivable.markPaid.prepare',
  'finance.goal.set.prepare',
];

const READ_TOOL_NAMES = [
  'finance.overview.get',
  'finance.projection.get',
  'finance.receivables.overdue.list',
  'finance.contracts.list',
];

function registerAndCollect(): string[] {
  const registered: string[] = [];
  const fakeServer: any = {
    registerTool: (name: string) => {
      registered.push(name);
    },
  };
  registerFinanceTools(fakeServer);
  return registered;
}

describe('registerFinanceTools — gate do segredo de confirmação', () => {
  const ORIGINAL_SECRET = process.env.INTERNAL_API_SECRET;
  const ORIGINAL_ERROR = console.error;

  beforeEach(() => {
    console.error = vi.fn();
  });

  afterEach(() => {
    console.error = ORIGINAL_ERROR;
    if (ORIGINAL_SECRET === undefined) delete process.env.INTERNAL_API_SECRET;
    else process.env.INTERNAL_API_SECRET = ORIGINAL_SECRET;
  });

  it('com INTERNAL_API_SECRET configurado: as 10 tools aparecem, inclusive os 3 confirm*', () => {
    process.env.INTERNAL_API_SECRET = 'segredo-de-teste-nao-usar-em-producao';

    const registered = registerAndCollect();

    for (const name of [...READ_TOOL_NAMES, ...PREPARE_TOOL_NAMES, ...CONFIRM_TOOL_NAMES]) {
      expect(registered).toContain(name);
    }
    expect(registered).toHaveLength(10);
  });

  it('com INTERNAL_API_SECRET configurado: não loga nada sobre segredo ausente', () => {
    process.env.INTERNAL_API_SECRET = 'segredo-de-teste-nao-usar-em-producao';

    registerAndCollect();

    expect(console.error).not.toHaveBeenCalled();
  });

  // As duas próximas tests são sequenciais de propósito: o módulo só loga o
  // console.error UMA VEZ por processo (evita spam a cada requisição
  // enquanto o segredo não é configurado) — a 2ª chamada sem segredo exercita
  // justamente esse "warn-once" e por isso precisa vir DEPOIS da 1ª.

  it('sem INTERNAL_API_SECRET (1ª vez neste módulo): os 3 confirm* NÃO aparecem, leituras e prepare* continuam, e loga console.error nomeando a env var', () => {
    delete process.env.INTERNAL_API_SECRET;

    const registered = registerAndCollect();

    for (const name of CONFIRM_TOOL_NAMES) {
      expect(registered).not.toContain(name);
    }
    for (const name of [...READ_TOOL_NAMES, ...PREPARE_TOOL_NAMES]) {
      expect(registered).toContain(name);
    }
    expect(registered).toHaveLength(7);

    expect(console.error).toHaveBeenCalledTimes(1);
    const [message] = (console.error as any).mock.calls[0];
    expect(message).toContain('INTERNAL_API_SECRET');
  });

  it('sem INTERNAL_API_SECRET (2ª vez): continua fail-closed (7 tools), mas não loga de novo (warn-once)', () => {
    delete process.env.INTERNAL_API_SECRET;

    const registered = registerAndCollect();

    expect(registered).toHaveLength(7);
    for (const name of CONFIRM_TOOL_NAMES) {
      expect(registered).not.toContain(name);
    }
    expect(console.error).not.toHaveBeenCalled();
  });
});
