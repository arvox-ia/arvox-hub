import { describe, expect, it } from 'vitest';
import {
  computeConfirmationToken,
  daysOverdue,
  formatCreateExpenseSummary,
  formatDateIsoToPtBr,
  formatMarkReceivablePaidSummary,
  formatMonthKeyPtBr,
  formatSetMonthlyGoalSummary,
  monthKeyToDateRange,
  round2,
  verifyConfirmationToken,
} from '@/lib/ai/financeToolsSummaries';

describe('round2', () => {
  it('arredonda para 2 casas evitando erro de ponto flutuante', () => {
    expect(round2(89.005)).toBe(89.01);
    expect(round2(10.1 + 0.2)).toBe(10.3);
  });
});

describe('formatMonthKeyPtBr', () => {
  it('converte yyyy-MM para "mês/ano"', () => {
    expect(formatMonthKeyPtBr('2026-11')).toBe('novembro/2026');
    expect(formatMonthKeyPtBr('2026-01')).toBe('janeiro/2026');
  });

  it('cai de volta na própria chave se não for parseável', () => {
    expect(formatMonthKeyPtBr('não-é-mês')).toBe('não-é-mês');
    expect(formatMonthKeyPtBr('2026-13')).toBe('2026-13');
  });
});

describe('formatDateIsoToPtBr', () => {
  it('converte yyyy-MM-dd para dd/mm/aaaa', () => {
    expect(formatDateIsoToPtBr('2026-11-05')).toBe('05/11/2026');
  });

  it('cai de volta na string original se malformada', () => {
    expect(formatDateIsoToPtBr('')).toBe('');
    expect(formatDateIsoToPtBr('não é uma data')).toBe('não é uma data');
  });
});

describe('monthKeyToDateRange', () => {
  it('retorna primeiro e último dia do mês', () => {
    expect(monthKeyToDateRange('2026-02')).toEqual({ start: '2026-02-01', end: '2026-02-28' });
  });

  it('trata ano bissexto corretamente', () => {
    expect(monthKeyToDateRange('2028-02')).toEqual({ start: '2028-02-01', end: '2028-02-29' });
  });
});

describe('daysOverdue', () => {
  it('calcula dias de atraso', () => {
    expect(daysOverdue('2026-08-01', '2026-08-10')).toBe(9);
  });

  it('nunca retorna negativo (vencimento futuro)', () => {
    expect(daysOverdue('2026-08-20', '2026-08-10')).toBe(0);
  });

  it('vencimento igual a hoje é 0 dias de atraso', () => {
    expect(daysOverdue('2026-08-10', '2026-08-10')).toBe(0);
  });
});

describe('formatCreateExpenseSummary', () => {
  it('formata despesa fixa', () => {
    const summary = formatCreateExpenseSummary({
      description: 'Ferramentas & APIs',
      category: 'Ferramentas & APIs',
      amount: 89,
      kind: 'FIXED',
      dueDay: 10,
      dueDate: null,
    });
    expect(summary).toBe('Confirma lançar R$ 89,00 — Ferramentas & APIs (Ferramentas & APIs) — fixa, todo dia 10?');
  });

  it('formata despesa pontual', () => {
    const summary = formatCreateExpenseSummary({
      description: 'Contador',
      category: 'Terceiros',
      amount: 350,
      kind: 'ONE_TIME',
      dueDay: null,
      dueDate: '2026-09-15',
    });
    expect(summary).toContain('pontual, vencendo em 15/09/2026');
  });
});

describe('formatMarkReceivablePaidSummary', () => {
  it('inclui o nome do cliente quando disponível', () => {
    const summary = formatMarkReceivablePaidSummary({
      receivableId: 'r1',
      amount: 1500,
      description: 'Mensalidade',
      dueDate: '2026-11-05',
      clientName: 'Acme Ltda',
    });
    expect(summary).toContain('de Acme Ltda');
    expect(summary).toContain('vencimento 05/11/2026');
  });

  it('omite o cliente quando ausente', () => {
    const summary = formatMarkReceivablePaidSummary({
      receivableId: 'r1',
      amount: 1500,
      description: 'Mensalidade',
      dueDate: '2026-11-05',
      clientName: null,
    });
    expect(summary).not.toContain(' de ,');
    expect(summary).toContain('Mensalidade');
  });
});

describe('formatSetMonthlyGoalSummary', () => {
  it('formata a meta com mês por extenso', () => {
    const summary = formatSetMonthlyGoalSummary({ month: '2026-11', targetValue: 15000 });
    expect(summary).toContain('novembro/2026');
    expect(summary).toContain('R$ 15.000,00');
  });
});

describe('computeConfirmationToken / verifyConfirmationToken', () => {
  it('é determinístico para o mesmo payload', () => {
    const a = computeConfirmationToken('createExpense', { amount: 89, description: 'x' });
    const b = computeConfirmationToken('createExpense', { amount: 89, description: 'x' });
    expect(a).toBe(b);
  });

  it('é independente da ordem das chaves do payload', () => {
    const a = computeConfirmationToken('createExpense', { amount: 89, description: 'x' });
    const b = computeConfirmationToken('createExpense', { description: 'x', amount: 89 });
    expect(a).toBe(b);
  });

  it('muda se qualquer campo do payload mudar', () => {
    const a = computeConfirmationToken('createExpense', { amount: 89, description: 'x' });
    const b = computeConfirmationToken('createExpense', { amount: 90, description: 'x' });
    expect(a).not.toBe(b);
  });

  it('muda se o "kind" (nome da operação) mudar, mesmo com o mesmo payload', () => {
    const a = computeConfirmationToken('createExpense', { amount: 89 });
    const b = computeConfirmationToken('markReceivablePaid', { amount: 89 });
    expect(a).not.toBe(b);
  });

  it('verifyConfirmationToken aceita o token gerado para o mesmo payload', () => {
    const payload = { receivableId: 'abc-123', amount: 1500 };
    const token = computeConfirmationToken('markReceivablePaid', payload);
    expect(verifyConfirmationToken('markReceivablePaid', payload, token)).toBe(true);
  });

  it('verifyConfirmationToken recusa quando um campo foi alterado após o prepare (deriva do modelo)', () => {
    const payload = { receivableId: 'abc-123', amount: 1500 };
    const token = computeConfirmationToken('markReceivablePaid', payload);
    expect(verifyConfirmationToken('markReceivablePaid', { ...payload, amount: 1501 }, token)).toBe(false);
  });

  it('verifyConfirmationToken recusa um token inventado', () => {
    const payload = { receivableId: 'abc-123', amount: 1500 };
    expect(verifyConfirmationToken('markReceivablePaid', payload, 'token-chutado-pelo-modelo')).toBe(false);
  });
});
