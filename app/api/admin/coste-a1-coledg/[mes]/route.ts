import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/sqlite';

// PUT /api/admin/coste-a1-coledg/:mes — edita el código COLEDG de un mes existente.
// DELETE /api/admin/coste-a1-coledg/:mes — borra el mapeo de un mes (p. ej. si se
// configuró con el código equivocado).
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ mes: string }> }
) {
  const { mes } = await params;
  if (!mes) {
    return NextResponse.json({ error: 'Mes requerido' }, { status: 400 });
  }

  let body: { coledg?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Body JSON inválido' }, { status: 400 });
  }

  const coledg = (body.coledg ?? '').trim().toUpperCase();
  if (!coledg) {
    return NextResponse.json({ error: 'El código COLEDG no puede estar vacío' }, { status: 400 });
  }

  try {
    const db = getDb();
    const existing = db.prepare('SELECT mes FROM coste_a1_coledg_mensual WHERE mes = ?').get(mes) as { mes: string } | undefined;
    if (!existing) {
      return NextResponse.json({ error: `Mes ${mes} no existe` }, { status: 404 });
    }
    db.prepare(
      "UPDATE coste_a1_coledg_mensual SET coledg = ?, updated_at = datetime('now') WHERE mes = ?"
    ).run(coledg, mes);
    return NextResponse.json({ ok: true, mes, coledg });
  } catch (err: any) {
    console.error('Error PUT /api/admin/coste-a1-coledg/[mes]:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ mes: string }> }
) {
  const { mes } = await params;
  if (!mes) {
    return NextResponse.json({ error: 'Mes requerido' }, { status: 400 });
  }
  try {
    const db = getDb();
    db.prepare('DELETE FROM coste_a1_coledg_mensual WHERE mes = ?').run(mes);
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('Error DELETE /api/admin/coste-a1-coledg/[mes]:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
