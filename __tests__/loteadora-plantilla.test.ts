/**
 * Tests del modelo de plantilla de la loteadora (lib/loteadora-plantilla.ts):
 * formatos, composición de campos a partir de piezas y validación, con patrones
 * reales de las plantillas de clientes.
 */
import { describe, it, expect } from 'bun:test'
import {
  componerCampos, filasACampos, formatearCaducidad, formatearCocida, validarPlantilla, variablesUsadas,
  type Campo, type ValoresEtiqueta,
} from '@/lib/loteadora-plantilla'

const valores: ValoresEtiqueta = {
  fresco: '263221',
  cocidaAnio: 2026,
  cocidaDia: 364,
  caducidad: '2027-01-06',
  hora: '0930',
  turno: '1',
  linea: 'L1',
}

describe('formatos', () => {
  it('caducidad en los cuatro formatos', () => {
    expect(formatearCaducidad('2027-01-06', 'DD/MM/AA')).toBe('06/01/27')
    expect(formatearCaducidad('2027-01-06', 'DD/MM/AAAA')).toBe('06/01/2027')
    expect(formatearCaducidad('2027-01-06', 'MM/DD/AA')).toBe('01/06/27')
    expect(formatearCaducidad('2027-01-06', 'MM/DD/AAAA')).toBe('01/06/2027')
  })

  it('cocida con padding del día juliano', () => {
    expect(formatearCocida(2026, 5, 'AAJJJ')).toBe('26005')
    expect(formatearCocida(2026, 364, 'AJJJ')).toBe('6364')
    expect(formatearCocida(2026, 42, 'JJJ')).toBe('042')
  })

  it('cocida como fecha (PROD: dd/mm/aa)', () => {
    expect(formatearCocida(2026, 1, 'DD/MM/AA')).toBe('01/01/26')
    expect(formatearCocida(2026, 264, 'DD/MM/AA')).toBe('21/09/26')
    expect(formatearCocida(2024, 366, 'DD/MM/AAAA')).toBe('31/12/2024') // bisiesto
  })
})

describe('componerCampos', () => {
  it('BENIS HORECA FRESCO: L + cocida + turno en un solo campo', () => {
    const campos: Campo[] = [
      { fieldId: 1, piezas: [{ tipo: 'texto', valor: 'L' }, { tipo: 'cocida', formato: 'AAJJJ' }, { tipo: 'turno' }] },
      { fieldId: 2, piezas: [{ tipo: 'hora' }] },
      { fieldId: 3, piezas: [{ tipo: 'texto', valor: 'CAD ' }, { tipo: 'caducidad', formato: 'DD/MM/AA' }] },
    ]
    expect(componerCampos(campos, valores).map((c) => c.texto)).toEqual(['L263641', '0930', 'CAD 06/01/27'])
  })

  it('Trader Joes: caducidad americana con literal "BB "', () => {
    const campos: Campo[] = [{ fieldId: 5, piezas: [{ tipo: 'texto', valor: 'BB ' }, { tipo: 'caducidad', formato: 'MM/DD/AA' }] }]
    expect(componerCampos(campos, valores)[0].texto).toBe('BB 01/06/27')
  })

  it('dato fijo (precio) detrás de la caducidad', () => {
    const campos: Campo[] = [{
      fieldId: 4,
      piezas: [{ tipo: 'caducidad', formato: 'DD/MM/AA' }, { tipo: 'texto', valor: '  ' }, { tipo: 'fijo', nombre: 'Precio', valor: '3,89 EUR' }],
    }]
    expect(componerCampos(campos, valores)[0].texto).toBe('06/01/27  3,89 EUR')
  })

  it('caducidad completa en un campo y el día anterior en otro (formato DD, ajuste -1)', () => {
    const campos: Campo[] = [
      { fieldId: 1, piezas: [{ tipo: 'caducidad', formato: 'DD/MM/AAAA' }] },
      { fieldId: 2, piezas: [{ tipo: 'caducidad', formato: 'DD', valor: '-1' }] },
    ]
    expect(componerCampos(campos, { caducidad: '2026-07-25' }).map((c) => c.texto)).toEqual(['25/07/2026', '24'])
    // El día 1 da el último del mes anterior
    expect(componerCampos(campos, { caducidad: '2026-08-01' })[1].texto).toBe('31')
  })

  it('el fresco se envía tal cual', () => {
    expect(componerCampos([{ fieldId: 1, piezas: [{ tipo: 'fresco' }] }], valores)[0].texto).toBe('263221')
  })

  it('marca las variables que faltan', () => {
    const r = componerCampos([{ fieldId: 1, piezas: [{ tipo: 'texto', valor: 'L' }, { tipo: 'cocida' }, { tipo: 'turno' }] }], { cocidaAnio: 2026, cocidaDia: 10 })
    expect(r[0]).toEqual({ fieldId: 1, texto: 'L26010', faltan: ['turno'] })
  })
})

describe('variablesUsadas', () => {
  it('solo las variables, no los literales ni los datos fijos', () => {
    const campos: Campo[] = [
      { fieldId: 1, piezas: [{ tipo: 'texto', valor: 'L' }, { tipo: 'cocida' }] },
      { fieldId: 2, piezas: [{ tipo: 'fijo', nombre: 'Cert', valor: 'K-123' }, { tipo: 'caducidad' }] },
    ]
    expect([...variablesUsadas(campos)].sort()).toEqual(['caducidad', 'cocida'])
  })
})

describe('validarPlantilla', () => {
  const ok = { name: 'BENIS_HORECA', campos: [{ fieldId: 1, piezas: [{ tipo: 'texto', valor: 'L' }, { tipo: 'cocida' }] }] }

  it('acepta una plantilla válida y pone formatos por defecto', () => {
    const r = validarPlantilla({ ...ok, campos: [...ok.campos, { fieldId: 2, piezas: [{ tipo: 'caducidad' }] }] })
    expect('value' in r && r.value.campos[0].piezas[1].formato).toBe('AAJJJ')
    expect('value' in r && r.value.campos[1].piezas[0].formato).toBe('DD/MM/AAAA')
  })

  it('rechaza IDs de campo repetidos o fuera de rango', () => {
    expect('error' in validarPlantilla({ ...ok, campos: [ok.campos[0], ok.campos[0]] })).toBe(true)
    expect('error' in validarPlantilla({ ...ok, campos: [{ fieldId: 300, piezas: [{ tipo: 'hora' }] }] })).toBe(true)
  })

  it('rechaza caracteres no ASCII (la máquina recibe ASCII)', () => {
    const r = validarPlantilla({ ...ok, campos: [{ fieldId: 4, piezas: [{ tipo: 'fijo', nombre: 'Precio', valor: '3,89€' }] }] })
    expect('error' in r && r.error).toContain('ASCII')
  })

  it('ajuste de caducidad: guarda enteros y rechaza lo demás', () => {
    const r = validarPlantilla({ ...ok, campos: [{ fieldId: 2, piezas: [{ tipo: 'caducidad', formato: 'DD', valor: '-1' }] }] })
    expect('value' in r && r.value.campos[0].piezas[0]).toEqual({ tipo: 'caducidad', formato: 'DD', valor: '-1' })
    expect('error' in validarPlantilla({ ...ok, campos: [{ fieldId: 2, piezas: [{ tipo: 'caducidad', valor: '1.5' }] }] })).toBe(true)
  })

  it('rechaza el nombre con ".msg" (la máquina los carga sin extensión)', () => {
    expect('error' in validarPlantilla({ ...ok, name: 'Prueba2.msg' })).toBe(true)
  })

  it('rechaza piezas vacías, datos fijos sin nombre y tipos desconocidos', () => {
    expect('error' in validarPlantilla({ ...ok, campos: [{ fieldId: 1, piezas: [] }] })).toBe(true)
    expect('error' in validarPlantilla({ ...ok, campos: [{ fieldId: 1, piezas: [{ tipo: 'fijo', valor: 'X' }] }] })).toBe(true)
    expect('error' in validarPlantilla({ ...ok, campos: [{ fieldId: 1, piezas: [{ tipo: 'otro' }] }] })).toBe(true)
  })
})

describe('filasACampos', () => {
  it('agrupa por campo respetando el orden', () => {
    const base = { mensaje_id: 1, valor: null, nombre: null, formato: null }
    const campos = filasACampos([
      { ...base, id: 3, orden: 1000, field_id: 7, tipo: 'hora' },
      { ...base, id: 2, orden: 1, field_id: 2, tipo: 'cocida', formato: 'AAJJJ' },
      { ...base, id: 1, orden: 0, field_id: 2, tipo: 'texto', valor: 'L' },
    ])
    expect(campos).toEqual([
      { fieldId: 2, piezas: [{ tipo: 'texto', valor: 'L' }, { tipo: 'cocida', formato: 'AAJJJ' }] },
      { fieldId: 7, piezas: [{ tipo: 'hora' }] },
    ])
  })
})
