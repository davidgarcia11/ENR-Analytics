/**
 * Tests de sanitización de entradas
 *
 * Verifica que la función de limpieza de nombres de rol (usada en POST /api/admin/roles)
 * neutraliza inyecciones SQL, XSS y caracteres peligrosos antes de llegar a la BD.
 * La sanitización es la primera línea de defensa; los bind variables son la segunda.
 */
import { describe, it, expect } from 'bun:test'

// Misma función que usa app/api/admin/roles/route.ts
const sanitizeRoleName = (name: string): string =>
  String(name).trim().toLowerCase().replace(/[^a-z0-9_]/g, '_')

describe('Sanitización del nombre de rol', () => {
  // ── Casos normales ─────────────────────────────────────────────────────
  it('nombre simple sin cambios', () => {
    expect(sanitizeRoleName('supervisor')).toBe('supervisor')
  })

  it('convierte a minúsculas', () => {
    expect(sanitizeRoleName('Supervisor')).toBe('supervisor')
  })

  it('reemplaza espacios con guion bajo', () => {
    expect(sanitizeRoleName('jefe produccion')).toBe('jefe_produccion')
  })

  it('guiones se convierten en guiones bajos', () => {
    expect(sanitizeRoleName('jefe-produccion')).toBe('jefe_produccion')
  })

  it('números son válidos', () => {
    expect(sanitizeRoleName('nivel2')).toBe('nivel2')
  })

  // ── Inyección SQL ──────────────────────────────────────────────────────
  it("inyección SQL clásica con comilla simple → sin ' ni ; ni espacios", () => {
    const input = "'; DROP TABLE roles; --"
    const result = sanitizeRoleName(input)
    expect(result).not.toContain("'")
    expect(result).not.toContain(';')
    expect(result).not.toContain(' ')
    expect(result).not.toContain('-')
    expect(result).toMatch(/^[a-z0-9_]+$/)
  })

  it("UNION SELECT injection → solo a-z0-9_", () => {
    const input = "admin' UNION SELECT password FROM users--"
    const result = sanitizeRoleName(input)
    expect(result).toMatch(/^[a-z0-9_]+$/)
    expect(result).not.toContain("'")
    expect(result).not.toContain(' ')
  })

  it('OR 1=1 injection → solo a-z0-9_', () => {
    const input = "x' OR '1'='1"
    const result = sanitizeRoleName(input)
    expect(result).toMatch(/^[a-z0-9_]+$/)
  })

  it('comentario SQL (--) → guiones reemplazados', () => {
    const input = 'admin--'
    const result = sanitizeRoleName(input)
    expect(result).not.toContain('-')
    expect(result).toBe('admin__')
  })

  // ── Inyección XSS ──────────────────────────────────────────────────────
  it('XSS con <script> → sin < > /', () => {
    const input = '<script>alert(1)</script>'
    const result = sanitizeRoleName(input)
    expect(result).not.toContain('<')
    expect(result).not.toContain('>')
    expect(result).not.toContain('/')
    expect(result).toMatch(/^[a-z0-9_]+$/)
  })

  it('XSS con evento onerror → sin = "', () => {
    const input = 'img onerror="alert(1)"'
    const result = sanitizeRoleName(input)
    expect(result).not.toContain('"')
    expect(result).not.toContain('=')
    expect(result).toMatch(/^[a-z0-9_]+$/)
  })

  // ── Caracteres especiales ──────────────────────────────────────────────
  it('email → sin @ ni .', () => {
    const result = sanitizeRoleName('admin@empresa.es')
    expect(result).toBe('admin_empresa_es')
  })

  it('ruta de sistema → sin / \\ :', () => {
    const result = sanitizeRoleName('../../../etc/passwd')
    expect(result).not.toContain('/')
    expect(result).not.toContain('.')
    expect(result).toMatch(/^[a-z0-9_]+$/)
  })

  it('null byte → eliminado', () => {
    const result = sanitizeRoleName('admin\x00user')
    expect(result).not.toContain('\x00')
    expect(result).toMatch(/^[a-z0-9_]+$/)
  })

  it('caracteres unicode no ASCII → reemplazados', () => {
    const result = sanitizeRoleName('résponsàble')
    expect(result).toMatch(/^[a-z0-9_]+$/)
  })

  it('emoji → reemplazado', () => {
    const result = sanitizeRoleName('admin🔥')
    expect(result).toMatch(/^[a-z0-9_]+$/)
  })

  // ── Casos límite ───────────────────────────────────────────────────────
  it('cadena vacía → cadena vacía', () => {
    expect(sanitizeRoleName('')).toBe('')
  })

  it('solo espacios → cadena vacía tras trim', () => {
    expect(sanitizeRoleName('   ').trim()).toBe('')
  })

  it('solo caracteres especiales → solo guiones bajos', () => {
    const result = sanitizeRoleName('!!!###')
    expect(result).toMatch(/^_+$/)
    // Nota: '______' pasa la validación !cleanName del código (no es vacío).
    // Este edge case se documenta: un nombre de solo guiones bajos sería aceptado.
    // No es un riesgo de seguridad pero podría mejorarse con /^[a-z]/.test(cleanName)
  })

  it('cadena muy larga no causa desbordamiento', () => {
    const longInput = 'a'.repeat(10000) + "'; DROP TABLE roles;"
    const result = sanitizeRoleName(longInput)
    expect(result).toMatch(/^[a-z0-9_]+$/)
    expect(result).not.toContain("'")
    expect(result.length).toBeGreaterThan(0)
  })
})
