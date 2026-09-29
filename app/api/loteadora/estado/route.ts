import { NextResponse } from 'next/server';
import { requireAccess } from '@/lib/permissions';
import { puedeVerLoteadora, zonasVisibles } from '@/lib/loteadora-zonas';
import { getDb } from '@/lib/sqlite';
import { getPrinterStatus } from '@/lib/loteadora-printer';
import { leerCampos, trozosEtiqueta, type TrozoEtiqueta } from '@/lib/loteadora-plantilla';

interface LoteadoraRow {
  id: number;
  name: string;
  ip: string;
  port: number;
  slave_address: number;
  plantilla: string | null;
  campos: string | null;
  usuario: string | null;
  enviado_at: string | null;
  zona_id: number | null;
  zona: string | null;
}

// Estado en vivo (público) de las loteadoras habilitadas, para el listado
// de /loteadora. No expone ip/puerto/slave — cada consulta abre y cierra
// una conexión TCP breve (protocolo TIJ, comando 14). Incluye el último envío
// hecho desde el panel a cada una (tabla loteadora_ultimo_envio), colocado en sus
// líneas como en la etiqueta según la plantilla actual (`lineas`), con el reloj
// donde va aunque no se envíe (lo pone la máquina).
export async function GET() {
  const acceso = await requireAccess({ screen: 'loteadora' });
  if (!acceso.ok) return acceso.denied;

  const db = getDb();
  const loteadoras = db.prepare(
    `SELECT l.id, l.name, l.ip, l.port, l.slave_address, l.zona_id, z.nombre AS zona,
            e.plantilla, e.campos, e.usuario, e.enviado_at
     FROM loteadoras l
     LEFT JOIN zonas z ON z.id = l.zona_id
     LEFT JOIN loteadora_ultimo_envio e ON e.loteadora_id = l.id
     WHERE l.enabled = 1 ORDER BY l.name`
  ).all() as LoteadoraRow[];
  // Solo las de las zonas que puede ver el usuario (lib/loteadora-zonas.ts)
  const zonas = zonasVisibles(db, acceso.user);
  const visibles = loteadoras.filter((l) => puedeVerLoteadora(zonas, l.zona_id));

  const idDe = new Map((db.prepare('SELECT id, name FROM loteadora_mensajes').all() as { id: number; name: string }[]).map((m) => [m.name, m.id]));
  const camposDe = leerCampos(db, [...new Set(visibles.map((l) => idDe.get(l.plantilla ?? '')).filter((id): id is number => id !== undefined))]);
  // Sin la plantilla (borrada o renombrada), un campo por línea
  const lineas = (plantilla: string, enviados: { fieldId: number; texto: string }[]): TrozoEtiqueta[][] => {
    const campos = camposDe.get(idDe.get(plantilla) ?? -1);
    return campos ? trozosEtiqueta(campos, new Map(enviados.map((e) => [e.fieldId, e.texto]))) : enviados.map((e) => [{ texto: e.texto }]);
  };

  const estados = await Promise.all(
    visibles.map(async (l) => ({
      id: l.id,
      name: l.name,
      zona: l.zona,
      state: await getPrinterStatus({ ip: l.ip, port: l.port, slaveAddress: l.slave_address }),
      ultimoEnvio: l.plantilla
        ? { plantilla: l.plantilla, lineas: lineas(l.plantilla, JSON.parse(l.campos ?? '[]')), usuario: l.usuario, enviadoAt: l.enviado_at }
        : null,
    }))
  );

  return NextResponse.json(estados);
}
