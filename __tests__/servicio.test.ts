/**
 * Tests del cálculo de nivel de servicio (OTIF) de /servicio — lib/servicio.ts.
 * Un pedido con dos albaranes, uno a tiempo y otro tarde, es el caso que justifica
 * medir por envío (albarán) y no solo por pedido.
 */
import { describe, it, expect } from 'bun:test'
import { agruparEnvios, tieneIncidencia, estadoEntrega, resumirPedidos, calcularKpis, resumenMensual, contarIncidencias, incidenciasPorMes, jdeAIso, isoAJde, limpiarNombreCatalogo, udsPorCaja, motivoEfectivo, responsableEfectivo, filtrarPorClientes, type LineaJde } from '../lib/servicio'
import { permisoDeRutaAdmin, seccionesAdminPorPermisos } from '../lib/permisos'

const linea = (o: Partial<LineaJde>): LineaJde => ({
  pedido: 1, suPedido: 'A', albaran: 100, cliente: 1, clienteNombre: 'C', destino: 1, destinoNombre: 'D',
  fechaEnvio: '2024-03-02', fechaPrometida: '2024-03-04', udsPedidas: 100, udsEnviadas: 100, cajasPedidas: 10, cajasEnviadas: 10, udsCanceladas: 0, canal: 'HOR', ...o,
})

describe('fechas JDE', () => {
  it('convierte CYYDDD <-> ISO', () => {
    expect(jdeAIso(124061)).toBe('2024-03-01')
    expect(jdeAIso(0)).toBeNull()
    expect(isoAJde('2024-03-01')).toBe(124061)
    expect(isoAJde(jdeAIso(125365)!)).toBe(125365)
  })
})

describe('agruparEnvios', () => {
  it('une las líneas SSCC del mismo albarán y separa albaranes', () => {
    const e = agruparEnvios([linea({ udsEnviadas: 40 }), linea({ udsEnviadas: 60 }), linea({ albaran: 101, udsPedidas: 50, udsEnviadas: 50 })])
    expect(e.length).toBe(2)
    const a100 = e.find((x) => x.albaran === 100)!
    expect(a100.udsEnviadas).toBe(100)
    expect(a100.udsPedidas).toBe(200)
  })
  it('toma el canal mayoritario del pedido', () => {
    const e = agruparEnvios([linea({ canal: 'HOR', udsPedidas: 10 }), linea({ albaran: 101, canal: 'EXP', udsPedidas: 90 })])
    expect(e.every((x) => x.canal === 'EXP')).toBe(true)
  })
})

describe('estadoEntrega', () => {
  const e = { fechaEnvio: '2024-03-02', fechaPrometida: '2024-03-04' }
  it('compara entrega real con la prometida', () => {
    expect(estadoEntrega(e, '2024-03-04')).toBe('a_tiempo')
    expect(estadoEntrega(e, '2024-03-03')).toBe('a_tiempo')
    expect(estadoEntrega(e, '2024-03-05')).toBe('tarde')
  })
  it('sin real queda sin confirmar; sin enviar, pendiente', () => {
    expect(estadoEntrega(e, null)).toBe('sin_confirmar')
    expect(estadoEntrega({ ...e, fechaEnvio: null }, null)).toBe('pendiente_envio')
  })
})

describe('KPIs', () => {
  const envio = (pedido: number, entrega: any, enviadas = 100, pedidas = 100, prom = '2024-03-04') => ({ pedido, udsPedidas: pedidas, udsEnviadas: enviadas, fechaPrometida: prom, entrega })
  it('un camión tarde hace tarde al pedido; OTIF solo sobre confirmados', () => {
    const p = resumirPedidos([envio(1, 'a_tiempo', 50, 50), envio(1, 'tarde', 50, 50), envio(2, 'a_tiempo'), envio(3, 'a_tiempo', 80), envio(4, 'sin_confirmar')])
    expect(p.find((x) => x.pedido === 1)!.entrega).toBe('tarde')
    const k = calcularKpis(p, '2024-04-01')
    expect(k.pedidos).toBe(4)
    expect(k.confirmados).toBe(3)
    expect(k.sinConfirmar).toBe(1)
    expect(k.pctATiempo).toBeCloseTo(66.67, 1) // pedidos 2 y 3 a tiempo, 1 tarde
    expect(k.pctCompleto).toBe(75) // el 3 está incompleto
    expect(k.pctOtif).toBeCloseTo(33.33, 1) // solo el 2 es a tiempo y completo
  })
  it('un pedido incompleto con fecha prometida futura no se evalúa', () => {
    const k = calcularKpis(resumirPedidos([envio(1, 'pendiente_envio', 0, 100, '2024-05-01')]), '2024-04-01')
    expect(k.pedidos).toBe(0)
    expect(k.abiertos).toBe(1)
    expect(k.pctOtif).toBeNull()
  })
})

describe('indicadores', () => {
  const e = (pedido: number, canal: string, mes: string, o: any = {}) => ({ pedido, canal, udsPedidas: 100, udsEnviadas: 100, udsAfectadas: 0, fechaPrometida: `${mes}-10`, entrega: 'a_tiempo', motivo: '', responsable: '', ...o })
  it('resume por mes y canal, con OTIF en unidades', () => {
    const f = resumenMensual([e(1, 'HOR', '2024-03'), e(2, 'HOR', '2024-03', { udsEnviadas: 90, udsAfectadas: 5 }), e(3, 'EXP', '2024-04')], '2024-06-01')
    expect(f.map((x) => `${x.mes}/${x.canal}`)).toEqual(['2024-03/HOR', '2024-04/EXP'])
    const hor = f[0].kpis
    expect(hor.pedidos).toBe(2)
    expect(hor.udsIncidencia).toBe(15) // 10 no enviadas + 5 afectadas
    expect(hor.pctOtifUds).toBeCloseTo(92.5, 1)
  })
  it('cuenta incidencias por motivo/responsable y por mes', () => {
    const d = [e(1, 'HOR', '2024-03', { motivo: 'Preparación', responsable: 'Elaborados' }), e(2, 'HOR', '2024-03', { motivo: 'Preparación' }), e(3, 'HOR', '2024-04', { motivo: 'Transporte', responsable: 'Transportista' }), e(4, 'HOR', '2024-04')]
    expect(contarIncidencias(d, 'motivo')).toEqual({ Preparación: 2, Transporte: 1 })
    expect(contarIncidencias(d, 'responsable')).toEqual({ Elaborados: 1, 'Sin indicar': 1, Transportista: 1 })
    expect(incidenciasPorMes(d)).toEqual([{ mes: '2024-03', Preparación: 2 }, { mes: '2024-04', Transporte: 1 }])
  })
})

describe('tieneIncidencia', () => {
  it('basta con motivo, texto o unidades afectadas', () => {
    expect(tieneIncidencia({ motivo: '', incidencia: '', udsAfectadas: 0 })).toBe(false)
    expect(tieneIncidencia({ motivo: 'Transporte', incidencia: '', udsAfectadas: 0 })).toBe(true)
    expect(tieneIncidencia({ motivo: '', incidencia: 'x', udsAfectadas: 0 })).toBe(true)
    expect(tieneIncidencia({ motivo: '', incidencia: '', udsAfectadas: 3 })).toBe(true)
  })
})

describe('catálogo de listas de servicio', () => {
  it('limpia y valida el nombre de una opción', () => {
    expect(limpiarNombreCatalogo('  Cajas   rotas ')).toBe('Cajas rotas')
    expect(limpiarNombreCatalogo('')).toBeNull()
    expect(limpiarNombreCatalogo('   ')).toBeNull()
    expect(limpiarNombreCatalogo('a'.repeat(41))).toBeNull()
    expect(limpiarNombreCatalogo(5)).toBeNull()
    expect(limpiarNombreCatalogo('Mal\x00estado')).toBe('Malestado')
  })
  it('la API y la sección de admin se abren con el permiso suelto', () => {
    expect(permisoDeRutaAdmin('/api/admin/servicio-catalogos', 'POST')).toBe('admin.servicio.catalogos')
    expect(permisoDeRutaAdmin('/api/admin/servicio-catalogos', 'DELETE')).toBe('admin.servicio.catalogos')
    expect(seccionesAdminPorPermisos(['admin.servicio.catalogos'])).toEqual(['servicio-catalogos'])
  })
})

describe('cajas', () => {
  it('suman por albarán y por pedido', () => {
    const e = agruparEnvios([linea({ udsEnviadas: 40, cajasEnviadas: 4 }), linea({ udsEnviadas: 60, cajasEnviadas: 6 }), linea({ albaran: 101, cajasPedidas: 5, cajasEnviadas: 2.5 })])
    expect(e.find((x) => x.albaran === 100)!.cajasPedidas).toBe(20)
    expect(e.find((x) => x.albaran === 100)!.cajasEnviadas).toBe(10)
    const p = resumirPedidos(e.map((x) => ({ ...x, entrega: 'a_tiempo' as const })))[0]
    expect(p.cajasPedidas).toBe(25)
    expect(p.cajasEnviadas).toBe(12.5)
  })
})

describe('udsPorCaja (F41002)', () => {
  it('usa la conversión CJ→UN, o la inversa UN→CJ', () => {
    expect(udsPorCaja([{ de: 'CJ', a: 'UN', factor: 12 }])).toBe(12)
    expect(udsPorCaja([{ de: 'UN', a: 'CJ', factor: 0.25 }])).toBe(4)
    expect(udsPorCaja([{ de: 'KG', a: 'CJ', factor: 0.5 }])).toBeNull()
    expect(udsPorCaja([])).toBeNull()
    expect(udsPorCaja([{ de: 'CJ', a: 'UN', factor: 0 }])).toBeNull()
  })
})

describe('cancelaciones del cliente, cajas y cobertura', () => {
  it('una cancelación es incidencia y su responsable es el cliente, salvo lo anotado a mano', () => {
    const base = { motivo: '', responsable: '', incidencia: '', udsAfectadas: 0 }
    expect(tieneIncidencia({ ...base, udsCanceladas: 10 })).toBe(true)
    expect(tieneIncidencia({ ...base, udsCanceladas: 0 })).toBe(false)
    expect(motivoEfectivo({ motivo: '', udsCanceladas: 10 })).toBe('Cancelación del cliente')
    expect(responsableEfectivo({ responsable: '', udsCanceladas: 10 })).toBe('Cliente')
    expect(motivoEfectivo({ motivo: 'Producción', udsCanceladas: 10 })).toBe('Producción')
    expect(responsableEfectivo({ responsable: 'Elaborados', udsCanceladas: 10 })).toBe('Elaborados')
    const d = [{ pedido: 1, canal: 'HOR', udsPedidas: 100, udsEnviadas: 90, udsAfectadas: 0, udsCanceladas: 10, fechaPrometida: '2024-03-10', entrega: 'a_tiempo' as const, motivo: '', responsable: '' }]
    expect(contarIncidencias(d, 'motivo')).toEqual({ 'Cancelación del cliente': 1 })
    expect(contarIncidencias(d, 'responsable')).toEqual({ Cliente: 1 })
  })
  it('OTIF por cajas y cobertura', () => {
    const e = (pedido: number, entrega: any, o: any = {}) => ({ pedido, udsPedidas: 120, udsEnviadas: 120, cajasPedidas: 10, cajasEnviadas: 10, udsAfectadas: 0, fechaPrometida: '2024-03-04', entrega, ...o })
    const k = calcularKpis(resumirPedidos([e(1, 'a_tiempo'), e(2, 'sin_confirmar'), e(3, 'a_tiempo', { cajasEnviadas: 8, udsEnviadas: 96 }), e(4, 'sin_confirmar')]), '2024-04-01')
    expect(k.cobertura).toBe(50) // 2 de 4 evaluados con entrega confirmada
    expect(k.cajasIncidencia).toBe(2) // faltan 2 cajas del pedido 3
    expect(k.pctOtifCajas).toBeCloseTo(95, 5) // 1 − 2/40
  })
})

describe('afectadas en unidades o en cajas', () => {
  const e = (o: any = {}) => ({ pedido: 1, udsPedidas: 120, udsEnviadas: 120, cajasPedidas: 10, cajasEnviadas: 10, udsAfectadas: 0, fechaPrometida: '2024-03-04', entrega: 'a_tiempo' as const, ...o })
  it('usa las cajas anotadas y, si no hay, las deriva de las unidades', () => {
    expect(resumirPedidos([e({ udsAfectadas: 24 })])[0].cajasAfectadas).toBeCloseTo(2, 5) // 24 uds × 10/120
    expect(resumirPedidos([e({ udsAfectadas: 24, cajasAfectadas: 3 })])[0].cajasAfectadas).toBe(3) // lo anotado manda
  })
  it('cajas afectadas cuentan como incidencia', () => {
    expect(tieneIncidencia({ motivo: '', incidencia: '', udsAfectadas: 0, cajasAfectadas: 1.5 })).toBe(true)
  })
})

describe('filtro de clientes', () => {
  const envios = [{ pedido: 1, cliente: 10 }, { pedido: 2, cliente: 20 }, { pedido: 3, cliente: 10 }, { pedido: 4, cliente: 30 }]
  it('sin clientes elegidos devuelve todos (y la misma lista, sin copiarla)', () => {
    expect(filtrarPorClientes(envios, [])).toBe(envios)
  })
  it('deja solo los de los clientes elegidos', () => {
    expect(filtrarPorClientes(envios, [10, 30]).map((e) => e.pedido)).toEqual([1, 3, 4])
  })
  it('«todos menos»: con excluir, quita solo los de la lista', () => {
    expect(filtrarPorClientes(envios, [10], true).map((e) => e.pedido)).toEqual([2, 4])
    expect(filtrarPorClientes(envios, [], true)).toBe(envios) // todos marcados = sin filtro
    expect(filtrarPorClientes(envios, [999], true)).toEqual(envios) // excluir uno que no está no quita nada
  })
  it('un cliente que no aparece en los datos (preset antiguo) no rompe nada: deja la lista vacía', () => {
    expect(filtrarPorClientes(envios, [999])).toEqual([])
  })
})
