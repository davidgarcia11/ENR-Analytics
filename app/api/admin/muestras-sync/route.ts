import { NextResponse } from 'next/server';
import { verifySession } from '@/lib/auth';
import { getSyncState, runFullSync, getArticleAllowlist } from '@/lib/muestras';

// Sincronización manual de /muestras — la sincronización real se dispara sola al
// cambiar la lista de artículos visibles y cada 30 min de fondo (ver lib/muestras.ts);
// esto es solo un botón de "hazlo ahora" para admin, sin barra de progreso por tramos
// porque ya no hace falta (con la lista de artículos configurada, tarda segundos).
async function requireAdmin() {
  const user = await verifySession();
  if (!user || user.role !== 'admin') {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 });
  }
  return null;
}

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  const state = getSyncState();
  return NextResponse.json({
    lastSyncedAt: state.last_synced_at,
    candidatosSincronizados: state.candidatos_sincronizados,
    error: state.last_error,
    articulosConfigurados: getArticleAllowlist().length,
  });
}

export async function POST() {
  const denied = await requireAdmin();
  if (denied) return denied;
  const result = await runFullSync();
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  return NextResponse.json({ ok: true, rows: result.rows });
}
