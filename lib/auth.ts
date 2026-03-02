import { SignJWT, jwtVerify } from 'jose';
import { compareSync, hashSync } from 'bcryptjs';
import { cookies } from 'next/headers';

const COOKIE_NAME = 'session';
const JWT_EXPIRY = '7d';

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET no configurado en .env.local');
  return new TextEncoder().encode(secret);
}

export interface SessionUser {
  id: number;
  username: string;
  role: string;
}

/** Crea un JWT firmado con los datos del usuario */
export async function createToken(user: SessionUser): Promise<string> {
  return new SignJWT({ sub: String(user.id), username: user.username, role: user.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(JWT_EXPIRY)
    .sign(getSecret());
}

/** Verifica el JWT de la cookie y devuelve el usuario, o null si no hay sesión */
export async function verifySession(): Promise<SessionUser | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE_NAME)?.value;
    if (!token) return null;

    const { payload } = await jwtVerify(token, getSecret());
    return {
      id: Number(payload.sub),
      username: payload.username as string,
      role: payload.role as string,
    };
  } catch {
    return null;
  }
}

/** Hash de contraseña con bcrypt */
export function hashPassword(password: string): string {
  return hashSync(password, 10);
}

/** Verifica contraseña contra hash */
export function verifyPassword(password: string, hash: string): boolean {
  return compareSync(password, hash);
}

/** Opciones de cookie para la sesión. secure solo si la request viene por HTTPS. */
export function cookieOptions(req?: { url?: string }) {
  const isHttps = req?.url?.startsWith('https') || false;
  return {
    httpOnly: true,
    secure: isHttps,
    sameSite: 'lax' as const,
    maxAge: 60 * 60 * 24 * 7, // 7 días
    path: '/',
  };
}

export { COOKIE_NAME };
