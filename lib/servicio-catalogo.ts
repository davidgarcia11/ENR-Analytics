// Catálogo editable de /servicio: motivos, responsables y transportistas que salen en los
// desplegables del diálogo de edición. Se gestiona en /admin → Listas de servicio
// (permiso admin.servicio.catalogos). Solo servidor (lee SQLite); la parte sin servidor
// (tipos, limpieza de nombres) está en lib/servicio.ts. Ver docs/servicio.md.
import { getDb } from './sqlite';
import { TIPOS_CATALOGO, type TipoCatalogo } from './servicio';

// Columna de order_service_tracking donde se guarda cada tipo (para contar usos)
const COLUMNA: Record<TipoCatalogo, string> = { motivo: 'motivo', responsable: 'responsable', transportista: 'transportista' };

export interface ItemCatalogo {
  tipo: TipoCatalogo;
  nombre: string;
  activo: boolean;
  /** Envíos con datos manuales que lo usan: si > 0 no se puede borrar, solo desactivar */
  usos: number;
}

export function listarCatalogo(): ItemCatalogo[] {
  const db = getDb();
  const filas = db.prepare('SELECT tipo, nombre, activo FROM servicio_catalogo ORDER BY tipo, orden, nombre').all() as { tipo: TipoCatalogo; nombre: string; activo: number }[];
  const usos = new Map<string, number>();
  for (const tipo of TIPOS_CATALOGO) {
    const r = db.prepare(`SELECT ${COLUMNA[tipo]} AS v, COUNT(*) AS n FROM order_service_tracking WHERE ${COLUMNA[tipo]} != '' GROUP BY ${COLUMNA[tipo]}`).all() as { v: string; n: number }[];
    for (const x of r) usos.set(`${tipo}|${x.v}`, x.n);
  }
  return filas.map((f) => ({ tipo: f.tipo, nombre: f.nombre, activo: !!f.activo, usos: usos.get(`${f.tipo}|${f.nombre}`) ?? 0 }));
}

/** Lo que ven los desplegables: solo los activos, por tipo y en su orden. */
export function catalogoActivo(): Record<TipoCatalogo, string[]> {
  const r: Record<TipoCatalogo, string[]> = { motivo: [], responsable: [], transportista: [] };
  const filas = getDb().prepare('SELECT tipo, nombre FROM servicio_catalogo WHERE activo = 1 ORDER BY tipo, orden, nombre').all() as { tipo: TipoCatalogo; nombre: string }[];
  for (const f of filas) r[f.tipo].push(f.nombre);
  return r;
}

/**
 * ¿Se puede guardar `valor` en un envío? Vacío siempre; el mismo valor que ya tenía
 * (aunque se haya desactivado después, para no obligar a cambiar incidencias antiguas
 * al editar otro campo); o uno activo del catálogo.
 */
export function valorPermitido(tipo: TipoCatalogo, valor: string, actual: string): boolean {
  if (valor === '' || valor === actual) return true;
  return !!getDb().prepare('SELECT 1 FROM servicio_catalogo WHERE tipo = ? AND nombre = ? AND activo = 1').get(tipo, valor);
}
