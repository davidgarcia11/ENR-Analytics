/**
 * Test de lib/integracion.ts — API de integración con GoLive (bandeja de entrada).
 */
import { describe, it, expect } from 'bun:test'
import { Database } from 'bun:sqlite'
import { buscarMensajes, guardarMensaje, validarEscaneo, yaRecibido } from '@/lib/integracion'

const ESCANEO = { articulo: '1210500019', resultado: 'OK', linea: '18', lote: '263221', sscc: '384123450000000017', orden: '490387' }

describe('validarEscaneo', () => {
  it('el ejemplo del contrato es válido', () => {
    expect(validarEscaneo(ESCANEO)).toEqual({ valor: ESCANEO as any })
  })

  it('lote y SSCC pueden ir vacíos (NO_OK sin palet), pero tienen que venir', () => {
    const v = validarEscaneo({ ...ESCANEO, resultado: 'NO_OK', lote: '', sscc: '', motivo: 'Artículo fuera de la orden' })
    expect('valor' in v && v.valor.motivo).toBe('Artículo fuera de la orden')
    const { lote: _l, sscc: _s, ...sinLote } = ESCANEO
    expect(validarEscaneo(sinLote)).toEqual({ errores: ['lote: es obligatorio', 'sscc: es obligatorio'] })
  })

  it('dice qué campo falla y por qué', () => {
    expect(validarEscaneo({ ...ESCANEO, articulo: '121050001', resultado: 'ok', linea: '' })).toEqual({
      errores: ['articulo: deben ser 10 cifras', 'resultado: debe ser "OK" o "NO_OK"', 'linea: no puede ir vacío'],
    })
    expect(validarEscaneo({ ...ESCANEO, sscc: '00384123450000000017' })).toEqual({ errores: ['sscc: como mucho 18 caracteres'] })
  })

  it('los números tienen que ir como texto (el SSCC como número pierde cifras)', () => {
    expect(validarEscaneo({ ...ESCANEO, sscc: 384123450000000017 })).toEqual({ errores: ['sscc: debe ir como texto, entre comillas'] })
  })

  it('campos que no son del contrato: se aceptan (se guardan en el cuerpo)', () => {
    expect('valor' in validarEscaneo({ ...ESCANEO, operario: 'Juan' })).toBe(true)
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
    tipo: 'escaneo' as const, origen: 'real' as const, cuerpo: JSON.stringify(ESCANEO), valido: true, errores: null, idExterno: null, ip: '192.168.4.10', clave: { id: 1, nombre: 'GoLive pruebas' }, ...m,
  })

  it('un reintento con el mismo id se reconoce, solo si el primero era válido y con la misma clave', () => {
    const db = nuevaDb()
    guardarMensaje(db, mensaje({ idExterno: 'abc' }))
    guardarMensaje(db, mensaje({ idExterno: 'mal', valido: false, errores: ['x'] }))
    expect(yaRecibido(db, 'escaneo', 'real', 'abc')).toBe(true)
    expect(yaRecibido(db, 'escaneo', 'prueba', 'abc')).toBe(false)
    expect(yaRecibido(db, 'escaneo', 'real', 'mal')).toBe(false)
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
    expect(buscarMensajes(db, {}).filas[0].claveNombre).toBe('GoLive pruebas')
  })
})
