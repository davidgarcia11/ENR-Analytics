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

    CREATE TABLE users (
      id       INTEGER PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      role     TEXT NOT NULL,
      must_change_password   INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE user_permissions (
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      permission TEXT NOT NULL,
      PRIMARY KEY (user_id, permission)
    );
    CREATE TABLE role_permissions (
      role_id    INTEGER NOT NULL,
      permission TEXT NOT NULL,
      PRIMARY KEY (role_id, permission)
    );

    INSERT INTO users VALUES (1, 'admin', 'admin',      0);
    INSERT INTO users VALUES (2, 'user1', 'user',       0);
    INSERT INTO users VALUES (3, 'sup1',  'supervisor', 0);

    -- sup1 tiene el permiso de muestras y el de asignar artículos a plantillas;
    -- una clave que ya no está en el catálogo se ignora.
    INSERT INTO user_permissions VALUES (3, 'muestras.config');
    INSERT INTO user_permissions VALUES (3, 'admin.loteadora.articulos');
    INSERT INTO user_permissions VALUES (2, 'permiso.que.ya.no.existe');

    -- calidad1 no tiene extras: su permiso le viene del rol 'calidad'
    INSERT INTO users VALUES (4, 'calidad1', 'calidad', 0);
    INSERT INTO roles VALUES (4, 'calidad', 'Calidad');
    INSERT INTO role_permissions VALUES (4, 'admin.loteadora.articulos');
    INSERT INTO user_permissions VALUES (4, 'muestras.config');

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

const { requireAccess, requireScreenAccess, requireAdmin, getAllScreensConfig, permisosDeUsuario, permisosDeRol, puedeVerPaginaAdmin, puedeUsarApiAdmin } = await import('@/lib/permissions')

// ── Helpers ───────────────────────────────────────────────────────────────
const sinSesion  = () => { _mockSession = null }
const comoAdmin  = () => { _mockSession = { id: 1, username: 'admin',  role: 'admin',      name: '', surname: '' } }
const comoUser   = () => { _mockSession = { id: 2, username: 'user1',  role: 'user',       name: '', surname: '' } }
const comoSuperv = () => { _mockSession = { id: 3, username: 'sup1',   role: 'supervisor', name: '', surname: '' } }
const comoCalidad = () => { _mockSession = { id: 4, username: 'calidad1', role: 'calidad', name: '', surname: '' } }

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

// ─────────────────────────────────────────────────────────────────────────
// requireAccess: el helper único al que delegan los tres mecanismos que antes
// vivían sueltos (pantalla, rol y flag por usuario).
// ─────────────────────────────────────────────────────────────────────────
describe('requireAccess — regla `screen`', () => {
  it('pantalla pública sin sesión → ok, user null', async () => {
    sinSesion()
    const r = await requireAccess({ screen: 'produccion' })
    expect(r.ok).toBe(true)
    expect(r.ok && r.user).toBeNull()
  })

  it('pantalla privada con rol permitido → ok y devuelve el usuario', async () => {
    comoSuperv()
    const r = await requireAccess({ screen: 'privado' })
    expect(r.ok).toBe(true)
    expect(r.ok && r.user?.username).toBe('sup1')
  })

  it('pantalla privada con rol no permitido → 403', async () => {
    comoUser()
    const r = await requireAccess({ screen: 'privado' })
    expect(r.ok).toBe(false)
    expect(!r.ok && r.denied.status).toBe(403)
  })
})

describe('requireAccess — regla `role`', () => {
  it('sin sesión → 401 (no 403: el matiz importa para el cliente)', async () => {
    sinSesion()
    const r = await requireAccess({ role: 'admin' })
    expect(!r.ok && r.denied.status).toBe(401)
  })

  it('rol distinto → 403', async () => {
    comoUser()
    const r = await requireAccess({ role: 'admin' })
    expect(!r.ok && r.denied.status).toBe(403)
  })

  it('rol correcto → ok', async () => {
    comoAdmin()
    expect((await requireAccess({ role: 'admin' })).ok).toBe(true)
  })
})

describe('requireAccess — regla `permiso`', () => {
  it('sin sesión → 401', async () => {
    sinSesion()
    const r = await requireAccess({ permiso: 'muestras.config' })
    expect(!r.ok && r.denied.status).toBe(401)
  })

  it('usuario sin el permiso → 403', async () => {
    comoUser()
    const r = await requireAccess({ permiso: 'muestras.config' })
    expect(!r.ok && r.denied.status).toBe(403)
  })

  it('usuario con el permiso → ok', async () => {
    comoSuperv()
    expect((await requireAccess({ permiso: 'muestras.config' })).ok).toBe(true)
  })

  it('admin pasa sin tener fila en user_permissions', async () => {
    comoAdmin()
    expect((await requireAccess({ permiso: 'muestras.config' })).ok).toBe(true)
  })
})

describe('permisosDeUsuario', () => {
  it('devuelve solo claves del catálogo', () => {
    expect(permisosDeUsuario(3, 'supervisor').sort()).toEqual(['admin.loteadora.articulos', 'muestras.config'])
    expect(permisosDeUsuario(2, 'user')).toEqual([])
  })
})

describe('permisos concedidos a un rol', () => {
  it('el usuario hereda los de su rol y suma sus extras', () => {
    expect(permisosDeRol('calidad')).toEqual(['admin.loteadora.articulos'])
    expect(permisosDeUsuario(4, 'calidad').sort()).toEqual(['admin.loteadora.articulos', 'muestras.config'])
  })

  it('requireAccess pasa por el permiso del rol', async () => {
    comoCalidad()
    expect((await requireAccess({ permiso: 'admin.loteadora.articulos' })).ok).toBe(true)
  })

  it('el proxy le abre /admin y las rutas de su permiso, nada más', () => {
    expect(puedeVerPaginaAdmin(4, 'calidad')).toBe(true)
    expect(puedeUsarApiAdmin('/api/admin/loteadora-articulos', 'POST', 4, 'calidad')).toBe(true)
    expect(puedeUsarApiAdmin('/api/admin/users', 'GET', 4, 'calidad')).toBe(false)
  })
})

describe('/admin para usuarios sin rol admin (proxy)', () => {
  it('página /admin: entra si algún permiso desbloquea una sección', () => {
    expect(puedeVerPaginaAdmin(3, 'supervisor')).toBe(true)
    expect(puedeVerPaginaAdmin(2, 'user')).toBe(false)
    expect(puedeVerPaginaAdmin(1, 'admin')).toBe(true)
  })

  it('API: solo las rutas mapeadas a un permiso que tenga', () => {
    expect(puedeUsarApiAdmin('/api/admin/loteadora-articulos', 'POST', 3, 'supervisor')).toBe(true)
    expect(puedeUsarApiAdmin('/api/admin/loteadora-articulos/1210100221', 'DELETE', 3, 'supervisor')).toBe(true)
    expect(puedeUsarApiAdmin('/api/admin/loteadora-mensajes', 'GET', 3, 'supervisor')).toBe(true)
  })

  it('API: denegado por defecto todo lo demás', () => {
    // mismo prefijo pero método no abierto
    expect(puedeUsarApiAdmin('/api/admin/loteadora-mensajes', 'POST', 3, 'supervisor')).toBe(false)
    expect(puedeUsarApiAdmin('/api/admin/loteadora-mensajes/5', 'PUT', 3, 'supervisor')).toBe(false)
    // ruta no mapeada
    expect(puedeUsarApiAdmin('/api/admin/users', 'GET', 3, 'supervisor')).toBe(false)
    // prefijo parecido que no es la misma ruta
    expect(puedeUsarApiAdmin('/api/admin/loteadora-articulos-x', 'GET', 3, 'supervisor')).toBe(false)
    // usuario sin el permiso
    expect(puedeUsarApiAdmin('/api/admin/loteadora-articulos', 'GET', 2, 'user')).toBe(false)
  })
})

describe('requireAccess — varias reglas a la vez (AND)', () => {
  it('una pantalla pública NO cortocircuita la regla de rol', async () => {
    comoUser()
    const r = await requireAccess({ screen: 'produccion', role: 'admin' })
    expect(!r.ok && r.denied.status).toBe(403)
  })

  it('sin reglas → ok (no restringe nada)', async () => {
    sinSesion()
    expect((await requireAccess()).ok).toBe(true)
  })
})

describe('envoltorios — mismo resultado que el helper', () => {
  it('requireScreenAccess devuelve null donde requireAccess dice ok', async () => {
    comoSuperv()
    expect(await requireScreenAccess('privado')).toBeNull()
    expect((await requireAccess({ screen: 'privado' })).ok).toBe(true)
  })

  it('requireScreenAccess propaga el 403 de requireAccess', async () => {
    comoUser()
    const wrapper = await requireScreenAccess('privado')
    const helper = await requireAccess({ screen: 'privado' })
    expect(wrapper!.status).toBe(403)
    expect(!helper.ok && helper.denied.status).toBe(403)
  })

  it('requireAdmin: admin null, user 403, sin sesión 401', async () => {
    comoAdmin()
    expect(await requireAdmin()).toBeNull()
    comoUser()
    expect((await requireAdmin())!.status).toBe(403)
    sinSesion()
    expect((await requireAdmin())!.status).toBe(401)
  })
})

// ── Cambio de contraseña obligatorio ──────────────────────────────────────
// Hasta ahora esto solo lo impedía el cliente: con must_change_password = 1
// bastaba llamar a la API a mano para seguir trabajando con la provisional.
describe('requireAccess — must_change_password', () => {
  const marcar = (id: number, v: number) =>
    testDb.prepare('UPDATE users SET must_change_password = ? WHERE id = ?').run(v, id)

  beforeEach(() => { marcar(1, 0); marcar(2, 0) })

  it('usuario con la contraseña marcada → 403 aunque tenga permiso', async () => {
    comoSuperv()
    marcar(3, 1)
    const res = await requireAccess({ screen: 'privado' })
    expect(res.ok).toBe(false)
    expect(!res.ok && res.denied.status).toBe(403)
    marcar(3, 0)
  })

  it('admin con la contraseña marcada → 403 (no se salta por ser admin)', async () => {
    comoAdmin()
    marcar(1, 1)
    expect((await requireAdmin())!.status).toBe(403)
  })

  it('también bloquea en una pantalla pública, que si no sería la puerta de atrás', async () => {
    comoUser()
    marcar(2, 1)
    expect((await requireScreenAccess('produccion'))!.status).toBe(403)
  })

  it('el cuerpo del error trae mustChangePassword para que el cliente sepa a dónde mandarlo', async () => {
    comoUser()
    marcar(2, 1)
    const res = await requireAccess({ screen: 'produccion' })
    expect(!res.ok && await res.denied.json()).toMatchObject({ mustChangePassword: true })
  })

  it('sin la marca → pasa con normalidad', async () => {
    comoUser()
    expect(await requireScreenAccess('produccion')).toBeNull()
  })

  it('anónimo en pantalla pública no paga la comprobación → pasa', async () => {
    sinSesion()
    expect(await requireScreenAccess('produccion')).toBeNull()
  })

  it('token válido de un usuario ya borrado → 401', async () => {
    _mockSession = { id: 99, username: 'fantasma', role: 'admin', name: '', surname: '' }
    expect((await requireScreenAccess('produccion'))!.status).toBe(401)
  })
})

// ── Control de acceso en cliente ──────────────────────────────────────────
// Guarda anti-regresión de la migración a <SessionProvider>: antes cada página
// se montaba su propio fetch('/api/auth/me') y su propia copia de la regla de
// acceso (13 copias, 4 formas distintas). Si alguien vuelve a añadir una, este
// test lo caza en vez de descubrirse cuando una copia se queda desfasada.
describe('páginas: control de acceso centralizado', () => {
  const { readdirSync, readFileSync, statSync } = require('node:fs') as typeof import('node:fs')
  const { join, sep } = require('node:path') as typeof import('node:path')

  const paginas: string[] = []
  const recorrer = (dir: string) => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e)
      if (statSync(p).isDirectory()) { if (e !== 'api') recorrer(p) }
      else if (e === 'page.tsx') paginas.push(p)
    }
  }
  recorrer('app')

  // El login es el único sitio que puede hablar con la API de sesión por su
  // cuenta: se ejecuta justo cuando todavía no hay sesión que compartir.
  const exentas = [join('app', 'login', 'page.tsx')]

  it('ninguna página consulta /api/auth/me por su cuenta', () => {
    const culpables = paginas.filter(p => !exentas.includes(p) && readFileSync(p, 'utf8').includes('/api/auth/me'))
    expect(culpables).toEqual([])
  })

  it('toda página de panel pasa por <RequireAccess>', () => {
    const sinPuerta = paginas.filter(p => {
      const ruta = p.split(sep).join('/')
      // La portada y el login no son paneles; cambiar-contraseña tiene la puerta al revés.
      if (ruta === 'app/page.tsx') return false
      if (ruta.includes('login') || ruta.includes('cambiar-contrasena')) return false
      return !readFileSync(p, 'utf8').includes('<RequireAccess')
    })
    expect(sinPuerta).toEqual([])
  })
})
