import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/sqlite';
import { requireAccess } from '@/lib/permissions';

export async function GET(req: NextRequest) {
  const acceso = await requireAccess({ sesion: true });
  if (!acceso.ok) return acceso.denied;
  const user = acceso.user!;

  const { searchParams } = new URL(req.url);
  const screen = searchParams.get('screen') || 'produccion';

  const db = getDb();
  const presets = db.prepare(
    'SELECT id, name, filters, created_at FROM presets WHERE user_id = ? AND screen = ? ORDER BY name'
  ).all(user.id, screen);
  return NextResponse.json(presets);
}

export async function POST(req: NextRequest) {
  const acceso = await requireAccess({ sesion: true });
  if (!acceso.ok) return acceso.denied;
  const user = acceso.user!;

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
