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

describe('loteadora — todas sus rutas exigen permiso de pantalla', () => {
  // Las cuatro primeras mandan comandos TIJ a la impresora. Las tres de solo
  // lectura también entran: `estado` abre una conexión TCP a cada máquina y
  // `articulos` consulta la F4101 entera — no mover nada en la impresora no las
  // hacía inofensivas, y el panel es privado, así que nadie anónimo las necesita.
  const rutasProtegidas = ['enviar', 'cargar-mensaje', 'limpiar-buffer', 'mensajes', 'articulos', 'estado', 'impresoras']

  for (const ruta of rutasProtegidas) {
    it(`/api/loteadora/${ruta} exige requireScreenAccess('loteadora')`, () => {
      const src = readFileSync(join(import.meta.dir, '..', 'app', 'api', 'loteadora', ruta, 'route.ts'), 'utf8')
      expect(src).toContain("requireScreenAccess('loteadora')")
    })
  }
})
