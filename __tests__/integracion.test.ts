/**
 * Test de lib/integracion.ts — API de integración (bandeja de entrada).
 */
import { describe, it, expect } from 'bun:test'
import { Database } from 'bun:sqlite'
import { buscarMensajes, escaneoRecibido, guardarMensaje, leerCuerpo, limpiarPruebasAntiguas, mismoEscaneo, validarEscaneo, type Escaneo } from '@/lib/integracion'

const ESCANEO = { articulo: '1210500019', resultado: 'OK', linea: '18', lote: '263221', sscc: '384123450000000017', orden: '490387' }

describe('validarEscaneo', () => {
  it('el ejemplo del contrato es válido', () => {
    expect(validarEscaneo(ESCANEO)).toEqual({ valor: ESCANEO as any })
  })

  it('lote, SSCC y orden: obligatorios y nunca vacíos, también en un NO_OK', () => {
    expect(validarEscaneo({ ...ESCANEO, resultado: 'NO_OK' })).toEqual({ valor: { ...ESCANEO, resultado: 'NO_OK' } as any })
    expect(validarEscaneo({ ...ESCANEO, lote: '', sscc: '', orden: ' ' })).toEqual({
      errores: ['lote: no puede ir vacío', 'sscc: no puede ir vacío', 'orden: no puede ir vacío'],
    })
    const { lote: _l, sscc: _s, orden: _o, ...sinNada } = ESCANEO
    expect(validarEscaneo(sinNada)).toEqual({ errores: ['lote: es obligatorio', 'sscc: es obligatorio', 'orden: es obligatorio'] })
  })

  it('SSCC que empieza por 00: válido con 18 cifras; con el (00) delante (20), mensaje claro', () => {
    expect('valor' in validarEscaneo({ ...ESCANEO, sscc: '001234567890123456' })).toBe(true)
    expect(validarEscaneo({ ...ESCANEO, sscc: '00384123450000000017' })).toEqual({
      errores: ['sscc: tiene 20 cifras y empieza por 00: quitad el (00) del principio, el SSCC son las 18 cifras siguientes'],
    })
    // 20 cifras que no empiezan por 00: el error de siempre
    expect(validarEscaneo({ ...ESCANEO, sscc: '11384123450000000017' })).toEqual({ errores: ['sscc: como mucho 18 caracteres'] })
  })

  it('línea y orden, solo cifras', () => {
    expect(validarEscaneo({ ...ESCANEO, linea: 'L18', orden: 'OF490387' })).toEqual({
      errores: ['linea: solo cifras: el número de línea, sin códigos ni nombres', 'orden: solo cifras'],
    })
    expect('valor' in validarEscaneo({ ...ESCANEO, linea: ' 5 ', orden: '490387' })).toBe(true)
  })

  it('dice qué campo falla y por qué', () => {
    expect(validarEscaneo({ ...ESCANEO, articulo: '121050001', resultado: 'ok', linea: '' })).toEqual({
      errores: ['articulo: deben ser 10 cifras', 'resultado: debe ser "OK" o "NO_OK"', 'linea: no puede ir vacío'],
    })
  })

  it('los números tienen que ir como texto (el SSCC como número pierde cifras)', () => {
    expect(validarEscaneo({ ...ESCANEO, sscc: 384123450000000017 })).toEqual({ errores: ['sscc: debe ir como texto, entre comillas'] })
  })

  it('campos que no son del contrato: se rechazan, uno por uno (también una errata de mayúsculas)', () => {
    expect(validarEscaneo({ ...ESCANEO, motivo: 'x', Id: 'abc' })).toEqual({ errores: ['motivo: campo no admitido', 'Id: campo no admitido'] })
  })

  it('no es un objeto', () => {
    expect(validarEscaneo([ESCANEO])).toEqual({ errores: ['El cuerpo debe ser un objeto JSON'] })
    expect(validarEscaneo(null)).toEqual({ errores: ['El cuerpo debe ser un objeto JSON'] })
  })
})

describe('bandeja de entrada', () => {
  const nuevaDb = () => {
    const db = new Database(':memory:') as any
    db.exec(`CREATE TABLE integracion_mensajes (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      tipo TEXT NOT NULL, origen TEXT NOT NULL, cuerpo TEXT NOT NULL, valido INTEGER NOT NULL, errores TEXT, id_externo TEXT, ip TEXT,
      estado TEXT NOT NULL DEFAULT 'recibido', clave_id INTEGER, clave_nombre TEXT)`)
    return db
  }
  const mensaje = (m: Partial<Parameters<typeof guardarMensaje>[1]> = {}) => ({
    tipo: 'escaneo' as const, origen: 'real' as const, cuerpo: JSON.stringify(ESCANEO), valido: true, errores: null, idExterno: null, ip: '192.168.4.10', clave: { id: 1, nombre: 'ERP pruebas' }, ...m,
  })

  it('el escaneo anterior con el mismo id: solo si era válido y con la misma clase de clave', () => {
    const db = nuevaDb()
    guardarMensaje(db, mensaje({ idExterno: 'abc', cuerpo: JSON.stringify({ ...ESCANEO, id: 'abc' }) }))
    guardarMensaje(db, mensaje({ idExterno: 'mal', valido: false, errores: ['x'] }))
    expect(escaneoRecibido(db, 'real', 'abc')).toEqual({ ...ESCANEO, id: 'abc' } as Escaneo)
    expect(escaneoRecibido(db, 'prueba', 'abc')).toBeNull()
    expect(escaneoRecibido(db, 'real', 'mal')).toBeNull()
  })

  it('reintento (mismos datos, aunque con espacios u otro orden) frente a id reutilizado (otros datos)', () => {
    const v = (c: unknown) => { const r = validarEscaneo(c); if (!('valor' in r)) throw new Error(); return r.valor }
    const primero = v({ ...ESCANEO, id: 'abc' })
    const { articulo, ...resto } = ESCANEO
    expect(mismoEscaneo(primero, v({ id: 'abc', ...resto, articulo: ` ${articulo} ` }))).toBe(true)
    expect(mismoEscaneo(primero, v({ ...ESCANEO, articulo: '1210500020', id: 'abc' }))).toBe(false)
  })

  it('se buscan por origen, validez y texto, del más reciente al más antiguo', () => {
    const db = nuevaDb()
    guardarMensaje(db, mensaje())
    guardarMensaje(db, mensaje({ origen: 'prueba' }))
    guardarMensaje(db, mensaje({ cuerpo: '{roto', valido: false, errores: ['El cuerpo no es un JSON válido'] }))
    expect(buscarMensajes(db, {}).filas.map((f) => f.id)).toEqual([3, 2, 1])
    expect(buscarMensajes(db, { origen: 'prueba' }).total).toBe(1)
    const rechazados = buscarMensajes(db, { valido: false })
    expect(rechazados.filas[0]).toMatchObject({ valido: false, errores: ['El cuerpo no es un JSON válido'], estado: 'recibido' })
    expect(buscarMensajes(db, { q: '384123450000000017' }).total).toBe(2)
    expect(buscarMensajes(db, {}).filas[0].claveNombre).toBe('ERP pruebas')
  })
})

describe('leerCuerpo', () => {
  const peticion = (cuerpo: BodyInit, cabeceras: Record<string, string> = {}) =>
    new Request('http://x/api', { method: 'POST', body: cuerpo, headers: cabeceras })

  it('lee hasta el máximo', async () => {
    expect(await leerCuerpo(peticion('{"a":"ñ"}'), 100)).toBe('{"a":"ñ"}')
    expect(await leerCuerpo(peticion('x'.repeat(100)), 100)).toBe('x'.repeat(100))
  })

  it('por encima, null: por la cabecera o leyendo, aunque la cabecera mienta o no venga', async () => {
    expect(await leerCuerpo(peticion('x'.repeat(101)), 100)).toBeNull()
    expect(await leerCuerpo(peticion('{}', { 'content-length': '999999' }), 100)).toBeNull()
    // Sin Content-Length (por trozos): se corta al pasar del máximo
    const trozos = new ReadableStream({ start(c) { for (let i = 0; i < 50; i++) c.enqueue(new TextEncoder().encode('x'.repeat(10))); c.close() } })
    expect(await leerCuerpo(new Request('http://x/api', { method: 'POST', body: trozos, duplex: 'half' } as RequestInit), 100)).toBeNull()
  })
})

describe('limpiarPruebasAntiguas', () => {
  it('borra solo los de prueba de más de 90 días; los reales se quedan siempre', () => {
    const db = new Database(':memory:') as any
    db.exec(`CREATE TABLE integracion_mensajes (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      tipo TEXT NOT NULL, origen TEXT NOT NULL, cuerpo TEXT NOT NULL, valido INTEGER NOT NULL, errores TEXT, id_externo TEXT, ip TEXT,
      estado TEXT NOT NULL DEFAULT 'recibido', clave_id INTEGER, clave_nombre TEXT)`)
    const meter = (origen: string, hace: string) => db.prepare(
      `INSERT INTO integracion_mensajes (tipo, origen, cuerpo, valido, created_at) VALUES ('escaneo', ?, '{}', 1, datetime('now', ?))`
    ).run(origen, hace)
    meter('prueba', '-91 days'); meter('prueba', '-89 days'); meter('real', '-400 days'); meter('prueba', '-0 days')
    expect(limpiarPruebasAntiguas(db)).toBe(1)
    expect(db.prepare('SELECT origen FROM integracion_mensajes ORDER BY id').all().map((r: any) => r.origen)).toEqual(['prueba', 'real', 'prueba'])
  })
})
