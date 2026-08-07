/**
 * @fileoverview Idempotência de `confirmCreateExpense` (achado da revisão da Task 11):
 * diferente de `confirmMarkReceivablePaid` (a revalidação já vê `status != PENDING` numa
 * segunda chamada) e `confirmSetMonthlyGoal` (upsert), `confirmCreateExpense` fazia um
 * INSERT incondicional — um retry do modelo, um retry de rede, ou o usuário dizendo
 * "confirma" duas vezes criava duas despesas idênticas, sem caminho de exclusão na UI
 * para limpar. Este teste cobre o guard: antes de inserir, `confirmCreateExpense` procura
 * uma despesa não deletada da mesma org com a mesma description+amount+kind+(dueDay|dueDate)
 * criada nos últimos ~2 minutos; se achar, devolve a mensagem "já existe" (com o id) em vez
 * de inserir de novo.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/** Builder chainable genérico: todo método intermediário devolve `this`; os terminais (`single`/`maybeSingle`) resolvem para `result`. */
function makeChainableBuilder(result: { data: any; error: any }) {
  const builder: any = {}
  const chainMethods = ['select', 'insert', 'update', 'eq', 'is', 'ilike', 'or', 'gte', 'lte', 'order', 'limit']
  for (const method of chainMethods) {
    builder[method] = vi.fn(() => builder)
  }
  builder.maybeSingle = vi.fn(async () => result)
  builder.single = vi.fn(async () => result)
  return builder
}

let financeExpensesCallCount = 0
let dedupeResult: { data: any; error: any }
let insertResult: { data: any; error: any }
let fromMock: ReturnType<typeof vi.fn>

vi.mock('@/lib/supabase/staticAdminClient', () => ({
  createStaticAdminClient: () => ({ from: fromMock }),
}))

import { createFinanceTools } from '@/lib/ai/financeTools'
import { computeConfirmationToken } from '@/lib/ai/financeToolsSummaries'

const ORGANIZATION_ID = '11111111-1111-1111-1111-111111111111'
const ORIGINAL_SECRET = process.env.INTERNAL_API_SECRET

beforeEach(() => {
  vi.clearAllMocks()
  financeExpensesCallCount = 0
  process.env.INTERNAL_API_SECRET = 'segredo-de-teste-nao-usar-em-producao'

  fromMock = vi.fn((table: string) => {
    if (table === 'finance_expenses') {
      financeExpensesCallCount++
      // 1ª chamada de finance_expenses = checagem de idempotência (dedupeResult);
      // 2ª chamada (só ocorre quando não há duplicata) = o INSERT em si (insertResult).
      return financeExpensesCallCount === 1 ? makeChainableBuilder(dedupeResult) : makeChainableBuilder(insertResult)
    }
    throw new Error(`Unexpected table: ${table}`)
  })
})

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) {
    delete process.env.INTERNAL_API_SECRET
  } else {
    process.env.INTERNAL_API_SECRET = ORIGINAL_SECRET
  }
})

const resolvedExpense = {
  description: 'Ferramentas & APIs',
  category: 'Ferramentas & APIs',
  amount: 89,
  kind: 'FIXED' as const,
  dueDay: 10,
  dueDate: null as string | null,
}

function buildConfirmInput() {
  const confirmationToken = computeConfirmationToken('createExpense', {
    description: resolvedExpense.description,
    category: resolvedExpense.category,
    amount: resolvedExpense.amount,
    kind: resolvedExpense.kind,
    dueDay: resolvedExpense.dueDay,
    dueDate: resolvedExpense.dueDate,
  })
  return { ...resolvedExpense, confirmationToken }
}

describe('confirmCreateExpense — idempotência', () => {
  it('cria a despesa quando não há duplicata recente', async () => {
    dedupeResult = { data: null, error: null }
    insertResult = {
      data: { id: 'exp-novo', description: resolvedExpense.description, amount: resolvedExpense.amount },
      error: null,
    }

    const tools = createFinanceTools({ organizationId: ORGANIZATION_ID }, 'user-1')
    const res: any = await tools.confirmCreateExpense.execute(buildConfirmInput())

    expect(res.success).toBe(true)
    expect(res.alreadyExists).toBeUndefined()
    expect(res.expenseId).toBe('exp-novo')
    // 2 chamadas em finance_expenses: 1 checagem de idempotência + 1 insert de fato.
    expect(financeExpensesCallCount).toBe(2)
  })

  it('NÃO cria uma segunda despesa quando já existe uma idêntica lançada há pouco (retry do modelo/rede/usuário)', async () => {
    dedupeResult = {
      data: {
        id: 'exp-existente',
        description: resolvedExpense.description,
        amount: resolvedExpense.amount,
        created_at: new Date().toISOString(),
      },
      error: null,
    }
    // Não deveria nem ser lido — se o guard falhar e cair no insert, isto tornaria o teste óbvio no diff.
    insertResult = {
      data: { id: 'exp-duplicado-nao-deveria-existir', description: resolvedExpense.description, amount: resolvedExpense.amount },
      error: null,
    }

    const tools = createFinanceTools({ organizationId: ORGANIZATION_ID }, 'user-1')
    const res: any = await tools.confirmCreateExpense.execute(buildConfirmInput())

    expect(res.success).toBe(true)
    expect(res.alreadyExists).toBe(true)
    expect(res.expenseId).toBe('exp-existente')
    expect(String(res.message)).toContain('já foi lançada')
    // Só a checagem de idempotência rodou — nenhum insert foi tentado.
    expect(financeExpensesCallCount).toBe(1)
  })

  it('token de confirmação inválido continua barrando ANTES de qualquer checagem de duplicata', async () => {
    dedupeResult = { data: null, error: null }
    insertResult = { data: { id: 'exp-novo' }, error: null }

    const tools = createFinanceTools({ organizationId: ORGANIZATION_ID }, 'user-1')
    const res: any = await tools.confirmCreateExpense.execute({ ...buildConfirmInput(), confirmationToken: 'token-invalido' })

    expect(res.error).toBeTruthy()
    expect(financeExpensesCallCount).toBe(0)
  })
})

afterAll(() => {
  if (ORIGINAL_SECRET === undefined) {
    delete process.env.INTERNAL_API_SECRET
  } else {
    process.env.INTERNAL_API_SECRET = ORIGINAL_SECRET
  }
})
