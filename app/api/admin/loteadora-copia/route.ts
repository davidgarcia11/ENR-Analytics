import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/sqlite';
import { requireAccess } from '@/lib/permissions';
import { exportarCopia, importarCopia } from '@/lib/loteadora-plantilla';

// Copia de seguridad de las plantillas y de las asociaciones artículo → plantilla
// (/admin → Plantillas, botones Exportar/Importar). Solo admin. Lógica y reglas
// en lib/loteadora-plantilla.ts (exportarCopia / importarCopia).
export async function GET() {
  const acceso = await requireAccess({ role: 'admin' });
  if (!acceso.ok) return acceso.denied;
  return NextResponse.json(exportarCopia(getDb()));
}

// Body: { copia: CopiaLoteadora, sustituir?: boolean }
export async function POST(req: NextRequest) {
  const acceso = await requireAccess({ role: 'admin' });
  if (!acceso.ok) return acceso.denied;

  const body = await req.json().catch(() => null);
  const resultado = importarCopia(getDb(), body?.copia, body?.sustituir === true);
  if ('error' in resultado) return NextResponse.json({ error: resultado.error }, { status: 400 });
  return NextResponse.json(resultado.value);
}
