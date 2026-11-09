# Documentación — Nivel de servicio (`/servicio`)

## 1. Descripción general

Panel que sustituye al Excel «Cuadro seguimiento pedidos»: mide el **nivel de servicio
(OTIF)** de los pedidos de venta — qué se envió, cuándo se envió, cuándo se
prometió entregar y cuándo se entregó de verdad. Dashboard sobre el sistema **Nova**
(ver `components/nova/README.md`), con una capa de datos manuales.

Dos pestañas: **Seguimiento** (tabla de envíos con KPIs y edición de datos manuales) e
**Indicadores** (sustituye a las tablas dinámicas y al gráfico del Excel, ver §8).
**Pendiente**: penalizaciones (Makro/Carrefour) — a la espera de respuesta del negocio —,
filtros por transportista/cliente/responsable (los «segmentadores» del Excel) y
filtros por transportista y ranking de transportistas (la lista de transportistas ya se gestiona en `/admin`).

## 2. Archivos

```
app/servicio/page.tsx              # Página (Nova): rango de fechas, KPIs, tabla, exportar
app/api/servicio/route.ts          # GET (F4211 + capa manual) y PATCH (datos manuales de un envío)
lib/servicio.ts                    # Lógica pura: agrupar envíos, estado de entrega, KPIs, fechas JDE
components/nova/servicio-table.tsx # Tabla de envíos + Dialog de edición
components/nova/servicio-clientes-filtro.tsx # Filtro de clientes + presets de clientes (§17)
components/nova/panel-shell.tsx    # Armazón común (barra lateral ShadcnSpace) — secciones Seguimiento / Indicadores
components/nova/servicio-indicadores.tsx # Pestaña Indicadores: resumen mes×canal y gráficos
components/shadcn-space/blocks/chart-16|chart-12|chart-02|chart-01  # Bloques ShadcnSpace (OTIF por canal, barras de motivos, donut, apiladas) parametrizados
lib/sqlite.ts                      # Tabla order_service_tracking
lib/panels.ts                      # Entrada 'servicio' (grupo Dashboards del nav)
__tests__/servicio.test.ts         # Tests de lib/servicio.ts
__tests__/presets.test.ts          # Tests del preset predeterminado (PATCH /api/presets/:id)
```

## 3. Origen de datos (JDE, F4211)

Consulta en directo, sin caché. Una fila de F4211 = una **línea de pedido partida por
SSCC** enviado o vendido; un pedido puede ir en varios albaranes (entregas).

| Dato | Campo | Notas |
|---|---|---|
| Nuestro nº de pedido | `SDDOCO` | |
| Nº de pedido del cliente | `SDVR01` | «Su pedido» |
| Nº de albarán | `SDDELN` | 0 = aún sin albarán. **Es la unidad del panel** |
| Fecha de envío real | `SDADDJ` | 0 = aún sin enviar |
| Fecha de entrega **prometida** | `SDRSDJ` | contra ella se compara la entrega real |
| Uds canceladas | `SDSOCN` | ÷100. Cuentan como falta de servicio, con responsable «Cliente» (§15) |
| Uds pedidas / enviadas | `SDUORG` / `SDSOQS` | ÷100. Todo son unidades (tortillas, migas…), sin cajas |
| Cajas (pedidas y enviadas) | `F41002` (`UMITM`, `UMUM`, `UMRUM`, `UMCONV` ÷10.000.000) | Unidades ÷ unidades por caja, con la conversión CJ→UN del artículo (o la inversa UN→CJ). **Los códigos `CJ`/`UN` son los del ejemplo de `docs/produccion.md`: confirmar que son los de JDE** (se cambian en `UM_CAJA`/`UM_UNIDAD`, `lib/servicio.ts`) |
| Cajas, respaldo | `SDSQOR` | Cantidad pedida secundaria (cajas), ÷100 (**suposición: misma escala que `SDUORG`**). Solo si el artículo no tiene conversión CJ↔UN; las enviadas entonces se reparten en proporción: `SDSQOR × SDSOQS / SDUORG` |
| Cliente / destino | `SDAN8` / `SDSHAN` → `F0101.ABALPH` | |
| Canal (= Business Line) | `F554101.AAZE06` (UDC `17/B6`) | mismo origen que `/compras`; atributo del artículo |

Filtro: `SDDCTO != 'ST'` (de momento es la única exclusión). El rango de fechas de la
pantalla se aplica sobre `SDRSDJ`. Fechas JDE (CYYDDD) ↔ ISO en `jdeAIso` / `isoAJde`.

**Canal del pedido**: un pedido tiene un solo canal; se toma el de sus artículos (si JDE
devolviera varios, el mayoritario en unidades).

## 4. Qué es un «envío» y cómo se evalúa

La unidad de la tabla es el **envío = (pedido, albarán)**. Las líneas SSCC del mismo
albarán se suman. Lo aún no enviado se agrupa en el albarán 0 («Sin enviar»). El nº de
camión (`SDSHPN`) y la fecha de carga (`SDPDDJ`) se quitaron de la vista a petición del
negocio; la consulta a F4211 sigue trayendo ambas columnas aunque ya no se usen (no se
tocó la consulta Oracle), se pueden quitar del `SELECT` cuando convenga.

- **Estado de entrega de un envío**: sin `SDADDJ` → *Sin enviar*; enviado sin fecha real
  introducida → *Sin confirmar*; real ≤ prometida → *A tiempo*; real > prometida → *Tarde*.
- **Pedido**: cualquier envío tarde → tarde; si no, alguno sin confirmar → sin confirmar;
  si no, a tiempo. **Completo** = uds enviadas ≥ uds pedidas (suma de todos sus envíos).
- **Abierto**: pedido incompleto cuya fecha prometida aún no ha vencido. No se evalúa
  (todavía puede cumplirse).
- **KPIs** (`calcularKpis`): `% A tiempo` y `% OTIF` sobre pedidos con entrega confirmada
  (a tiempo/tarde); `% Completo` sobre todos los evaluados. OTIF = a tiempo y completo.
  Los *sin confirmar* no cuentan hasta que alguien introduzca la fecha real (decisión
  tomada: así el KPI no se infla, a diferencia del Excel, donde sin dato = OK).

## 5. Datos manuales (SQLite)

Tabla `order_service_tracking`, clave `(pedido, albaran)`, upsert vía `PATCH /api/servicio`:

| Campo | Notas |
|---|---|
| `fecha_entrega_real` | La que decide a tiempo/tarde |
| `transportista` | Texto libre **de momento** (no está claro que exista en JDE). Si no está, se sustituirá por una lista configurable en `/admin` + desplegable |
| `responsable`, `motivo` | Listas cerradas en `lib/servicio.ts` (`RESPONSABLES`, `MOTIVOS`), sacadas de las categorías del Excel; ajustar ahí si el negocio quiere otras |
| `incidencia` (≤500), `uds_afectadas` | Texto libre y unidades afectadas |

El `PATCH` valida cada campo en el límite de la API y conserva los que no vengan.

## 6. Pendiente de verificar contra datos reales

No se han podido contrastar estas hipótesis con Oracle al escribir el panel:

1. Si `SDUORG` de una línea partida por SSCC es la parte de esa línea o el total del
   pedido repetido. Si fuera lo segundo, `uds pedidas` se multiplicaría y ningún pedido
   saldría «completo». Comprobar con un pedido de varios SSCC.
2. Si las líneas servidas siguen en F4211 (como asume `/compras`) o pasan a F42119.
3. Que `SDRSDJ` sea de verdad la fecha prometida al cliente.
4. Qué más hay que excluir además de `SDDCTO = 'ST'`.
5. Rendimiento de la consulta (filtra por `SDRSDJ`, sin índice conocido): si fuera lenta,
   acotar el rango por defecto o pasar a caché como `/muestras`.

## 7. Registro del panel

`lib/panels.ts` (`servicio`, siembra `screens`, pública por defecto, restringible desde
`/admin`), `topbar-02/data.ts` (`DASHBOARD_KEYS`), `SOURCE_LABELS` de
`components/nova/admin/logs-consultas.tsx` (`servicio`), `requireScreenAccess('servicio')`
en la API y logging en `query_logs` con `source: 'servicio'`.

## 8. Pestaña «Indicadores»

Todo se calcula **en cliente** sobre los envíos ya cargados (el rango de fechas de la
página), con `resumenMensual`, `contarIncidencias` e `incidenciasPorMes` de
`lib/servicio.ts`. Para ver 6 o 12 meses hay que ampliar el rango y pulsar «Filtrar».

| Bloque | Sustituye en el Excel a | Notas |
|---|---|---|
| Tabla resumen mes × canal (con total por mes) | Tabla dinámica `TD % NS OTIF` | % a tiempo, % completo, % OTIF por pedido, uds pedidas, uds con incidencia, % OTIF uds. En rojo por debajo del 98 % |
| Áreas del % OTIF por pedido, una por canal (`chart-16`) | Columnas OTIF de esa tabla | Línea de referencia en el 98 % |
| Barras de incidencias por motivo | Tabla «Incidencias» | Cuenta envíos con motivo anotado |
| Donut de responsabilidad, últimos 3 meses (`chart-02`) | Gráfico circular 3D | El mes más reciente con datos y los 2 anteriores |
| Barras apiladas por mes y motivo (`chart-01`) | — | Para ver si un motivo crece |

**% OTIF en unidades** = 1 − (uds no enviadas + uds afectadas anotadas a mano) / uds
pedidas. Es una interpretación de la columna «Uds con incidencia» del Excel: **confirmar
con negocio** que esa es la fórmula. El objetivo del 98 % es el de Makro; Carrefour exige
el 99 % por cajas (irá por cliente al hacer la pestaña de penalizaciones).

## 9. Datos de ejemplo (`/servicio?mock=1`)

Para ver el panel y los gráficos sin datos reales: `GET /api/servicio?mock=1` devuelve
~500 envíos **ficticios** de enero a julio de 2024 (clientes inventados, con entregas a
tiempo, tarde, sin confirmar, incompletas y varios motivos de incidencia), generados en
`generarEjemplo()` (`lib/servicio.ts`, determinista). Responde **antes** de abrir Oracle
y no lee ni escribe SQLite. Solo se activa por URL, no hay botón (igual que
`/compras?mock=1`). La página lo detecta, fija el rango a ene–jul, muestra la etiqueta
«Datos de ejemplo» y los cambios del lápiz **solo quedan en pantalla** (no llaman al
`PATCH`). Real y ejemplo comparten `armarRespuesta()`, así que los cálculos son los mismos.

## 10. Tabla de seguimiento: incidencias

La tabla muestra la columna **Uds con incidencia** (las unidades afectadas anotadas a
mano; en rojo si hay, con la incidencia como texto emergente) y un filtro **Con / sin
incidencia**. «Tiene incidencia» (`tieneIncidencia`, `lib/servicio.ts`) = motivo, texto o
unidades afectadas anotados.

## 11. Aspecto de la tabla de seguimiento

Estilo del bloque `table-09` de ShadcnSpace (ver `components/nova/README.md` punto 11),
con celdas de dos líneas para que las filas no sean uniformes: Pedido (icono + su pedido),
Cliente (+ canal), Albarán (+ fecha de envío), Entrega (prometida + real, en rojo si
llegó tarde), Unidades (enviadas del albarán + barra del pedido completo: verde si está
completo, ámbar si no), Incidencia (uds afectadas + motivo), Transportista, Estado y menú
«⋮» → «Editar datos». Márgenes laterales amplios (`ps-6`/`pe-6`, tarjeta `p-6`). La barra
de unidades resuelve la duda del antiguo «64/100»: arriba, lo del albarán; debajo,
«Pedido X de Y» con la barra de lo enviado en todo el pedido.

## 12. Barra lateral

La página se monta con `NovaPanelShell` (`components/nova/panel-shell.tsx`, ver README Nova
punto 12): **Seguimiento** e **Indicadores** son subítems de «Nivel de servicio» en la barra lateral
(bloque Sidebar 01 de ShadcnSpace; ya no hay pestañas arriba), dentro del grupo DASHBOARDS,
y debajo van el resto de paneles. El
avatar de cada fila de la tabla son las iniciales del cliente con el color de su canal.

## 13. Listas editables (motivos, responsables y transportistas)

Los desplegables del diálogo de edición ya no salen del código: se gestionan en
**/admin → Datos → Listas de servicio** (`components/nova/admin/servicio-catalogos.tsx`).

- **Almacén:** tabla `servicio_catalogo(tipo, nombre, activo, orden)`. Se carga una sola vez, al
  crearla, con los motivos y responsables de `lib/servicio.ts` (`MOTIVOS`, `RESPONSABLES`, que
  ya son solo esa carga inicial); si luego se vacía a propósito, no se vuelve a rellenar.
- **API:** `GET/POST/PATCH/DELETE /api/admin/servicio-catalogos` (permiso suelto
  `admin.servicio.catalogos`, asignable a un rol o usuario sin hacerlo admin; el admin siempre
  puede) y `GET /api/servicio/catalogos` (solo las opciones activas, las que leen los
  desplegables de `/servicio`; mismo acceso que el panel).
- **Quitar una opción:** si algún envío guardado la usa (`usos > 0`), solo se **desactiva**:
  deja de salir en los desplegables, pero las incidencias antiguas la conservan, los gráficos
  no pierden datos y se puede reactivar. Solo se borra del todo si nunca se usó. No se puede
  renombrar (cambiaría el sentido de las incidencias ya guardadas): se añade la nueva y se
  desactiva la vieja.
- **Validación (`PATCH /api/servicio`):** vacío, un valor activo de la lista o el que el envío ya
  tenía (aunque se haya desactivado después, para poder editar otro campo sin tocar ese). En el
  diálogo, un valor inactivo se sigue mostrando marcado «(inactivo)».
- **Transportistas:** el campo del diálogo es **siempre un desplegable** (ya no hay texto libre): solo se
  puede elegir un transportista activo de la lista, dejarlo vacío o conservar el que el envío ya tenía
  (también si se desactivó, o si era un texto escrito antes de existir la lista, que se muestra como
  «(inactivo)»). Sin transportistas dados de alta el desplegable sale vacío, con un aviso que remite a
  /admin → Listas de servicio.

## 14. Unidades y cajas en la tabla

La celda **Unidades** muestra, del **pedido completo**, «enviadas / pedidas uds» y, debajo,
«enviadas / pedidas cajas», con la barra de progreso (verde si el pedido está completo, ámbar
si no). Lo del **albarán** concreto va en el texto emergente de la celda («Este albarán: X uds ·
Y cajas»). Las cajas salen de la conversión del artículo (F41002); si no la tiene, de `SDSQOR`. Pueden salir con
un decimal (unidades que no llenan una caja, o el reparto proporcional del respaldo); si no hay ni conversión ni
`SDSQOR`, se muestra «— cajas». El Excel exportado añade «Cajas enviadas» y «Cajas
pedidas (envío)». Los KPI siguen calculándose en unidades.

## 15. KPI: cobertura, cajas y cancelaciones

Decisiones tomadas con el negocio:
- **A tiempo** = fecha de entrega real ≤ fecha prometida, sin tolerancia.
- **Cancelaciones:** las unidades canceladas por el cliente (`SDSOCN`) **sí cuentan como falta de servicio**
  (el pedido sale incompleto y bajan el OTIF) pero la **responsabilidad es del cliente**: un envío con
  cancelaciones se trata como una incidencia aunque nadie la haya anotado (motivo «Cancelación del
  cliente», responsable «Cliente»), y sale así en los gráficos, en el filtro «Con incidencia» y en la
  celda Incidencia. Lo anotado a mano manda sobre esto (`motivoEfectivo` / `responsableEfectivo`).
- **Periodo:** sin cambios; no se compara con periodos anteriores (la tendencia es la del rango cargado).

Para que el KPI no engañe:
- **Cobertura** = pedidos con entrega confirmada / pedidos evaluados. El % a tiempo y el OTIF solo cuentan los
  confirmados, así que con poca cobertura se apoyan en pocos datos. En las tarjetas, el OTIF se muestra en
  ámbar y con «(baja)» si la cobertura es menor del 80 %; en la tabla de Indicadores hay una columna
  «Cobertura».
- **Pendientes de confirmar** (tarjeta): envíos ya enviados sin fecha de entrega real; es lo que hay que
  rellenar. Sustituye a «Pedidos evaluados», que pasa al subtítulo del OTIF.
- **% OTIF cajas** = 1 − (cajas no enviadas + cajas afectadas) / cajas pedidas, donde las cajas afectadas son
  las unidades afectadas anotadas, pasadas a cajas con la proporción de su envío. Carrefour mide por cajas y
  Makro por unidades.

## 16. Color de los KPI y afectadas en unidades o cajas

- **Color de las tarjetas:** el % OTIF, el % A tiempo y el % Completo se pintan frente al objetivo
  (`OBJETIVO_OTIF_PCT` = 98 %, `lib/servicio.ts`): verde si lo cumple, ámbar hasta 8 puntos por debajo y
  rojo si está más lejos. Cada una lleva una insignia con la distancia al objetivo («−3,9 pp»); el OTIF
  muestra «Cobertura baja» (ámbar) si la cobertura es menor del 80 %. «Pendientes de confirmar» es ámbar
  («Por rellenar») si hay alguno y verde («Al día») si no.
- **Afectadas en unidades o en cajas:** en «Editar datos» el campo «Afectadas» tiene un selector
  **Uds / Cajas**; el otro valor se calcula al momento con las unidades por caja de ese envío
  (unidades pedidas ÷ cajas pedidas) y se enseña debajo («≈ 8 cajas»). Si el envío no tiene cajas
  definidas, solo se admiten unidades. En SQLite se guardan **las dos** (`uds_afectadas`,
  `cajas_afectadas`), la columna nueva se añade sola a las bases existentes. El `PATCH` acepta
  `udsAfectadas` y `cajasAfectadas`.
- **Aproximación:** si un envío mezcla artículos con distinto nº de unidades por caja, la conversión usa
  la media del envío, así que es aproximada. Para el OTIF por cajas se usan las cajas anotadas si las
  hay y, si no, las unidades afectadas pasadas a cajas con esa misma proporción.
- **En la tabla**, la celda Incidencia muestra «91 uds · 8 cajas» y el motivo debajo.

## 17. Filtro de clientes y presets

- **Filtro:** desplegable «Todos los clientes» junto al rango de fechas (`components/nova/servicio-clientes-filtro.tsx`), con búsqueda y selección múltiple. Las opciones salen de los envíos ya cargados (`cliente` = `SDAN8`, con el nombre de F0101), no de una consulta nueva. Filtra **en pantalla** (`filtrarPorClientes`, `lib/servicio.ts`): KPIs, tabla, Indicadores y exportación a Excel usan solo los clientes elegidos. Vacío = todos. Es el cliente del pedido (`SDAN8`), no el destino de entrega.
- **Seleccionar todos / «todos menos»:** «Seleccionar todos» marca todos los clientes; desmarcar uno lo **excluye** y el botón muestra «Todos menos 2» (o el nombre si es uno). En ese modo se recuerdan los clientes quitados, no los marcados, así que un cliente nuevo o de otro periodo entra solo, también en un filtro guardado (`{ clientes, excluir: true }`). Con texto en la búsqueda, el botón pasa a «Marcar los N mostrados». «Limpiar» (o la ✕) quita el filtro.
- **Presets:** los filtros guardados comunes de Nova (botón «Mis filtros», ver `components/nova/README.md` punto 15). En este panel guardan `{ clientes, excluir }` y, si se elige, las fechas (fijas o un periodo relativo como «Últimos 30 días»). `screen = 'servicio'`; en `?mock=1`, `'servicio-ejemplo'` para no mezclar clientes inventados con los reales. Los presets guardados con la v1.39.0 (solo `{ clientes }`) se siguen leyendo.
- **Predeterminado:** el marcado con la estrella se aplica al abrir el panel, antes de la primera consulta (si trae fechas, se consulta directamente ese rango).
- **Un cliente que ya no aparece** en el periodo sigue en el preset: no rompe nada, solo no se ve en la lista.
