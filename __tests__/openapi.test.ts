/**
 * Test de contrato: docs/api-integracion.openapi.yaml (lo que se entrega a terceros)
 * tiene que decir lo mismo que el código (lib/integracion.ts y la ruta del escaneo).
 * Si alguien cambia uno y no el otro, este test falla.
 */
import { describe, it, expect } from 'bun:test'
import { CAMPOS_ESCANEO, CODIGOS_ERROR, MAX_CUERPO, validarEscaneo } from '@/lib/integracion'
import { LIMITE_POR_MINUTO } from '@/lib/api-claves'

const spec: any = Bun.YAML.parse(await Bun.file('docs/api-integracion.openapi.yaml').text())
const ruta = await Bun.file('app/api/integracion/v1/escaneo/route.ts').text()
const op = spec.paths['/api/integracion/v1/escaneo'].post
const esquema = spec.components.schemas.Escaneo
const props: Record<string, any> = esquema.properties
const ejemplos: Record<string, any> = Object.fromEntries(
  Object.entries<any>(op.requestBody.content['application/json'].examples).map(([k, v]) => [k, v.value]),
)
const completo = ejemplos.ok
const errores = (cuerpo: unknown) => { const v = validarEscaneo(cuerpo); return 'errores' in v ? v.errores : [] }

describe('especificación', () => {
  it('es OpenAPI 3 y todas sus $ref existen', () => {
    expect(spec.openapi).toMatch(/^3\./)
    const refs = [...JSON.stringify(spec).matchAll(/"\$ref":"#\/([^"]+)"/g)].map((m) => m[1])
    for (const r of refs) expect(r.split('/').reduce((o: any, k) => o?.[k], spec)).toBeDefined()
  })

  it('se autentica con la cabecera x-api-key, la misma que lee la ruta', () => {
    expect(spec.components.securitySchemes.claveApi).toMatchObject({ type: 'apiKey', in: 'header', name: 'x-api-key' })
    expect(ruta).toContain("req.headers.get('x-api-key')")
  })

  it('se entrega a terceros: sin comentarios ni referencias internas', async () => {
    const crudo = await Bun.file('docs/api-integracion.openapi.yaml').text()
    expect(crudo.split('\n').filter((l) => l.trimStart().startsWith('#'))).toEqual([])
    expect(crudo).not.toMatch(/\b(app|lib|docs)\/|components\/nova|\/admin|\bdashboard\b|\bpanel\b|loteadora|golive/i)
  })

  it('no lleva claves ni IPs reales', () => {
    const texto = JSON.stringify(spec)
    expect(texto).not.toMatch(/enr_(test|live)_[A-Za-z0-9_-]{20,}/)
    expect(texto).not.toMatch(/\b(?:192\.168|10)\.\d+\.\d+\.\d+\b/)
  })
})

describe('el contrato coincide con la validación', () => {
  it('los ejemplos de envío los acepta la API', () => {
    for (const [nombre, cuerpo] of Object.entries(ejemplos)) expect([nombre, errores(cuerpo)]).toEqual([nombre, []])
  })

  it('obligatorios y opcionales: los mismos en la especificación y en el código', () => {
    for (const campo of Object.keys(props)) {
      const { [campo]: _, ...sin } = completo
      const falta = errores(sin).some((e) => e.startsWith(`${campo}: es obligatorio`))
      expect([campo, falta]).toEqual([campo, esquema.required.includes(campo)])
    }
  })

  it('los campos admitidos son los mismos, y los demás se rechazan en los dos', () => {
    expect(Object.keys(props).sort()).toEqual([...CAMPOS_ESCANEO].sort())
    expect(esquema.additionalProperties).toBe(false)
    expect(errores({ ...completo, extra: 'x' })).toEqual(['extra: campo no admitido'])
  })

  it('todos los campos de la especificación los conoce el código (y van como texto)', () => {
    for (const campo of Object.keys(props)) {
      expect(errores({ ...completo, [campo]: 12 })).toContain(`${campo}: debe ir como texto, entre comillas`)
    }
  })

  it('las longitudes máximas coinciden', () => {
    for (const [campo, p] of Object.entries(props)) {
      if (!p.maxLength || p.pattern) continue
      expect([campo, errores({ ...completo, [campo]: 'a'.repeat(p.maxLength) })]).toEqual([campo, []])
      expect(errores({ ...completo, [campo]: 'a'.repeat(p.maxLength + 1) })).toContain(`${campo}: como mucho ${p.maxLength} caracteres`)
    }
  })

  it('los formatos (pattern) aceptan y rechazan lo mismo que el código', () => {
    const casos: Record<string, string[]> = {
      articulo: ['1210500019', '121050001', '12105000190', 'A210500019'],
      sscc: ['384123450000000017', '38412345000000001', 'A84123450000000017'],
      linea: ['18', '5', 'L18', '18A', '1 8'],
      orden: ['490387', 'OF490387', '49-0387'],
    }
    for (const [campo, valores] of Object.entries(casos)) {
      const patron = new RegExp(props[campo].pattern)
      for (const v of valores) {
        expect([campo, v, errores({ ...completo, [campo]: v }).length === 0]).toEqual([campo, v, patron.test(v)])
      }
    }
  })

  it('el enum de resultado es el del código', () => {
    for (const v of props.resultado.enum) expect(errores({ ...completo, resultado: v })).toEqual([])
    expect(errores({ ...completo, resultado: 'ok' }).length).toBe(1)
  })
})

describe('las respuestas de ejemplo son las reales', () => {
  // Errores que puede dar la validación con entradas incorrectas de todo tipo
  const reales = new Set<string>()
  for (const campo of Object.keys(props)) {
    const { [campo]: _, ...sin } = completo
    for (const c of [sin, { ...completo, [campo]: 12 }, { ...completo, [campo]: '' }, { ...completo, [campo]: 'x' }, { ...completo, [campo]: '1'.repeat(17) }, { ...completo, [campo]: 'x'.repeat(300) }]) {
      for (const e of errores(c)) reales.add(e)
    }
  }
  for (const e of errores({ ...completo, resultado: 'ok' })) reales.add(e)
  for (const e of errores({ ...completo, sscc: '00' + completo.sscc })) reales.add(e)
  for (const e of errores({ ...completo, motivo: 'x' })) reales.add(e)

  it('los errores de los ejemplos de 400 existen (o los da la ruta)', () => {
    for (const ej of Object.values<any>(op.responses['400'].content['application/json'].examples)) {
      for (const e of ej.value.errores) expect([e, reales.has(e) || ruta.includes(e)]).toEqual([e, true])
    }
  })

  it('los límites del contrato son los del código (413 y 429)', () => {
    const r = op.responses
    expect(spec.info.description).toContain(`${LIMITE_POR_MINUTO} peticiones por minuto`)
    expect(spec.info.description).toContain(`${MAX_CUERPO} bytes`)
    expect(r['413'].content['application/json'].examples.grande.value.errores).toEqual([`El cuerpo ocupa demasiado (máximo ${MAX_CUERPO} bytes)`])
    expect(r['429'].content['application/json'].examples.limite.value.errores).toEqual([`Demasiadas peticiones: como mucho ${LIMITE_POR_MINUTO} por minuto con cada clave`])
    expect(r['429'].headers['Retry-After']).toBeDefined()
    expect(ruta).toContain('rechazar(413, ')
    expect(ruta).toContain('error(429, ')
    expect(ruta).toContain("'Retry-After'")
  })

  it('todos los errores con la misma forma y un código que existe y usa la ruta con su estado', () => {
    expect(spec.components.schemas.Error.properties.codigo.enum).toEqual([...CODIGOS_ERROR])
    const estadoDe: Record<string, string> = {
      CLAVE_NO_VALIDA: '401', DEMASIADAS_PETICIONES: '429', TIPO_NO_ADMITIDO: '415', DEMASIADO_GRANDE: '413',
      DATOS_INCORRECTOS: '400', ID_EN_CONFLICTO: '409', ERROR_INTERNO: '500',
    }
    expect(Object.keys(estadoDe).sort()).toEqual([...CODIGOS_ERROR].sort())
    for (const [estado, resp] of Object.entries<any>(op.responses)) {
      if (Number(estado) < 400) continue
      expect([estado, resp.content['application/json'].schema.$ref]).toEqual([estado, '#/components/schemas/Error'])
      for (const ej of Object.values<any>(resp.content['application/json'].examples)) {
        expect(Object.keys(ej.value).sort()).toEqual(['codigo', 'errores', 'ok'])
        expect([estado, estadoDe[ej.value.codigo]]).toEqual([estado, estado])
        // La ruta responde ese código con ese estado
        expect(ruta).toMatch(new RegExp(`(error|rechazar)\\(${estado}, '${ej.value.codigo}'`))
      }
    }
  })

  it('los textos de 401, 409, 415 y 500 son los de la ruta', () => {
    const ej = (estado: string, nombre: string) => op.responses[estado].content['application/json'].examples[nombre].value.errores[0] as string
    expect(ruta).toContain(ej('401', 'clave'))
    expect(ruta).toContain(ej('500', 'interno'))
    expect(ej('409', 'conflicto')).toMatch(/ya se recibió con otros datos; cada mensaje necesita un id distinto$/)
    expect(ruta).toContain('ya se recibió con otros datos; cada mensaje necesita un id distinto')
    expect(ej('415', 'tipo')).toStartWith('El cuerpo tiene que enviarse como JSON (cabecera Content-Type: application/json')
    expect(ruta).toContain('El cuerpo tiene que enviarse como JSON (cabecera Content-Type: application/json')
    expect(op.responses['401'].headers['WWW-Authenticate']).toBeDefined()
    expect(ruta).toContain("'WWW-Authenticate'")
  })

  it('los estados de 202/200 son los de la ruta', () => {
    expect(ruta).toContain("estado: 'recibido'")
    expect(ruta).toContain("estado: 'duplicado'")
    expect(ruta).toContain('status: 202')
    expect(spec.components.schemas.Recibido.properties.estado.enum).toEqual(['recibido', 'duplicado'])
  })
})
