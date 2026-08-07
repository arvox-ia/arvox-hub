/**
 * @fileoverview Tools de IA do módulo financeiro (Fase 1B, Task 11).
 *
 * Mesmo idioma de `lib/ai/tools.ts#createCRMTools`: `tool({ description,
 * inputSchema, execute })` do AI SDK, client SERVICE ROLE
 * (`createStaticAdminClient`, sem RLS) — por isso TODA query/mutation aqui
 * tem `.eq('organization_id', organizationId)` MANUAL. Nunca confiar em RLS
 * neste arquivo (ao contrário de `lib/supabase/finance.ts`, que usa o
 * client anon e depende 100% do Postgres para isolamento).
 *
 * ## Regra de ouro: a IA nunca escreve sem confirmação humana explícita
 *
 * As 3 escritas do módulo (despesa nova, baixa de recebível, meta mensal)
 * são todas em DOIS passos:
 * - `prepare*`: valida entrada, resolve ambiguidade (ex.: acha o recebível
 *   por nome do cliente + valor), NUNCA toca o banco, e devolve um resumo
 *   pt-BR + um `confirmationToken` (hash determinístico dos valores
 *   resolvidos — ver `financeToolsSummaries.ts`).
 * - `confirm*`: só executa se o payload reenviado (que o modelo precisa
 *   ECOAR do `prepare`, não apenas dizer "sim") bater com o
 *   `confirmationToken` — qualquer campo alterado entre as duas chamadas
 *   invalida o token. Nos fluxos que alteram uma linha existente
 *   (`markReceivablePaid`), o `confirm` ainda revalida contra o banco em
 *   tempo real (status/valor atuais) — defesa em profundidade mesmo com
 *   token válido.
 *
 * Isso é DIFERENTE do mecanismo `needsApproval` (card Aprovar/Negar) usado
 * pelas tools do CRM (`tools.ts`) — aqui a confirmação é em TEXTO, porque é
 * assim que o spec da Fase 1B pediu ("nunca escreve sem confirmação
 * explícita"). Ver a instrução correspondente em `lib/ai/crmAgent.ts`.
 */

import { tool } from 'ai';
import { z } from 'zod';
import { format } from 'date-fns';
import { createStaticAdminClient } from '@/lib/supabase/staticAdminClient';
import { sanitizePostgrestValue } from '@/lib/utils/sanitize';
import { formatBRL } from '@/lib/utils/currency';
import { buildProjection } from '@/features/finance/core/projection';
import { addMonthsToKey, weightDeals } from '@/features/finance/core/pipeline';
import { mapOpenDealForProjection } from '@/features/finance/core/dealMapping';
import { computeMonthKpis } from '@/features/finance/core/dashboardMetrics';
import { EXPENSE_CATEGORIES } from '@/features/finance/core/types';
import {
  computeConfirmationToken,
  daysOverdue,
  formatCreateExpenseSummary,
  formatMarkReceivablePaidSummary,
  formatSetMonthlyGoalSummary,
  monthKeyToDateRange,
  round2,
  verifyConfirmationToken,
  type ResolvedCreateExpense,
  type ResolvedMarkReceivablePaid,
  type ResolvedSetMonthlyGoal,
} from './financeToolsSummaries';

export interface FinanceToolsContext {
  organizationId: string;
}

/** Fallback quando a org ainda não configurou `finance_settings.projection_months`. */
const DEFAULT_PROJECTION_MONTHS = 6;
/** Mesmos defaults de `weightDeals` usados pelo Dashboard (`useFinanceController.ts`) — ver comentário lá. */
const PROJECTION_DEFAULT_CLOSE_DAYS = 30;
const PROJECTION_ASSUMED_BILLING_DAY = 5;

/**
 * Cria as tools financeiras com o contexto injetado. Só deve ser chamada
 * quando `canAccessFinance(viewer)` já autorizou (ver `lib/ai/composeChatTools.ts`
 * e o gate em `app/api/ai/chat/route.ts`) — este módulo NÃO reimplementa
 * esse gate, ele confia no caller.
 */
export function createFinanceTools(context: FinanceToolsContext, userId: string) {
  const supabase = createStaticAdminClient();
  const organizationId = context.organizationId;
  // userId não é usado hoje: nenhuma tabela finance_* tem coluna de "dono"
  // (ver supabase/migrations/20260807120000_finance_module.sql) — mantido
  // na assinatura para simetria com createCRMTools e uso futuro.
  void userId;

  const formatSupabaseFailure = (error: any): string => {
    const msg = (error?.message || error?.error_description || String(error || '')).trim();
    return `Falha ao consultar o Supabase (financeiro). ${msg || 'Erro desconhecido.'}`;
  };

  const todayKey = (): string => format(new Date(), 'yyyy-MM-dd');

  const tools = {
    // ============= LEITURA =============
    getFinanceOverview: tool({
      description:
        'Mostra o resumo financeiro de um mês: recebido, a receber, despesas, meta e provisão de imposto. Sem argumento, usa o mês corrente.',
      inputSchema: z.object({
        month: z
          .string()
          .regex(/^\d{4}-\d{2}$/)
          .optional()
          .describe('Mês no formato yyyy-MM. Padrão: mês corrente.'),
      }),
      execute: async ({ month }) => {
        const monthKey = month || todayKey().slice(0, 7);
        const { start, end } = monthKeyToDateRange(monthKey);

        // `receivables` vem SEM filtro de due_date (mesmo racional de `allReceivables` no
        // controller do dashboard): `computeMonthKpis` calcula "recebido" pela data de
        // PAGAMENTO (paidAt), não de vencimento — um recebível vencido num mês anterior e
        // pago neste mês precisa entrar, senão o valor "some" (achado da revisão da Task 9).
        const [receivablesRes, entriesRes, goalRes, settingsRes] = await Promise.all([
          supabase
            .from('finance_receivables')
            .select('amount, status, due_date, paid_at')
            .eq('organization_id', organizationId)
            .is('deleted_at', null),
          supabase
            .from('finance_expense_entries')
            .select('amount, status')
            .eq('organization_id', organizationId)
            .is('deleted_at', null)
            .gte('due_date', start)
            .lte('due_date', end),
          supabase
            .from('finance_goals')
            .select('target_value')
            .eq('organization_id', organizationId)
            .eq('month', `${monthKey}-01`)
            .maybeSingle(),
          supabase.from('finance_settings').select('tax_rate').eq('organization_id', organizationId).maybeSingle(),
        ]);

        if (receivablesRes.error) return { error: formatSupabaseFailure(receivablesRes.error) };
        if (entriesRes.error) return { error: formatSupabaseFailure(entriesRes.error) };

        const receivables = ((receivablesRes.data as any[]) || []).map((r) => ({
          amount: r.amount as number,
          status: r.status as 'PENDING' | 'PAID',
          dueDate: r.due_date as string,
          paidAt: r.paid_at as string | null,
        }));

        const taxRate = (settingsRes.data as any)?.tax_rate ?? 0;
        // "Contratado" (base do piso/provisão) continua sendo por VENCIMENTO no mês — mesma
        // definição de `ProjectionPoint.taxProvision` no core, nunca a de "recebido" (por pagamento).
        const contracted = round2(
          receivables.filter((r) => r.dueDate.slice(0, 7) === monthKey).reduce((sum, r) => sum + r.amount, 0)
        );
        const provisaoImposto = round2(contracted * (taxRate / 100));
        const kpis = computeMonthKpis(receivables, (entriesRes.data as any[]) || [], provisaoImposto, monthKey);
        const meta = (goalRes.data as any)?.target_value ?? 0;

        return {
          mes: monthKey,
          recebido: formatBRL(kpis.recebido),
          aReceber: formatBRL(kpis.aReceber),
          despesas: formatBRL(kpis.despesas),
          meta: formatBRL(meta),
          provisaoImposto: formatBRL(provisaoImposto),
          resultado: formatBRL(kpis.resultado),
        };
      },
    }),

    getCashProjection: tool({
      description:
        'Projeta o caixa dos próximos N meses em duas curvas: piso (só receita contratada) e provável (contratada + pipeline de vendas ponderado por probabilidade).',
      inputSchema: z.object({
        months: z
          .number()
          .int()
          .positive()
          .max(24)
          .optional()
          .describe('Quantidade de meses a projetar. Padrão: configuração da organização (ou 6).'),
      }),
      execute: async ({ months }) => {
        const today = todayKey();
        const currentMonth = today.slice(0, 7);

        const [settingsRes, receivablesRes, entriesRes, expensesRes, dealsRes] = await Promise.all([
          supabase.from('finance_settings').select('*').eq('organization_id', organizationId).maybeSingle(),
          supabase
            .from('finance_receivables')
            .select('due_date, amount')
            .eq('organization_id', organizationId)
            .is('deleted_at', null),
          supabase
            .from('finance_expense_entries')
            .select('due_date, amount, expense_id')
            .eq('organization_id', organizationId)
            .is('deleted_at', null),
          supabase
            .from('finance_expenses')
            .select('id, amount, due_day')
            .eq('organization_id', organizationId)
            .is('deleted_at', null)
            .eq('kind', 'FIXED')
            .eq('active', true),
          supabase
            .from('deals')
            .select('value, probability, custom_fields')
            .eq('organization_id', organizationId)
            .is('deleted_at', null)
            .eq('is_won', false)
            .eq('is_lost', false),
        ]);

        if (receivablesRes.error) return { error: formatSupabaseFailure(receivablesRes.error) };
        if (entriesRes.error) return { error: formatSupabaseFailure(entriesRes.error) };
        if (expensesRes.error) return { error: formatSupabaseFailure(expensesRes.error) };
        if (dealsRes.error) return { error: formatSupabaseFailure(dealsRes.error) };

        const settings = settingsRes.data as any;
        const horizonMonths = months || settings?.projection_months || DEFAULT_PROJECTION_MONTHS;
        const taxRate = settings?.tax_rate ?? 0;
        const initialBalance = settings?.initial_balance ?? 0;

        const monthsArr = Array.from({ length: horizonMonths }, (_, i) => addMonthsToKey(currentMonth, i));

        const fixedRules = ((expensesRes.data as any[]) || []).map((e) => ({
          amount: e.amount,
          dueDay: e.due_day ?? 1,
          expenseId: e.id,
        }));

        const weighted = weightDeals(
          ((dealsRes.data as any[]) || []).map((d) =>
            mapOpenDealForProjection({
              value: d.value ?? 0,
              probability: d.probability ?? 0,
              customFields: d.custom_fields || {},
            })
          ),
          {
            today,
            horizonMonths,
            defaultCloseDays: PROJECTION_DEFAULT_CLOSE_DAYS,
            assumedBillingDay: PROJECTION_ASSUMED_BILLING_DAY,
          }
        );

        const projection = buildProjection({
          months: monthsArr,
          receivables: ((receivablesRes.data as any[]) || []).map((r) => ({ dueDate: r.due_date, amount: r.amount })),
          expenseEntries: ((entriesRes.data as any[]) || []).map((e) => ({
            dueDate: e.due_date,
            amount: e.amount,
            expenseId: e.expense_id,
          })),
          fixedRules,
          weighted,
          taxRate,
          initialBalance,
        });

        return {
          meses: projection.map((p) => ({
            mes: p.month,
            contratado: formatBRL(p.contracted),
            provavel: formatBRL(p.probable),
            despesas: formatBRL(p.expenses),
            provisaoImposto: formatBRL(p.taxProvision),
            saldoPiso: formatBRL(p.balanceFloor),
            saldoProvavel: formatBRL(p.balanceProbable),
          })),
        };
      },
    }),

    listOverdueReceivables: tool({
      description: 'Lista recebíveis pendentes com vencimento no passado (atrasados), do mais antigo para o mais recente.',
      inputSchema: z.object({
        limit: z.number().int().positive().max(50).optional().default(20),
      }),
      execute: async ({ limit }) => {
        const today = todayKey();
        const { data, error } = await supabase
          .from('finance_receivables')
          .select('id, description, amount, due_date, contract:finance_contracts(contact:contacts(name))')
          .eq('organization_id', organizationId)
          .is('deleted_at', null)
          .eq('status', 'PENDING')
          .lt('due_date', today)
          .order('due_date', { ascending: true })
          .limit(limit);

        if (error) return { error: formatSupabaseFailure(error) };

        const rows = ((data as any[]) || []).map((r) => ({
          id: r.id,
          cliente: r.contract?.contact?.name || 'N/A',
          descricao: r.description,
          valor: formatBRL(r.amount),
          vencimento: r.due_date,
          diasAtraso: daysOverdue(r.due_date, today),
        }));

        return {
          count: rows.length,
          total: formatBRL(round2(((data as any[]) || []).reduce((sum, r) => sum + (r.amount || 0), 0))),
          recebiveis: rows,
        };
      },
    }),

    // ============= DESPESA NOVA (2 passos) =============
    prepareCreateExpense: tool({
      description:
        'Valida e monta o resumo de uma NOVA despesa (fixa ou pontual) — NÃO grava nada. Sempre mostre o "summary" devolvido ao usuário e só chame confirmCreateExpense depois de confirmação explícita dele.',
      inputSchema: z.object({
        description: z.string().min(1).describe('Descrição da despesa'),
        category: z
          .string()
          .optional()
          .describe(`Categoria (uma de: ${EXPENSE_CATEGORIES.join(', ')}). Padrão: Outros.`),
        amount: z.number().positive().describe('Valor em reais'),
        kind: z.enum(['FIXED', 'ONE_TIME']).describe('FIXED = recorrente mensal; ONE_TIME = pontual'),
        dueDay: z.number().int().min(1).max(28).optional().describe('Dia do mês (1-28) — obrigatório se kind=FIXED'),
        dueDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe('Data yyyy-MM-dd — obrigatória se kind=ONE_TIME'),
      }),
      execute: async ({ description, category, amount, kind, dueDay, dueDate }) => {
        if (kind === 'FIXED' && !dueDay) {
          return { error: 'Despesa fixa precisa de dueDay (dia do mês, 1-28).' };
        }
        if (kind === 'ONE_TIME' && !dueDate) {
          return { error: 'Despesa pontual precisa de dueDate (yyyy-MM-dd).' };
        }

        const resolvedCategory =
          category && (EXPENSE_CATEGORIES as readonly string[]).includes(category) ? category : 'Outros';

        const resolved: ResolvedCreateExpense = {
          description: description.trim(),
          category: resolvedCategory,
          amount: round2(amount),
          kind,
          dueDay: kind === 'FIXED' ? (dueDay as number) : null,
          dueDate: kind === 'ONE_TIME' ? (dueDate as string) : null,
        };

        const confirmationToken = computeConfirmationToken('createExpense', {
          description: resolved.description,
          category: resolved.category,
          amount: resolved.amount,
          kind: resolved.kind,
          dueDay: resolved.dueDay,
          dueDate: resolved.dueDate,
        });

        return {
          ok: true,
          summary: formatCreateExpenseSummary(resolved),
          confirmationToken,
          description: resolved.description,
          category: resolved.category,
          amount: resolved.amount,
          kind: resolved.kind,
          dueDay: resolved.dueDay,
          dueDate: resolved.dueDate,
        };
      },
    }),

    confirmCreateExpense: tool({
      description:
        'Grava a despesa de fato. Chame SOMENTE após o usuário confirmar explicitamente o resumo devolvido pelo prepareCreateExpense correspondente. Repasse EXATAMENTE description, category, amount, kind, dueDay, dueDate e confirmationToken retornados pelo prepare — qualquer valor alterado invalida o token e a chamada falha.',
      inputSchema: z.object({
        description: z.string().min(1),
        category: z.string().min(1),
        amount: z.number().positive(),
        kind: z.enum(['FIXED', 'ONE_TIME']),
        dueDay: z.number().int().min(1).max(28).nullable(),
        dueDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .nullable(),
        confirmationToken: z.string().describe('Token devolvido por prepareCreateExpense'),
      }),
      execute: async ({ description, category, amount, kind, dueDay, dueDate, confirmationToken }) => {
        const trimmedDescription = description.trim();
        const roundedAmount = round2(amount);
        const normalizedDueDay = kind === 'FIXED' ? dueDay : null;
        const normalizedDueDate = kind === 'ONE_TIME' ? dueDate : null;

        const valid = verifyConfirmationToken(
          'createExpense',
          {
            description: trimmedDescription,
            category,
            amount: roundedAmount,
            kind,
            dueDay: normalizedDueDay,
            dueDate: normalizedDueDate,
          },
          confirmationToken
        );
        if (!valid) {
          return {
            error:
              'Os dados não conferem com a confirmação gerada pelo prepareCreateExpense (algum valor foi alterado, ou o token é de outro resumo). Rode prepareCreateExpense novamente e confirme o resumo exato.',
          };
        }

        const { data: expense, error: expenseError } = await supabase
          .from('finance_expenses')
          .insert({
            organization_id: organizationId,
            description: trimmedDescription,
            category,
            amount: roundedAmount,
            kind,
            due_day: normalizedDueDay,
            due_date: normalizedDueDate,
            active: true,
          })
          .select('id, description, amount')
          .single();

        if (expenseError || !expense) {
          return { error: formatSupabaseFailure(expenseError) };
        }

        // Pontual já nasce com o lançamento (mesmo comportamento do form de despesa da UI —
        // ver submitExpenseForm em useFinanceController.ts). Fixa não: a materialização mensal
        // é responsabilidade da própria tela (regra ainda não gerada não é um erro aqui).
        if (kind === 'ONE_TIME' && normalizedDueDate) {
          const { error: entryError } = await supabase.from('finance_expense_entries').insert({
            organization_id: organizationId,
            expense_id: expense.id,
            due_date: normalizedDueDate,
            amount: roundedAmount,
          });
          if (entryError) {
            return {
              success: true,
              warning: `Despesa criada, mas falhou ao lançar o vencimento pontual: ${formatSupabaseFailure(entryError)}`,
              expenseId: expense.id,
            };
          }
        }

        return {
          success: true,
          message: `Despesa "${expense.description}" (${formatBRL((expense as any).amount)}) criada com sucesso.`,
          expenseId: expense.id,
        };
      },
    }),

    // ============= BAIXA DE RECEBÍVEL (2 passos) =============
    prepareMarkReceivablePaid: tool({
      description:
        'Localiza um recebível PENDENTE (por receivableId, ou por nome do cliente + valor/descrição) e monta o resumo da baixa — NÃO grava nada. Se houver mais de um candidato, devolve a lista para o usuário escolher (chame de novo com receivableId). Sempre mostre o "summary" e só chame confirmMarkReceivablePaid depois de confirmação explícita.',
      inputSchema: z.object({
        receivableId: z.string().uuid().optional().describe('ID do recebível, se já conhecido'),
        clientName: z.string().optional().describe('Nome do cliente/contato, para localizar o recebível'),
        amount: z.number().positive().optional().describe('Valor do recebível, para desambiguar'),
        description: z.string().optional().describe('Trecho da descrição do recebível, para desambiguar'),
      }),
      execute: async ({ receivableId, clientName, amount, description }) => {
        let query = supabase
          .from('finance_receivables')
          .select('id, description, amount, due_date, contract:finance_contracts(contact:contacts(name))')
          .eq('organization_id', organizationId)
          .is('deleted_at', null)
          .eq('status', 'PENDING');

        if (receivableId) {
          query = query.eq('id', receivableId);
        } else {
          if (amount !== undefined) query = query.eq('amount', round2(amount));
          if (description) query = query.ilike('description', `%${sanitizePostgrestValue(description)}%`);
        }

        const { data, error } = await query.limit(20);
        if (error) return { error: formatSupabaseFailure(error) };

        let candidates = ((data as any[]) || []).slice();
        if (!receivableId && clientName) {
          const needle = clientName.trim().toLowerCase();
          candidates = candidates.filter((r) => (r.contract?.contact?.name || '').toLowerCase().includes(needle));
        }

        if (candidates.length === 0) {
          return { error: 'Nenhum recebível pendente encontrado com esses critérios.' };
        }
        if (candidates.length > 1) {
          return {
            error: `Encontrei ${candidates.length} recebíveis pendentes com esses critérios. Peça ao usuário para especificar mais (valor exato, mais trecho da descrição) e chame de novo, ou use o receivableId de um dos candidatos abaixo.`,
            candidatos: candidates.slice(0, 5).map((r) => ({
              receivableId: r.id,
              cliente: r.contract?.contact?.name || 'N/A',
              descricao: r.description,
              valor: formatBRL(r.amount),
              vencimento: r.due_date,
            })),
          };
        }

        const found = candidates[0];
        const resolved: ResolvedMarkReceivablePaid = {
          receivableId: found.id,
          amount: round2(found.amount),
          description: found.description,
          dueDate: found.due_date,
          clientName: found.contract?.contact?.name || null,
        };

        const confirmationToken = computeConfirmationToken('markReceivablePaid', {
          receivableId: resolved.receivableId,
          amount: resolved.amount,
        });

        return {
          ok: true,
          summary: formatMarkReceivablePaidSummary(resolved),
          confirmationToken,
          receivableId: resolved.receivableId,
          amount: resolved.amount,
          descricao: resolved.description,
          cliente: resolved.clientName,
          vencimento: resolved.dueDate,
        };
      },
    }),

    confirmMarkReceivablePaid: tool({
      description:
        'Marca o recebível como pago de fato. Chame SOMENTE após o usuário confirmar explicitamente o resumo devolvido pelo prepareMarkReceivablePaid correspondente. Repasse EXATAMENTE receivableId, amount e confirmationToken retornados pelo prepare — qualquer valor alterado invalida o token e a chamada falha.',
      inputSchema: z.object({
        receivableId: z.string().uuid().describe('ID do recebível, exatamente como devolvido pelo prepare'),
        amount: z.number().positive().describe('Valor do recebível, exatamente como devolvido pelo prepare'),
        confirmationToken: z.string().describe('Token devolvido por prepareMarkReceivablePaid'),
      }),
      execute: async ({ receivableId, amount, confirmationToken }) => {
        const roundedAmount = round2(amount);
        const valid = verifyConfirmationToken(
          'markReceivablePaid',
          { receivableId, amount: roundedAmount },
          confirmationToken
        );
        if (!valid) {
          return {
            error:
              'Os dados não conferem com a confirmação gerada pelo prepareMarkReceivablePaid (id ou valor alterado, ou token de outro resumo). Rode prepareMarkReceivablePaid novamente.',
          };
        }

        // Defesa em profundidade: mesmo com token válido, revalida contra o banco — o recebível
        // pode ter mudado entre o prepare e o confirm (baixado por outra via, valor diferente etc).
        const { data: current, error: fetchError } = await supabase
          .from('finance_receivables')
          .select('id, amount, status, description')
          .eq('organization_id', organizationId)
          .eq('id', receivableId)
          .is('deleted_at', null)
          .maybeSingle();

        if (fetchError) return { error: formatSupabaseFailure(fetchError) };
        if (!current) return { error: 'Recebível não encontrado nesta organização.' };
        if ((current as any).status !== 'PENDING') {
          return { error: `Este recebível já não está pendente (status atual: ${(current as any).status}).` };
        }
        if (Math.abs((current as any).amount - roundedAmount) > 0.01) {
          return {
            error: `O valor informado (${formatBRL(roundedAmount)}) não confere com o valor atual do recebível (${formatBRL(
              (current as any).amount
            )}). Rode prepareMarkReceivablePaid novamente.`,
          };
        }

        const { data, error } = await supabase
          .from('finance_receivables')
          .update({ status: 'PAID', paid_at: new Date().toISOString() })
          .eq('organization_id', organizationId)
          .eq('id', receivableId)
          .select('description, amount')
          .single();

        if (error || !data) return { error: formatSupabaseFailure(error) };

        return {
          success: true,
          message: `Recebível "${(data as any).description}" (${formatBRL((data as any).amount)}) marcado como pago.`,
        };
      },
    }),

    // ============= META MENSAL (2 passos) =============
    prepareSetMonthlyGoal: tool({
      description:
        'Valida e monta o resumo de uma nova meta mensal — NÃO grava nada. Sempre mostre o "summary" e só chame confirmSetMonthlyGoal depois de confirmação explícita.',
      inputSchema: z.object({
        month: z
          .string()
          .regex(/^\d{4}-\d{2}$/)
          .describe('Mês no formato yyyy-MM'),
        targetValue: z.number().nonnegative().describe('Valor da meta em reais'),
      }),
      execute: async ({ month, targetValue }) => {
        const resolved: ResolvedSetMonthlyGoal = { month, targetValue: round2(targetValue) };
        const confirmationToken = computeConfirmationToken('setMonthlyGoal', {
          month: resolved.month,
          targetValue: resolved.targetValue,
        });

        return {
          ok: true,
          summary: formatSetMonthlyGoalSummary(resolved),
          confirmationToken,
          month: resolved.month,
          targetValue: resolved.targetValue,
        };
      },
    }),

    confirmSetMonthlyGoal: tool({
      description:
        'Grava a meta mensal (cria ou atualiza). Chame SOMENTE após o usuário confirmar explicitamente o resumo devolvido pelo prepareSetMonthlyGoal correspondente. Repasse EXATAMENTE month, targetValue e confirmationToken retornados pelo prepare — qualquer valor alterado invalida o token e a chamada falha.',
      inputSchema: z.object({
        month: z
          .string()
          .regex(/^\d{4}-\d{2}$/),
        targetValue: z.number().nonnegative(),
        confirmationToken: z.string().describe('Token devolvido por prepareSetMonthlyGoal'),
      }),
      execute: async ({ month, targetValue, confirmationToken }) => {
        const roundedTarget = round2(targetValue);
        const valid = verifyConfirmationToken('setMonthlyGoal', { month, targetValue: roundedTarget }, confirmationToken);
        if (!valid) {
          return {
            error:
              'Os dados não conferem com a confirmação gerada pelo prepareSetMonthlyGoal (mês ou valor alterado, ou token de outro resumo). Rode prepareSetMonthlyGoal novamente.',
          };
        }

        const { data, error } = await supabase
          .from('finance_goals')
          .upsert(
            {
              organization_id: organizationId,
              month: `${month}-01`,
              target_value: roundedTarget,
              updated_at: new Date().toISOString(),
            },
            { onConflict: 'organization_id,month' }
          )
          .select('month, target_value')
          .single();

        if (error || !data) return { error: formatSupabaseFailure(error) };

        return {
          success: true,
          message: `Meta de ${month} definida em ${formatBRL((data as any).target_value)}.`,
        };
      },
    }),
  } as Record<string, any>;

  return tools;
}
