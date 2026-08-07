'use client';

import React from 'react';
import { parseISO, format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { X, CheckCircle2, RotateCcw, AlertTriangle } from 'lucide-react';
import { Sheet } from '@/components/ui/Sheet';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { cn } from '@/lib/utils/cn';
import { formatBRL } from '@/lib/utils/currency';
import type { FinanceReceivable } from '@/lib/supabase/finance';

interface ContractReceivablesSheetProps {
  isOpen: boolean;
  title: string;
  today: string;
  receivables: FinanceReceivable[];
  isLoading: boolean;
  onTogglePaid: (receivableId: string, dueDate: string, currentlyPaid: boolean) => void;
  onClose: () => void;
}

const KIND_LABEL: Record<FinanceReceivable['kind'], string> = {
  SETUP: 'Setup',
  MONTHLY: 'Mensalidade',
};

/**
 * Sheet de recebíveis de um contrato (Task 7). Baixa/desfazer baixa em um
 * clique via `onTogglePaid` (o controller decide qual mutation chamar —
 * `markReceivablePaid`/`unmarkReceivablePaid`, já vindas da Task 5).
 * Atrasados (PENDING com `due_date < today`) ganham destaque visual.
 */
export const ContractReceivablesSheet: React.FC<ContractReceivablesSheetProps> = ({
  isOpen,
  title,
  today,
  receivables,
  isLoading,
  onTogglePaid,
  onClose,
}) => {
  return (
    <Sheet isOpen={isOpen} onClose={onClose} ariaLabel={title} className="max-h-[85vh] flex flex-col">
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-white/10 shrink-0">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white font-display truncate pr-4">
          {title}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar"
          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors shrink-0"
        >
          <X size={18} />
        </button>
      </div>

      <div className="overflow-y-auto flex-1 p-5">
        {isLoading ? (
          <p className="text-sm text-slate-500 dark:text-slate-400 text-center py-8">Carregando recebíveis...</p>
        ) : receivables.length === 0 ? (
          <EmptyState
            icon={CheckCircle2}
            title="Nenhum recebível"
            description="Este contrato ainda não tem recebíveis gerados."
          />
        ) : (
          <ul className="space-y-2">
            {receivables.map(r => {
              const isPaid = r.status === 'PAID';
              const isOverdue = !isPaid && r.dueDate < today;
              return (
                <li
                  key={r.id}
                  className={cn(
                    'flex items-center justify-between gap-3 p-3 rounded-lg border',
                    isOverdue
                      ? 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-900/40'
                      : 'bg-slate-50 dark:bg-black/20 border-slate-200 dark:border-slate-700'
                  )}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-900 dark:text-white truncate">
                        {r.description}
                      </span>
                      <Badge variant="outline" className="shrink-0">
                        {KIND_LABEL[r.kind]}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      <span>{format(parseISO(r.dueDate), "dd 'de' MMM 'de' yyyy", { locale: ptBR })}</span>
                      {isOverdue && (
                        <span className="flex items-center gap-1 text-red-600 dark:text-red-400 font-medium">
                          <AlertTriangle size={12} /> Atrasado
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <span
                      className={cn(
                        'text-sm font-semibold',
                        isPaid ? 'text-success-text' : 'text-slate-900 dark:text-white'
                      )}
                    >
                      {formatBRL(r.amount)}
                    </span>
                    <button
                      type="button"
                      onClick={() => onTogglePaid(r.id, r.dueDate, isPaid)}
                      className={cn(
                        'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors',
                        isPaid
                          ? 'bg-success-bg text-success-text hover:opacity-80'
                          : 'bg-primary-600 hover:bg-primary-500 text-white'
                      )}
                    >
                      {isPaid ? (
                        <>
                          <RotateCcw size={12} /> Desfazer baixa
                        </>
                      ) : (
                        <>
                          <CheckCircle2 size={12} /> Dar baixa
                        </>
                      )}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Sheet>
  );
};
