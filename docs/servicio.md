# Documentación — Nivel de servicio (`/servicio`)

## 1. Descripción general

Panel que sustituye al Excel «Cuadro seguimiento pedidos»: mide el **nivel de servicio
(OTIF)** de los pedidos de venta — qué se envió, cuándo se envió, cuándo se
prometió entregar y cuándo se entregó de verdad. Dashboard sobre el sistema **Nova**
(ver `components/nova/README.md`), con una capa de datos manuales.

Dos pestañas: **Seguimiento** (tabla de envíos con KPIs y edición de datos manuales) e
**Indicadores** (sustituye a las tablas dinámicas y al gráfico del Excel, ver §8).
**Pendiente**: penalizaciones (Makro/Carrefour) — a la espera de respuesta del negocio —,
filtros por transportista y responsable (los «segmentadores» del Excel; el de cliente ya está, §17)
y ranking de transportistas (la lista de transportistas ya se gestiona en `/admin`).

## 2. Archivos

```
app/servicio/page.tsx              # Página (Nova): rango de fechas, KPIs, tabla, exportar
app/api/servicio/route.ts          # GET (F4211 + capa manual) y PATCH (datos manuales de un envío)
lib/servicio.ts                    # Lógica pura: agrupar envíos, estado de entrega, KPIs, fechas JDE
components/nova/servicio-table.tsx # Tabla de envíos + Dialog de edición
components/nova/servicio-clientes-filtro.tsx # Filtro de selección múltiple: clientes y tipos de pedido (§17)
components/nova/panel-shell.tsx    # Armazón común (barra lateral ShadcnSpace) — secciones Seguimiento / Indicadores
components/nova/servicio-indicadores.tsx # Pestaña Indicadores: resumen mes×canal y gráficos
components/shadcn-space/blocks/chart-16|chart-12|chart-02|chart-01  # Bloques ShadcnSpace (OTIF por canal, barras de motivos, donut, apiladas) parametrizados
lib/sqlite.ts                      # Tablas order_service_tracking y order_service_incidencia_articulo
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
| Uds canceladas | `SDSOCN` | ÷100. Solo informativo: lo cancelado ya cuenta como no enviado; no genera incidencia sola (§15) |
| Uds pedidas / enviadas | `SDUORG` / `SDSOQS` | ÷100, en la UM principal de la línea (`SDUOM`, p. ej. UN). **Enviadas solo si la línea tiene fecha de envío** (`SDADDJ`): JDE rellena `SDSOQS` ya en el picking (550), antes de que salga (`cantidadesLinea`) |
| Cajas (pedidas y enviadas) | `SDUOM` / `SDUOM2` + `F41002` (`UMITM`, `UMUM`, `UMRUM`, `UMCONV` ÷10.000.000) | Unidades ÷ uds por caja. La caja es la **UM secundaria de la línea** (`SDUOM2`, p. ej. BX) y las unidades, la **principal** (`SDUOM`): se usa la conversión de F41002 de una a otra (o la inversa), sin códigos fijos (`udsPorCaja`) |
| Cajas, respaldo | `SDSQOR` | Cantidad secundaria (cajas), ÷100. Solo si el artículo no tiene esa conversión: uds por caja = suma de `SDUORG` ÷ suma de `SDSQOR` de sus líneas que la traen, aplicada a **todas** sus líneas (`udsPorCajaDeLineas`). Las canceladas (980) vienen sin cantidad secundaria, así que no se puede usar línea a línea |
| Cliente / destino | `SDAN8` / `SDSHAN` → `F0101.ABALPH` | |
| Canal (= Business Line) | `F554101.AAZE06` (UDC `17/B6`) | mismo origen que `/compras`; atributo del artículo |

Filtros de la consulta (`TIPOS_PEDIDO` y `TIPO_LINEA_STOCK`, `lib/servicio.ts`), sacados del flujo de
estados por tipo de pedido de JDE:

| Tipo (`SDDCTO`) | Qué es | ¿Cuenta? |
|---|---|---|
| `SO` | Pedido de venta | Sí |
| `SE` | Pedido EDI / Mercadona | Sí |
| `SM` / `SY` | Muestra nacional / de exportación | Sí (se pueden quitar con el filtro de tipos, §17) |
| `ST` / `OT` | Envío entre almacenes | No |
| `S1` / `SH` | Cargo rectificativo / correctivo (línea N, sin envío) | No |
| `CO` / `C1` | Devolución y abonos | No |

Además, **solo líneas de stock** (`SDLNTY = 'S'`): las líneas `N` de un pedido de venta (portes, cargos)
pasan de 520 a 580 sin albarán ni envío y dejarían el pedido siempre incompleto. Los estados
(`SDLTTR`/`SDNXTR`) no se leen: el albarán (`SDDELN`, se pone en 550→570) y la fecha de envío (`SDADDJ`,
salida de stock 570→580) ya dicen si una línea se ha enviado, y una cancelada (980) se trata como no
enviada igual que una pendiente. El rango de fechas de la pantalla se aplica sobre `SDRSDJ`. Fechas JDE
(CYYDDD) ↔ ISO en `jdeAIso` / `isoAJde`.

**Canal del pedido**: un pedido tiene un solo canal; se toma el de sus artículos (si JDE
devolviera varios, el mayoritario en unidades).

## 4. Qué es un «envío» y cómo se evalúa

La unidad de la tabla es el **envío = (pedido, albarán)**. Las líneas SSCC del mismo
albarán se suman. Las líneas **sin albarán** (`SDDELN` = 0: lo pendiente o lo cancelado, p. ej.
el resto de una línea que JDE partió y canceló) **no salen como fila aparte si el pedido ya tiene
algún albarán**: se suman a su último envío (el de fecha de envío más reciente). Así cuentan en el
total del pedido —la barra de unidades no se completa y el pedido no es completo— sin repetir el
total del pedido en una fila «Sin enviar». Solo se suman cantidades; las fechas son las del envío
real. Si el pedido no tiene **ningún** albarán, sí sale una fila «Sin enviar» (albarán 0). El nº de
camión (`SDSHPN`) y la fecha de carga (`SDPDDJ`) se quitaron de la vista a petición del
negocio; la consulta a F4211 sigue trayendo ambas columnas aunque ya no se usen (no se
tocó la consulta Oracle), se pueden quitar del `SELECT` cuando convenga.

- **Estado de entrega de un envío**: sin `SDADDJ` → *Sin enviar*; real ≤ prometida → *A tiempo*;
  real > prometida → *Tarde*. **Enviado sin fecha real anotada → se da por entregado en la fecha
  prometida (*A tiempo*)**, como en el Excel original: si no fue así, se anota la fecha real y
  cuenta esa. En la tabla, la línea «Real» muestra la fecha prometida en ese caso.
- **Pedido**: cualquier envío tarde → tarde; si no, alguno a tiempo → a tiempo; si no (nada
  enviado) → sin enviar. **Completo** = uds enviadas ≥ uds pedidas (suma de todos sus envíos).
- **Abierto**: pedido incompleto cuya fecha prometida aún no ha vencido. No se evalúa
  (todavía puede cumplirse).
- **KPIs** (`calcularKpis`): `% A tiempo`, `% Completo` y `% OTIF` sobre **todos los pedidos
  evaluados**. OTIF = a tiempo y completo. Un pedido vencido sin nada enviado no está a tiempo.
- **Historial de la decisión:** hasta la v1.42 un envío sin fecha real era *Sin confirmar* y no
  contaba en el % a tiempo ni en el OTIF (había tarjeta «Pendientes de confirmar» y aviso
  «Cobertura baja»). Se cambió a petición del negocio: lo normal es que llegue en la fecha
  prometida y solo se anota cuando no es así.

## 5. Datos manuales (SQLite)

Tabla `order_service_tracking`, clave `(pedido, albaran)`, upsert vía `PATCH /api/servicio`:

| Campo | Notas |
|---|---|
| `fecha_entrega_real` | La que decide a tiempo/tarde |
| `transportista` | Texto libre **de momento** (no está claro que exista en JDE). Si no está, se sustituirá por una lista configurable en `/admin` + desplegable |
| `responsable`, `motivo` | Listas cerradas en `lib/servicio.ts` (`RESPONSABLES`, `MOTIVOS`), sacadas de las categorías del Excel; ajustar ahí si el negocio quiere otras |
| `incidencia` (≤500), `uds_afectadas`, `cajas_afectadas` | Texto libre y total de afectadas del envío (si hay desglose por artículo, es su suma: §18) |

Desglose por artículo en `order_service_incidencia_articulo`, clave `(pedido, albaran, articulo)` (§18).

El `PATCH` valida cada campo en el límite de la API y conserva los que no vengan.

## 6. Pendiente de verificar contra datos reales

No se han podido contrastar estas hipótesis con Oracle al escribir el panel:

1. Si `SDUORG` de una línea partida por SSCC es la parte de esa línea o el total del
   pedido repetido. Si fuera lo segundo, `uds pedidas` se multiplicaría y ningún pedido
   saldría «completo». Comprobar con un pedido de varios SSCC.
2. Si las líneas servidas siguen en F4211 (como asume `/compras`) o pasan a F42119.
3. Que `SDRSDJ` sea de verdad la fecha prometida al cliente.
4. ~~Qué más hay que excluir además de `SDDCTO = 'ST'`~~ → resuelto con la tabla de tipos de pedido y
   líneas de §3. Pendiente de comprobar en producción con un pedido conocido (p. ej. uno con portes).
   Ojo: los envíos se agrupan por nº de pedido (`SDDOCO`) sin el tipo; si un `SM` y un `SO` pudieran
   tener el mismo número, se mezclarían. Comprobar que los rangos de numeración no se solapan.
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
tiempo, tarde, sin fecha real, incompletas y varios motivos de incidencia), generados en
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
Y cajas»). Las cajas salen de la conversión del artículo (F41002, de la UM secundaria a la principal de la línea); si no la tiene, de las uds por caja de sus líneas con `SDSQOR` (§3). Pueden salir con
un decimal (unidades que no llenan una caja, o el reparto proporcional del respaldo); si no hay ni conversión ni
`SDSQOR`, se muestra «— cajas». El Excel exportado añade «Cajas enviadas» y «Cajas
pedidas (envío)». Los KPI siguen calculándose en unidades.

## 15. KPI: fecha real, cajas y cancelaciones

Decisiones tomadas con el negocio:
- **A tiempo** = fecha de entrega real ≤ fecha prometida, sin tolerancia. Sin fecha real anotada, cuenta la
  prometida (§4).
- **Cancelaciones:** las unidades canceladas (`SDSOCN`) cuentan como **no enviadas** (el pedido sale incompleto
  y bajan el OTIF), una sola vez. **No generan una incidencia automática** (hasta la v1.42 se ponía sola
  «Cancelación del cliente» con responsable «Cliente»): quien revise el pedido ve la barra incompleta y anota
  el motivo y el responsable si lo ve conveniente. Al anotarlo, **no** hay que poner esas unidades también como
  afectadas: ya cuentan como no enviadas y saldrían dos veces en el OTIF por unidades.
- **Periodo:** sin cambios; no se compara con periodos anteriores (la tendencia es la del rango cargado).

Para que el KPI no engañe:
- **Sin fecha real** (tarjeta): envíos ya enviados a los que nadie ha anotado la fecha de entrega real
  (`sinFechaReal`, `lib/servicio.ts`). Cuentan como a tiempo con la fecha prometida; la tarjeta solo dice
  cuántos estados son supuestos. En la tabla de Indicadores, la columna **«Con fecha real»** es el % de
  pedidos evaluados con todas sus fechas reales anotadas (`pctConFechaReal`).
- **«Editar datos»:** si el envío no tiene fecha real, el campo sale relleno con la fecha prometida (con un
  aviso debajo); al guardar se queda anotada.
- **% OTIF cajas** = 1 − (cajas no enviadas + cajas afectadas) / cajas pedidas, donde las cajas afectadas son
  las unidades afectadas anotadas, pasadas a cajas con la proporción de su envío. Carrefour mide por cajas y
  Makro por unidades.

## 16. Color de los KPI y afectadas en unidades o cajas

- **Color de las tarjetas:** el % OTIF, el % A tiempo y el % Completo se pintan frente al objetivo
  (`OBJETIVO_OTIF_PCT` = 98 %, `lib/servicio.ts`): verde si lo cumple, ámbar hasta 8 puntos por debajo y
  rojo si está más lejos. Cada una lleva una insignia con la distancia al objetivo («−3,9 pp»). «Sin fecha
  real» lleva la insignia gris «A tiempo supuesto» si hay alguno y verde «Todas anotadas» si no.
- **Afectadas en unidades o en cajas:** en «Editar datos» el campo «Afectadas» tiene un selector
  **Uds / Cajas**; el otro valor se calcula al momento con las unidades por caja de ese envío
  (unidades pedidas ÷ cajas pedidas) y se enseña debajo («≈ 8 cajas»). Si el envío no tiene cajas
  definidas, solo se admiten unidades. En SQLite se guardan **las dos** (`uds_afectadas`,
  `cajas_afectadas`), la columna nueva se añade sola a las bases existentes. El `PATCH` acepta
  `udsAfectadas` y `cajasAfectadas`.
- **Aproximación (solo sin desglose):** si un envío mezcla artículos con distinto nº de unidades por caja,
  la conversión usa la media del envío, así que es aproximada. Desde §18 las afectadas se anotan por
  artículo, cada uno con su conversión; esto solo queda para lo anotado antes y para un envío sin artículos. Para el OTIF por cajas se usan las cajas anotadas si las
  hay y, si no, las unidades afectadas pasadas a cajas con esa misma proporción.
- **En la tabla**, la celda Incidencia muestra «91 uds · 8 cajas» y el motivo debajo.

## 17. Filtro de clientes y presets

- **Filtro:** desplegable «Todos los clientes» junto al rango de fechas (`components/nova/servicio-clientes-filtro.tsx`), con búsqueda y selección múltiple. Las opciones salen de los envíos ya cargados (`cliente` = `SDAN8`, con el nombre de F0101), no de una consulta nueva. Filtra **en pantalla** (`filtrarPorClientes`, `lib/servicio.ts`): KPIs, tabla, Indicadores y exportación a Excel usan solo los clientes elegidos. Vacío = todos. Es el cliente del pedido (`SDAN8`), no el destino de entrega.
- **Seleccionar todos / «todos menos»:** «Seleccionar todos» marca todos los clientes; desmarcar uno lo **excluye** y el botón muestra «Todos menos 2» (o el nombre si es uno). En ese modo se recuerdan los clientes quitados, no los marcados, así que un cliente nuevo o de otro periodo entra solo, también en un filtro guardado (`{ clientes, excluir: true }`). Con texto en la búsqueda, el botón pasa a «Marcar los N mostrados». «Limpiar» (o la ✕) quita el filtro.
- **Tipos de pedido:** segundo desplegable, «Todos los tipos» (venta `SO`, EDI / Mercadona `SE`, muestra nacional `SM`, muestra exportación `SY`). Es el mismo componente que el de clientes (`servicio-clientes-filtro.tsx`, con `textos`, `icono` y sin buscador), con las mismas reglas («Seleccionar todos», «todos menos») y filtra en pantalla con `filtrarPorTipos`. Salen siempre los cuatro tipos, haya o no pedidos de ese tipo en el rango. La tabla muestra el tipo junto a «su pedido» y el Excel exportado lo añade en «Tipo pedido».
- **Presets:** los filtros guardados comunes de Nova (botón «Mis filtros», ver `components/nova/README.md` punto 15). En este panel guardan `{ clientes, excluir, tipos, excluirTipos }` (`excluir` es el «todos menos» de los clientes, con ese nombre porque es anterior al filtro de tipos; un filtro guardado sin `tipos` los coge todos) y, si se elige, las fechas (fijas o un periodo relativo como «Últimos 30 días»). `screen = 'servicio'`; en `?mock=1`, `'servicio-ejemplo'` para no mezclar clientes inventados con los reales. Los presets guardados con la v1.39.0 (solo `{ clientes }`) se siguen leyendo.
- **Predeterminado:** el marcado con la estrella se aplica al abrir el panel, antes de la primera consulta (si trae fechas, se consulta directamente ese rango).
- **Un cliente que ya no aparece** en el periodo sigue en el preset: no rompe nada, solo no se ve en la lista.

## 18. Afectadas por artículo

En «Editar datos», en vez de un único campo «Afectadas», sale **una fila por artículo del envío**:
descripción, código, unidades enviadas de las pedidas y unidades por caja. Se escriben las **unidades
afectadas de cada artículo** y sus **cajas se calculan con la conversión de ese artículo, con decimales**
(21 uds de un artículo de 5 uds/caja = 4,2 cajas; decisión del negocio: sin redondear). Debajo, el total.
El motivo, el responsable y el texto de la incidencia siguen siendo **uno por envío**.

- **Artículos del envío:** salen de F4211 (`SDLITM` = «2º nº de artículo», `SDDSC1` = descripción), sumando
  sus líneas; las líneas sin albarán que se suman al último envío (§4) también suman sus artículos. Las uds
  por caja son las de la línea (§3: F41002 de `SDUOM2` a `SDUOM` o, si no, las de las líneas del artículo con `SDSQOR`).
  Sin ninguna de las dos, el artículo se anota solo en unidades («— cajas») y no suma cajas al total.
- **Almacén:** tabla `order_service_incidencia_articulo(pedido, albaran, articulo, uds, cajas)`, creada sola al
  arrancar. Solo guarda los artículos con algo anotado. `uds_afectadas` / `cajas_afectadas` de
  `order_service_tracking` se guardan como **la suma del desglose**, así que KPIs, gráficos, filtro «Con
  incidencia» y celda Incidencia funcionan igual que antes.
- **API:** `PATCH /api/servicio` acepta `afectadasArticulos: [{ articulo, uds, cajas }]` (`validarAfectadasArticulos`,
  `lib/servicio.ts`: código de 1–25 caracteres `[A-Za-z0-9_.-]`, sin repetir, uds enteras ≥ 0, cajas ≥ 0
  redondeadas a 2 decimales, máximo 200 artículos; las filas a cero se quitan). Si viene, **sustituye** al
  desglose anterior y el total pasa a ser su suma; vacío borra el desglose y deja el total que venga en
  `udsAfectadas` / `cajasAfectadas`. Datos del envío y desglose se guardan en una transacción. Las cajas
  las calcula la pantalla (el `PATCH` no consulta Oracle).
- **Lo anotado antes sin desglose** (un total sin artículos): el diálogo lo muestra como «Anotado sin
  desglose: 85 uds · 17 cajas» y **se conserva** mientras no se reparta por artículo. Al anotar algún
  artículo, se sustituye por el desglose; también hay un enlace «Quitar» para ponerlo a cero.
- **Envío sin artículos** (no debería pasar con datos de JDE): se mantiene el campo único antiguo.
- **Tabla:** la celda Incidencia muestra el total y, al pasar el ratón, el desglose por artículo.
- **Excel:** hoja «Incidencias por artículo» (pedido, albarán, cliente, artículo, descripción, uds y cajas
  afectadas, motivo, responsable), solo si algún envío tiene desglose.
- **Datos de ejemplo:** los pedidos pares llevan dos artículos inventados (`9000000001`, de 12 uds/caja, y
  `9000000002`, de 6) y las afectadas van en el primero.

## 19. Cajas con las UM de la línea y enviadas solo con fecha de envío (v1.43.1)

Caso que lo destapó (pedido EDI con 4 líneas canceladas y una en picking): el panel mostraba «508 / 508 cajas»
con unidades sin completar, y daba por enviadas unidades de una línea que aún estaba en picking.

- **Cajas:** el código buscaba en F41002 la caja con el código fijo `CJ`, pero en JDE es `BX`, así que nunca
  encontraba la conversión y usaba la cantidad secundaria de cada línea, que las canceladas no tienen (sus
  unidades sumaban 0 cajas). Ahora cada línea usa sus propias UM (`SDUOM2` → `SDUOM`) y, si el artículo no
  tiene conversión, las uds por caja de sus otras líneas.
- **Enviadas:** `SDSOQS` ya viene relleno en las líneas en picking (550), sin albarán ni fecha de envío.
  Ahora solo cuenta como enviado lo que tiene fecha de envío real (`SDADDJ`). Cambia el % Completo y el OTIF
  de los pedidos con líneas aún sin salir.
