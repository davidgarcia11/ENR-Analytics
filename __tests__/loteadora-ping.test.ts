/**
 * Test de lib/loteadora-ping.ts — seguimiento de conexión de las loteadoras por ping.
 */
import { describe, it, expect } from 'bun:test'
import { Database } from 'bun:sqlite'
import { REPETIR_MS, debeRegistrar, historialCsv, leerPing, registrarPing } from '@/lib/loteadora-ping'

describe('leerPing', () => {
  it('lee el ping de Windows en español y en inglés, y el de Linux', () => {
    expect(leerPing('Respuesta desde 192.168.1.10: bytes=32 tiempo=2ms TTL=128')).toEqual({ ok: true, ms: 2 })
    expect(leerPing('Respuesta desde 127.0.0.1: bytes=32 tiempo<1m TTL=128')).toEqual({ ok: true, ms: 0 })
    expect(leerPing('Reply from 192.168.1.10: bytes=32 time=15ms TTL=64')).toEqual({ ok: true, ms: 15 })
    expect(leerPing('64 bytes from 192.168.1.10: icmp_seq=1 ttl=64 time=0.41 ms')).toEqual({ ok: true, ms: 0 })
  })

  it('sin TTL no hay respuesta (tiempo agotado, host inaccesible...)', () => {
    expect(leerPing('Tiempo de espera agotado para esta solicitud.')).toEqual({ ok: false, ms: null })
    expect(leerPing('Respuesta desde 192.168.1.1: Host de destino inaccesible.')).toEqual({ ok: false, ms: null })
  })
})

describe('debeRegistrar', () => {
  const t0 = 1_000_000
  it('guarda la primera vez y cada cambio', () => {
    expect(debeRegistrar(undefined, 'conexion', t0)).toBe(true)
    expect(debeRegistrar({ estado: 'conexion', at: t0 }, 'sin_conexion', t0 + 30_000)).toBe(true)
    expect(debeRegistrar({ estado: 'inicio', at: t0 }, 'conexion', t0 + 30_000)).toBe(true)
  })

  it('si no cambia, solo cada 30 minutos', () => {
    expect(debeRegistrar({ estado: 'conexion', at: t0 }, 'conexion', t0 + 30_000)).toBe(false)
    expect(debeRegistrar({ estado: 'conexion', at: t0 }, 'conexion', t0 + REPETIR_MS - 1)).toBe(false)
    expect(debeRegistrar({ estado: 'conexion', at: t0 }, 'conexion', t0 + REPETIR_MS)).toBe(true)
  })
})

describe('historialCsv', () => {
  it('una fila por registro, con ";" y BOM para Excel', () => {
    const db = new Database(':memory:') as any
    db.exec(`CREATE TABLE loteadora_ping (id INTEGER PRIMARY KEY AUTOINCREMENT, fecha TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      loteadora_id INTEGER NOT NULL, loteadora TEXT NOT NULL, ip TEXT NOT NULL, estado TEXT NOT NULL, ms INTEGER)`)
    const l = { id: 1, name: 'Línea 2', ip: '192.168.1.10' }
    registrarPing(db, l, 'inicio', null)
    registrarPing(db, l, 'conexion', 2)
    registrarPing(db, l, 'sin_conexion', null)
    registrarPing(db, { ...l, id: 2 }, 'conexion', 1)
    const csv: string = historialCsv(db, 1)
    expect(csv.startsWith('﻿Fecha;Estado;Respuesta (ms);IP\r\n')).toBe(true)
    const filas = csv.trim().split('\r\n').slice(1).map((f) => f.split(';').slice(1))
    expect(filas).toEqual([
      ['Seguimiento iniciado', '', '192.168.1.10'],
      ['Con conexión', '2', '192.168.1.10'],
      ['Sin conexión', '', '192.168.1.10'],
    ])
  })
})
