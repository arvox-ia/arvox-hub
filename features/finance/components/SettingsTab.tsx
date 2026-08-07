'use client';

import React, { useEffect, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Download } from 'lucide-react';
import { InputField, SubmitButton } from '@/components/ui/FormField';
import type { useFinanceController } from '../hooks/useFinanceController';

type FinanceController = ReturnType<typeof useFinanceController>;

interface SettingsTabProps {
  controller: Pick<
    FinanceController,
    | 'settings'
    | 'settingsLoading'
    | 'submitSettings'
    | 'isSavingSettings'
    | 'goalRows'
    | 'submitGoal'
    | 'exportCsv'
    | 'isExportingCsv'
  >;
}

function monthLabel(month: string): string {
  return format(parseISO(month), "MMMM 'de' yyyy", { locale: ptBR });
}

interface GoalMonthRowProps {
  month: string;
  targetValue: number;
  onCommit: (month: string, value: number) => void;
}

/**
 * Linha de meta de um mês. Estado local (não controlado pelo `goalRows` a
 * cada render) pra permitir digitar livremente; só reconcilia com o
 * controller no blur — nunca a cada tecla (spec da Task 8).
 */
const GoalMonthRow: React.FC<GoalMonthRowProps> = ({ month, targetValue, onCommit }) => {
  const [value, setValue] = useState(targetValue);

  return (
    <div className="flex items-center justify-between gap-3 py-2 px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-black/20">
      <span className="text-sm text-slate-700 dark:text-slate-300 capitalize">{monthLabel(month)}</span>
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-slate-400">R$</span>
        <input
          type="number"
          min={0}
          step="0.01"
          value={value}
          onChange={e => setValue(Number(e.target.value))}
          onBlur={() => {
            if (value !== targetValue) onCommit(month, value);
          }}
          className="w-32 bg-white dark:bg-black/30 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 text-sm text-right text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-primary-500 transition-all"
        />
      </div>
    </div>
  );
};

export const SettingsTab: React.FC<SettingsTabProps> = ({ controller }) => {
  const { settings, settingsLoading, submitSettings, isSavingSettings, goalRows, submitGoal, exportCsv, isExportingCsv } =
    controller;

  const [form, setForm] = useState({ taxRate: 0, initialBalance: 0, projectionMonths: 12 });
  const [initialized, setInitialized] = useState(false);

  // Sincroniza uma única vez quando as settings chegam do banco — depois disso o form é a
  // fonte de verdade local até o submit (evita sobrescrever o que o usuário está digitando).
  useEffect(() => {
    if (!initialized && settings) {
      setForm({ taxRate: settings.taxRate, initialBalance: settings.initialBalance, projectionMonths: settings.projectionMonths });
      setInitialized(true);
    }
  }, [settings, initialized]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submitSettings(form);
  };

  return (
    <div className="space-y-8">
      <section className="p-4 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-dark-card">
        <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-1">Configurações gerais</h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
          Usadas na projeção de caixa (aba Dashboard) e no cálculo de provisão de imposto.
        </p>

        {settingsLoading ? (
          <p className="text-sm text-slate-500 dark:text-slate-400 py-4 text-center">Carregando configurações...</p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <InputField
              label="% de imposto"
              type="number"
              min={0}
              max={100}
              step="0.1"
              value={form.taxRate}
              onChange={e => setForm(f => ({ ...f, taxRate: Number(e.target.value) }))}
              hint="Provisão estimada sobre a receita contratada — a guia oficial é do contador."
            />

            <InputField
              label="Saldo inicial (R$)"
              type="number"
              step="0.01"
              value={form.initialBalance}
              onChange={e => setForm(f => ({ ...f, initialBalance: Number(e.target.value) }))}
              hint="Saldo de caixa usado como ponto de partida da projeção."
            />

            <InputField
              label="Horizonte de projeção (meses)"
              type="number"
              min={3}
              max={24}
              value={form.projectionMonths}
              onChange={e => setForm(f => ({ ...f, projectionMonths: Number(e.target.value) }))}
              hint="Quantos meses à frente projetar contratos sem prazo definido — de 3 a 24."
            />

            <SubmitButton isLoading={isSavingSettings} loadingText="Salvando..." className="w-auto px-6">
              Salvar configurações
            </SubmitButton>
          </form>
        )}
      </section>

      <section className="p-4 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-dark-card">
        <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-1">Metas mensais</h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
          Meta de receita para os próximos 12 meses. Salva ao sair do campo.
        </p>
        <div className="space-y-2">
          {goalRows.map(row => (
            <GoalMonthRow key={row.month} month={row.month} targetValue={row.targetValue} onCommit={submitGoal} />
          ))}
        </div>
      </section>

      <section className="p-4 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-dark-card">
        <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-1">Exportar dados</h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
          Baixa um backup em CSV (separador ; , compatível com Excel pt-BR) de contratos, recebíveis e despesas.
        </p>
        <button
          type="button"
          onClick={exportCsv}
          disabled={isExportingCsv}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold bg-slate-700 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-colors"
        >
          <Download size={16} /> {isExportingCsv ? 'Exportando...' : 'Exportar dados (CSV)'}
        </button>
      </section>
    </div>
  );
};
