'use client';

import React from 'react';
import { parseISO, format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { FileText, Plus, Receipt, Pencil, RefreshCw, XCircle, Clock } from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { formatBRL } from '@/lib/utils/currency';
import { cn } from '@/lib/utils/cn';
import { ContractFormModal } from './ContractFormModal';
import { ContractReceivablesSheet } from './ContractReceivablesSheet';
import { daysUntil } from '../core/contractStatus';
import type { useFinanceController } from '../hooks/useFinanceController';

type FinanceController = ReturnType<typeof useFinanceController>;

interface ContractsTabProps {
  controller: Pick<
    FinanceController,
    | 'contractRows'
    | 'contractsLoading'
    | 'today'
    | 'contacts'
    | 'contractFormState'
    | 'openCreateContract'
    | 'openEditContract'
    | 'openRenewContract'
    | 'closeContractForm'
    | 'previewReceivables'
    | 'submitCreateContract'
    | 'submitEditContract'
    | 'isSavingContract'
    | 'endContractTarget'
    | 'requestEndContract'
    | 'cancelEndContract'
    | 'confirmEndContract'
    | 'receivablesContractId'
    | 'openReceivablesSheet'
    | 'closeReceivablesSheet'
    | 'contractReceivables'
    | 'receivablesLoading'
    | 'toggleReceivablePaid'
  >;
}

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Ativo',
  ENDED: 'Encerrado',
  RENEWED: 'Renovado',
};

function formatDate(dateStr: string): string {
  return format(parseISO(dateStr), 'dd/MM/yyyy', { locale: ptBR });
}

export const ContractsTab: React.FC<ContractsTabProps> = ({ controller }) => {
  const {
    contractRows,
    contractsLoading,
    today,
    contacts,
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
    receivablesContractId,
    openReceivablesSheet,
    closeReceivablesSheet,
    contractReceivables,
    receivablesLoading,
    toggleReceivablePaid,
  } = controller;

  const receivablesRow = contractRows.find(row => row.contract.id === receivablesContractId);

  if (contractsLoading) {
    return <p className="text-sm text-slate-500 dark:text-slate-400 py-8 text-center">Carregando contratos...</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={openCreateContract}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-primary-600 hover:bg-primary-500 text-white transition-colors"
        >
          <Plus size={16} /> Novo contrato
        </button>
      </div>

      {contractRows.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="Nenhum contrato cadastrado"
          description="Cadastre o primeiro contrato pra começar a acompanhar recebíveis e vigência dos seus clientes."
          action={{ label: 'Novo contrato', onClick: openCreateContract }}
        />
      ) : (
        <ul className="space-y-3">
          {contractRows.map(({ contract, contactName, endDate, endingSoon, canRenew }) => (
            <li
              key={contract.id}
              className="p-4 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-dark-card"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold text-slate-900 dark:text-white truncate">
                      {contactName ?? 'Contato removido'}
                    </h3>
                    <Badge
                      variant={
                        contract.status === 'ACTIVE'
                          ? 'default'
                          : contract.status === 'RENEWED'
                            ? 'outline'
                            : 'secondary'
                      }
                    >
                      {STATUS_LABEL[contract.status] ?? contract.status}
                    </Badge>
                    {endingSoon && endDate && (
                      <Badge className="bg-warning-bg text-warning-text border-transparent flex items-center gap-1">
                        <Clock size={10} /> vence em {Math.max(0, daysUntil(endDate, today))}d
                      </Badge>
                    )}
                  </div>
                  {contract.description && (
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{contract.description}</p>
                  )}
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-slate-500 dark:text-slate-400">
                    {contract.setupValue > 0 && (
                      <span>
                        Setup: <strong className="text-slate-700 dark:text-slate-200">{formatBRL(contract.setupValue)}</strong> em{' '}
                        {contract.setupInstallments}x
                      </span>
                    )}
                    {contract.monthlyValue > 0 && (
                      <span>
                        Mensalidade: <strong className="text-slate-700 dark:text-slate-200">{formatBRL(contract.monthlyValue)}</strong>
                      </span>
                    )}
                    <span>
                      Vigência: {formatDate(contract.startDate)} →{' '}
                      {endDate ? formatDate(endDate) : 'Indeterminado'}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => openReceivablesSheet(contract.id)}
                    title="Ver recebíveis"
                    className="p-2 rounded-lg text-slate-500 hover:text-primary-600 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors"
                  >
                    <Receipt size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => openEditContract(contract)}
                    title="Editar contrato"
                    className="p-2 rounded-lg text-slate-500 hover:text-primary-600 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors"
                  >
                    <Pencil size={16} />
                  </button>
                  {canRenew && (
                    <button
                      type="button"
                      onClick={() => openRenewContract(contract)}
                      title="Renovar contrato"
                      className="p-2 rounded-lg text-slate-500 hover:text-primary-600 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors"
                    >
                      <RefreshCw size={16} />
                    </button>
                  )}
                  {contract.status === 'ACTIVE' && (
                    <button
                      type="button"
                      onClick={() => requestEndContract(contract)}
                      title="Encerrar contrato"
                      className={cn(
                        'p-2 rounded-lg text-slate-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/10 transition-colors'
                      )}
                    >
                      <XCircle size={16} />
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {contractFormState && (
        <ContractFormModal
          state={contractFormState}
          contacts={contacts}
          isSaving={isSavingContract}
          previewReceivables={previewReceivables}
          onClose={closeContractForm}
          onSubmit={values =>
            contractFormState.mode === 'edit' ? submitEditContract(values) : submitCreateContract(values)
          }
        />
      )}

      <ConfirmDialog
        isOpen={!!endContractTarget}
        onClose={cancelEndContract}
        onConfirm={confirmEndContract}
        title="Encerrar contrato?"
        message={
          <>
            O contrato ficará com status <strong>Encerrado</strong> e os recebíveis pendentes ainda não vencidos
            serão removidos. Recebíveis já pagos ou já vencidos não são afetados.
          </>
        }
        confirmText="Encerrar"
        variant="danger"
      />

      <ContractReceivablesSheet
        isOpen={!!receivablesContractId}
        title={receivablesRow ? `Recebíveis — ${receivablesRow.contactName ?? 'Contato removido'}` : 'Recebíveis'}
        today={today}
        receivables={contractReceivables}
        isLoading={receivablesLoading}
        onTogglePaid={toggleReceivablePaid}
        onClose={closeReceivablesSheet}
      />
    </div>
  );
};
