/**
 * Tests de la validación FEFO de /consulta-stock-pda
 *
 * Verifica que la decisión de "¿puedo consumir este palet?" se toma con el LOTE como unidad
 * (no el palet), que la comparación se hace solo contra los lotes de la nave consultada, y que
 * las dos sub-plantas de Funes no se contaminan entre sí.
 *
 * Los casos están construidos a partir de datos REALES de Reflex (ver docs/consulta-stock-pda.md
 * §7.5): el lote 123456 del artículo 1313300003 tiene 2 palets en Funes 1 (caducidad 2026-05-25,
 * calidad CAL = bloqueado) y 23 en Funes 2 (caducidad 2026-08-04, calidad STD) — el mismo lote con
 * fechas distintas según la nave, que es justo lo que obliga a comparar por lote.
 */
import { describe, it, expect } from 'bun:test'
import { validarPaletEscaneado } from '@/app/api/consulta-stock-pda/route'

const FUNES_1 = '004'
const FUNES_2 = '005'

type Palet = {
    lote: string; sscc: string | null; cantidad: number
    fechaCaducidad: string | null; ubicacion: string | null; planta: string | null
    subplanta: string | null; caducado: boolean; bloqueado: boolean
}

// Helper para no repetir los campos que no influyen en la decisión
function palet(over: Partial<Palet> & { sscc: string; lote: string }): Palet {
    return {
        cantidad: 1, fechaCaducidad: '2026-12-31', ubicacion: null, planta: 'Funes',
        subplanta: FUNES_1, caducado: false, bloqueado: false,
        ...over,
    }
}

// Reproduce lo que hace el route: filtra por sub-planta (dejando pasar los sin nave) y
// calcula el subconjunto consumible.
function preparar(todos: Palet[], subplanta: string) {
    const palets = subplanta
        ? todos.filter(p => p.subplanta === null || p.subplanta === subplanta)
        : todos
    const consumibles = palets.filter(p => !p.caducado && !p.bloqueado && p.fechaCaducidad)
    return { todos, palets, consumibles }
}

function validar(todos: Palet[], sscc: string, subplanta: string, ubicacion = 'Funes 1') {
    const { palets, consumibles } = preparar(todos, subplanta)
    return validarPaletEscaneado(sscc, todos, palets, consumibles, ubicacion, subplanta)
}

describe('Validación por LOTE, no por palet', () => {
    it('el lote entero está en la otra nave → avisa de la sub-planta, no de "no está en stock"', () => {
        const todos = [
            palet({ sscc: 'A1', lote: 'SOLO-F2', subplanta: FUNES_2 }),
            palet({ sscc: 'A2', lote: 'SOLO-F2', subplanta: FUNES_2 }),
        ]
        const v = validar(todos, 'A1', FUNES_1)
        expect(v.estado).toBe('otra_subplanta')
        expect(v.subplantaReal).toBe(FUNES_2)
        expect(v.mensajes[0]).toContain('Este lote está en Funes 2')
        expect(v.mensajes[0]).toContain('no en Funes 1')
    })

    it('el palet está en la otra nave pero su LOTE sí está en la mía → se trata normal, con nota', () => {
        // Caso real: lote 123456 repartido entre las dos naves
        const todos = [
            palet({ sscc: 'EN-F1', lote: '123456', subplanta: FUNES_1, fechaCaducidad: '2026-05-25' }),
            palet({ sscc: 'EN-F2', lote: '123456', subplanta: FUNES_2, fechaCaducidad: '2026-08-04' }),
        ]
        const v = validar(todos, 'EN-F2', FUNES_1)
        expect(v.estado).toBe('correcto')
        expect(v.nota).toContain('registrado en Funes 2')
        expect(v.nota).toContain('el lote sí está en Funes 1')
    })

    it('el palet escaneado está en mi nave → sin nota', () => {
        const todos = [palet({ sscc: 'EN-F1', lote: '123456', subplanta: FUNES_1 })]
        const v = validar(todos, 'EN-F1', FUNES_1)
        expect(v.estado).toBe('correcto')
        expect(v.nota).toBeUndefined()
    })

    it('SSCC que no existe en ninguna nave → no encontrado', () => {
        const todos = [palet({ sscc: 'OTRO', lote: 'L1' })]
        const v = validar(todos, 'NO-EXISTE', FUNES_1)
        expect(v.estado).toBe('no_encontrado')
        expect(v.mensajes[0]).toContain('en Funes 1')
    })
})

describe('Comparación FEFO contra los lotes de la nave', () => {
    it('un lote anterior en MI nave sí avisa', () => {
        const todos = [
            palet({ sscc: 'VIEJO', lote: 'ANTES', subplanta: FUNES_1, fechaCaducidad: '2026-01-01' }),
            palet({ sscc: 'NUEVO', lote: 'DESPUES', subplanta: FUNES_1, fechaCaducidad: '2026-06-01' }),
        ]
        const v = validar(todos, 'NUEVO', FUNES_1)
        expect(v.estado).toBe('aviso')
        expect(v.mensajes[0]).toContain('caducan antes')
    })

    it('un lote anterior en la OTRA nave NO avisa (es el bug que motiva la funcionalidad)', () => {
        const todos = [
            palet({ sscc: 'VIEJO', lote: 'ANTES', subplanta: FUNES_2, fechaCaducidad: '2026-01-01' }),
            palet({ sscc: 'NUEVO', lote: 'DESPUES', subplanta: FUNES_1, fechaCaducidad: '2026-06-01' }),
        ]
        const v = validar(todos, 'NUEVO', FUNES_1)
        expect(v.estado).toBe('correcto')
    })

    it('sin filtro de sub-planta, el lote de la otra nave SÍ cuenta (comportamiento previo intacto)', () => {
        const todos = [
            palet({ sscc: 'VIEJO', lote: 'ANTES', subplanta: FUNES_2, fechaCaducidad: '2026-01-01' }),
            palet({ sscc: 'NUEVO', lote: 'DESPUES', subplanta: FUNES_1, fechaCaducidad: '2026-06-01' }),
        ]
        const v = validar(todos, 'NUEVO', '', 'Funes')
        expect(v.estado).toBe('aviso')
    })

    it('dos palets del MISMO lote con fechas distintas no avisan contra sí mismos', () => {
        // Sin la exclusión por lote, el palet de 2026-08-04 avisaría por el de 2026-05-25,
        // que es del mismo lote (caso real del lote 123456 con DLC/DLU mezcladas)
        const todos = [
            palet({ sscc: 'P1', lote: '123456', subplanta: FUNES_1, fechaCaducidad: '2026-05-25' }),
            palet({ sscc: 'P2', lote: '123456', subplanta: FUNES_1, fechaCaducidad: '2026-08-04' }),
        ]
        const v = validar(todos, 'P2', FUNES_1)
        expect(v.estado).toBe('correcto')
    })

    it('empate de fechas entre lotes distintos cuenta como correcto', () => {
        const todos = [
            palet({ sscc: 'P1', lote: 'L1', subplanta: FUNES_1, fechaCaducidad: '2026-06-01' }),
            palet({ sscc: 'P2', lote: 'L2', subplanta: FUNES_1, fechaCaducidad: '2026-06-01' }),
        ]
        expect(validar(todos, 'P2', FUNES_1).estado).toBe('correcto')
    })

    it('un lote anterior caducado o bloqueado no cuenta como alternativa', () => {
        const todos = [
            palet({ sscc: 'CAD', lote: 'ANTES-CAD', subplanta: FUNES_1, fechaCaducidad: '2026-01-01', caducado: true }),
            palet({ sscc: 'BLQ', lote: 'ANTES-BLQ', subplanta: FUNES_1, fechaCaducidad: '2026-02-01', bloqueado: true }),
            palet({ sscc: 'OK', lote: 'DESPUES', subplanta: FUNES_1, fechaCaducidad: '2026-06-01' }),
        ]
        expect(validar(todos, 'OK', FUNES_1).estado).toBe('correcto')
    })
})

describe('Estado del propio palet (sigue siendo por palet, no por lote)', () => {
    it('palet bloqueado dentro de un lote con palets sanos → avisa solo por ese palet', () => {
        // Caso real: lote M-C-B/4 con 19 de 20 palets bloqueados
        const todos = [
            palet({ sscc: 'SANO', lote: 'M-C-B/4', subplanta: FUNES_1 }),
            palet({ sscc: 'BLOQ', lote: 'M-C-B/4', subplanta: FUNES_1, bloqueado: true }),
        ]
        expect(validar(todos, 'SANO', FUNES_1).estado).toBe('correcto')
        const v = validar(todos, 'BLOQ', FUNES_1)
        expect(v.estado).toBe('aviso')
        expect(v.mensajes[0]).toContain('bloqueado por Calidad')
    })

    it('caducado y bloqueado a la vez → los dos mensajes, caducado primero', () => {
        const todos = [palet({ sscc: 'X', lote: 'L1', subplanta: FUNES_1, caducado: true, bloqueado: true })]
        const v = validar(todos, 'X', FUNES_1)
        expect(v.estado).toBe('aviso')
        expect(v.mensajes).toHaveLength(2)
        expect(v.mensajes[0]).toContain('Caducado')
        expect(v.mensajes[1]).toContain('bloqueado por Calidad')
    })

    it('sin fecha de caducidad → sin_fecha, sin intentar comparar', () => {
        const todos = [
            palet({ sscc: 'X', lote: 'L1', subplanta: FUNES_1, fechaCaducidad: null }),
            palet({ sscc: 'Y', lote: 'L2', subplanta: FUNES_1, fechaCaducidad: '2020-01-01' }),
        ]
        expect(validar(todos, 'X', FUNES_1).estado).toBe('sin_fecha')
    })

    it('el aviso del palet mantiene la nota de nave cruzada', () => {
        const todos = [
            palet({ sscc: 'EN-F1', lote: 'L1', subplanta: FUNES_1 }),
            palet({ sscc: 'EN-F2', lote: 'L1', subplanta: FUNES_2, caducado: true }),
        ]
        const v = validar(todos, 'EN-F2', FUNES_1)
        expect(v.estado).toBe('aviso')
        expect(v.nota).toContain('registrado en Funes 2')
    })
})

describe('Palets sin sub-planta asignada (ubicaciones de tránsito de Funes)', () => {
    it('se ven desde cualquier nave', () => {
        const todos = [palet({ sscc: 'TRANSITO', lote: 'L1', subplanta: null })]
        expect(validar(todos, 'TRANSITO', FUNES_1).estado).toBe('correcto')
        expect(validar(todos, 'TRANSITO', FUNES_2, 'Funes 2').estado).toBe('correcto')
    })

    it('cuentan en la comparación FEFO de las dos naves', () => {
        const todos = [
            palet({ sscc: 'TRANSITO', lote: 'ANTES', subplanta: null, fechaCaducidad: '2026-01-01' }),
            palet({ sscc: 'EN-F2', lote: 'DESPUES', subplanta: FUNES_2, fechaCaducidad: '2026-06-01' }),
        ]
        expect(validar(todos, 'EN-F2', FUNES_2, 'Funes 2').estado).toBe('aviso')
    })

    it('un palet sin nave no dispara la nota de nave cruzada', () => {
        const todos = [palet({ sscc: 'TRANSITO', lote: 'L1', subplanta: null })]
        expect(validar(todos, 'TRANSITO', FUNES_1).nota).toBeUndefined()
    })
})
