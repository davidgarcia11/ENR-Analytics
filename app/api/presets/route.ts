import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/sqlite';
import { verifySession } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const user = await verifySession();
  if (!user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const screen = searchParams.get('screen') || 'produccion';

  const db = getDb();
  const presets = db.prepare(
    'SELECT id, name, filters, created_at FROM presets WHERE user_id = ? AND screen = ? ORDER BY name'
  ).all(user.id, screen);
  return NextResponse.json(presets);
}

export async function POST(req: NextRequest) {
  const user = await verifySession();
  if (!user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }

  try {
    const { name, filters, screen = 'produccion' } = await req.json();

    if (!name || !filters) {
      return NextResponse.json({ error: 'Nombre y filtros requeridos' }, { status: 400 });
    }

    const db = getDb();

    try {
      db.prepare(
        'INSERT INTO presets (user_id, name, filters, screen) VALUES (?, ?, ?, ?)'
      ).run(user.id, name.trim(), JSON.stringify(filters), screen);
    } catch (err: any) {
      if (err.message?.includes('UNIQUE')) {
        return NextResponse.json({ error: 'Ya tienes un preset con ese nombre' }, { status: 409 });
      }
      throw err;
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('Preset save error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
