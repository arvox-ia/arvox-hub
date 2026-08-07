/**
 * @fileoverview Serviço Supabase para o módulo financeiro (Fase 1B).
 *
 * Cobre as 6 tabelas `finance_*` (settings, contracts, receivables, expenses,
 * expense_entries, goals) criadas em
 * `supabase/migrations/20260807120000_finance_module.sql`, mais a leitura de
 * deals abertos para o pipeline ponderado (Task 4/10).
 *
 * ## Multi-tenant e RLS
 *
 * Todas as tabelas `finance_*` têm RLS admin-only em TODOS os verbos (ver
 * migration). Este serviço usa o client anon normal (`./client`) — a
 * enforcement de "só admin da org enxerga/edita" é feita 100% pelo Postgres,
 * nunca aqui. NÃO usar client service-role neste arquivo.
 *
 * ## Núcleo puro
 *
 * Este serviço NUNCA reimplementa geração de recebíveis/despesas fixas nem
 * a ponderação de pipeline/projeção — isso vive em `features/finance/core/*`
 * (puro, sem I/O). `createContract` recebe os recebíveis já gerados pelo
 * controller (que chama o core) e só persiste.
 *
 * ## Datas
 *
 * `period` sempre `yyyy-MM` (nunca `Date`) — ver `periodToDateRange`.
 *
 * @module lib/supabase/finance
 */

import { supabase } from './client';
import { sanitizeUUID } from './utils';

// ============================================
// ORGANIZATION HELPER (mesmo padrão de contacts.ts)
// ============================================

async function getCurrentOrganizationId(): Promise<string | null> {
  if (!supabase) return null;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .maybeSingle();
  return (profile as any)?.organization_id ?? null;
}

// ============================================
// PERIOD HELPER
// ============================================

/**
 * Converte um período `yyyy-MM` no range de datas `yyyy-MM-dd` (primeiro ao
 * último dia do mês, inclusive) usado para filtrar `due_date` nas queries
 * de recebíveis/lançamentos. Parsing por split puro (nunca `new Date(string)`)
 * para não sofrer deslocamento de timezone; o único uso de `Date` é local
 * (`new Date(year, monthIndex0 + 1, 0)`) para achar o último dia do mês.
 *
 * @param period - Período `yyyy-MM` (ex.: `2026-03`).
 * @returns `{ start, end }`, ambos `yyyy-MM-dd`.
 *
 * @example
 * ```typescript
 * periodToDateRange('2026-02') // { start: '2026-02-01', end: '2026-02-28' }
 * periodToDateRange('2028-02') // { start: '2028-02-01', end: '2028-02-29' } (bissexto)
 * ```
 */
export function periodToDateRange(period: string): { start: string; end: string } {
  const [yearStr, monthStr] = period.split('-');
  const year = Number(yearStr);
  const monthIndex0 = Number(monthStr) - 1;
  const lastDay = new Date(year, monthIndex0 + 1, 0).getDate();
  const pad2 = (n: number): string => (n < 10 ? `0${n}` : `${n}`);
  return {
    start: `${yearStr}-${monthStr}-01`,
    end: `${yearStr}-${monthStr}-${pad2(lastDay)}`,
  };
}

// ============================================
// DB TYPES (snake_case, espelham a migration)
// ============================================

export interface DbFinanceSettings {
  organization_id: string;
  tax_rate: number;
  initial_balance: number;
  projection_months: number;
  created_at: string;
  updated_at: string;
}

export interface DbFinanceContract {
  id: string;
  organization_id: string;
  contact_id: string;
  deal_id: string | null;
  description: string;
  setup_value: number;
  setup_installments: number;
  monthly_value: number;
  start_date: string;
  duration_months: number | null;
  billing_day: number;
  status: 'ACTIVE' | 'ENDED' | 'RENEWED';
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbFinanceReceivable {
  id: string;
  organization_id: string;
  contract_id: string;
  kind: 'SETUP' | 'MONTHLY';
  description: string;
  amount: number;
  due_date: string;
  status: 'PENDING' | 'PAID';
  paid_at: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbFinanceExpense {
  id: string;
  organization_id: string;
  description: string;
  category: string;
  amount: number;
  kind: 'FIXED' | 'ONE_TIME';
  due_day: number | null;
  due_date: string | null;
  active: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbFinanceExpenseEntry {
  id: string;
  organization_id: string;
  expense_id: string;
  due_date: string;
  amount: number;
  status: 'PENDING' | 'PAID';
  paid_at: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbFinanceGoal {
  id: string;
  organization_id: string;
  month: string;
  target_value: number;
  created_at: string;
  updated_at: string;
}

/**
 * Linha crua de `deals` usada pelo pipeline ponderado. `custom_fields` é
 * exposto sem parsing — a Task 10 lê `monthlyValue`/`durationMonths`/
 * `expectedClose` de dentro dele; este serviço não sabe (nem deve saber) o
 * shape desses custom fields.
 */
export interface DbOpenDealForProjection {
  id: string;
  value: number;
  probability: number;
  custom_fields: Record<string, unknown>;
  closed_at: string | null;
}

// ============================================
// DOMAIN TYPES (camelCase)
// ============================================

export interface FinanceSettings {
  organizationId: string;
  taxRate: number;
  initialBalance: number;
  projectionMonths: number;
  createdAt: string;
  updatedAt: string;
}

export interface FinanceContract {
  id: string;
  organizationId: string;
  contactId: string;
  dealId: string | null;
  description: string;
  setupValue: number;
  setupInstallments: number;
  monthlyValue: number;
  startDate: string;
  durationMonths: number | null;
  billingDay: number;
  status: 'ACTIVE' | 'ENDED' | 'RENEWED';
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FinanceReceivable {
  id: string;
  organizationId: string;
  contractId: string;
  kind: 'SETUP' | 'MONTHLY';
  description: string;
  amount: number;
  dueDate: string;
  status: 'PENDING' | 'PAID';
  paidAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FinanceExpense {
  id: string;
  organizationId: string;
  description: string;
  category: string;
  amount: number;
  kind: 'FIXED' | 'ONE_TIME';
  dueDay: number | null;
  dueDate: string | null;
  active: boolean;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FinanceExpenseEntry {
  id: string;
  organizationId: string;
  expenseId: string;
  dueDate: string;
  amount: number;
  status: 'PENDING' | 'PAID';
  paidAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FinanceGoal {
  id: string;
  organizationId: string;
  /** `yyyy-MM-dd`, sempre dia 1 do mês. */
  month: string;
  targetValue: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Deal aberto (não ganho, não perdido, não deletado) exposto para o
 * pipeline ponderado. `customFields` é repassado cru.
 *
 * TODO(Task 10): parsear `customFields.monthlyValue` / `durationMonths` /
 * `expectedClose` aqui (ou no controller que consome isto) para montar o
 * `OpenDeal` que `weightDeals` (features/finance/core/pipeline.ts) espera.
 */
export interface OpenDealForProjection {
  id: string;
  value: number;
  probability: number;
  customFields: Record<string, unknown>;
  closedAt: string | null;
}

// ============================================
// INPUT TYPES
// ============================================

export type NewFinanceContractInput = {
  contactId: string;
  dealId?: string | null;
  description?: string;
  setupValue: number;
  setupInstallments: number;
  monthlyValue: number;
  startDate: string;
  durationMonths: number | null;
  billingDay: number;
  status?: FinanceContract['status'];
};

/** Recebível já gerado pelo core (`generateReceivables`), pronto para inserir. */
export type NewReceivableInput = {
  kind: 'SETUP' | 'MONTHLY';
  amount: number;
  dueDate: string;
  description: string;
};

export type NewFinanceExpenseInput = {
  description: string;
  category?: string;
  amount: number;
  kind: 'FIXED' | 'ONE_TIME';
  dueDay?: number | null;
  dueDate?: string | null;
  active?: boolean;
};

export type NewFinanceGoalInput = {
  /** `yyyy-MM-dd`, dia 1 do mês. */
  month: string;
  targetValue: number;
};

// ============================================
// TRANSFORMS
// ============================================

const transformSettings = (db: DbFinanceSettings): FinanceSettings => ({
  organizationId: db.organization_id,
  taxRate: db.tax_rate,
  initialBalance: db.initial_balance,
  projectionMonths: db.projection_months,
  createdAt: db.created_at,
  updatedAt: db.updated_at,
});

const transformContract = (db: DbFinanceContract): FinanceContract => ({
  id: db.id,
  organizationId: db.organization_id,
  contactId: db.contact_id,
  dealId: db.deal_id,
  description: db.description,
  setupValue: db.setup_value,
  setupInstallments: db.setup_installments,
  monthlyValue: db.monthly_value,
  startDate: db.start_date,
  durationMonths: db.duration_months,
  billingDay: db.billing_day,
  status: db.status,
  deletedAt: db.deleted_at,
  createdAt: db.created_at,
  updatedAt: db.updated_at,
});

const transformReceivable = (db: DbFinanceReceivable): FinanceReceivable => ({
  id: db.id,
  organizationId: db.organization_id,
  contractId: db.contract_id,
  kind: db.kind,
  description: db.description,
  amount: db.amount,
  dueDate: db.due_date,
  status: db.status,
  paidAt: db.paid_at,
  deletedAt: db.deleted_at,
  createdAt: db.created_at,
  updatedAt: db.updated_at,
});

const transformExpense = (db: DbFinanceExpense): FinanceExpense => ({
  id: db.id,
  organizationId: db.organization_id,
  description: db.description,
  category: db.category,
  amount: db.amount,
  kind: db.kind,
  dueDay: db.due_day,
  dueDate: db.due_date,
  active: db.active,
  deletedAt: db.deleted_at,
  createdAt: db.created_at,
  updatedAt: db.updated_at,
});

const transformExpenseEntry = (db: DbFinanceExpenseEntry): FinanceExpenseEntry => ({
  id: db.id,
  organizationId: db.organization_id,
  expenseId: db.expense_id,
  dueDate: db.due_date,
  amount: db.amount,
  status: db.status,
  paidAt: db.paid_at,
  deletedAt: db.deleted_at,
  createdAt: db.created_at,
  updatedAt: db.updated_at,
});

const transformGoal = (db: DbFinanceGoal): FinanceGoal => ({
  id: db.id,
  organizationId: db.organization_id,
  month: db.month,
  targetValue: db.target_value,
  createdAt: db.created_at,
  updatedAt: db.updated_at,
});

const transformOpenDeal = (db: DbOpenDealForProjection): OpenDealForProjection => ({
  id: db.id,
  value: db.value ?? 0,
  probability: db.probability ?? 0,
  customFields: db.custom_fields || {},
  closedAt: db.closed_at,
});

// ============================================
// SERVICE
// ============================================

/**
 * Serviço de dados do módulo financeiro. Todas as operações retornam
 * `{ data, error }` e dependem de RLS (admin-only) para isolamento — nunca
 * filtram `organization_id` explicitamente em leitura, só em escrita
 * (`create`/`upsert`, que precisam do valor para o INSERT).
 */
export const financeService = {
  // ---------- Settings (1 linha por org) ----------

  /**
   * Busca as configurações financeiras da organização atual.
   *
   * CAVEAT: `{ data: null, error: null }` é retornado tanto quando a
   * organização ainda não tem linha em `finance_settings` (caso normal —
   * o caller deve tratar como "usar defaults") QUANTO quando não há
   * usuário autenticado (`getCurrentOrganizationId()` retorna `null`). Os
   * dois casos são indistinguíveis pelo retorno; na prática só o primeiro
   * deve ocorrer, já que a UI do módulo já está atrás de guard de rota
   * (`requireFinanceAdmin`) antes de chamar isto.
   */
  async getSettings(): Promise<{ data: FinanceSettings | null; error: Error | null }> {
    try {
      if (!supabase) return { data: null, error: new Error('Supabase não configurado') };
      const organizationId = await getCurrentOrganizationId();
      if (!organizationId) return { data: null, error: null };

      const { data, error } = await supabase
        .from('finance_settings')
        .select('*')
        .eq('organization_id', organizationId)
        .maybeSingle();

      if (error) return { data: null, error };
      return { data: data ? transformSettings(data as DbFinanceSettings) : null, error: null };
    } catch (e) {
      return { data: null, error: e as Error };
    }
  },

  /** Cria ou atualiza (upsert por `organization_id`) as configurações financeiras. */
  async upsertSettings(
    settings: Partial<Pick<FinanceSettings, 'taxRate' | 'initialBalance' | 'projectionMonths'>>
  ): Promise<{ data: FinanceSettings | null; error: Error | null }> {
    try {
      if (!supabase) return { data: null, error: new Error('Supabase não configurado') };
      const organizationId = await getCurrentOrganizationId();
      if (!organizationId) return { data: null, error: new Error('Organização não encontrada') };

      const upsertData: Record<string, unknown> = {
        organization_id: organizationId,
        updated_at: new Date().toISOString(),
      };
      if (settings.taxRate !== undefined) upsertData.tax_rate = settings.taxRate;
      if (settings.initialBalance !== undefined) upsertData.initial_balance = settings.initialBalance;
      if (settings.projectionMonths !== undefined) upsertData.projection_months = settings.projectionMonths;

      const { data, error } = await supabase
        .from('finance_settings')
        .upsert(upsertData, { onConflict: 'organization_id' })
        .select()
        .single();

      if (error) return { data: null, error };
      return { data: transformSettings(data as DbFinanceSettings), error: null };
    } catch (e) {
      return { data: null, error: e as Error };
    }
  },

  // ---------- Contracts ----------

  /** Lista contratos ativos (não soft-deletados) da organização. */
  async listContracts(): Promise<{ data: FinanceContract[] | null; error: Error | null }> {
    try {
      if (!supabase) return { data: null, error: new Error('Supabase não configurado') };
      const { data, error } = await supabase
        .from('finance_contracts')
        .select('*')
        .is('deleted_at', null)
        .order('start_date', { ascending: false });

      if (error) return { data: null, error };
      return { data: (data || []).map(c => transformContract(c as DbFinanceContract)), error: null };
    } catch (e) {
      return { data: null, error: e as Error };
    }
  },

  /**
   * Cria um contrato e, na sequência, insere em lote os recebíveis já
   * gerados pelo core (`generateReceivables`, chamado pelo controller —
   * NUNCA aqui). Se a inserção dos recebíveis falhar, o contrato criado é
   * compensado com um SOFT-delete (`deleted_at`, `status='ENDED'`) — nunca
   * `.delete()`, tabela financeira não admite hard delete. Se a própria
   * compensação falhar, isso é logado e reportado no `error` retornado
   * (nunca descartado em silêncio): um contrato fantasma sem recebíveis
   * precisa de revisão manual visível, não de um `.delete()` esquecido.
   */
  async createContract(
    contract: NewFinanceContractInput,
    receivables: NewReceivableInput[]
  ): Promise<{ data: { contract: FinanceContract; receivables: FinanceReceivable[] } | null; error: Error | null }> {
    try {
      if (!supabase) return { data: null, error: new Error('Supabase não configurado') };
      const organizationId = await getCurrentOrganizationId();
      if (!organizationId) return { data: null, error: new Error('Organização não encontrada') };

      const insertData = {
        contact_id: contract.contactId,
        deal_id: sanitizeUUID(contract.dealId ?? null),
        description: contract.description ?? '',
        setup_value: contract.setupValue,
        setup_installments: contract.setupInstallments,
        monthly_value: contract.monthlyValue,
        start_date: contract.startDate,
        duration_months: contract.durationMonths,
        billing_day: contract.billingDay,
        status: contract.status ?? 'ACTIVE',
        organization_id: organizationId,
      };

      const { data: contractRow, error: contractError } = await supabase
        .from('finance_contracts')
        .insert(insertData)
        .select()
        .single();

      if (contractError) return { data: null, error: contractError };
      const dbContract = contractRow as DbFinanceContract;

      if (receivables.length === 0) {
        return { data: { contract: transformContract(dbContract), receivables: [] }, error: null };
      }

      const receivablesInsert = receivables.map(r => ({
        contract_id: dbContract.id,
        kind: r.kind,
        description: r.description,
        amount: r.amount,
        due_date: r.dueDate,
        organization_id: organizationId,
      }));

      const { data: receivableRows, error: receivablesError } = await supabase
        .from('finance_receivables')
        .insert(receivablesInsert)
        .select();

      if (receivablesError) {
        // Compensação: sem transação multi-statement no client, não dá para
        // desfazer o insert do contrato atomicamente. Em vez de HARD delete
        // (proibido em tabela financeira — regra do módulo é soft-delete
        // sempre), soft-deletamos o contrato órfão. `listContracts` já
        // filtra `.is('deleted_at', null)`, então ele some da UI de
        // qualquer forma; a diferença é que o registro fica auditável.
        const { error: compensationError } = await supabase
          .from('finance_contracts')
          .update({ deleted_at: new Date().toISOString(), status: 'ENDED' })
          .eq('id', dbContract.id);

        if (compensationError) {
          // A própria compensação falhou: o contrato órfão (sem recebíveis)
          // continua ativo e visível. Isso NUNCA pode ser um erro silencioso.
          console.error(
            '[finance] falha ao compensar contrato órfão após erro nos recebíveis',
            { contractId: dbContract.id, receivablesError, compensationError }
          );
          return {
            data: null,
            error: new Error(
              `Falha ao criar recebíveis (${receivablesError.message}); o contrato ${dbContract.id} ficou inconsistente (sem parcelas, não foi possível marcá-lo como encerrado) e precisa de revisão manual.`
            ),
          };
        }

        return { data: null, error: receivablesError };
      }

      return {
        data: {
          contract: transformContract(dbContract),
          receivables: (receivableRows || []).map(r => transformReceivable(r as DbFinanceReceivable)),
        },
        error: null,
      };
    } catch (e) {
      return { data: null, error: e as Error };
    }
  },

  /** Atualiza campos de um contrato existente. */
  async updateContract(
    id: string,
    updates: Partial<Omit<FinanceContract, 'id' | 'organizationId' | 'createdAt' | 'updatedAt'>>
  ): Promise<{ data: FinanceContract | null; error: Error | null }> {
    try {
      if (!supabase) return { data: null, error: new Error('Supabase não configurado') };

      const dbUpdates: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (updates.contactId !== undefined) dbUpdates.contact_id = updates.contactId;
      if (updates.dealId !== undefined) dbUpdates.deal_id = sanitizeUUID(updates.dealId);
      if (updates.description !== undefined) dbUpdates.description = updates.description;
      if (updates.setupValue !== undefined) dbUpdates.setup_value = updates.setupValue;
      if (updates.setupInstallments !== undefined) dbUpdates.setup_installments = updates.setupInstallments;
      if (updates.monthlyValue !== undefined) dbUpdates.monthly_value = updates.monthlyValue;
      if (updates.startDate !== undefined) dbUpdates.start_date = updates.startDate;
      if (updates.durationMonths !== undefined) dbUpdates.duration_months = updates.durationMonths;
      if (updates.billingDay !== undefined) dbUpdates.billing_day = updates.billingDay;
      if (updates.status !== undefined) dbUpdates.status = updates.status;
      if (updates.deletedAt !== undefined) dbUpdates.deleted_at = updates.deletedAt;

      const { data, error } = await supabase
        .from('finance_contracts')
        .update(dbUpdates)
        .eq('id', id)
        .select()
        .single();

      if (error) return { data: null, error };
      return { data: transformContract(data as DbFinanceContract), error: null };
    } catch (e) {
      return { data: null, error: e as Error };
    }
  },

  /**
   * Encerra um contrato (`status='ENDED'`) e soft-deleta os recebíveis
   * PENDING ainda não vencidos (`due_date > today`) — passado e já pago
   * ficam intocados (Task 7, guard de negócio: encerrar não deve apagar
   * histórico de cobrança). Sem transação multi-statement no client: se o
   * soft-delete dos recebíveis falhar depois do contrato já ter sido
   * marcado ENDED, isso é reportado no `error` (nunca silencioso) — o
   * contrato fica com status correto mas recebíveis futuros ainda
   * pendentes, precisa de revisão manual.
   */
  async endContract(
    id: string,
    today: string
  ): Promise<{ data: { contract: FinanceContract; deletedReceivablesCount: number } | null; error: Error | null }> {
    try {
      if (!supabase) return { data: null, error: new Error('Supabase não configurado') };

      const { data: contractRow, error: contractError } = await supabase
        .from('finance_contracts')
        .update({ status: 'ENDED', updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();

      if (contractError) return { data: null, error: contractError };

      const { data: deletedRows, error: receivablesError } = await supabase
        .from('finance_receivables')
        .update({ deleted_at: new Date().toISOString() })
        .eq('contract_id', id)
        .eq('status', 'PENDING')
        .is('deleted_at', null)
        .gt('due_date', today)
        .select('id');

      if (receivablesError) {
        console.error('[finance] contrato encerrado mas falha ao soft-deletar recebíveis futuros', {
          contractId: id,
          receivablesError,
        });
        return {
          data: null,
          error: new Error(
            `Contrato ${id} foi encerrado, mas falhou ao remover recebíveis futuros pendentes (${receivablesError.message}); precisa de revisão manual.`
          ),
        };
      }

      return {
        data: {
          contract: transformContract(contractRow as DbFinanceContract),
          deletedReceivablesCount: (deletedRows || []).length,
        },
        error: null,
      };
    } catch (e) {
      return { data: null, error: e as Error };
    }
  },

  // ---------- Receivables ----------

  /** Lista recebíveis (não deletados) com `due_date` dentro do período `yyyy-MM`. */
  async listReceivables(period: string): Promise<{ data: FinanceReceivable[] | null; error: Error | null }> {
    try {
      if (!supabase) return { data: null, error: new Error('Supabase não configurado') };
      const { start, end } = periodToDateRange(period);

      const { data, error } = await supabase
        .from('finance_receivables')
        .select('*')
        .is('deleted_at', null)
        .gte('due_date', start)
        .lte('due_date', end)
        .order('due_date', { ascending: true });

      if (error) return { data: null, error };
      return { data: (data || []).map(r => transformReceivable(r as DbFinanceReceivable)), error: null };
    } catch (e) {
      return { data: null, error: e as Error };
    }
  },

  /** Lista TODOS os recebíveis (não deletados) de um contrato, ordenados por vencimento. */
  async listReceivablesByContract(contractId: string): Promise<{ data: FinanceReceivable[] | null; error: Error | null }> {
    try {
      if (!supabase) return { data: null, error: new Error('Supabase não configurado') };

      const { data, error } = await supabase
        .from('finance_receivables')
        .select('*')
        .eq('contract_id', contractId)
        .is('deleted_at', null)
        .order('due_date', { ascending: true });

      if (error) return { data: null, error };
      return { data: (data || []).map(r => transformReceivable(r as DbFinanceReceivable)), error: null };
    } catch (e) {
      return { data: null, error: e as Error };
    }
  },

  /** Marca um recebível como pago (`status='PAID'`, `paid_at=now`). */
  async markReceivablePaid(id: string): Promise<{ data: FinanceReceivable | null; error: Error | null }> {
    try {
      if (!supabase) return { data: null, error: new Error('Supabase não configurado') };
      const { data, error } = await supabase
        .from('finance_receivables')
        .update({ status: 'PAID', paid_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();

      if (error) return { data: null, error };
      return { data: transformReceivable(data as DbFinanceReceivable), error: null };
    } catch (e) {
      return { data: null, error: e as Error };
    }
  },

  /** Desfaz a baixa de um recebível (`status='PENDING'`, `paid_at=null`). */
  async unmarkReceivablePaid(id: string): Promise<{ data: FinanceReceivable | null; error: Error | null }> {
    try {
      if (!supabase) return { data: null, error: new Error('Supabase não configurado') };
      const { data, error } = await supabase
        .from('finance_receivables')
        .update({ status: 'PENDING', paid_at: null })
        .eq('id', id)
        .select()
        .single();

      if (error) return { data: null, error };
      return { data: transformReceivable(data as DbFinanceReceivable), error: null };
    } catch (e) {
      return { data: null, error: e as Error };
    }
  },

  // ---------- Expenses (catálogo) ----------

  /** Lista despesas do catálogo (regras fixas + pontuais), não deletadas. */
  async listExpenses(): Promise<{ data: FinanceExpense[] | null; error: Error | null }> {
    try {
      if (!supabase) return { data: null, error: new Error('Supabase não configurado') };
      const { data, error } = await supabase
        .from('finance_expenses')
        .select('*')
        .is('deleted_at', null)
        .order('description', { ascending: true });

      if (error) return { data: null, error };
      return { data: (data || []).map(e => transformExpense(e as DbFinanceExpense)), error: null };
    } catch (e) {
      return { data: null, error: e as Error };
    }
  },

  /** Cria uma despesa (regra fixa ou pontual — `kind` determina quais campos são obrigatórios, ver CHECK da migration). */
  async createExpense(expense: NewFinanceExpenseInput): Promise<{ data: FinanceExpense | null; error: Error | null }> {
    try {
      if (!supabase) return { data: null, error: new Error('Supabase não configurado') };
      const organizationId = await getCurrentOrganizationId();
      if (!organizationId) return { data: null, error: new Error('Organização não encontrada') };

      const insertData = {
        description: expense.description,
        category: expense.category ?? 'Outros',
        amount: expense.amount,
        kind: expense.kind,
        due_day: expense.kind === 'FIXED' ? expense.dueDay ?? null : null,
        due_date: expense.kind === 'ONE_TIME' ? expense.dueDate ?? null : null,
        active: expense.active ?? true,
        organization_id: organizationId,
      };

      const { data, error } = await supabase
        .from('finance_expenses')
        .insert(insertData)
        .select()
        .single();

      if (error) return { data: null, error };
      return { data: transformExpense(data as DbFinanceExpense), error: null };
    } catch (e) {
      return { data: null, error: e as Error };
    }
  },

  /** Atualiza uma despesa do catálogo. */
  async updateExpense(
    id: string,
    updates: Partial<Omit<FinanceExpense, 'id' | 'organizationId' | 'createdAt' | 'updatedAt'>>
  ): Promise<{ data: FinanceExpense | null; error: Error | null }> {
    try {
      if (!supabase) return { data: null, error: new Error('Supabase não configurado') };

      const dbUpdates: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (updates.description !== undefined) dbUpdates.description = updates.description;
      if (updates.category !== undefined) dbUpdates.category = updates.category;
      if (updates.amount !== undefined) dbUpdates.amount = updates.amount;
      if (updates.kind !== undefined) dbUpdates.kind = updates.kind;
      if (updates.dueDay !== undefined) dbUpdates.due_day = updates.dueDay;
      if (updates.dueDate !== undefined) dbUpdates.due_date = updates.dueDate;
      if (updates.active !== undefined) dbUpdates.active = updates.active;
      if (updates.deletedAt !== undefined) dbUpdates.deleted_at = updates.deletedAt;

      const { data, error } = await supabase
        .from('finance_expenses')
        .update(dbUpdates)
        .eq('id', id)
        .select()
        .single();

      if (error) return { data: null, error };
      return { data: transformExpense(data as DbFinanceExpense), error: null };
    } catch (e) {
      return { data: null, error: e as Error };
    }
  },

  // ---------- Expense entries (lançamentos com baixa) ----------

  /** Lista lançamentos de despesa (não deletados) com `due_date` dentro do período `yyyy-MM`. */
  async listExpenseEntries(period: string): Promise<{ data: FinanceExpenseEntry[] | null; error: Error | null }> {
    try {
      if (!supabase) return { data: null, error: new Error('Supabase não configurado') };
      const { start, end } = periodToDateRange(period);

      const { data, error } = await supabase
        .from('finance_expense_entries')
        .select('*')
        .is('deleted_at', null)
        .gte('due_date', start)
        .lte('due_date', end)
        .order('due_date', { ascending: true });

      if (error) return { data: null, error };
      return { data: (data || []).map(e => transformExpenseEntry(e as DbFinanceExpenseEntry)), error: null };
    } catch (e) {
      return { data: null, error: e as Error };
    }
  },

  /** Marca um lançamento de despesa como pago (`status='PAID'`, `paid_at=now`). */
  async markEntryPaid(id: string): Promise<{ data: FinanceExpenseEntry | null; error: Error | null }> {
    try {
      if (!supabase) return { data: null, error: new Error('Supabase não configurado') };
      const { data, error } = await supabase
        .from('finance_expense_entries')
        .update({ status: 'PAID', paid_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();

      if (error) return { data: null, error };
      return { data: transformExpenseEntry(data as DbFinanceExpenseEntry), error: null };
    } catch (e) {
      return { data: null, error: e as Error };
    }
  },

  // ---------- Goals ----------

  /** Lista todas as metas mensais da organização. */
  async listGoals(): Promise<{ data: FinanceGoal[] | null; error: Error | null }> {
    try {
      if (!supabase) return { data: null, error: new Error('Supabase não configurado') };
      const { data, error } = await supabase
        .from('finance_goals')
        .select('*')
        .order('month', { ascending: true });

      if (error) return { data: null, error };
      return { data: (data || []).map(g => transformGoal(g as DbFinanceGoal)), error: null };
    } catch (e) {
      return { data: null, error: e as Error };
    }
  },

  /** Cria ou atualiza (upsert por `organization_id + month`) a meta de um mês. */
  async upsertGoal(goal: NewFinanceGoalInput): Promise<{ data: FinanceGoal | null; error: Error | null }> {
    try {
      if (!supabase) return { data: null, error: new Error('Supabase não configurado') };
      const organizationId = await getCurrentOrganizationId();
      if (!organizationId) return { data: null, error: new Error('Organização não encontrada') };

      const { data, error } = await supabase
        .from('finance_goals')
        .upsert(
          {
            organization_id: organizationId,
            month: goal.month,
            target_value: goal.targetValue,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'organization_id,month' }
        )
        .select()
        .single();

      if (error) return { data: null, error };
      return { data: transformGoal(data as DbFinanceGoal), error: null };
    } catch (e) {
      return { data: null, error: e as Error };
    }
  },

  // ---------- Pipeline (deals abertos) ----------

  /**
   * Lista deals abertos (não ganho, não perdido, não deletado) com os
   * campos brutos necessários para o pipeline ponderado
   * (`features/finance/core/pipeline.ts#weightDeals`). `customFields` não é
   * parseado aqui — ver TODO em `OpenDealForProjection`.
   */
  async listOpenDealsForProjection(): Promise<{ data: OpenDealForProjection[] | null; error: Error | null }> {
    try {
      if (!supabase) return { data: null, error: new Error('Supabase não configurado') };
      const { data, error } = await supabase
        .from('deals')
        .select('id, value, probability, custom_fields, closed_at')
        .is('deleted_at', null)
        .eq('is_won', false)
        .eq('is_lost', false);

      if (error) return { data: null, error };
      return { data: (data || []).map(d => transformOpenDeal(d as DbOpenDealForProjection)), error: null };
    } catch (e) {
      return { data: null, error: e as Error };
    }
  },
};
