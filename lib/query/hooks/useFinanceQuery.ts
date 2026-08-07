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
  NewFinanceExpenseEntryInput,
  NewFinanceExpenseInput,
  NewFinanceGoalInput,
  NewReceivableInput,
  OpenDealForProjection,
  WonDealForImport,
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

/** Todos os recebíveis (não deletados) de um contrato específico, para o sheet de recebíveis. */
export const useReceivablesByContract = (contractId: string | null, options?: { enabled?: boolean }) => {
  const { user, loading: authLoading } = useAuth();
  const externalEnabled = options?.enabled ?? true;

  return useQuery<FinanceReceivable[]>({
    queryKey: queryKeys.finance.receivablesByContract(contractId ?? ''),
    queryFn: async () => {
      const { data, error } = await financeService.listReceivablesByContract(contractId as string);
      if (error) throw error;
      return data || [];
    },
    enabled: !authLoading && !!user && !!contractId && externalEnabled,
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

/**
 * TODOS os recebíveis não deletados da organização, sem filtro de período.
 * Usado pelo Dashboard (Task 9): `buildProjection` precisa dos recebíveis do
 * horizonte inteiro (não só o mês corrente), e a UpcomingList/alertas de
 * atraso precisam enxergar vencidos de qualquer mês passado — o mesmo
 * racional de `financeService.listAllReceivables`, hoje só usado pelo export
 * CSV sob demanda.
 */
export const useAllReceivables = (options?: { enabled?: boolean }) => {
  const { user, loading: authLoading } = useAuth();
  const externalEnabled = options?.enabled ?? true;

  return useQuery<FinanceReceivable[]>({
    queryKey: queryKeys.finance.allReceivables(),
    queryFn: async () => {
      const { data, error } = await financeService.listAllReceivables();
      if (error) throw error;
      return data || [];
    },
    enabled: !authLoading && !!user && externalEnabled,
  });
};

/** TODOS os lançamentos de despesa não deletados da organização, sem filtro de período — mesmo racional de `useAllReceivables`. */
export const useAllExpenseEntries = (options?: { enabled?: boolean }) => {
  const { user, loading: authLoading } = useAuth();
  const externalEnabled = options?.enabled ?? true;

  return useQuery<FinanceExpenseEntry[]>({
    queryKey: queryKeys.finance.allEntries(),
    queryFn: async () => {
      const { data, error } = await financeService.listAllExpenseEntries();
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

/** Deals ganhos (não deletados) candidatos ao fluxo "importar de deal ganho" (Task 10). */
export const useWonDealsForImport = (options?: { enabled?: boolean }) => {
  const { user, loading: authLoading } = useAuth();
  const externalEnabled = options?.enabled ?? true;

  return useQuery<WonDealForImport[]>({
    queryKey: queryKeys.finance.wonDeals(),
    queryFn: async () => {
      const { data, error } = await financeService.listWonDealsForImport();
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

/**
 * Marca um recebível como pago. Otimista contra o cache do período
 * informado; `contractId` é opcional (usado pelo sheet de recebíveis por
 * contrato — Task 7) e, quando presente, também atualiza otimisticamente e
 * invalida o cache `receivablesByContract`, já que esse cache não é
 * escopado por período.
 */
export const useMarkReceivablePaid = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id }: { id: string; period: string; contractId?: string }) => {
      const { data, error } = await financeService.markReceivablePaid(id);
      if (error) throw error;
      return data!;
    },
    onMutate: async ({ id, period, contractId }) => {
      const queryKey = queryKeys.finance.receivables(period);
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<FinanceReceivable[]>(queryKey);
      queryClient.setQueryData<FinanceReceivable[]>(queryKey, (old = []) =>
        old.map(r => (r.id === id ? { ...r, status: 'PAID', paidAt: new Date().toISOString() } : r))
      );

      let previousByContract: FinanceReceivable[] | undefined;
      if (contractId) {
        const byContractKey = queryKeys.finance.receivablesByContract(contractId);
        await queryClient.cancelQueries({ queryKey: byContractKey });
        previousByContract = queryClient.getQueryData<FinanceReceivable[]>(byContractKey);
        queryClient.setQueryData<FinanceReceivable[]>(byContractKey, (old = []) =>
          old.map(r => (r.id === id ? { ...r, status: 'PAID', paidAt: new Date().toISOString() } : r))
        );
      }

      return { previous, period, contractId, previousByContract };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.finance.receivables(context.period), context.previous);
      }
      if (context?.contractId && context.previousByContract) {
        queryClient.setQueryData(queryKeys.finance.receivablesByContract(context.contractId), context.previousByContract);
      }
    },
    onSettled: (_data, _error, { period, contractId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.finance.receivables(period) });
      if (contractId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.finance.receivablesByContract(contractId) });
      }
      // Cache não-escopado por período (Dashboard, Task 9) — sem otimismo próprio aqui, só
      // invalida pra puxar o estado real depois que a baixa (ou o rollback) se resolveu.
      queryClient.invalidateQueries({ queryKey: queryKeys.finance.allReceivables() });
    },
  });
};

/**
 * Desfaz a baixa de um recebível. Otimista contra o cache do período
 * informado; `contractId` opcional, mesmo racional de `useMarkReceivablePaid`.
 */
export const useUnmarkReceivablePaid = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id }: { id: string; period: string; contractId?: string }) => {
      const { data, error } = await financeService.unmarkReceivablePaid(id);
      if (error) throw error;
      return data!;
    },
    onMutate: async ({ id, period, contractId }) => {
      const queryKey = queryKeys.finance.receivables(period);
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<FinanceReceivable[]>(queryKey);
      queryClient.setQueryData<FinanceReceivable[]>(queryKey, (old = []) =>
        old.map(r => (r.id === id ? { ...r, status: 'PENDING', paidAt: null } : r))
      );

      let previousByContract: FinanceReceivable[] | undefined;
      if (contractId) {
        const byContractKey = queryKeys.finance.receivablesByContract(contractId);
        await queryClient.cancelQueries({ queryKey: byContractKey });
        previousByContract = queryClient.getQueryData<FinanceReceivable[]>(byContractKey);
        queryClient.setQueryData<FinanceReceivable[]>(byContractKey, (old = []) =>
          old.map(r => (r.id === id ? { ...r, status: 'PENDING', paidAt: null } : r))
        );
      }

      return { previous, period, contractId, previousByContract };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.finance.receivables(context.period), context.previous);
      }
      if (context?.contractId && context.previousByContract) {
        queryClient.setQueryData(queryKeys.finance.receivablesByContract(context.contractId), context.previousByContract);
      }
    },
    onSettled: (_data, _error, { period, contractId }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.finance.receivables(period) });
      if (contractId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.finance.receivablesByContract(contractId) });
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.finance.allReceivables() });
    },
  });
};

/** Encerra um contrato e soft-deleta seus recebíveis PENDING futuros. */
export const useEndContract = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, today }: { id: string; today: string }) => {
      const { data, error } = await financeService.endContract(id, today);
      if (error) throw error;
      return data!;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.finance.all });
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
      queryClient.invalidateQueries({ queryKey: queryKeys.finance.allEntries() });
    },
  });
};

/** Desfaz a baixa de um lançamento de despesa. Otimista contra o cache do período informado. */
export const useUnmarkEntryPaid = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id }: { id: string; period: string }) => {
      const { data, error } = await financeService.unmarkEntryPaid(id);
      if (error) throw error;
      return data!;
    },
    onMutate: async ({ id, period }) => {
      const queryKey = queryKeys.finance.entries(period);
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<FinanceExpenseEntry[]>(queryKey);
      queryClient.setQueryData<FinanceExpenseEntry[]>(queryKey, (old = []) =>
        old.map(e => (e.id === id ? { ...e, status: 'PENDING', paidAt: null } : e))
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
      queryClient.invalidateQueries({ queryKey: queryKeys.finance.allEntries() });
    },
  });
};

/**
 * Cria lançamentos de despesa em lote — usado tanto pela materialização de
 * regras fixas do mês selecionado (Task 8, `useFinanceController`) quanto
 * pelo lançamento único de uma despesa pontual recém-criada. `createExpenseEntries`
 * (data layer) já absorve conflito de corrida (`23505` no índice único
 * parcial `expense_id+due_date`) como resultado benigno — esta mutation só
 * invalida o cache do período pra a UI puxar o estado real do banco depois.
 */
export const useCreateExpenseEntries = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ entries }: { entries: NewFinanceExpenseEntryInput[]; period: string }) => {
      const { data, error } = await financeService.createExpenseEntries(entries);
      if (error) throw error;
      return data;
    },
    onSettled: (_data, _error, { period }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.finance.entries(period) });
      queryClient.invalidateQueries({ queryKey: queryKeys.finance.allEntries() });
    },
  });
};

/**
 * Atualiza o lançamento (1:1) de uma despesa PONTUAL quando data/valor são
 * editados no catálogo. Não sabemos o período ANTIGO nem o NOVO do
 * lançamento a partir daqui (o caller só passa `expenseId`), então invalida
 * todo o namespace `finance` em vez de tentar escopar por período — mesma
 * postura conservadora de `useCreateContract`/`useUpdateContract`.
 */
export const useUpdateEntryForExpense = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      expenseId,
      updates,
    }: {
      expenseId: string;
      updates: { dueDate?: string; amount?: number };
    }) => {
      const { data, error } = await financeService.updateEntryForExpense(expenseId, updates);
      if (error) throw error;
      return data;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.finance.all });
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
