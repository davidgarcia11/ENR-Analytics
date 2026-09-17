import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify, SignJWT } from 'jose';

export const config = {
  // Toda la API, no solo /api/admin. El middleware hace lo que se puede hacer
  // sin BD: validar el token y renovarlo. Quién puede ver qué pantalla lo sigue
  // decidiendo requireAccess() dentro de cada ruta, que es quien tiene SQLite
  // delante (aquí no: el middleware corre en runtime edge).
  matcher: ['/api/:path*'],
};

const COOKIE_NAME = 'session';

// Rutas que no pueden exigir sesión:
// - login/logout: se usan justo cuando no la hay
// - me y screen-permissions: son el latido del SessionProvider; contestan solas
//   si no hay sesión, y no deben renovar la cookie (ver abajo)
// - jde-orders: API externa autenticada con x-api-key, no con la cookie
const SIN_SESION = new Set([
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/me',
  '/api/screen-permissions',
  '/api/jde-orders',
]);

// Caducidad deslizante: solo se renueva cuando al token le queda menos de esto.
// Renovar en cada petición reescribiría la cookie cientos de veces al día sin
// que cambie nada; renovar nunca obliga a reloguear cada 7 días aunque estés
// usando la app a diario.
const RENOVAR_SI_QUEDAN_MENOS_DE = 6 * 24 * 60 * 60; // segundos

function secret() {
  return new TextEncoder().encode(process.env.JWT_SECRET);
}

// Duplicado a propósito de cookieOptions() en lib/auth.ts: importar ese módulo
// aquí arrastraría bcryptjs y next/headers al bundle del middleware, que corre
// en runtime edge. Hay un test que falla si los dos dejan de coincidir.
function cookieOptions(req: NextRequest) {
  return {
    httpOnly: true,
    secure: req.url.startsWith('https'),
    sameSite: 'lax' as const,
    maxAge: 60 * 60 * 24 * 7, // 7 días
    path: '/',
  };
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (SIN_SESION.has(pathname)) return NextResponse.next();

  const esAdmin = pathname.startsWith('/api/admin');
  const token = req.cookies.get(COOKIE_NAME)?.value;

  // Sin cookie: /api/admin corta aquí. En el resto no se puede decidir sin BD
  // (la pantalla puede ser pública), así que pasa y contesta requireAccess.
  if (!token) {
    return esAdmin
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
    const res = NextResponse.json({ error: 'Sesión inválida' }, { status: 401 });
    res.cookies.set(COOKIE_NAME, '', { ...cookieOptions(req), maxAge: 0 });
    return res;
  }

  if (esAdmin && payload.role !== 'admin') {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
  }

  const res = NextResponse.next();
  const quedan = (payload.exp ?? 0) - Math.floor(Date.now() / 1000);
  if (quedan < RENOVAR_SI_QUEDAN_MENOS_DE) {
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
