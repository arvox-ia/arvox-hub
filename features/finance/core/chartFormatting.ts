/**
 * Formatação compacta de moeda pros eixos do `ProjectionChart` (Task 9). Sem
 * I/O. Separado de `dashboardMetrics.ts` (agregações) porque é puramente
 * apresentação — mas mesmo assim ganha teste, por não ser "trivial" o
 * bastante pra ficar inline no componente (achado de revisão: estava
 * hand-rolled dentro de `ProjectionChart.tsx`, fora de qualquer helper
 * testado — `formatBRL`, o formatador "oficial" do app, não cabe no eixo Y
 * por extenso, daí a necessidade de uma versão compacta separada).
 */

/**
 * `R$ 12k` / `R$ 1,2M` — versão compacta de `formatBRL` pro eixo Y do
 * gráfico de projeção, que não tem espaço pra moeda por extenso.
 *
 * @example
 * ```typescript
 * formatCompactBRL(1500)      // 'R$ 2k' (arredondado, sem casas)
 * formatCompactBRL(2_500_000) // 'R$ 2,5M'
 * formatCompactBRL(-500)      // '-R$ 500' (negativo preserva o sinal antes do R$)
 * ```
 */
export function formatCompactBRL(value: number): string {
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${sign}R$ ${(abs / 1_000_000).toFixed(1).replace('.', ',')}M`;
  if (abs >= 1_000) return `${sign}R$ ${(abs / 1_000).toFixed(0)}k`;
  return `${sign}R$ ${abs.toFixed(0)}`;
}
