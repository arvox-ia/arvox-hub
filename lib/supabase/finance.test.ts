import { describe, expect, it } from 'vitest';
import { periodToDateRange } from './finance';

describe('periodToDateRange', () => {
  it('retorna o primeiro e o último dia de um mês de 31 dias', () => {
    expect(periodToDateRange('2026-01')).toEqual({ start: '2026-01-01', end: '2026-01-31' });
  });

  it('retorna o último dia correto para fevereiro não-bissexto', () => {
    expect(periodToDateRange('2026-02')).toEqual({ start: '2026-02-01', end: '2026-02-28' });
  });

  it('retorna o último dia correto para fevereiro bissexto', () => {
    expect(periodToDateRange('2028-02')).toEqual({ start: '2028-02-01', end: '2028-02-29' });
  });

  it('retorna o último dia correto para um mês de 30 dias', () => {
    expect(periodToDateRange('2026-04')).toEqual({ start: '2026-04-01', end: '2026-04-30' });
  });

  it('preserva zero-padding do mês em ambas as pontas', () => {
    expect(periodToDateRange('2026-09')).toEqual({ start: '2026-09-01', end: '2026-09-30' });
  });
});
