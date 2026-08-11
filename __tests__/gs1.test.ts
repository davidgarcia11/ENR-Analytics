/**
 * Tests del parser GS1-128 (lib/gs1.ts)
 *
 * Verifica que un código de barras de palet (que concatena SSCC, EAN, lote,
 * cantidad y fechas en una sola cadena) se separa correctamente en sus
 * campos logísticos, tanto en formato "crudo" (con separador FNC1/GS) como
 * en formato "legible" entre paréntesis.
 */
import { describe, it, expect } from 'bun:test'
import { parseGs1 } from '@/lib/gs1'

const GS = '\x1d'

describe('parseGs1', () => {
  it('separa SSCC, EAN (GTIN-14 tal cual, sin quitar el 0), lote, caducidad y cantidad', () => {
    const raw =
      '00' + '123456789012345675' + // SSCC (18 dígitos, fijo)
      '01' + '08412345678905' +     // GTIN-14 (fijo), se usa tal cual (Reflex lo guarda completo)
      '10' + 'LOTE123' + GS +       // Lote (variable, terminado en FNC1)
      '17' + '260315' +             // Caducidad (fijo, AAMMDD) → 2026-03-15
      '37' + '000012'               // Cantidad (variable, fin de cadena)

    const result = parseGs1(raw)
    expect(result.sscc).toBe('123456789012345675')
    expect(result.ean).toBe('08412345678905')
    expect(result.lote).toBe('LOTE123')
    expect(result.caducidad).toBe('2026-03-15')
    expect(result.cantidad).toBe(12)
  })

  it('caso mínimo sin separador final (EAN + lote, lote es el último campo)', () => {
    const raw = '01' + '00841235252197' + '10' + 'ABC1'
    const result = parseGs1(raw)
    expect(result.ean).toBe('00841235252197')
    expect(result.lote).toBe('ABC1')
  })

  it('formato legible entre paréntesis equivale al formato crudo', () => {
    const raw = '(01)08412345678905(10)LOTE123(17)260315(37)000012'
    const result = parseGs1(raw)
    expect(result.ean).toBe('08412345678905')
    expect(result.lote).toBe('LOTE123')
    expect(result.caducidad).toBe('2026-03-15')
    expect(result.cantidad).toBe(12)
  })

  it('AI 02 (GTIN de artículos contenidos) también rellena el EAN', () => {
    const raw = '02' + '08412345678905' + '37' + '000006'
    const result = parseGs1(raw)
    expect(result.ean).toBe('08412345678905')
    expect(result.cantidad).toBe(6)
  })

  it('EAN-13 suelto (sin envoltorio GS1-128, ej. barcode del artículo)', () => {
    const result = parseGs1('8437012926073')
    expect(result.ean).toBe('8437012926073')
    expect(result.lote).toBeUndefined()
  })

  it('DUN-14/GTIN-14 suelto, se usa tal cual sin quitar el 0 (ej. barcode de la caja)', () => {
    const result = parseGs1('08437012926073')
    expect(result.ean).toBe('08437012926073')
  })

  it('código no reconocible no lanza y no rellena EAN/lote', () => {
    const result = parseGs1('XYZ')
    expect(result.ean).toBeUndefined()
    expect(result.lote).toBeUndefined()
  })

  it('cadena vacía devuelve objeto vacío', () => {
    expect(parseGs1('')).toEqual({})
    expect(parseGs1('   ')).toEqual({})
  })
})
