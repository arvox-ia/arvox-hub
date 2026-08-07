/**
 * Núcleo puro de parsing dos campos financeiros de um deal (Fase 1B, Task
 * 10). Sem I/O, sem `Date.now()` — só transforma o `custom_fields` (JSONB)
 * cru de um deal no shape numérico/data que o pipeline (`./pipeline.ts`) e o
 * fluxo de "importar de deal ganho" (`ContractsTab`) esperam.
 *
 * ## Convenção de chaves (achado da Task 10 — desvio do plano original)
 *
 * O plano sugeria chaves snake_case prefixadas (`finance_monthly_value` etc).
 * A convenção REAL do repo é outra: `custom_field_definitions` (a tabela do
 * schema) nunca é lida por lugar nenhum do app — grep confirma zero
 * call-sites. Quem alimenta o formulário de campos personalizados do deal
 * (`features/boards/components/Modals/DealDetailModal.tsx`) é
 * `useSettingsController` (`features/settings/hooks/useSettingsController.ts`),
 * que guarda `customFieldDefinitions` em `localStorage` via `usePersistedState`
 * (chave `crm_custom_fields`) — código com `// TODO: Migrate ... to Supabase`
 * explícito. A `key` de cada campo é gerada a partir do LABEL digitado pelo
 * usuário (camelCase automático, ver `useSettingsController.ts` função
 * `handleSaveField`), e o VALOR salvo em `deal.customFields[key]` é sempre
 * uma STRING — `<input type={field.type} onChange={e =>
 * updateCustomField(field.key, e.target.value)}>` em `DealDetailModal.tsx`,
 * e `e.target.value` de um `<input>` HTML é sempre string, mesmo com
 * `type="number"`. Isso inclusive invalidava a checagem `typeof === 'number'`
 * da Task 9 pra qualquer valor digitado de verdade pela UI (só funcionava
 * pra dados sintéticos de teste ou escrita direta via API/IA).
 *
 * Este módulo é a ÚNICA fonte de verdade da convenção. As 3 chaves e seus
 * tipos (definidos como labels ASCII de propósito — caracteres acentuados
 * quebram o gerador de key da UI, que usa `\w` do regex do JS, e esse não
 * casa com acentos):
 *
 * | key                    | label (Configurações)  | tipo do campo |
 * |-------------------------|-------------------------|---------------|
 * | `valorMensal`           | "Valor Mensal"          | number        |
 * | `duracaoMeses`          | "Duracao Meses"         | number        |
 * | `previsaoFechamento`    | "Previsao Fechamento"   | date          |
 *
 * ## Defaults (conservadores por design)
 *
 * Uma curva provável inflada é a direção perigosa (superestimar receita
 * futura leva a decisão de caixa ruim) — por isso todo default aqui é o
 * valor que MENOS contribui pra curva provável, nunca uma média otimista:
 * - `monthlyValue` ausente/malformado → `0` (não soma nada de mensalidade).
 * - `durationMonths` ausente/malformado/não-positivo → `6` (decisão já
 *   fixada na Task 9 — um horizonte moderado, não o mínimo de 1 mês nem um
 *   valor alto; mantido aqui para não regredir o comportamento já em
 *   produção nem os testes que dependem dele).
 * - `expectedClose` ausente/malformado → `null` (o pipeline, `weightDeals`,
 *   já sabe cair em `today + defaultCloseDays` nesse caso — não duplicamos
 *   essa regra aqui).
 *
 * Não há teto superior artificial para `monthlyValue`/`durationMonths`: um
 * valor grande porém finito e positivo é um dado real (deal grande), não um
 * erro — só valores não-finitos (`NaN`/`Infinity`), negativos ou
 * não-numéricos caem no default.
 */

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Mensalidade assumida quando o deal não tem `valorMensal` numérico válido. */
const DEFAULT_MONTHLY_VALUE = 0
/** Duração assumida quando o deal não tem `duracaoMeses` numérico válido > 0. */
const DEFAULT_DURATION_MONTHS = 6

/** Resultado parseado dos 3 campos financeiros de um deal. */
export interface DealFinanceFields {
  monthlyValue: number
  durationMonths: number
  expectedClose: string | null
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Converte um valor cru (número, string numérica — inclusive digitação
 * manual pt-BR — ou qualquer outra coisa) num número finito, ou `null` se
 * não for um número válido. Nunca lança.
 *
 * ## Desambiguação de string (achado da revisão pós-deploy)
 *
 * `<input type="number">` sempre usa `.` como separador decimal (formato
 * canônico do value do DOM, independente do locale do navegador) — mas
 * texto digitado fora desse input (API/IA, ou copiar/colar de outro lugar)
 * pode vir em qualquer um dos formatos abaixo. A ambiguidade real é só o
 * caso "só ponto, sem vírgula": `"1.500"` pode ser 1500 (separador de
 * milhar, o mais natural pra um brasileiro digitar) ou 1.5 (decimal). Bug
 * corrigido aqui: a versão anterior sempre tratava esse caso como decimal,
 * então `"1.500"` virava silenciosamente `1.5` — 1000× menor, sem erro
 * visível, distorcendo a curva provável pra baixo.
 *
 * Regra de desambiguação (só entra em jogo quando há `.` e NÃO há `,`):
 * o grupo de dígitos IMEDIATAMENTE APÓS O ÚLTIMO PONTO tem exatamente 3
 * dígitos → todo `.` é separador de milhar, remove todos (`"1.500"` → 1500,
 * `"1.500.000"` → 1500000). Caso contrário → o único uso de `.` é decimal,
 * mantém como está (`"1.5"` → 1.5, `"1500.50"` → 1500.5).
 *
 * Quando a string tem `,`: se também tem `.`, assume-se o formato completo
 * pt-BR (`.` = milhar, `,` = decimal — `"1.500,00"` → 1500); se só tem `,`,
 * ela é o separador decimal (`"899,90"` → 899.9). Prefixos não-numéricos
 * (`"R$ 1.500"`) continuam falhando o parse e caindo no default
 * conservador — não tentamos adivinhar símbolo de moeda.
 */
function toFiniteNumber(raw: unknown): number | null {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : null
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (trimmed === '') return null

    const hasComma = trimmed.includes(',')
    const hasDot = trimmed.includes('.')

    let normalized: string
    if (hasComma && hasDot) {
      // Formato pt-BR completo: '.' = milhar, ',' = decimal.
      normalized = trimmed.replace(/\./g, '').replace(',', '.')
    } else if (hasComma) {
      // Só vírgula: separador decimal pt-BR.
      normalized = trimmed.replace(',', '.')
    } else if (hasDot) {
      // Só ponto: milhar se o grupo após o ÚLTIMO ponto tem 3 dígitos, senão decimal.
      const lastGroup = trimmed.slice(trimmed.lastIndexOf('.') + 1)
      normalized = /^\d{3}$/.test(lastGroup) ? trimmed.replace(/\./g, '') : trimmed
    } else {
      normalized = trimmed
    }

    const n = Number(normalized)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/**
 * Parseia `deal.customFields` (JSONB cru, tipo `unknown` porque nunca
 * confiamos no shape vindo do banco) para os 3 campos financeiros que o
 * pipeline ponderado e o fluxo de "importar de deal ganho" precisam.
 * Defensivo contra qualquer entrada — ausente, string, malformada, tipo
 * errado, `null`/`undefined` — nunca lança, sempre cai num default são (ver
 * comentário de arquivo).
 */
export function parseDealFinanceFields(customFields: unknown): DealFinanceFields {
  const cf = isPlainRecord(customFields) ? customFields : {}

  const monthlyRaw = toFiniteNumber(cf.valorMensal)
  const monthlyValue = monthlyRaw !== null && monthlyRaw >= 0 ? monthlyRaw : DEFAULT_MONTHLY_VALUE

  const durationRaw = toFiniteNumber(cf.duracaoMeses)
  const durationMonths =
    durationRaw !== null && durationRaw > 0 ? Math.max(1, Math.round(durationRaw)) : DEFAULT_DURATION_MONTHS

  const expectedCloseRaw = typeof cf.previsaoFechamento === 'string' ? cf.previsaoFechamento.trim() : ''
  const expectedClose = ISO_DATE_RE.test(expectedCloseRaw) ? expectedCloseRaw : null

  return { monthlyValue, durationMonths, expectedClose }
}
