/**
 * Test de lib/loteadora-registro.ts — registro de envíos a las loteadoras.
 * BD en memoria (bun:sqlite) con el mismo esquema que lib/sqlite.ts.
 */
import { describe, it, expect } from 'bun:test'
import { Database } from 'bun:sqlite'
import { buscarEnvios, maquinasDelRegistro, registrarEnvio, type EnvioRegistro } from '@/lib/loteadora-registro'

function nuevaBd() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE loteadora_envios (
      id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      loteadora_id INTEGER NOT NULL, loteadora TEXT NOT NULL, usuario TEXT, plantilla TEXT NOT NULL,
      articulo_id TEXT NOT NULL, articulo_desc TEXT, campos TEXT NOT NULL, datos TEXT NOT NULL,
      resultado TEXT NOT NULL, mensaje TEXT, lineas TEXT
    );
  `)
  return db as any
}

const envio = (cambios: Partial<EnvioRegistro>): EnvioRegistro => ({
  loteadoraId: 1, loteadora: 'Línea 2', usuario: 'Operaria A', plantilla: 'N01_X', articuloId: '1234567890',
  articuloDesc: 'Producto de prueba', campos: [{ fieldId: 1, texto: 'L263641 ' }], datos: { fresco: '263221', turno: '1' },
  resultado: 'ok', mensaje: null, lineas: null, ...cambios,
})

describe('registro de envíos', () => {
  it('guarda cada envío y lo devuelve tal cual, el más reciente primero', () => {
    const db = nuevaBd()
    registrarEnvio(db, envio({}))
    registrarEnvio(db, envio({ resultado: 'error', mensaje: 'Tiempo de espera agotado' }))
    const { filas, total } = buscarEnvios(db, {})
    expect(total).toBe(2)
    expect(filas[0]).toMatchObject({ resultado: 'error', mensaje: 'Tiempo de espera agotado', campos: [{ fieldId: 1, texto: 'L263641 ' }] })
    expect(filas[1].datos).toEqual({ fresco: '263221', turno: '1' })
  })

  it('guarda la etiqueta tal como quedaba al enviar, con el reloj marcado', () => {
    const db = nuevaBd()
    const lineas = [[{ texto: 'L263641 ' }, { texto: 'HHmm', reloj: true }], [{ texto: 'CAD 06/01/27' }]]
    registrarEnvio(db, envio({ lineas }))
    registrarEnvio(db, envio({}))
    const { filas } = buscarEnvios(db, {})
    expect(filas[1].lineas).toEqual(lineas)
    expect(filas[0].lineas).toBeNull()
  })

  it('filtra por máquina, usuario, búsqueda (lote, artículo...) y fechas', () => {
    const db = nuevaBd()
    registrarEnvio(db, envio({}))
    registrarEnvio(db, envio({ loteadoraId: 2, loteadora: 'Línea 1', usuario: 'Operario B', datos: { fresco: '999111' } }))
    expect(buscarEnvios(db, { loteadoraId: 2 }).total).toBe(1)
    expect(buscarEnvios(db, { usuario: 'operario b' }).total).toBe(1)
    expect(buscarEnvios(db, { q: '999111' }).total).toBe(1)
    expect(buscarEnvios(db, { q: '1234567890' }).total).toBe(2)
    expect(buscarEnvios(db, { desde: '2000-01-01', hasta: '2999-12-31' }).total).toBe(2)
    expect(buscarEnvios(db, { hasta: '2000-01-01' }).total).toBe(0)
  })

  it('pagina de 50 en 50', () => {
    const db = nuevaBd()
    for (let i = 0; i < 55; i++) registrarEnvio(db, envio({}))
    expect(buscarEnvios(db, { pagina: 1 }).filas).toHaveLength(50)
    expect(buscarEnvios(db, { pagina: 2 }).filas).toHaveLength(5)
    expect(buscarEnvios(db, { pagina: 2 }).total).toBe(55)
  })

  it('el filtro de máquinas usa el último nombre de cada una', () => {
    const db = nuevaBd()
    registrarEnvio(db, envio({ loteadora: 'Nombre viejo' }))
    registrarEnvio(db, envio({ loteadora: 'Línea 2' }))
    registrarEnvio(db, envio({ loteadoraId: 3, loteadora: 'Línea 3' }))
    expect(maquinasDelRegistro(db)).toEqual([{ id: 1, nombre: 'Línea 2' }, { id: 3, nombre: 'Línea 3' }])
  })
})
