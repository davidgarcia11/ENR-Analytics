/**
 * Tests de las fechas juliano de JDE (lib/utils.ts)
 *
 * getDayOfYear() devolvía un día menos con una fecha a medianoche LOCAL en horario de
 * verano (new Date(y, m, d), como hace isoToJulian), y /costes pedía a F554105 el rango
 * 31/08–29/09 al elegir septiembre. Se fija la zona horaria de España porque el fallo
 * depende de ella (en UTC no se reproduce).
 */
import { describe, it, expect } from 'bun:test'

process.env.TZ = 'Europe/Madrid'

const { getDayOfYear, isoToJulian } = await import('@/lib/utils')

describe('isoToJulian', () => {
  it('septiembre de 2026 (horario de verano): del 1 al 30 es 126244–126273', () => {
    expect(isoToJulian('2026-09-01')).toBe(126244)
    expect(isoToJulian('2026-09-30')).toBe(126273)
  })

  it('invierno y límites del año', () => {
    expect(isoToJulian('2026-01-01')).toBe(126001)
    expect(isoToJulian('2026-01-15')).toBe(126015)
    expect(isoToJulian('2026-12-31')).toBe(126365)
  })

  it('año bisiesto: el 29 de febrero y el 1 de marzo', () => {
    expect(isoToJulian('2024-02-29')).toBe(124060)
    expect(isoToJulian('2024-03-01')).toBe(124061)
  })

  it('todos los días de 2026 dan su día del año exacto (sin saltos en los cambios de hora)', () => {
    for (let doy = 1; doy <= 365; doy++) {
      const f = new Date(Date.UTC(2026, 0, doy))
      const iso = f.toISOString().slice(0, 10)
      expect(isoToJulian(iso)).toBe(126000 + doy)
    }
  })
})

describe('getDayOfYear', () => {
  it('da lo mismo con medianoche local, medianoche UTC y mediodía', () => {
    expect(getDayOfYear(new Date(2026, 8, 1))).toBe(244) // local 00:00, el caso que fallaba
    expect(getDayOfYear(new Date('2026-09-01'))).toBe(244) // UTC 00:00 (así lo usan las demás rutas)
    expect(getDayOfYear(new Date(2026, 8, 1, 12))).toBe(244)
  })

  it('entre las 00:00 y las 01:00 locales de verano ya no cuenta el día anterior', () => {
    expect(getDayOfYear(new Date(2026, 8, 1, 0, 30))).toBe(244)
  })
})
