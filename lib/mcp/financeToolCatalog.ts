export type FinanceToolCatalogEntry = {
  /** MCP tool name (stable identifier). */
  name: string;
  /** Optional UI-friendly name. */
  title: string;
  /** Human-readable description used by MCP clients / models. */
  description: string;
};

/**
 * Catálogo MCP das tools financeiras — mesma convenção de
 * `lib/mcp/crmToolCatalog.ts` (nomes estáveis, em inglês, padrão
 * `finance.<recurso>.<verbo>`). Descrições deixam explícito que valores
 * monetários vêm em BRL (Real brasileiro) — a lógica reaproveitada de
 * `lib/ai/financeTools.ts` já formata tudo com `formatBRL`.
 *
 * Só é usado quando `keyGrantsFinance(...)` autoriza o registro (ver
 * `lib/mcp/registerAllTools.ts`) — a chave nunca aparece em `tools/list` pra
 * quem não tem escopo financeiro.
 */
export const FINANCE_TOOL_CATALOG = {
  getFinanceOverview: {
    name: 'finance.overview.get',
    title: 'Get finance overview',
    description:
      'Read-only. Financial summary for a month: received, receivable, expenses, goal, and tax provision. All monetary values are formatted in BRL (Brazilian Real). Defaults to the current month. Scoped to the authenticated organization.',
  },
  getCashProjection: {
    name: 'finance.projection.get',
    title: 'Get cash projection',
    description:
      'Read-only. Projects cash flow for the next N months in two curves: floor (contracted revenue only) and probable (contracted revenue + probability-weighted sales pipeline). All monetary values are in BRL. Scoped to the authenticated organization.',
  },
  listOverdueReceivables: {
    name: 'finance.receivables.overdue.list',
    title: 'List overdue receivables',
    description:
      'Read-only. Lists pending receivables whose due date is in the past (overdue), ordered oldest first. Amounts are in BRL. Scoped to the authenticated organization.',
  },

  prepareCreateExpense: {
    name: 'finance.expense.prepare',
    title: 'Prepare new expense',
    description:
      'Validates and summarizes a NEW expense (fixed or one-time) in BRL — writes NOTHING. Always show the returned "summary" to the user and only call finance.expense.confirm after explicit confirmation.',
  },
  confirmCreateExpense: {
    name: 'finance.expense.confirm',
    title: 'Confirm new expense',
    description:
      'Writes data. Records the expense (BRL). Call ONLY after the user explicitly confirms the summary returned by finance.expense.prepare. Echo back EXACTLY description, category, amount, kind, dueDay, dueDate and confirmationToken returned by prepare — any changed value invalidates the token and the call fails.',
  },

  prepareMarkReceivablePaid: {
    name: 'finance.receivable.markPaid.prepare',
    title: 'Prepare mark receivable as paid',
    description:
      'Finds a PENDING receivable (by receivableId, or by client name + amount/description) and summarizes the write-off (BRL) — writes NOTHING. If more than one candidate matches, returns the list for the user to choose from (call again with receivableId). Always show the "summary" and only call finance.receivable.markPaid.confirm after explicit confirmation.',
  },
  confirmMarkReceivablePaid: {
    name: 'finance.receivable.markPaid.confirm',
    title: 'Confirm mark receivable as paid',
    description:
      'Writes data. Marks the receivable as paid. Call ONLY after the user explicitly confirms the summary returned by finance.receivable.markPaid.prepare. Echo back EXACTLY receivableId, amount and confirmationToken returned by prepare — any changed value invalidates the token and the call fails.',
  },

  prepareSetMonthlyGoal: {
    name: 'finance.goal.set.prepare',
    title: 'Prepare monthly goal',
    description:
      'Validates and summarizes a new monthly revenue goal (BRL) — writes NOTHING. Always show the "summary" and only call finance.goal.set.confirm after explicit confirmation.',
  },
  confirmSetMonthlyGoal: {
    name: 'finance.goal.set.confirm',
    title: 'Confirm monthly goal',
    description:
      'Writes data. Creates or updates the monthly goal (BRL). Call ONLY after the user explicitly confirms the summary returned by finance.goal.set.prepare. Echo back EXACTLY month, targetValue and confirmationToken returned by prepare — any changed value invalidates the token and the call fails.',
  },
} as const satisfies Record<string, FinanceToolCatalogEntry>;

export type FinanceInternalToolKey = keyof typeof FINANCE_TOOL_CATALOG;

export function getFinanceCatalogEntry(key: string): FinanceToolCatalogEntry | undefined {
  return (FINANCE_TOOL_CATALOG as Record<string, FinanceToolCatalogEntry | undefined>)[key];
}
