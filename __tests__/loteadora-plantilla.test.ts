/**
 * Tests del modelo de plantilla de la loteadora (lib/loteadora-plantilla.ts):
 * formatos, composición de campos a partir de piezas y validación, con patrones
 * reales de las plantillas de clientes.
 */
import { describe, it, expect } from 'bun:test'
import {
  aplicarAjusteTurno, componerCampos, disponerMensaje, exportarCopia, trozosEtiqueta, lineasEtiqueta, medidasDeTamano, medidasPorDefecto, piezasManuales, validarMedidas, filasACampos, formatearCaducidad, formatearCocida, importarCopia, largoPieza, validarPlantilla, variablesUsadas,
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

  it('año, mes en siglas y día (AAAA MES DD)', () => {
    expect(formatearCaducidad('2027-02-24', 'AAAA MES DD')).toBe('2027 FE 24')
    const meses = Array.from({ length: 12 }, (_, i) => formatearCaducidad(`2027-${String(i + 1).padStart(2, '0')}-05`, 'AAAA MES DD').slice(5, 7))
    expect(meses).toEqual(['JA', 'FE', 'MR', 'AL', 'MA', 'JN', 'JL', 'AU', 'SE', 'OC', 'NO', 'DE'])
    expect(formatearCocida(2026, 55, 'AAAA MES DD')).toBe('2026 FE 24')
    // Reserva en la máquina lo que mide de verdad (10), no el nombre del formato (11)
    expect(largoPieza({ tipo: 'caducidad', formato: 'AAAA MES DD' })).toBe(10)
    expect(largoPieza({ tipo: 'cocida', formato: 'AAAA MES DD' })).toBe(10)
    expect(largoPieza({ tipo: 'cocida', formato: 'AAJJJ' })).toBe(5)
    expect(largoPieza({ tipo: 'caducidad', formato: 'DD' })).toBe(2)
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
      CREATE TABLE loteadora_mensajes (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, ajuste_turno TEXT);
      CREATE TABLE loteadora_mensaje_segmentos (id INTEGER PRIMARY KEY AUTOINCREMENT, mensaje_id INTEGER NOT NULL,
        orden INTEGER NOT NULL, field_id INTEGER NOT NULL, tipo TEXT NOT NULL, valor TEXT, nombre TEXT, formato TEXT);
      CREATE TABLE loteadora_articulo_mensajes (articulo_id TEXT PRIMARY KEY, mensaje_id INTEGER NOT NULL);
      CREATE TABLE loteadora_mensaje_campos (mensaje_id INTEGER NOT NULL, field_id INTEGER NOT NULL,
        linea INTEGER NOT NULL DEFAULT 1, reloj INTEGER NOT NULL DEFAULT 0, espaciado INTEGER, tamano INTEGER, PRIMARY KEY (mensaje_id, field_id));
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
    // Copia antigua: "reloj: true" en el campo pasa a ser un espacio y una pieza reloj al final
    const { reloj, ...campo } = copia.plantillas[0].campos[0]
    expect(exportada.plantillas[0].campos).toEqual([{ ...campo, piezas: [...campo.piezas, { tipo: 'texto', valor: ' ' }, { tipo: 'reloj', formato: 'HHmm' }] }] as Campo[])
    expect(exportada.articulos).toEqual(copia.articulos)

    const r2 = importarCopia(db, exportada, false)
    expect('value' in r2 && r2.value.plantillas).toEqual({ creadas: 0, sustituidas: 0, omitidas: 2 })
  })

  it('la caducidad según el turno va y vuelve en la copia', () => {
    const db = nuevaBd()
    importarCopia(db, { version: 1, plantillas: [{ name: 'N20_X', campos: campos('DD/MM/AA'), ajusteTurno: { '3': 1 } }], articulos: [] }, false)
    expect(exportarCopia(db).plantillas[0].ajusteTurno).toEqual({ '3': 1 })
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

  it('una línea: el campo de después del reloj empieza tras él (como N02)', () => {
    const d = disponerMensaje([
      { fieldId: 1, piezas: [...LOTE, { tipo: 'texto', valor: ' ' }, { tipo: 'reloj', formato: 'HHmm' }], linea: 1 },
      { fieldId: 2, piezas: [{ tipo: 'texto', valor: 'CAD ' }, { tipo: 'caducidad', formato: 'DD/MM/AA' }], linea: 1 },
    ])
    // campo 1: 16 caracteres + el espacio; el reloj detrás; el campo 2, tras un espacio (33 puntos cada uno)
    expect(d.campos.map((c) => [c.id, c.x, c.y, c.length, c.fontSize])).toEqual([[1, 0, 0, 17, 35], [2, 22 * 33, 0, 12, 35]])
    expect(d.relojes.map((r) => [r.x, r.y, r.length, r.formato])).toEqual([[17 * 33, 0, 4, 'HHmm']])
    // la caja de cada elemento es justo lo que ocupa
    expect([d.campos[0].ancho, d.relojes[0].ancho]).toEqual([17 * 33, 4 * 33])
  })

  it('tres líneas: letra más pequeña (como N06)', () => {
    const d = disponerMensaje([
      { fieldId: 1, piezas: [{ tipo: 'caducidad', formato: 'DD/MM/AA' }], linea: 1 },
      { fieldId: 2, piezas: [...LOTE, { tipo: 'reloj', formato: 'HHmm' }], linea: 2 },
      { fieldId: 3, piezas: [{ tipo: 'texto', valor: 'It contains egg' }], linea: 3 },
    ])
    expect(d.campos.map((c) => [c.x, c.y, c.fontSize])).toEqual([[0, 0, 23], [0, 24, 23], [0, 48, 23]])
    expect(d.relojes[0].y).toBe(24)
  })

  it('reloj al principio del campo, con dos puntos y con el espaciado del campo', () => {
    const campos: Campo[] = [{ fieldId: 1, piezas: [{ tipo: 'reloj', formato: 'HH:mm' }, { tipo: 'texto', valor: ' ABC' }], linea: 1, espaciado: -10 }]
    const d = disponerMensaje(campos)
    // 33 - 10 = 23 puntos por carácter
    expect(d.relojes.map((r) => [r.x, r.length, r.espaciado])).toEqual([[0, 5, -10]])
    expect(d.campos.map((c) => [c.x, c.length, c.espaciado])).toEqual([[5 * 23, 4, -10]])
    expect(lineasEtiqueta(campos, valores)).toEqual(['HH:mm ABC'])
  })

  it('vista previa por líneas con el reloj; al enviar el reloj no va', () => {
    const campos: Campo[] = [
      { fieldId: 1, piezas: [{ tipo: 'texto', valor: 'L' }, { tipo: 'cocida' }, { tipo: 'turno' }, { tipo: 'texto', valor: ' ' }, { tipo: 'reloj', formato: 'HHmm' }], linea: 1 },
      { fieldId: 2, piezas: [{ tipo: 'texto', valor: 'CAD ' }, { tipo: 'caducidad', formato: 'DD/MM/AA' }], linea: 2 },
    ]
    expect(lineasEtiqueta(campos, valores)).toEqual(['L263641 HHmm', 'CAD 06/01/27'])
    expect(componerCampos(campos, valores)[0]).toEqual({ fieldId: 1, texto: 'L263641 ', faltan: [] })
    expect(componerCampos(campos, { ...valores, conReloj: true })[0].texto).toBe('L263641 HHmm')
    expect(variablesUsadas(campos).has('reloj' as never)).toBe(false)
  })

  it('último envío: los textos enviados en sus líneas, con el reloj marcado', () => {
    const campos: Campo[] = [
      { fieldId: 1, piezas: [{ tipo: 'texto', valor: 'L' }, { tipo: 'cocida' }, { tipo: 'turno' }, { tipo: 'texto', valor: ' ' }, { tipo: 'reloj', formato: 'HHmm' }], linea: 1 },
      { fieldId: 2, piezas: [{ tipo: 'texto', valor: 'CAD ' }, { tipo: 'caducidad', formato: 'DD/MM/AA' }], linea: 2 },
    ]
    expect(trozosEtiqueta(campos, new Map([[1, 'L263641 '], [2, 'CAD 06/01/27']]))).toEqual([
      [{ texto: 'L263641 ' }, { texto: 'HHmm', reloj: true }],
      [{ texto: 'CAD 06/01/27' }],
    ])
  })

  it('valida la línea y el reloj', () => {
    const r = validarPlantilla({ name: 'X', campos: [{ fieldId: 1, piezas: [{ tipo: 'hora' }, { tipo: 'reloj', formato: 'HH:mm' }], linea: 2 }] })
    expect('value' in r && r.value.campos[0]).toEqual({ fieldId: 1, piezas: [{ tipo: 'hora' }, { tipo: 'reloj', formato: 'HH:mm' }], linea: 2 })
    // "reloj: true" (clientes y copias antiguas) = espacio y reloj HHmm al final
    const antigua = validarPlantilla({ name: 'X', campos: [{ fieldId: 1, piezas: [{ tipo: 'hora' }], reloj: true }] })
    expect('value' in antigua && antigua.value.campos[0].piezas).toEqual([{ tipo: 'hora' }, { tipo: 'texto', valor: ' ' }, { tipo: 'reloj', formato: 'HHmm' }])
    const campo = (piezas: unknown[]) => validarPlantilla({ name: 'X', campos: [{ fieldId: 1, piezas }] })
    expect('error' in validarPlantilla({ name: 'X', campos: [{ fieldId: 1, piezas: [{ tipo: 'hora' }], linea: 4 }] })).toBe(true)
    expect('error' in campo([{ tipo: 'hora' }, { tipo: 'reloj', formato: 'HH' }])).toBe(true) // formato
    expect('error' in campo([{ tipo: 'hora' }, { tipo: 'reloj', formato: 'HHmm' }, { tipo: 'turno' }])).toBe(true) // en medio
    expect('error' in campo([{ tipo: 'reloj', formato: 'HHmm' }, { tipo: 'hora' }, { tipo: 'reloj', formato: 'HHmm' }])).toBe(true) // dos
    expect('error' in campo([{ tipo: 'reloj', formato: 'HHmm' }])).toBe(true) // solo el reloj
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
    expect(disponerMensaje([{ fieldId: 3, piezas: [{ tipo: 'manual', nombre: 'Cert' }] }]).campos[0].length).toBe(20)
  })
})

describe('medidas del mensaje (fuente, tamaño, espaciado)', () => {
  const campos: Campo[] = [
    { fieldId: 1, piezas: [{ tipo: 'texto', valor: 'L' }, { tipo: 'cocida' }], linea: 1 },
    { fieldId: 2, piezas: [{ tipo: 'caducidad', formato: 'DD/MM/AA' }], linea: 2 },
  ]

  it('por defecto Arial con las proporciones de siempre', () => {
    expect(medidasPorDefecto(campos)).toEqual({ fuente: 'Arial', tamano: 35, espaciado: 0, ancho: 33, interlineado: 36 })
  })

  it('coloca los campos con las medidas elegidas y manda su fuente, tamaño y espaciado', () => {
    const m = medidasDeTamano(30, -2) // ancho = 28 - 2 = 26, interlineado 31
    expect(m).toEqual({ fuente: 'Arial', tamano: 30, espaciado: -2, ancho: 26, interlineado: 31 })
    const conReloj = [{ ...campos[0], piezas: [...campos[0].piezas, { tipo: 'reloj', formato: 'HHmm' }] }, campos[1]]
    const d = disponerMensaje([...conReloj, { fieldId: 3, piezas: [{ tipo: 'texto', valor: 'X' }], linea: 1 }], m)
    // campo 1: 6 caracteres de 26 puntos; reloj pegado: 4 de 26; espacio (28, el ancho base)
    expect(d.campos.map((c) => [c.id, c.x, c.y, c.fontSize, c.font, c.espaciado])).toEqual([
      [1, 0, 0, 30, 'Arial', -2], [2, 0, 31, 30, 'Arial', -2], [3, 6 * 26 + 4 * 26 + 28, 0, 30, 'Arial', -2],
    ])
    expect(d.relojes[0].x).toBe(6 * 26)
  })

  it('cada campo puede tener su espaciado; el resto usa el del mensaje', () => {
    const m = medidasDeTamano(35) // base 33, espaciado 0
    const d = disponerMensaje([
      { fieldId: 1, piezas: [{ tipo: 'texto', valor: 'ABCD' }], linea: 1, espaciado: 10 },
      { fieldId: 2, piezas: [{ tipo: 'texto', valor: 'XY' }], linea: 1 },
    ], m)
    // campo 1 a 43 puntos por carácter (33 + 10); campo 2 detrás, con el del mensaje (0)
    expect(d.campos.map((c) => [c.id, c.x, c.espaciado])).toEqual([[1, 0, 10], [2, 4 * 43 + 33, 0]])
    const r = validarPlantilla({ name: 'X', campos: [{ fieldId: 1, piezas: [{ tipo: 'hora' }], espaciado: 10 }] })
    expect('value' in r && r.value.campos[0].espaciado).toBe(10)
    expect('error' in validarPlantilla({ name: 'X', campos: [{ fieldId: 1, piezas: [{ tipo: 'hora' }], espaciado: 7 }] })).toBe(true)
  })

  it('cada campo puede tener su tamaño: escala su ancho y el alto de su línea', () => {
    const d = disponerMensaje([
      { fieldId: 1, piezas: [{ tipo: 'texto', valor: 'AB' }, { tipo: 'reloj', formato: 'HHmm' }], linea: 1, tamano: 70 },
      { fieldId: 2, piezas: [{ tipo: 'texto', valor: 'XY' }], linea: 1 },
      { fieldId: 3, piezas: [{ tipo: 'texto', valor: 'Z' }], linea: 2 },
    ], medidasDeTamano(35))
    // tamaño 70 = el doble: 66 puntos por carácter; su reloj, igual; el campo 2 detrás tras un espacio de 66
    expect(d.campos.map((c) => [c.id, c.x, c.y, c.fontSize, c.ancho])).toEqual([
      [1, 0, 0, 70, 2 * 66], [2, 2 * 66 + 4 * 66 + 66, 0, 35, 2 * 33], [3, 0, 72, 35, 33],
    ])
    expect(d.relojes.map((r) => [r.x, r.fontSize, r.ancho])).toEqual([[2 * 66, 70, 4 * 66]])
    const r = validarPlantilla({ name: 'X', campos: [{ fieldId: 1, piezas: [{ tipo: 'hora' }], tamano: 50 }] })
    expect('value' in r && r.value.campos[0].tamano).toBe(50)
    expect('error' in validarPlantilla({ name: 'X', campos: [{ fieldId: 1, piezas: [{ tipo: 'hora' }], tamano: 2 }] })).toBe(true)
  })

  it('la línea reserva lo que mide la de la loteadora (por defecto 2)', () => {
    const campos: Campo[] = [{ fieldId: 1, piezas: [{ tipo: 'texto', valor: 'L' }, { tipo: 'linea' }] }]
    expect(disponerMensaje(campos).campos[0].length).toBe(3)
    expect(disponerMensaje(campos, undefined, 1).campos[0].length).toBe(2)
  })

  it('valida las medidas', () => {
    expect('value' in validarMedidas({ fuente: 'Arial', tamano: 30, espaciado: -2, ancho: 16, interlineado: 31 })).toBe(true)
    expect('error' in validarMedidas({ fuente: 'Arial', tamano: 30, espaciado: 3, ancho: 16, interlineado: 31 })).toBe(true)
    expect('error' in validarMedidas({ fuente: '', tamano: 30, espaciado: 0, ancho: 16, interlineado: 31 })).toBe(true)
    expect('error' in validarMedidas({ fuente: 'Arial', tamano: 2, espaciado: 0, ancho: 16, interlineado: 31 })).toBe(true)
  })
})

describe('caducidad según el turno', () => {
  const campos: Campo[] = [
    { fieldId: 1, piezas: [{ tipo: 'texto', valor: 'CAD ' }, { tipo: 'caducidad', formato: 'DD/MM/AA' }] },
    { fieldId: 2, piezas: [{ tipo: 'caducidad', formato: 'DD', valor: '-1' }] },
  ]

  it('mueve todas las caducidades de la plantilla según el turno, encima del ajuste de cada pieza', () => {
    const v = { caducidad: '2027-01-06', turno: '3' }
    const textos = componerCampos(campos, aplicarAjusteTurno(v, { '3': 1 })).map((c) => c.texto)
    expect(textos).toEqual(['CAD 07/01/27', '06'])
    // otro turno, sin ajuste
    expect(componerCampos(campos, aplicarAjusteTurno({ ...v, turno: '1' }, { '3': 1 }))[0].texto).toBe('CAD 06/01/27')
  })

  it('con ajuste, el turno es obligatorio aunque no se imprima', () => {
    expect(variablesUsadas(campos).has('turno')).toBe(false)
    expect(variablesUsadas(campos, { '3': 1 }).has('turno')).toBe(true)
    expect(variablesUsadas(campos, { '3': 0 }).has('turno')).toBe(false)
  })

  it('valida: días enteros entre -30 y 30; los 0 no se guardan', () => {
    const r = validarPlantilla({ name: 'X', campos, ajusteTurno: { '1': '0', '2': '', '3': '-1' } })
    expect('value' in r && r.value.ajusteTurno).toEqual({ '3': -1 })
    const sin = validarPlantilla({ name: 'X', campos, ajusteTurno: { '1': 0 } })
    expect('value' in sin && sin.value.ajusteTurno).toBeUndefined()
    expect('error' in validarPlantilla({ name: 'X', campos, ajusteTurno: { '3': 1.5 } })).toBe(true)
    expect('error' in validarPlantilla({ name: 'X', campos, ajusteTurno: { '3': 40 } })).toBe(true)
  })
})

describe('formatos de fecha con "-"', () => {
  it('caducidad y cocida como fecha, con guion', () => {
    expect(formatearCaducidad('2027-01-06', 'DD-MM-AA')).toBe('06-01-27')
    expect(formatearCaducidad('2027-01-06', 'MM-DD-AAAA')).toBe('01-06-2027')
    expect(formatearCaducidad('2027-01-06', 'DD/MM/AA')).toBe('06/01/27')
    expect(formatearCocida(2026, 364, 'DD-MM-AAAA')).toBe('30-12-2026')
    const r = validarPlantilla({ name: 'X', campos: [{ fieldId: 1, piezas: [{ tipo: 'caducidad', formato: 'DD-MM-AA' }] }] })
    expect('value' in r).toBe(true)
  })
})

