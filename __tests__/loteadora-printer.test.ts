/**
 * Test de lib/loteadora-printer.ts
 *
 * Verifica buildRemoteFieldFrame() byte a byte contra el ejemplo resuelto del
 * propio manual del protocolo (TIJ_Protocol 6.7.pdf, §2.4 Checknum Calculation):
 * al rellenar el campo remoto "01" con el texto "TIJ Printer" (Slave Address "00"),
 * la trama completa —con checknum— es:
 *   1B 02 00 1D 01 01 0B 54 49 4A 20 50 72 69 6E 74 65 72 1B 03 B0
 */
import { describe, it, expect } from 'bun:test'
import net from 'net'
import { buildRemoteFieldFrame, listMessageNames } from '@/lib/loteadora-printer'

describe('buildRemoteFieldFrame', () => {
  it('reproduce el ejemplo del manual (checknum B0)', () => {
    const frame = buildRemoteFieldFrame(0, [{ id: 1, text: 'TIJ Printer' }])

    const esperado = Buffer.from([
      0x1b, 0x02, 0x00, 0x1d, 0x01,
      0x01, 0x0b, 0x54, 0x49, 0x4a, 0x20, 0x50, 0x72, 0x69, 0x6e, 0x74, 0x65, 0x72,
      0x1b, 0x03,
      0xb0,
    ])

    expect(frame.equals(esperado)).toBe(true)
  })

  it('soporta varios campos en la misma trama', () => {
    const frame = buildRemoteFieldFrame(0, [
      { id: 1, text: '26015' },
      { id: 2, text: '15/06/2026' },
    ])

    // 1B 02 [slave=00] 1D [numCampos=02] [id=01][len=05]"26015" [id=02][len=0A]"15/06/2026" 1B 03 [checknum]
    expect(frame[0]).toBe(0x1b)
    expect(frame[1]).toBe(0x02)
    expect(frame[3]).toBe(0x1d)
    expect(frame[4]).toBe(0x02)
    expect(frame[5]).toBe(0x01)
    expect(frame[6]).toBe(0x05)
    expect(frame.subarray(7, 12).toString('ascii')).toBe('26015')
    expect(frame[12]).toBe(0x02)
    expect(frame[13]).toBe(0x0a)
    expect(frame.subarray(14, 24).toString('ascii')).toBe('15/06/2026')
    expect(frame[24]).toBe(0x1b)
    expect(frame[25]).toBe(0x03)

    // El checknum debe hacer que la suma módulo-256 de toda la trama sea 0
    const sum = frame.reduce((acc, b) => (acc + b) & 0xff, 0)
    expect(sum).toBe(0)
  })

  it('rechaza un texto de campo vacío', () => {
    expect(() => buildRemoteFieldFrame(0, [{ id: 1, text: '' }])).toThrow()
  })

  it('rechaza una lista de campos vacía', () => {
    expect(() => buildRemoteFieldFrame(0, [])).toThrow()
  })
})

describe('listMessageNames', () => {
  it('parsea la lista de plantillas aunque la respuesta llegue troceada en varios paquetes TCP', async () => {
    const nombres = ['pruebaDavid.msg', 'otro.msg']
    const body: number[] = [0x1b, 0x06, 0x00, 0x00, 0x1f, nombres.length]
    for (const nombre of nombres) {
      const bytes = Buffer.from(nombre, 'ascii')
      body.push(bytes.length, ...bytes)
    }
    body.push(0x1b, 0x03, 0x00) // el checknum de la respuesta no se valida al recibir
    const respuesta = Buffer.from(body)

    const server = net.createServer(socket => {
      socket.once('data', () => {
        // Trocea la respuesta en dos escrituras para probar el buffering de sendCommand
        socket.write(respuesta.subarray(0, 10))
        setTimeout(() => socket.write(respuesta.subarray(10)), 10)
      })
    })

    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as net.AddressInfo).port

    try {
      const result = await listMessageNames({ ip: '127.0.0.1', port, slaveAddress: 0 })
      expect(result).toEqual(nombres)
    } finally {
      server.close()
    }
  })
})
