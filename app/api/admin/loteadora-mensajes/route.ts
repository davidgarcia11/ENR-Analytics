import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/sqlite';
import { requireAccess } from '@/lib/permissions';
import { guardarCampos, leerCampos, validarPlantilla } from '@/lib/loteadora-plantilla';

// Plantillas (mensajes de la máquina) con sus campos y piezas — modelo en
// lib/loteadora-plantilla.ts.
//
// Lectura abierta también a quien asigna artículos a plantillas (necesita el
// desplegable); crear y editar, admin o permiso de plantillas; borrar, solo admin.
export async function GET() {
  const acceso = await requireAccess({ permiso: ['admin.loteadora.articulos', 'admin.loteadora.plantillas'] });
  if (!acceso.ok) return acceso.denied;

  const db = getDb();
  const mensajes = db.prepare('SELECT id, name, created_at FROM loteadora_mensajes ORDER BY name').all() as { id: number }[];
  const campos = leerCampos(db);
  return NextResponse.json(mensajes.map((m) => ({ ...m, campos: campos.get(m.id) ?? [] })));
}

export async function POST(req: NextRequest) {
  const acceso = await requireAccess({ permiso: 'admin.loteadora.plantillas' });
  if (!acceso.ok) return acceso.denied;

  const parsed = validarPlantilla(await req.json());
  if ('error' in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const { name, campos } = parsed.value;

  const db = getDb();
  if (db.prepare('SELECT 1 FROM loteadora_mensajes WHERE name = ?').get(name)) {
    return NextResponse.json({ error: 'Ya existe una plantilla con ese nombre' }, { status: 409 });
  }

  try {
    const id = db.transaction(() => {
      const result = db.prepare('INSERT INTO loteadora_mensajes (name) VALUES (?)').run(name);
      const mensajeId = Number(result.lastInsertRowid);
      guardarCampos(db, mensajeId, campos);
      return mensajeId;
    })();
    return NextResponse.json({ id, name, campos }, { status: 201 });
  } catch (err: any) {
    console.error('Create loteadora_mensaje error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
