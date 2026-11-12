/**
 * Tests del cálculo de nivel de servicio (OTIF) de /servicio — lib/servicio.ts.
 * Un pedido con dos albaranes, uno a tiempo y otro tarde, es el caso que justifica
 * medir por envío (albarán) y no solo por pedido.
 */
import { describe, it, expect } from 'bun:test'
import { agruparEnvios, tieneIncidencia, estadoEntrega, resumirPedidos, calcularKpis, resumenMensual, contarIncidencias, incidenciasPorMes, jdeAIso, isoAJde, limpiarNombreCatalogo, udsPorCaja, udsPorCajaDeLineas, cantidadesLinea, esRestoDeReparto, sinFechaReal, filtrarPorClientes, filtrarPorTipos, TIPOS_PEDIDO, generarEjemplo, validarAfectadasArticulos, totalAfectadas, armarRespuesta, detectarDuplicados, pedidosCanceladosEnteros, type LineaJde } from '../lib/servicio'
import { permisoDeRutaAdmin, seccionesAdminPorPermisos } from '../lib/permisos'

const linea = (o: Partial<LineaJde>): LineaJde => ({
  pedido: 1, tipoPedido: 'SO', suPedido: 'A', albaran: 100, cliente: 1, clienteNombre: 'C', destino: 1, destinoNombre: 'D',
  fechaEnvio: '2024-03-02', fechaPrometida: '2024-03-04', udsPedidas: 100, udsEnviadas: 100, cajasPedidas: 10, cajasEnviadas: 10, udsCanceladas: 0, canal: 'HOR',
  articulo: '1000000001', descripcion: 'Artículo A', udsPorCaja: 10, ...o,
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
  it('las líneas sin albarán (pendientes o canceladas) se suman al último envío del pedido y no salen aparte', () => {
    // Línea partida en JDE: 800 pedidas, 715 enviadas en el albarán 100 y el resto (85) sin albarán y cancelado
    const e = agruparEnvios([
      linea({ udsPedidas: 520, udsEnviadas: 520, cajasPedidas: 104, cajasEnviadas: 104 }),
      linea({ udsPedidas: 195, udsEnviadas: 195, cajasPedidas: 39, cajasEnviadas: 39 }),
      linea({ albaran: 0, fechaEnvio: null, fechaPrometida: '2024-03-01', udsPedidas: 85, udsEnviadas: 0, udsCanceladas: 85, cajasPedidas: 17, cajasEnviadas: 0 }),
    ])
    expect(e.length).toBe(1)
    expect(e[0].albaran).toBe(100)
    expect(e[0].udsPedidas).toBe(800)
    expect(e[0].udsEnviadas).toBe(715)
    expect(e[0].cajasPedidas).toBe(160)
    expect(e[0].udsCanceladas).toBe(85)
    expect(e[0].fechaPrometida).toBe('2024-03-04') // las fechas son las del envío real
    expect(e[0].fechaEnvio).toBe('2024-03-02')
  })
  it('con varios albaranes, lo no enviado va al último enviado', () => {
    const e = agruparEnvios([
      linea({ albaran: 100, fechaEnvio: '2024-03-02' }),
      linea({ albaran: 101, fechaEnvio: '2024-03-03' }),
      linea({ albaran: 0, fechaEnvio: null, udsEnviadas: 0, udsPedidas: 30 }),
    ])
    expect(e.map((x) => x.albaran).sort()).toEqual([100, 101])
    expect(e.find((x) => x.albaran === 101)!.udsPedidas).toBe(130)
    expect(e.find((x) => x.albaran === 100)!.udsPedidas).toBe(100)
  })
  it('un pedido sin ningún albarán sigue saliendo como «Sin enviar»', () => {
    const e = agruparEnvios([linea({ albaran: 0, fechaEnvio: null, udsEnviadas: 0 }), linea({ pedido: 2 })])
    expect(e.map((x) => `${x.pedido}|${x.albaran}`).sort()).toEqual(['1|0', '2|100'])
  })
})

describe('estadoEntrega', () => {
  const e = { fechaEnvio: '2024-03-02', fechaPrometida: '2024-03-04' }
  it('compara entrega real con la prometida', () => {
    expect(estadoEntrega(e, '2024-03-04')).toBe('a_tiempo')
    expect(estadoEntrega(e, '2024-03-03')).toBe('a_tiempo')
    expect(estadoEntrega(e, '2024-03-05')).toBe('tarde')
  })
  it('enviado sin fecha real se da por entregado en la prometida (a tiempo); sin enviar, pendiente', () => {
    expect(estadoEntrega(e, null)).toBe('a_tiempo')
    expect(estadoEntrega({ ...e, fechaEnvio: null }, null)).toBe('pendiente_envio')
  })
  it('sinFechaReal: solo los enviados sin fecha real anotada', () => {
    expect(sinFechaReal({ fechaEnvio: '2024-03-02', fechaEntregaReal: null })).toBe(true)
    expect(sinFechaReal({ fechaEnvio: '2024-03-02', fechaEntregaReal: '2024-03-04' })).toBe(false)
    expect(sinFechaReal({ fechaEnvio: null, fechaEntregaReal: null })).toBe(false)
  })
})

describe('KPIs', () => {
  const envio = (pedido: number, entrega: any, enviadas = 100, pedidas = 100, prom = '2024-03-04') => ({ pedido, udsPedidas: pedidas, udsEnviadas: enviadas, fechaPrometida: prom, entrega })
  it('un camión tarde hace tarde al pedido; a tiempo y OTIF sobre todos los evaluados', () => {
    const p = resumirPedidos([envio(1, 'a_tiempo', 50, 50), envio(1, 'tarde', 50, 50), envio(2, 'a_tiempo'), envio(3, 'a_tiempo', 80), envio(4, 'pendiente_envio', 0)])
    expect(p.find((x) => x.pedido === 1)!.entrega).toBe('tarde')
    const k = calcularKpis(p, '2024-04-01')
    expect(k.pedidos).toBe(4)
    expect(k.aTiempo).toBe(2) // 2 y 3; el 4 está vencido sin enviar
    expect(k.pctATiempo).toBe(50)
    expect(k.pctCompleto).toBe(50) // el 3 y el 4 están incompletos
    expect(k.pctOtif).toBe(25) // solo el 2 es a tiempo y completo
  })
  it('cuenta los pedidos con algún envío sin fecha real anotada', () => {
    const e = (pedido: number, real: string | null) => ({ ...envio(pedido, 'a_tiempo'), fechaEnvio: '2024-03-02', fechaEntregaReal: real })
    const k = calcularKpis(resumirPedidos([e(1, '2024-03-04'), e(2, null), e(2, '2024-03-04'), e(3, '2024-03-03')]), '2024-04-01')
    expect(k.sinFechaReal).toBe(1)
    expect(k.pctConFechaReal).toBeCloseTo(66.67, 1)
    expect(k.pctATiempo).toBe(100) // sin fecha real cuenta como a tiempo
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
    expect(hor.udsIncidencia).toBe(5) // solo las 5 afectadas anotadas
    expect(hor.udsNoServidas).toBe(10) // las 10 no enviadas, en su propia columna
    expect(hor.pctOtifUds).toBeCloseTo(95, 1) // 1 − máx(10, 5) / 200
    expect(hor.pctCompleto).toBe(50) // pero el pedido 2 no está completo
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

describe('udsPorCaja (F41002, con las UM de la línea)', () => {
  it('usa la conversión de la UM secundaria (caja) a la principal, o la inversa, sea cual sea el código', () => {
    expect(udsPorCaja([{ de: 'BX', a: 'UN', factor: 6 }], 'BX', 'UN')).toBe(6)
    expect(udsPorCaja([{ de: 'CJ', a: 'UN', factor: 12 }], 'CJ', 'UN')).toBe(12)
    expect(udsPorCaja([{ de: 'UN', a: 'BX', factor: 0.25 }], 'BX', 'UN')).toBe(4)
    expect(udsPorCaja([{ de: 'CJ', a: 'UN', factor: 12 }], 'BX', 'UN')).toBeNull() // otra caja: no vale
    expect(udsPorCaja([{ de: 'BX', a: 'PL', factor: 80 }, { de: 'BX', a: 'UN', factor: 6 }], 'BX', 'UN')).toBe(6)
    expect(udsPorCaja([], 'BX', 'UN')).toBeNull()
    expect(udsPorCaja([{ de: 'BX', a: 'UN', factor: 0 }], 'BX', 'UN')).toBeNull()
    expect(udsPorCaja([{ de: 'BX', a: 'UN', factor: 6 }], '', 'UN')).toBeNull() // línea sin UM secundaria
    expect(udsPorCaja([{ de: 'UN', a: 'UN', factor: 1 }], 'UN', 'UN')).toBeNull()
  })
})

describe('cajas y enviadas de una línea', () => {
  it('sin conversión, las uds por caja salen de las líneas del artículo que traen cajas', () => {
    const r = udsPorCajaDeLineas([
      { articulo: 'A', udsPedidas: 600, cajasSecundarias: 100 },
      { articulo: 'A', udsPedidas: 120, cajasSecundarias: 0 }, // cancelada: JDE la deja sin cajas
      { articulo: 'B', udsPedidas: 50, cajasSecundarias: 0 },
    ])
    expect(r.get('A')).toBe(6)
    expect(r.has('B')).toBe(false)
  })
  it('solo cuenta como enviado lo que tiene fecha de envío (en picking aún no ha salido)', () => {
    expect(cantidadesLinea({ udsPedidas: 60, udsServidas: 60, fechaEnvio: '2024-03-02', udsPorCaja: 6 })).toEqual({ udsEnviadas: 60, cajasPedidas: 10, cajasEnviadas: 10 })
    expect(cantidadesLinea({ udsPedidas: 42, udsServidas: 42, fechaEnvio: null, udsPorCaja: 6 })).toEqual({ udsEnviadas: 0, cajasPedidas: 7, cajasEnviadas: 0 })
    expect(cantidadesLinea({ udsPedidas: 120, udsServidas: 0, fechaEnvio: null, udsPorCaja: 6 })).toEqual({ udsEnviadas: 0, cajasPedidas: 20, cajasEnviadas: 0 })
    expect(cantidadesLinea({ udsPedidas: 10, udsServidas: 10, fechaEnvio: '2024-03-02', udsPorCaja: null })).toEqual({ udsEnviadas: 10, cajasPedidas: 0, cajasEnviadas: 0 })
  })
  it('un pedido con canceladas y una línea en picking: faltan unidades y también cajas', () => {
    // Ficticio: 600 enviadas, 120 canceladas sin cajas y 42 en picking sin albarán, todo de 6 uds/caja
    const respaldo = udsPorCajaDeLineas([{ articulo: 'A', udsPedidas: 600, cajasSecundarias: 100 }, { articulo: 'A', udsPedidas: 120, cajasSecundarias: 0 }, { articulo: 'A', udsPedidas: 42, cajasSecundarias: 7 }])
    const f = respaldo.get('A')!
    const enviada = cantidadesLinea({ udsPedidas: 600, udsServidas: 600, fechaEnvio: '2024-03-02', udsPorCaja: f })
    const cancelada = cantidadesLinea({ udsPedidas: 120, udsServidas: 0, fechaEnvio: null, udsPorCaja: f })
    const picking = cantidadesLinea({ udsPedidas: 42, udsServidas: 42, fechaEnvio: null, udsPorCaja: f })
    const e = agruparEnvios([
      linea({ udsPedidas: 600, ...enviada }),
      linea({ albaran: 0, fechaEnvio: null, udsPedidas: 120, ...cancelada }),
      linea({ albaran: 0, fechaEnvio: null, udsPedidas: 42, ...picking }),
    ])
    expect(e.length).toBe(1)
    expect(e[0].udsEnviadas).toBe(600)
    expect(e[0].udsPedidas).toBe(762)
    expect(e[0].cajasEnviadas).toBe(100)
    expect(e[0].cajasPedidas).toBe(127)
  })
})

describe('cancelaciones y cajas', () => {
  it('una cancelación no es incidencia sola: deja el pedido incompleto pero no suma uds con incidencia', () => {
    const d = [{ pedido: 1, canal: 'HOR', udsPedidas: 100, udsEnviadas: 90, udsAfectadas: 0, fechaPrometida: '2024-03-10', entrega: 'a_tiempo' as const, motivo: '', responsable: '' }]
    expect(tieneIncidencia({ motivo: '', incidencia: '', udsAfectadas: 0 })).toBe(false)
    expect(contarIncidencias(d, 'motivo')).toEqual({})
    const k = resumenMensual(d, '2024-06-01')[0].kpis
    expect(k.udsIncidencia).toBe(0) // solo cuenta lo anotado a mano
    expect(k.udsNoServidas).toBe(10)
    expect(k.pctOtifUds).toBeCloseTo(90, 5) // pero lo no servido sí resta del OTIF en unidades
    expect(k.pctCompleto).toBe(0)
  })
  it('OTIF por cajas: solo las cajas afectadas anotadas, una sola vez aunque coincidan con lo no enviado', () => {
    const e = (pedido: number, entrega: any, o: any = {}) => ({ pedido, udsPedidas: 120, udsEnviadas: 120, cajasPedidas: 10, cajasEnviadas: 10, udsAfectadas: 0, fechaPrometida: '2024-03-04', entrega, ...o })
    // Pedido 3: faltan 2 cajas (24 uds) y se anotan esas mismas 24 uds / 2 cajas como incidencia
    const k = calcularKpis(resumirPedidos([e(1, 'a_tiempo'), e(2, 'a_tiempo'), e(3, 'a_tiempo', { cajasEnviadas: 8, udsEnviadas: 96, udsAfectadas: 24, cajasAfectadas: 2 }), e(4, 'a_tiempo')]), '2024-04-01')
    expect(k.cajasIncidencia).toBe(2)
    expect(k.udsIncidencia).toBe(24)
    expect(k.pctOtifCajas).toBeCloseTo(95, 5) // 1 − máx(2, 2)/40
    expect(k.cajasNoServidas).toBe(2)
    expect(k.pctOtifUds).toBeCloseTo(95, 5) // 1 − máx(24, 24)/480: no se cuentan dos veces
    expect(k.pctCompleto).toBe(75)
  })
  it('OTIF en unidades: lo anotado de un pedido enviado entero (cajas rotas) también resta', () => {
    const e = (pedido: number, o: any = {}) => ({ pedido, udsPedidas: 120, udsEnviadas: 120, cajasPedidas: 10, cajasEnviadas: 10, udsAfectadas: 0, fechaPrometida: '2024-03-04', entrega: 'a_tiempo' as const, ...o })
    const k = calcularKpis(resumirPedidos([e(1, { udsAfectadas: 12, cajasAfectadas: 1 }), e(2, { udsEnviadas: 60, cajasEnviadas: 5, udsAfectadas: 12, cajasAfectadas: 1 })]), '2024-04-01')
    expect(k.udsNoServidas).toBe(60)
    expect(k.udsIncidencia).toBe(24)
    expect(k.pctOtifUds).toBeCloseTo(100 - ((12 + 60) / 240) * 100, 5) // pedido 1: 12 rotas; pedido 2: máx(60, 12)
    expect(k.pctOtifCajas).toBeCloseTo(100 - ((1 + 5) / 20) * 100, 5)
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

describe('tipos de pedido', () => {
  const envios = [{ pedido: 1, tipoPedido: 'SO' }, { pedido: 2, tipoPedido: 'SE' }, { pedido: 3, tipoPedido: 'SM' }, { pedido: 4, tipoPedido: 'SY' }]
  it('cuentan venta, EDI y muestras; no envíos entre almacenes, cargos ni abonos', () => {
    expect(Object.keys(TIPOS_PEDIDO).sort()).toEqual(['SE', 'SM', 'SO', 'SY'])
  })
  it('filtra como el de clientes: vacío = todos, elegidos o «todos menos»', () => {
    expect(filtrarPorTipos(envios, [])).toBe(envios)
    expect(filtrarPorTipos(envios, ['SO', 'SE']).map((e) => e.pedido)).toEqual([1, 2])
    expect(filtrarPorTipos(envios, ['SM', 'SY'], true).map((e) => e.pedido)).toEqual([1, 2])
  })
  it('los datos de ejemplo solo usan tipos válidos', () => {
    const { lineas } = generarEjemplo()
    expect(lineas.every((l) => l.tipoPedido in TIPOS_PEDIDO)).toBe(true)
  })
})

describe('afectadas por artículo', () => {
  it('cada envío lleva sus artículos sumados, también los de las líneas sin albarán', () => {
    const e = agruparEnvios([
      linea({ articulo: '1000000001', udsPedidas: 520, udsEnviadas: 520 }),
      linea({ articulo: '1000000001', udsPedidas: 195, udsEnviadas: 195 }),
      linea({ articulo: '1000000002', descripcion: 'Artículo B', udsPorCaja: 12, udsPedidas: 480, udsEnviadas: 480 }),
      linea({ albaran: 0, fechaEnvio: null, articulo: '1000000001', udsPedidas: 85, udsEnviadas: 0 }),
    ])
    expect(e.length).toBe(1)
    expect(e[0].articulos).toEqual([
      { articulo: '1000000001', descripcion: 'Artículo A', udsPedidas: 800, udsEnviadas: 715, udsPorCaja: 10 },
      { articulo: '1000000002', descripcion: 'Artículo B', udsPedidas: 480, udsEnviadas: 480, udsPorCaja: 12 },
    ])
  })
  it('valida el desglose: quita las filas a cero, redondea las cajas y rechaza lo inválido', () => {
    expect(validarAfectadasArticulos([{ articulo: '1000000001', uds: 21, cajas: 4.2 }, { articulo: '1000000002', uds: 0, cajas: 0 }]))
      .toEqual([{ articulo: '1000000001', uds: 21, cajas: 4.2 }])
    expect(validarAfectadasArticulos([{ articulo: '1000000001', uds: 7, cajas: 7 / 3 }])).toEqual([{ articulo: '1000000001', uds: 7, cajas: 2.33 }])
    expect(validarAfectadasArticulos([])).toEqual([])
    expect(validarAfectadasArticulos('x')).toBeNull()
    expect(validarAfectadasArticulos([{ articulo: '1000000001', uds: 1.5, cajas: 0 }])).toBeNull() // uds enteras
    expect(validarAfectadasArticulos([{ articulo: '1000000001', uds: -1, cajas: 0 }])).toBeNull()
    expect(validarAfectadasArticulos([{ articulo: "1'; DROP", uds: 1, cajas: 0 }])).toBeNull()
    expect(validarAfectadasArticulos([{ articulo: '1000000001', uds: 1 }, { articulo: '1000000001', uds: 2 }])).toBeNull() // repetido
    expect(validarAfectadasArticulos(Array.from({ length: 201 }, (_, i) => ({ articulo: String(i), uds: 1 })))).toBeNull()
  })
  it('el total del envío es la suma del desglose, con cajas de cada artículo', () => {
    expect(totalAfectadas([{ articulo: 'A', uds: 21, cajas: 4.2 }, { articulo: 'B', uds: 21, cajas: 1.75 }])).toEqual({ uds: 42, cajas: 5.95 })
    expect(totalAfectadas([])).toEqual({ uds: 0, cajas: 0 })
  })
  it('la respuesta lleva el desglose anotado de cada envío (vacío si no lo hay)', () => {
    const tracking = new Map([['1|100', { transportista: '', fecha_entrega_real: null, responsable: '', motivo: 'Producción', incidencia: '', uds_afectadas: 21, cajas_afectadas: 2.1, articulos: [{ articulo: '1000000001', uds: 21, cajas: 2.1 }] }]])
    const r = armarRespuesta([linea({}), linea({ pedido: 2, albaran: 200 })], tracking, {}, '2024-06-01')
    expect(r.envios.find((e) => e.pedido === 1)!.afectadasArticulos).toEqual([{ articulo: '1000000001', uds: 21, cajas: 2.1 }])
    expect(r.envios.find((e) => e.pedido === 2)!.afectadasArticulos).toEqual([])
  })
  it('los datos de ejemplo traen artículos y su desglose cuadra con el total', () => {
    const { lineas, tracking } = generarEjemplo()
    expect(lineas.every((l) => l.articulo && l.udsPorCaja)).toBe(true)
    for (const t of tracking.values()) expect(t.uds_afectadas).toBe(totalAfectadas(t.articulos ?? []).uds)
  })
})

describe('PATCH /api/servicio con desglose por artículo', async () => {
  const { mock, beforeEach } = await import('bun:test')
  const { Database } = await import('bun:sqlite')
  const { NextRequest } = await import('next/server')
  const crear = () => {
    const db = new Database(':memory:')
    db.exec(`
      CREATE TABLE order_service_tracking (pedido INTEGER NOT NULL, albaran INTEGER NOT NULL DEFAULT 0, transportista TEXT NOT NULL DEFAULT '',
        fecha_entrega_real TEXT, responsable TEXT NOT NULL DEFAULT '', motivo TEXT NOT NULL DEFAULT '', incidencia TEXT NOT NULL DEFAULT '',
        uds_afectadas INTEGER NOT NULL DEFAULT 0, cajas_afectadas REAL NOT NULL DEFAULT 0, updated_by TEXT, updated_at TEXT, PRIMARY KEY (pedido, albaran));
      CREATE TABLE order_service_incidencia_articulo (pedido INTEGER NOT NULL, albaran INTEGER NOT NULL, articulo TEXT NOT NULL,
        uds INTEGER NOT NULL DEFAULT 0, cajas REAL NOT NULL DEFAULT 0, PRIMARY KEY (pedido, albaran, articulo));
    `)
    return db
  }
  const ctx = { db: crear() }
  mock.module('@/lib/sqlite', () => ({ getDb: () => ctx.db }))
  mock.module('@/lib/permissions', () => ({ requireScreenAccess: async () => null }))
  mock.module('@/lib/auth', () => ({ verifySession: async () => ({ id: 1, username: 'ana' }) }))
  mock.module('@/lib/db', () => ({ getDbConnection: async () => { throw new Error('sin Oracle en tests') } }))
  mock.module('@/lib/servicio-catalogo', () => ({ valorPermitido: () => true }))
  const { PATCH } = await import('@/app/api/servicio/route')
  const patch = (body: unknown) => PATCH(new NextRequest('http://localhost/api/servicio', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))
  const fila = () => ctx.db.prepare('SELECT uds_afectadas, cajas_afectadas, motivo FROM order_service_tracking WHERE pedido = 1 AND albaran = 100').get() as any
  const desglose = () => ctx.db.prepare('SELECT articulo, uds, cajas FROM order_service_incidencia_articulo ORDER BY articulo').all()
  beforeEach(() => { ctx.db = crear() })

  it('guarda el desglose y el total del envío es su suma', async () => {
    const r = await patch({ pedido: 1, albaran: 100, motivo: 'Producción', afectadasArticulos: [{ articulo: '1000000001', uds: 21, cajas: 4.2 }, { articulo: '1000000002', uds: 21, cajas: 1.75 }] })
    expect(r.status).toBe(200)
    expect(fila()).toEqual({ uds_afectadas: 42, cajas_afectadas: 5.95, motivo: 'Producción' })
    expect(desglose()).toEqual([{ articulo: '1000000001', uds: 21, cajas: 4.2 }, { articulo: '1000000002', uds: 21, cajas: 1.75 }])
  })
  it('un desglose nuevo sustituye al anterior; vacío lo borra y deja el total que se mande', async () => {
    await patch({ pedido: 1, albaran: 100, afectadasArticulos: [{ articulo: '1000000001', uds: 10, cajas: 2 }] })
    await patch({ pedido: 1, albaran: 100, afectadasArticulos: [{ articulo: '1000000002', uds: 5, cajas: 1 }] })
    expect(desglose()).toEqual([{ articulo: '1000000002', uds: 5, cajas: 1 }])
    await patch({ pedido: 1, albaran: 100, udsAfectadas: 0, cajasAfectadas: 0, afectadasArticulos: [] })
    expect(desglose()).toEqual([])
    expect(fila().uds_afectadas).toBe(0)
  })
  it('sin desglose, lo anotado antes se conserva', async () => {
    await patch({ pedido: 1, albaran: 100, udsAfectadas: 85, cajasAfectadas: 17 })
    await patch({ pedido: 1, albaran: 100, motivo: 'Producción' })
    expect(fila()).toEqual({ uds_afectadas: 85, cajas_afectadas: 17, motivo: 'Producción' })
  })
  it('un desglose inválido no guarda nada', async () => {
    const r = await patch({ pedido: 1, albaran: 100, motivo: 'Producción', afectadasArticulos: [{ articulo: '1000000001', uds: -3 }] })
    expect(r.status).toBe(400)
    expect(fila()).toBeNull()
    expect(desglose()).toEqual([])
  })
})

describe('restos del reparto por palet (980 sin SDSOCN)', () => {
  it('una línea en 980 sin unidades canceladas es un resto del reparto; con SDSOCN es una cancelación real', () => {
    expect(esRestoDeReparto({ estado: '980', udsCanceladas: 0 })).toBe(true)
    expect(esRestoDeReparto({ estado: '980', udsCanceladas: 85 })).toBe(false)
    expect(esRestoDeReparto({ estado: '620', udsCanceladas: 0 })).toBe(false)
    expect(esRestoDeReparto({ estado: '550', udsCanceladas: 0 })).toBe(false)
  })
  it('sin los restos, un artículo enviado palet a palet sale completo', () => {
    // Ficticio: 3 palets de 100 enviados; al salir cada palet JDE dejó en 980 el resto (200, 100) sin SDSOCN
    const lineas = [
      { estado: '620', udsCanceladas: 0, l: linea({ udsPedidas: 100, udsEnviadas: 100 }) },
      { estado: '980', udsCanceladas: 0, l: linea({ albaran: 0, fechaEnvio: null, udsPedidas: 200, udsEnviadas: 0 }) },
      { estado: '620', udsCanceladas: 0, l: linea({ udsPedidas: 100, udsEnviadas: 100 }) },
      { estado: '980', udsCanceladas: 0, l: linea({ albaran: 0, fechaEnvio: null, udsPedidas: 100, udsEnviadas: 0 }) },
      { estado: '620', udsCanceladas: 0, l: linea({ udsPedidas: 100, udsEnviadas: 100 }) },
    ]
    const e = agruparEnvios(lineas.filter((x) => !esRestoDeReparto(x)).map((x) => x.l))
    expect(e.length).toBe(1)
    expect(e[0].udsPedidas).toBe(300)
    expect(e[0].udsEnviadas).toBe(300)
  })
})

describe('pedidos duplicados (uno enviado y otro cancelado entero, misma ref. del cliente)', () => {
  // Ficticio: el pedido 2 entró dos veces; el 3 se sirvió y el 2 se canceló entero
  const enviado = linea({ pedido: 3, suPedido: 'REF-1', fechaPrometida: '2024-03-04' })
  const cancelado = linea({ pedido: 2, suPedido: 'REF-1', albaran: 0, fechaEnvio: null, udsEnviadas: 0, cajasEnviadas: 0, udsCanceladas: 100, fechaPrometida: '2024-03-04' })

  it('el cancelado con gemelo enviado es duplicado y no cuenta en los KPI', () => {
    expect(detectarDuplicados([enviado, cancelado])).toEqual(new Map([[2, 3]]))
    const { envios, kpis } = armarRespuesta([enviado, cancelado], new Map(), {}, '2024-04-01')
    expect(envios.find((e) => e.pedido === 2)?.duplicadoDe).toBe(3)
    expect(envios.find((e) => e.pedido === 3)?.duplicadoDe).toBeNull()
    expect(kpis.pedidos).toBe(1)
    expect(kpis.duplicados).toBe(1)
    expect(kpis.pctCompleto).toBe(100)
    expect(kpis.udsPedidas).toBe(100)
  })
  it('una cancelación sin gemelo sigue contando como incumplida', () => {
    const { kpis } = armarRespuesta([cancelado], new Map(), {}, '2024-04-01')
    expect(kpis.duplicados).toBe(0)
    expect(kpis.pedidos).toBe(1)
    expect(kpis.pctCompleto).toBe(0)
  })
  it('sin ref. del cliente, o de otro cliente, no es duplicado', () => {
    expect(detectarDuplicados([linea({ pedido: 3, suPedido: '' }), { ...cancelado, suPedido: '' }]).size).toBe(0)
    expect(detectarDuplicados([linea({ pedido: 3, suPedido: 'REF-1', cliente: 9 }), cancelado]).size).toBe(0)
  })
  it('un pedido con alguna línea enviada o sin cancelar no es cancelado entero', () => {
    expect(pedidosCanceladosEnteros([cancelado, { ...cancelado, udsCanceladas: 0 }]).size).toBe(0)
    expect(pedidosCanceladosEnteros([cancelado, { ...cancelado, udsEnviadas: 10 }]).size).toBe(0)
    expect(pedidosCanceladosEnteros([cancelado]).get(2)).toEqual({ cliente: 1, suPedido: 'REF-1' })
  })
  it('detecta el gemelo enviado aunque esté fuera del rango cargado', () => {
    expect(detectarDuplicados([cancelado]).size).toBe(0)
    const { kpis } = armarRespuesta([cancelado], new Map(), {}, '2024-04-01', [{ pedido: 3, cliente: 1, suPedido: 'REF-1' }])
    expect(kpis.duplicados).toBe(1)
    expect(kpis.pedidos).toBe(0)
  })
  it('los duplicados no suman en los gráficos de incidencias', () => {
    const e = { pedido: 2, canal: 'HOR', udsPedidas: 100, udsEnviadas: 0, udsAfectadas: 0, fechaPrometida: '2024-03-04', entrega: 'pendiente_envio' as const, motivo: 'Cliente', responsable: 'Cliente', duplicadoDe: 3 }
    expect(contarIncidencias([e], 'motivo')).toEqual({})
    expect(incidenciasPorMes([e])).toEqual([])
  })
  it('los datos de ejemplo traen un duplicado', () => {
    const { lineas, tracking } = generarEjemplo()
    expect(armarRespuesta(lineas, tracking, {}, '2024-08-01').kpis.duplicados).toBe(1)
  })
})
