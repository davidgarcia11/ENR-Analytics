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
