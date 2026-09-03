import { NextResponse } from 'next/server';
import { verifySession } from '@/lib/auth';
import { getSyncState, runBackfill } from '@/lib/muestras';

// Backfill histórico de /muestras — un botón, admin, pensado para ejecutarse una sola
// vez (ver docs/muestras.md). GET consulta el estado; POST lo dispara.
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
    status: state.backfill_status,
    startedAt: state.backfill_started_at,
    completedAt: state.backfill_completed_at,
    progress: state.backfill_progress,
    error: state.backfill_error,
    candidatosSincronizados: state.candidatos_sincronizados,
  });
}

export async function POST() {
  const denied = await requireAdmin();
  if (denied) return denied;

  const state = getSyncState();
  if (state.backfill_status === 'running') {
    return NextResponse.json({ ok: true, started: false, reason: 'Ya hay un backfill en curso' });
  }

  // Fire-and-forget: el backfill puede tardar varios minutos (va por tramos contra
  // Oracle) — no tiene sentido bloquear la petición HTTP. El progreso se consulta con
  // GET aparte. El servidor de este proyecto es un proceso persistente (no serverless),
  // así que la promesa sigue corriendo aunque esta respuesta ya se haya enviado.
  runBackfill().catch((err) => console.error('[muestras] backfill falló:', err));

  return NextResponse.json({ ok: true, started: true });
}
