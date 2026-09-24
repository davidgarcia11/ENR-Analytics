import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/sqlite';
import { requireAccess } from '@/lib/permissions';
import { ASCII_IMPRIMIBLE } from '@/lib/loteadora-plantilla';

// Cambia el valor de UN dato fijo. Solo piezas tipo 'fijo': no sirve para editar
// literales ni variables de la plantilla.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const acceso = await requireAccess({ permiso: 'admin.loteadora.datos-fijos' });
  if (!acceso.ok) return acceso.denied;

  const { id } = await params;
  const { valor } = await req.json();
  const texto = String(valor ?? '');

  if (!texto) {
    return NextResponse.json({ error: 'El valor no puede estar vacío' }, { status: 400 });
  }
  if (!ASCII_IMPRIMIBLE.test(texto)) {
    return NextResponse.json({ error: 'Solo caracteres ASCII: la loteadora recibe los campos en ASCII (usa p. ej. "EUR" en vez de "€")' }, { status: 400 });
  }

  const db = getDb();
  const result = db.prepare("UPDATE loteadora_mensaje_segmentos SET valor = ? WHERE id = ? AND tipo = 'fijo'").run(texto, Number(id));
  if (result.changes === 0) {
    return NextResponse.json({ error: 'Dato fijo no encontrado' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
