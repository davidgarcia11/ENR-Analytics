import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/sqlite';
import { requireAccess } from '@/lib/permissions';

const IPV4_REGEX = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

// Valida y normaliza el body de alta/edición de una loteadora. Devuelve
// { error } si algo no es válido, o { value } con los datos ya limpios.
export function parseLoteadoraInput(body: any) {
  const name = String(body.name ?? '').trim();
  const ip = String(body.ip ?? '').trim();
  const port = Number(body.port);
  const slaveAddress = body.slaveAddress === undefined || body.slaveAddress === '' ? 0 : Number(body.slaveAddress);
  const enabled = body.enabled === undefined ? true : Boolean(body.enabled);
  const linea = String(body.linea ?? '').trim();

  if (!name) return { error: 'El nombre es obligatorio' };
  if (!IPV4_REGEX.test(ip) || ip.split('.').some((octet) => Number(octet) > 255)) {
    return { error: 'La IP debe tener formato IPv4 (ej. 192.168.1.10)' };
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { error: 'El puerto debe ser un entero entre 1 y 65535' };
  }
  if (!Number.isInteger(slaveAddress) || slaveAddress < 0 || slaveAddress > 255) {
    return { error: 'La Slave Address debe ser un entero entre 0 y 255' };
  }
  if (!linea) return { error: 'La línea de fabricación es obligatoria' };

  return { value: { name, ip, port, slaveAddress, enabled: enabled ? 1 : 0, linea } };
}

export async function GET() {
  const acceso = await requireAccess({ role: 'admin' });
  if (!acceso.ok) return acceso.denied;

  const db = getDb();
  const loteadoras = db.prepare(
    'SELECT id, name, ip, port, slave_address, enabled, linea, created_at FROM loteadoras ORDER BY id'
  ).all();
  return NextResponse.json(loteadoras);
}

export async function POST(req: NextRequest) {
  const acceso = await requireAccess({ role: 'admin' });
  if (!acceso.ok) return acceso.denied;

  const body = await req.json();
  const parsed = parseLoteadoraInput(body);
  if ('error' in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const { name, ip, port, slaveAddress, enabled, linea } = parsed.value;

  const db = getDb();
  try {
    const result = db.prepare(
      `INSERT INTO loteadoras (name, ip, port, slave_address, enabled, linea)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(name, ip, port, slaveAddress, enabled, linea);
    const created = db.prepare('SELECT id, name, ip, port, slave_address, enabled, linea, created_at FROM loteadoras WHERE id = ?').get(result.lastInsertRowid);
    return NextResponse.json(created, { status: 201 });
  } catch (err: any) {
    if (err.message?.includes('UNIQUE')) {
      return NextResponse.json({ error: 'Ya existe una loteadora con ese nombre' }, { status: 409 });
    }
    console.error('Create loteadora error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
