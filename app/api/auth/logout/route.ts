import { NextRequest, NextResponse } from 'next/server';
import { COOKIE_NAME, cookieOptions } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const res = NextResponse.json({ ok: true });
  // Mismas opciones que al crearla (sameSite/secure/path) y maxAge 0: si los
  // atributos no coinciden con los de la cookie original, el navegador puede
  // no darlas por la misma y dejar la sesión sin borrar.
  res.cookies.set(COOKIE_NAME, '', { ...cookieOptions(req), maxAge: 0 });
  return res;
}
