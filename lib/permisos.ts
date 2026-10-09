// Catálogo de permisos sueltos por usuario (tabla user_permissions).
//
// Un permiso da acceso a UNA configuración concreta a un usuario que no es admin
// (el admin los tiene todos implícitamente). Se asignan uno a uno desde /admin →
// Usuarios. Para añadir uno nuevo basta con una entrada aquí: la pantalla de
// usuarios, el sidebar de /admin y el proxy leen de este catálogo.
//
// Sin dependencias de servidor a propósito: lo importan tanto lib/permissions.ts
// y proxy.ts como componentes cliente (sidebar de /admin, /muestras).

export interface DefinicionPermiso {
  label: string;
  /** Texto breve para badges (tabla de usuarios) */
  corto: string;
  grupo: string;
  /** Acción dentro de su grupo ("Ver", "Eliminar"...): la fila de la matriz de Roles y permisos */
  accion?: string;
  /** Sección de /admin que desbloquea (el usuario la ve en el sidebar). Sin ella, el permiso se usa en otro panel. */
  seccionAdmin?: string;
}

export const PERMISOS = {
  'muestras.config': {
    label: 'Elegir los artículos visibles en /muestras',
    corto: 'Artículos de muestras',
    grupo: 'Muestras',
  },
  // Loteadora: un permiso por acción en cada sección de /admin (sept. 2026). Cualquiera
  // de los de una sección la abre; los botones que no se tengan no aparecen, y cada
  // ruta lo vuelve a comprobar (RUTAS_ADMIN_POR_PERMISO + requireAccess).
  'admin.loteadora.maquinas.ver': { label: 'Ver las máquinas (loteadoras) y su estado', corto: 'Máquinas: ver', grupo: 'Loteadora · Máquinas', accion: 'Ver', seccionAdmin: 'loteadoras' },
  'admin.loteadora.maquinas.editar': { label: 'Dar de alta y editar máquinas', corto: 'Máquinas: editar', grupo: 'Loteadora · Máquinas', accion: 'Crear y editar', seccionAdmin: 'loteadoras' },
  'admin.loteadora.maquinas.eliminar': { label: 'Eliminar máquinas', corto: 'Máquinas: eliminar', grupo: 'Loteadora · Máquinas', accion: 'Eliminar', seccionAdmin: 'loteadoras' },
  'admin.loteadora.zonas.ver': { label: 'Ver las zonas y quién ve cada una', corto: 'Zonas: ver', grupo: 'Loteadora · Zonas', accion: 'Ver', seccionAdmin: 'zonas' },
  'admin.loteadora.zonas.editar': { label: 'Crear y editar zonas (y qué roles y usuarios ven cada una)', corto: 'Zonas: editar', grupo: 'Loteadora · Zonas', accion: 'Crear y editar', seccionAdmin: 'zonas' },
  'admin.loteadora.zonas.eliminar': { label: 'Eliminar zonas', corto: 'Zonas: eliminar', grupo: 'Loteadora · Zonas', accion: 'Eliminar', seccionAdmin: 'zonas' },
  'admin.loteadora.plantillas.ver': { label: 'Ver las plantillas y su vista previa', corto: 'Plantillas: ver', grupo: 'Loteadora · Plantillas', accion: 'Ver', seccionAdmin: 'plantillas' },
  'admin.loteadora.plantillas.editar': { label: 'Crear, editar y duplicar plantillas', corto: 'Plantillas: editar', grupo: 'Loteadora · Plantillas', accion: 'Crear y editar', seccionAdmin: 'plantillas' },
  'admin.loteadora.plantillas.eliminar': { label: 'Eliminar plantillas', corto: 'Plantillas: eliminar', grupo: 'Loteadora · Plantillas', accion: 'Eliminar', seccionAdmin: 'plantillas' },
  'admin.loteadora.plantillas.crear-en-maquina': { label: 'Crear el mensaje de una plantilla en la loteadora', corto: 'Crear en loteadora', grupo: 'Loteadora · Plantillas', accion: 'Crear en la loteadora', seccionAdmin: 'plantillas' },
  'admin.loteadora.plantillas.copia': { label: 'Exportar e importar la copia completa de plantillas', corto: 'Copia de plantillas', grupo: 'Loteadora · Plantillas', accion: 'Exportar / Importar', seccionAdmin: 'plantillas' },
  'admin.loteadora.articulos.ver': { label: 'Ver qué plantilla usa cada artículo', corto: 'Artículos: ver', grupo: 'Loteadora · Artículos', accion: 'Ver', seccionAdmin: 'articulos-plantilla' },
  'admin.loteadora.articulos.editar': { label: 'Asociar artículos a plantillas', corto: 'Artículos: asociar', grupo: 'Loteadora · Artículos', accion: 'Asociar', seccionAdmin: 'articulos-plantilla' },
  'admin.loteadora.articulos.eliminar': { label: 'Desvincular artículos de su plantilla', corto: 'Artículos: desvincular', grupo: 'Loteadora · Artículos', accion: 'Desvincular', seccionAdmin: 'articulos-plantilla' },
  'admin.loteadora.datos-fijos.ver': { label: 'Ver los datos fijos de las plantillas', corto: 'Datos fijos: ver', grupo: 'Loteadora · Datos fijos', accion: 'Ver', seccionAdmin: 'datos-fijos' },
  'admin.loteadora.datos-fijos.editar': { label: 'Cambiar los datos fijos (precios, nº de certificado...)', corto: 'Datos fijos: editar', grupo: 'Loteadora · Datos fijos', accion: 'Cambiar valores', seccionAdmin: 'datos-fijos' },
  'admin.loteadora.registro.ver': { label: 'Ver el registro de envíos de la loteadora (qué se mandó, a qué máquina, cuándo y quién)', corto: 'Registro: ver', grupo: 'Loteadora · Registro', accion: 'Ver', seccionAdmin: 'registro-loteadora' },
  // Mensajes recibidos por la API de integración (lib/integracion.ts)
  'admin.integracion.ver': { label: 'Ver los mensajes recibidos por la API de integración', corto: 'Integración: ver', grupo: 'Integración', accion: 'Ver', seccionAdmin: 'integracion' },
  // En /loteadora (sin sección de /admin): vaciar la cola de envíos pendientes de una máquina.
  'loteadora.limpiar-buffer': { label: 'Limpiar el buffer de la loteadora (descarta los envíos pendientes)', corto: 'Limpiar buffer', grupo: 'Loteadora · Uso diario', accion: 'Limpiar buffer' },
} as const satisfies Record<string, DefinicionPermiso>;

export type Permiso = keyof typeof PERMISOS;

type Seccion = 'maquinas' | 'zonas' | 'plantillas' | 'articulos' | 'datos-fijos' | 'registro';
/** Permisos de una sección de la loteadora; sin acciones, todos (los que dejan verla). */
export function permisosLoteadora(seccion: Seccion, ...acciones: string[]): Permiso[] {
  const prefijo = `admin.loteadora.${seccion}.`;
  return (Object.keys(PERMISOS) as Permiso[]).filter((p) => p.startsWith(prefijo) && (acciones.length === 0 || acciones.includes(p.slice(prefijo.length))));
}

export const LISTA_PERMISOS = Object.keys(PERMISOS) as Permiso[];

export function esPermiso(valor: unknown): valor is Permiso {
  return typeof valor === 'string' && Object.prototype.hasOwnProperty.call(PERMISOS, valor);
}

interface UsuarioConPermisos {
  role: string;
  permisos: string[];
}

export function tienePermiso(user: UsuarioConPermisos | null | undefined, permiso: Permiso): boolean {
  return !!user && (user.role === 'admin' || user.permisos.includes(permiso));
}

/** Secciones de /admin que puede abrir un usuario no admin por sus permisos. */
export function seccionesAdminPorPermisos(permisos: string[]): string[] {
  return permisos
    .filter(esPermiso)
    .map((p) => (PERMISOS[p] as DefinicionPermiso).seccionAdmin)
    .filter((s): s is string => !!s);
}

export function puedeEntrarEnAdmin(user: UsuarioConPermisos | null | undefined): boolean {
  return !!user && (user.role === 'admin' || seccionesAdminPorPermisos(user.permisos).length > 0);
}

// Rutas de /api/admin que se abren a un permiso además de al admin. Cualquier ruta
// que NO esté aquí sigue siendo solo de admin (denegado por defecto). `metodos`
// vacío = todos. Con varios permisos basta con uno. Gana la primera regla que
// encaje (por eso las más concretas van antes). `prefijo` puede ser una expresión
// regular para rutas con un id en medio. Cada ruta vuelve a comprobar el permiso
// con requireAccess.
const L = permisosLoteadora;
export const RUTAS_ADMIN_POR_PERMISO: { prefijo: string | RegExp; metodos?: string[]; permiso: Permiso | Permiso[] }[] = [
  // Plantillas. "Crear en la loteadora" va antes que la regla general de mensajes.
  { prefijo: /^\/api\/admin\/loteadora-mensajes\/[^/]+\/crear-en-maquina$/, permiso: L('plantillas', 'crear-en-maquina') },
  // Lectura: la sección Plantillas y el desplegable de plantillas de Artículos.
  { prefijo: '/api/admin/loteadora-mensajes', metodos: ['GET'], permiso: [...L('plantillas'), ...L('articulos', 'ver', 'editar')] },
  { prefijo: '/api/admin/loteadora-mensajes', metodos: ['POST', 'PUT'], permiso: L('plantillas', 'editar') },
  { prefijo: '/api/admin/loteadora-mensajes', metodos: ['DELETE'], permiso: L('plantillas', 'eliminar') },
  { prefijo: '/api/admin/loteadora-copia', permiso: L('plantillas', 'copia') },
  // Artículos → plantilla (su copia: exportar con ver, importar con asociar)
  { prefijo: '/api/admin/loteadora-articulos/copia', metodos: ['GET'], permiso: L('articulos') },
  { prefijo: '/api/admin/loteadora-articulos/copia', metodos: ['POST'], permiso: L('articulos', 'editar') },
  { prefijo: '/api/admin/loteadora-articulos', metodos: ['GET'], permiso: L('articulos') },
  { prefijo: '/api/admin/loteadora-articulos', metodos: ['POST'], permiso: L('articulos', 'editar') },
  { prefijo: '/api/admin/loteadora-articulos', metodos: ['DELETE'], permiso: L('articulos', 'eliminar') },
  // Datos fijos
  { prefijo: '/api/admin/loteadora-datos-fijos', metodos: ['GET'], permiso: L('datos-fijos') },
  { prefijo: '/api/admin/loteadora-datos-fijos', metodos: ['PATCH'], permiso: L('datos-fijos', 'editar') },
  // Máquinas (incluido /estado). Lectura también para Plantillas: el "Crear en la
  // loteadora" y la línea de ejemplo de la vista previa.
  { prefijo: '/api/admin/loteadoras', metodos: ['GET'], permiso: [...L('maquinas'), ...L('plantillas', 'ver', 'editar', 'crear-en-maquina')] },
  { prefijo: '/api/admin/loteadoras', metodos: ['POST', 'PUT'], permiso: L('maquinas', 'editar') },
  { prefijo: '/api/admin/loteadoras', metodos: ['DELETE'], permiso: L('maquinas', 'eliminar') },
  // Mensajes recibidos por la API de integración (solo lectura)
  { prefijo: '/api/admin/integracion', metodos: ['GET'], permiso: 'admin.integracion.ver' },
  // Registro de envíos (solo lectura)
  { prefijo: '/api/admin/loteadora-registro', metodos: ['GET'], permiso: L('registro') },
  // Zonas. Lectura también para elegir la zona de una máquina.
  { prefijo: '/api/admin/zonas', metodos: ['GET'], permiso: [...L('zonas'), ...L('maquinas', 'editar')] },
  { prefijo: '/api/admin/zonas', metodos: ['POST', 'PUT'], permiso: L('zonas', 'editar') },
  { prefijo: '/api/admin/zonas', metodos: ['DELETE'], permiso: L('zonas', 'eliminar') },
];

export function permisoDeRutaAdmin(pathname: string, metodo: string): Permiso | Permiso[] | null {
  const regla = RUTAS_ADMIN_POR_PERMISO.find(
    (r) =>
      (typeof r.prefijo === 'string'
        ? pathname === r.prefijo || pathname.startsWith(r.prefijo + '/')
        : r.prefijo.test(pathname)) &&
      (!r.metodos || r.metodos.includes(metodo.toUpperCase()))
  );
  return regla?.permiso ?? null;
}
