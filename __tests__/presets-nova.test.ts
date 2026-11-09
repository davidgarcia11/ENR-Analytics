/**
 * Tests de la lógica de presets de los paneles Nova — lib/presets-nova.ts.
 * Las fechas relativas se calculan contra un «hoy» fijo; los meses se construyen en hora local.
 */
import { describe, it, expect } from 'bun:test'
import { resolverFechas, crearContenido, leerPreset, aplicacionDe, modoDe, periodosPara, describirFechas, coincide } from '../lib/presets-nova'

const hoy = new Date(2026, 0, 15) // 15 ene 2026

describe('fechas relativas', () => {
  it('días: incluyen hoy y cruzan el cambio de año', () => {
    expect(resolverFechas({ tipo: 'relativas', periodo: 'ultimos_7' }, hoy)).toEqual({ startDate: '2026-01-09', endDate: '2026-01-15' })
    expect(resolverFechas({ tipo: 'relativas', periodo: 'ultimos_30' }, hoy)).toEqual({ startDate: '2025-12-17', endDate: '2026-01-15' })
  })
  it('meses completos, con el anterior en el año pasado', () => {
    expect(resolverFechas({ tipo: 'relativas', periodo: 'mes_actual' }, hoy)).toEqual({ startDate: '2026-01-01', endDate: '2026-01-31' })
    expect(resolverFechas({ tipo: 'relativas', periodo: 'mes_anterior' }, hoy)).toEqual({ startDate: '2025-12-01', endDate: '2025-12-31' })
    expect(resolverFechas({ tipo: 'relativas', periodo: 'ultimos_3_meses' }, hoy)).toEqual({ startDate: '2025-11-01', endDate: '2026-01-31' })
    expect(resolverFechas({ tipo: 'relativas', periodo: 'ultimos_12_meses' }, hoy)).toEqual({ startDate: '2025-02-01', endDate: '2026-01-31' })
  })
  it('último día de febrero, bisiesto o no', () => {
    expect(resolverFechas({ tipo: 'relativas', periodo: 'mes_actual' }, new Date(2026, 1, 10)).endDate).toBe('2026-02-28')
    expect(resolverFechas({ tipo: 'relativas', periodo: 'mes_actual' }, new Date(2028, 1, 10)).endDate).toBe('2028-02-29')
    expect(resolverFechas({ tipo: 'relativas', periodo: 'mes_anterior' }, new Date(2026, 2, 31))).toEqual({ startDate: '2026-02-01', endDate: '2026-02-28' })
  })
  it('años', () => {
    expect(resolverFechas({ tipo: 'relativas', periodo: 'anio_actual' }, hoy)).toEqual({ startDate: '2026-01-01', endDate: '2026-12-31' })
    expect(resolverFechas({ tipo: 'relativas', periodo: 'anio_anterior' }, hoy)).toEqual({ startDate: '2025-01-01', endDate: '2025-12-31' })
  })
  it('un panel por meses no ofrece periodos por días', () => {
    expect(periodosPara('mes')).not.toContain('ultimos_30')
    expect(periodosPara('dia')).toContain('ultimos_30')
    expect(periodosPara('mes')).toContain('mes_actual')
  })
})

describe('guardar y leer', () => {
  const rango = { startDate: '2026-01-01', endDate: '2026-03-31' }
  it('sin fechas, fijas y relativas', () => {
    expect(crearContenido({ sabor: 'X' }, 'sin', rango)).toEqual({ v: 2, filtros: { sabor: 'X' } })
    expect(crearContenido({}, 'fijas', rango).fechas).toEqual({ tipo: 'fijas', desde: '2026-01-01', hasta: '2026-03-31' })
    expect(crearContenido({}, 'mes_actual', rango).fechas).toEqual({ tipo: 'relativas', periodo: 'mes_actual' })
  })
  it('fijas sin rango actual (p. ej. «todas las fechas») se guarda sin fechas', () => {
    expect(crearContenido({}, 'fijas', null).fechas).toBeUndefined()
  })
  it('ida y vuelta: lo guardado se lee igual y se aplica', () => {
    const c = crearContenido({ clientes: [1, 2] }, 'ultimos_30', null)
    const leido = leerPreset<{ clientes: number[] }>(JSON.stringify(c))
    expect(leido).toEqual(c)
    expect(modoDe(leido)).toBe('ultimos_30')
    expect(aplicacionDe(leido, hoy)).toEqual({ filtros: { clientes: [1, 2] }, fechas: { startDate: '2025-12-17', endDate: '2026-01-15' } })
  })
  it('formato anterior (sin v): son los filtros, sin fechas', () => {
    expect(leerPreset('{"clientes":[110,105]}')).toEqual({ v: 2, filtros: { clientes: [110, 105] } })
  })
  it('JSON roto o fechas raras no rompen: se leen como vacío o sin fechas', () => {
    expect(leerPreset('no es json')).toEqual({ v: 2, filtros: {} })
    expect(leerPreset('null')).toEqual({ v: 2, filtros: {} })
    expect(leerPreset('{"v":2,"filtros":{"a":1},"fechas":{"tipo":"relativas","periodo":"nunca"}}')).toEqual({ v: 2, filtros: { a: 1 } })
    expect(leerPreset('{"v":2,"filtros":{},"fechas":{"tipo":"fijas","desde":"ayer","hasta":"hoy"}}')).toEqual({ v: 2, filtros: {} })
  })
  it('describe las fechas para la lista', () => {
    expect(describirFechas(undefined)).toBe('Sin fechas')
    expect(describirFechas({ tipo: 'fijas', desde: '2026-01-01', hasta: '2026-03-31' })).toBe('01/01/26 – 31/03/26')
    expect(describirFechas({ tipo: 'relativas', periodo: 'mes_actual' })).toBe('Mes en curso')
  })
})

describe('¿coincide lo actual con el filtro guardado? (para «modificado»)', () => {
  const rango30 = { startDate: '2025-12-17', endDate: '2026-01-15' }
  const c = crearContenido({ clientes: [1, 2] }, 'ultimos_30', null)
  it('mismos filtros y mismo periodo resuelto → coincide', () => {
    expect(coincide(c, { filtros: { clientes: [1, 2] }, fechas: rango30 }, hoy)).toBe(true)
  })
  it('el orden de una lista no importa', () => {
    expect(coincide(c, { filtros: { clientes: [2, 1] }, fechas: rango30 }, hoy)).toBe(true)
  })
  it('otro cliente u otras fechas → modificado', () => {
    expect(coincide(c, { filtros: { clientes: [1] }, fechas: rango30 }, hoy)).toBe(false)
    expect(coincide(c, { filtros: { clientes: [1, 2] }, fechas: { startDate: '2026-01-01', endDate: '2026-01-15' } }, hoy)).toBe(false)
    expect(coincide(c, { filtros: { clientes: [1, 2] }, fechas: null }, hoy)).toBe(false)
  })
  it('un filtro sin fechas no mira las fechas', () => {
    const sin = crearContenido({ sabor: 'X', tipo: 'PM' }, 'sin', null)
    expect(coincide(sin, { filtros: { sabor: 'X', tipo: 'PM' }, fechas: { startDate: '2020-01-01', endDate: '2020-12-31' } }, hoy)).toBe(true)
    expect(coincide(sin, { filtros: { sabor: 'Y', tipo: 'PM' }, fechas: null }, hoy)).toBe(false)
  })
  it('panel con un filtro nuevo que el guardado no tiene: vacío/null cuenta como «no lo tiene»', () => {
    const viejo = leerPreset<{ clientes: number[]; canal: string | null }>('{"clientes":[1]}')
    expect(coincide(viejo, { filtros: { clientes: [1], canal: null }, fechas: null }, hoy)).toBe(true)
    expect(coincide(viejo, { filtros: { clientes: [1], canal: 'HOR' }, fechas: null }, hoy)).toBe(false)
  })
})
