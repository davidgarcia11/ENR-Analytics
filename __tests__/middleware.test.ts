/**
 * Tests de seguridad JWT para el middleware de /api/admin/*
 *
 * Cubre:
 * - Sin cookie → 401
 * - Token firmado con secreto incorrecto → 401
 * - Token expirado → 401
 * - Payload manipulado (forja de rol admin) → 401
 * - Algoritmo "none" (bypass clásico JWT) → 401
 * - Rol "user" / "supervisor" → 403
 * - Admin válido → pasa (200)
 */
import { describe, it, expect } from 'bun:test'
import { NextRequest } from 'next/server'
import { SignJWT } from 'jose'

const SECRET = 'test-secret-key-for-tests-only-minimum-32-chars'
process.env.JWT_SECRET = SECRET

// Importar el middleware DESPUÉS de configurar JWT_SECRET
const { middleware } = await import('../middleware')

function makeReq(cookie?: string): NextRequest {
  const headers: Record<string, string> = {}
  if (cookie) headers['cookie'] = `session=${cookie}`
  return new NextRequest('http://localhost/api/admin/users', { headers })
}

async function makeToken(
  payload: Record<string, unknown>,
  secret = SECRET,
  expiresIn = '7d'
): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(new TextEncoder().encode(secret))
}

describe('Middleware — protección JWT de /api/admin/*', () => {
  // ── Sin autenticación ──────────────────────────────────────────────────
  it('sin cookie de sesión → 401', async () => {
    const res = await middleware(makeReq())
    expect(res.status).toBe(401)
  })

  it('cookie con texto aleatorio (no JWT) → 401', async () => {
    const res = await middleware(makeReq('not-a-valid-jwt'))
    expect(res.status).toBe(401)
  })

  it('cookie vacía → 401', async () => {
    const res = await middleware(makeReq(''))
    expect(res.status).toBe(401)
  })

  // ── Firma inválida ─────────────────────────────────────────────────────
  it('JWT firmado con secreto incorrecto → 401', async () => {
    const token = await makeToken({ sub: '1', role: 'admin', username: 'hacker' }, 'wrong-secret-totally-different')
    const res = await middleware(makeReq(token))
    expect(res.status).toBe(401)
  })

  it('JWT expirado aunque tenga rol admin → 401', async () => {
    const token = await makeToken({ sub: '1', role: 'admin', username: 'admin' }, SECRET, '-1h')
    const res = await middleware(makeReq(token))
    expect(res.status).toBe(401)
  })

  // ── Manipulación de payload (ataques de forja) ─────────────────────────
  it('payload manipulado para elevar rol a admin → 401', async () => {
    // Token legítimo de usuario normal
    const validToken = await makeToken({ sub: '2', role: 'user', username: 'user1' })
    // Sustituir el payload por uno con role:'admin' pero mantener la firma original
    const [header, , signature] = validToken.split('.')
    const fakePayload = Buffer.from(
      JSON.stringify({
        sub: '2',
        role: 'admin',
        username: 'user1',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 86400,
      })
    ).toString('base64url')
    const tamperedToken = `${header}.${fakePayload}.${signature}`
    const res = await middleware(makeReq(tamperedToken))
    expect(res.status).toBe(401)
  })

  it('algoritmo "none" (bypass clásico de JWT) → 401', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
    const payload = Buffer.from(
      JSON.stringify({ sub: '1', role: 'admin', username: 'admin', exp: Math.floor(Date.now() / 1000) + 86400 })
    ).toString('base64url')
    const noneToken = `${header}.${payload}.`
    const res = await middleware(makeReq(noneToken))
    expect(res.status).toBe(401)
  })

  it('JWT con dos partes (header.payload sin firma) → 401', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url')
    const payload = Buffer.from(JSON.stringify({ role: 'admin' })).toString('base64url')
    const res = await middleware(makeReq(`${header}.${payload}`))
    expect(res.status).toBe(401)
  })

  // ── Roles no autorizados ───────────────────────────────────────────────
  it('JWT válido con rol "user" → 403', async () => {
    const token = await makeToken({ sub: '2', role: 'user', username: 'user1' })
    const res = await middleware(makeReq(token))
    expect(res.status).toBe(403)
  })

  it('JWT válido con rol "supervisor" → 403', async () => {
    const token = await makeToken({ sub: '3', role: 'supervisor', username: 'sup1' })
    const res = await middleware(makeReq(token))
    expect(res.status).toBe(403)
  })

  it('JWT válido con rol vacío → 403', async () => {
    const token = await makeToken({ sub: '4', role: '', username: 'norol' })
    const res = await middleware(makeReq(token))
    expect(res.status).toBe(403)
  })

  // ── Acceso legítimo ────────────────────────────────────────────────────
  it('JWT válido con rol "admin" → pasa (200)', async () => {
    const token = await makeToken({ sub: '1', role: 'admin', username: 'admin' })
    const res = await middleware(makeReq(token))
    expect(res.status).toBe(200)
  })
})

// ── Cobertura de toda la API (no solo /api/admin) ────────────────────────
// El matcher pasó de /api/admin/:path* a /api/:path*. El middleware valida el
// token y lo renueva; el permiso por pantalla lo sigue decidiendo requireAccess
// dentro de la ruta, que es quien tiene la BD (aquí no hay SQLite).
describe('Middleware — resto de la API', () => {
  const req = (path: string, cookie?: string) =>
    new NextRequest(`http://localhost${path}`, cookie ? { headers: { cookie: `session=${cookie}` } } : undefined)

  const setCookie = (res: Response) => res.headers.get('set-cookie') ?? ''

  it('ruta de panel sin cookie → pasa (la pantalla puede ser pública)', async () => {
    const res = await middleware(req('/api/caducados'))
    expect(res.status).toBe(200)
  })

  it('ruta de panel con token inválido → 401 y borra la cookie', async () => {
    const res = await middleware(req('/api/caducados', 'basura'))
    expect(res.status).toBe(401)
    expect(setCookie(res)).toContain('Max-Age=0')
  })

  it('ruta de panel con token válido → pasa', async () => {
    const token = await makeToken({ sub: '2', role: 'user', username: 'user1' })
    const res = await middleware(req('/api/caducados', token))
    expect(res.status).toBe(200)
  })

  it('login, logout, me, screen-permissions y jde-orders pasan aunque el token sea basura', async () => {
    for (const ruta of ['/api/auth/login', '/api/auth/logout', '/api/auth/me', '/api/screen-permissions', '/api/jde-orders']) {
      const res = await middleware(req(ruta, 'basura'))
      expect(res.status).toBe(200)
    }
  })
})

// ── Caducidad deslizante ─────────────────────────────────────────────────
describe('Middleware — renovación de la cookie', () => {
  const req = (path: string, cookie: string) =>
    new NextRequest(`http://localhost${path}`, { headers: { cookie: `session=${cookie}` } })

  it('token recién emitido (7d) → no se renueva', async () => {
    const token = await makeToken({ sub: '2', role: 'user', username: 'user1' })
    const res = await middleware(req('/api/caducados', token))
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  it('token al que le quedan menos de 6 días → se renueva con uno nuevo', async () => {
    const token = await makeToken({ sub: '2', role: 'user', username: 'user1' }, SECRET, '2d')
    const res = await middleware(req('/api/caducados', token))
    const cookie = res.headers.get('set-cookie') ?? ''
    expect(cookie).toContain('session=')
    expect(cookie).not.toContain(token)
  })

  it('el latido del provider no renueva: una pestaña olvidada no vive eternamente', async () => {
    const token = await makeToken({ sub: '2', role: 'user', username: 'user1' }, SECRET, '2d')
    for (const ruta of ['/api/auth/me', '/api/screen-permissions']) {
      const res = await middleware(req(ruta, token))
      expect(res.headers.get('set-cookie')).toBeNull()
    }
  })

  it('la cookie renovada usa las mismas opciones que cookieOptions() de lib/auth', async () => {
    const token = await makeToken({ sub: '2', role: 'user', username: 'user1' }, SECRET, '2d')
    const cookie = (await middleware(req('/api/caducados', token))).headers.get('set-cookie') ?? ''

    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Max-Age=604800')
    expect(cookie).toContain('Path=/')
    expect(cookie.toLowerCase()).toContain('samesite=lax')
    expect(cookie).not.toContain('Secure') // la request es http

    // El middleware no puede importar lib/auth (arrastraría bcryptjs y
    // next/headers al bundle edge), así que tiene su propia copia de estas
    // opciones. Esto caza que una de las dos cambie sin la otra. No se importa
    // cookieOptions porque otros tests mockean @/lib/auth y el mock se filtra.
    const fuente = require('node:fs').readFileSync('lib/auth.ts', 'utf8')
    expect(fuente).toContain('maxAge: 60 * 60 * 24 * 7')
    expect(fuente).toContain("sameSite: 'lax' as const")
    expect(fuente).toContain('httpOnly: true')
  })
})
