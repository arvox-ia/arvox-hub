/**
 * Controller do módulo financeiro (Fase 1B).
 *
 * Task 7 estendeu o esqueleto (Task 6) com a aba Contratos. Task 8 estende
 * com Despesas (materialização mensal de regras fixas + lançamentos
 * pontuais) e Configurações (settings, metas mensais, export CSV de
 * backup). Task 9 estende com o Dashboard.
 */
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { addMonths, format, parseISO, startOfMonth } from 'date-fns';
import { useToast } from '@/context/ToastContext';
import { useContacts } from '@/lib/query/hooks/useContactsQuery';
import {
  useFinanceSettings,
  useContracts,
  useCreateContract,
  useUpdateContract,
  useEndContract,
  useReceivablesByContract,
  useMarkReceivablePaid,
  useUnmarkReceivablePaid,
  useExpenses,
  useExpenseEntries,
  useCreateExpense,
  useUpdateExpense,
  useMarkEntryPaid,
  useUnmarkEntryPaid,
  useCreateExpenseEntries,
  useUpdateEntryForExpense,
  useGoals,
  useUpsertGoal,
  useUpsertFinanceSettings,
} from '@/lib/query/hooks/useFinanceQuery';
import { generateReceivables } from '../core/receivables';
import { generateFixedExpenseEntries, sumByCategory } from '../core/expenses';
import { computeContractEndDate, computeRenewalStartDate, isEndingSoon } from '../core/contractStatus';
import { buildContractsCsvRows, buildExpensesCsvRows, buildReceivablesCsvRows } from '../core/csvExport';
import type { ContractInput, ReceivableEntry } from '../core/types';
import {
  financeService,
  type FinanceContract,
  type FinanceExpense,
  type NewFinanceContractInput,
  type NewFinanceExpenseEntryInput,
  type NewFinanceExpenseInput,
  type NewReceivableInput,
} from '@/lib/supabase/finance';
import { stringifyCsv, withUtf8Bom } from '@/lib/utils/csv';
import { downloadTextFile } from '@/lib/utils/download';

export type FinanceTab = 'dashboard' | 'contracts' | 'expenses' | 'settings';

/** Fallback quando a organização ainda não configurou `projection_months` (settings null). */
const DEFAULT_HORIZON_MONTHS = 12;
/** Limiar do badge "vence em Xd" na lista de contratos. */
const ENDING_SOON_THRESHOLD_DAYS = 30;
/** Rótulo pt-BR do status do contrato — só usado na exportação CSV (a UI da lista tem o seu próprio, em ContractsTab). */
const CONTRACT_STATUS_LABEL: Record<FinanceContract['status'], string> = {
  ACTIVE: 'Ativo',
  ENDED: 'Encerrado',
  RENEWED: 'Renovado',
};

/** Valores editáveis do form de contrato — sem os campos derivados/persistidos (id, status, timestamps). */
export interface ContractFormValues {
  contactId: string;
  description: string;
  setupValue: number;
  setupInstallments: number;
  monthlyValue: number;
  startDate: string;
  durationMonths: number | null;
  billingDay: number;
}

/** Estado do modal de contrato: fechado, ou aberto em um dos 3 modos. */
export type ContractFormState =
  | { mode: 'create' }
  | { mode: 'edit'; contract: FinanceContract }
  | { mode: 'renew'; previousContract: FinanceContract; initialValues: ContractFormValues };

/** Uma linha da lista de contratos, com dados já derivados para a UI. */
export interface ContractRow {
  contract: FinanceContract;
  contactName: string | null;
  /** Último dia (inclusive) da vigência, ou `null` se indeterminado. */
  endDate: string | null;
  /** `true` quando ACTIVE e vence em até `ENDING_SOON_THRESHOLD_DAYS` dias. */
  endingSoon: boolean;
  /** Só contratos com vigência definida (`durationMonths != null`) podem ser renovados. */
  canRenew: boolean;
}

/** Valores editáveis do form de despesa — sem os campos derivados/persistidos (id, timestamps). */
export interface ExpenseFormValues {
  description: string;
  category: string;
  amount: number;
  kind: 'FIXED' | 'ONE_TIME';
  /** 1-28, usado quando `kind === 'FIXED'`. */
  dueDay: number;
  /** `yyyy-MM-dd`, usado quando `kind === 'ONE_TIME'`. */
  dueDate: string;
  /** Só relevante para `kind === 'FIXED'` — regra desligada não materializa mais. */
  active: boolean;
}

/** Estado do modal de despesa: fechado, ou aberto em criação/edição. */
export type ExpenseFormState = { mode: 'create' } | { mode: 'edit'; expense: FinanceExpense };

/** Uma linha da lista de lançamentos do mês selecionado, já com metadados da despesa de catálogo. */
export interface ExpenseEntryRow {
  entryId: string;
  expenseId: string;
  description: string;
  category: string;
  kind: 'FIXED' | 'ONE_TIME';
  amount: number;
  dueDate: string;
  status: 'PENDING' | 'PAID';
  isOverdue: boolean;
}

export function useFinanceController() {
  const [activeTab, setActiveTab] = useState<FinanceTab>('dashboard');
  const { addToast } = useToast();

  // "Hoje" é resolvido uma vez por montagem do controller (fronteira
  // impura) e passado como parâmetro pra todo o core puro — nunca lido de
  // novo internamente por generateReceivables/computeContractEndDate/etc.
  const today = useMemo(() => format(new Date(), 'yyyy-MM-dd'), []);

  const {
    data: settings,
    isLoading: settingsLoading,
    error: settingsError,
  } = useFinanceSettings();

  const { data: contacts = [] } = useContacts();
  const { data: contracts = [], isLoading: contractsLoading } = useContracts();

  const contactsById = useMemo(() => new Map(contacts.map(c => [c.id, c])), [contacts]);
  const horizonMonths = settings?.projectionMonths ?? DEFAULT_HORIZON_MONTHS;

  // ---------- Mutations ----------
  const createContractMutation = useCreateContract();
  const updateContractMutation = useUpdateContract();
  const endContractMutation = useEndContract();
  const markReceivablePaidMutation = useMarkReceivablePaid();
  const unmarkReceivablePaidMutation = useUnmarkReceivablePaid();

  // ---------- Form de contrato (criar / editar / renovar) ----------
  const [contractFormState, setContractFormState] = useState<ContractFormState | null>(null);

  const openCreateContract = () => setContractFormState({ mode: 'create' });
  const openEditContract = (contract: FinanceContract) => setContractFormState({ mode: 'edit', contract });

  /**
   * Renovar: NÃO altera o contrato anterior aqui — só monta os valores
   * iniciais do form pra um contrato NOVO (início = dia seguinte ao fim do
   * anterior). O anterior só vira `status='RENEWED'` depois que o novo é
   * criado com sucesso (`submitContractForm`), pra nunca deixar um contrato
   * "renovado" órfão se o usuário cancelar o modal.
   */
  const openRenewContract = (contract: FinanceContract) => {
    const previousEndDate = computeContractEndDate(contract.startDate, contract.durationMonths);
    setContractFormState({
      mode: 'renew',
      previousContract: contract,
      initialValues: {
        contactId: contract.contactId,
        description: contract.description,
        // Renovação não repete a taxa de setup por padrão — o usuário pode
        // reativar editando o form antes de salvar.
        setupValue: 0,
        setupInstallments: 1,
        monthlyValue: contract.monthlyValue,
        startDate: previousEndDate ? computeRenewalStartDate(previousEndDate) : today,
        durationMonths: contract.durationMonths,
        billingDay: contract.billingDay,
      },
    });
  };

  const closeContractForm = () => setContractFormState(null);

  /** Preview dos recebíveis que seriam gerados — chamado pelo form a cada mudança de campo, antes de salvar. */
  const previewReceivables = (values: ContractFormValues): ReceivableEntry[] => {
    const input: ContractInput = {
      setupValue: values.setupValue,
      setupInstallments: values.setupInstallments,
      monthlyValue: values.monthlyValue,
      startDate: values.startDate,
      durationMonths: values.durationMonths,
      billingDay: values.billingDay,
    };
    return generateReceivables(input, { horizonMonths, today });
  };

  const isSavingContract = createContractMutation.isPending || updateContractMutation.isPending;

  /** Submit do modal em modo 'create' ou 'renew' — gera recebíveis via core e cria o contrato. */
  const submitCreateContract = async (values: ContractFormValues) => {
    const state = contractFormState;
    if (!state || state.mode === 'edit') return;

    const receivables = previewReceivables(values);
    const contractInput: NewFinanceContractInput = {
      contactId: values.contactId,
      description: values.description,
      setupValue: values.setupValue,
      setupInstallments: values.setupInstallments,
      monthlyValue: values.monthlyValue,
      startDate: values.startDate,
      durationMonths: values.durationMonths,
      billingDay: values.billingDay,
    };
    const receivablesInput: NewReceivableInput[] = receivables.map(r => ({
      kind: r.kind,
      amount: r.amount,
      dueDate: r.dueDate,
      description: r.description,
    }));

    try {
      await createContractMutation.mutateAsync({ contract: contractInput, receivables: receivablesInput });

      if (state.mode === 'renew') {
        await updateContractMutation.mutateAsync({
          id: state.previousContract.id,
          updates: { status: 'RENEWED' },
        });
      }

      addToast(
        state.mode === 'renew' ? 'Contrato renovado com sucesso' : 'Contrato criado com sucesso',
        'success'
      );
      closeContractForm();
    } catch (error) {
      addToast(`Erro ao salvar contrato: ${(error as Error).message}`, 'error');
    }
  };

  /** Submit do modal em modo 'edit' — só atualiza metadados do contrato, nunca regenera recebíveis. */
  const submitEditContract = async (values: ContractFormValues) => {
    if (!contractFormState || contractFormState.mode !== 'edit') return;
    try {
      await updateContractMutation.mutateAsync({
        id: contractFormState.contract.id,
        updates: {
          contactId: values.contactId,
          description: values.description,
          setupValue: values.setupValue,
          setupInstallments: values.setupInstallments,
          monthlyValue: values.monthlyValue,
          startDate: values.startDate,
          durationMonths: values.durationMonths,
          billingDay: values.billingDay,
        },
      });
      addToast('Contrato atualizado com sucesso', 'success');
      closeContractForm();
    } catch (error) {
      addToast(`Erro ao atualizar contrato: ${(error as Error).message}`, 'error');
    }
  };

  // ---------- Encerrar contrato ----------
  const [endContractTarget, setEndContractTarget] = useState<FinanceContract | null>(null);
  const requestEndContract = (contract: FinanceContract) => setEndContractTarget(contract);
  const cancelEndContract = () => setEndContractTarget(null);

  const confirmEndContract = async () => {
    const target = endContractTarget;
    if (!target) return;
    setEndContractTarget(null);
    try {
      const result = await endContractMutation.mutateAsync({ id: target.id, today });
      addToast(
        result.deletedReceivablesCount > 0
          ? `Contrato encerrado. ${result.deletedReceivablesCount} recebível(is) futuro(s) removido(s).`
          : 'Contrato encerrado.',
        'success'
      );
    } catch (error) {
      addToast(`Erro ao encerrar contrato: ${(error as Error).message}`, 'error');
    }
  };

  // ---------- Sheet de recebíveis por contrato ----------
  const [receivablesContractId, setReceivablesContractId] = useState<string | null>(null);
  const openReceivablesSheet = (contractId: string) => setReceivablesContractId(contractId);
  const closeReceivablesSheet = () => setReceivablesContractId(null);

  const { data: contractReceivables = [], isLoading: receivablesLoading } = useReceivablesByContract(receivablesContractId);

  const toggleReceivablePaid = async (receivableId: string, dueDate: string, currentlyPaid: boolean) => {
    const period = dueDate.slice(0, 7);
    const contractId = receivablesContractId ?? undefined;
    try {
      if (currentlyPaid) {
        await unmarkReceivablePaidMutation.mutateAsync({ id: receivableId, period, contractId });
      } else {
        await markReceivablePaidMutation.mutateAsync({ id: receivableId, period, contractId });
      }
    } catch (error) {
      addToast(`Erro ao atualizar baixa do recebível: ${(error as Error).message}`, 'error');
    }
  };

  // ---------- Linhas derivadas da lista de contratos ----------
  const contractRows: ContractRow[] = useMemo(
    () =>
      contracts.map(contract => {
        const endDate = computeContractEndDate(contract.startDate, contract.durationMonths);
        return {
          contract,
          contactName: contactsById.get(contract.contactId)?.name ?? null,
          endDate,
          endingSoon: contract.status === 'ACTIVE' && isEndingSoon(endDate, today, ENDING_SOON_THRESHOLD_DAYS),
          canRenew: contract.durationMonths !== null,
        };
      }),
    [contracts, contactsById, today]
  );

  const contractsById = useMemo(() => new Map(contracts.map(c => [c.id, c])), [contracts]);

  // =========================================================================
  // ---------- Despesas (Task 8) ----------
  // =========================================================================

  const [expensesPeriod, setExpensesPeriod] = useState(() => today.slice(0, 7));

  const { data: expenses = [], isLoading: expensesLoading } = useExpenses();
  const { data: expenseEntries = [], isLoading: expenseEntriesLoading } = useExpenseEntries(expensesPeriod);
  const expensesById = useMemo(() => new Map(expenses.map(e => [e.id, e])), [expenses]);

  const createExpenseMutation = useCreateExpense();
  const updateExpenseMutation = useUpdateExpense();
  const createExpenseEntriesMutation = useCreateExpenseEntries();
  const updateEntryForExpenseMutation = useUpdateEntryForExpense();
  const markEntryPaidMutation = useMarkEntryPaid();
  const unmarkEntryPaidMutation = useUnmarkEntryPaid();

  /**
   * Materialização das regras fixas ativas do mês selecionado. Roda toda vez
   * que o mês muda ou o catálogo/lançamentos mudam (ex.: criação de nova
   * regra fixa, invalidação após a própria materialização). A chave de
   * "já tentado" inclui o CONJUNTO de ids faltantes (não só o período) —
   * assim uma regra nova adicionada depois é retentada mesmo que o período já
   * tenha sido visitado antes, mas uma falha persistente no MESMO conjunto
   * não vira um loop de retry infinito batendo no banco a cada re-render.
   * Idempotência de verdade (contra corrida entre abas/StrictMode) é
   * responsabilidade de `createExpenseEntries` no data layer, não daqui.
   */
  const materializationAttempted = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (expensesLoading || expenseEntriesLoading) return;

    const activeFixedRules = expenses.filter(e => e.kind === 'FIXED' && e.active);
    const materializedExpenseIds = new Set(expenseEntries.map(e => e.expenseId));
    const missing = activeFixedRules.filter(e => !materializedExpenseIds.has(e.id));
    if (missing.length === 0) return;

    const attemptKey = `${expensesPeriod}:${missing.map(e => e.id).sort().join(',')}`;
    if (materializationAttempted.current.has(attemptKey)) return;
    materializationAttempted.current.add(attemptKey);

    const toCreate: NewFinanceExpenseEntryInput[] = missing.map(rule => {
      const [entry] = generateFixedExpenseEntries(
        { amount: rule.amount, dueDay: rule.dueDay ?? 1, expenseId: rule.id },
        { fromMonth: expensesPeriod, months: 1 }
      );
      return { expenseId: entry.expenseId, dueDate: entry.dueDate, amount: entry.amount };
    });

    createExpenseEntriesMutation.mutate({ entries: toCreate, period: expensesPeriod });
    // Deps deliberadamente sem `createExpenseEntriesMutation`: é o objeto de retorno de
    // `useMutation`, não referencialmente estável entre renders — incluir causaria loop.
  }, [expensesPeriod, expenses, expenseEntries, expensesLoading, expenseEntriesLoading]);

  // ---------- Form de despesa (criar / editar) ----------
  const [expenseFormState, setExpenseFormState] = useState<ExpenseFormState | null>(null);
  const openCreateExpense = () => setExpenseFormState({ mode: 'create' });
  const openEditExpense = (expense: FinanceExpense) => setExpenseFormState({ mode: 'edit', expense });
  const closeExpenseForm = () => setExpenseFormState(null);
  const isSavingExpense = createExpenseMutation.isPending || updateExpenseMutation.isPending;

  /**
   * Submit do form de despesa. Pontual (`ONE_TIME`) ganha o único lançamento
   * dela na hora — não espera a materialização mensal, que só cobre `FIXED`
   * (uma pontual não é "regra recorrente ainda não materializada nesse mês",
   * é um fato pontual já conhecido no momento da criação). Fixa não cria
   * lançamento aqui: o efeito de materialização acima cobre o mês
   * selecionado (e qualquer mês futuro, quando visitado) assim que o
   * catálogo invalidar.
   */
  const submitExpenseForm = async (values: ExpenseFormValues) => {
    const state = expenseFormState;
    if (!state) return;

    const baseInput: NewFinanceExpenseInput = {
      description: values.description,
      category: values.category,
      amount: values.amount,
      kind: values.kind,
      dueDay: values.kind === 'FIXED' ? values.dueDay : null,
      dueDate: values.kind === 'ONE_TIME' ? values.dueDate : null,
      active: values.active,
    };

    try {
      if (state.mode === 'create') {
        const created = await createExpenseMutation.mutateAsync(baseInput);
        if (values.kind === 'ONE_TIME') {
          await createExpenseEntriesMutation.mutateAsync({
            entries: [{ expenseId: created.id, dueDate: values.dueDate, amount: values.amount }],
            period: values.dueDate.slice(0, 7),
          });
        }
        addToast('Despesa criada com sucesso', 'success');
      } else {
        await updateExpenseMutation.mutateAsync({ id: state.expense.id, updates: baseInput });
        // Pontual é 1:1 com seu lançamento — sincroniza data/valor editados.
        // Fixa NUNCA regenera lançamentos já materializados (mesma regra de updateContract).
        if (values.kind === 'ONE_TIME') {
          await updateEntryForExpenseMutation.mutateAsync({
            expenseId: state.expense.id,
            updates: { dueDate: values.dueDate, amount: values.amount },
          });
        }
        addToast('Despesa atualizada com sucesso', 'success');
      }
      closeExpenseForm();
    } catch (error) {
      addToast(`Erro ao salvar despesa: ${(error as Error).message}`, 'error');
    }
  };

  /** Ativa/desativa uma regra fixa direto da lista de despesas fixas (sem abrir o modal). */
  const toggleExpenseActive = async (expense: FinanceExpense) => {
    try {
      await updateExpenseMutation.mutateAsync({ id: expense.id, updates: { active: !expense.active } });
      addToast(expense.active ? 'Despesa fixa desativada' : 'Despesa fixa reativada', 'success');
    } catch (error) {
      addToast(`Erro ao atualizar despesa: ${(error as Error).message}`, 'error');
    }
  };

  const toggleEntryPaid = async (entryId: string, currentlyPaid: boolean) => {
    try {
      if (currentlyPaid) {
        await unmarkEntryPaidMutation.mutateAsync({ id: entryId, period: expensesPeriod });
      } else {
        await markEntryPaidMutation.mutateAsync({ id: entryId, period: expensesPeriod });
      }
    } catch (error) {
      addToast(`Erro ao atualizar baixa do lançamento: ${(error as Error).message}`, 'error');
    }
  };

  // ---------- Linhas derivadas da lista de lançamentos do mês ----------
  const expenseEntryRows: ExpenseEntryRow[] = useMemo(
    () =>
      expenseEntries
        .map(entry => {
          const expense = expensesById.get(entry.expenseId);
          return {
            entryId: entry.id,
            expenseId: entry.expenseId,
            description: expense?.description ?? 'Despesa removida',
            category: expense?.category ?? 'Outros',
            kind: expense?.kind ?? 'ONE_TIME',
            amount: entry.amount,
            dueDate: entry.dueDate,
            status: entry.status,
            isOverdue: entry.status === 'PENDING' && entry.dueDate < today,
          };
        })
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    [expenseEntries, expensesById, today]
  );

  const expenseCategoryTotals = useMemo(() => sumByCategory(expenseEntryRows), [expenseEntryRows]);
  const expenseMonthTotal = useMemo(
    () => expenseEntryRows.reduce((sum, row) => sum + row.amount, 0),
    [expenseEntryRows]
  );

  /** Regras fixas do catálogo (ativas + inativas) — única forma de reativar uma regra desligada. */
  const fixedExpenseRules = useMemo(
    () =>
      expenses
        .filter(e => e.kind === 'FIXED')
        .sort((a, b) => a.description.localeCompare(b.description)),
    [expenses]
  );

  // =========================================================================
  // ---------- Configurações + metas (Task 8) ----------
  // =========================================================================

  const upsertSettingsMutation = useUpsertFinanceSettings();

  const submitSettings = async (values: { taxRate: number; initialBalance: number; projectionMonths: number }) => {
    try {
      await upsertSettingsMutation.mutateAsync(values);
      addToast('Configurações salvas', 'success');
    } catch (error) {
      addToast(`Erro ao salvar configurações: ${(error as Error).message}`, 'error');
    }
  };

  const { data: goals = [] } = useGoals();
  const upsertGoalMutation = useUpsertGoal();

  /** Os 12 meses a partir do mês corrente (inclusive), `yyyy-MM-dd` (dia 1 — mesmo formato de `finance_goals.month`). */
  const goalMonths = useMemo(() => {
    const start = startOfMonth(parseISO(today));
    return Array.from({ length: 12 }, (_, i) => format(addMonths(start, i), 'yyyy-MM-dd'));
  }, [today]);

  const goalsByMonth = useMemo(() => new Map(goals.map(g => [g.month, g])), [goals]);

  const goalRows = useMemo(
    () => goalMonths.map(month => ({ month, targetValue: goalsByMonth.get(month)?.targetValue ?? 0 })),
    [goalMonths, goalsByMonth]
  );

  /** Chamado no blur do input de meta (não a cada tecla) — ver SettingsTab. */
  const submitGoal = async (month: string, targetValue: number) => {
    try {
      await upsertGoalMutation.mutateAsync({ month, targetValue });
    } catch (error) {
      addToast(`Erro ao salvar meta: ${(error as Error).message}`, 'error');
    }
  };

  // ---------- Export CSV (backup, spec §4.4) ----------
  const [isExportingCsv, setIsExportingCsv] = useState(false);

  /**
   * Contratos/despesas de catálogo já estão carregados (`contracts`,
   * `expenses`); recebíveis e lançamentos são buscados por período em outras
   * partes da UI (nunca a lista completa), então o export busca o histórico
   * completo sob demanda aqui — via os MESMOS métodos do data layer
   * (`financeService`, sem endpoint novo), não uma query sempre-ativa, pra
   * não manter esse volume em cache o tempo todo por causa de um botão
   * clicado raramente.
   */
  const exportCsv = async () => {
    setIsExportingCsv(true);
    try {
      const [receivablesResult, entriesResult] = await Promise.all([
        financeService.listAllReceivables(),
        financeService.listAllExpenseEntries(),
      ]);
      if (receivablesResult.error) throw receivablesResult.error;
      if (entriesResult.error) throw entriesResult.error;

      const contractsRows = buildContractsCsvRows(
        contracts.map(c => ({
          contactName: contactsById.get(c.contactId)?.name ?? 'Contato removido',
          description: c.description,
          setupValue: c.setupValue,
          setupInstallments: c.setupInstallments,
          monthlyValue: c.monthlyValue,
          startDate: c.startDate,
          durationMonths: c.durationMonths,
          billingDay: c.billingDay,
          status: CONTRACT_STATUS_LABEL[c.status] ?? c.status,
        }))
      );

      const receivablesRows = buildReceivablesCsvRows(
        (receivablesResult.data ?? []).map(r => {
          const contract = contractsById.get(r.contractId);
          const contactName = contract
            ? contactsById.get(contract.contactId)?.name ?? 'Contato removido'
            : 'Contrato removido';
          return { contactName, kind: r.kind, description: r.description, amount: r.amount, dueDate: r.dueDate, status: r.status };
        })
      );

      const expensesCsvRows = buildExpensesCsvRows(
        (entriesResult.data ?? []).map(e => {
          const expense = expensesById.get(e.expenseId);
          return {
            description: expense?.description ?? 'Despesa removida',
            category: expense?.category ?? 'Outros',
            kind: expense?.kind ?? 'ONE_TIME',
            amount: e.amount,
            dueDate: e.dueDate,
            status: e.status,
          };
        })
      );

      downloadTextFile(`arvox-hub-contratos-${today}.csv`, withUtf8Bom(stringifyCsv(contractsRows, ';')));
      downloadTextFile(`arvox-hub-recebiveis-${today}.csv`, withUtf8Bom(stringifyCsv(receivablesRows, ';')));
      downloadTextFile(`arvox-hub-despesas-${today}.csv`, withUtf8Bom(stringifyCsv(expensesCsvRows, ';')));

      addToast('Exportação concluída: 3 arquivos CSV baixados', 'success');
    } catch (error) {
      addToast(`Erro ao exportar dados: ${(error as Error).message}`, 'error');
    } finally {
      setIsExportingCsv(false);
    }
  };

  return {
    activeTab,
    setActiveTab,
    settings,
    settingsLoading,
    settingsError,

    today,
    horizonMonths,
    contacts,
    contractRows,
    contractsLoading,

    contractFormState,
    openCreateContract,
    openEditContract,
    openRenewContract,
    closeContractForm,
    previewReceivables,
    submitCreateContract,
    submitEditContract,
    isSavingContract,

    endContractTarget,
    requestEndContract,
    cancelEndContract,
    confirmEndContract,
    isEndingContract: endContractMutation.isPending,

    receivablesContractId,
    openReceivablesSheet,
    closeReceivablesSheet,
    contractReceivables,
    receivablesLoading,
    toggleReceivablePaid,

    // ---------- Despesas ----------
    expensesPeriod,
    setExpensesPeriod,
    expensesLoading,
    expenseEntriesLoading,
    expenseEntryRows,
    expenseCategoryTotals,
    expenseMonthTotal,
    fixedExpenseRules,
    toggleExpenseActive,
    toggleEntryPaid,

    expenseFormState,
    openCreateExpense,
    openEditExpense,
    closeExpenseForm,
    submitExpenseForm,
    isSavingExpense,

    // ---------- Configurações + metas + export ----------
    submitSettings,
    isSavingSettings: upsertSettingsMutation.isPending,
    goalRows,
    submitGoal,
    exportCsv,
    isExportingCsv,
  };
}
