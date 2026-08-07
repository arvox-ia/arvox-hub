'use client';

import React, { useState } from 'react';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { AlertTriangle, CalendarClock, CheckCircle2 } from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils/cn';
import { formatBRL } from '@/lib/utils/currency';
import type { UpcomingRow } from '../core/dashboardMetrics';

interface UpcomingListProps {
  rows: UpcomingRow[];
  isLoading: boolean;
  onTogglePaid: (row: UpcomingRow) => Promise<void>;
}

const KIND_LABEL: Record<UpcomingRow['kind'], string> = {
  RECEIVABLE: 'Recebível',
  EXPENSE: 'Despesa',
};

function formatDate(dateStr: string): string {
  return format(parseISO(dateStr), 'dd/MM/yyyy', { locale: ptBR });
}

/**
 * Recebíveis + lançamentos de despesa dos próximos 15 dias (Task 9), com
 * atrasados pinados no topo em destaque vermelho e baixa em 1 clique. `rows`
 * já vem pronta (filtrada e ordenada) do controller via
 * `filterUpcoming` (core puro) — este componente só renderiza.
 */
export const UpcomingList: React.FC<UpcomingListProps> = ({ rows, isLoading, onTogglePaid }) => {
  const [pendingRowId, setPendingRowId] = useState<string | null>(null);

  const handleToggle = async (row: UpcomingRow) => {
    setPendingRowId(row.id);
    try {
      await onTogglePaid(row);
    } finally {
      setPendingRowId(null);
    }
  };

  if (isLoading) {
    return <p className="text-sm text-slate-500 dark:text-slate-400 py-6 text-center">Carregando vencimentos...</p>;
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={CalendarClock}
        title="Nada vencendo nos próximos 15 dias"
        description="Recebíveis e despesas em dia aparecem aqui conforme se aproximam do vencimento."
      />
    );
  }

  return (
    <ul className="space-y-2">
      {rows.map(row => (
        <li
          key={`${row.kind}-${row.id}`}
          className={cn(
            'flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg border',
            row.isOverdue
              ? 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-900/40'
              : 'bg-slate-50 dark:bg-black/20 border-slate-200 dark:border-slate-700'
          )}
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium text-slate-900 dark:text-white truncate">{row.description}</span>
              <Badge variant="outline" className="shrink-0">
                {KIND_LABEL[row.kind]}
              </Badge>
            </div>
            <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              <span>Vencimento: {formatDate(row.dueDate)}</span>
              {row.isOverdue && (
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
                row.kind === 'EXPENSE' ? 'text-error-text' : 'text-slate-900 dark:text-white'
              )}
            >
              {formatBRL(row.amount)}
            </span>
            <button
              type="button"
              disabled={pendingRowId === row.id}
              onClick={() => handleToggle(row)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-primary-600 hover:bg-primary-500 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors"
            >
              <CheckCircle2 size={12} /> Dar baixa
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
};

export default UpcomingList;
