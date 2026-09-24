// Zonas de las loteadoras (Funes 1, Funes 2, Pasteurizado...) y quién ve cada una.
// Las zonas se crean en /admin → Zonas; cada loteadora tiene una (o ninguna) y a
// cada zona se le asignan roles y usuarios. Reglas (docs/loteadora.md §17):
//
//   - El admin ve todas las loteadoras.
//   - Si el usuario tiene zonas propias (user_zonas), ve solo esas: SUSTITUYEN a
//     las de su rol, para poder restringir o ampliar a una persona sin crear un rol.
//   - Si no, las de su rol (role_zonas). Sin zonas en ningún sitio → ve todas.
//   - Un usuario restringido NO ve las loteadoras sin zona (una máquina recién dada
//     de alta no aparece a quien no debe hasta que se le asigne zona).
//
// Recibe la BD por parámetro (sin dependencias de servidor) para poder probarla.
import type Database from 'better-sqlite3';

/** Zonas que puede ver el usuario; `null` = todas. */
export function zonasVisibles(db: Database.Database, user: { id: number; role: string } | null): number[] | null {
  if (!user || user.role === 'admin') return null;
  const ids = (sql: string, param: number | string) =>
    (db.prepare(sql).all(param) as { zona_id: number }[]).map((r) => r.zona_id);
  const propias = ids('SELECT zona_id FROM user_zonas WHERE user_id = ?', user.id);
  if (propias.length > 0) return propias;
  const delRol = ids('SELECT rz.zona_id FROM role_zonas rz JOIN roles r ON r.id = rz.role_id WHERE r.name = ?', user.role);
  return delRol.length > 0 ? delRol : null;
}

export function puedeVerLoteadora(zonas: number[] | null, zonaId: number | null): boolean {
  return zonas === null || (zonaId !== null && zonas.includes(zonaId));
}
