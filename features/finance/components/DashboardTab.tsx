'use client';

import React, { Suspense, lazy } from 'react';
import { AlertTriangle, Clock, Receipt, RefreshCw, Target, TrendingDown, TrendingUp, Wallet } from 'lucide-react';
import { StatCard } from '@/features/dashboard/components/StatCard';
import { EmptyState } from '@/components/ui/EmptyState';
import { ChartSkeleton } from '@/components/charts';
import { formatBRL } from '@/lib/utils/currency';
import { cn } from '@/lib/utils/cn';
import { UpcomingList } from './UpcomingList';
import type { useFinanceController } from '../hooks/useFinanceController';

const LazyProjectionChart = lazy(() => import('./ProjectionChart'));

type FinanceController = ReturnType<typeof useFinanceController>;

interface DashboardTabProps {
  controller: Pick<
    FinanceController,
    | 'setActiveTab'
    | 'isDashboardLoading'
    | 'projection'
    | 'currentMonthProjection'
    | 'receivablesThisMonth'
    | 'receivablesPaidThisMonth'
    | 'expenseEntriesThisMonth'
    | 'monthKpis'
    | 'taxRate'
    | 'probableTaxProvision'
    | 'currentMonthGoal'
    | 'currentMonthRealizado'
    | 'goalProgressPct'
    | 'upcomingRows'
    | 'toggleUpcomingPaid'
    | 'endingSoonContracts'
    | 'overdueReceivables'
    | 'openRenewContract'
  >;
}

/** Cabeçalho pt-BR de um bloco/card do dashboard. */
const SectionCard: React.FC<{ title: string; description?: string; children: React.ReactNode; className?: string }> = ({
  title,
  description,
  children,
  className,
}) => (
  <section className={cn('p-4 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-dark-card', className)}>
    <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-1">{title}</h3>
    {description && <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">{description}</p>}
    {children}
  </section>
);

export const DashboardTab: React.FC<DashboardTabProps> = ({ controller }) => {
  const {
    setActiveTab,
    isDashboardLoading,
    projection,
    currentMonthProjection,
    receivablesThisMonth,
    receivablesPaidThisMonth,
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
    openRenewContract,
  } = controller;

  if (isDashboardLoading) {
    return <p className="text-sm text-slate-500 dark:text-slate-400 py-8 text-center">Carregando dashboard...</p>;
  }

  // `paidCount` conta por DATA DE PAGAMENTO (mesma base de `monthKpis.recebido`) — não por
  // vencimento, senão o card "Recebido" e a contagem embaixo dele contariam coisas diferentes.
  const paidCount = receivablesPaidThisMonth.length;
  const pendingCount = receivablesThisMonth.filter(r => r.status === 'PENDING').length;
  const expenseCount = expenseEntriesThisMonth.length;
  const resultadoPositivo = monthKpis.resultado >= 0;
  const contractedProvision = currentMonthProjection?.taxProvision ?? 0;

  const alerts = [
    ...endingSoonContracts.map(row => ({
      key: `contract-${row.contract.id}`,
      icon: RefreshCw,
      text: `Contrato de ${row.contactName ?? 'contato removido'} vence em breve${row.endDate ? ` (${row.endDate.split('-').reverse().join('/')})` : ''}`,
      actionLabel: 'Renovar?',
      onAction: () => {
        openRenewContract(row.contract);
        setActiveTab('contracts');
      },
    })),
    ...overdueReceivables.map(row => ({
      key: `overdue-${row.id}`,
      icon: AlertTriangle,
      text: `${row.description} está atrasado (${formatBRL(row.amount)})`,
      actionLabel: 'Dar baixa',
      onAction: () => toggleUpcomingPaid(row),
    })),
  ];

  return (
    <div className="space-y-6">
      {/* ---------- StatCards do mês corrente ---------- */}
      {/*
        "Recebido" e "A receber" usam bases de DATA diferentes de propósito
        (achado da revisão): Recebido é por data de PAGAMENTO — um recebível
        vencido no mês passado e pago agora conta aqui, neste mês, mesmo que
        tenha vencido antes. A receber é por VENCIMENTO. A legenda abaixo de
        cada card deixa isso explícito, pra ninguém ter que adivinhar.
      */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div title="Soma dos recebíveis pagos neste mês, pela data de pagamento — não pela data de vencimento.">
          <StatCard
            title="Recebido"
            value={formatBRL(monthKpis.recebido)}
            subtext={`${paidCount} recebível(is)`}
            subtextPositive
            comparisonLabel=""
            icon={Wallet}
            variant="success"
          />
          <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1.5 px-1">recebido no mês (data de pagamento)</p>
        </div>
        <div title="Soma dos recebíveis ainda pendentes cujo vencimento cai neste mês — independente de quando forem pagos de fato.">
          <StatCard
            title="A receber"
            value={formatBRL(monthKpis.aReceber)}
            subtext={`${pendingCount} pendente(s)`}
            subtextPositive
            comparisonLabel=""
            icon={Clock}
            variant="info"
          />
          <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1.5 px-1">a vencer no mês (data de vencimento)</p>
        </div>
        <div title="Soma dos lançamentos de despesa com vencimento neste mês, pagos ou não.">
          <StatCard
            title="Despesas"
            value={formatBRL(monthKpis.despesas)}
            subtext={`${expenseCount} lançamento(s)`}
            subtextPositive
            comparisonLabel=""
            icon={Receipt}
            variant="warning"
          />
          <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1.5 px-1">no mês (data de vencimento)</p>
        </div>
        <div title="Recebido (pago no mês) + a receber (vencendo no mês) − despesas do mês − provisão de imposto sobre o contratado.">
          <StatCard
            title="Resultado"
            value={formatBRL(monthKpis.resultado)}
            subtext={resultadoPositivo ? 'Positivo' : 'Negativo'}
            subtextPositive={resultadoPositivo}
            comparisonLabel=""
            icon={resultadoPositivo ? TrendingUp : TrendingDown}
            variant={resultadoPositivo ? 'primary' : 'danger'}
          />
          <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1.5 px-1">recebido + a receber − despesas − provisão</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* ---------- Meta vs. realizado ---------- */}
        <SectionCard
          title="Meta vs. realizado"
          description="Realizado = recebido no mês (pago) + a receber no mês (a vencer), contra a meta cadastrada."
        >
          {currentMonthGoal <= 0 ? (
            <EmptyState
              icon={Target}
              title="Nenhuma meta definida para este mês"
              description="Cadastre uma meta mensal em Configurações para acompanhar o progresso aqui."
              action={{ label: 'Definir meta', onClick: () => setActiveTab('settings') }}
              className="py-8"
            />
          ) : (
            <div className="space-y-2">
              <div className="flex items-baseline justify-between text-sm">
                <span className="font-semibold text-slate-900 dark:text-white">{formatBRL(currentMonthRealizado)}</span>
                <span className="text-slate-500 dark:text-slate-400">meta: {formatBRL(currentMonthGoal)}</span>
              </div>
              <div className="h-2.5 w-full rounded-full bg-slate-100 dark:bg-white/5 overflow-hidden">
                <div
                  className={cn('h-full rounded-full transition-all', goalProgressPct >= 100 ? 'bg-success-text' : 'bg-primary-500')}
                  style={{ width: `${goalProgressPct}%` }}
                />
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">{goalProgressPct.toFixed(0)}% da meta do mês</p>
            </div>
          )}
        </SectionCard>

        {/* ---------- Provisão de imposto ---------- */}
        <SectionCard title="Provisão de imposto do mês" description="Estimativa — a guia oficial é do contador.">
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded-lg bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-slate-700">
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Sobre o contratado</p>
              <p className="text-sm font-bold text-slate-900 dark:text-white">{formatBRL(contractedProvision)}</p>
            </div>
            <div className="p-3 rounded-lg bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-slate-700">
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Sobre o provável</p>
              <p className="text-sm font-bold text-slate-900 dark:text-white">{formatBRL(probableTaxProvision)}</p>
            </div>
          </div>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-3">
            Alíquota configurada: {taxRate}%. Cada provisão usa a receita da sua própria curva — contratado e provável
            raramente coincidem.
          </p>
        </SectionCard>
      </div>

      {/* ---------- Alertas ---------- */}
      {alerts.length > 0 && (
        <SectionCard title="Alertas" description="Contratos vencendo em até 30 dias e recebíveis atrasados.">
          <ul className="space-y-2">
            {alerts.map(alert => (
              <li
                key={alert.key}
                className="flex items-center justify-between gap-3 p-2.5 rounded-lg bg-orange-50 dark:bg-orange-900/10 border border-orange-200 dark:border-orange-900/30"
              >
                <span className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 min-w-0">
                  <alert.icon size={14} className="text-warning-text shrink-0" />
                  <span className="truncate">{alert.text}</span>
                </span>
                <button
                  type="button"
                  onClick={alert.onAction}
                  className="shrink-0 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-primary-600 hover:bg-primary-500 text-white transition-colors"
                >
                  {alert.actionLabel}
                </button>
              </li>
            ))}
          </ul>
        </SectionCard>
      )}

      {/* ---------- Projeção de caixa (duas curvas) ---------- */}
      <SectionCard title="Projeção de caixa" description="Contratado (garantido) × provável (contratado + pipeline ponderado) × despesas × saldo acumulado provável.">
        <div style={{ height: 360 }}>
          <Suspense fallback={<ChartSkeleton height={360} />}>
            <LazyProjectionChart data={projection} />
          </Suspense>
        </div>
      </SectionCard>

      {/* ---------- Próximos vencimentos ---------- */}
      <SectionCard title="Próximos vencimentos" description="Recebíveis e despesas dos próximos 15 dias — atrasados aparecem primeiro, em destaque.">
        <UpcomingList rows={upcomingRows} isLoading={false} onTogglePaid={toggleUpcomingPaid} />
      </SectionCard>
    </div>
  );
};

export default DashboardTab;
