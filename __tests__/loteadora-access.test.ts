/**
 * Tests de control de acceso del panel de loteadora (/loteadora)
 *
 * A diferencia del resto de paneles, este dispara acciones físicas reales
 * (imprime etiquetas, carga plantillas en la máquina), así que no puede quedar
 * abierto ni a anónimos ni a cualquier usuario con sesión. Estos dos tests
 * blindan las dos mitades de esa regla, que viven en sitios distintos y son
 * fáciles de romper sin darse cuenta:
 *
 * - `privado: true` en PANELS → la fila de `screens` nace con is_public = 0.
 *   Sin la marca, una instalación nueva deja el panel accesible SIN SESIÓN
 *   (lib/permissions.ts sale por `if (screen.is_public === 1) return null`).
 * - Las rutas que actúan sobre la máquina pasan por requireScreenAccess.
 *   Un bare verifySession() no basta: dejaría entrar a cualquier usuario
 *   logueado, sin mirar los permisos configurados en /admin → Pantallas.
 */
import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PANELS } from '../lib/panels'

describe('loteadora — pantalla privada por defecto', () => {
  it('PANELS marca loteadora como privada', () => {
    const loteadora = PANELS.find(p => p.key === 'loteadora')
    expect(loteadora).toBeDefined()
    expect('privado' in loteadora! && loteadora!.privado).toBe(true)
  })

  it('ningún otro panel se marca privado sin querer', () => {
    const privados = PANELS.filter(p => 'privado' in p && p.privado).map(p => p.key)
    expect(privados).toEqual(['loteadora'])
  })
})

describe('loteadora — rutas que actúan sobre la máquina', () => {
  // Las que mandan comandos TIJ a la impresora. Las de solo lectura
  // (articulos/estado/impresoras) son públicas a propósito: alimentan la vista
  // en vivo y no mueven nada en la máquina.
  const rutasProtegidas = ['enviar', 'cargar-mensaje', 'limpiar-buffer', 'mensajes']

  for (const ruta of rutasProtegidas) {
    it(`/api/loteadora/${ruta} exige requireScreenAccess('loteadora')`, () => {
      const src = readFileSync(join(import.meta.dir, '..', 'app', 'api', 'loteadora', ruta, 'route.ts'), 'utf8')
      expect(src).toContain("requireScreenAccess('loteadora')")
    })
  }
})
