import { NextRequest, NextResponse } from 'next/server';
import type Database from 'better-sqlite3';
import { getDb } from '@/lib/sqlite';
import { requireAccess } from '@/lib/permissions';
import {
  disponerCampos, leerCampos, medidasPorDefecto, numeroLineas, validarMedidas, type Campo, type MedidasMensaje,
} from '@/lib/loteadora-plantilla';
import { downloadMessage, getPrinterStatus, listMessageNames } from '@/lib/loteadora-printer';

// Crea (o sustituye) en una loteadora el mensaje de una plantilla, con sus campos
// colocados por disponerCampos() (comando 1C) y las medidas elegidas (fuente,
// tamaño, espaciado...), que se recuerdan por mensaje y máquina. Solo admin. El
// reloj no existe en el 1C: se inserta a mano en la máquina, y si el mensaje ya
// existía se pierde el que tuviera (el panel lo avisa antes). Ver docs/loteadora.md §9 y §13.

interface FilaMedidas extends MedidasMensaje { tres_lineas: number }
const COLUMNAS = 'fuente, tamano, espaciado, ancho, interlineado';

function cargarMensaje(db: Database.Database, mensajeId: number) {
  const mensaje = db.prepare('SELECT name FROM loteadora_mensajes WHERE id = ?').get(mensajeId) as { name: string } | undefined;
  const campos: Campo[] = mensaje ? leerCampos(db, [mensajeId]).get(mensajeId) ?? [] : [];
  return { mensaje, campos };
}

// Medidas que se proponen: las guardadas para este mensaje en esta máquina; si no,
// las últimas usadas en esta máquina con un mensaje del mismo nº de líneas; si no,
// las de por defecto (Arial).
function medidasPropuestas(db: Database.Database, mensajeId: number, loteadoraId: number, campos: Campo[]) {
  const tres = numeroLineas(campos) >= 3 ? 1 : 0;
  const guardadas = db.prepare(`SELECT ${COLUMNAS} FROM loteadora_medidas_mensaje WHERE mensaje_id = ? AND loteadora_id = ?`)
    .get(mensajeId, loteadoraId) as MedidasMensaje | undefined;
  if (guardadas) return { medidas: guardadas, origen: 'guardadas' as const };
  const ultimas = db.prepare(
    `SELECT ${COLUMNAS} FROM loteadora_medidas_mensaje WHERE loteadora_id = ? AND tres_lineas = ? ORDER BY updated_at DESC LIMIT 1`
  ).get(loteadoraId, tres) as MedidasMensaje | undefined;
  if (ultimas) return { medidas: ultimas, origen: 'maquina' as const };
  return { medidas: medidasPorDefecto(campos), origen: 'defecto' as const };
}

// GET ?loteadoraId= → { medidas, origen }: lo que propone el diálogo al elegir máquina
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const acceso = await requireAccess({ permiso: 'admin.loteadora.plantillas' });
  if (!acceso.ok) return acceso.denied;

  const mensajeId = Number((await params).id);
  const loteadoraId = Number(req.nextUrl.searchParams.get('loteadoraId'));
  const db = getDb();
  const { mensaje, campos } = cargarMensaje(db, mensajeId);
  if (!mensaje) return NextResponse.json({ error: 'Plantilla no encontrada' }, { status: 404 });
  return NextResponse.json(medidasPropuestas(db, mensajeId, loteadoraId, campos));
}

// Body: { loteadoraId, medidas }
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const acceso = await requireAccess({ permiso: 'admin.loteadora.plantillas' });
  if (!acceso.ok) return acceso.denied;

  const mensajeId = Number((await params).id);
  const body = await req.json().catch(() => ({}));

  const db = getDb();
  const { mensaje, campos } = cargarMensaje(db, mensajeId);
  if (!mensaje) return NextResponse.json({ error: 'Plantilla no encontrada' }, { status: 404 });
  if (campos.length === 0) return NextResponse.json({ error: 'La plantilla no tiene campos' }, { status: 400 });

  const loteadoraId = Number(body.loteadoraId);
  const loteadora = db.prepare('SELECT ip, port, slave_address FROM loteadoras WHERE id = ?').get(loteadoraId) as
    { ip: string; port: number; slave_address: number } | undefined;
  if (!loteadora) return NextResponse.json({ error: 'Loteadora no encontrada' }, { status: 404 });
  const config = { ip: loteadora.ip, port: loteadora.port, slaveAddress: loteadora.slave_address };

  const parsed = body.medidas ? validarMedidas(body.medidas) : { value: medidasPropuestas(db, mensajeId, loteadoraId, campos).medidas };
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const medidas = parsed.value;

  // Crear un mensaje lo deja en el área de edición: imprimiendo, no.
  if (await getPrinterStatus(config) === 'activa') {
    return NextResponse.json({ error: 'La loteadora está imprimiendo. Para la impresión en la máquina antes de crear el mensaje.' }, { status: 409 });
  }

  try {
    const antes = await listMessageNames(config).catch(() => null);
    await downloadMessage(config, mensaje.name, disponerCampos(campos, medidas));
    const despues = await listMessageNames(config).catch(() => null);
    if (despues && !despues.includes(mensaje.name)) {
      return NextResponse.json({ error: 'La loteadora aceptó el mensaje pero no aparece en su lista. Revísalo en la máquina.' }, { status: 502 });
    }
    // Se recuerdan para la próxima vez (este mensaje en esta máquina)
    db.prepare(
      `INSERT INTO loteadora_medidas_mensaje (mensaje_id, loteadora_id, tres_lineas, ${COLUMNAS}, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(mensaje_id, loteadora_id) DO UPDATE SET tres_lineas = excluded.tres_lineas, fuente = excluded.fuente,
         tamano = excluded.tamano, espaciado = excluded.espaciado, ancho = excluded.ancho,
         interlineado = excluded.interlineado, updated_at = excluded.updated_at`
    ).run(mensajeId, loteadoraId, numeroLineas(campos) >= 3 ? 1 : 0, medidas.fuente, medidas.tamano, medidas.espaciado, medidas.ancho, medidas.interlineado);
    return NextResponse.json({ ok: true, existia: antes?.includes(mensaje.name) ?? null });
  } catch (err: any) {
    console.error('Crear mensaje en loteadora error:', err);
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
