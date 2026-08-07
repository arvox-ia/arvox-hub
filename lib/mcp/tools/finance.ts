/**
 * @fileoverview Tools financeiras do servidor MCP.
 *
 * `registerFinanceTools(server)` é INCONDICIONAL — quem decide SE ele deve
 * ser chamado é `lib/mcp/registerAllTools.ts` (`keyGrantsFinance(ctx)`, com
 * `ctx` vindo de `getMcpContext()`). Este módulo não reimplementa esse gate,
 * confia no caller — mesmo racional de `createFinanceTools` em relação a
 * `canAccessFinance` (ver `lib/ai/financeTools.ts`).
 *
 * Duas fontes de tools:
 * 1. As 3 leituras + 3 pares prepare/confirm de `lib/ai/financeTools.ts`
 *    (`createFinanceTools`) — reaproveitadas via o MESMO wrapper de extração
 *    de schema Zod usado por `registerExistingCrmTools`
 *    (`lib/mcp/registerTools.ts`), já que ambas usam o idioma `tool()` do AI
 *    SDK (`inputSchema: z.object(...)`, `execute`). Zero lógica de negócio
 *    duplicada — inclusive o protocolo de confirmação HMAC
 *    (`financeToolsSummaries.ts`) continua vivendo só em `financeTools.ts`.
 * 2. `finance.contracts.list`, novo aqui — não existe tool de IA equivalente
 *    (a tela de Contratos lê via `lib/supabase/finance.ts#listContracts`,
 *    que usa client anon+RLS; inutilizável no client service-role do MCP,
 *    que precisa de escopo de org MANUAL). É só uma consulta filtrada, sem
 *    regra de negócio a duplicar.
 *
 * Hardening pós-revisão: os 3 `*.confirm` (escrita de fato) só são
 * registrados quando `INTERNAL_API_SECRET` está configurado — ver
 * `registerFinanceAiTools` abaixo.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getMcpContext } from '@/lib/mcp/context';
import { createStaticAdminClient } from '@/lib/supabase/staticAdminClient';
import { createFinanceTools } from '@/lib/ai/financeTools';
import { hasConfirmationTokenSecret } from '@/lib/ai/financeToolsSummaries';
import { formatBRL } from '@/lib/utils/currency';
import { FINANCE_TOOL_CATALOG } from '@/lib/mcp/financeToolCatalog';

type AnyTool = {
  description?: string;
  inputSchema?: unknown;
  execute?: (args: any) => Promise<any> | any;
};

const getDb = () => createStaticAdminClient();

function ok(data: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
  };
}

function err(message: string) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
    isError: true as const,
  };
}

/**
 * Chaves internas dos 3 `confirm*` (as tools que de fato ESCREVEM). Skipadas
 * do registro MCP quando `INTERNAL_API_SECRET` está ausente — ver
 * `registerFinanceAiTools`.
 */
const CONFIRM_TOOL_INTERNAL_KEYS = new Set([
  'confirmCreateExpense',
  'confirmMarkReceivablePaid',
  'confirmSetMonthlyGoal',
]);

/** Evita spammar o log a cada requisição enquanto o segredo não é configurado. */
let warnedMissingSecretOnce = false;

export function registerFinanceTools(server: McpServer) {
  registerFinanceAiTools(server);
  registerContractsListTool(server);
}

/**
 * Registra os tools de `createFinanceTools`: sempre as 3 leituras + os 3
 * `prepare*` (não escrevem nada, só montam um resumo + `confirmationToken`).
 *
 * Os 3 `confirm*` (escrita de fato) só são registrados se
 * `INTERNAL_API_SECRET` estiver configurado. Motivo (achado da revisão):
 * sem o segredo, `computeConfirmationToken` (`lib/ai/financeToolsSummaries.ts`)
 * cai para SHA-256 sem segredo — DETERMINÍSTICO e computável por qualquer um
 * que leia o código-fonte (público neste repo). No chat da Hub isso já era
 * tolerado (o único "cliente" é o próprio app, atrás de auth de sessão); no
 * MCP o caller é QUALQUER client HTTP segurando uma API key — um cliente
 * malicioso ou comprometido poderia computar um `confirmationToken` válido
 * SEM nunca ter chamado o `prepare*` correspondente, pulando a etapa de
 * "mostrar o resumo pro humano confirmar". Fail closed: sem segredo, as
 * leituras e os `prepare*` continuam úteis (só param no passo de escrita);
 * os `confirm*` simplesmente não existem no `tools/list`.
 */
function registerFinanceAiTools(server: McpServer) {
  // Instância "de schema": mesmo truque de `registerExistingCrmTools` — cria as
  // tools com um contexto fake só para extrair `inputSchema`/`execute` na hora
  // do registro. Não toca o banco (execute só roda de fato dentro do handler,
  // com o contexto REAL da requisição — ver abaixo).
  const dummyTools = createFinanceTools({ organizationId: '__schema__' }, '__schema__') as Record<string, AnyTool>;

  const secretConfigured = hasConfirmationTokenSecret();
  if (!secretConfigured && !warnedMissingSecretOnce) {
    warnedMissingSecretOnce = true;
    console.error(
      '[mcp/finance] INTERNAL_API_SECRET não configurado — as tools de escrita financeira ' +
        '(finance.expense.confirm, finance.receivable.markPaid.confirm, finance.goal.set.confirm) ' +
        'NÃO serão registradas no servidor MCP (o confirmationToken cairia para SHA-256 sem segredo, ' +
        'forjável por qualquer client HTTP que tenha a API key, sem passar pelo prepare*). ' +
        'Leituras e prepare* continuam disponíveis. Configure INTERNAL_API_SECRET para habilitar escrita via MCP.'
    );
  }

  for (const [internalKey, t] of Object.entries(dummyTools)) {
    if (!t?.execute) continue;
    if (!secretConfigured && CONFIRM_TOOL_INTERNAL_KEYS.has(internalKey)) continue;

    const catalog = (FINANCE_TOOL_CATALOG as Record<string, { name: string; title: string; description: string }>)[
      internalKey
    ];
    if (!catalog) continue;

    const zodSchema = (t as any).inputSchema;
    // Zod v3: shape pode ser função (ZodObject) ou ausente (outros tipos de schema).
    const shapeDef = zodSchema?._def?.shape;
    const flatShape = typeof shapeDef === 'function' ? shapeDef() : (shapeDef ?? {});

    server.registerTool(
      catalog.name,
      {
        title: catalog.title,
        description: catalog.description,
        inputSchema: flatShape,
      },
      async (args: any) => {
        const ctx = getMcpContext();
        // organization_id é MANUAL aqui dentro (client service-role, sem RLS)
        // — ver o header de `lib/ai/financeTools.ts`: toda query lá dentro tem
        // `.eq('organization_id', organizationId)` explícito.
        const realTools = createFinanceTools({ organizationId: ctx.organizationId }, ctx.userId) as Record<
          string,
          AnyTool
        >;

        const realTool = realTools[internalKey];
        if (!realTool?.execute) {
          return err(`Tool ${internalKey} not available`);
        }

        try {
          const result = await realTool.execute(args);
          return ok(result);
        } catch (e: any) {
          return err(e?.message || 'Tool execution failed');
        }
      }
    );
  }
}

/**
 * `finance.contracts.list` — lista contratos (setup + mensalidade) com nome
 * do cliente. `organization_id` MANUAL (client service-role) na query, e
 * `deleted_at IS NULL` (soft-delete, mesmo padrão de `financeTools.ts`).
 */
function registerContractsListTool(server: McpServer) {
  server.registerTool(
    'finance.contracts.list',
    {
      title: 'List contracts',
      description:
        'Read-only. Lists finance contracts (setup fee + recurring monthly billing) with client name, ordered by start date (most recent first). Monetary values (setupValue, monthlyValue) are in BRL. Optional status filter. Scoped to the authenticated organization.',
      inputSchema: {
        status: z
          .enum(['ACTIVE', 'ENDED', 'RENEWED'])
          .optional()
          .describe('Filter by contract status. Default: all statuses.'),
        limit: z.number().int().positive().max(100).optional().default(50),
      },
    },
    async (args: any) => {
      const ctx = getMcpContext();

      let query = getDb()
        .from('finance_contracts')
        .select(
          'id, description, setup_value, monthly_value, start_date, duration_months, billing_day, status, contact:contacts(name)'
        )
        .eq('organization_id', ctx.organizationId)
        .is('deleted_at', null)
        .order('start_date', { ascending: false })
        .limit(args?.limit ?? 50);

      if (args?.status) query = query.eq('status', args.status);

      const { data, error } = await query;
      if (error) return err(error.message);

      const contratos = ((data as any[]) || []).map((c) => ({
        id: c.id,
        cliente: c.contact?.name || 'N/A',
        descricao: c.description,
        valorSetup: formatBRL(c.setup_value),
        valorMensal: formatBRL(c.monthly_value),
        inicio: c.start_date,
        duracaoMeses: c.duration_months,
        diaCobranca: c.billing_day,
        status: c.status,
      }));

      return ok({ count: contratos.length, contratos });
    }
  );
}
