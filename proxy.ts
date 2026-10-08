import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify, SignJWT } from 'jose';
import { PANELS } from '@/lib/panels';
import { accesoPantalla, puedeUsarApiAdmin, puedeVerPaginaAdmin } from '@/lib/permissions';

// Este archivo se llamaba middleware.ts. Next 16 lo dio por obsoleto en favor de
// `proxy.ts`, y el cambio no es solo de nombre: el proxy corre SIEMPRE en
// runtime Node (de hecho Next rechaza `export const runtime` aquí). Eso es lo
// que permite leer SQLite desde aquí y filtrar páginas, no solo API.
export const config = {
  // Todo menos los estáticos. El matcher tiene que ser literal, así que no se
  // puede generar desde PANELS; la lista de rutas se resuelve abajo, en código.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|logo.png).*)'],
};

const COOKIE_NAME = 'session';

// Rutas de API que no pueden exigir sesión:
// - login/logout: se usan justo cuando no la hay
// - me y screen-permissions: son el latido del SessionProvider; contestan solas
//   si no hay sesión, y no deben renovar la cookie (ver abajo)
// - integración (GoLive): API externa autenticada con x-api-key (claves de
//   /admin → Integración › Claves de API), no con la cookie
const SIN_SESION = new Set([
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/me',
  '/api/screen-permissions',
  '/api/integracion/v1/escaneo',
]);

// Páginas a las que se llega sin sesión o estando a medias de arreglarla.
// Filtrarlas sería un bucle de redirecciones contra sí mismas.
const PAGINAS_LIBRES = new Set(['/login', '/cambiar-contrasena', '/']);

// Caducidad deslizante: solo se renueva cuando al token le queda menos de esto.
// Renovar en cada petición reescribiría la cookie cientos de veces al día sin
// que cambie nada; renovar nunca obliga a reloguear cada 7 días aunque estés
// usando la app a diario.
const RENOVAR_SI_QUEDAN_MENOS_DE = 6 * 24 * 60 * 60; // segundos

function secret() {
  return new TextEncoder().encode(process.env.JWT_SECRET);
}

// Duplicado a propósito de cookieOptions() en lib/auth.ts: importar ese módulo
// aquí arrastraría bcryptjs y next/headers. Hay un test que falla si las dos
// copias dejan de coincidir.
function cookieOptions(req: NextRequest) {
  return {
    httpOnly: true,
    secure: req.url.startsWith('https'),
    sameSite: 'lax' as const,
    maxAge: 60 * 60 * 24 * 7, // 7 días
    path: '/',
  };
}

const alLogin = (req: NextRequest, pathname: string) => {
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = `?next=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(url);
};

export default async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const esApi = pathname.startsWith('/api/');

  if (esApi && SIN_SESION.has(pathname)) return NextResponse.next();

  // Qué pantalla se está pidiendo, si es una página de panel. `admin` no está en
  // PANELS (se gobierna por rol), así que va aparte.
  const panel = esApi ? undefined : PANELS.find((p) => p.href === pathname);
  const esPaginaAdmin = !esApi && pathname.startsWith('/admin');
  const esPaginaFiltrada = !!panel || esPaginaAdmin;

  // Ni API ni página de panel (estáticos, RSC de /login, rutas sueltas): fuera.
  if (!esApi && !esPaginaFiltrada) return NextResponse.next();
  if (PAGINAS_LIBRES.has(pathname)) return NextResponse.next();

  const exigeAdmin = esApi ? pathname.startsWith('/api/admin') : esPaginaAdmin;
  const token = req.cookies.get(COOKIE_NAME)?.value;

  if (!token) {
    if (esPaginaFiltrada) {
      // Una pantalla pública se ve sin sesión, igual que antes de este cambio.
      return panel && accesoPantalla(panel.key, null) === 'ok'
        ? NextResponse.next()
        : alLogin(req, pathname);
    }
    // API sin cookie: /api/admin corta aquí; el resto lo decide requireAccess,
    // que además comprueba cosas que aquí no tocan (contraseña pendiente).
    return exigeAdmin
      ? NextResponse.json({ error: 'No autenticado' }, { status: 401 })
      : NextResponse.next();
  }

  let payload;
  try {
    ({ payload } = await jwtVerify(token, secret()));
  } catch {
    // Token caducado o manipulado: se borra la cookie para que el siguiente
    // intento entre limpio en vez de repetir el 401 para siempre. Si la
    // pantalla era pública, la petición de después ya funciona sin sesión.
    const res = esPaginaFiltrada
      ? alLogin(req, pathname)
      : NextResponse.json({ error: 'Sesión inválida' }, { status: 401 });
    res.cookies.set(COOKIE_NAME, '', { ...cookieOptions(req), maxAge: 0 });
    return res;
  }

  const role = (payload.role as string) ?? null;

  // /admin sigue siendo de admin por defecto. Solo se abre a un usuario sin ese rol
  // la página /admin (si algún permiso suyo desbloquea una sección) y las rutas de
  // /api/admin mapeadas a un permiso en lib/permisos.ts — ninguna más (/admin/logs
  // incluida). Cada ruta vuelve a comprobar el permiso con requireAccess.
  if (exigeAdmin && role !== 'admin') {
    const userId = Number(payload.sub);
    const permitido = !!role && (esApi
      ? puedeUsarApiAdmin(pathname, req.method, userId, role)
      : pathname === '/admin' && puedeVerPaginaAdmin(userId, role));
    if (!permitido) {
      return esPaginaFiltrada
        ? alLogin(req, pathname)
        : NextResponse.json({ error: 'No autorizado' }, { status: 403 });
    }
  }

  // Filtrado de páginas: misma regla que requireAccess({screen}) en la API,
  // importada de lib/permissions para que no haya dos versiones de la verdad.
  // Esto es lo que quita el parpadeo del panel antes de rebotar al login: la
  // decisión se toma antes de mandar una sola línea de HTML.
  if (panel && accesoPantalla(panel.key, role) !== 'ok') return alLogin(req, pathname);

  const res = NextResponse.next();
  const quedan = (payload.exp ?? 0) - Math.floor(Date.now() / 1000);
  if (quedan < RENOVAR_SI_QUEDAN_MENOS_DE && !SIN_SESION.has(pathname)) {
    const { exp: _exp, iat: _iat, ...datos } = payload;
    const nuevo = await new SignJWT(datos)
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('7d')
      .sign(secret());
    res.cookies.set(COOKIE_NAME, nuevo, cookieOptions(req));
  }
  return res;
}
