import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

export const config = {
  matcher: ['/api/admin/:path*'],
};

export async function middleware(req: NextRequest) {
  const token = req.cookies.get('session')?.value;
  if (!token) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }

  try {
    const secret = new TextEncoder().encode(process.env.JWT_SECRET);
    const { payload } = await jwtVerify(token, secret);
    if (payload.role !== 'admin') {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
    }
    return NextResponse.next();
  } catch {
    return NextResponse.json({ error: 'Sesión inválida' }, { status: 401 });
  }
}
