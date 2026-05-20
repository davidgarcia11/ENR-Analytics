/**
 * Tests del sistema de permisos por pantalla (lib/permissions.ts)
 *
 * Usa bun:sqlite en memoria para aislar los tests de la BD real.
 * Mockea @/lib/sqlite y @/lib/auth antes de importar el módulo bajo test.
 *
 * Cubre:
 * - Pantalla pública → acceso sin sesión
 * - Clave desconocida → pasa (sin restricción)
 * - Pantalla privada, sin sesión → 401
 * - Pantalla privada, rol incorrecto → 403
 * - Pantalla privada, rol correcto → null
 * - Admin → siempre null
 * - getAllScreensConfig → estructura correcta
 * - Inyección SQL en la clave de pantalla → manejada como literal
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test'
import { Database } from 'bun:sqlite'

// ── DB de test en memoria ─────────────────────────────────────────────────
function createTestDb() {
  const db = new Database(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec(`
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
    INSERT INTO roles VALUES (2, 'user',       'Usuario');
    INSERT INTO roles VALUES (3, 'supervisor', 'Supervisor');

    INSERT INTO screens VALUES (1, 'produccion', 'Producción', '/produccion', 1);
    INSERT INTO screens VALUES (2, 'admin',       'Admin',      '/admin',      0);
    INSERT INTO screens VALUES (3, 'privado',     'Privado',    '/privado',    0);

    INSERT INTO screen_permissions VALUES (2, 1);
    INSERT INTO screen_permissions VALUES (3, 1);
    INSERT INTO screen_permissions VALUES (3, 3);
  `)
  return db
}

let testDb = createTestDb()
let _mockSession: { id: number; username: string; role: string; name: string; surname: string } | null = null

// ── Mocks ANTES del import dinámico ──────────────────────────────────────
mock.module('@/lib/sqlite', () => ({ getDb: () => testDb }))
mock.module('@/lib/auth',   () => ({ verifySession: async () => _mockSession }))

const { requireScreenAccess, getAllScreensConfig } = await import('@/lib/permissions')

// ── Helpers ───────────────────────────────────────────────────────────────
const sinSesion  = () => { _mockSession = null }
const comoAdmin  = () => { _mockSession = { id: 1, username: 'admin',  role: 'admin',      name: '', surname: '' } }
const comoUser   = () => { _mockSession = { id: 2, username: 'user1',  role: 'user',       name: '', surname: '' } }
const comoSuperv = () => { _mockSession = { id: 3, username: 'sup1',   role: 'supervisor', name: '', surname: '' } }

// ─────────────────────────────────────────────────────────────────────────
describe('requireScreenAccess — pantallas públicas', () => {
  beforeEach(sinSesion)

  it('pantalla pública sin sesión → null (acceso permitido)', async () => {
    expect(await requireScreenAccess('produccion')).toBeNull()
  })

  it('clave desconocida → null (pasa sin restricción)', async () => {
    expect(await requireScreenAccess('pantalla_que_no_existe')).toBeNull()
  })

  it('pantalla pública con sesión activa → también null', async () => {
    comoUser()
    expect(await requireScreenAccess('produccion')).toBeNull()
  })
})

describe('requireScreenAccess — pantalla privada, sin sesión', () => {
  beforeEach(sinSesion)

  it('pantalla privada sin cookie → 401', async () => {
    const res = await requireScreenAccess('privado')
    expect(res).not.toBeNull()
    expect(res!.status).toBe(401)
  })

  it('pantalla admin sin cookie → 401', async () => {
    const res = await requireScreenAccess('admin')
    expect(res).not.toBeNull()
    expect(res!.status).toBe(401)
  })
})

describe('requireScreenAccess — pantalla privada, rol incorrecto', () => {
  it('rol "user" en pantalla "privado" → 403', async () => {
    comoUser()
    const res = await requireScreenAccess('privado')
    expect(res!.status).toBe(403)
  })

  it('rol "user" en pantalla "admin" → 403', async () => {
    comoUser()
    const res = await requireScreenAccess('admin')
    expect(res!.status).toBe(403)
  })

  it('rol "supervisor" en pantalla "admin" → 403', async () => {
    comoSuperv()
    const res = await requireScreenAccess('admin')
    expect(res!.status).toBe(403)
  })
})

describe('requireScreenAccess — rol correcto', () => {
  it('rol "supervisor" en pantalla "privado" → null', async () => {
    comoSuperv()
    expect(await requireScreenAccess('privado')).toBeNull()
  })
})

describe('requireScreenAccess — admin bypass', () => {
  beforeEach(comoAdmin)

  it('admin en pantalla privada → null', async () => {
    expect(await requireScreenAccess('privado')).toBeNull()
  })

  it('admin en pantalla admin → null', async () => {
    expect(await requireScreenAccess('admin')).toBeNull()
  })

  it('admin en pantalla pública → null', async () => {
    expect(await requireScreenAccess('produccion')).toBeNull()
  })

  it('admin con clave inexistente → null', async () => {
    expect(await requireScreenAccess('no_existe')).toBeNull()
  })
})

describe('requireScreenAccess — inyección en clave de pantalla', () => {
  beforeEach(sinSesion)

  it("OR injection en clave → no encuentra pantalla, pasa como null", async () => {
    const result = await requireScreenAccess("produccion' OR '1'='1")
    expect(result).toBeNull()
  })

  it("UNION injection en clave → tratada como literal, pasa como null", async () => {
    const result = await requireScreenAccess("x' UNION SELECT 1,2,3--")
    expect(result).toBeNull()
  })
})

describe('getAllScreensConfig', () => {
  it('devuelve todas las pantallas registradas', () => {
    const cfg = getAllScreensConfig()
    expect(Object.keys(cfg)).toContain('produccion')
    expect(Object.keys(cfg)).toContain('admin')
    expect(Object.keys(cfg)).toContain('privado')
  })

  it('pantalla pública tiene is_public = true', () => {
    expect(getAllScreensConfig()['produccion'].is_public).toBe(true)
  })

  it('pantalla admin tiene is_public = false', () => {
    expect(getAllScreensConfig()['admin'].is_public).toBe(false)
  })

  it('pantalla privada devuelve los roles con acceso', () => {
    const roles = getAllScreensConfig()['privado'].allowed_roles
    expect(roles).toContain('admin')
    expect(roles).toContain('supervisor')
    expect(roles).not.toContain('user')
  })

  it('pantalla pública tiene allowed_roles como array', () => {
    expect(Array.isArray(getAllScreensConfig()['produccion'].allowed_roles)).toBe(true)
  })
})
