/**
 * Controller do módulo financeiro (Fase 1B).
 *
 * Task 7 estende o esqueleto (Task 6) com a aba Contratos: queries de
 * contratos/contatos, o form de criação/edição/renovação (que chama o core
 * `generateReceivables` — a UI nunca reimplementa essa matemática), o fluxo
 * de encerrar contrato (soft-delete de recebíveis futuros) e o sheet de
 * recebíveis por contrato. Tasks 8-9 estendem com despesas/config/dashboard.
 */
'use client';

import { useMemo, useState } from 'react';
import { format } from 'date-fns';
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
} from '@/lib/query/hooks/useFinanceQuery';
import { generateReceivables } from '../core/receivables';
import { computeContractEndDate, computeRenewalStartDate, isEndingSoon } from '../core/contractStatus';
import type { ContractInput, ReceivableEntry } from '../core/types';
import type { FinanceContract, NewFinanceContractInput, NewReceivableInput } from '@/lib/supabase/finance';

export type FinanceTab = 'dashboard' | 'contracts' | 'expenses' | 'settings';

/** Fallback quando a organização ainda não configurou `projection_months` (settings null). */
const DEFAULT_HORIZON_MONTHS = 12;
/** Limiar do badge "vence em Xd" na lista de contratos. */
const ENDING_SOON_THRESHOLD_DAYS = 30;

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
  };
}
