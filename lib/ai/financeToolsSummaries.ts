/**
 * @fileoverview Helpers puros (sem I/O, sem `Date.now()`) para as tools de
 * IA financeiras (Fase 1B, Task 11): resumos legíveis em pt-BR devolvidos
 * pelos tools `prepare*`, e o mecanismo de "confirmation token" que amarra
 * um `confirm*` ao `prepare*` que o originou — ver `lib/ai/financeTools.ts`.
 *
 * Mantido num módulo separado (que toca Supabase) para poder testar toda a
 * formatação/hash sem mockar client nenhum — mesmo racional dos módulos de
 * `features/finance/core/*`.
 */

import { createHash } from 'crypto';
import { formatBRL } from '@/lib/utils/currency';

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

const MONTHS_PT_BR = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

/** `yyyy-MM` → "novembro/2026". Cai de volta na própria chave se o mês não for parseável. */
export function formatMonthKeyPtBr(monthKey: string): string {
  const [yearStr, monthStr] = monthKey.split('-');
  const year = Number(yearStr);
  const monthIndex0 = Number(monthStr) - 1;
  const name = MONTHS_PT_BR[monthIndex0];
  if (!name || !Number.isFinite(year)) return monthKey;
  return `${name}/${year}`;
}

/** `yyyy-MM-dd` → "dd/mm/aaaa". Split puro — nunca `new Date(string)` (evita deslocamento de timezone). */
export function formatDateIsoToPtBr(dateStr: string): string {
  const [year, month, day] = (dateStr || '').split('-');
  if (!year || !month || !day) return dateStr;
  return `${day}/${month}/${year}`;
}

/**
 * Range `[start, end]` (`yyyy-MM-dd`) do mês `yyyy-MM`. Equivalente a
 * `periodToDateRange` de `lib/supabase/finance.ts`, mas reimplementado aqui
 * de propósito: aquele módulo importa `./client` (`'use client'`, browser
 * client) — inseguro para o contexto server-only das AI tools (que usam o
 * client service-role, `createStaticAdminClient`).
 */
export function monthKeyToDateRange(monthKey: string): { start: string; end: string } {
  const [yearStr, monthStr] = monthKey.split('-');
  const year = Number(yearStr);
  const monthIndex0 = Number(monthStr) - 1;
  const lastDay = new Date(year, monthIndex0 + 1, 0).getDate();
  const pad2 = (n: number): string => (n < 10 ? `0${n}` : `${n}`);
  return { start: `${yearStr}-${monthStr}-01`, end: `${yearStr}-${monthStr}-${pad2(lastDay)}` };
}

/** Dias de atraso de `dueDate` em relação a `today` (ambos `yyyy-MM-dd`), local-safe. Nunca negativo. */
export function daysOverdue(dueDate: string, today: string): number {
  const toLocalMs = (s: string): number => {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d).getTime();
  };
  const diffMs = toLocalMs(today) - toLocalMs(dueDate);
  return Math.max(0, Math.round(diffMs / (1000 * 60 * 60 * 24)));
}

// ============================================
// Resumos pt-BR dos prepare*
// ============================================

export interface ResolvedCreateExpense {
  description: string;
  category: string;
  amount: number;
  kind: 'FIXED' | 'ONE_TIME';
  dueDay: number | null;
  dueDate: string | null;
}

/** Resumo devolvido por `prepareCreateExpense` — mostrado ao usuário antes do `confirmCreateExpense`. */
export function formatCreateExpenseSummary(r: ResolvedCreateExpense): string {
  const quando =
    r.kind === 'FIXED' ? `fixa, todo dia ${r.dueDay}` : `pontual, vencendo em ${formatDateIsoToPtBr(r.dueDate ?? '')}`;
  return `Confirma lançar ${formatBRL(r.amount)} — ${r.description} (${r.category}) — ${quando}?`;
}

export interface ResolvedMarkReceivablePaid {
  receivableId: string;
  amount: number;
  description: string;
  dueDate: string;
  clientName: string | null;
}

/** Resumo devolvido por `prepareMarkReceivablePaid` — mostrado ao usuário antes do `confirmMarkReceivablePaid`. */
export function formatMarkReceivablePaidSummary(r: ResolvedMarkReceivablePaid): string {
  const quem = r.clientName ? ` de ${r.clientName}` : '';
  return `Confirma dar baixa em ${formatBRL(r.amount)}${quem} — ${r.description}, vencimento ${formatDateIsoToPtBr(r.dueDate)}?`;
}

export interface ResolvedSetMonthlyGoal {
  month: string; // yyyy-MM
  targetValue: number;
}

/** Resumo devolvido por `prepareSetMonthlyGoal` — mostrado ao usuário antes do `confirmSetMonthlyGoal`. */
export function formatSetMonthlyGoalSummary(r: ResolvedSetMonthlyGoal): string {
  return `Confirma definir a meta de ${formatMonthKeyPtBr(r.month)} em ${formatBRL(r.targetValue)}?`;
}

// ============================================
// Confirmation token — amarra confirm* ao prepare* que o originou
// ============================================

/**
 * Hash determinístico (não-criptográfico contra adversário; é uma proteção
 * contra DERIVA DO MODELO) de um payload plano. `prepare*` devolve o token;
 * o `confirm*` correspondente reexige o MESMO payload + token. Se qualquer
 * campo mudar entre o `prepare` e o `confirm` — o modelo "lembrou errado",
 * ou tentou pular o prepare inventando valores plausíveis — o hash
 * recomputado no `confirm` não bate e a execução é recusada (ver
 * `lib/ai/financeTools.ts`, cada `confirm*`).
 */
export function computeConfirmationToken(kind: string, payload: Record<string, string | number | null>): string {
  const sortedKeys = Object.keys(payload).sort();
  const canonical = sortedKeys.map((k) => `${k}=${payload[k]}`).join('&');
  return createHash('sha256').update(`${kind}:${canonical}`).digest('hex').slice(0, 16);
}

/** Recomputa o token a partir do payload atual e compara com o token submetido. */
export function verifyConfirmationToken(
  kind: string,
  payload: Record<string, string | number | null>,
  token: string
): boolean {
  return computeConfirmationToken(kind, payload) === token;
}
