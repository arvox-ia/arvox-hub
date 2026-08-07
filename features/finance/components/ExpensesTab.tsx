'use client';

import React from 'react';
import { addMonths, format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ChevronLeft, ChevronRight, CheckCircle2, Pencil, Plus, Receipt, RotateCcw, AlertTriangle } from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils/cn';
import { formatBRL } from '@/lib/utils/currency';
import { ExpenseFormModal } from './ExpenseFormModal';
import type { useFinanceController } from '../hooks/useFinanceController';

type FinanceController = ReturnType<typeof useFinanceController>;

interface ExpensesTabProps {
  controller: Pick<
    FinanceController,
    | 'expensesPeriod'
    | 'setExpensesPeriod'
    | 'expensesLoading'
    | 'expenseEntriesLoading'
    | 'expenseEntryRows'
    | 'expenseCategoryTotals'
    | 'expenseMonthTotal'
    | 'fixedExpenseRules'
    | 'toggleExpenseActive'
    | 'toggleEntryPaid'
    | 'today'
    | 'expenseFormState'
    | 'openCreateExpense'
    | 'openEditExpense'
    | 'closeExpenseForm'
    | 'submitExpenseForm'
    | 'isSavingExpense'
  >;
}

const KIND_LABEL: Record<'FIXED' | 'ONE_TIME', string> = {
  FIXED: 'Fixa mensal',
  ONE_TIME: 'Pontual',
};

function monthLabel(period: string): string {
  return format(parseISO(`${period}-01`), "MMMM 'de' yyyy", { locale: ptBR });
}

function shiftPeriod(period: string, months: number): string {
  return format(addMonths(parseISO(`${period}-01`), months), 'yyyy-MM');
}

function formatDate(dateStr: string): string {
  return format(parseISO(dateStr), 'dd/MM/yyyy', { locale: ptBR });
}

export const ExpensesTab: React.FC<ExpensesTabProps> = ({ controller }) => {
  const {
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
  } = controller;

  const categoryEntries = Object.entries(expenseCategoryTotals).sort((a, b) => b[1] - a[1]);
  const isLoading = expensesLoading || expenseEntriesLoading;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setExpensesPeriod(shiftPeriod(expensesPeriod, -1))}
            aria-label="Mês anterior"
            className="p-2 rounded-lg text-slate-500 hover:text-primary-600 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="text-sm font-semibold text-slate-900 dark:text-white capitalize min-w-[160px] text-center">
            {monthLabel(expensesPeriod)}
          </span>
          <button
            type="button"
            onClick={() => setExpensesPeriod(shiftPeriod(expensesPeriod, 1))}
            aria-label="Próximo mês"
            className="p-2 rounded-lg text-slate-500 hover:text-primary-600 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors"
          >
            <ChevronRight size={16} />
          </button>
        </div>

        <button
          type="button"
          onClick={openCreateExpense}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-primary-600 hover:bg-primary-500 text-white transition-colors"
        >
          <Plus size={16} /> Nova despesa
        </button>
      </div>

      <div className="p-4 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-dark-card space-y-3">
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-medium text-slate-500 dark:text-slate-400">Total do mês</span>
          <span className="text-lg font-bold text-slate-900 dark:text-white">{formatBRL(expenseMonthTotal)}</span>
        </div>
        {categoryEntries.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {categoryEntries.map(([category, total]) => (
              <Badge key={category} variant="outline" className="font-normal">
                {category}: <span className="font-semibold ml-1">{formatBRL(total)}</span>
              </Badge>
            ))}
          </div>
        )}
      </div>

      {isLoading ? (
        <p className="text-sm text-slate-500 dark:text-slate-400 py-8 text-center">Carregando despesas...</p>
      ) : expenseEntryRows.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="Nenhuma despesa neste mês"
          description="Cadastre uma despesa fixa (recorrente) ou pontual pra começar a acompanhar."
          action={{ label: 'Nova despesa', onClick: openCreateExpense }}
        />
      ) : (
        <ul className="space-y-2">
          {expenseEntryRows.map(row => {
            const isPaid = row.status === 'PAID';
            const relatedExpense = fixedExpenseRules.find(e => e.id === row.expenseId);
            return (
              <li
                key={row.entryId}
                className={cn(
                  'flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg border',
                  row.isOverdue
                    ? 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-900/40'
                    : 'bg-slate-50 dark:bg-black/20 border-slate-200 dark:border-slate-700'
                )}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-slate-900 dark:text-white truncate">
                      {row.description}
                    </span>
                    <Badge variant="outline" className="shrink-0">
                      {row.category}
                    </Badge>
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
                      isPaid ? 'text-success-text' : 'text-slate-900 dark:text-white'
                    )}
                  >
                    {formatBRL(row.amount)}
                  </span>
                  {relatedExpense && (
                    <button
                      type="button"
                      onClick={() => openEditExpense(relatedExpense)}
                      title="Editar despesa"
                      className="p-1.5 rounded-lg text-slate-500 hover:text-primary-600 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors"
                    >
                      <Pencil size={14} />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => toggleEntryPaid(row.entryId, row.dueDate, isPaid)}
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

      {fixedExpenseRules.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-bold text-slate-500 uppercase">Despesas fixas cadastradas</h3>
          <p className="text-xs text-slate-400 dark:text-slate-500">
            Desativar uma regra fixa para de gerar lançamentos nos próximos meses — os lançamentos já gerados não são
            afetados.
          </p>
          <ul className="space-y-2">
            {fixedExpenseRules.map(expense => (
              <li
                key={expense.id}
                className={cn(
                  'flex items-center justify-between gap-3 p-3 rounded-lg border',
                  expense.active
                    ? 'bg-white dark:bg-dark-card border-slate-200 dark:border-white/10'
                    : 'bg-slate-50 dark:bg-black/10 border-slate-200 dark:border-slate-800 opacity-60'
                )}
              >
                <div className="min-w-0 flex items-center gap-2">
                  <span className="text-sm font-medium text-slate-900 dark:text-white truncate">
                    {expense.description}
                  </span>
                  <Badge variant="outline" className="shrink-0">
                    {expense.category}
                  </Badge>
                  <span className="text-xs text-slate-500 dark:text-slate-400 shrink-0">
                    dia {expense.dueDay} · {formatBRL(expense.amount)}
                  </span>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <button
                    type="button"
                    onClick={() => openEditExpense(expense)}
                    title="Editar despesa"
                    className="p-1.5 rounded-lg text-slate-500 hover:text-primary-600 hover:bg-slate-100 dark:hover:bg-white/5 transition-colors"
                  >
                    <Pencil size={14} />
                  </button>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      {expense.active ? 'Ativa' : 'Inativa'}
                    </span>
                    <Switch checked={expense.active} onCheckedChange={() => toggleExpenseActive(expense)} />
                  </label>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {expenseFormState && (
        <ExpenseFormModal
          state={expenseFormState}
          isSaving={isSavingExpense}
          defaultDate={`${expensesPeriod}-01`}
          onClose={closeExpenseForm}
          onSubmit={submitExpenseForm}
        />
      )}
    </div>
  );
};
