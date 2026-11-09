/**
 * Tests de los presets de filtros — preset predeterminado (PATCH /api/presets/[id]).
 *
 * Usa bun:sqlite en memoria; mismo montaje de mocks que admin-guards.test.ts.
 *
 * Cubre:
 * - Marcar un preset como predeterminado desmarca el anterior (solo uno por usuario y panel)
 * - Paneles distintos son independientes
 * - Se puede quitar el predeterminado
 * - Un usuario no puede tocar los presets de otro → 404 y no cambia nada
 * - Cuerpo inválido → 400
 * - El GET devuelve es_predeterminado
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { NextRequest } from 'next/server'

function createTestDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      must_change_password INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE presets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      filters TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      screen TEXT NOT NULL DEFAULT 'produccion',
      es_predeterminado INTEGER NOT NULL DEFAULT 0,
      UNIQUE(user_id, name)
    );
    INSERT INTO users (id, username) VALUES (1, 'ana');
    INSERT INTO users (id, username) VALUES (2, 'luis');
    INSERT INTO presets (id, user_id, name, filters, screen) VALUES (1, 1, 'Uno',  '{"clientes":[1]}', 'servicio');
    INSERT INTO presets (id, user_id, name, filters, screen) VALUES (2, 1, 'Dos',  '{"clientes":[2]}', 'servicio');
    INSERT INTO presets (id, user_id, name, filters, screen) VALUES (3, 1, 'Otro', '{}',               'caducados');
    INSERT INTO presets (id, user_id, name, filters, screen) VALUES (4, 2, 'Luis', '{"clientes":[9]}', 'servicio');
  `)
  return db
}

const ctx = { db: createTestDb(), session: { id: 1, username: 'ana', role: 'user', name: '', surname: '' } as any }

mock.module('@/lib/sqlite', () => ({ getDb: () => ctx.db }))
mock.module('@/lib/auth', () => ({
  verifySession: async () => ctx.session,
  hashPassword: (p: string) => `hashed:${p}`,
  verifyPassword: () => true,
  createToken: async () => 'mock-token',
  cookieOptions: () => ({ httpOnly: true, path: '/' }),
  COOKIE_NAME: 'session',
}))

const { PATCH: patchPreset } = await import('@/app/api/presets/[id]/route')
const { GET: getPresets } = await import('@/app/api/presets/route')

beforeEach(() => { ctx.db = createTestDb() })

const patch = (id: number, body: unknown) =>
  patchPreset(
    new NextRequest('http://localhost/test', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: String(id) }) },
  )
const predeterminados = () =>
  (ctx.db.prepare('SELECT id FROM presets WHERE es_predeterminado = 1 ORDER BY id').all() as { id: number }[]).map((r) => r.id)

describe('preset predeterminado', () => {
  it('marcar uno desmarca el anterior del mismo panel', async () => {
    expect((await patch(1, { predeterminado: true })).status).toBe(200)
    expect(predeterminados()).toEqual([1])
    expect((await patch(2, { predeterminado: true })).status).toBe(200)
    expect(predeterminados()).toEqual([2])
  })

  it('otro panel del mismo usuario no se toca', async () => {
    await patch(3, { predeterminado: true }) // caducados
    await patch(1, { predeterminado: true }) // servicio
    expect(predeterminados()).toEqual([1, 3])
  })

  it('se puede quitar el predeterminado', async () => {
    await patch(1, { predeterminado: true })
    expect((await patch(1, { predeterminado: false })).status).toBe(200)
    expect(predeterminados()).toEqual([])
  })

  it('no se puede tocar el preset de otro usuario → 404 y nada cambia', async () => {
    const res = await patch(4, { predeterminado: true }) // es de luis
    expect(res.status).toBe(404)
    expect(predeterminados()).toEqual([])
  })

  it('el predeterminado de otro usuario no se desmarca', async () => {
    ctx.db.prepare('UPDATE presets SET es_predeterminado = 1 WHERE id = 4').run()
    await patch(1, { predeterminado: true })
    expect(predeterminados()).toEqual([1, 4])
  })

  it('cuerpo inválido → 400', async () => {
    expect((await patch(1, { predeterminado: 'si' })).status).toBe(400)
    expect((await patch(1, {})).status).toBe(400)
    expect(predeterminados()).toEqual([])
  })

  it('el GET devuelve es_predeterminado solo de los presets del usuario y del panel', async () => {
    await patch(2, { predeterminado: true })
    const res = await getPresets(new NextRequest('http://localhost/api/presets?screen=servicio'))
    const lista = await res.json() as { id: number; es_predeterminado: number }[]
    // ordenados por nombre ('Dos', 'Uno'); sin los de otro usuario ni los de otro panel
    expect(lista.map((p) => [p.id, p.es_predeterminado])).toEqual([[2, 1], [1, 0]])
  })
})
