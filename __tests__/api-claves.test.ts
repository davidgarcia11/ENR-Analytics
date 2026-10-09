/**
 * Test de lib/api-claves.ts — claves de API gestionadas desde /admin.
 */
import { describe, it, expect } from 'bun:test'
import { Database } from 'bun:sqlite'
import {
  crearClave, dentroDelLimite, editarClave, eliminarClave, estadoClave, generarClave, huella, hoyLocal, leerClave, listarClaves,
  revocarClave, rotarClave, validarDatosClave, verificarClave, type DatosClave,
} from '@/lib/api-claves'

const nuevaDb = () => {
  const db = new Database(':memory:') as any
  db.exec(`CREATE TABLE api_claves (id INTEGER PRIMARY KEY AUTOINCREMENT, nombre TEXT NOT NULL, prefijo TEXT NOT NULL,
    hash TEXT NOT NULL UNIQUE, entorno TEXT NOT NULL, ambitos TEXT NOT NULL, notas TEXT, caduca_el TEXT, creada_por TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, revocada_por TEXT, revocada_at TEXT, ultimo_uso_at TEXT, ultimo_uso_ip TEXT)`)
  return db
}
const DATOS: DatosClave = { nombre: 'ERP pruebas', ambitos: ['escaneo'], caducaEl: null, notas: null }
const manana = () => hoyLocal(new Date(Date.now() + 86_400_000))
const ayer = () => hoyLocal(new Date(Date.now() - 86_400_000))

describe('generarClave', () => {
  it('prefijo del entorno, 192 bits al azar y su huella', () => {
    const { clave, prefijo, hash } = generarClave('prueba')
    expect(clave).toMatch(/^enr_test_[A-Za-z0-9_-]{32}$/)
    expect(prefijo).toBe(clave.slice(0, 13))
    expect(hash).toBe(huella(clave))
    expect(generarClave('real').clave.startsWith('enr_live_')).toBe(true)
    expect(generarClave('prueba').clave).not.toBe(clave)
  })
})

describe('validarDatosClave', () => {
  it('pide nombre y al menos una API conocida', () => {
    expect(validarDatosClave({ ...DATOS, nombre: ' ' })).toEqual({ error: 'El nombre es obligatorio (hasta 60 caracteres)' })
    expect(validarDatosClave({ ...DATOS, ambitos: [] })).toEqual({ error: 'Marca al menos una API a la que da acceso' })
    expect(validarDatosClave({ ...DATOS, ambitos: ['jde-orders'] })).toEqual({ error: 'Marca al menos una API a la que da acceso' })
  })
  it('caducidad: vacía, o una fecha de hoy en adelante', () => {
    expect(validarDatosClave({ ...DATOS, caducaEl: '' })).toEqual({ valor: DATOS })
    expect(validarDatosClave({ ...DATOS, caducaEl: '2026-10-08' }, '2026-10-08')).toEqual({ valor: { ...DATOS, caducaEl: '2026-10-08' } })
    expect(validarDatosClave({ ...DATOS, caducaEl: '2026-10-07' }, '2026-10-08')).toEqual({ error: 'La caducidad no puede ser anterior a hoy' })
    expect(validarDatosClave({ ...DATOS, caducaEl: '8/10/2026' })).toEqual({ error: 'Fecha de caducidad no válida' })
  })
})

describe('estadoClave', () => {
  it('revocada gana; caduca al acabar su último día', () => {
    expect(estadoClave({ revocadaAt: null, caducaEl: null }, '2026-10-08')).toBe('activa')
    expect(estadoClave({ revocadaAt: null, caducaEl: '2026-10-08' }, '2026-10-08')).toBe('activa')
    expect(estadoClave({ revocadaAt: null, caducaEl: '2026-10-08' }, '2026-10-09')).toBe('caducada')
    expect(estadoClave({ revocadaAt: '2026-10-01 10:00:00', caducaEl: null }, '2026-10-08')).toBe('revocada')
  })
})

describe('verificarClave', () => {
  it('vale la clave completa, no se guarda en claro y apunta el último uso', () => {
    const db = nuevaDb()
    const { clave, fila } = crearClave(db, 'prueba', DATOS, 'admin')
    expect(JSON.stringify(db.prepare('SELECT * FROM api_claves').all())).not.toContain(clave)
    expect(fila).toMatchObject({ nombre: 'ERP pruebas', entorno: 'prueba', ambitos: ['escaneo'], creadaPor: 'admin', ultimoUsoAt: null })
    expect(verificarClave(db, clave, 'escaneo', '192.168.4.10')?.id).toBe(fila.id)
    expect(leerClave(db, fila.id)!.ultimoUsoIp).toBe('192.168.4.10')
  })

  it('no vale: otra clave, vacía, revocada o caducada', () => {
    const db = nuevaDb()
    const { clave, fila } = crearClave(db, 'real', DATOS, 'admin')
    expect(verificarClave(db, clave + 'x', 'escaneo', null)).toBeNull()
    expect(verificarClave(db, null, 'escaneo', null)).toBeNull()
    expect(verificarClave(db, '', 'escaneo', null)).toBeNull()

    db.prepare('UPDATE api_claves SET caduca_el = ? WHERE id = ?').run(ayer(), fila.id)
    expect(verificarClave(db, clave, 'escaneo', null)).toBeNull()
    db.prepare('UPDATE api_claves SET caduca_el = NULL WHERE id = ?').run(fila.id)
    expect(verificarClave(db, clave, 'escaneo', null)).not.toBeNull()
    revocarClave(db, fila.id, 'admin')
    expect(verificarClave(db, clave, 'escaneo', null)).toBeNull()
    expect(leerClave(db, fila.id)!.revocadaPor).toBe('admin')
  })

  it('solo para las APIs que tenga marcadas', () => {
    const db = nuevaDb()
    const { clave } = crearClave(db, 'prueba', DATOS, null)
    expect(verificarClave(db, clave, 'otra' as any, null)).toBeNull()
  })
})

describe('gestión', () => {
  it('editar cambia la configuración, no la clave', () => {
    const db = nuevaDb()
    const { clave, fila } = crearClave(db, 'prueba', DATOS, null)
    editarClave(db, fila.id, { ...DATOS, nombre: 'ERP QA', caducaEl: manana(), notas: 'Contacto: sistemas' })
    expect(leerClave(db, fila.id)).toMatchObject({ nombre: 'ERP QA', caducaEl: manana(), notas: 'Contacto: sistemas', prefijo: fila.prefijo })
    expect(verificarClave(db, clave, 'escaneo', null)).not.toBeNull()
  })

  it('eliminar solo las que ya no valen', () => {
    const db = nuevaDb()
    const { fila } = crearClave(db, 'prueba', DATOS, null)
    expect(eliminarClave(db, fila.id)).toEqual({ error: 'Revoca la clave antes de eliminarla' })
    revocarClave(db, fila.id, null)
    expect(eliminarClave(db, fila.id)).toEqual({})
    expect(listarClaves(db)).toEqual([])
  })

  it('rotar: clave nueva con la misma configuración; la vieja vale N días más o se revoca ya', () => {
    const db = nuevaDb()
    const ahora = new Date()
    const vieja = crearClave(db, 'real', { ...DATOS, notas: 'ERP' }, null)
    const r = rotarClave(db, vieja.fila.id, '7', 'admin', ahora)
    if ('error' in r) throw new Error(r.error)
    expect(r.clave).not.toBe(vieja.clave)
    expect(r.fila).toMatchObject({ nombre: 'ERP pruebas', entorno: 'real', ambitos: ['escaneo'], notas: 'ERP' })
    expect(leerClave(db, vieja.fila.id)!.caducaEl).toBe(hoyLocal(new Date(ahora.getTime() + 7 * 86_400_000)))
    // Durante el cambio valen las dos
    expect(verificarClave(db, vieja.clave, 'escaneo', null)).not.toBeNull()
    expect(verificarClave(db, r.clave, 'escaneo', null)).not.toBeNull()

    const r2 = rotarClave(db, r.fila.id, 'ahora', 'admin')
    if ('error' in r2) throw new Error(r2.error)
    expect(verificarClave(db, r.clave, 'escaneo', null)).toBeNull()
    expect(rotarClave(db, r.fila.id, '1', 'admin')).toEqual({ error: 'Solo se puede rotar una clave activa' })
  })

  it('rotar respeta una caducidad anterior de la vieja', () => {
    const db = nuevaDb()
    const vieja = crearClave(db, 'prueba', { ...DATOS, caducaEl: manana() }, null)
    rotarClave(db, vieja.fila.id, '7', null)
    expect(leerClave(db, vieja.fila.id)!.caducaEl).toBe(manana())
  })
})

describe('dentroDelLimite', () => {
  it('como mucho N por minuto y por clave; luego dice cuánto esperar', () => {
    const t0 = 1_000_000_000
    for (let i = 0; i < 3; i++) expect(dentroDelLimite(901, t0 + i, 3)).toEqual({ ok: true })
    expect(dentroDelLimite(901, t0 + 20_000, 3)).toEqual({ ok: false, reintentarEn: 40 })
    // Otra clave tiene su propia cuenta
    expect(dentroDelLimite(902, t0 + 20_000, 3)).toEqual({ ok: true })
    // Pasado el minuto, vuelve a empezar
    expect(dentroDelLimite(901, t0 + 60_000, 3)).toEqual({ ok: true })
  })
})
