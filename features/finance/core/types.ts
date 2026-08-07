/**
 * Tipos do core puro de finance (Fase 1B). Contrato compartilhado entre o
 * gerador de recebíveis/despesas (Task 3) e o pipeline/projeção (Task 4) e
 * demais consumidores (Tasks 6, 7, 9). Datas cruzam essa fronteira sempre
 * como string `yyyy-MM-dd` (nunca `Date`) para não sofrer deslocamento de
 * timezone.
 */

/** Origem de um recebível: parcela de setup ou mensalidade recorrente. */
export type ReceivableKind = 'SETUP' | 'MONTHLY';

/** Dados mínimos de um contrato necessários para gerar seus recebíveis. */
export interface ContractInput {
  /** Valor total de setup (implantação), dividido em `setupInstallments` parcelas. */
  setupValue: number;
  /** Número de parcelas do setup. */
  setupInstallments: number;
  /** Valor da mensalidade recorrente. */
  monthlyValue: number;
  /** Data de início do contrato, `yyyy-MM-dd`. */
  startDate: string;
  /** Duração em meses da vigência (mensalidades). `null` = indeterminado. */
  durationMonths: number | null;
  /** Dia do mês (1-28) em que a mensalidade vence. */
  billingDay: number;
}

/** Opções de geração de recebíveis: horizonte para contratos indeterminados. */
export interface GenerateReceivablesOptions {
  /** Quantos meses à frente de `today` projetar quando `durationMonths` é `null`. */
  horizonMonths: number;
  /** Data de referência ("hoje"), `yyyy-MM-dd`. Nunca inferida internamente. */
  today: string;
}

/** Um recebível gerado (ainda não persistido). */
export interface ReceivableEntry {
  kind: ReceivableKind;
  amount: number;
  /** `yyyy-MM-dd` */
  dueDate: string;
  description: string;
}

/** Regra de uma despesa fixa recorrente. */
export interface FixedExpenseRule {
  amount: number;
  /** Dia do mês (1-28) em que a despesa vence. */
  dueDay: number;
}

/** Opções de geração de lançamentos de despesa fixa. */
export interface GenerateFixedExpenseEntriesOptions {
  /** Mês de início, `yyyy-MM`. */
  fromMonth: string;
  /** Quantidade de meses (lançamentos) a gerar. */
  months: number;
}

/** Um lançamento de despesa fixa gerado (ainda não persistido). */
export interface FixedExpenseEntry {
  /** `yyyy-MM-dd` */
  dueDate: string;
  amount: number;
}
