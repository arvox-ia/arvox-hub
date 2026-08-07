import { describe, expect, it } from 'vitest'
import { parseDealFinanceFields } from './dealFields'

describe('parseDealFinanceFields — ausência/tipo errado do container', () => {
  it('customFields undefined → defaults', () => {
    const out = parseDealFinanceFields(undefined)
    expect(out).toEqual({ monthlyValue: 0, durationMonths: 6, expectedClose: null })
  })

  it('customFields null → defaults', () => {
    expect(parseDealFinanceFields(null)).toEqual({ monthlyValue: 0, durationMonths: 6, expectedClose: null })
  })

  it('customFields array → defaults (não é um record)', () => {
    expect(parseDealFinanceFields([1, 2, 3])).toEqual({ monthlyValue: 0, durationMonths: 6, expectedClose: null })
  })

  it('customFields string/número → defaults', () => {
    expect(parseDealFinanceFields('oops')).toEqual({ monthlyValue: 0, durationMonths: 6, expectedClose: null })
    expect(parseDealFinanceFields(42)).toEqual({ monthlyValue: 0, durationMonths: 6, expectedClose: null })
  })

  it('objeto vazio → defaults', () => {
    expect(parseDealFinanceFields({})).toEqual({ monthlyValue: 0, durationMonths: 6, expectedClose: null })
  })

  it('chaves ausentes (outros custom fields presentes) → defaults', () => {
    expect(parseDealFinanceFields({ outraCoisa: 'valor' })).toEqual({
      monthlyValue: 0,
      durationMonths: 6,
      expectedClose: null,
    })
  })
})

describe('parseDealFinanceFields — valores numéricos diretos (escrita via API/IA)', () => {
  it('valorMensal e duracaoMeses como number, previsaoFechamento ISO válida', () => {
    const out = parseDealFinanceFields({
      valorMensal: 1500,
      duracaoMeses: 12,
      previsaoFechamento: '2026-09-01',
    })
    expect(out).toEqual({ monthlyValue: 1500, durationMonths: 12, expectedClose: '2026-09-01' })
  })
})

describe('parseDealFinanceFields — valores como string (digitação real via <input>)', () => {
  it('valorMensal e duracaoMeses como string numérica (formato nativo do <input type="number">)', () => {
    const out = parseDealFinanceFields({ valorMensal: '1500', duracaoMeses: '12' })
    expect(out.monthlyValue).toBe(1500)
    expect(out.durationMonths).toBe(12)
  })

  it('valorMensal com casas decimais em string', () => {
    const out = parseDealFinanceFields({ valorMensal: '899.90' })
    expect(out.monthlyValue).toBe(899.9)
  })

  it('valorMensal com vírgula decimal (digitação manual pt-BR fora do <input>)', () => {
    const out = parseDealFinanceFields({ valorMensal: '899,90' })
    expect(out.monthlyValue).toBe(899.9)
  })

  it('valorMensal com espaços em volta', () => {
    const out = parseDealFinanceFields({ valorMensal: '  800  ' })
    expect(out.monthlyValue).toBe(800)
  })

  it('valorMensal string vazia → default (campo limpo pelo usuário)', () => {
    const out = parseDealFinanceFields({ valorMensal: '' })
    expect(out.monthlyValue).toBe(0)
  })
})

describe('parseDealFinanceFields — desambiguação de ponto/vírgula (achado da revisão pós-deploy)', () => {
  it('"1.500" (só ponto, grupo de 3 dígitos) → separador de milhar, não decimal', () => {
    expect(parseDealFinanceFields({ valorMensal: '1.500' }).monthlyValue).toBe(1500)
  })

  it('"1.500.000" (múltiplos pontos de milhar) → 1500000', () => {
    expect(parseDealFinanceFields({ valorMensal: '1.500.000' }).monthlyValue).toBe(1500000)
  })

  it('"1.5" (só ponto, grupo de 1 dígito) → decimal, não milhar', () => {
    expect(parseDealFinanceFields({ valorMensal: '1.5' }).monthlyValue).toBe(1.5)
  })

  it('"1500.50" (só ponto, grupo de 2 dígitos) → decimal', () => {
    expect(parseDealFinanceFields({ valorMensal: '1500.50' }).monthlyValue).toBe(1500.5)
  })

  it('"1.500,00" (formato pt-BR completo: ponto de milhar + vírgula decimal) → 1500', () => {
    expect(parseDealFinanceFields({ valorMensal: '1.500,00' }).monthlyValue).toBe(1500)
  })

  it('"899,90" (só vírgula) → decimal, 899.9', () => {
    expect(parseDealFinanceFields({ valorMensal: '899,90' }).monthlyValue).toBe(899.9)
  })

  it('"R$ 1.500" (prefixo de moeda) → não tenta adivinhar símbolo, cai no default conservador', () => {
    expect(parseDealFinanceFields({ valorMensal: 'R$ 1.500' }).monthlyValue).toBe(0)
  })
})

describe('parseDealFinanceFields — valores malformados', () => {
  it('valorMensal não-numérico → default', () => {
    expect(parseDealFinanceFields({ valorMensal: 'abc' }).monthlyValue).toBe(0)
  })

  it('valorMensal NaN/Infinity → default', () => {
    expect(parseDealFinanceFields({ valorMensal: NaN }).monthlyValue).toBe(0)
    expect(parseDealFinanceFields({ valorMensal: Infinity }).monthlyValue).toBe(0)
    expect(parseDealFinanceFields({ valorMensal: -Infinity }).monthlyValue).toBe(0)
  })

  it('valorMensal negativo → default (não deflaciona a curva com lixo)', () => {
    expect(parseDealFinanceFields({ valorMensal: -100 }).monthlyValue).toBe(0)
  })

  it('valorMensal boolean/objeto → default', () => {
    expect(parseDealFinanceFields({ valorMensal: true }).monthlyValue).toBe(0)
    expect(parseDealFinanceFields({ valorMensal: { x: 1 } }).monthlyValue).toBe(0)
  })

  it('duracaoMeses negativo ou zero → default', () => {
    expect(parseDealFinanceFields({ duracaoMeses: -3 }).durationMonths).toBe(6)
    expect(parseDealFinanceFields({ duracaoMeses: 0 }).durationMonths).toBe(6)
    expect(parseDealFinanceFields({ duracaoMeses: '0' }).durationMonths).toBe(6)
  })

  it('duracaoMeses fracionário arredonda para o inteiro mais próximo (mínimo 1, nunca 0)', () => {
    expect(parseDealFinanceFields({ duracaoMeses: 3.5 }).durationMonths).toBe(4)
    // 0.4 é > 0 (passa o guard de positividade) mas arredondaria pra 0 — o
    // clamp em Math.max(1, ...) garante que nunca vira uma duração de 0 meses.
    expect(parseDealFinanceFields({ duracaoMeses: 0.4 }).durationMonths).toBe(1)
  })

  it('previsaoFechamento fora do formato ISO → null', () => {
    expect(parseDealFinanceFields({ previsaoFechamento: '10/05/2026' }).expectedClose).toBeNull()
    expect(parseDealFinanceFields({ previsaoFechamento: '2026-13-40' }).expectedClose).toBe('2026-13-40') // regex só valida formato, não calendário — ver nota abaixo
  })

  it('previsaoFechamento não-string (número, null) → null', () => {
    expect(parseDealFinanceFields({ previsaoFechamento: 20260901 }).expectedClose).toBeNull()
    expect(parseDealFinanceFields({ previsaoFechamento: null }).expectedClose).toBeNull()
  })

  it('previsaoFechamento string vazia → null', () => {
    expect(parseDealFinanceFields({ previsaoFechamento: '' }).expectedClose).toBeNull()
  })
})

describe('parseDealFinanceFields — valores absurdos (não há teto artificial)', () => {
  it('valorMensal muito grande porém finito é aceito (deal grande é dado real, não erro)', () => {
    expect(parseDealFinanceFields({ valorMensal: 999999999 }).monthlyValue).toBe(999999999)
  })

  it('duracaoMeses muito grande é aceito (arredondado)', () => {
    expect(parseDealFinanceFields({ duracaoMeses: 240 }).durationMonths).toBe(240)
  })
})
