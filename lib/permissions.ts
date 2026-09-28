import { NextResponse } from 'next/server';
import { getDb } from './sqlite';
import { verifySession, type SessionUser } from './auth';
import { esPermiso, permisoDeRutaAdmin, puedeEntrarEnAdmin, type Permiso } from './permisos';

/**
 * Permisos efectivos del usuario: los de su rol (role_permissions) + sus extras
 * (user_permissions). Solo claves del catálogo. El admin no necesita filas: tiene
 * todos (ver usuarioTienePermiso / tienePermiso). `role` es el de la sesión (JWT),
 * igual que en usuarioTienePermiso y en los permisos de pantalla.
 */
export function permisosDeUsuario(userId: number, role: string): Permiso[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT permission FROM user_permissions WHERE user_id = ?
    UNION
    SELECT rp.permission FROM role_permissions rp
    JOIN roles r ON r.id = rp.role_id
    WHERE r.name = ?
  `).all(userId, role) as { permission: string }[];
  return rows.map((r) => r.permission).filter(esPermiso);
}

/** Permisos concedidos a un rol (role_permissions), solo claves del catálogo. */
export function permisosDeRol(roleName: string): Permiso[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT rp.permission FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE r.name = ?
  `).all(roleName) as { permission: string }[];
  return rows.map((r) => r.permission).filter(esPermiso);
}

/** Con una lista, basta con tener uno de ellos. */
function usuarioTienePermiso(userId: number, role: string, permiso: Permiso | Permiso[]): boolean {
  if (role === 'admin') return true;
  if (Array.isArray(permiso)) return permiso.some((p) => usuarioTienePermiso(userId, role, p));
  const db = getDb();
  return !!db.prepare(`
    SELECT 1 FROM user_permissions WHERE user_id = ? AND permission = ?
    UNION ALL
    SELECT 1 FROM role_permissions rp JOIN roles r ON r.id = rp.role_id
    WHERE r.name = ? AND rp.permission = ?
  `).get(userId, permiso, role, permiso);
}

// Reglas de /admin para proxy.ts — misma fuente (lib/permisos.ts) que el sidebar y
// que requireAccess en cada ruta, para no tener dos versiones de la verdad.
export function puedeVerPaginaAdmin(userId: number, role: string): boolean {
  return puedeEntrarEnAdmin({ role, permisos: permisosDeUsuario(userId, role) });
}

export function puedeUsarApiAdmin(pathname: string, metodo: string, userId: number, role: string): boolean {
  if (role === 'admin') return true;
  const permiso = permisoDeRutaAdmin(pathname, metodo);
  return !!permiso && usuarioTienePermiso(userId, role, permiso);
}

export interface ScreenConfig {
  is_public: boolean;
  allowed_roles: string[];
}

export function getAllScreensConfig(): Record<string, ScreenConfig> {
  const db = getDb();
  const screens = db.prepare('SELECT id, key, is_public FROM screens').all() as { id: number; key: string; is_public: number }[];

  const result: Record<string, ScreenConfig> = {};
  for (const screen of screens) {
    const roles = db.prepare(`
      SELECT r.name FROM screen_permissions sp
      JOIN roles r ON r.id = sp.role_id
      WHERE sp.screen_id = ?
    `).all(screen.id) as { name: string }[];

    result[screen.key] = {
      is_public: screen.is_public === 1,
      allowed_roles: roles.map(r => r.name),
    };
  }
  return result;
}

/**
 * ¿Puede este rol ver esta pantalla? Es la regla de `screen`, aparte para que
 * `proxy.ts` la use tal cual al filtrar páginas — si no, sería una cuarta copia.
 * Devuelve el motivo, no un booleano, porque requireAccess necesita distinguir
 * 401 de 403 (el proxy manda los dos al login igual).
 */
export type AccesoPantalla = 'ok' | 'sin-sesion' | 'sin-permiso';

export function accesoPantalla(screenKey: string, role: string | null): AccesoPantalla {
  const db = getDb();
  const screen = db.prepare('SELECT id, is_public FROM screens WHERE key = ?').get(screenKey) as { id: number; is_public: number } | undefined;

  // Pantalla sin registrar → sin restricción. Deliberado: un panel nuevo que
  // todavía no se ha seedeado no debe quedar inaccesible por eso.
  // Pantalla pública → pasa sin sesión (así están seedeados casi todos).
  if (!screen || screen.is_public === 1) return 'ok';
  if (!role) return 'sin-sesion';
  if (role === 'admin') return 'ok';

  const permitido = db.prepare(`
    SELECT 1 FROM screen_permissions sp
    JOIN roles r ON r.id = sp.role_id
    WHERE sp.screen_id = ? AND r.name = ?
  `).get(screen.id, role);
  return permitido ? 'ok' : 'sin-permiso';
}

// ── Autorización: un único sitio ──────────────────────────────────────────
// Antes había tres mecanismos sueltos haciendo lo mismo con matices distintos:
// requireScreenAccess (permisos por pantalla), un `verifySession() + comprobar
// rol` copiado en cada ruta de admin, y requireMuestrasConfigAccess (permiso por
// usuario). Los tres siguen existiendo como envoltorios —para no tocar las ~20
// rutas que ya los llaman— pero la decisión y los cuerpos de error se deciden
// aquí y solo aquí.

export interface AccessRule {
  /** Clave de `screens`: aplica is_public + allowed_roles */
  screen?: string;
  /** Exige un rol concreto (hoy solo 'admin') */
  role?: string;
  /** Exige un permiso del catálogo (lib/permisos.ts), concedido al usuario o a su rol; admin siempre pasa. Con una lista, basta con uno */
  permiso?: Permiso | Permiso[];
  /** Exige sesión y nada más — rutas "de usuario" como los presets */
  sesion?: true;
}

export type AccessResult =
  /** `user` puede ser null: una pantalla pública se permite sin sesión */
  | { ok: true; user: SessionUser | null }
  | { ok: false; denied: NextResponse };

const noAutenticado = (): AccessResult => ({ ok: false, denied: NextResponse.json({ error: 'No autenticado' }, { status: 401 }) });
const noAutorizado = (): AccessResult => ({ ok: false, denied: NextResponse.json({ error: 'No autorizado' }, { status: 403 }) });
const debeCambiar = (): AccessResult => ({ ok: false, denied: NextResponse.json({ error: 'Debes cambiar la contraseña antes de seguir', mustChangePassword: true }, { status: 403 }) });

/**
 * Comprueba todas las reglas recibidas (AND) y devuelve el usuario o la
 * respuesta de error ya construida.
 *
 *   const acceso = await requireAccess({ screen: 'costes' });
 *   if (!acceso.ok) return acceso.denied;
 *   acceso.user // SessionUser | null
 */
export async function requireAccess(rules: AccessRule = {}): Promise<AccessResult> {
  const db = getDb();

  // La sesión se resuelve como mucho una vez, y solo si alguna regla la necesita
  // (una pantalla pública no debe pagar el jwtVerify).
  let cached: SessionUser | null | undefined;
  const getSession = async () => (cached === undefined ? (cached = await verifySession()) : cached);

  if (rules.sesion && !(await getSession())) return noAutenticado();

  if (rules.screen) {
    const user = await getSession();
    const acceso = accesoPantalla(rules.screen, user?.role ?? null);
    if (acceso === 'sin-sesion') return noAutenticado();
    if (acceso === 'sin-permiso') return noAutorizado();
  }

  if (rules.role) {
    const user = await getSession();
    if (!user) return noAutenticado();
    if (user.role !== rules.role) return noAutorizado();
  }

  if (rules.permiso) {
    const user = await getSession();
    if (!user) return noAutenticado();
    if (!usuarioTienePermiso(user.id, user.role, rules.permiso)) return noAutorizado();
  }

  // Contraseña marcada para cambio obligatorio: el token es válido y el usuario
  // existe, pero no puede hacer nada más que cambiarla. Hasta aquí esto solo lo
  // impedía el cliente (<RequireAccess> y el login), así que bastaba con llamar
  // a la API a mano —o tener la pestaña ya abierta cuando un admin reseteaba la
  // contraseña— para seguir trabajando con la contraseña provisional.
  //
  // No se mira el JWT sino la tabla: el token se emite al iniciar sesión y no se
  // entera de que un admin ha reseteado la contraseña después.
  //
  // /api/auth/{me,change-password,logout} no pasan por aquí, que es justo lo que
  // hace falta para poder cambiarla.
  const user = await getSession();
  if (user) {
    const row = db.prepare('SELECT must_change_password FROM users WHERE id = ?').get(user.id) as { must_change_password: number } | undefined;
    // Usuario borrado con el token todavía vivo: la misma consulta ya lo dice,
    // así que se aprovecha. Antes seguía entrando hasta que caducaba el JWT.
    if (!row) return noAutenticado();
    if (row.must_change_password) return debeCambiar();
  }
  return { ok: true, user };
}

// Devuelve NextResponse 401/403 si no hay acceso, o null si está permitido.
// Regla: canAccess = is_public || role==='admin' || allowed_roles.includes(role)
export async function requireScreenAccess(screenKey: string): Promise<NextResponse | null> {
  const acceso = await requireAccess({ screen: screenKey });
  return acceso.ok ? null : acceso.denied;
}

// Rutas de /admin. El middleware ya filtra /api/admin/* por rol antes de llegar
// aquí; esto cubre las que se llamen desde otro sitio y deja el criterio escrito
// en un único lugar.
export async function requireAdmin(): Promise<NextResponse | null> {
  const acceso = await requireAccess({ role: 'admin' });
  return acceso.ok ? null : acceso.denied;
}
