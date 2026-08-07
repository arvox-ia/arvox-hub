import { describe, expect, it } from 'vitest'
import {
  computeGoalProgressPct,
  computeMonthKpis,
  computeProbableTaxProvision,
  filterUpcoming,
} from './dashboardMetrics'
import type { ReceivableForMonthKpis, UpcomingItem } from './dashboardMetrics'

function makeReceivable(overrides: Partial<ReceivableForMonthKpis> = {}): ReceivableForMonthKpis {
  return {
    amount: 100,
    status: 'PENDING',
    dueDate: '2026-08-01',
    paidAt: null,
    ...overrides,
  }
}

describe('computeMonthKpis — recebido é por paidAt, não por dueDate', () => {
  it('cenário exato da revisão: recebível vencido em julho e pago em agosto conta como Recebido de agosto, nunca de julho', () => {
    // R1: venceu 15/07, pago 20/07 — pago em julho, fora do mês corrente (agosto).
    const r1 = makeReceivable({ amount: 100, status: 'PAID', dueDate: '2026-07-15', paidAt: '2026-07-20T12:00:00.000Z' })
    // R2: venceu 20/07, pago 03/08 — atrasado, mas pago EM AGOSTO.
    const r2 = makeReceivable({ amount: 200, status: 'PAID', dueDate: '2026-07-20', paidAt: '2026-08-03T09:00:00.000Z' })
    // R3: venceu 05/08, pago 05/08 — em dia, pago em agosto.
    const r3 = makeReceivable({ amount: 300, status: 'PAID', dueDate: '2026-08-05', paidAt: '2026-08-05T18:00:00.000Z' })
    // R4: vence 25/08, ainda pendente.
    const r4 = makeReceivable({ amount: 400, status: 'PENDING', dueDate: '2026-08-25', paidAt: null })
    // R5: venceu 10/06, ainda pendente (atrasado de meses atrás — não é "a receber" de agosto).
    const r5 = makeReceivable({ amount: 500, status: 'PENDING', dueDate: '2026-06-10', paidAt: null })

    const out = computeMonthKpis([r1, r2, r3, r4, r5], [], 0, '2026-08')

    expect(out.recebido).toBe(500) // R2 (200) + R3 (300) — pagos em agosto.
    expect(out.aReceber).toBe(400) // só R4 — pendente com vencimento em agosto.
  })

  it('recebível pago no mês corrente mas vencido em mês FUTURO (adiantamento) também conta como recebido', () => {
    const r = makeReceivable({ amount: 150, status: 'PAID', dueDate: '2026-09-01', paidAt: '2026-08-15T10:00:00.000Z' })
    const out = computeMonthKpis([r], [], 0, '2026-08')
    expect(out.recebido).toBe(150)
  })

  it('recebível PAID sem paidAt (dado inconsistente) não conta como recebido de nenhum mês', () => {
    const r = makeReceivable({ amount: 999, status: 'PAID', dueDate: '2026-08-01', paidAt: null })
    const out = computeMonthKpis([r], [], 0, '2026-08')
    expect(out.recebido).toBe(0)
  })
})

describe('computeMonthKpis — aReceber é só PENDING vencendo no mês', () => {
  it('recebível PAID vencendo no mês corrente NÃO conta como aReceber (já foi recebido, mesmo que noutro mês)', () => {
    const r = makeReceivable({ amount: 700, status: 'PAID', dueDate: '2026-08-10', paidAt: '2026-07-01T00:00:00.000Z' })
    const out = computeMonthKpis([r], [], 0, '2026-08')
    expect(out.aReceber).toBe(0)
  })

  it('soma todos os PENDING cujo dueDate cai no mês corrente', () => {
    const receivables = [
      makeReceivable({ amount: 400, status: 'PENDING', dueDate: '2026-08-05' }),
      makeReceivable({ amount: 600, status: 'PENDING', dueDate: '2026-08-28' }),
      makeReceivable({ amount: 999, status: 'PENDING', dueDate: '2026-09-01' }), // fora do mês
    ]
    const out = computeMonthKpis(receivables, [], 0, '2026-08')
    expect(out.aReceber).toBe(1000)
  })
})

describe('computeMonthKpis — despesas e resultado', () => {
  it('despesas soma todos os lançamentos do mês, independente de status', () => {
    const out = computeMonthKpis([], [{ amount: 200 }, { amount: 300 }], 0, '2026-08')
    expect(out.despesas).toBe(500)
  })

  it('resultado = recebido(paidAt) + aReceber(dueDate) - despesas - contractedProvision', () => {
    const receivables = [
      makeReceivable({ amount: 1000, status: 'PAID', dueDate: '2026-07-01', paidAt: '2026-08-01T00:00:00.000Z' }),
      makeReceivable({ amount: 500, status: 'PENDING', dueDate: '2026-08-20' }),
    ]
    const out = computeMonthKpis(receivables, [{ amount: 300 }], 150, '2026-08')
    // 1000 + 500 - 300 - 150 = 1050
    expect(out.resultado).toBe(1050)
  })

  it('entrada vazia → tudo zero', () => {
    const out = computeMonthKpis([], [], 0, '2026-08')
    expect(out).toEqual({ recebido: 0, aReceber: 0, despesas: 0, resultado: 0 })
  })

  it('arredonda pra 2 casas', () => {
    const out = computeMonthKpis(
      [makeReceivable({ amount: 10.005, status: 'PAID', paidAt: '2026-08-01T00:00:00.000Z' })],
      [],
      0,
      '2026-08'
    )
    expect(out.recebido).toBe(10.01)
  })
})

describe('computeProbableTaxProvision', () => {
  it('probable × taxRate/100 — mesma fórmula do core pra balanceProbable', () => {
    expect(computeProbableTaxProvision(1000, 10)) .toBe(100)
    expect(computeProbableTaxProvision(2500, 8.5)).toBe(212.5)
  })

  it('taxRate 0 → provisão 0', () => {
    expect(computeProbableTaxProvision(5000, 0)).toBe(0)
  })

  it('difere da provisão contratada quando probable > contracted (o caso do achado da revisão)', () => {
    const contracted = 1000
    const probable = 1500
    const taxRate = 10
    const contractedProvision = contracted * (taxRate / 100)
    const probableProvision = computeProbableTaxProvision(probable, taxRate)
    expect(probableProvision).not.toBe(contractedProvision)
    expect(probableProvision).toBe(150)
  })
})

function makeItem(overrides: Partial<UpcomingItem> = {}): UpcomingItem {
  return {
    id: '1',
    kind: 'RECEIVABLE',
    description: 'Item',
    amount: 100,
    dueDate: '2026-03-10',
    status: 'PENDING',
    ...overrides,
  }
}

describe('filterUpcoming — janela e status', () => {
  it('exclui itens PAID mesmo dentro da janela', () => {
    const items = [makeItem({ status: 'PAID' })]
    expect(filterUpcoming(items, '2026-03-01', 15)).toEqual([])
  })

  it('inclui item no limite superior da janela (today + windowDays)', () => {
    const items = [makeItem({ dueDate: '2026-03-16' })]
    const out = filterUpcoming(items, '2026-03-01', 15)
    expect(out).toHaveLength(1)
  })

  it('exclui item 1 dia além da janela', () => {
    const items = [makeItem({ dueDate: '2026-03-17' })]
    expect(filterUpcoming(items, '2026-03-01', 15)).toEqual([])
  })

  it('inclui item vencendo hoje', () => {
    const items = [makeItem({ dueDate: '2026-03-01' })]
    const out = filterUpcoming(items, '2026-03-01', 15)
    expect(out).toHaveLength(1)
    expect(out[0].isOverdue).toBe(false)
  })
})

describe('filterUpcoming — atrasados', () => {
  it('inclui atrasado mesmo muito antes de hoje (fora da janela)', () => {
    const items = [makeItem({ dueDate: '2025-01-01' })]
    const out = filterUpcoming(items, '2026-03-01', 15)
    expect(out).toHaveLength(1)
    expect(out[0].isOverdue).toBe(true)
  })

  it('ordena atrasados primeiro, depois a vencer — ambos por data crescente', () => {
    const items = [
      makeItem({ id: 'future-2', dueDate: '2026-03-10' }),
      makeItem({ id: 'overdue-2', dueDate: '2026-02-20' }),
      makeItem({ id: 'future-1', dueDate: '2026-03-05' }),
      makeItem({ id: 'overdue-1', dueDate: '2026-02-10' }),
    ]
    const out = filterUpcoming(items, '2026-03-01', 15).map(r => r.id)
    expect(out).toEqual(['overdue-1', 'overdue-2', 'future-1', 'future-2'])
  })
})

describe('filterUpcoming — entrada vazia', () => {
  it('sem itens → lista vazia', () => {
    expect(filterUpcoming([], '2026-03-01', 15)).toEqual([])
  })
})

describe('computeGoalProgressPct', () => {
  it('meta não definida (<=0) → 0, sem dividir por zero', () => {
    expect(computeGoalProgressPct(500, 0)).toBe(0)
    expect(computeGoalProgressPct(500, -10)).toBe(0)
  })

  it('realizado abaixo da meta → percentual proporcional', () => {
    expect(computeGoalProgressPct(2500, 10000)).toBe(25)
  })

  it('realizado acima da meta → clampa em 100', () => {
    expect(computeGoalProgressPct(15000, 10000)).toBe(100)
  })

  it('realizado 0 → 0', () => {
    expect(computeGoalProgressPct(0, 10000)).toBe(0)
  })
})
