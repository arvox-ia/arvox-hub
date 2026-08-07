'use client';

import React from 'react';
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatBRL } from '@/lib/utils/currency';
import { formatCompactBRL } from '../core/chartFormatting';
import type { ProjectionPoint } from '../core/types';

interface ProjectionChartProps {
  data: ProjectionPoint[];
}

/** `yyyy-MM` → rótulo curto pt-BR (ex.: `jan/26`), pro eixo X. */
function monthTickLabel(month: string): string {
  return format(parseISO(`${month}-01`), 'MMM/yy', { locale: ptBR }).replace('.', '');
}

/** `yyyy-MM` → rótulo longo pt-BR (ex.: `janeiro de 2026`), pro tooltip. */
function monthTooltipLabel(month: string): string {
  return format(parseISO(`${month}-01`), "MMMM 'de' yyyy", { locale: ptBR });
}

const SERIES_LABEL: Record<string, string> = {
  contracted: 'Contratado',
  probable: 'Provável',
  expenses: 'Despesas',
  balanceProbable: 'Saldo acumulado (provável)',
};

function ProjectionTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div
      className="rounded-xl px-3 py-2 text-xs shadow-lg"
      style={{
        backgroundColor: 'var(--chart-tooltip-bg)',
        border: '1px solid var(--chart-tooltip-border)',
        color: 'var(--chart-tooltip-text)',
      }}
    >
      <p className="font-semibold capitalize mb-1.5">{monthTooltipLabel(label)}</p>
      <div className="space-y-0.5">
        {payload.map((entry: any) => (
          <div key={entry.dataKey} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: entry.color }} />
              {SERIES_LABEL[entry.dataKey as string] ?? entry.dataKey}
            </span>
            <span className="font-semibold">{formatBRL(entry.value as number)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Gráfico de duas curvas (contratado × provável) + despesas + saldo
 * acumulado provável, o centro do Dashboard financeiro. Recharts puro —
 * nenhuma aritmética aqui além de formatação de rótulo; os valores já vêm
 * prontos de `buildProjection` (core).
 */
export const ProjectionChart: React.FC<ProjectionChartProps> = ({ data }) => (
  <ResponsiveContainer width="100%" height="100%" debounce={50}>
    <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
      <defs>
        <linearGradient id="colorContracted" x1="0" y1="0" x2="0" y2="1">
          <stop offset="5%" stopColor="var(--color-primary-500)" stopOpacity={0.35} />
          <stop offset="95%" stopColor="var(--color-primary-500)" stopOpacity={0} />
        </linearGradient>
      </defs>
      <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" vertical={false} />
      <XAxis
        dataKey="month"
        tickFormatter={monthTickLabel}
        axisLine={false}
        tickLine={false}
        tick={{ fill: 'var(--chart-text)', fontSize: 12 }}
        dy={10}
      />
      <YAxis
        yAxisId="flow"
        axisLine={false}
        tickLine={false}
        tick={{ fill: 'var(--chart-text)', fontSize: 12 }}
        tickFormatter={formatCompactBRL}
        width={64}
      />
      <YAxis
        yAxisId="balance"
        orientation="right"
        axisLine={false}
        tickLine={false}
        tick={{ fill: 'var(--chart-text)', fontSize: 12 }}
        tickFormatter={formatCompactBRL}
        width={64}
      />
      <Tooltip content={<ProjectionTooltip />} />
      <Legend
        formatter={(value: string) => SERIES_LABEL[value] ?? value}
        wrapperStyle={{ fontSize: 12, color: 'var(--chart-text)' }}
      />
      <Area
        yAxisId="flow"
        type="monotone"
        dataKey="contracted"
        name="contracted"
        stroke="var(--color-primary-500)"
        strokeWidth={2.5}
        fillOpacity={1}
        fill="url(#colorContracted)"
      />
      <Line
        yAxisId="flow"
        type="monotone"
        dataKey="probable"
        name="probable"
        stroke="var(--color-info)"
        strokeWidth={2}
        strokeDasharray="6 4"
        dot={false}
      />
      <Line
        yAxisId="flow"
        type="monotone"
        dataKey="expenses"
        name="expenses"
        stroke="var(--color-error)"
        strokeWidth={2}
        dot={false}
      />
      <Line
        yAxisId="balance"
        type="monotone"
        dataKey="balanceProbable"
        name="balanceProbable"
        stroke="var(--color-success)"
        strokeWidth={2}
        dot={false}
      />
    </ComposedChart>
  </ResponsiveContainer>
);

export default ProjectionChart;
