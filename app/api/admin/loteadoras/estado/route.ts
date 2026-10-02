import { NextResponse } from 'next/server';
import { getDb } from '@/lib/sqlite';
import { getPrinterStatusDetail } from '@/lib/loteadora-printer';
import { requireAccess } from '@/lib/permissions';
import { permisosLoteadora as L } from '@/lib/permisos';

interface LoteadoraRow {
  id: number;
  ip: string;
  port: number;
  slave_address: number;
}

// Estado en vivo (admin) de TODAS las loteadoras, habilitadas o no, para la
// pestaña Loteadoras de /admin. Si no responde, `motivo` dice por qué; si tiene
// avisos o errores (tinta, cartuchos...), `avisos` los lista en claro.
export async function GET() {
  const acceso = await requireAccess({ permiso: L('maquinas') });
  if (!acceso.ok) return acceso.denied;

  const db = getDb();
  const loteadoras = db.prepare('SELECT id, ip, port, slave_address FROM loteadoras').all() as LoteadoraRow[];

  const estados = await Promise.all(
    loteadoras.map(async (l) => {
      const { state, motivo, avisos } = await getPrinterStatusDetail({ ip: l.ip, port: l.port, slaveAddress: l.slave_address });
      return { id: l.id, state, ...(motivo ? { motivo } : {}), ...(avisos?.length ? { avisos } : {}) };
    })
  );

  return NextResponse.json(estados);
}
