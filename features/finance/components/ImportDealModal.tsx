'use client';

import React from 'react';
import { parseISO, format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Handshake, ArrowRight } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatBRL } from '@/lib/utils/currency';
import type { ImportableDealRow } from '../hooks/useFinanceController';

interface ImportDealModalProps {
  isOpen: boolean;
  rows: ImportableDealRow[];
  isLoading: boolean;
  onSelect: (row: ImportableDealRow) => void;
  onClose: () => void;
}

/**
 * Picker de "importar de deal ganho" (Task 10). Lista deals `is_won=true`
 * ainda sem contrato vinculado (`importableDealRows`, já filtrado pelo
 * controller cruzando com `contracts.dealId`) — escolher um abre o
 * `ContractFormModal` pré-preenchido em modo `import`.
 */
export const ImportDealModal: React.FC<ImportDealModalProps> = ({ isOpen, rows, isLoading, onSelect, onClose }) => {
  if (!isOpen) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Importar de deal ganho" size="md">
      {isLoading ? (
        <p className="text-sm text-slate-500 dark:text-slate-400 py-8 text-center">Carregando deals...</p>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Handshake}
          title="Nenhum deal disponível"
          description="Todos os deals ganhos já viraram contrato, ou ainda não há deal ganho no funil."
        />
      ) : (
        <>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
            Recebíveis com vencimento anterior a hoje serão criados como vencidos.
          </p>
          <ul className="space-y-2 max-h-[60vh] overflow-y-auto">
            {rows.map(({ deal, contactName }) => (
              <li key={deal.id}>
                <button
                  type="button"
                  onClick={() => onSelect({ deal, contactName })}
                  className="w-full flex items-center justify-between gap-3 p-3 rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-dark-card hover:border-primary-500/50 hover:bg-primary-500/5 transition-colors text-left"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900 dark:text-white truncate">{deal.title}</p>
                    <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      <span>{contactName ?? 'Sem contato vinculado'}</span>
                      {deal.closedAt && (
                        <span>· ganho em {format(parseISO(deal.closedAt), 'dd/MM/yyyy', { locale: ptBR })}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-sm font-semibold text-slate-900 dark:text-white">{formatBRL(deal.value)}</span>
                    <ArrowRight size={16} className="text-slate-400" />
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Modal>
  );
};
