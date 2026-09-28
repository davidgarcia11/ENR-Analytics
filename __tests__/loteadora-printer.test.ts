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
import { buildRemoteFieldFrame, buildSendFileFrame, MAX_PIEZA_ARCHIVO, listMessageNames, getPrinterStatus, loadPrintMessage, LOAD_APPLY_DELAY_MS } from '@/lib/loteadora-printer'

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

  // Servidor que responde siempre con la misma trama.
  const conRespuesta = async (respuesta: number[], fn: (port: number) => Promise<void>) => {
    const server = net.createServer(socket => socket.once('data', () => socket.write(Buffer.from(respuesta))))
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    try { await fn((server.address() as net.AddressInfo).port) } finally { server.close() }
  }

  it('con la impresión parada (P_Status 12) acepta los nombres si vienen en la respuesta', async () => {
    const nombre = Buffer.from('new', 'ascii')
    await conRespuesta([0x1b, 0x06, 0x00, 0x12, 0x1f, 1, nombre.length, ...nombre, 0x1b, 0x03, 0x00], async port => {
      expect(await listMessageNames({ ip: '127.0.0.1', port, slaveAddress: 0 })).toEqual(['new'])
    })
  })

  it('con la impresión parada y sin nombres en la respuesta lanza el error', async () => {
    await conRespuesta([0x1b, 0x06, 0x00, 0x12, 0x1f, 0x1b, 0x03, 0x00], async port => {
      await expect(listMessageNames({ ip: '127.0.0.1', port, slaveAddress: 0 })).rejects.toThrow('impresión iniciada')
    })
  })
})

describe('buildSendFileFrame', () => {
  it('una sola pieza: longitud (2 bytes), OPERATION 03, nombre y archivo, sin ESC ETX ni checknum (§3.5.48)', () => {
    const archivo = Buffer.from([0x00, 0x05, 0x05, 0x0c, 0xaa])
    const frame = buildSendFileFrame(0, 'P3.msg', archivo)
    const datos = Buffer.from([0x03, 6, ...Buffer.from('P3.msg', 'ascii'), ...archivo])
    expect(frame.subarray(0, 4)).toEqual(Buffer.from([0x1b, 0x02, 0x00, 0x50]))
    expect(frame.subarray(4, 6)).toEqual(Buffer.from([0x00, datos.length]))
    expect(frame.subarray(6)).toEqual(datos)
  })

  it('rechaza un archivo de más de una pieza', () => {
    expect(() => buildSendFileFrame(0, 'P3.msg', Buffer.alloc(MAX_PIEZA_ARCHIVO + 1))).toThrow()
  })
})

describe('loadPrintMessage', () => {
  it('espera entre cargar (1E) y aplicar (01) y nunca abre dos conexiones a la vez', async () => {
    const recibidos: { cmd: number; t: number }[] = []
    let abiertas = 0
    let maxAbiertas = 0
    const server = net.createServer(socket => {
      abiertas++; maxAbiertas = Math.max(maxAbiertas, abiertas)
      socket.on('close', () => abiertas--)
      socket.once('data', d => {
        recibidos.push({ cmd: d[3], t: Date.now() })
        // Responde un poco después para que un comando simultáneo se solapase
        setTimeout(() => socket.end(Buffer.from([0x1b, 0x06, 0x00, 0x00, d[3], 0x1b, 0x03, 0x00])), 30)
      })
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const config = { ip: '127.0.0.1', port: (server.address() as net.AddressInfo).port, slaveAddress: 0 }

    try {
      const [carga] = await Promise.all([loadPrintMessage(config, 'Prueba2'), getPrinterStatus(config)])
      expect(carga.warning).toBeNull()
      const orden = recibidos.map(r => r.cmd)
      expect(orden.indexOf(0x1e)).toBeLessThan(orden.indexOf(0x01))
      const t1e = recibidos.find(r => r.cmd === 0x1e)!.t
      const t01 = recibidos.find(r => r.cmd === 0x01)!.t
      expect(t01 - t1e).toBeGreaterThanOrEqual(LOAD_APPLY_DELAY_MS - 50)
      expect(maxAbiertas).toBe(1)
    } finally {
      server.close()
    }
  })
})
