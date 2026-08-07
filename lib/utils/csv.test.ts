import { describe, expect, it } from 'vitest';
import { detectCsvDelimiter, parseCsv, stringifyCsv } from './csv';

describe('csv utils', () => {
  it('detects delimiter from header line', () => {
    expect(detectCsvDelimiter('a,b,c\n1,2,3')).toBe(',');
    expect(detectCsvDelimiter('a;b;c\n1;2;3')).toBe(';');
    expect(detectCsvDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t');
  });

  it('parses quoted fields and escaped quotes', () => {
    const input = 'name,email\n"João ""Test""",joao@x.com\n';
    const { headers, rows } = parseCsv(input, ',');
    expect(headers).toEqual(['name', 'email']);
    expect(rows).toEqual([['João "Test"', 'joao@x.com']]);
  });

  it('stringifies and roundtrips basic CSV', () => {
    const rows = [
      ['name', 'notes'],
      ['Alice', 'hello, world'],
      ['Bob', 'line1\nline2'],
    ];
    const csv = stringifyCsv(rows, ',');
    const parsed = parseCsv(csv, ',');
    expect([parsed.headers, ...parsed.rows]).toEqual(rows);
  });

  it('neutraliza injeção de fórmula CSV prefixando célula com apóstrofo', () => {
    const rows = [
      ['=cmd|\' /C calc\'!A0', '+1+1', '-1+1', '@SUM(A1)', 'texto normal'],
    ];
    const csv = stringifyCsv(rows, ',');
    // Cada célula perigosa ganha um apóstrofo à frente (dentro das aspas, já que o
    // conteúdo original também contém vírgula/aspas que forçam quoting).
    expect(csv).toContain("'=cmd|");
    expect(csv).toContain("'+1+1");
    expect(csv).toContain("'-1+1");
    expect(csv).toContain("'@SUM(A1)");
    // Texto que não começa com =, +, -, @ não é alterado.
    expect(csv).toContain('texto normal');
    expect(csv).not.toContain("'texto normal");
  });
});

