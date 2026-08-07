/**
 * Disparo de download de arquivo de texto no navegador (Blob + link
 * temporário). Impuro (DOM) — deliberadamente fora de qualquer `core/*`
 * puro; sem teste unitário por ser só glue de browser API, sem lógica.
 */
export function downloadTextFile(filename: string, content: string, mimeType = 'text/csv;charset=utf-8'): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
