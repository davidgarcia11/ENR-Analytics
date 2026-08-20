// Fuente única de las 4 plantas físicas de la empresa. Cada sistema tiene su
// propio código para la misma planta (JDE vs Reflex), y el código canónico
// (id) es el que se guarda en users.default_plant — no depende de ningún
// sistema externo. Códigos JDE confirmados contra F0006 (WHERE MCSTYL = 'BP').
export interface PlantDef {
    id: string
    label: string
    jde: string
    reflex: string
}

export const PLANTS: PlantDef[] = [
    { id: 'aguilar', label: 'Aguilar', jde: '10100', reflex: '001' },
    { id: 'corella', label: 'Corella', jde: '10200', reflex: '002' },
    { id: 'funes', label: 'Funes', jde: '10300', reflex: '004' },
    { id: 'tudefrigo', label: 'Tudefrigo', jde: '10003', reflex: '006' },
]

export function plantLabel(id: string | null | undefined): string | null {
    return PLANTS.find(p => p.id === id)?.label ?? null
}

// null si el usuario no tiene planta por defecto, o si el id no es reconocido
export function plantJdeCode(id: string | null | undefined): string | null {
    return PLANTS.find(p => p.id === id)?.jde ?? null
}

export function plantReflexCode(id: string | null | undefined): string | null {
    return PLANTS.find(p => p.id === id)?.reflex ?? null
}

// Sub-plantas físicas de Funes en Reflex (HLEMPLP.EMCMGN). Funes es la única planta
// con más de una nave, y el stock de un mismo artículo se reparte entre ellas — un
// lote que caduca antes puede estar en la nave de al lado y no ser accesible desde
// donde está el operario, así que /consulta-stock-pda filtra por sub-planta.
//
// OJO: EMCMGN NO es único entre depósitos (comprobado contra datos reales: el valor
// '001' aparece en los depósitos 001 y 002, y '006' en 002 y 006). Solo '004'/'005'
// son exclusivos de Funes. Cualquier filtro por sub-planta debe ir SIEMPRE acompañado
// del depósito (EMCDPO = '004'), nunca por EMCMGN suelto.
//
// No mapean 1:1 con las sub-líneas de /produccion (que salen de JDE y son tres:
// Funes 1 / Funes 2 / Funes Past.) — son sistemas y granularidades distintas.
export const FUNES_SUBPLANTS = [
    { reflex: '004', label: 'Funes 1' },
    { reflex: '005', label: 'Funes 2' },
] as const

export function funesSubplantLabel(reflexCode: string | null | undefined): string | null {
    return FUNES_SUBPLANTS.find(s => s.reflex === reflexCode)?.label ?? null
}

// true si esta planta (código Reflex) se subdivide en sub-plantas
export function plantHasSubplants(reflexCode: string | null | undefined): boolean {
    return reflexCode === PLANTS.find(p => p.id === 'funes')!.reflex
}
