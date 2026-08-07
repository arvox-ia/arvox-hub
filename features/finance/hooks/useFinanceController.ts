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
  useAllReceivables,
  useAllExpenseEntries,
  useOpenDealsForProjection,
} from '@/lib/query/hooks/useFinanceQuery';
import { generateReceivables } from '../core/receivables';
import { generateFixedExpenseEntries, sumByCategory } from '../core/expenses';
import {
  collidesWithPreviousContract,
  computeContractEndDate,
  computeRenewalStartDate,
  isEndingSoon,
  lastReceivableDueDate,
} from '../core/contractStatus';
import { buildContractsCsvRows, buildExpensesCsvRows, buildReceivablesCsvRows } from '../core/csvExport';
import { buildProjection } from '../core/projection';
import { addMonthsToKey, weightDeals } from '../core/pipeline';
import { mapOpenDealForProjection } from '../core/dealMapping';
import {
  computeGoalProgressPct,
  computeMonthKpis,
  computeProbableTaxProvision,
  filterUpcoming,
  type UpcomingItem,
  type UpcomingRow,
} from '../core/dashboardMetrics';
import type { ContractInput, ProjectionInput, ProjectionPoint, ReceivableEntry } from '../core/types';
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
/** Janela (dias) da UpcomingList do Dashboard — recebíveis/lançamentos a vencer. */
const DASHBOARD_UPCOMING_WINDOW_DAYS = 15;
/**
 * Fallbacks de `weightDeals` pro pipeline ponderado do Dashboard — não há
 * campo em `finance_settings` pra isso ainda (Task 10 pode trazer). Mesmos
 * valores já usados como default noutros lugares do módulo: 30 dias é o
 * `defaultCloseDays` usado nos testes de `pipeline.ts`, 5 é o `billingDay`
 * padrão do form de novo contrato (`ContractFormModal`).
 */
const DASHBOARD_DEFAULT_CLOSE_DAYS = 30;
const DASHBOARD_ASSUMED_BILLING_DAY = 5;
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
  | {
      mode: 'renew';
      previousContract: FinanceContract;
      /**
       * Due date do recebível mais tardio (qualquer kind) do contrato
       * anterior — âncora do guard anti-duplicidade em `submitCreateContract`
       * (`collidesWithPreviousContract`). `null` só quando o anterior não
       * gerou recebível nenhum (edge case: setup+mensalidade ambos zerados).
       */
      previousLastDueDate: string | null;
      initialValues: ContractFormValues;
    };

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

  // ---------- Dados sem filtro de período, usados pelo Dashboard (Task 9) ----------
  const { data: allReceivables = [], isLoading: allReceivablesLoading } = useAllReceivables();
  const { data: allExpenseEntries = [], isLoading: allExpenseEntriesLoading } = useAllExpenseEntries();
  const { data: openDeals = [], isLoading: openDealsLoading } = useOpenDealsForProjection();

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
    // Regenera os recebíveis do contrato anterior com os MESMOS dados dele
    // (não uma fórmula de calendário paralela — essa era a causa do bug de
    // dupla cobrança) pra achar o due date REAL mais tardio, âncora de tudo
    // que segue: prefill do início da renovação e o guard de colisão no
    // submit.
    const previousReceivables = generateReceivables(
      {
        setupValue: contract.setupValue,
        setupInstallments: contract.setupInstallments,
        monthlyValue: contract.monthlyValue,
        startDate: contract.startDate,
        durationMonths: contract.durationMonths,
        billingDay: contract.billingDay,
      },
      { horizonMonths, today }
    );
    const previousLastDueDate = lastReceivableDueDate(previousReceivables);

    setContractFormState({
      mode: 'renew',
      previousContract: contract,
      previousLastDueDate,
      initialValues: {
        contactId: contract.contactId,
        description: contract.description,
        // Renovação não repete a taxa de setup por padrão — o usuário pode
        // reativar editando o form antes de salvar.
        setupValue: 0,
        setupInstallments: 1,
        monthlyValue: contract.monthlyValue,
        startDate: previousLastDueDate ? computeRenewalStartDate(previousLastDueDate) : today,
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

    // Belt and braces (achado da revisão): o prefill de `openRenewContract`
    // já evita colisão no caminho feliz, mas o usuário pode editar contato,
    // data de início, dia de cobrança etc. livremente antes de salvar — o
    // guard tem que rodar de novo aqui, no submit, com os valores EFETIVOS.
    if (state.mode === 'renew' && collidesWithPreviousContract(receivables, state.previousLastDueDate)) {
      addToast(
        'A data de início gera uma cobrança na mesma data da última do contrato anterior — ajuste o início ou o dia de cobrança.',
        'error'
      );
      return;
    }

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
        // Fim de vigência derivado dos recebíveis REAIS (mesma função,
        // mesmos dados do contrato) — nunca uma fórmula de calendário
        // paralela, pra "vence em Xd" e a coluna de vigência nunca
        // discordarem do que `generateReceivables` realmente gera (e do que
        // a renovação usa como âncora).
        const receivables =
          contract.durationMonths === null
            ? []
            : generateReceivables(
                {
                  setupValue: contract.setupValue,
                  setupInstallments: contract.setupInstallments,
                  monthlyValue: contract.monthlyValue,
                  startDate: contract.startDate,
                  durationMonths: contract.durationMonths,
                  billingDay: contract.billingDay,
                },
                { horizonMonths, today }
              );
        const endDate = computeContractEndDate(contract.startDate, contract.durationMonths, receivables);
        return {
          contract,
          contactName: contactsById.get(contract.contactId)?.name ?? null,
          endDate,
          endingSoon: contract.status === 'ACTIVE' && isEndingSoon(endDate, today, ENDING_SOON_THRESHOLD_DAYS),
          canRenew: contract.durationMonths !== null,
        };
      }),
    [contracts, contactsById, today, horizonMonths]
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
   *
   * CRÍTICO (achado da revisão): a chave só é gravada em `materializationAttempted`
   * APÓS sucesso da mutation — nunca antes de disparar. Gravar antes (como na
   * versão anterior) fazia uma falha transitória (rede/RLS) bloquear o retry
   * PARA SEMPRE naquele conjunto de regras+mês, com o total do mês
   * silenciosamente baixo e nenhum sinal na tela. Em erro, a chave é removida
   * do set (permite retry na próxima vez que o efeito rodar) e o estado
   * `materializationError` liga o aviso inline em `ExpensesTab` — silêncio é
   * a parte inaceitável aqui, não a falha em si.
   *
   * PEGADINHA DE SOFT-DELETE (documentado para quem for adicionar exclusão):
   * "já materializado" é derivado de `materializedExpenseIds`, que vem de
   * `expenseEntries` — e essa lista já está filtrada por `deleted_at IS NULL`
   * (ver `financeService.listExpenseEntries`). Se uma futura feature de
   * "remover lançamento" fizer soft-delete de uma entry, ela AUTOMATICAMENTE
   * some de `materializedExpenseIds`, e este efeito vai interpretar a regra
   * como "ainda não materializada neste mês" e recriar o lançamento no
   * próximo render. Quem implementar essa exclusão precisa de uma tombstone
   * check (ex.: um Set separado de `expenseId` com entry soft-deletada no
   * período, verificado ANTES de recriar) para não reviver algo que o
   * usuário removeu de propósito.
   */
  const materializationAttempted = useRef<Set<string>>(new Set());
  /** Chaves já notificadas por toast (evita reabrir o mesmo toast a cada retry automático do mesmo conjunto de regras). */
  const materializationToastedKeys = useRef<Set<string>>(new Set());
  /** `true` quando a última tentativa de materialização deste mês falhou — liga o aviso inline em `ExpensesTab`. */
  const [materializationError, setMaterializationError] = useState(false);

  useEffect(() => {
    if (expensesLoading || expenseEntriesLoading) return;

    const activeFixedRules = expenses.filter(e => e.kind === 'FIXED' && e.active);
    const materializedExpenseIds = new Set(expenseEntries.map(e => e.expenseId));
    const missing = activeFixedRules.filter(e => !materializedExpenseIds.has(e.id));
    if (missing.length === 0) {
      setMaterializationError(false);
      return;
    }

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

    createExpenseEntriesMutation.mutate(
      { entries: toCreate, period: expensesPeriod },
      {
        onSuccess: () => {
          materializationToastedKeys.current.delete(attemptKey);
          setMaterializationError(false);
        },
        onError: error => {
          // Remove a chave para que o próximo disparo do efeito (nova visita ao mês,
          // ou o refetch que `onSettled` da mutation já dispara mesmo em erro) tente de novo
          // — em vez de bloquear o retry para sempre neste conjunto de regras+mês.
          materializationAttempted.current.delete(attemptKey);
          console.error('[finance] falha ao materializar despesas fixas do mês', {
            period: expensesPeriod,
            expenseIds: missing.map(e => e.id),
            error,
          });
          setMaterializationError(true);
          if (!materializationToastedKeys.current.has(attemptKey)) {
            materializationToastedKeys.current.add(attemptKey);
            addToast('Não foi possível lançar as despesas fixas deste mês. Tente novamente.', 'error');
          }
        },
      }
    );
    // Deps deliberadamente sem `createExpenseEntriesMutation`: é o objeto de retorno de
    // `useMutation`, não referencialmente estável entre renders — incluir causaria loop.
  }, [expensesPeriod, expenses, expenseEntries, expensesLoading, expenseEntriesLoading]);

  // ---------- Form de despesa (criar / editar) ----------
  const [expenseFormState, setExpenseFormState] = useState<ExpenseFormState | null>(null);
  const openCreateExpense = () => setExpenseFormState({ mode: 'create' });
  const openEditExpense = (expense: FinanceExpense) => setExpenseFormState({ mode: 'edit', expense });
  const closeExpenseForm = () => setExpenseFormState(null);
  // Inclui as mutations de LANÇAMENTO (não só as de catálogo) — o submit de uma despesa
  // pontual dispara `createExpenseEntriesMutation`/`updateEntryForExpenseMutation` em
  // sequência (ver `submitExpenseForm`); sem isso o botão reabilitava entre o `await` da
  // primeira mutation e o da segunda, permitindo duplo clique/duplo submit.
  const isSavingExpense =
    createExpenseMutation.isPending ||
    updateExpenseMutation.isPending ||
    createExpenseEntriesMutation.isPending ||
    updateEntryForExpenseMutation.isPending;

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

  /**
   * Período derivado do PRÓPRIO `dueDate` do lançamento (não de `expensesPeriod`,
   * a aba Despesas pode estar em outro mês) — mesmo racional de
   * `toggleReceivablePaid`. Sem isso, dar baixa a partir do Dashboard (Task 9,
   * cujos lançamentos podem cair em qualquer mês) atualizaria o cache
   * otimista do período ERRADO; a invalidação de `allEntries` no `onSettled`
   * da mutation corrige o estado de qualquer forma, mas o otimismo em si
   * ficaria mirando o mês errado sem este parâmetro.
   */
  const toggleEntryPaid = async (entryId: string, dueDate: string, currentlyPaid: boolean) => {
    const period = dueDate.slice(0, 7);
    try {
      if (currentlyPaid) {
        await unmarkEntryPaidMutation.mutateAsync({ id: entryId, period });
      } else {
        await markEntryPaidMutation.mutateAsync({ id: entryId, period });
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

  // =========================================================================
  // ---------- Dashboard (Task 9) ----------
  // =========================================================================

  const taxRate = settings?.taxRate ?? 0;
  const initialBalance = settings?.initialBalance ?? 0;
  const currentMonth = today.slice(0, 7);

  /** Meses do horizonte de projeção, `yyyy-MM`, a partir do mês corrente (inclusive) — mesma janela usada por `weightDeals`. */
  const dashboardProjectionMonths = useMemo(
    () => Array.from({ length: horizonMonths }, (_, i) => addMonthsToKey(currentMonth, i)),
    [currentMonth, horizonMonths]
  );

  /**
   * Pipeline ponderado do funil aberto. `custom_fields` ainda não tem schema
   * oficial (Task 10) — `mapOpenDealForProjection` lê defensivamente com
   * defaults sãos, ver seu comentário de arquivo.
   */
  const weightedPipeline = useMemo(
    () =>
      weightDeals(openDeals.map(mapOpenDealForProjection), {
        today,
        horizonMonths,
        defaultCloseDays: DASHBOARD_DEFAULT_CLOSE_DAYS,
        assumedBillingDay: DASHBOARD_ASSUMED_BILLING_DAY,
      }),
    [openDeals, today, horizonMonths]
  );

  /** Regras fixas ATIVAS do catálogo — só essas cobrem, na projeção, meses ainda não materializados em `finance_expense_entries`. */
  const activeFixedRulesForProjection = useMemo(
    () =>
      fixedExpenseRules
        .filter(e => e.active)
        .map(e => ({ amount: e.amount, dueDay: e.dueDay ?? 1, expenseId: e.id })),
    [fixedExpenseRules]
  );

  /**
   * A projeção de duas curvas (núcleo puro, `buildProjection`) — a UI NUNCA
   * reimplementa esta aritmética, só monta o input a partir dos dados já
   * carregados (`allReceivables`/`allExpenseEntries`, sem filtro de período,
   * cobrem o horizonte inteiro E qualquer recebível/lançamento atrasado de
   * meses anteriores).
   */
  const projection: ProjectionPoint[] = useMemo(() => {
    const input: ProjectionInput = {
      months: dashboardProjectionMonths,
      receivables: allReceivables.map(r => ({ dueDate: r.dueDate, amount: r.amount })),
      expenseEntries: allExpenseEntries.map(e => ({ dueDate: e.dueDate, amount: e.amount, expenseId: e.expenseId })),
      fixedRules: activeFixedRulesForProjection,
      weighted: weightedPipeline,
      taxRate,
      initialBalance,
    };
    return buildProjection(input);
  }, [dashboardProjectionMonths, allReceivables, allExpenseEntries, activeFixedRulesForProjection, weightedPipeline, taxRate, initialBalance]);

  /** Primeiro ponto da projeção = mês corrente (ver `dashboardProjectionMonths`). */
  const currentMonthProjection = projection[0] ?? null;

  const isDashboardLoading =
    settingsLoading || contractsLoading || allReceivablesLoading || allExpenseEntriesLoading || openDealsLoading;

  const receivablesThisMonth = useMemo(
    () => allReceivables.filter(r => r.dueDate.slice(0, 7) === currentMonth),
    [allReceivables, currentMonth]
  );
  const expenseEntriesThisMonth = useMemo(
    () => allExpenseEntries.filter(e => e.dueDate.slice(0, 7) === currentMonth),
    [allExpenseEntries, currentMonth]
  );

  /** Os 4 StatCards do topo do Dashboard. */
  const monthKpis = useMemo(
    () => computeMonthKpis(receivablesThisMonth, expenseEntriesThisMonth, currentMonthProjection?.taxProvision ?? 0),
    [receivablesThisMonth, expenseEntriesThisMonth, currentMonthProjection]
  );

  /**
   * Provisão da curva PROVÁVEL do mês corrente. `ProjectionPoint.taxProvision`
   * é só a provisão da curva CONTRATADA (achado da revisão da Task 4) —
   * recalculada aqui com a MESMA fórmula que o core usa internamente pra
   * `balanceProbable` (`probable × taxRate/100`), pra que as duas provisões
   * mostradas lado a lado na tela nunca divirjam de quem confere na mão.
   */
  const probableTaxProvision = useMemo(
    () => computeProbableTaxProvision(currentMonthProjection?.probable ?? 0, taxRate),
    [currentMonthProjection, taxRate]
  );

  /** Meta do mês corrente: `goalRows[0]` é sempre o mês de `today` (ver `goalMonths`). */
  const currentMonthGoal = goalRows[0]?.targetValue ?? 0;
  /** "Realizado" = receita contratada do mês (recebido + a receber) — bate com `currentMonthProjection.contracted`. */
  const currentMonthRealizado = monthKpis.recebido + monthKpis.aReceber;
  const goalProgressPct = computeGoalProgressPct(currentMonthRealizado, currentMonthGoal);

  /**
   * Recebíveis + lançamentos de despesa dos próximos `DASHBOARD_UPCOMING_WINDOW_DAYS`
   * dias — atrasados (de qualquer mês) sempre incluídos e pinados no topo
   * (`filterUpcoming`). A descrição do recebível é enriquecida com o nome do
   * contato (via `contract → contact`) quando disponível.
   */
  const upcomingRows: UpcomingRow[] = useMemo(() => {
    const receivableItems: UpcomingItem[] = allReceivables.map(r => {
      const contract = contractsById.get(r.contractId);
      const contactName = contract ? contactsById.get(contract.contactId)?.name ?? null : null;
      return {
        id: r.id,
        kind: 'RECEIVABLE',
        description: contactName ? `${r.description} — ${contactName}` : r.description,
        amount: r.amount,
        dueDate: r.dueDate,
        status: r.status,
      };
    });
    const expenseItems: UpcomingItem[] = allExpenseEntries.map(e => ({
      id: e.id,
      kind: 'EXPENSE',
      description: expensesById.get(e.expenseId)?.description ?? 'Despesa removida',
      amount: e.amount,
      dueDate: e.dueDate,
      status: e.status,
    }));
    return filterUpcoming([...receivableItems, ...expenseItems], today, DASHBOARD_UPCOMING_WINDOW_DAYS);
  }, [allReceivables, allExpenseEntries, contractsById, contactsById, expensesById, today]);

  /** Contratos ativos vencendo em até 30 dias — mesmo flag `endingSoon` já usado na aba Contratos. */
  const endingSoonContracts = useMemo(() => contractRows.filter(row => row.endingSoon), [contractRows]);

  /** Só os recebíveis atrasados de `upcomingRows` — pro bloco de alertas. */
  const overdueReceivables = useMemo(
    () => upcomingRows.filter(row => row.isOverdue && row.kind === 'RECEIVABLE'),
    [upcomingRows]
  );

  /** Baixa em 1 clique a partir da UpcomingList — despacha pra mutation certa conforme `kind`. Linhas de `upcomingRows` são sempre PENDING (ver `filterUpcoming`). */
  const toggleUpcomingPaid = async (row: UpcomingRow) => {
    if (row.kind === 'RECEIVABLE') {
      await toggleReceivablePaid(row.id, row.dueDate, false);
    } else {
      await toggleEntryPaid(row.id, row.dueDate, false);
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
    expensesById,
    materializationError,
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

    // ---------- Dashboard ----------
    isDashboardLoading,
    projection,
    currentMonthProjection,
    receivablesThisMonth,
    expenseEntriesThisMonth,
    monthKpis,
    taxRate,
    probableTaxProvision,
    currentMonthGoal,
    currentMonthRealizado,
    goalProgressPct,
    upcomingRows,
    toggleUpcomingPaid,
    endingSoonContracts,
    overdueReceivables,
  };
}
