/**
 * Núcleo puro de exportação CSV (Fase 1B, Task 8, spec §4.4 "backup export").
 *
 * Sem I/O: monta linhas (`string[][]`) a partir dos dados de finance já
 * carregados. A serialização em si (separador `;`, BOM UTF-8 — o que o
 * Excel pt-BR espera) é feita por `stringifyCsv`/`withUtf8Bom`, já existentes
 * e testados em `lib/utils/csv.ts` (usados pelo importador de contatos) —
 * não duplicados aqui. Quem dispara o download no navegador (Blob +
 * URL.createObjectURL) fica em `lib/utils/download.ts`, fora do core.
 */
import { format, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { formatBRL } from '@/lib/utils/currency'

/** Formata `yyyy-MM-dd` como `dd/MM/yyyy` — mesma convenção usada no resto da UI de finance. */
export function formatDateBR(dateStr: string): string {
  return format(parseISO(dateStr), 'dd/MM/yyyy', { locale: ptBR })
}

// ============================================
// CONTRATOS
// ============================================

export interface ContractCsvInput {
  contactName: string
  description: string
  setupValue: number
  setupInstallments: number
  monthlyValue: number
  startDate: string
  durationMonths: number | null
  billingDay: number
  status: string
}

const CONTRACTS_HEADER = [
  'Contato',
  'Descrição',
  'Valor de setup',
  'Parcelas de setup',
  'Mensalidade',
  'Início',
  'Duração (meses)',
  'Dia de cobrança',
  'Status',
]

export function buildContractsCsvRows(contracts: ContractCsvInput[]): string[][] {
  const rows = contracts.map((c) => [
    c.contactName,
    c.description,
    formatBRL(c.setupValue),
    String(c.setupInstallments),
    formatBRL(c.monthlyValue),
    formatDateBR(c.startDate),
    c.durationMonths === null ? 'Indeterminado' : String(c.durationMonths),
    String(c.billingDay),
    c.status,
  ])
  return [CONTRACTS_HEADER, ...rows]
}

// ============================================
// RECEBÍVEIS
// ============================================

export interface ReceivableCsvInput {
  contactName: string
  kind: 'SETUP' | 'MONTHLY'
  description: string
  amount: number
  dueDate: string
  status: 'PENDING' | 'PAID'
}

const RECEIVABLE_KIND_LABEL: Record<ReceivableCsvInput['kind'], string> = {
  SETUP: 'Setup',
  MONTHLY: 'Mensalidade',
}

const RECEIVABLE_STATUS_LABEL: Record<ReceivableCsvInput['status'], string> = {
  PENDING: 'Pendente',
  PAID: 'Pago',
}

const RECEIVABLES_HEADER = ['Contato', 'Tipo', 'Descrição', 'Valor', 'Vencimento', 'Status']

export function buildReceivablesCsvRows(receivables: ReceivableCsvInput[]): string[][] {
  const rows = receivables.map((r) => [
    r.contactName,
    RECEIVABLE_KIND_LABEL[r.kind],
    r.description,
    formatBRL(r.amount),
    formatDateBR(r.dueDate),
    RECEIVABLE_STATUS_LABEL[r.status],
  ])
  return [RECEIVABLES_HEADER, ...rows]
}

// ============================================
// DESPESAS + LANÇAMENTOS
// ============================================

export interface ExpenseEntryCsvInput {
  description: string
  category: string
  kind: 'FIXED' | 'ONE_TIME'
  amount: number
  dueDate: string
  status: 'PENDING' | 'PAID'
}

const EXPENSE_KIND_LABEL: Record<ExpenseEntryCsvInput['kind'], string> = {
  FIXED: 'Fixa mensal',
  ONE_TIME: 'Pontual',
}

const EXPENSE_STATUS_LABEL: Record<ExpenseEntryCsvInput['status'], string> = {
  PENDING: 'Pendente',
  PAID: 'Pago',
}

const EXPENSES_HEADER = ['Descrição', 'Categoria', 'Tipo', 'Valor', 'Vencimento', 'Status']

export function buildExpensesCsvRows(entries: ExpenseEntryCsvInput[]): string[][] {
  const rows = entries.map((e) => [
    e.description,
    e.category,
    EXPENSE_KIND_LABEL[e.kind],
    formatBRL(e.amount),
    formatDateBR(e.dueDate),
    EXPENSE_STATUS_LABEL[e.status],
  ])
  return [EXPENSES_HEADER, ...rows]
}
