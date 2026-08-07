/**
 * TanStack Query hooks for the finance module (Fase 1B).
 *
 * Query hooks wait for auth to be ready before fetching (RLS is admin-only
 * for every finance table — an unauthenticated/non-admin request just gets
 * an empty result from Postgres, but we avoid firing it at all). Mutations
 * invalidate by namespace (`queryKeys.finance.all`) except
 * `markReceivablePaid`/`unmarkReceivablePaid`/`markEntryPaid`, which use
 * optimistic updates against the specific period's cache entry (mirrors
 * useActivitiesQuery.ts).
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../index';
import { financeService } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import type {
  FinanceContract,
  FinanceExpense,
  FinanceExpenseEntry,
  FinanceGoal,
  FinanceReceivable,
  FinanceSettings,
  NewFinanceContractInput,
  NewFinanceExpenseInput,
  NewFinanceGoalInput,
  NewReceivableInput,
  OpenDealForProjection,
} from '@/lib/supabase/finance';

// ============ QUERY HOOKS ============

/** Configurações financeiras da organização (`null` se ainda não configurada). */
export const useFinanceSettings = (options?: { enabled?: boolean }) => {
  const { user, loading: authLoading } = useAuth();
  const externalEnabled = options?.enabled ?? true;

  return useQuery<FinanceSettings | null>({
    queryKey: queryKeys.finance.settings(),
    queryFn: async () => {
      const { data, error } = await financeService.getSettings();
      if (error) throw error;
      return data;
    },
    enabled: !authLoading && !!user && externalEnabled,
  });
};

/** Contratos ativos (não deletados) da organização. */
export const useContracts = (options?: { enabled?: boolean }) => {
  const { user, loading: authLoading } = useAuth();
  const externalEnabled = options?.enabled ?? true;

  return useQuery<FinanceContract[]>({
    queryKey: queryKeys.finance.contracts(),
    queryFn: async () => {
      const { data, error } = await financeService.listContracts();
      if (error) throw error;
      return data || [];
    },
    enabled: !authLoading && !!user && externalEnabled,
  });
};

/** Recebíveis com vencimento no período `yyyy-MM`. */
export const useReceivables = (period: string, options?: { enabled?: boolean }) => {
  const { user, loading: authLoading } = useAuth();
  const externalEnabled = options?.enabled ?? true;

  return useQuery<FinanceReceivable[]>({
    queryKey: queryKeys.finance.receivables(period),
    queryFn: async () => {
      const { data, error } = await financeService.listReceivables(period);
      if (error) throw error;
      return data || [];
    },
    enabled: !authLoading && !!user && !!period && externalEnabled,
  });
};

/** Despesas do catálogo (regras fixas + pontuais), não deletadas. */
export const useExpenses = (options?: { enabled?: boolean }) => {
  const { user, loading: authLoading } = useAuth();
  const externalEnabled = options?.enabled ?? true;

  return useQuery<FinanceExpense[]>({
    queryKey: queryKeys.finance.expenses(),
    queryFn: async () => {
      const { data, error } = await financeService.listExpenses();
      if (error) throw error;
      return data || [];
    },
    enabled: !authLoading && !!user && externalEnabled,
  });
};

/** Lançamentos de despesa com vencimento no período `yyyy-MM`. */
export const useExpenseEntries = (period: string, options?: { enabled?: boolean }) => {
  const { user, loading: authLoading } = useAuth();
  const externalEnabled = options?.enabled ?? true;

  return useQuery<FinanceExpenseEntry[]>({
    queryKey: queryKeys.finance.entries(period),
    queryFn: async () => {
      const { data, error } = await financeService.listExpenseEntries(period);
      if (error) throw error;
      return data || [];
    },
    enabled: !authLoading && !!user && !!period && externalEnabled,
  });
};

/** Metas mensais da organização. */
export const useGoals = (options?: { enabled?: boolean }) => {
  const { user, loading: authLoading } = useAuth();
  const externalEnabled = options?.enabled ?? true;

  return useQuery<FinanceGoal[]>({
    queryKey: queryKeys.finance.goals(),
    queryFn: async () => {
      const { data, error } = await financeService.listGoals();
      if (error) throw error;
      return data || [];
    },
    enabled: !authLoading && !!user && externalEnabled,
  });
};

/** Deals abertos (não ganho/perdido/deletado) para o pipeline ponderado. */
export const useOpenDealsForProjection = (options?: { enabled?: boolean }) => {
  const { user, loading: authLoading } = useAuth();
  const externalEnabled = options?.enabled ?? true;

  return useQuery<OpenDealForProjection[]>({
    queryKey: queryKeys.finance.openDeals(),
    queryFn: async () => {
      const { data, error } = await financeService.listOpenDealsForProjection();
      if (error) throw error;
      return data || [];
    },
    enabled: !authLoading && !!user && externalEnabled,
  });
};

// ============ MUTATION HOOKS ============

/**
 * Cria um contrato + o lote de recebíveis já gerados pelo core
 * (`generateReceivables`, chamado no controller — nunca aqui). Invalida
 * `contracts` e todo o namespace de `receivables` (não sabemos de antemão
 * em quais períodos as novas parcelas caem).
 */
export const useCreateContract = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      contract,
      receivables,
    }: {
      contract: NewFinanceContractInput;
      receivables: NewReceivableInput[];
    }) => {
      const { data, error } = await financeService.createContract(contract, receivables);
      if (error) throw error;
      return data!;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.finance.all });
    },
  });
};

/** Atualiza um contrato existente. */
export const useUpdateContract = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      updates,
    }: {
      id: string;
      updates: Partial<Omit<FinanceContract, 'id' | 'organizationId' | 'createdAt' | 'updatedAt'>>;
    }) => {
      const { data, error } = await financeService.updateContract(id, updates);
      if (error) throw error;
      return data!;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.finance.all });
    },
  });
};

/** Marca um recebível como pago. Otimista contra o cache do período informado. */
export const useMarkReceivablePaid = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id }: { id: string; period: string }) => {
      const { data, error } = await financeService.markReceivablePaid(id);
      if (error) throw error;
      return data!;
    },
    onMutate: async ({ id, period }) => {
      const queryKey = queryKeys.finance.receivables(period);
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<FinanceReceivable[]>(queryKey);
      queryClient.setQueryData<FinanceReceivable[]>(queryKey, (old = []) =>
        old.map(r => (r.id === id ? { ...r, status: 'PAID', paidAt: new Date().toISOString() } : r))
      );
      return { previous, period };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.finance.receivables(context.period), context.previous);
      }
    },
    onSettled: (_data, _error, { period }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.finance.receivables(period) });
    },
  });
};

/** Desfaz a baixa de um recebível. Otimista contra o cache do período informado. */
export const useUnmarkReceivablePaid = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id }: { id: string; period: string }) => {
      const { data, error } = await financeService.unmarkReceivablePaid(id);
      if (error) throw error;
      return data!;
    },
    onMutate: async ({ id, period }) => {
      const queryKey = queryKeys.finance.receivables(period);
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<FinanceReceivable[]>(queryKey);
      queryClient.setQueryData<FinanceReceivable[]>(queryKey, (old = []) =>
        old.map(r => (r.id === id ? { ...r, status: 'PENDING', paidAt: null } : r))
      );
      return { previous, period };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.finance.receivables(context.period), context.previous);
      }
    },
    onSettled: (_data, _error, { period }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.finance.receivables(period) });
    },
  });
};

/** Cria uma despesa no catálogo. */
export const useCreateExpense = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (expense: NewFinanceExpenseInput) => {
      const { data, error } = await financeService.createExpense(expense);
      if (error) throw error;
      return data!;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.finance.all });
    },
  });
};

/** Atualiza uma despesa do catálogo. */
export const useUpdateExpense = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      updates,
    }: {
      id: string;
      updates: Partial<Omit<FinanceExpense, 'id' | 'organizationId' | 'createdAt' | 'updatedAt'>>;
    }) => {
      const { data, error } = await financeService.updateExpense(id, updates);
      if (error) throw error;
      return data!;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.finance.all });
    },
  });
};

/** Marca um lançamento de despesa como pago. Otimista contra o cache do período informado. */
export const useMarkEntryPaid = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id }: { id: string; period: string }) => {
      const { data, error } = await financeService.markEntryPaid(id);
      if (error) throw error;
      return data!;
    },
    onMutate: async ({ id, period }) => {
      const queryKey = queryKeys.finance.entries(period);
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<FinanceExpenseEntry[]>(queryKey);
      queryClient.setQueryData<FinanceExpenseEntry[]>(queryKey, (old = []) =>
        old.map(e => (e.id === id ? { ...e, status: 'PAID', paidAt: new Date().toISOString() } : e))
      );
      return { previous, period };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.finance.entries(context.period), context.previous);
      }
    },
    onSettled: (_data, _error, { period }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.finance.entries(period) });
    },
  });
};

/** Cria ou atualiza (upsert) a meta de um mês. */
export const useUpsertGoal = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (goal: NewFinanceGoalInput) => {
      const { data, error } = await financeService.upsertGoal(goal);
      if (error) throw error;
      return data!;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.finance.goals() });
    },
  });
};

/** Cria ou atualiza (upsert) as configurações financeiras da organização. */
export const useUpsertFinanceSettings = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (settings: Partial<Pick<FinanceSettings, 'taxRate' | 'initialBalance' | 'projectionMonths'>>) => {
      const { data, error } = await financeService.upsertSettings(settings);
      if (error) throw error;
      return data!;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.finance.settings() });
    },
  });
};
