import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/sqlite';
import { requireAccess } from '@/lib/permissions';
import { puedeVerLoteadora, zonasVisibles } from '@/lib/loteadora-zonas';
import { sendRemoteFields, getPrinterStatus, getPrinterStatusDetail } from '@/lib/loteadora-printer';
import {
  ASCII_IMPRIMIBLE, INFO_PIEZA, MAX_MANUAL, componerCampos, leerCampos, piezasManuales, variablesUsadas, type ValoresEtiqueta,
} from '@/lib/loteadora-plantilla';
import { registrarEnvio, type ResultadoEnvio } from '@/lib/loteadora-registro';

// Envía una etiqueta a una loteadora física por TCP (comando 1D del protocolo TIJ).
// Exige permiso de pantalla: dispara una acción física real.
//
// El cliente manda los VALORES en crudo (fresco, cocida año+día, caducidad ISO,
// hora, turno); el texto de cada campo lo compone el servidor con la plantilla del
// artículo (loteadora_articulo_mensajes → loteadora_mensaje_segmentos), igual que
// los IDs de campo y la línea: nada de eso lo decide el cliente. Solo se exigen
// los valores que la plantilla usa de verdad. Ver lib/loteadora-plantilla.ts.
export async function POST(req: NextRequest) {
  const acceso = await requireAccess({ screen: 'loteadora' });
  if (!acceso.ok) return acceso.denied;

  const body = await req.json();
  const { loteadoraId, articuloId } = body;
  if (!loteadoraId || !articuloId) {
    return NextResponse.json({ error: 'Faltan datos: loteadoraId y articuloId son obligatorios' }, { status: 400 });
  }

  const db = getDb();

  const loteadora = db.prepare(
    'SELECT name, ip, port, slave_address, linea, zona_id FROM loteadoras WHERE id = ? AND enabled = 1'
  ).get(Number(loteadoraId)) as { name: string; ip: string; port: number; slave_address: number; linea: string; zona_id: number | null } | undefined;
  if (!loteadora || !puedeVerLoteadora(zonasVisibles(db, acceso.user), loteadora.zona_id)) {
    return NextResponse.json({ error: 'Loteadora no encontrada, deshabilitada o sin acceso (zona)' }, { status: 404 });
  }

  const asociacion = db.prepare(
    'SELECT mensaje_id FROM loteadora_articulo_mensajes WHERE articulo_id = ?'
  ).get(String(articuloId)) as { mensaje_id: number } | undefined;
  const campos = asociacion ? leerCampos(db, [asociacion.mensaje_id]).get(asociacion.mensaje_id) ?? [] : [];
  if (campos.length === 0) {
    return NextResponse.json(
      { error: 'Este artículo no tiene una plantilla asociada (o la plantilla no tiene campos). Configúrala en /admin antes de enviar.' },
      { status: 404 }
    );
  }

  // Validar solo lo que la plantilla usa.
  const usadas = variablesUsadas(campos);
  const valores: ValoresEtiqueta = {};

  if (usadas.has('fresco')) {
    const fresco = String(body.fresco ?? '').trim();
    if (!fresco || fresco.length > 30 || !ASCII_IMPRIMIBLE.test(fresco)) {
      return NextResponse.json({ error: 'El lote fresco es obligatorio (hasta 30 caracteres, sin tildes ni símbolos)' }, { status: 400 });
    }
    valores.fresco = fresco;
  }
  if (usadas.has('cocida')) {
    const anio = Number(body.cocidaAnio);
    const dia = Number(body.cocidaDia);
    if (!Number.isInteger(anio) || anio < 2000 || anio > 2100 || !Number.isInteger(dia) || dia < 1 || dia > 366) {
      return NextResponse.json({ error: 'La cocida debe ser un día juliano entre 1 y 366 con su año' }, { status: 400 });
    }
    valores.cocidaAnio = anio;
    valores.cocidaDia = dia;
  }
  if (usadas.has('caducidad')) {
    const iso = String(body.caducidad ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso) || isNaN(new Date(iso).getTime())) {
      return NextResponse.json({ error: 'Falta la fecha de caducidad (revisa la cocida y los días de caducidad)' }, { status: 400 });
    }
    valores.caducidad = iso;
  }
  if (usadas.has('hora')) {
    const hora = String(body.horaEnvio ?? '');
    if (!/^([01]\d|2[0-3])[0-5]\d$/.test(hora)) {
      return NextResponse.json({ error: 'La hora de envío debe tener formato HHmm' }, { status: 400 });
    }
    valores.hora = hora;
  }
  if (usadas.has('turno')) {
    if (!['1', '2', '3'].includes(String(body.turno))) {
      return NextResponse.json({ error: 'El turno debe ser 1, 2 o 3' }, { status: 400 });
    }
    valores.turno = String(body.turno);
  }
  if (usadas.has('linea')) {
    if (!loteadora.linea) {
      return NextResponse.json(
        { error: 'Esta loteadora no tiene línea de fabricación configurada. Configúrala en /admin antes de enviar.' },
        { status: 404 }
      );
    }
    valores.linea = loteadora.linea;
  }

  // Datos a introducir (pieza 'manual'): obligatorios, por nombre de la pieza
  const manuales = piezasManuales(campos);
  if (manuales.length > 0) {
    valores.manuales = {};
    for (const { nombre } of manuales) {
      const v = String(body.manuales?.[nombre] ?? '').trim();
      if (!v || v.length > MAX_MANUAL || !ASCII_IMPRIMIBLE.test(v)) {
        return NextResponse.json({ error: `"${nombre}" es obligatorio (hasta ${MAX_MANUAL} caracteres, sin tildes ni símbolos como €)` }, { status: 400 });
      }
      valores.manuales[nombre] = v;
    }
  }

  const compuestos = componerCampos(campos, valores);
  const faltan = [...new Set(compuestos.flatMap((c) => c.faltan))];
  if (faltan.length > 0) {
    return NextResponse.json({ error: `Faltan datos para la plantilla: ${faltan.map((t) => INFO_PIEZA[t].label).join(', ')}` }, { status: 400 });
  }
  const invalido = compuestos.find((c) => c.texto.length < 1 || c.texto.length > 255 || !ASCII_IMPRIMIBLE.test(c.texto));
  if (invalido) {
    return NextResponse.json({ error: `El campo ID ${invalido.fieldId} queda vacío, supera 255 caracteres o tiene caracteres no ASCII` }, { status: 400 });
  }

  const config = { ip: loteadora.ip, port: loteadora.port, slaveAddress: loteadora.slave_address };
  const plantilla = (db.prepare('SELECT name FROM loteadora_mensajes WHERE id = ?').get(asociacion!.mensaje_id) as { name: string }).name;
  const u = acceso.user;
  const usuario = u ? [u.name, u.surname].filter(Boolean).join(' ') || u.username : null;
  const enviados = compuestos.map((c) => ({ fieldId: c.fieldId, texto: c.texto }));

  // Registro de envíos (lib/loteadora-registro.ts): cada envío que llega a la máquina,
  // vaya bien o mal. Nunca bloquea la respuesta.
  const registrar = (resultado: ResultadoEnvio, mensaje: string | null) => {
    try {
      registrarEnvio(db, {
        loteadoraId: Number(loteadoraId), loteadora: loteadora.name, usuario, plantilla,
        articuloId: String(articuloId), articuloDesc: body.articuloDesc ? String(body.articuloDesc).slice(0, 120) : null,
        campos: enviados, datos: { ...valores }, resultado, mensaje,
      });
    } catch (e) {
      console.error('No se pudo guardar el envío en el registro de la loteadora:', e);
    }
  };

  // Imprimiendo no se cambian los datos: parte de la tirada saldría con un lote
  // y parte con otro (trazabilidad). Ver docs/loteadora.md §6.
  if (await getPrinterStatus(config) === 'activa') {
    return NextResponse.json({ error: 'La loteadora está imprimiendo. Para la impresión en la máquina antes de enviar datos nuevos.' }, { status: 409 });
  }

  try {
    const { warning } = await sendRemoteFields(config, compuestos.map((c) => ({ id: c.fieldId, text: c.texto })));
    registrar(warning ? 'aviso' : 'ok', warning);

    // Último envío de esta loteadora, para "Estado de las loteadoras". Nunca
    // bloquea la respuesta: el envío ya se ha hecho.
    try {
      db.prepare(
        `INSERT INTO loteadora_ultimo_envio (loteadora_id, plantilla, campos, usuario, enviado_at)
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(loteadora_id) DO UPDATE SET plantilla = excluded.plantilla, campos = excluded.campos,
           usuario = excluded.usuario, enviado_at = excluded.enviado_at`
      ).run(Number(loteadoraId), plantilla, JSON.stringify(enviados), usuario);
      // Último valor de cada dato a introducir: /loteadora lo propone la próxima vez
      const guardarManual = db.prepare(
        `INSERT INTO loteadora_manuales_ultimos (mensaje_id, nombre, valor) VALUES (?, ?, ?)
         ON CONFLICT(mensaje_id, nombre) DO UPDATE SET valor = excluded.valor`
      );
      for (const [nombre, valor] of Object.entries(valores.manuales ?? {})) guardarManual.run(asociacion!.mensaje_id, nombre, valor);
    } catch (e) {
      console.error('No se pudo guardar el último envío de la loteadora:', e);
    }

    return NextResponse.json({ ok: true, warning });
  } catch (err: any) {
    console.error('Envío a loteadora error:', err);
    registrar('error', String(err?.message ?? err));
    // Detalle adicional (bytes de estado en crudo) para el "ver más" del front —
    // no se traduce a texto porque la tabla de significado por bit no se puede
    // reconstruir de forma fiable desde el manual (ver lib/loteadora-printer.ts).
    const detail = await getPrinterStatusDetail(config).catch(() => null);
    return NextResponse.json({ error: err.message, detail: detail?.rawBytes ?? null }, { status: 502 });
  }
}
