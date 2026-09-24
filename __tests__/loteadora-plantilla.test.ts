/**
 * Tests del modelo de plantilla de la loteadora (lib/loteadora-plantilla.ts):
 * formatos, composición de campos a partir de piezas y validación, con patrones
 * reales de las plantillas de clientes.
 */
import { describe, it, expect } from 'bun:test'
import {
  componerCampos, disponerCampos, exportarCopia, lineasEtiqueta, piezasManuales, filasACampos, formatearCaducidad, formatearCocida, importarCopia, validarPlantilla, variablesUsadas,
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

describe('copia de seguridad (exportar / importar)', () => {
  // bun:sqlite tiene la misma API que better-sqlite3 para lo que se usa aquí
  const { Database } = require('bun:sqlite')
  const nuevaBd = () => {
    const db = new Database(':memory:')
    db.exec(`
      CREATE TABLE loteadora_mensajes (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE);
      CREATE TABLE loteadora_mensaje_segmentos (id INTEGER PRIMARY KEY AUTOINCREMENT, mensaje_id INTEGER NOT NULL,
        orden INTEGER NOT NULL, field_id INTEGER NOT NULL, tipo TEXT NOT NULL, valor TEXT, nombre TEXT, formato TEXT);
      CREATE TABLE loteadora_articulo_mensajes (articulo_id TEXT PRIMARY KEY, mensaje_id INTEGER NOT NULL);
      CREATE TABLE loteadora_mensaje_campos (mensaje_id INTEGER NOT NULL, field_id INTEGER NOT NULL,
        linea INTEGER NOT NULL DEFAULT 1, reloj INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (mensaje_id, field_id));
    `)
    return db
  }
  const campos = (fmt: string) => [{ fieldId: 1, piezas: [{ tipo: 'texto', valor: 'CAD ' }, { tipo: 'caducidad', formato: fmt }], linea: 2, reloj: true }]
  const copia = {
    version: 1,
    plantillas: [{ name: 'N01_A', campos: campos('DD/MM/AA') }, { name: 'N02_B', campos: campos('DD/MM/AAAA') }],
    articulos: [{ articuloId: '1210500019', plantilla: 'N01_A' }],
  }

  it('exporta lo importado (ida y vuelta) y la segunda vez no duplica nada', () => {
    const db = nuevaBd()
    const r1 = importarCopia(db, copia, false)
    expect('value' in r1 && r1.value.plantillas.creadas).toBe(2)
    expect('value' in r1 && r1.value.articulos.creadas).toBe(1)
    const exportada = exportarCopia(db)
    expect(exportada.plantillas.map((p) => p.name)).toEqual(['N01_A', 'N02_B'])
    expect(exportada.plantillas[0].campos).toEqual(copia.plantillas[0].campos as Campo[])
    expect(exportada.articulos).toEqual(copia.articulos)

    const r2 = importarCopia(db, exportada, false)
    expect('value' in r2 && r2.value.plantillas).toEqual({ creadas: 0, sustituidas: 0, omitidas: 2 })
  })

  it('sin "sustituir" no pisa lo existente; con "sustituir" sí', () => {
    const db = nuevaBd()
    importarCopia(db, copia, false)
    const cambiada = { ...copia, plantillas: [{ name: 'N01_A', campos: campos('MM/DD/AA') }], articulos: [{ articuloId: '1210500019', plantilla: 'N02_B' }] }
    importarCopia(db, cambiada, false)
    expect(exportarCopia(db).plantillas[0].campos[0].piezas[1].formato).toBe('DD/MM/AA')
    expect(exportarCopia(db).articulos[0].plantilla).toBe('N01_A')

    const r = importarCopia(db, cambiada, true)
    expect('value' in r && r.value.plantillas.sustituidas).toBe(1)
    expect(exportarCopia(db).plantillas[0].campos[0].piezas[1].formato).toBe('MM/DD/AA')
    expect(exportarCopia(db).articulos[0].plantilla).toBe('N02_B')
  })

  it('si algo está mal no importa nada', () => {
    const db = nuevaBd()
    const mala = { ...copia, articulos: [{ articuloId: '123', plantilla: 'N01_A' }] }
    expect('error' in importarCopia(db, mala, false)).toBe(true)
    expect(exportarCopia(db).plantillas).toEqual([])
    expect('error' in importarCopia(db, { version: 1, plantillas: [{ name: 'X.msg', campos: campos('DD') }] }, false)).toBe(true)
    expect('error' in importarCopia(db, { foo: 1 }, false)).toBe(true)
  })
})

describe('disposición en la etiqueta (crear el mensaje en la máquina)', () => {
  const LOTE = [{ tipo: 'texto', valor: 'L' }, { tipo: 'cocida' }, { tipo: 'texto', valor: ' ' }, { tipo: 'fresco' }, { tipo: 'texto', valor: ' ' }, { tipo: 'linea' }] as Campo['piezas']

  it('una línea: el campo de después del reloj empieza tras el hueco (como N02)', () => {
    const d = disponerCampos([
      { fieldId: 1, piezas: LOTE, linea: 1, reloj: true },
      { fieldId: 2, piezas: [{ tipo: 'texto', valor: 'CAD ' }, { tipo: 'caducidad', formato: 'DD/MM/AA' }], linea: 1 },
    ])
    expect(d.map((c) => [c.id, c.x, c.y, c.length, c.fontSize])).toEqual([[1, 0, 0, 16, 35], [2, 462, 0, 12, 35]])
  })

  it('tres líneas: letra más pequeña (como N06)', () => {
    const d = disponerCampos([
      { fieldId: 1, piezas: [{ tipo: 'caducidad', formato: 'DD/MM/AA' }], linea: 1 },
      { fieldId: 2, piezas: LOTE, linea: 2, reloj: true },
      { fieldId: 3, piezas: [{ tipo: 'texto', valor: 'It contains egg' }], linea: 3 },
    ])
    expect(d.map((c) => [c.x, c.y, c.fontSize])).toEqual([[0, 0, 23], [0, 24, 23], [0, 48, 23]])
  })

  it('vista previa por líneas con el hueco del reloj', () => {
    const campos: Campo[] = [
      { fieldId: 1, piezas: [{ tipo: 'texto', valor: 'L' }, { tipo: 'cocida' }, { tipo: 'turno' }], linea: 1, reloj: true },
      { fieldId: 2, piezas: [{ tipo: 'texto', valor: 'CAD ' }, { tipo: 'caducidad', formato: 'DD/MM/AA' }], linea: 2 },
    ]
    expect(lineasEtiqueta(campos, valores)).toEqual(['L263641 HHmm', 'CAD 06/01/27'])
  })

  it('valida la línea y guarda el reloj', () => {
    const r = validarPlantilla({ name: 'X', campos: [{ fieldId: 1, piezas: [{ tipo: 'hora' }], linea: 2, reloj: true }] })
    expect('value' in r && r.value.campos[0]).toEqual({ fieldId: 1, piezas: [{ tipo: 'hora' }], linea: 2, reloj: true })
    expect('error' in validarPlantilla({ name: 'X', campos: [{ fieldId: 1, piezas: [{ tipo: 'hora' }], linea: 4 }] })).toBe(true)
  })
})

describe('dato a introducir (pieza manual)', () => {
  const campos: Campo[] = [
    { fieldId: 1, piezas: [{ tipo: 'texto', valor: 'L' }, { tipo: 'cocida' }] },
    { fieldId: 3, piezas: [{ tipo: 'texto', valor: 'KSR ' }, { tipo: 'manual', nombre: 'Nº certificado Kosher', valor: '000' }] },
  ]

  it('se compone con lo que escribe el operario y falta si no lo escribe', () => {
    expect(componerCampos(campos, { ...valores, manuales: { 'Nº certificado Kosher': 'K-4521' } })[1].texto).toBe('KSR K-4521')
    const sin = componerCampos(campos, valores)[1]
    expect(sin.faltan).toEqual(['manual'])
  })

  it('lista los datos a introducir con su valor por defecto', () => {
    expect(piezasManuales(campos)).toEqual([{ nombre: 'Nº certificado Kosher', porDefecto: '000' }])
  })

  it('valida: necesita nombre; el valor por defecto es opcional, ASCII y corto', () => {
    const ok = validarPlantilla({ name: 'N10_KERETS', campos: [{ fieldId: 3, piezas: [{ tipo: 'manual', nombre: 'Nº certificado Kosher' }] }] })
    expect('value' in ok && ok.value.campos[0].piezas[0]).toEqual({ tipo: 'manual', nombre: 'Nº certificado Kosher' })
    expect('error' in validarPlantilla({ name: 'X', campos: [{ fieldId: 3, piezas: [{ tipo: 'manual' }] }] })).toBe(true)
    expect('error' in validarPlantilla({ name: 'X', campos: [{ fieldId: 3, piezas: [{ tipo: 'manual', nombre: 'Cert', valor: '3,89€' }] }] })).toBe(true)
  })

  it('reserva 20 caracteres en el campo de la máquina', () => {
    expect(disponerCampos([{ fieldId: 3, piezas: [{ tipo: 'manual', nombre: 'Cert' }] }])[0].length).toBe(20)
  })
})
