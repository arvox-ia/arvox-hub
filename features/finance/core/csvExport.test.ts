import { describe, expect, it } from 'vitest'
import { buildContractsCsvRows, buildExpensesCsvRows, buildReceivablesCsvRows, formatDateBR } from './csvExport'
import { stringifyCsv, withUtf8Bom } from '@/lib/utils/csv'
import { formatBRL } from '@/lib/utils/currency'

describe('formatDateBR', () => {
  it('formata yyyy-MM-dd como dd/MM/yyyy', () => {
    expect(formatDateBR('2026-03-05')).toBe('05/03/2026')
  })
})

describe('buildContractsCsvRows', () => {
  it('gera cabeçalho + uma linha por contrato, com duração indeterminada tratada', () => {
    const rows = buildContractsCsvRows([
      {
        contactName: 'Cliente A',
        description: 'Consultoria',
        setupValue: 1000,
        setupInstallments: 2,
        monthlyValue: 500,
        startDate: '2026-01-01',
        durationMonths: 12,
        billingDay: 5,
        status: 'ACTIVE',
      },
      {
        contactName: 'Cliente B',
        description: '',
        setupValue: 0,
        setupInstallments: 1,
        monthlyValue: 300,
        startDate: '2026-02-01',
        durationMonths: null,
        billingDay: 10,
        status: 'ENDED',
      },
    ])

    expect(rows[0]).toEqual([
      'Contato',
      'Descrição',
      'Valor de setup',
      'Parcelas de setup',
      'Mensalidade',
      'Início',
      'Duração (meses)',
      'Dia de cobrança',
      'Status',
    ])
    expect(rows[1][0]).toBe('Cliente A')
    expect(rows[1][6]).toBe('12')
    expect(rows[2][6]).toBe('Indeterminado')
  })
})

describe('buildReceivablesCsvRows', () => {
  it('traduz kind e status para pt-BR', () => {
    const rows = buildReceivablesCsvRows([
      { contactName: 'Cliente A', kind: 'SETUP', description: 'Parcela 1/2', amount: 500, dueDate: '2026-01-05', status: 'PAID' },
      { contactName: 'Cliente A', kind: 'MONTHLY', description: 'Mensalidade', amount: 300, dueDate: '2026-02-05', status: 'PENDING' },
    ])

    expect(rows[1]).toEqual(['Cliente A', 'Setup', 'Parcela 1/2', formatBRL(500), '05/01/2026', 'Pago'])
    expect(rows[2][1]).toBe('Mensalidade')
    expect(rows[2][5]).toBe('Pendente')
  })
})

describe('buildExpensesCsvRows', () => {
  it('traduz kind e status para pt-BR', () => {
    const rows = buildExpensesCsvRows([
      { description: 'Vercel', category: 'Ferramentas & APIs', kind: 'FIXED', amount: 100, dueDate: '2026-01-28', status: 'PENDING' },
      { description: 'Notário', category: 'Outros', kind: 'ONE_TIME', amount: 250, dueDate: '2026-03-15', status: 'PAID' },
    ])

    expect(rows[1]).toEqual(['Vercel', 'Ferramentas & APIs', 'Fixa mensal', formatBRL(100), '28/01/2026', 'Pendente'])
    expect(rows[2][2]).toBe('Pontual')
    expect(rows[2][5]).toBe('Pago')
  })

  it('lista vazia gera só o cabeçalho', () => {
    const rows = buildExpensesCsvRows([])
    expect(rows).toHaveLength(1)
  })
})

describe('pipeline completo (build*CsvRows → stringifyCsv(;) → withUtf8Bom)', () => {
  it('serializa com separador ; e BOM, sem quebrar valores em BRL (que usam , como decimal)', () => {
    const rows = buildExpensesCsvRows([
      { description: 'Vercel; Pro', category: 'Ferramentas & APIs', kind: 'FIXED', amount: 1234.5, dueDate: '2026-01-28', status: 'PENDING' },
    ])
    const csv = withUtf8Bom(stringifyCsv(rows, ';'))

    expect(csv.charCodeAt(0)).toBe(0xfeff)
    // Descrição com ; interno precisa ficar entre aspas para não virar coluna extra.
    expect(csv).toContain('"Vercel; Pro"')
    // formatBRL usa vírgula decimal (e espaço NBSP após "R$") — o valor não pode ser
    // quebrado pelo separador ;. Comparação via formatBRL (não string literal) porque
    // Intl.NumberFormat pt-BR usa U+00A0, não um espaço comum, entre "R$" e o número.
    expect(csv).toContain(formatBRL(1234.5))
  })
})
