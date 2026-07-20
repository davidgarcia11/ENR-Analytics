// Parseo de códigos de barras GS1-128 de palet: separa los campos logísticos
// (EAN, lote, cantidad, SSCC, fechas) que van concatenados en un mismo código.
// Soporta dos formatos de entrada:
//  - "crudo": el que emite el lector físico, con FNC1 (GS, \x1d) como separador
//    de campos de longitud variable.
//  - "legible": representación entre paréntesis, ej. "(01)08412345678905(10)LOTE123".
//
// ponytail: cubre solo los Application Identifiers de uso real en este panel
// (00, 01, 02, 10, 11, 15, 17, 21, 37). Si aparece un AI nuevo en un código real,
// añadirlo a FIXED_LENGTHS (longitud fija) o dejar que caiga en variable (assign default).

const GS = '\x1d'

// AIs de longitud fija (en dígitos, sin contar el propio AI de 2 dígitos).
// El resto de AIs soportados son de longitud variable, delimitados por GS o fin de cadena.
const FIXED_LENGTHS: Record<string, number> = {
  '00': 18, // SSCC
  '01': 14, // GTIN de la unidad comercial
  '02': 14, // GTIN de los artículos contenidos (packs/cajas)
  '11': 6,  // Fecha de producción (AAMMDD)
  '15': 6,  // Fecha de consumo preferente (AAMMDD)
  '17': 6,  // Fecha de caducidad (AAMMDD)
}

export interface Gs1Fields {
  sscc?: string
  ean?: string
  lote?: string
  serial?: string
  cantidad?: number
  fechaProduccion?: string
  caducidad?: string
  otros?: Record<string, string>
}

function gs1DateToIso(aammdd: string): string | undefined {
  if (!/^\d{6}$/.test(aammdd)) return undefined
  const yy = Number(aammdd.slice(0, 2))
  const mm = aammdd.slice(2, 4)
  // ponytail: el día "00" (GS1 = "fin de mes") se simplifica al día 01; ajustar si se necesita el día exacto
  const dd = aammdd.slice(4, 6) === '00' ? '01' : aammdd.slice(4, 6)
  return `${2000 + yy}-${mm}-${dd}`
}

function assign(fields: Gs1Fields, ai: string, value: string) {
  switch (ai) {
    case '00': fields.sscc = value; break
    case '01': // GTIN-14 tal cual; Reflex (HLVLIDP.VICIVL) guarda el valor completo, sin quitar el dígito indicador
    case '02': // GTIN de artículos contenidos (packs/cajas) — mismo tratamiento que el 01 para buscar por EAN
      fields.ean = value
      break
    case '10': fields.lote = value; break
    case '11': fields.fechaProduccion = gs1DateToIso(value); break
    case '17': fields.caducidad = gs1DateToIso(value); break
    case '21': fields.serial = value; break
    case '37': fields.cantidad = parseInt(value, 10); break
    default:
      fields.otros = fields.otros || {}
      fields.otros[ai] = value
  }
}

function parseParenthesized(raw: string): Gs1Fields {
  const fields: Gs1Fields = {}
  const re = /\((\d{2,4})\)([^(]*)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(raw)) !== null) {
    assign(fields, m[1], m[2].trim())
  }
  return fields
}

function parseRaw(raw: string): Gs1Fields {
  const fields: Gs1Fields = {}
  let i = 0
  while (i < raw.length) {
    const ai = raw.slice(i, i + 2)
    i += 2
    const fixedLen = FIXED_LENGTHS[ai]
    if (fixedLen != null) {
      assign(fields, ai, raw.slice(i, i + fixedLen))
      i += fixedLen
    } else {
      let end = raw.indexOf(GS, i)
      if (end === -1) end = raw.length
      assign(fields, ai, raw.slice(i, end))
      i = end
      if (raw[i] === GS) i += 1
    }
  }
  return fields
}

// Punto de entrada: detecta el formato (legible vs crudo) y devuelve los campos separados.
// Antes de intentar interpretarlo como GS1-128 con AIs, se comprueba si es un EAN-13/DUN-14
// "pelado" (el código de barras es directamente esos dígitos, sin envoltorio de AIs) — es el
// caso real de las etiquetas de artículo/caja, frente al SSCC de palet que sí va en GS1-128.
export function parseGs1(rawInput: string): Gs1Fields {
  const raw = rawInput.trim().replace(/^\]C1/, '') // símbolo AIM opcional que anteponen algunos lectores
  if (!raw) return {}
  if (/^\d{13}$/.test(raw)) return { ean: raw } // EAN-13 suelto
  if (/^\d{14}$/.test(raw)) return { ean: raw } // DUN-14/GTIN-14 suelto, tal cual (sin quitar el 0)
  return raw.includes('(') ? parseParenthesized(raw) : parseRaw(raw)
}
