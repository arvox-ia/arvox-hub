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

/**
 * Mapa `yyyy-MM` → valor (BRL). Usado tanto para o pipeline ponderado
 * (saída de `weightDeals`) quanto internamente na projeção.
 */
export type MonthlyAmounts = Record<string, number>;

/** Uma oportunidade aberta no funil de vendas (deal), para ponderação por probabilidade. */
export interface OpenDeal {
  /** Valor de setup (implantação) do possível contrato. */
  value: number;
  /** Probabilidade de fechamento, 0-100. */
  probability: number;
  /** Valor da mensalidade recorrente do possível contrato. */
  monthlyValue: number;
  /** Duração em meses da vigência (mensalidades) após o fechamento. */
  durationMonths: number;
  /** Data prevista de fechamento, `yyyy-MM-dd`, ou `null` se não informada. */
  expectedClose: string | null;
}

/** Opções de ponderação do pipeline. */
export interface WeightDealsOptions {
  /** Data de referência ("hoje"), `yyyy-MM-dd`. Nunca inferida internamente. */
  today: string;
  /** Quantos meses à frente de `today` (inclusive o mês de `today`) considerar. */
  horizonMonths: number;
  /** Dias após `today` assumidos como fechamento quando `expectedClose` é `null`. */
  defaultCloseDays: number;
  /**
   * Dia do mês assumido como billingDay do futuro contrato, para decidir o mês de início da
   * mensalidade — mesma regra de `generateReceivables` (Task 3): dia de fechamento <=
   * `assumedBillingDay` → mensalidade começa no PRÓPRIO mês de fechamento; caso contrário, no
   * mês seguinte. Mantém `weightDeals` consistente com o contrato real gerado após o deal fechar.
   */
  assumedBillingDay: number;
}

/** Um recebível já existente, relevante para a projeção por `dueDate`. */
export interface ProjectionDueEntry {
  /** `yyyy-MM-dd` */
  dueDate: string;
  amount: number;
}

/**
 * Um lançamento de despesa já materializado (regra fixa gerada para o mês, ou lançamento
 * pontual), relevante para a projeção por `dueDate`. Carrega `expenseId` — o id da despesa de
 * catálogo (`finance_expenses.id`) que o originou — para permitir dedup por REGRA em
 * `buildProjection` (ver `ProjectionFixedRule`); lançamentos `ONE_TIME` também têm `expenseId`
 * (a própria linha de catálogo do lançamento pontual).
 */
export interface ProjectionExpenseEntry {
  /** `yyyy-MM-dd` */
  dueDate: string;
  amount: number;
  /** Id da despesa de catálogo (`finance_expenses.id`) que originou este lançamento. */
  expenseId: string;
}

/**
 * Regra de despesa fixa ativa, para cobrir meses ainda não materializados. Carrega `expenseId` —
 * o id da mesma linha de catálogo (`finance_expenses.id`) — para que `buildProjection` saiba
 * dizer "esta regra específica já foi materializada neste mês" (por `expenseId`), em vez de
 * "existe QUALQUER lançamento neste mês" (que dropava despesas fixas não relacionadas).
 */
export interface ProjectionFixedRule {
  amount: number;
  /** Dia do mês (1-28) em que a despesa vence (não usado no agrupamento mensal da projeção). */
  dueDay: number;
  /** Id da despesa de catálogo (`finance_expenses.id`) dona desta regra. */
  expenseId: string;
}

/** Entrada de `buildProjection`: dados já resolvidos para montar as duas curvas. */
export interface ProjectionInput {
  /** Meses a projetar, `yyyy-MM`, em ordem — um `ProjectionPoint` por mês. */
  months: string[];
  /** Recebíveis (parcelas de setup e mensalidades de contratos fechados) por vencimento. */
  receivables: ProjectionDueEntry[];
  /** Lançamentos de despesa já materializados (fixos gerados + pontuais) por vencimento. */
  expenseEntries: ProjectionExpenseEntry[];
  /** Regras de despesa fixa ativas, para cobrir meses de `months` ainda não materializados. */
  fixedRules: ProjectionFixedRule[];
  /** Pipeline ponderado (saída de `weightDeals`), mapa `yyyy-MM` → valor. */
  weighted: MonthlyAmounts;
  /** Alíquota de provisão de imposto, percentual (0-100), sobre a receita do mês. */
  taxRate: number;
  /** Saldo de caixa inicial, antes do primeiro mês de `months`. */
  initialBalance: number;
}

/** Um ponto (mês) da projeção de caixa em duas curvas. */
export interface ProjectionPoint {
  /** `yyyy-MM` */
  month: string;
  /** Receita garantida do mês: recebíveis já contratados com vencimento nesse mês. */
  contracted: number;
  /** Receita provável do mês: `contracted` + pipeline ponderado do mês. */
  probable: number;
  /** Despesas do mês: lançamentos materializados + regras fixas ainda não materializadas. */
  expenses: number;
  /** Provisão de imposto do mês (piso), `taxRate`% sobre `contracted`. */
  taxProvision: number;
  /** Saldo acumulado (piso), partindo de `initialBalance`, com a curva `contracted`. */
  balanceFloor: number;
  /** Saldo acumulado (provável), partindo de `initialBalance`, com a curva `probable`. */
  balanceProbable: number;
}
