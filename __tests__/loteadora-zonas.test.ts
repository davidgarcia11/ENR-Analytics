/**
 * Tests de quién ve cada loteadora según su zona (lib/loteadora-zonas.ts).
 * BD en memoria con bun:sqlite (misma API que better-sqlite3 para lo que se usa).
 */
import { describe, it, expect } from 'bun:test'
import { Database } from 'bun:sqlite'
import { puedeVerLoteadora, zonasVisibles } from '@/lib/loteadora-zonas'

const bd = () => {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE roles (id INTEGER PRIMARY KEY, name TEXT);
    CREATE TABLE role_zonas (role_id INTEGER, zona_id INTEGER);
    CREATE TABLE user_zonas (user_id INTEGER, zona_id INTEGER);
    INSERT INTO roles VALUES (1, 'admin'), (2, 'operario_funes1'), (3, 'user');
    -- zonas: 10 = Funes 1, 20 = Funes 2, 30 = Pasteurizado
    INSERT INTO role_zonas VALUES (2, 10), (1, 30);
    INSERT INTO user_zonas VALUES (7, 20);
  `)
  return db as any
}

describe('zonasVisibles', () => {
  it('el admin ve todas, aunque su rol tenga zonas', () => {
    expect(zonasVisibles(bd(), { id: 1, role: 'admin' })).toBeNull()
  })

  it('sin zonas en el rol ni en el usuario ve todas', () => {
    expect(zonasVisibles(bd(), { id: 5, role: 'user' })).toBeNull()
  })

  it('usa las zonas de su rol', () => {
    expect(zonasVisibles(bd(), { id: 5, role: 'operario_funes1' })).toEqual([10])
  })

  it('las zonas propias del usuario sustituyen a las de su rol', () => {
    expect(zonasVisibles(bd(), { id: 7, role: 'operario_funes1' })).toEqual([20])
    expect(zonasVisibles(bd(), { id: 7, role: 'user' })).toEqual([20])
  })
})

describe('puedeVerLoteadora', () => {
  it('sin restricción ve todas, también las que no tienen zona', () => {
    expect(puedeVerLoteadora(null, 10)).toBe(true)
    expect(puedeVerLoteadora(null, null)).toBe(true)
  })

  it('restringido: solo las de sus zonas, y nunca las que no tienen zona', () => {
    expect(puedeVerLoteadora([10], 10)).toBe(true)
    expect(puedeVerLoteadora([10], 20)).toBe(false)
    expect(puedeVerLoteadora([10], null)).toBe(false)
  })
})
