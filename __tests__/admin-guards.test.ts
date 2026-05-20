/**
 * Tests de las reglas de protección del panel de administración
 *
 * Usa bun:sqlite en memoria. Los handlers se importan dinámicamente tras mockear
 * @/lib/sqlite y @/lib/auth. El middleware ya verifica JWT antes de llegar
 * aquí; estos tests comprueban las reglas de negocio internas.
 *
 * Cubre:
 * - Rol "admin" no se puede eliminar
 * - Usuarios del rol borrado son reasignados a "user"
 * - Pantalla "admin" no se puede modificar
 * - Roles con inyección SQL en allowed_roles son ignorados (bind variables)
 * - Admin siempre mantiene acceso aunque no esté en allowed_roles
 * - Nombre de rol sanitizado antes de insertar
 * - Rol duplicado → 409
 * - No poder auto-eliminarse como usuario
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { NextRequest } from 'next/server'

// ── DB de test ────────────────────────────────────────────────────────────
function createTestDb() {
  const db = new Database(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL DEFAULT 'x',
      role TEXT NOT NULL DEFAULT 'user',
      must_change_password INTEGER NOT NULL DEFAULT 0,
      name TEXT NOT NULL DEFAULT '',
      surname TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE roles (
      id    INTEGER PRIMARY KEY AUTOINCREMENT,
      name  TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL
    );
    CREATE TABLE screens (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      key       TEXT NOT NULL UNIQUE,
      label     TEXT NOT NULL,
      path      TEXT NOT NULL,
      is_public INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE screen_permissions (
      screen_id INTEGER NOT NULL,
      role_id   INTEGER NOT NULL,
      PRIMARY KEY (screen_id, role_id)
    );

    INSERT INTO roles VALUES (1, 'admin',      'Administrador');
    INSERT INTO roles VALUES (2, 'user',        'Usuario');
    INSERT INTO roles VALUES (3, 'supervisor',  'Supervisor');

    INSERT INTO screens VALUES (1, 'produccion', 'Producción', '/produccion', 1);
    INSERT INTO screens VALUES (2, 'admin',       'Admin',      '/admin',      0);

    INSERT INTO users (id, username, role) VALUES (1, 'admin', 'admin');
    INSERT INTO users (id, username, role) VALUES (2, 'user1', 'user');
    INSERT INTO users (id, username, role) VALUES (3, 'sup1',  'supervisor');

    INSERT INTO screen_permissions VALUES (2, 1);
  `)
  return db
}

// Objeto mutable para que las closures del mock siempre lean el valor actual
const ctx = {
  db:      createTestDb(),
  session: { id: 1, username: 'admin', role: 'admin', name: '', surname: '' } as any,
}

// ── Mocks ANTES de importar los handlers ─────────────────────────────────
mock.module('@/lib/sqlite', () => ({ getDb: () => ctx.db }))
mock.module('@/lib/auth', () => ({
  verifySession:  async () => ctx.session,
  hashPassword:   (p: string) => `hashed:${p}`,
  verifyPassword: (_p: string, _h: string) => true,
  createToken:    async () => 'mock-token',
  cookieOptions:  () => ({ httpOnly: true, path: '/' }),
  COOKIE_NAME:    'session',
}))

const { DELETE: deleteRole }  = await import('@/app/api/admin/roles/[id]/route')
const { PUT:    putScreen }    = await import('@/app/api/admin/screens/[key]/route')
const { DELETE: deleteUser }   = await import('@/app/api/admin/users/[id]/route')
const { POST:   postRole }     = await import('@/app/api/admin/roles/route')

// ── Helpers ───────────────────────────────────────────────────────────────
beforeEach(() => { ctx.db = createTestDb() })

function deleteReq(): NextRequest {
  return new NextRequest('http://localhost/test', { method: 'DELETE' })
}
function postReq(body: object): NextRequest {
  return new NextRequest('http://localhost/test', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}
function putReq(body: object): NextRequest {
  return new NextRequest('http://localhost/test', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}
function params(p: Record<string, string>) {
  return { params: Promise.resolve(p) }
}

// ─────────────────────────────────────────────────────────────────────────
describe('Eliminación de roles', () => {
  it('no se puede eliminar el rol admin → 400', async () => {
    const res = await deleteRole(deleteReq(), params({ id: '1' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/admin/i)
  })

  it('el rol "user" sí se puede eliminar → 200', async () => {
    const res = await deleteRole(deleteReq(), params({ id: '2' }))
    expect(res.status).toBe(200)
  })

  it('al borrar un rol, los usuarios de ese rol pasan a "user"', async () => {
    const before = ctx.db.prepare('SELECT role FROM users WHERE username = ?').get('sup1') as any
    expect(before.role).toBe('supervisor')

    await deleteRole(deleteReq(), params({ id: '3' }))

    const after = ctx.db.prepare('SELECT role FROM users WHERE username = ?').get('sup1') as any
    expect(after.role).toBe('user')
  })

  it('al borrar un rol, el rol desaparece de la tabla', async () => {
    await deleteRole(deleteReq(), params({ id: '3' }))
    const rol = ctx.db.prepare('SELECT id FROM roles WHERE id = ?').get(3)
    expect(rol).toBeNull()
  })

  it('rol inexistente → 404', async () => {
    const res = await deleteRole(deleteReq(), params({ id: '9999' }))
    expect(res.status).toBe(404)
  })
})

describe('Modificación de pantallas', () => {
  it('no se puede modificar la pantalla "admin" → 400', async () => {
    const res = await putScreen(putReq({ is_public: true, allowed_roles: [] }), params({ key: 'admin' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/admin/i)
  })

  it('otras pantallas sí se pueden modificar → 200', async () => {
    const res = await putScreen(putReq({ is_public: false, allowed_roles: ['admin'] }), params({ key: 'produccion' }))
    expect(res.status).toBe(200)
  })

  it('pantalla inexistente → 404', async () => {
    const res = await putScreen(putReq({ is_public: false, allowed_roles: [] }), params({ key: 'noexiste' }))
    expect(res.status).toBe(404)
  })

  it('roles con inyección SQL en allowed_roles son ignorados silenciosamente', async () => {
    const maliciousRoles = ["' OR '1'='1", "admin; DROP TABLE roles;--", "'; DELETE FROM users;--"]
    const res = await putScreen(
      putReq({ is_public: false, allowed_roles: maliciousRoles }),
      params({ key: 'produccion' })
    )
    expect(res.status).toBe(200)

    // La tabla roles debe seguir intacta (inyección no ejecutada)
    const count = (ctx.db.prepare('SELECT COUNT(*) as c FROM roles').get() as any).c
    expect(count).toBe(3)
  })

  it('admin siempre mantiene acceso aunque no esté en allowed_roles', async () => {
    await putScreen(putReq({ is_public: false, allowed_roles: ['supervisor'] }), params({ key: 'produccion' }))

    const produccionId = (ctx.db.prepare("SELECT id FROM screens WHERE key = 'produccion'").get() as any).id
    const adminRoleId  = (ctx.db.prepare("SELECT id FROM roles WHERE name = 'admin'").get() as any).id

    const adminPerm = ctx.db.prepare(
      'SELECT 1 as found FROM screen_permissions WHERE screen_id = ? AND role_id = ?'
    ).get(produccionId, adminRoleId)

    expect((adminPerm as any)?.found).toBe(1)
  })

  it('allowed_roles nulo no rompe el handler', async () => {
    const res = await putScreen(putReq({ is_public: false, allowed_roles: null }), params({ key: 'produccion' }))
    expect(res.status).toBe(200)
  })
})

// Misma sanitización que usa el route handler (testeada también en sanitization.test.ts)
const sanitize = (name: string) => String(name).trim().toLowerCase().replace(/[^a-z0-9_]/g, '_')

describe('Creación de roles', () => {
  it('nombre vacío → 400', async () => {
    const res = await postRole(postReq({ name: '', label: 'Test' }))
    expect(res.status).toBe(400)
  })

  it('falta label → 400', async () => {
    const res = await postRole(postReq({ name: 'nuevo' }))
    expect(res.status).toBe(400)
  })

  it('nombre duplicado → 409', async () => {
    const res = await postRole(postReq({ name: 'admin', label: 'Intento duplicado' }))
    expect(res.status).toBe(409)
  })

  it('inyección SQL en nombre: sanitización + bind variables previenen DROP TABLE', () => {
    // Testeamos directamente sobre ctx.db para aislar la propiedad de seguridad:
    // 1) La sanitización elimina los caracteres peligrosos
    const rawInput = "'; DROP TABLE roles; --"
    const cleanName = sanitize(rawInput)
    expect(cleanName).toMatch(/^[a-z0-9_]+$/)
    expect(cleanName).not.toContain("'")
    expect(cleanName).not.toContain(';')

    // 2) El bind variable inserta el nombre literalmente, sin interpretar SQL
    ctx.db.prepare('INSERT INTO roles (name, label) VALUES (?, ?)').run(cleanName, 'Test')

    // 3) La tabla roles SIGUE EXISTIENDO (el DROP TABLE no se ejecutó)
    const tables = (ctx.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as any[])
      .map((r: any) => r.name)
    expect(tables).toContain('roles')

    // 4) El nombre insertado es el limpio, no el original con SQL
    const inserted = ctx.db.prepare('SELECT name FROM roles WHERE name = ?').get(cleanName)
    expect(inserted).not.toBeNull()
  })

  it('nombre con espacios y mayúsculas → sanitizado a minúsculas con guiones bajos', () => {
    const cleanName = sanitize('  Jefe PRODUCCION  ')
    expect(cleanName).toBe('jefe_produccion')

    // Se puede insertar sin problemas
    const result = ctx.db.prepare('INSERT INTO roles (name, label) VALUES (?, ?)').run(cleanName, 'Jefe')
    expect((result as any).changes).toBe(1)
  })
})

describe('Eliminación de usuarios', () => {
  it('no se puede auto-eliminar el propio usuario → 400', async () => {
    ctx.session = { id: 1, username: 'admin', role: 'admin', name: '', surname: '' }
    const res = await deleteUser(deleteReq(), params({ id: '1' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/ti mismo/i)
  })

  it('sí se puede eliminar otro usuario → 200', async () => {
    ctx.session = { id: 1, username: 'admin', role: 'admin', name: '', surname: '' }
    const res = await deleteUser(deleteReq(), params({ id: '2' }))
    expect(res.status).toBe(200)

    const deleted = ctx.db.prepare('SELECT id FROM users WHERE id = ?').get(2)
    expect(deleted).toBeNull()
  })
})
