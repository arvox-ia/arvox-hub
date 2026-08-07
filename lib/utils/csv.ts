/**
 * Minimal CSV utilities (no external deps).
 *
 * Goals:
 * - Works in browser + server (no Node-only APIs)
 * - Supports comma/semicolon/tab delimiters
 * - Supports quoted fields with escaped quotes ("")
 * - Tolerant to CRLF/LF and trailing newlines
 *
 * NOTE: This is intentionally small; for very large CSVs consider a streaming parser.
 */
export type CsvDelimiter = ',' | ';' | '\t';

/**
 * Função pública `detectCsvDelimiter` do projeto.
 *
 * @param {string} sample - Parâmetro `sample`.
 * @returns {CsvDelimiter} Retorna um valor do tipo `CsvDelimiter`.
 */
export function detectCsvDelimiter(sample: string): CsvDelimiter {
  const firstLine = (sample || '').split(/\r?\n/)[0] || '';
  const counts: Record<CsvDelimiter, number> = {
    ',': (firstLine.match(/,/g) || []).length,
    ';': (firstLine.match(/;/g) || []).length,
    '\t': (firstLine.match(/\t/g) || []).length,
  };
  // Prefer ; when tied with , (common in pt-BR Excel exports)
  const entries = (Object.entries(counts) as Array<[CsvDelimiter, number]>)
    .sort((a, b) => b[1] - a[1] || (a[0] === ';' ? -1 : 1));
  return entries[0][1] > 0 ? entries[0][0] : ',';
}

/**
 * Função pública `parseCsv` do projeto.
 *
 * @param {string} input - Parâmetro `input`.
 * @param {CsvDelimiter} delimiter - Parâmetro `delimiter`.
 * @returns {{ headers: string[]; rows: string[][]; }} Retorna um valor do tipo `{ headers: string[]; rows: string[][]; }`.
 */
export function parseCsv(input: string, delimiter: CsvDelimiter): { headers: string[]; rows: string[][] } {
  const text = (input ?? '').replace(/^\uFEFF/, ''); // strip UTF-8 BOM if present
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let i = 0;
  let inQuotes = false;

  const pushField = () => {
    row.push(field);
    field = '';
  };

  const pushRow = () => {
    // Remove trailing empty row caused by final newline
    const isAllEmpty = row.length === 1 && row[0] === '' && rows.length === 0;
    if (!isAllEmpty) rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        const next = text[i + 1];
        if (next === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }

    if (c === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }

    if (c === delimiter) {
      pushField();
      i += 1;
      continue;
    }

    if (c === '\n' || c === '\r') {
      // Handle CRLF
      if (c === '\r' && text[i + 1] === '\n') i += 2;
      else i += 1;

      pushField();
      pushRow();
      continue;
    }

    field += c;
    i += 1;
  }

  // Flush last field/row
  pushField();
  pushRow();

  const headers = (rows.shift() || []).map(h => (h ?? '').trim());
  const dataRows = rows
    .filter(r => r.some(cell => (cell ?? '').trim() !== ''))
    .map(r => r.map(cell => cell ?? ''));

  return { headers, rows: dataRows };
}

/** Caracteres que o Excel/Sheets interpretam como início de fórmula quando abrem um CSV. */
const FORMULA_INJECTION_PREFIXES = ['=', '+', '-', '@'];

/**
 * Neutraliza injeção de fórmula CSV (achado da revisão — OWASP "CSV Injection"):
 * uma célula de texto vinda de input do usuário (descrição, categoria, nome de
 * contato etc.) que comece com `=`, `+`, `-` ou `@` é interpretada como fórmula
 * ao abrir o arquivo no Excel/Sheets, podendo disparar `=cmd|...` ou puxar dados
 * externos. Prefixar com um apóstrofo força o programa a tratar o conteúdo como
 * texto literal, sem alterar o valor visível.
 */
function neutralizeFormulaInjection(value: string): string {
  return FORMULA_INJECTION_PREFIXES.includes(value.charAt(0)) ? `'${value}` : value;
}

function escapeCsvCell(value: string, delimiter: CsvDelimiter): string {
  const v = neutralizeFormulaInjection(value ?? '');
  const mustQuote = v.includes('"') || v.includes('\n') || v.includes('\r') || v.includes(delimiter);
  if (!mustQuote) return v;
  return `"${v.replace(/"/g, '""')}"`;
}

/**
 * Função pública `stringifyCsv` do projeto.
 *
 * @param {string[][]} rows - Parâmetro `rows`.
 * @param {CsvDelimiter} delimiter - Parâmetro `delimiter`.
 * @returns {string} Retorna um valor do tipo `string`.
 */
export function stringifyCsv(rows: string[][], delimiter: CsvDelimiter = ','): string {
  return rows
    .map(r => r.map(cell => escapeCsvCell(String(cell ?? ''), delimiter)).join(delimiter))
    .join('\n');
}

/**
 * Função pública `withUtf8Bom` do projeto.
 *
 * @param {string} text - Parâmetro `text`.
 * @returns {string} Retorna um valor do tipo `string`.
 */
export function withUtf8Bom(text: string): string {
  return `\uFEFF${text ?? ''}`;
}

