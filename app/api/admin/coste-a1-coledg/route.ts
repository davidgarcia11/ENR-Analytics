import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/sqlite';

// GET /api/admin/coste-a1-coledg — lista mes -> código de ledger IELEDG (F30026).
// POST /api/admin/coste-a1-coledg — añade un mes nuevo (no permite duplicar uno
// existente, para eso está el PUT en [mes]/route.ts).
export async function GET() {
  try {
    const db = getDb();
    const rows = db
      .prepare('SELECT mes, coledg, updated_at FROM coste_a1_coledg_mensual ORDER BY mes')
      .all() as { mes: string; coledg: string; updated_at: string }[];
    return NextResponse.json(rows);
  } catch (err: any) {
    console.error('Error GET /api/admin/coste-a1-coledg:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  let body: { mes?: string; coledg?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body JSON inválido' }, { status: 400 });
  }

  const mes = (body.mes ?? '').trim();
  const coledg = (body.coledg ?? '').trim().toUpperCase();
  if (!/^\d{4}-\d{2}$/.test(mes)) {
    return NextResponse.json({ error: 'Mes inválido (formato YYYY-MM)' }, { status: 400 });
  }
  if (!coledg) {
    return NextResponse.json({ error: 'El código IELEDG no puede estar vacío' }, { status: 400 });
  }

  try {
    const db = getDb();
    const existing = db.prepare('SELECT mes FROM coste_a1_coledg_mensual WHERE mes = ?').get(mes);
    if (existing) {
      return NextResponse.json({ error: `El mes ${mes} ya tiene un código configurado` }, { status: 409 });
    }
    db.prepare('INSERT INTO coste_a1_coledg_mensual (mes, coledg) VALUES (?, ?)').run(mes, coledg);
    return NextResponse.json({ ok: true, mes, coledg });
  } catch (err: any) {
    console.error('Error POST /api/admin/coste-a1-coledg:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
