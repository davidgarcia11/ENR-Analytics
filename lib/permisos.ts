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
  /** Sección de /admin que desbloquea (el usuario la ve en el sidebar). Sin ella, el permiso se usa en otro panel. */
  seccionAdmin?: string;
}

export const PERMISOS = {
  'muestras.config': {
    label: 'Elegir los artículos visibles en /muestras',
    corto: 'Artículos de muestras',
    grupo: 'Muestras',
  },
  'admin.loteadora.articulos': {
    label: 'Asignar artículos a plantillas de loteadora',
    corto: 'Artículos → plantilla',
    grupo: 'Loteadora',
    seccionAdmin: 'articulos-plantilla',
  },
} as const satisfies Record<string, DefinicionPermiso>;

export type Permiso = keyof typeof PERMISOS;

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
// vacío = todos. Cada ruta vuelve a comprobar el permiso con requireAccess.
export const RUTAS_ADMIN_POR_PERMISO: { prefijo: string; metodos?: string[]; permiso: Permiso }[] = [
  { prefijo: '/api/admin/loteadora-articulos', permiso: 'admin.loteadora.articulos' },
  // Solo lectura: el desplegable de plantillas al asociar un artículo.
  { prefijo: '/api/admin/loteadora-mensajes', metodos: ['GET'], permiso: 'admin.loteadora.articulos' },
];

export function permisoDeRutaAdmin(pathname: string, metodo: string): Permiso | null {
  const regla = RUTAS_ADMIN_POR_PERMISO.find(
    (r) =>
      (pathname === r.prefijo || pathname.startsWith(r.prefijo + '/')) &&
      (!r.metodos || r.metodos.includes(metodo.toUpperCase()))
  );
  return regla?.permiso ?? null;
}
