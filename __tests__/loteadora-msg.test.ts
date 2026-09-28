/**
 * Test de lib/loteadora-msg.ts
 *
 * El formato .msg de la loteadora no está documentado: se comprueba contra .msg
 * reales guardados por la máquina (fixtures/):
 *   - T_CAMPOS.msg: plantilla de 3 campos (ID 1, 2 y 3, 3 caracteres, caja de 99)
 *     creada desde el panel con el comando antiguo, que colocaba con 21 puntos por
 *     carácter y un hueco para el reloj tras el campo 2 (X = 0, 84, 273).
 *   - T_RELOJ_ARIAL.msg: un reloj HHmm en Arial 35 creado a mano en la máquina.
 * El bloque final del .msg (ajustes que la máquina copia de su memoria) cambia de
 * un archivo a otro y no se compara.
 */
import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { generarMsg } from '@/lib/loteadora-msg'
import { disponerMensaje, type Campo } from '@/lib/loteadora-plantilla'

const fixture = (n: string) => readFileSync(join(import.meta.dir, 'fixtures', n))
const utf16 = (s: string) => Buffer.from(s, 'utf16le').swap16()
const LARGO_BLOQUE_FINAL = 367
const sinBloqueFinal = (b: Buffer) => b.subarray(0, b.length - LARGO_BLOQUE_FINAL)
// Bytes de la lista de relojes (entre listTimeModule y listNumModule)
const listaRelojes = (b: Buffer) => b.subarray(b.indexOf(utf16('listTimeModule')), b.indexOf(utf16('listNumModule')))

const TRES_CAMPOS: Campo[] = [1, 2, 3].map((fieldId) => ({ fieldId, piezas: [{ tipo: 'texto', valor: 'AAA' }], linea: 1 }))

describe('generarMsg', () => {
  it('reproduce los campos de un .msg de la máquina (T_CAMPOS)', () => {
    const d = disponerMensaje(TRES_CAMPOS)
    expect(d.campos.map((c) => c.ancho)).toEqual([99, 99, 99])
    // Posiciones del comando antiguo (21 por carácter y el hueco del reloj)
    d.campos[1].x = 84
    d.campos[2].x = 273
    const msg = generarMsg('T_CAMPOS', { campos: d.campos, relojes: [] })
    expect(sinBloqueFinal(msg).equals(sinBloqueFinal(fixture('T_CAMPOS.msg')))).toBe(true)
  })

  it('reproduce el reloj HHmm en Arial de la máquina (T_RELOJ_ARIAL)', () => {
    const d = disponerMensaje([{ fieldId: 1, piezas: [{ tipo: 'reloj', formato: 'HHmm' }, { tipo: 'texto', valor: 'AAA' }] }])
    const msg = generarMsg('X', d)
    // La máquina guarda como muestra la hora a la que se creó; el panel pone 1200
    const real = Buffer.from(listaRelojes(fixture('T_RELOJ_ARIAL.msg')))
    utf16('1200').copy(real, real.indexOf(utf16('1503')))
    expect(listaRelojes(msg).equals(real)).toBe(true)
  })

  it('pone el nombre del mensaje con su .msg', () => {
    const msg = generarMsg('N05_PRUEBA', disponerMensaje(TRES_CAMPOS))
    expect(msg.readInt32BE(4)).toBe(utf16('N05_PRUEBA.msg').length)
    expect(msg.subarray(8, 8 + utf16('N05_PRUEBA.msg').length).equals(utf16('N05_PRUEBA.msg'))).toBe(true)
  })

  it('un mensaje sin campos no se puede generar', () => {
    expect(() => generarMsg('X', { campos: [], relojes: [] })).toThrow()
  })
})
