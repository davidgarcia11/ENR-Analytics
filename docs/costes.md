# Documentación — Panel de Costes (`/costes`)

> Nombre mostrado en la navegación: **"Costes"** (`lib/panels.ts`) — pedido
> explícito, antes era "Coste A1". La URL pasó de `/coste-a1` a `/costes` y la
> key de permiso de `coste_a1` a `costes` en una ronda posterior ("la URL que
> sea costes"), con una migración en `lib/sqlite.ts` que renombra la fila
> existente de `screens` EN SITIO (conserva su `id`) para no dejar huérfanos
> los permisos ya concedidos ni crear una fila nueva pública por defecto.
> Nombres de archivo, componentes (`CosteA1Table`...) y la tabla
> NO cambiaron — son identificadores internos, no URLs, y renombrarlos no
> aportaba nada visible. Verificado con `agent-browser`
> tras reiniciar el servidor (para que la migración de SQLite corriera de
> verdad): `/costes` carga, `/coste-a1` da 404, el nav apunta a `/costes`, la
> pestaña "Pantallas" de `/admin` muestra una única fila "Costes" (sin
> duplicados ni permisos huérfanos) y los logs ya existentes con
> `source: 'coste_a1'` se muestran como "Costes".

> Panel sobre el sistema **Nova** (ShadcnSpace) — para cada artículo "final" (el que
> realmente se vende), muestra su coste A1 y el árbol completo de su lista de
> materiales, nivel a nivel. Ver [`components/nova/README.md`](../components/nova/README.md)
> para el sistema de diseño Nova y [`docs/compras.md`](compras.md) §6 para los
> patrones de UI compartidos (header, KPIs, tabla jerárquica) — no se repiten aquí.
> Origen: ClickUp `#869eq7vnp`.

---

## 1. Descripción general

Responde a "¿cuánto cuesta fabricar este producto terminado, y qué se ha usado para
hacerlo?" — coste A1 (F30026) + despiece recursivo de la lista de materiales (F3002,
planta `10999`).

**No es MRP** (`/mrp`, `docs/`), aunque comparten tabla base (F3002):

| | `/mrp` | `/costes` |
|---|---|---|
| Punto de partida | Previsión de venta (F3460), por mes | Todo artículo con lista de materiales propia |
| Explosión | Aplanada — solo el material final comprable, cantidades acumuladas | Árbol completo — cada nivel (11, 10...) es un nodo visible |
| Vigencia del BOM | La del mes de cada previsión | **Hoy** — foto del estado actual |
| Objetivo | Cuánto comprar de cada material | Coste y estructura de cada producto vendible |

**Acceso**: `requireScreenAccess('costes')`, entrada `costes` en `lib/panels.ts`
(público por defecto, restringible desde `/admin`). **Logging**: `query_logs`,
`source: 'coste_a1'` — el valor del log NO se renombró junto con la key de
permiso (no había ningún motivo funcional, y así no cambia el criterio de
filtrado de logs históricos); solo se actualizó la etiqueta legible en
`SOURCE_LABELS` (entonces en `app/admin/logs/page.tsx`, hoy en `components/nova/admin/logs-consultas.tsx`) de "Coste A1" a "Costes".

---

## 2. Archivos relevantes

| Archivo | Descripción |
|---|---|
| `app/costes/page.tsx` | Página cliente — KPIs, botón Exportar, layout a 2 columnas (tabla + panel de desglose), pide `startDate`/`endDate` a la API con el `monthRange` de los filtros |
| `app/api/costes/route.ts` | API Route — construye los árboles, resuelve coste teórico/descripción/familia, el coste real por artículo y mes (§3.4) y la producción real por final en el rango de fechas pedido (§3.3) |
| `components/nova/coste-a1-table.tsx` | Tabla jerárquica (columna izquierda, TanStack Table v8, `subRows` de profundidad variable) + buscador + filtro de familia + `MonthRangePicker`/"Filtrar" + orden por coste/nombre + selección del artículo que se ve en el panel de desglose |
| `components/nova/month-range-picker.tsx` | Selector de rango de meses (reutilizado tal cual de `/compras`) — usado aquí para pedir la producción real |
| `components/nova/coste-a1-desglose-panel.tsx` | Panel de desglose (columna derecha) — selector plano (`tabs-08`) con el artículo final + cada "11"/"10" del árbol completo por código, detalle (descripción/tipo/Coincide + lista de materiales) del nodo elegido (ver §4.2) |
| `components/nova/coste-a1-shared.tsx` | Helpers compartidos entre tabla y panel: formateo (`euros`), poda 11/12 (`podar1112`), comprobación de coste (`estadoLocal`, `estadoSubarbol`, `Descuadre` — ver §4.2.4), desviación real vs. teórico (`desviacionPct`, píldora `DesviacionBadge` — ver §3.4, §4.1, §4.2.1), agregación mensual multi-artículo para los gráficos (`serieCosteMensual`, `serieProduccionMensual`, `formatMesCorto` — ver §3.5) |
| `components/shadcn-space/blocks/chart-03/chart.tsx` | Bloque "Area Chart Gradient" de ShadcnSpace, editado en el sitio (mismo patrón que `chart-15` en `/compras`) — "Coste real vs. teórico por mes" (ver §3.5, §4.4) |
| `components/shadcn-space/blocks/chart-04/chart.tsx` | Bloque "Bar Chart" de ShadcnSpace, editado en el sitio — "Producción por mes" (ver §3.5, §4.4) |

---

## 3. Esquema Oracle/JDE

| Tabla | Uso |
|---|---|
| `F3002` | Lista de materiales (BOM). `IXCMCU`=planta (`10999`), `IXKITL`=padre, `IXLITM`=componente, `IXQNTY`÷10000=cantidad, `IXUM`=unidad, `IXEFFF`/`IXEFFT`=vigencia (evaluada a **hoy**, no por mes como en MRP) |
| `F30026` | Coste A1. `IELEDG='07'` (Coste Estándar), `IECOST='A1'` (tipo de coste), `IEMMCU=10999`, importe = `IECSL`÷10000 |
| `F4101` | Descripción (`IMDSC1`), familia (`IMSRP2`), **categoría/tipo real** (`IMSRP1`) y **obsoleto** (`IMSTKT = 'O'`, mismo campo que `/caducados`) — aquí se busca por **código largo** (`IMLITM`), no por el corto (`IMITM`) como en compras/MRP: evita el mapeo largo↔corto porque cada nodo del árbol puede ser un artículo distinto sin una previsión que traiga ya su código corto |
| `prodctl.f0005` | Catálogo UDC `41/S2` (familia) y `41/S1` (categoría/tipo) — descripción real, mismo patrón que compras/MRP |

### 3.1 Qué es un "artículo final" — no es simplemente "prefijo 12"

Un artículo tipo "12" (producto terminado) normalmente es el final de la cadena
(10 → 11 → 12), pero **puede reprocesarse**: un "12" ya fabricado a veces se consume
como componente de otro artículo (otro "11" o "12") para revenderlo transformado.
Confirmado en datos reales: de 256 artículos "12" con lista de materiales propia,
1 aparece también como componente de otra línea.

La regla de "esto es un final" combina DOS casos, no solo el estructural (corregido
tras revisar el ejemplo real con el usuario — la primera versión excluía por error
un "12" que normalmente se vende):

1. **Estructural**: tiene lista de materiales propia (`IXKITL`) y **nunca** aparece
   como componente (`IXLITM`) de ninguna otra línea, en la planta `10999`. Esto
   captura el final REAL de una cadena de reprocesado.
2. **Por categoría real**: un artículo cuya categoría (`F4101.IMSRP1`) es
   `12`/"PRODUCTO TERMINADO" y tiene lista de materiales propia se lista como final
   **siempre**, aunque también aparezca como componente de otra línea — el
   reprocesado es una salida OCASIONAL, no la única. Ejemplo real comprobado:
   `1210100242` se vende normalmente tal cual (su propia BOM: materiales +
   un "10", sin ningún "11"), pero a veces se consume como componente de
   `1110100295`, que a su vez lo consume `1110100296` (el final real de esa cadena
   de reprocesado, capturado por el caso 1). Sin el caso 2, `1210100242` quedaba
   excluido del informe por completo — solo se veía anidado dentro del despiece de
   `1110100296`, nunca por su cuenta.

Un mismo código puede así aparecer como final por sí mismo **y** anidado dentro del
despiece de otro final — no es un duplicado ni un bug, son dos hechos reales
distintos ("si se vende tal cual" / "si se reprocesa").

#### 3.1.1 `tipo` — de dónde sale de verdad (no es un guess por prefijo)

Primera versión de este panel: `tipo` (y la decisión de qué es "Terminado"/qué es
"Comercializado" en la regla de arriba) salía de adivinar por el **prefijo de 2
dígitos del código largo** (`10`→Semielaborado, `11`→Semiterminado, `12`→Terminado,
`99`→"Comercializado" inventado, cualquier otro→"Materia prima" por defecto).
Pregunta directa del usuario ("¿de dónde lo sacas? hay tablas para consultar, en
producción está el filtro") llevó a revisar `api/categories/route.ts`: el filtro
"Categoría" de `/produccion` ya usa el campo real, `F4101.IMSRP1`, catálogo UDC
`41/S1`. Comprobado con datos reales que el prefijo **no es fiable**:

- El catálogo real tiene **12 categorías**, no las 4-5 que se asumían: además de
  Semielaborado/Semiterminado/Terminado están Materia Prima, **Material Auxiliar**,
  Otros Consumibles, Servicios Exteriores, Varios Venta, Variedades Materia Prima,
  Portes y Servicios, Mejoras I+D, Proyectos I+D. No existe ninguna categoría real
  llamada "Comercializado" — era inventada.
- De 9 artículos con prefijo `99` usados en las listas de materiales de la planta,
  **8 tienen `IMSRP1='12'`** (PRODUCTO TERMINADO real) y solo 1 tiene `IMSRP1='99'`
  (PROYECTOS I+D) — el prefijo `99` no predice la categoría real en absoluto.
- Hay excepciones sueltas en otros prefijos también (algún `13`/`14` con `IMSRP1`
  distinto al prefijo).

Ahora `tipo` sale de `F4101.IMSRP1` resuelto contra el catálogo UDC `41/S1`
(`tipoDescMap` en `api/costes/route.ts`, mismo patrón que `familiaDescMap`,
con `capitalizarFrase()` porque el catálogo viene en MAYÚSCULAS — mismo caso que
familia, ver `docs/compras.md` §3.2). La
regla de "final por categoría" compara directamente contra el código `'12'`, no
contra una etiqueta de texto. Un artículo sin fila en F4101 (no debería pasar con
datos reales, pero por si acaso) cae en `"Sin categoría"`.

### 3.2 Corte de ciclos

`construir()` en `api/costes/route.ts` lleva un `Set` de visitados por rama — un
BOM real no debería tener ciclos, pero uno los colgaría la petición si no se corta
(mismo patrón que el `explode()` de `/api/mrp`).

### 3.3 Producción real por artículo final, en un rango de fechas

Pedido explícito: "hay que sacar un filtro por meses, y sacar la producción de
cada artículo padre, en ese rango, esto ya lo hacemos en el panel de producción,
de ahí sabrás qué campos de fechas usar". Mismas tablas que `/api/production`
(`F55TAR12` → `F4801` → `F4111`), pero simplificado: **solo para los finales**
(no para cada nodo del árbol), agregado directamente por artículo (no por
orden/turno/hora — no hace falta ese desglose aquí) y **sin** el filtro de
merma (`ILDCT='IS'`) — solo producción real, `ILDCT='IC'`.

| Tabla | Uso |
|---|---|
| `F55TAR12` | Tareas de producción — `TODOCO`=orden, `TO55TAREA`=fecha (formato custom, `MOD(TO55TAREA,100000)` compara solo año+día juliano, sin el prefijo de sub-línea). Deduplicado (`MAX(TO55TAREA) GROUP BY TODOCO, MOD(...)`) — mismo motivo que en `/api/production`: registros antiguos/nuevos pueden coexistir para la misma orden+fecha |
| `F4801` | Orden de fabricación — `WADOCO`=orden, `WAAITM`=artículo **LARGO** (mismo código que usa el resto de este panel, `F4101.IMLITM` — comprobado que son el mismo espacio de códigos), `WAITM`=artículo **CORTO** (para cruzar con F41002/F4101.IMUOM1) |
| `F4111` | Item Ledger — `ILDOC`=orden, `ILTRDJ`=fecha del movimiento, `ILDCT='IC'`=producción real, `ILTRQT`÷100=cantidad, `ILTRUM`=unidad del movimiento |
| `F41002` | Conversión de unidades — `UMITM`=artículo CORTO, `UMUM`→`UMRUM` con factor `UMCONV`÷10000000 |

**Cruce código largo↔corto**: los finales se identifican por código LARGO
(`IMLITM`, ver §3), pero F4801/F4111/F41002 trabajan con código CORTO
(`WAITM`/`IMITM`). La consulta de metadatos (paso G) ya pide `IMLITM` para
TODOS los códigos del árbol — se le añade `IMITM` a la misma consulta (gratis,
mismo viaje a Oracle) y solo se usa para los finales al cruzar con producción.

**Conversión de unidades — duplicada a propósito, no compartida.** Un mismo
artículo puede tener producción registrada en más de una UM (kg, unidades...)
dentro del rango — hace falta convertir todo a una unidad común (la primaria
del artículo, `F4101.IMUOM1`) antes de sumar, con la misma búsqueda BFS de
hasta 3 niveles que ya usa `/api/production` (`getConversionFactor`). Esa
lógica está **copiada**, no importada de un módulo compartido: `/api/production`
es "el endpoint más complejo" de la app (CLAUDE.md pide especial cuidado al
tocarlo) y esta consulta no necesitaba modificarlo para nada — la duplicación
(~35 líneas) es el precio de no arriesgar ese archivo.

**Rango de fechas**: `startDate`/`endDate` ('YYYY-MM-DD'), mismo formato y
mismo default (mes en curso) que `/api/compras`. El frontend nunca manda días
sueltos — el selector (`MonthRangePicker`, componente ya existente,
reutilizado tal cual de `/compras`) solo deja elegir MESES completos. La
conversión a formato JDE (`fechaAJdeProduccion()`) NO lleva el prefijo
`100000 +` que sí lleva `hoyJde()` (usado para la vigencia del BOM) — se
compara contra `MOD(TO55TAREA, 100000)`, que ya le quita ese mismo prefijo a
la fecha de producción, así que el rango tampoco debe llevarlo (si lo llevara,
la comparación nunca cuadraría).

`produccion` (número, en la unidad primaria del artículo) solo se rellena en
la raíz de `DespieceNode` — `undefined` en el resto del árbol, no se pide
desglose de producción por componente.

### 3.4 Coste real por artículo y mes (`F554105` + `F55CR001`)

Pedido explícito, tras confirmar en `/compras` de dónde sale el coste
presupuestado: "ahora hay que sacar el coste real de todos los artículos y
componentes". A diferencia de la producción (§3.3), que solo se pide para los
finales, el coste real se calcula para **todos los nodos del árbol** —
`DespieceNode.costeReal: number | null`.

**El coste real sale de las ÓRDENES DE FABRICACIÓN costeadas, no de una tabla
de costes por artículo.** Dos tablas encadenadas, las dos filtradas por el
ledger de coste real `'CR'`:

| Tabla | Qué es | Campos usados |
|---|---|---|
| `F554105` (`CLLEDG='CR'`) | Una fila **por palet_lote**, con el coste real de la orden a la que pertenece | `CLURAB` = orden, `CLURDT` = fecha de la orden (juliano `CYYDDD`), `CLSTOC`/10000 = cantidad producida en la orden, `CLITM` = artículo (código **corto**) |
| `F55CR001` (`CRLEDG='CR'`) | Desglose del coste real **de cada orden** por componente de coste | `CRDOCO` = orden, `CRCOST` = componente (se usa solo `A1`; existen además `X1`…`X9` y `CR`), `CRUNCS`/10000 = importe de TODA la orden para ese componente |

Reglas de cálculo, todas confirmadas con el usuario y verificadas a mano
contra datos reales antes de escribir una línea de código (artículo
`1210100178`, julio 2026):

1. **Deduplicar por orden.** `F554105` repite el mismo coste y la misma
   cantidad en cada palet de una misma orden — comprobado contando
   `COUNT(DISTINCT CLSTOC)` por orden, que da siempre 1. De ahí el `DISTINCT`
   sobre (artículo, orden, fecha, cantidad): sin él, una orden con 30 palets
   pesaría 30 veces.
2. **`CRUNCS` es el importe de la orden entera, no unitario.** El coste
   unitario es `(CRUNCS/10000) / cantidad_de_la_orden`, **redondeado a 4
   decimales**.
3. **Solo `CRCOST = 'A1'`** (Material). Es el mismo componente de coste que el
   teórico (§3.1, `F30026` con `IECOST='A1'`), así que las dos cifras comparan
   lo mismo y la desviación es de coste de material — no la diferencia entre
   "todo el coste" y "una parte", que es justo el error que tenía la primera
   versión de este panel (§3.4.1). Los demás componentes (`X1`…`X9`) quedan
   fuera, y `CR` también: es el total de la orden. **Ojo:** el A1 de un
   artículo todavía lleva dentro los X de sus componentes — ver «A1 limpio»
   más abajo, que es lo que realmente se devuelve como `costeReal`.
4. **Los componentes no tienen orden — se calculan aparte.** Todo lo que no
   se fabrica con orden propia (envases, etiquetas, materia prima) sale en
   `F554105` con `CLURAB = 0`, así que no hay nada que cruzar con `F55CR001`.
   Para esos, el coste unitario real **ya viene dado** en `CLUNCS`/10000 de la
   propia `F554105`, y es idéntico en todos los palet_lote del mismo día
   (verificado con `1312800005`, julio 2026: 3,90 € en los 14 días del mes).
   Ojo a la diferencia: en esas filas `CLSTOC` es la cantidad de **cada
   palet** (varía dentro del mismo día), no la de una orden repetida — el peso
   del día es la **suma** de los palets, no su máximo. Las dos vías (con orden
   y sin ella) se unen con un `UNION ALL` en la misma consulta y desde ahí se
   tratan igual.
5. **Media ponderada por la cantidad**, tanto para agregar las
   órdenes de un mes como para agregar los meses de un rango:
   `Σ(coste_unitario × cantidad) / Σ cantidad`. Como el peso es la cantidad de
   las MISMAS órdenes que dan el coste, ponderar por meses y luego entre meses
   da exactamente lo mismo que ponderar todas las órdenes del rango de una vez
   — el desglose mensual existe porque lo necesitan los gráficos (§3.5), no
   porque cambie la cifra.

**Cada nodo con SUS propias órdenes.** El coste real ya no se hereda del
artículo final: cada código del árbol que tenga órdenes de fabricación
propias (finales y semielaborados) tiene su propio coste real, y los que no
las tienen (todo lo comprado) se quedan en `costeReal: null` — que es la
respuesta correcta, no un hueco por rellenar. Eso elimina también el caso
"coste sin peso" de la versión anterior: coste y peso salen de la misma fila,
así que no puede haber uno sin el otro, y desaparece el fallback a media
simple que había para ese borde.

**No hay nada que configurar a mano.** La versión anterior necesitaba un
mapeo mes→ledger mantenido desde `/admin`; con esta fuente el mes sale de la
fecha de la orden (`CLURDT`) y no hace falta ninguna tabla auxiliar.

**Sin filtro de planta, a propósito**: a diferencia del coste teórico (§3.1)
y del BOM, que van fijados a la planta `10999`, el coste real se calcula con
las órdenes de **todas las plantas** — confirmado explícitamente con el
usuario. El coste real de un artículo es lo que ha costado fabricarlo, se
fabricara donde se fabricara; partirlo por planta daría un coste distinto del
que maneja la empresa. No añadir `CLMCU` a esta consulta pensando que falta.

**A1 limpio — `costeReal` es el A1 menos los X que arrastran los componentes.**
JDE mete el coste **total** (A1 + X) de un semielaborado como material de su
padre, de modo que el A1 real de un artículo incluye el coste de
transformación (`X1`…`X9`) de todos los componentes que se fabrican con orden.
Para comparar material con material, el `costeReal` que devuelve la API es:

```
costeReal(n)  = A1real(n) − Xarrastrado(n)
Xarrastrado(n) = Σ hijos c de n [ cantidad_c × ( Xreal(c) + Xarrastrado(c) ) ]
```

- **Todos los niveles**, no solo los hijos directos (el A1 de un hijo ya lleva
  los X de sus propios hijos). `cantidad_c` es la del BOM por unidad del padre,
  **sin redondear** (se usa el `RawNode`, no el `DespieceNode`, que va a 3
  decimales).
- `Xreal(c)` es la media ponderada por cantidad de la suma de `CRCOST` ≠ `A1`,
  ≠ `CR` de las órdenes de `c` en el mismo periodo (mes o rango). Sale de la
  misma consulta que el A1 (`SUM(CASE WHEN …)`), sin consultas nuevas.
- Los X del **propio** artículo no se restan: no están en su A1.
- Un componente sin órdenes en el periodo (comprado, o fabricado sin
  producción ese mes) aporta X = 0. Los de la rama `CLURAB = 0` tampoco tienen
  desglose por componente, así que no restan nada.
- Una orden sin fila `A1` en `F55CR001` se sigue descartando (igual que antes
  de este cambio): el `HAVING COUNT(… 'A1' …) > 0` conserva ese criterio.
- Se calcula en cada nodo con SUS órdenes y también por mes
  (`costeRealPorMes`), así que gráficos y KPI (§3.5, §3.6) usan el A1 limpio.
  La ponderación (`cantidad`) no cambia.
- No se trunca a 0: si el resultado saliera negativo se muestra tal cual, para
  que un dato raro se vea y no se oculte.
- Se contrastó con una consulta recursiva sobre `F3002` + `F554105` +
  `F55CR001` (artículo `1210100222`, septiembre 2026) antes de implementarlo;
  es la misma lógica que `xArrastrado()` en `app/api/costes/route.ts`.

**Desviación** (`desviacionPct()`, `coste-a1-shared.tsx`): `(costeReal −
costeA1) / costeA1 × 100`. Positivo = el coste real sale más caro que el
estándar declarado (rojo); negativo o cero, verde. `null` si falta cualquiera
de los dos datos o si `costeA1` es `0`.

#### 3.4.1 Historia de la fuente del coste real (dos intentos fallidos)

No es anécdota: las dos versiones anteriores llegaron a producción y ninguna
daba un dato utilizable. Queda escrito para que nadie vuelva a proponerlas.

1. **`F4105.COUNCS`** (primera versión). Es el coste unitario TOTAL del ledger
   — Material + Mano de obra + Gastos generales + Amortización — comparado
   contra un `costeA1` que es solo el componente Material. La "desviación" era
   en su mayor parte la diferencia entre "todo el coste" y "una parte del
   coste", no una desviación real. Se verificó al detalle y cuadraba hasta el
   último decimal… midiendo lo que no era.
2. **`F30026` con un `IELEDG` distinto por mes** (segunda versión). Misma
   tabla y mismo componente `A1` que el teórico, cambiando solo el ledger,
   con el mapeo mes→ledger en SQLite (`coste_a1_coledg_mensual`) y editable
   en `/admin` → "Coste real (Costes)". **Nunca llegó a devolver un dato**:
   esos ledgers mensuales no existen en `F30026` (los códigos que se
   configuraron —`6M`…`6Q`— salieron de `F4105.COLEDG`, que es otra serie), así
   que el coste real salía `null` para todos los artículos. Se achacó a la BD
   de pruebas; al comprobarlo contra producción, tampoco.

Con la versión actual se eliminaron: la tabla `coste_a1_coledg_mensual` (el
`CREATE TABLE` sale de `lib/sqlite.ts`; **no** se hace `DROP`, la tabla queda
huérfana y sin uso en las instalaciones ya desplegadas), las rutas
`app/api/admin/coste-a1-coledg/`, la pestaña "Coste real (Costes)" de
`/admin` y el campo `meta.mesesSinConfigurar` de la respuesta de la API.

### 3.5 Gráficos mensuales — agregado de VARIOS artículos, no de uno solo

Pedido explícito: dos gráficos arriba de la tabla — "Coste real vs. teórico"
(área con gradiente) y "Producción" (barras), los dos por mes. A diferencia
de todo lo anterior (§3.4, la tabla), que calcula el coste real de UN
artículo, estos gráficos combinan TODOS los artículos finales que en ese
momento pasan los filtros de la tabla (búsqueda + familia — confirmado
explícitamente con el usuario, no el conjunto completo sin filtrar) en un
único punto por mes.

**Por eso hacen falta dos campos nuevos en `DespieceNode`, solo en la raíz**
(mismo alcance que `produccion`): `produccionPorMes` y `costeRealPorMes`
(`app/api/costes/route.ts`) — el desglose mes a mes de cada artículo por
separado. El único agregado que ya calculaba la API (`costeReal`, §3.4) es la
media ponderada de TODO el rango para UN artículo; el gráfico necesita el
detalle sin agregar de cada mes para poder combinar varios artículos él
mismo, en el cliente (`serieCosteMensual()`/`serieProduccionMensual()`,
`coste-a1-shared.tsx`, sobre `filtros.filtered` en `app/costes/page.tsx`).
`costeRealPorMes[i]` trae el coste de ESE mes (ya ponderado entre las órdenes
del mes, §3.4) y `cantidad`, la producción de esas órdenes — que es el peso
con el que `serieCosteMensual()` combina varios artículos en un punto.

**Fórmula, para cada mes `M`, sobre los finales filtrados `i = 1..N`:**

- **Producción**: el gráfico de barras de producción por mes se ELIMINÓ (ver
  §4.4) — su hueco lo ocupa ahora "Top artículos por impacto". La producción
  sigue en el KPI "Producción total" y en la columna de la tabla, y la API
  sigue devolviendo `produccionPorMes` (dato correcto ya calculado) aunque de
  momento no lo consuma nadie.
- **Real**: `Σ (costeReal_i,M × cantidad_i,M) / Σ cantidad_i,M` — cada
  artículo pesa según cuánto se produjo de ÉL ese mes. El peso es la cantidad
  de las órdenes costeadas (`costeRealPorMes[].cantidad`), **no** la
  producción de F4111 (`produccionPorMes`, la de las barras): coste y peso
  tienen que salir de la misma fuente, si no un mes puede tener coste y peso
  `0` a la vez.
- **Teórico**: `Σ (costeA1_i × cantidad_i,M) / Σ cantidad_i,M` — **también
  ponderado**, aunque el coste A1 de cada artículo nunca cambia. Confirmado
  explícitamente con el usuario ("¿aunque sea teórico lo harías ponderado
  también?" → sí): es la misma lógica que una varianza de precio vs. volumen
  en control de costes — si el Teórico fuera media simple y el Real
  ponderado, la distancia entre las dos líneas mezclaría dos efectos
  distintos (desviación real de coste + cambio de mix de producción) en vez
  de aislar solo el primero. El resultado sí varía de un mes a otro pese a
  que ningún artículo cambia de coste — varía el PESO de cada uno, no su
  valor (ver también nota siguiente).

**Misma población en las dos series, mes a mes**: si a un artículo le falta
el coste real de un mes (ninguna orden costeada ese mes), NO cuenta tampoco
en el Teórico de ese mes, aunque sí tenga
coste A1 — para que Real y Teórico sean comparables punto a punto sobre
exactamente los mismos artículos, y la diferencia entre las dos líneas sea
solo desviación de coste, nunca un artefacto de comparar conjuntos distintos.
`Producción` (barras) no tiene esta restricción — sí incluye a todos los
finales filtrados con producción ese mes, tengan o no coste real.

**La tabla no cambia nada de esto** — cada fila sigue siendo un único
artículo: su Teórico es siempre el valor fijo de F30026 (nunca una media), y
su Real (si el rango es de varios meses) ya viene ponderado por SUS PROPIAS
órdenes (§3.4) — no por el peso de otros artículos. Son dos
cálculos que conviven sin tocarse: tabla = coste por artículo, gráfico =
coste medio de la cartera filtrada por mes.

### 3.6 KPI — renovados junto con el coste real, mismo alcance que los gráficos

Los 4 KPI originales (Artículos finales / Coste A1 medio / Sin coste A1 /
Artículos en los árboles, `Statistics` en `app/costes/page.tsx`) describían
la foto ESTÁTICA del catálogo (BOM) — tenían sentido antes de que existiera el
coste real, pero dejaron de ser lo más útil de un vistazo una vez ese pasó a
ser el foco del panel. Pedido explícito ("qué KPI pondrías más útiles"):
sustituidos por otros 4, con el MISMO alcance que los gráficos de §3.5
(`filtros.filtered` — los artículos que pasan búsqueda/familia en cada
momento, no el dataset sin filtrar) para que KPI, gráficos y tabla cuenten
siempre la misma historia. Una ronda posterior ("el de artículos con coste
real y el de artículos finales no los veo muy útiles para la directora
financiera") sustituyó el de coste real por un KPI en euros y eliminó
directamente el de artículos finales, dejando los 3 actuales (`columns={3}`
en `<Statistics>`, antes `columns={4}`):

1. **Desviación media (real vs. teórico)** — el dato que faltaba: media
   ponderada por la cantidad costeada, MISMA regla de "misma población" que
   `serieCosteMensual()` (§3.5) pero sobre el rango completo en vez de mes a
   mes — usa `costeReal`/`costeA1` ya agregados de cada artículo (§3.4) y,
   como peso, `Σ costeRealPorMes[].cantidad` (helper `cantidadCosteada()` en
   `app/costes/page.tsx`), no `produccion`. Solo entran los artículos con
   coste real Y cantidad costeada > 0 en el rango. `—` si ninguno cumple las
   dos condiciones.
2. **Impacto de la desviación** (€) — `sumaRealPonderado - sumaTeoricoPonderado`
   sobre la MISMA población y con el MISMO peso que el KPI 1 (la cantidad de
   las órdenes costeadas — es decir, el € es "sobre lo que realmente se
   costeó", no sobre la producción de F4111) — traduce el % de desviación a dinero real (sobrecoste si es
   positivo, ahorro si es negativo). Sustituye a "Artículos con coste real"
   (`X / Y`, contador de cobertura de dato): pedido explícito de la directora
   financiera ("no los veo muy útiles para la directora financiera") —
   un contador de catálogo no dice cuánto dinero está en juego, el impacto en
   € sí.
3. **Producción total** — suma de producción de los artículos filtrados en el
   rango — da escala al resto (una desviación del 20% sobre 40M unidades no
   es lo mismo que sobre 40).

**Artículos finales** (`X de Y en total`, filtrados/sin filtrar) se eliminó
por completo en la misma ronda — mismo motivo que "Artículos con coste real":
un contador de catálogo no aporta valor financiero. `visibles.length` y
`data.meta.totalFinales` se siguen usando en otros cálculos del componente
(la cabecera de filtros, por ejemplo), pero ya no como KPI propio.

**Color según el signo** — pedido explícito ("¿puedes poner los KPI con
color? Rojo o verde según el dato"): el valor de **Desviación media** e
**Impacto de la desviación** cambia de color según su signo, con los MISMOS
tokens que ya usa `DesviacionBadge`/`Descuadre` (`coste-a1-shared.tsx`) —
positivo = sobrecoste, rojo (`var(--color-destructive)`); negativo = ahorro,
verde (`var(--color-success)`). Exactamente 0 o sin dato (`—`) se queda en el
color neutro de siempre. Implementado como un nuevo prop opcional `tone?:
"destructive" | "success"` en `Statistics` (`components/shadcn-space/blocks/
statistics-04/statistics.tsx`) que colorea el `<p>` del valor — no se tocó el
componente para el resto de paneles que también usan `<Statistics>` (p.ej.
`/compras`), que simplemente no pasan `tone` y se quedan en el color neutro
de antes. **Producción total** no lleva `tone` — no es un signo de
desviación, no tiene sentido colorearlo.

Verificado con datos reales (`agent-browser`, enero-mayo 2026): "+42,2 %" de
desviación media, coherente con los ejemplos de §3.4/§3.5 comprobados a mano.

---

## 4. UI

### 4.0 Layout a 2 columnas (tabla + panel de desglose)

El panel ya no es una única tabla a ancho completo con un modal aparte — desde el
rediseño pedido explícitamente por el usuario ("que sea la tabla a la izquierda y a
la derecha el desglose, parecido al panel de compras"), `app/costes/page.tsx` monta
un `grid lg:grid-cols-3` (mismo patrón que `/compras`: `Charts15`/`DeviationByFamilyChart`)
con la tabla en `lg:col-span-2` y el panel de desglose en `lg:col-span-1`.

**Ancho y filtros, igual que `/compras`** (segunda ronda de feedback, tras ver la
primera versión): el `<main>` usa `max-w-7xl`, el mismo que el resto de paneles —
la primera versión de este layout usaba `max-w-[100rem]` para que las 5 columnas de
la tabla cupieran sin scroll horizontal, pero eso rompía la coherencia de ancho con
el resto de la app; se volvió a `max-w-7xl` y en su lugar la tabla soporta scroll
horizontal (ver §4.1). Los filtros (buscador, familia, obsoletos) ya no viven dentro
de la tabla — pedido explícito ("quiero que los filtros estén arriba de los KPI") —
sino en la misma barra que Exportar, **antes** de las tarjetas KPI, igual que
`/compras` (`MonthRangePicker`/`Filtrar`/`Tabs` de unidad, todo antes de
`Statistics`). No hay un botón "Recalcular" aparte — existió en versiones
anteriores del panel, pero hacía exactamente lo mismo que "Filtrar" (los dos
llamaban a `fetchData()` sin argumentos); pedido explícito, se quitó por
redundante. El estado de los filtros vive en un hook compartido,
`useCosteA1Filters(data)` (`coste-a1-table.tsx`), porque lo consumen dos sitios
distintos: la barra de arriba (`CosteA1FilterBar`) y la tabla, más abajo — sin el
hook, cada uno tendría su propia copia del estado y se desincronizarían.

**Las dos tarjetas van alineadas** (pedido explícito: "que los dos componentes estén
alineados") — mismo `Card` `p-0` + `CardHeader` (`border-b`, `px-6 pt-6`, título
`text-lg font-medium` + un párrafo de descripción debajo) en `CosteA1Table` y en
`CosteA1DesglosePanel`, calcado del patrón de `hierarchical-table.tsx` (compras):
título + descripción de qué muestra la tarjeta. Al estar en la misma fila del grid y
compartir la misma cabecera, las dos tarjetas se leen como un mismo sistema, no dos
estilos distintos uno al lado del otro.

Selección: un clic en una fila **raíz** (artículo final) de la tabla la selecciona
como artículo activo del panel de desglose (`selectedCodigo` en `page.tsx`, por
defecto el primero al cargar o tras pulsar Filtrar). El mismo clic también
pliega/despliega sus `subRows` en la tabla — no hay un botón dedicado ni una acción
separada.

**Bug real corregido — el primero por defecto podía ser un obsoleto que la
tabla ni mostraba.** Reportado directamente: "la primera vez que cargas en el
componente del desglose sale uno obsoleto, que no está ni en la tabla". Causa:
el `useEffect` que elige el artículo por defecto usaba `json.finales[0]`
DENTRO de `fetchData` — el orden CRUDO que devuelve la API (ordenado solo por
`costeA1` descendente), sin pasar por ninguno de los filtros que sí aplica la
tabla (búsqueda, familia, ni la regla de §4.1.1 — un obsoleto solo se ve si
tuvo producción en el rango). Si el artículo con el `costeA1` más alto era un
obsoleto sin producción en el rango por defecto (mes en curso), salía
seleccionado en el panel de desglose sin estar en ninguna fila de la tabla.
Arreglo: la selección por defecto vive en su propio `useEffect` (`[data,
filtros.treeData]`, en vez de dentro de `fetchData`) y elige de
`filtros.treeData` — la misma lista, ya podada/filtrada/ordenada, que
realmente pinta la tabla — en vez de `data.finales` sin tocar. De paso,
corrige también el caso interactivo: si el artículo seleccionado deja de
cumplir un filtro nuevo (búsqueda, familia) sin pasar por un `Filtrar`, el
panel cambia a mostrar el primero que SÍ siga visible, en vez de quedarse
enseñando algo que la tabla ya no lista.

### 4.1 Informe (tabla principal) — solo 11/12

El usuario pidió explícitamente que el informe no enseñe más que artículos tipo
"11"/"12" — nada de envases/etiquetas/materia prima (10, 13, 14...) ni "10". La tabla
principal usa `podar1112()` (`coste-a1-table.tsx`): copia el árbol de cada final
filtrando recursivamente sus `children` a solo `tipoCod === "11" || tipoCod ===
"12"`. Es una poda **por tipo, no por profundidad** — una cadena `12 → 11 → 11` se ve
entera; en cuanto un nodo no es 11/12 se corta ahí (y con él, todo lo que cuelgue
debajo, aunque más abajo hubiera otro 11 — no se espera ese caso en la práctica,
pero si apareciera quedaría oculto del informe a propósito).

**Compara por `tipoCod` (código crudo de `F4101.IMSRP1`), nunca por el texto de
`tipo`** — bug real: cuando `tipo` pasó a resolverse contra el catálogo UDC `41/S1`
(§3.1.1), el texto real es "Producto terminado"/"Producto semiterminado" (con
"Producto" delante), no "Terminado"/"Semiterminado" como antes por prefijo —
`podar1112()` comparaba contra esas cadenas literales y dejó de encontrar
coincidencias de la noche a la mañana: el informe se quedó sin nada desplegable.
`tipoCod` existe justo para esto — la lógica no debe depender de un texto que sale
de un catálogo y puede cambiar de redacción.

Tabla jerárquica con `subRows` de **profundidad variable** (no fija como los 3
niveles de compras o los 2 de MRP) — la API ya devuelve el árbol completo anidado,
`coste-a1-table.tsx` solo traduce la forma (podada) a `TreeRow`. Fila completa
clicable para desplegar (mismo patrón que `hierarchical-table.tsx` y
`mrp-materials-table.tsx`), con las 5 cabeceras ordenables (Artículo, Coste
Teórico, Producción, Coste Real, Desviación — pedido explícito: al principio
solo Coste Teórico lo era) siguiendo el patrón real de ShadcnSpace
(`datatable-03`: `onClick`/`cursor-pointer` en la propia `<TableHead>`, sin
`<button>` envolviendo el contenido).

**Orden por columna — `SORT_POR_COLUMNA` (`coste-a1-table.tsx`)**: mapa
`id de columna TanStack -> criterio de SortBy` (`concepto` → `"nombre"`, el
resto comparte literalmente el id) — un único sitio que decide a la vez qué
cabeceras son clicables y qué le pasan a `toggleSort()`. Dirección por
defecto al cambiar de columna: ascendente solo para "Artículo" (alfabético),
descendente para las 4 numéricas (mostrar primero lo más caro/producido/
desviado tiene más sentido que empezar por lo más pequeño o por `0`).

**`null`/`undefined` ("—" en la tabla) siempre al final, sea cual sea la
dirección** (`compararConNulos()`) — Producción y Desviación pueden faltar
(artículo sin producción en el rango, o sin coste real con el que calcular la
desviación); dejarlos participar en la comparación normal los mezclaría con
valores reales de forma inconsistente según asc/desc pulsado. Solo se ordena
el nivel RAÍZ (ver nota ya existente sobre `getSortedRowModel` de TanStack,
más abajo) — el criterio se aplica igual sea cual sea la columna.

**Coste Real es la excepción — pedido explícito: "que el vacío se tome como 0
para que salga de los primeros si ordenan de menor a mayor".** A diferencia
de Producción/Desviación (siempre al final), un "—" en Coste Real se compara
como si fuera `0` (`(a.costeReal ?? 0) - (b.costeReal ?? 0)`, sin pasar por
`compararConNulos()`) — con costes siempre ≥ 0, eso lo deja entre los
primeros al ordenar ascendente (junto a los artículos que de verdad cuestan
`0`) y entre los últimos al ordenar descendente, en vez de fijo al final pase
lo que pase. Verificado con datos reales (`agent-browser`, enero-mayo 2026):
ascendente, el primer artículo con Coste Real `—` (`TOR CC HC2,6 CORE SB TP
500g`) aparece antes que uno con coste real `0,426 €`.

Columnas: **Artículo** (código+descripción, badge de tipo, badge "Obsoleto" si
aplica) · **Coste Teórico** (el coste A1 de siempre) · **Producción** · **Coste
Real** · **Desviación**. La columna Familia y el botón "Ver despiece completo" de
versiones anteriores de este documento ya no existen — la familia se puede filtrar
desde el desplegable de la barra de herramientas, y el desglose se abre por
selección de fila (§4.0), no por botón.

**Producción, Coste Real y Desviación son datos reales** — Producción, ver
§3.3; Coste Real (media ponderada de `F30026` por producción mensual) y
Desviación (frente al Coste Teórico), ver §3.4. Los tres empezaron como
placeholders ficticios en versiones anteriores de este panel — el aviso de
texto gris bajo la barra de herramientas que lo advertía se quitó al dejar de
serlo.

**Con scroll interno (`ScrollArea`)**: al contrario que el resto de tablas de la app
(compras, MRP, que dejan crecer la página entera), esta tabla va envuelta en el
`ScrollArea` de ShadcnSpace (`scroll-area-01` — "Custom File Explorer", instalado con
`bunx --bun shadcn@latest add @shadcn-space/scroll-area-01`) con una altura fija
(`h-[32rem]`), cabecera `sticky` (de verdad fija al hacer scroll vertical — pedido
explícito, "que lo que es cada columna se quede fijo al deslizar") y scroll
horizontal (con `max-w-7xl`, las 5 columnas no caben siempre — ver §4.0). Decisión de
alto fijo distinta a la tomada en su día para el Dialog de verificación (§4.2.2,
"tamaño fijo" rechazado ahí) — aquí sí se pidió explícitamente ("que la tabla no baje
hasta abajo, que sea un componente con Scroll Area"), porque ahora convive con el
panel de desglose al lado y una tabla que empujara la página hacia abajo descolocaría
esa columna.

**`px-3` en `TableHead`/`TableCell`, no `px-4`** — pedido explícito tras añadir la
producción real (§3.3): con el `0` fijo de antes, las 5 columnas cabían casi
siempre sin deslizar; con números reales de hasta 6 cifras en Producción (p. ej.
"37.506", visto filtrando enero-septiembre 2026, con algún obsoleto incluido por
tener producción en el rango) la tabla se quedaba un poco más ancha que el
contenedor, cortando la columna Desviación por el borde derecho. Mismo ajuste
(menos margen interno, no menos columnas) que ya se hizo en el panel de
desglose por el mismo motivo — ver §4.2.1bis.

**Columna Artículo — bug real corregido: descripción larga + "Obsoleto" no
cabían.** Reportado explícito: "si la descripción es larga y es obsoleto, no
encajan los datos bien, no caben". Causa: ni el texto de la descripción ni
sus contenedores llevaban `truncate`/`min-w-0` — con `table-layout: auto`
(por defecto, sin `<colgroup>` ni anchos fijos en esta tabla), la columna
Artículo se dimensiona en TODAS las filas al ancho de su contenido más
largo; una descripción larga sin tope, más la badge "Obsoleto" al lado (que
nunca envuelve de línea, solo `gap-2` en fila), estiraban esa columna mucho
más de lo razonable — no solo para esa fila, para la tabla entera. Arreglo:
`min-w-0` en toda la cadena de contenedores flex de la celda (imprescindible
— sin él, un hijo flex nunca se encoge por debajo del ancho de su contenido,
así que `truncate` no tiene efecto ninguno) + `max-w-[13rem] truncate` en el
propio texto de la descripción (con `title` para ver el texto completo al
pasar el ratón) + `shrink-0` en la badge y en el icono de aviso para que no
pierdan tamaño. Verificado con datos reales (`agent-browser`,
`TORT CEB CARAME 500g TP ALDI`, obsoleto, enero-mayo 2026): la descripción
se corta con "…", la badge y el icono quedan pegados justo después, y las 4
columnas numéricas siguen cabiendo sin desbordar.

**Cabeceras acortadas ("Teórico"/"Real"/"Desv."), bug real corregido en
ventanas estrechas.** Reportado tras el arreglo anterior: "ahora se ve bien
encajado pero abajo se ve como la barra de desplazamiento". Con el texto
truncado ya no era la descripción la que desbordaba — era el propio TEXTO de
las cabeceras ("Coste Teórico", "Coste Real"), más ancho que casi cualquier
valor real de esas columnas. Comprobado con `agent-browser` variando el
ancho de ventana (`set viewport`): a partir de ~1024px (el breakpoint `lg`
de Tailwind, donde `app/costes/page.tsx` pasa la tabla de ancho completo a
solo 2/3 del grid) la tabla dejaba de caber por 65px — se veía la barra de
scroll horizontal (`[data-slot="scroll-area-scrollbar"][data-orientation=
"horizontal"]`) incluso con una sola fila de datos, un rectángulo gris vacío
sin motivo aparente para quien no supiera que dos columnas apenas no cabían.
Arreglo: "Coste Teórico" → "Teórico", "Coste Real" → "Real", "Desviación" →
"Desv." — los mismos nombres cortos que ya usa el panel de desglose
("Teórico X € · Real Y € · Desv. Z %"), más consistente entre los dos
componentes, no solo más corto. Verificado con `agent-browser`: a 1024px de
ancho, `diferencia` (scrollWidth − clientWidth del viewport de la tabla)
pasa de 65px a 0, sin barra de scroll horizontal.

**Columna Desviación — píldora con fondo en TODAS las filas.** Pedido
explícito, primera ronda: "quiero que en el desglose de componentes salga el
porcentaje con fondo, como en la foto, y en la tabla también, pero solo en
los padre/raíz" — implementado así (píldora solo si `row.original.esRaiz`,
texto suelto en color para las subfilas). **Revertido en la ronda
siguiente, pedido explícito: "en la tabla de coste por artículos, ponle al
final a todos el fondo en la desviación"** — la celda de la columna
`desviacion` ya no distingue `esRaiz`, todas las filas (artículo final Y
componentes al expandir el árbol) usan `DesviacionBadge` (`coste-a1-shared.tsx`
— misma píldora que `Descuadre`, `rounded-full px-2 py-0.5`, `bg-color/10
text-color`, rojo si `pct > 0`, verde si no). Ver también §4.2.1 para el
mismo componente en `FilaHoja` del panel de desglose.

**Diseño de la cabecera fija, calcado de `scroll-area-01`**: pedido explícito tras
ver la primera versión ("que sea igual de diseño la tabla que has hecho ahora" —
refiriéndose al componente de referencia `scroll-area-01`, "Custom File Explorer",
de ShadcnSpace). La primera versión usaba una fila de cabecera con fondo sólido
`bg-muted/95` — un bloque gris opaco que, justo encima de una fila raíz (blanca por
diseño, sin tinte), se veía como un salto de color brusco ("una franja blanca
encima"). Ahora la cabecera usa el mismo estilo que la barra flotante del
componente de referencia: `bg-background/90` + `backdrop-blur-sm` (translúcida, dejar
entrever el contenido al desplazar, no un bloque opaco), un único `border-b`, texto
`text-xs uppercase tracking-wide` en vez del texto normal de una `<TableHead>` — se
lee como una etiqueta flotante fina, no como un bloque de tabla pesado.

**Hover, bordes y colores, calcados de `hierarchical-table.tsx` (compras)** — pedido
explícito, en dos rondas ("que sea el mismo hover y colores que en la tabla de
compras" y después "quiero que se parezca mucho la tabla"):
- Filas sin ningún tinte de fondo propio (se quitó el `bg-muted/20` que llevaban las
  subfilas) — solo el `hover:bg-muted/50` y `has-aria-expanded:bg-muted/50` que ya
  trae `<TableRow>` por defecto (`ui/table.tsx`). Para que `has-aria-expanded` se
  dispare hace falta un descendiente con `aria-expanded` — compras lo pone en el
  botón que abre/cierra la fila; aquí, al no haber un `<button>` dedicado (toda la
  fila es clicable), se puso en el `<span>` que envuelve el chevron.
- Borde de fila `border-border/60` (más suave que el borde por defecto) en vez de
  sin especificar, y alto `h-12` explícito en la fila (no solo en las celdas) —
  igual que compras.
- Cabecera de columnas con el mismo color que compras (`bg-muted/40` por celda,
  texto normal `text-muted-foreground`, sin versalitas) en vez del estilo
  traslúcido/con blur de la ronda anterior (pensado para imitar `scroll-area-01`) —
  sigue llevando `sticky`/`backdrop-blur-sm` porque esta tabla, a diferencia de la
  de compras, tiene scroll interno (pedido explícito, ver más arriba), pero con los
  MISMOS colores que compras en vez de un estilo distinto.
- El separador entre la cabecera de la tarjeta (título + descripción) y la tabla es
  ahora `border-t border-border` en `CardContent` — igual mecanismo que compras, en
  vez del `border-b` en `CardHeader` de la primera versión. El panel de desglose
  (`coste-a1-desglose-panel.tsx`) se actualizó igual, para que las dos tarjetas
  seguidas se vean calcadas la una de la otra.

La única fila con un tinte propio es la **seleccionada** (concepto que no existe en
compras — el artículo activo del panel de desglose): un fondo muy suave
(`bg-primary/[0.06]`), **sin contorno** — la primera versión llevaba además un
`outline` en color primario (rojo de marca) que, al desplegar una fila (seleccionar
y desplegar van juntos, mismo clic), se veía como un "borde oscuro" marcado
(reportado directamente por el usuario). Se quitó por dos motivos: se veía pesado, y
ese mismo rojo ya significa "problema/descuadre" en esta misma tabla (`CircleAlert`,
`Descuadre`) — usarlo también para "esta es la fila seleccionada" mezclaba dos
significados distintos bajo un mismo color.

**Sin descripción larga ni badge de tipo — pedido explícito ("no tiene que tener
tanta descripción", "quita lo de producto terminado o semiterminado para que quepa
la desviación")**: el párrafo bajo el título se acortó a una sola línea en las dos
tarjetas (tabla y panel de desglose). El badge de tipo (`Producto terminado`/
`Producto semiterminado`) se quitó de la columna Artículo del informe — sin él, las
5 columnas caben sin scroll horizontal en la mayoría de los casos (antes hacía
falta desplazar para ver Desviación). El tipo se sigue viendo en el panel de la
derecha (Desglose y Comparación), donde sí hay sitio.

**Bug real corregido — la cabecera `sticky` no se pegaba a nada**: la primera versión
ponía el `<Table>` compartido (`components/nova/ui/table.tsx`) directamente dentro
del `ScrollArea`. Ese componente envuelve siempre su `<table>` en un `<div
data-slot="table-container" className="overflow-x-auto">` propio — y anidar un div
con `overflow-x-auto` dentro del *Viewport* de `ScrollArea` activa la regla de
interdependencia de `overflow` de CSS (un eje con overflow distinto de `visible`
fuerza el otro eje también a `auto`), así que ese div pasa a ser su propio
contenedor con scroll en ambos ejes — y como su contenido nunca necesita
desplazarse dentro de ÉL MISMO (todo cabe en su alto natural; quien de verdad se
desplaza es el `ScrollArea` por fuera), `position: sticky` en la cabecera se
"pegaba" a un contenedor que nunca se mueve, en vez de al `Viewport` real que el
usuario desplaza — visualmente, la cabecera scrolleaba con todo lo demás como si no
tuviera `sticky`. Comprobado con `agent-browser` (captura a mitad de scroll: la
cabecera desaparecía). Arreglo: en este archivo, en vez del componente `<Table>`, se
usa un `<table>` suelto (mismas clases) directamente dentro del `ScrollArea`
(`orientation="both"`, prop añadida a `components/nova/ui/scroll-area.tsx` para
poder pedir scrollbar horizontal además de la vertical por defecto) — un único
contenedor con scroll, sin anidar, cabecera `sticky` ya funcional en ambas
direcciones. No se tocó `ui/table.tsx` en sí (se usa tal cual en el resto de la app,
donde nunca convive con un `ScrollArea` propio).

**Orden**: solo se reordena el nivel RAÍZ (los artículos finales), nunca con
`getSortedRowModel` de TanStack — eso también reordenaría los hijos de cada árbol,
descolocando el orden por cantidad descendente que ya viene calculado desde la API
(mismo cuidado que el orden manual de `mrp-materials-table.tsx` con los meses).

**Bug real corregido — un 500 de la API dejaba la página rota, no un error
legible.** Visto en directo con un corte real de conexión a Oracle (`NJS-500:
connection to Oracle Database was closed or broken`, `ECONNRESET`): la
página no comprobaba `res.ok` antes de leer `json.finales.length` en
`fetchData()` (`app/costes/page.tsx`) — con una respuesta 500
(`{ error: '...' }`, sin `finales`), eso lanzaba `Cannot read properties of
undefined (reading 'length')` sin capturar, dejando la página en blanco.
Arreglo: `if (!res.ok) throw new Error(...)` antes de tocar `json` — cae en
el mismo `catch` que ya mostraba el toast de error, en vez de romper el
render.

**Vigencia del BOM/coste, sin selector de fecha**: la lista de materiales y el
coste A1 siguen siendo una foto del estado vigente **hoy** — a diferencia de
compras/MRP, no dependen de ningún rango. El rango de fechas que sí existe
(`MonthRangePicker`, ver §4.1.1 y §3.3) es solo para la producción real y para
decidir qué obsoletos se ven — no recalcula el árbol ni el coste. El único
control para recargar TODO (árbol, costes, producción) es el botón
"Filtrar" (ver §4.0 — no hay un botón "Recalcular" aparte, se quitó por
redundante).

**Icono de carga del botón "Filtrar" — intento de arreglo del bamboleo,
PROBADO Y REVERTIDO por regresión real.** Reportado: "gira pero se mueve de
arriba abajo un poco". El icono (`Loader2` de lucide-react, `animate-spin`
de Tailwind) es tan pequeño (14px) que Chromium en Windows con escalado de
pantalla no siempre le asigna su propia capa de composición — sin ella, cada
frame de la rotación se repinta en la capa normal, y el redondeo a píxel
entero de esa transformación se percibía como un ligero bamboleo vertical.
Primer intento: `transform-gpu` (fuerza aceleración por GPU, promociona el
icono a su propia capa — el arreglo que la propia documentación de Tailwind
recomienda para animaciones "choppy"), aplicado también al icono de carga
de los toasts (`components/nova/ui/sonner.tsx`). **Regresión real,
reportada de inmediato: "la ruleta de carga no gira ni en el botón de
filtrar ni en el mensaje emergente"** — `transform-gpu` y `animate-spin`
escriben la misma propiedad `transform` por vías distintas (Tailwind v4
compone `transform-gpu` a partir de variables `--tw-rotate-*`, mientras que
el keyframe de `animate-spin` escribe `transform: rotate(...)` literal), y
en la práctica una pisaba a la otra dejando el icono completamente QUIETO,
no solo con menos bamboleo. Revertido — ambos iconos vuelven a `animate-spin`
sin `transform-gpu`. Un bamboleo mínimo es un mal menor frente a un icono
que no gira en absoluto; verificado con `agent-browser` (matriz de
`transform` del icono cambiando en cada muestra durante la carga, confirma
que gira de verdad) que el giro volvió tras revertir.

#### 4.1.1 Obsoletos — visibles solo si tuvieron producción en el rango elegido

Pregunta directa del usuario: "tengo que quitar los artículos obsoletos, no sé si
lo tenemos en cuenta". Ya existía el campo en el proyecto — `F4101.IMSTKT = 'O'`,
mismo campo que usa `/caducados` (`api/caducados/route.ts`) para el maestro de
artículo (no confundir con stock/palet obsoleto, que es un concepto distinto sobre
F41021). No se usaba en ningún panel de la familia JDE (`/produccion`, `/compras`,
MRP, Costes) hasta ahora.

**Primera versión — ocultos por defecto, botón "Mostrar obsoletos (N)".** Un
filtro puramente manual: todos ocultos salvo que el usuario pulsara el botón,
sin relación con ningún dato de producción (que en ese momento no existía en
este panel).

**Revertido a petición explícita, al añadir la producción real (§3.3): "en vez
de poner lo de obsoletos como está ahora, tiene que salir en la tabla ese
artículo obsoleto solo si ha tenido producción en ese rango de fechas".** El
botón manual desaparece — el filtrado ahora es automático y depende del
`MonthRangePicker`: un obsoleto se ve SOLO si `produccion > 0` en el rango
elegido (razonamiento: si se ha seguido fabricando en ese periodo, aunque esté
marcado obsoleto en el maestro, interesa verlo; si no, no aporta nada tenerlo
en la lista). La API (`api/costes/route.ts`) sigue devolviendo **todos** los
finales, con `obsoleto` y `produccion` — el filtro sigue siendo del frontend,
mismo patrón que búsqueda/familia (`matchObsoleto = !n.obsoleto ||
(n.produccion ?? 0) > 0` en `useCosteA1Filters`), solo que ya no hay ningún
estado manual de por medio. Un obsoleto visible sigue mostrando el mismo badge
rojo "Obsoleto" junto al tipo. Alcance: solo afecta a qué **finales** se
listan; un artículo obsoleto que aparezca como *componente* dentro del despiece
de un final activo no se toca (sigue siendo parte real de esa receta).

### 4.2 Panel de desglose — selector plano de códigos + detalle del nodo elegido

> **Nota de versión — quinto diseño del panel de desglose**: `Dialog` centrado con
> drill-down → dos pestañas `AnimatedTabs` ("Desglose"/"Comparación") → pila de
> tarjetas recursiva con "peek" apilado al estilo "Animated List 03" → pestañas
> `AnimatedTabs` ANIDADAS (una dentro de otra por cada nivel del árbol) → **este**.
> El diseño anidado (ver `git log` de este archivo para el detalle, o §4.2.2 para
> el histórico del diseño de pila) funcionaba, pero para ver un "10" dentro de un
> "11" había que entrar primero en la pestaña del "11" — un nivel de clic por cada
> nivel del árbol. Pedido explícito: "quiero que arriba, a la altura de donde está
> la descripción de columnas de la otra tabla, salga el selector de los 11 y 10 que
> hay, solo con el número de artículo; también salga el padre seleccionado, de
> manera predeterminada; y cuando se pulse a otro, la descripción del componente se
> actualice y salga esa descripción, es 12/11/10, y si coincide o no". Sustituido
> por UN selector plano (`AnimatedTabs`, `tabs-08` de ShadcnSpace, mismo
> componente de siempre) con TODOS los nodos con lista de materiales propia del
> árbol completo — el artículo final incluido, siempre primero — al mismo nivel,
> sin anidar: para ver un "10" dentro de un "11" ya no hace falta entrar primero en
> el "11", se elige directamente en este selector.

**Un único criterio de comprobación, sigue igual que en la ronda anterior** — cada
nivel (la raíz incluida) usa el mismo `estadoLocal(n)` de `coste-a1-shared.tsx`:
¿los hijos DIRECTOS de `n` suman su coste A1 declarado? No hay una comprobación
global aparte hasta materia prima (pedido explícito desde el principio: "el padre
tiene que poner si coinciden los componentes, no hace falta que sume su 11, 10,
12") — esto no cambió al pasar a pestañas, solo cambió DÓNDE se muestra: antes en
el borde/tinte de cada tarjeta, ahora en la cabecera de cada pestaña (vía
`Descuadre`, junto a "Teórico X € · Real Y €" de ese nivel).

#### 4.2.1 Aplanado del árbol — `nodosNavegables` + `DetalleNodo`

`nodosNavegables(raiz)` (`coste-a1-desglose-panel.tsx`) recorre TODO el árbol del
artículo final seleccionado y devuelve, en una sola lista plana, la raíz (siempre
primera) más cualquier descendiente con lista de materiales propia
(`children.length > 0`), a cualquier profundidad — las hojas (materia prima,
envases, etiquetas...) no entran aquí, solo se ven dentro del detalle del nodo que
las contiene. Esa lista se convierte, una a una, en las pestañas de `AnimatedTabs`
(`tabs-08` de ShadcnSpace):

```ts
function nodosNavegables(raiz: DespieceNode): DespieceNode[] {
  const resultado: DespieceNode[] = [raiz];
  function visitar(n: DespieceNode) {
    for (const hijo of n.children) {
      if (hijo.children.length > 0) { resultado.push(hijo); visitar(hijo); }
    }
  }
  visitar(raiz);
  return resultado;
}
```

- **Etiqueta de cada pestaña = SOLO el código** (`label: n.codigo`, sin icono ni
  badge) — pedido explícito: "el selector... solo con el número de artículo". Con
  el árbol entero aplanado en una única fila, una descripción larga no cabría; el
  código (10 dígitos, `/^\d{10}$/`) sí. La raíz, al ser siempre `tabs[0]`, queda
  seleccionada por defecto — "que también salga el padre seleccionado, de manera
  predeterminada" no necesitó código aparte, es el comportamiento por defecto de
  `AnimatedTabs` (`defaultValue ?? tabs[0]?.value`).
- **Ubicación**: el selector va como lo primero dentro de `CardContent` (dentro del
  mismo `ScrollArea`, ver §4.2.3), justo debajo del `CardHeader` del panel — a la
  misma altura, en la tabla de la izquierda, de la fila de cabeceras de columna
  ("Artículo | Coste Teórico | Producción | Coste Real | Desviación"), no enterrado
  dentro de una tarjeta por nivel como en el diseño anidado anterior.

`DetalleNodo({ node })` es el `content` de cada pestaña — la info del nodo
ACTUALMENTE elegido en el selector, pedida explícitamente: descripción, tipo
(`Tipo {tipoCod} · {tipo}`, p. ej. "Tipo 11 · Producto semiterminado" — el crudo Y
el texto, la petición literal era "esa descripción, es 12 11 o 10") y `Descuadre`
(mismo criterio de siempre: `estadoLocal(n)`, ¿sus hijos DIRECTOS suman su coste
declarado?, "si coincide o no"). Debajo, sus hijos directos —
TODOS, sin distinguir hoja/rama— como filas `FilaHoja` dentro de una sola tarjeta
con `divide-y` (calcada de `BillingPanel`, `components/shadcn-space/tabs/
tabs-08.tsx`): un hijo que a su vez tiene su propia lista de materiales se ve aquí
igual que uno sin ella — para entrar en el suyo se usa el selector de arriba
(ya lo incluye, al estar aplanado el árbol entero), no hace falta duplicarlo como
pestaña anidada.

**`Descuadre` sigue siendo la píldora de color** (`rounded-full`, sin icono,
calcada de los badges "Paid"/"Overdue" de `BillingPanel`) de la ronda anterior —
al vivir en `coste-a1-shared.tsx`, compartida entre `DetalleNodo` y (para el
artículo final en conjunto, no un nodo del árbol) la cabecera del propio informe.
(`estadoSubarbol` sigue usando `CircleAlert` suelto para el icono de aviso del
informe — ver §4.2.4 — sin pasar por `Descuadre`.)

**El % de desviación de cada `FilaHoja` también es ahora una píldora
(`DesviacionBadge`, `coste-a1-shared.tsx`)** — pedido explícito, "quiero que
en el desglose de componentes salga el porcentaje con fondo, como en la
foto". Mismo tratamiento visual que `Descuadre` (`rounded-full px-2 py-0.5`,
fondo del color al 10% de opacidad) en vez del texto suelto en color de
antes — más consistente entre las dos píldoras que conviven en la misma
tarjeta de detalle. Se aplica a TODAS las filas de `FilaHoja` sin
excepción — el desglose no distingue artículo final de componente, cada
fila que se ve aquí ya es "un componente de lo que esté elegido en el
selector", no hay una raíz que destacar aparte (a diferencia de la tabla,
§4.1, que en su momento SÍ distinguió raíz/componente para esto — luego
también revertido a "todos").

**Ronda siguiente: código visible en TODAS partes del desglose + desviación
también en el nodo seleccionado y en la cabecera del panel.** Pedido
explícito: "en el desglose tiene que aparecer el número de artículo de
todos" — antes `FilaHoja` y `DetalleNodo` solo llevaban el código en el
`title` (tooltip al pasar el ratón), nunca visible en el texto. Arreglo:
`FilaHoja` añade `<span className="font-mono">{node.codigo}</span>` delante
de "Teórico X € · Real Y €"; `DetalleNodo` lo mismo delante de "Tipo X · Y".

Pedido explícito, mismo turno: "cuando seleccionas un componente que sale
como 'padre'... ahí quiero que salga también la desviación y con fondo" y
"arriba en la descripción que sale la desviación también, que salga con el
fondo rojo igual". Dos sitios que hasta entonces NO mostraban desviación en
absoluto:

- `DetalleNodo` (la tarjeta del nodo elegido en el selector, sea la raíz o
  cualquier "padre" con lista de materiales propia) — solo mostraba
  Teórico/Real; gana un tercer dato, "Desv. [`DesviacionBadge`]", con el
  mismo `desviacionPct(node)` que ya se usa en todos lados.
- El resumen del `CardHeader` del panel (arriba del todo, siempre el de la
  raíz) — ya mostraba "Desv. Z %" pero como texto suelto en color, no
  píldora; pasa a `DesviacionBadge` igual que el resto. Se saca del `<p>`
  que trunca (Teórico/Real) a un `<div>` hermano `shrink-0`, para que la
  píldora nunca quede recortada si el nombre del artículo empuja el
  contenido.

El `CardHeader` del panel ya NO repite el estado del artículo final (antes vivía
ahí, junto a la descripción) — esa información ahora la da directamente la
primera pestaña del selector (la raíz, seleccionada por defecto), sin duplicarla.
El `CardHeader` se queda solo con la descripción/código del artículo final en
conjunto, como ancla estable mientras se navega por sus componentes.
`AnimatedTabs` lleva `key={node.codigo}`: al cambiar de artículo final en la
tabla, se remonta el selector entero y vuelve a arrancar en la raíz del nuevo
árbol.

#### 4.2.1bis Seis bugs reales con árboles anchos (un "surtido" con muchas variedades)

Reportado directamente por el usuario tras probar un artículo con muchos
componentes ("SURTIDO TORTILLAS", 1210100339, con 7 nodos navegables): "si
selecciono el 1210100339 tiene mucho por debajo entonces no cabe en el ancho
del componente". Encontrados y corregidos uno detrás de otro, en varias
rondas, con `agent-browser` (inspección de `getBoundingClientRect()`,
`scrollLeft` y `getComputedStyle()` en vivo — el problema no se veía igual en
cada captura, hacía falta medir):

1. **El selector arrastraba TODO el panel al hacer scroll horizontal.**
   `tabs-08` mide el selector con `sm:w-fit` (crece con el contenido) sin techo
   — como `sm:` depende del ancho de la VENTANA, no del panel, en cualquier
   escritorio normal gana sobre el `w-full` base, así que con 7 códigos el
   selector medía ~766px de ancho real dentro de un panel de ~340px. Al no
   tener el selector su propio límite, era el `ScrollArea` de TODO el panel el
   que terminaba desbordado y scrolleable en horizontal — pero moviéndolo se
   iba también la tarjeta de detalle y la lista de materiales, dejándolas
   fuera de la vista (confirmado: `viewport.scrollWidth` 790 vs. `clientWidth`
   389, y mover `viewport.scrollLeft` desplazaba todo el contenido a la vez).
   Arreglo: `max-w-full` en el propio selector (`listClassName`) — no puede
   crecer más que el panel; por debajo de ese ancho se ve compacto igual que
   antes, por encima activa SU PROPIO `overflow-x-auto` (ya presente en
   `tabs-08`) sin arrastrar nada más.
2. **Con el selector ya acotado, la raíz (primera pestaña, seleccionada por
   defecto) seguía sin verse.** Causa: el `TabsList` compartido
   (`components/nova/ui/tabs.tsx`) lleva `justify-center` — un flex CENTRADO
   que desborda su contenedor con scroll deja la mitad inicial del contenido
   inalcanzable (es un bug de CSS conocido: con contenido centrado, ni
   `scrollLeft = 0` ni el máximo llegan a mostrar el principio; confirmado
   forzando `scrollLeft` a distintos valores sin que cambiara qué códigos se
   veían). Arreglo: `justify-start` en el selector (`listClassName`) — sin
   efecto en el caso sin desbordar (con pocos códigos el `w-fit` ya envuelve
   el contenido exacto), pero con desbordamiento crece siempre hacia la
   derecha, dejando la raíz (primer elemento) visible desde el principio.
3. **Incluso con `justify-start`, el selector nacía con el scroll ya al
   máximo** (`scrollLeft = scrollWidth - ancho`, no 0). No es un
   `.scrollLeft = ...` de nuestro código ni de `tabs-08` (comprobado
   interceptando el setter de `Element.prototype.scrollLeft`: cero escrituras
   detectadas), así que es el propio navegador ajustando el scroll durante el
   montaje por algún mecanismo interno no observable desde JS. Arreglo
   pragmático: un `useLayoutEffect` en `CosteA1DesglosePanel` que, tras cada
   montaje del selector (`[node?.codigo]` como dependencia, mismo disparador
   que el `key` de `AnimatedTabs`), busca el `[data-slot="tabs-list"]` dentro
   de un `ref` propio y fuerza `scrollLeft = 0`.
4. **Con el selector ya corregido, seguía sin haber forma de llegar a los
   códigos ocultos con el ratón ni de saber que existían.** Reportado de
   nuevo: "si hay más a la derecha, se ve cortado y no sabes cuántos hay, con
   el ratón no se puede ir accediendo a la derecha". Causa: `overflow-x-auto`
   por sí solo solo responde a rueda con Shift o gesto táctil, nunca a un
   simple arrastre de ratón — y sin scrollbar visible (`tabs-08` lleva
   `no-scrollbar`, que no se puede desactivar vía `listClassName` al ser una
   clase propia sin conflicto reconocido por `tailwind-merge`) tampoco había
   ninguna pista de que hubiera más. Arreglo: dos flechas (`ChevronLeft`/
   `ChevronRight` de `lucide-react`) FUERA del área con scroll, a los lados
   (no encima, para no tapar ninguna pestaña) — cada una hace
   `scrollBy({ left: ±180, behavior: "smooth" })` sobre el mismo
   `[data-slot="tabs-list"]`. **Las dos flechas están SIEMPRE montadas** (nunca
   se añaden/quitan del DOM) — pedido explícito tras la primera versión (que
   sí las montaba/desmontaba con `{puedeIzq && ...}`): "deberían estar siempre
   arriba... para que lo de abajo no cambie de tamaño". La que no hace falta
   en cada momento se queda con `disabled` + `invisible` (mismo hueco
   reservado siempre, sin `display:none` que sí quitaría espacio) en vez de no
   renderizarse — así ninguna tarjeta de detalle ni lista de materiales se
   desplaza verticalmente al aparecer/desaparecer una flecha. `puedeIzq`/
   `puedeDer` (dos `useState`, recalculados en cada evento `scroll` del
   selector vía un listener enganchado en el mismo `useLayoutEffect` del
   arreglo anterior) siguen decidiendo cuál de las dos se ve habilitada — así,
   además de dar acceso con el ratón, la propia flecha (habilitada o no)
   responde a "cuántos hay": si una está deshabilitada, no hay nada más en esa
   dirección.
5. **Las flechas salían centradas a media altura de TODO el bloque, lejos de
   la fila de códigos.** `AnimatedTabs` es UN solo hijo del `flex` (renderiza
   junto, en un solo bloque, tanto la fila de pestañas como el contenido de la
   pestaña activa — descripción, `Descuadre`, lista de materiales — que puede
   medir varios cientos de píxeles de alto); con `items-center` en el `flex`
   que envuelve `[flecha, selector, flecha]`, las flechas (28px) se centraban
   respecto a la altura de ESE bloque entero, no solo de la fila de pestañas
   de arriba — quedaban flotando a la altura de un componente de la lista de
   materiales, muy lejos visualmente del selector ("las flechas tienen que
   salir en el selector de los artículos, lo tienes en el desglose"). Arreglo:
   `items-start` en vez de `items-center` — ancla ambas flechas arriba, a la
   altura de la fila de pestañas, sea cual sea la altura del contenido de la
   pestaña activa debajo.
6. **Con `items-start` solas, las flechas se veían "descentradas" respecto a
   las píldoras.** Reportado de nuevo: "no está bien centrada la flecha".
   Causa: `items-start` ancla el borde SUPERIOR de la flecha con el borde
   superior del bloque (que coincide con el borde superior de la fila de
   pestañas — eso ya estaba bien), pero cada flecha seguía teniendo una altura
   FIJA (`size-7`, 28px) menor que la altura real de la fila de `tabs-08`
   (con su padding, algo más de 28px) — con los bordes superiores alineados
   pero alturas distintas, el CENTRO de la flecha (más baja) queda por encima
   del centro de las píldoras (más altas). Arreglo: alto MEDIDO, no fijo —
   `altoSelector` (nuevo `useState<number | null>`) guarda
   `lista.getBoundingClientRect().height` cada vez que se recalculan las
   flechas (mismo sitio que `actualizarFlechas()`, arreglo nº4) y se aplica
   como `style={{ height: altoSelector }}` a los dos botones. Con la MISMA
   altura que la fila real, el `items-center` interno de cada botón (para
   centrar su icono) ya centra el icono respecto a las píldoras de verdad,
   sea cual sea esa altura — comprobado con `agent-browser`:
   `getBoundingClientRect()` de flecha y fila coinciden en centro Y (72,44px)
   y alto (46px) exactos.

**De paso, pedido explícito para que el desglose respirara más con árboles
anchos — pero SIN tocar el ancho exterior tabla/panel.** Primer intento:
ensanchar el grid de `app/costes/page.tsx` de `lg:grid-cols-3` (66%/33%) a
`lg:grid-cols-5` (60%/40%) — rechazado explícitamente: "me refería a que el
componente completo fuera igual de grande, ni más ni menos, pero el desglose
de dentro con menos margen con el componente" — con el grid más ancho, la
TABLA de la izquierda dejaba de verse entera sin deslizar (efecto colateral no
deseado de robarle ancho a la tabla). Revertido a `lg:grid-cols-3` (tabla
`col-span-2` / panel `col-span-1`, igual que siempre). El sitio de más para el
selector y la lista de materiales sale en su lugar de achicar el margen
INTERNO del panel — `CardHeader` (`px-6 pt-6` → `px-4 pt-4`), el contenedor
del `ScrollArea` (`p-6` → `p-4`) y las tarjetas internas de `DetalleNodo`
(`px-5` → `px-4`) — mismo ancho exterior, más ancho útil dentro.

**Segunda vuelta, más quirúrgica: "quiero que el selector se quede igual,
pero el resto de lo que sale de los componentes se adapte más al ancho del
componente".** El selector (`AnimatedTabs`) solo tiene el margen exterior del
panel (`p-4` de `CosteA1DesglosePanel`) — nada más que tocar ahí. Las
tarjetas de `DetalleNodo` (descripción/tipo/`Descuadre` y la lista de
materiales) en cambio suman SU PROPIO padding interno ENCIMA de ese margen —
`px-4 py-3`. Bajado a `px-3` en las dos tarjetas y de `gap-4` a `gap-2` en sus
filas internas (la cabecera de `DetalleNodo` y `FilaHoja`) — sin tocar el
selector ni el margen del panel, solo el aire propio de estas tarjetas, que
era lo único que quedaba por quitar para ganar ancho de verdad para el texto
(descripción, "Teórico X € · Real Y €") antes de truncar con `…`.

**Tercera vuelta: las cabeceras de la tabla ("Coste por artículo final") y del
panel ("Desglose del coste declarado") no median lo mismo de alto.** Pedido
explícito: "quiero que la cabecera de los dos componentes... sean igual de
altos". Causa: el `px-4 pt-4` del ajuste de la primera vuelta (arriba) redujo
también el `pt` del `CardHeader` del panel, no solo el `px` — `CosteA1Table`
sigue con `px-6 pt-6` en el suyo (sin tocar, calcado de `hierarchical-table.tsx`
de compras desde el principio, ver §4.1), así que 8px de diferencia en el
padding superior (`pt-6` = 24px vs. `pt-4` = 16px) hacían que el panel
arrancara más arriba que la tabla — con el mismo `gap-1` entre título/subtítulo
y el mismo `text-lg` en los dos títulos, ese `pt` era la única diferencia real.
Arreglo: `pt-6` en el `CardHeader` del panel, dejando `px-4` como estaba (el
ancho horizontal sí se redujo a propósito, no hay que revertirlo) —
comprobado con `agent-browser`: las dos cabeceras miden exactamente 76px de
alto.

**Cuarta vuelta: resumen del artículo final SIEMPRE visible en la cabecera,
no solo dentro de la primera pestaña del selector.** Pedido explícito:
"arriba del todo en la cabecera del componente, estaría bien que salga
también si coincide o no, teórico - real, desviación". Añadida una fila más
al `CardHeader` con "Teórico X € · Real Y € · Desviación 0,0 %" (mismos campos
y mismo criterio ficticio que la tabla, ver §4.0 — aquí Real y Desviación NO
son el resultado real de comparar contra los hijos, son el mismo maquillaje
que en toda la app) + la píldora `Descuadre` de verdad (`estadoLocal(node)`
sobre la RAÍZ, no sobre el nodo elegido en el selector de abajo — la cabecera
es la única parte del panel que no cambia de pestaña, así que sirve de ancla
estable con este resumen siempre a la vista, se navegue lo que se navegue por
debajo). Al añadir esta fila la cabecera volvió a medir más que la de la
tabla — corregido en la quinta vuelta, justo debajo.

**Quinta vuelta, tres pedidos a la vez: la píldora de descuadre sin el importe
("NO OK" en su lugar), quitar el subtítulo "Desglose del coste declarado." y
que la cabecera vuelva a medir 76px, igual que la de la tabla.**

- **`Descuadre` ya no muestra el importe del descuadre** (`+0,7963 €`) en su
  rama roja — pedido explícito: "que ponga 'NO OK' ya que en el desglose ya
  sale" (el propio "Teórico X € · Real Y €" de al lado ya deja ver la
  diferencia si hace falta calcularla, no hace falta repetirla dentro de la
  píldora). `valor` desaparece de la firma del componente (`{ estado, tono }`,
  sin `valor: number`) y de las dos llamadas (`DetalleNodo` y la cabecera del
  panel) — con él, `sumaDirecta`/`diferencia` (y sus variantes `*Raiz` en el
  panel) también desaparecen, ya sin ningún uso.
- **Subtítulo "Desglose del coste declarado." eliminado** del `CardHeader` —
  pedido explícito, "puedes quitar lo de...". Sin él, el título y la fila de
  resumen quedan como las DOS únicas filas de la cabecera (antes eran tres:
  título, subtítulo, resumen).
- **Altura igualada a los 76px de la tabla de nuevo** — con solo dos filas
  (como en la tabla: título + subtítulo/resumen) y el mismo `pt-6`, la
  altura ya debería coincidir en teoría, pero la fila de resumen en
  `text-sm` con `flex-wrap` se partía en dos líneas dentro del panel (más
  estrecho que la tabla): "Teórico X € · Real Y € · Desviación 0,0 %" +
  la píldora no cabían juntos en una sola línea, comprobado con
  `agent-browser` (103px de alto en vez de 76px). Arreglo: sin `flex-wrap`
  (el texto y la píldora comparten SIEMPRE una sola línea), texto en
  `text-xs` con `truncate` + `min-w-0` (si de verdad no cupiera con un coste
  muy largo, se corta con `…` en vez de partir a una segunda línea) y
  "Desviación" abreviado a "Desv." — comprobado con `agent-browser`: 75,7px
  vs. 76px de la tabla (diferencia de redondeo, no perceptible), tanto en
  verde ("Coincide", `CEBOLLITAS CONFITADAS 40UD`) como en rojo ("NO OK",
  `TORT CEBOLLA 1Kg FR DELITE`).

**Bug relacionado, encontrado de paso al depurar los anteriores — códigos
duplicados colisionaban como una sola pestaña.** El mismo componente puede
reutilizarse en varias recetas hermanas de un mismo árbol (p. ej. una base
compartida entre dos variedades de un "surtido"): al aplanar, el código
"1010100001" aparecía 3 veces en SURTIDO TORTILLAS. Como `AnimatedTabs` usa
`value` para saber qué pestaña está activa, tres pestañas con el mismo `value`
(el código) colisionaban — las tres se marcaban `aria-selected` a la vez y
`.find()` siempre resolvía el contenido de la PRIMERA, dejando las otras dos
inalcanzables. Arreglo: `nodosNavegables()` devuelve `{ key, node }` en vez de
solo `node` — `key` incluye la posición en el árbol (`"${prefijo}.${i}.${codigo}"`)
para ser único SIEMPRE aunque el código se repita; `value` usa `key`, `label`
sigue siendo solo `node.codigo` (los duplicados en pantalla son correctos —
es genuinamente el mismo artículo usado dos veces).

**Bug real corregido, mucho más tarde — las flechas también estrechaban el
detalle de abajo, no solo la fila de píldoras.** Reportado con una captura:
"el componente del desglose tiene mucho margen interior... es por el
selector, mira cómo están las flechas". Causa: las dos flechas eran hermanas
de flex de TODO el bloque `<AnimatedTabs>` (`<div className="flex items-start
gap-1">{flecha}<div className="flex-1"><AnimatedTabs .../></div>{flecha}</div>`)
— pero `AnimatedTabs` renderiza junto, sin forma de separarlos, tanto la fila
de píldoras COMO el contenido de la pestaña activa (`DetalleNodo`, con toda
la lista de materiales). Al ser las flechas hermanas de ese bloque entero, no
solo de la fila de arriba, el hueco que reservaban (`w-7` × 2 + `gap-1`, unos
64px) se lo quitaban también al detalle — que quedaba más estrecho que el
resto del panel sin motivo real, ya que las flechas solo hacen falta para
desplazar la fila de códigos, no para nada de lo que hay debajo.

Arreglo: las flechas pasan de flex-siblings a `position: absolute` (`top-0`,
`left-0`/`right-0`) sobre un contenedor `relative` que ya no las necesita
como hijos de verdad — `selectorRef` (el `div` que engloba `AnimatedTabs`)
pasa a ocupar TODO el ancho disponible, detalle incluido. Como las flechas
ya no ceden espacio de flex, hace falta reservárselo de otra forma para que
no tapen la primera/última píldora: `pr-9 pl-9` añadido al `listClassName`
de la propia `TabsList` (vía `selectorClassName`) — el hueco para las
flechas queda confinado a la fila de píldoras, sin filtrar al contenido de
debajo. El resto del mecanismo (`altoSelector` medido, `invisible` en vez de
desmontar, `scrollLeft` forzado a 0 al montar) no cambia — ver puntos 3-6 más
arriba, siguen aplicando igual sobre el mismo `[data-slot="tabs-list"]`,
ahora solo que sin arrastrar el ancho del detalle con ellos.

**Ronda siguiente — flechas JUNTAS a la derecha, selector a ancho siempre
constante.** Pedido explícito con captura ("las flechas están las dos a un
lado, no sé si es mejor así, o como lo tenemos ahora" → sí, mejor así) más
uno nuevo detectado de paso: "quiero que el selector tenga siempre el mismo
tamaño tenga uno o más artículos". Causa del segundo: `tabs-08` trae
`sm:w-fit` en su `TabsList` — sin overflow (pocos códigos) la lista se encoge
al contenido, así que la caja del selector medía distinto según cuántos
códigos hubiera (estrecha con 2, ancho completo con 7 que sí necesitan
scroll). Arreglo conjunto: `pl-9 pr-9` (un lado cada flecha) pasa a `pr-16`
(las dos JUNTAS, solo a la derecha — `<div className="absolute right-0 top-0
z-10 flex gap-1">` envolviendo los dos `<button>`, en vez de uno a cada
extremo del `relative`); `selectorClassName` gana `sm:w-full` (mismo grupo de
conflicto de Tailwind que `sm:w-fit`, con `cn()` gana el que se pasa después
— `sm:w-fit` del componente instalado pierde) para forzar SIEMPRE el ancho
completo del panel, haya overflow o no. Verificado con `agent-browser`:
"CEBOLLITAS CONFITADAS 40UD" (2 códigos, sin flechas visibles) y "SURTIDO
TORTILLAS" (7 códigos, flechas visibles) miden el selector exactamente igual
de ancho.

**Actualización posterior**: "Teórico X € · Real Y € · Desv. Z %" de la
cabecera del panel (y de `DetalleNodo`/`FilaHoja` para cada nodo del
selector) dejó de ser el maquillaje ficticio descrito en la "Cuarta vuelta"
— Real y Desv. son ahora el coste real ponderado de `F30026` y su desviación
frente al Teórico, ver §3.4. El layout, colores y criterio de `Descuadre` no
cambiaron.

#### 4.2.2 Historial — pila de tarjetas con "peek" apilado (abandonado, no por bug)

La versión anterior (pila de tarjetas recursiva, todas al mismo ancho, con un
"peek" de 2 tarjetas fantasma apiladas detrás de cada componente con hijos —
adaptación de "Animated List 03 - Expandable Stack" con su mismo
`SPRING_TRANSITION`, clic en la propia tarjeta en vez de un botón "Show All") se
llegó a dejar funcionando correctamente, con dos bugs reales de por medio ya
corregidos y verificados:

1. La primera tarjeta con hijos de la lista no mostraba nada de pila — causa:
   `zIndex` negativo en las tarjetas fantasma, que al no tener el contenedor su
   propio contexto de apilamiento (`z-index: auto`) podía acabar pintándose detrás
   del fondo de un antecesor. Arreglo: sin `z-index` en ningún sitio, orden de
   pintado solo por orden en el DOM.
2. Una tarjeta anidada mostraba su pila un instante al desplegar el padre y
   desaparecía al terminar la animación (~1s) — causa: el hueco reservado para la
   pila era `margin-bottom` (exterior a la caja del elemento), y la medición de
   altura `height: 0 → "auto"` del padre al desplegarse no lo contaba de forma
   fiable, así que el `overflow-hidden` de esa animación recortaba la pila justo al
   asentarse. Arreglo: `padding-bottom` en vez de `margin-bottom` (dentro de la
   caja del elemento, siempre se cuenta).

Ambos arreglos, comprobados con `agent-browser` (`getBoundingClientRect()`,
`getComputedStyle().opacity`, scroll agresivo simulado). El diseño se abandonó
igualmente porque, aun funcionando bien, no dejaba claro de qué padre colgaba cada
componente — el problema que las pestañas anidadas (y, tras ellas, el selector
plano actual) vinieron a resolver, ver §4.2/§4.2.1.

#### 4.2.3 Altura fija, igual que la tabla, con scroll propio

Pedido explícito: "que el componente sea igual de alto que el componente de la
tabla y se pueda ir deslizando por dentro". `CardContent` del panel envuelve la
lista de tarjetas en el mismo `ScrollArea` (`h-[32rem]`) que ya usa `CosteA1Table`
(§4.1) — antes el panel crecía con la página sin límite. Comprobado con
`agent-browser`: ambos `ScrollArea` miden exactamente 512px de alto.

#### 4.2.4 Historial — "Coincide" cuando en realidad no se puede saber (fix aplicado y luego revertido)

Reportado directamente por el usuario tras usar el panel con datos reales (en la
versión de pestañas, antes de este rediseño): "comprueba que cuando pone Coincide en
un desglose lo ponga porque coincide de verdad, porque he visto que en alguno no es
así". Causa raíz: la comprobación (hijos directos vs. coste declarado del padre)
trataba un componente SIN coste A1 propio como `0` en la suma — a propósito, para no
bloquear el cálculo. Pero eso significa que, si a algún componente le falta el coste,
la suma resultante es **parcial** — y que el número dé igual (o casi igual) al
declarado es pura casualidad, no una confirmación real. La primera versión, sin
embargo, mostraba un `Coincide` verde con toda confianza en ese caso (visto con
datos reales: `TORT CEBOLLA 1Kg FR DELITE`, con un componente sin coste, "coincidía"
por pura coincidencia numérica).

Corregido entonces con un **estado de tres valores**, no un booleano
(`EstadoDescuadre` en `coste-a1-shared.tsx`): `"ok"`, `"problema"` e `"incompleto"`
(no se puede verificar — falta el coste de al menos un componente directo),
pintado como **"Sin verificar"** en ámbar — nunca un badge verde de confianza que no
está justificado.

**Revertido más tarde, a petición explícita — el propio criterio del fix resultó
demasiado estricto para casos reales.** "Y lo de sin verificar no sé si tiene que
salir, ya que si coincide la suma de los componentes tiene que salir aunque uno no
tenga coste, porque igual es algún producto como tinta que es incalculable": hay
componentes (consumibles tipo tinta, etc.) que genuinamente no llevan coste A1 propio
— no es un dato que falte, es que ese artículo no se costea así — y penalizar CADA
vez que falta un coste, aunque la suma ya cuadre tratándolo como 0, daba avisos
molestos sin motivo real en esos casos. Con el ejemplo real que motivó el fix
original (`TORT CEBOLLA 1Kg FR DELITE`) confirmado en el navegador: con el criterio
nuevo la suma (con el componente sin coste a 0) NO cuadra de verdad — sale
`"problema"` (rojo, `+0,7963 €`), no un falso `"Coincide"` ni un `"Sin verificar"`
de más; era genuinamente un descuadre, el fix original solo lo estaba enmascarando
detrás de la advertencia ámbar. Y `CEBOLLITAS CONFITADAS 40UD` (que sí tenía un
componente sin coste y antes mostraba "Sin verificar") ahora muestra `"Coincide"`
en verde directamente, sin advertencia.

**`EstadoDescuadre` vuelve a ser de dos valores** (`"ok" | "problema"`,
`coste-a1-shared.tsx`) — `estadoLocal(n)` trata cualquier hijo sin coste A1 como `0`
en la suma SIEMPRE, sin distinguir ese caso; si la suma cuadra, `"ok"`, si no,
`"problema"`. `estadoSubarbol(n)` (recorre TODO el subárbol de `n`, no solo su
nivel — un descuadre interno podría compensarse por casualidad en el total) se
simplifica igual: `"problema"` si aparece en cualquier punto, `"ok"` en caso
contrario. El icono de aviso del informe (`CircleAlert` rojo junto al nombre del
artículo final, sobre el árbol SIN podar) pierde su rama `CircleHelp` ámbar —
ya no hay estado "incompleto" que mostrar. El `git log` de `coste-a1-shared.tsx`
conserva el razonamiento y el código completo del estado de tres valores por si
hiciera falta reinstaurarlo.

- `estadoLocal(n)`: ¿los hijos DIRECTOS de `n` suman su coste declarado? Alcance de
  un solo nivel — la usa `DetalleNodo` para el nodo que esté elegido en el selector
  en cada momento (la raíz incluida, al ser la primera pestaña por defecto), y
  también la cabecera del panel para el resumen de la raíz (ver nota de la "Cuarta
  vuelta" en §4.2.1bis).
- `estadoSubarbol(n)`: la usa el icono de aviso del informe.

### 4.3 Decimales del coste

El coste (`IECSL`/10000) puede tener hasta 4 decimales con significado real.
Redondear a 2 (como el resto de importes en € de la app) perdía precisión de verdad
(ej. `0,6454 €` se veía como `0,65 €`) — aquí `euros()` usa
`maximumFractionDigits: 4` en vez de 2.

### 4.4 Gráficos mensuales — bloques ShadcnSpace `chart-03`/`chart-04`, editados en el sitio

Pedido explícito con capturas y código de referencia: el gráfico de área con
gradiente ("Chart 03 - Area Chart Gradient - Yearly Sales Comparison") y el de
barras ("Chart 04 - Bar Chart - Weekly Sales") del catálogo de ShadcnSpace,
instalados con el comando oficial (`bunx --bun shadcn@latest add
@shadcn-space/chart-03`/`chart-04` — estilo `base-nova` del proyecto, sin
prefijo `/radix/`, comprobado en `components.json`) y editados DIRECTAMENTE en
el archivo instalado (`components/shadcn-space/blocks/chart-0{3,4}/chart.tsx`)
en vez de crear un wrapper aparte en `components/nova/` — mismo patrón que
`chart-15`/`charts-15.tsx` en `/compras` (ver `components/nova/README.md`).

- **`chart-03` no dibuja áreas, sino BARRAS AGRUPADAS** (`<Bar>` en un
  `<BarChart>`, sin los `linearGradient` del bloque original) — mismo formato
  que el gráfico mensual de `/compras` (`chart-15`), con `barGap`, `barSize` y
  `radius` calcados de allí para que dos paneles Nova que enseñan lo mismo se
  lean igual. Se llegó aquí en dos pasos, por si alguien recupera una versión
  intermedia del historial: primero se pasó de áreas a líneas (el área bajo un
  coste unitario sugiere un volumen que no existe, y con las series próximas
  las áreas translúcidas se solapan y tapan la distancia entre teórico y real),
  y después a barras por pedido explícito ("creo que es mejor de barras, ¿no?"),
  que además comparan mejor punto a punto que midiendo el hueco entre dos
  líneas. **Matiz que conviene recordar al tocar esto**: a diferencia de
  `/compras`, aquí cada barra NO es un total del mes sino una media ponderada
  (€ por unidad), así que las alturas no son sumables entre meses — por eso el
  eje Y y el tooltip van en €/unidad.
- **`chart-04` ya no enseña la producción por mes, sino los artículos con mayor
  impacto € del rango, con un SELECTOR de dos pestañas** (5 de mayor sobrecoste
  / 5 de mayor ahorro), **con el mismo diseño que `DeviationByFamilyChart`
  de `/compras`** (`components/nova/deviation-by-family-chart.tsx`) — pedido
  explícito: ya no es un chart de Recharts, son divs + Tailwind con barras
  divergentes desde el centro y sin ejes. Ojo al color, que va AL REVÉS que en
  compras: allí positivo (vender más de lo previsto) es verde; aquí positivo es
  sobrecoste, o sea rojo — mismos tokens y mismo criterio que `DesviacionBadge`
  y los KPI. El archivo se queda en `components/shadcn-space/blocks/chart-04/`
  aunque ya no sea un bloque del catálogo, para no partir el historial de la
  celda del grid que ocupa. Se cambió porque
  el gráfico de producción (a) repetía forma justo al lado del de coste sin
  añadir lectura, (b) enseñaba un dato que ya estaba dos veces en pantalla (KPI
  "Producción total" y columna de la tabla) y (c) sale de F4111, que desde el
  cambio del coste real ya no es la fuente que pondera el resto del panel — dos
  cifras de "cuánto se produjo" a la vez solo invitaban a preguntas estériles.
  El de ahora responde "¿QUIÉN se está comiendo el dinero?", que el KPI de
  impacto (un agregado) no puede contestar. Detalles:
  - Impacto por artículo = `(costeReal − costeA1) × cantidad costeada`, misma
    fórmula y misma población que el KPI 2 (§3.6), pero sin agregar
    (`topImpactoArticulos()`, `coste-a1-shared.tsx`).
  - **Selector de dos pestañas** (`AnimatedTabs`, `tabs-08`) para cambiar entre
    "Mayor sobrecoste" y "Mayor ahorro" — pedido explícito: *"como cambio para
    ver los componentes de los 11 y 10 de un artículo"*, o sea el MISMO
    componente y el mismo gesto que el selector del panel de desglose (§4.2),
    para no inventar un patrón nuevo dentro del mismo panel.
  - `extremosImpacto()` (`coste-a1-shared.tsx`) devuelve las dos listas ya
    separadas: ordena de mayor sobrecoste a mayor ahorro y coge 5 de cada
    punta, **cada lista solo con artículos de su signo** (peores = impacto > 0,
    mejores = impacto < 0). Antes cogía los 5 primeros y los 5 últimos sin mirar
    el signo y deduplicaba por código, y con un solo artículo filtrado (o
    pocos) un ahorro salía en "Mayor sobrecoste", en verde, y la pestaña de
    ahorro quedaba vacía. Con el filtro de signo no hace falta deduplicar; el
    impacto exactamente 0 no sale en ninguna. Los "mejores" se invierten para
    que la primera fila sea siempre la más destacada, igual que en la otra
    pestaña. El ranking sigue los mismos filtros que la tabla (búsqueda y
    familia), a propósito.
  - Hubo antes un top único por valor absoluto, con las dos colas en la misma
    lista separadas por una línea; se descartó al pedirse el selector. De ahí
    que las barras ahora **crezcan desde la izquierda** y no diverjan desde el
    centro como en compras: dentro de una pestaña todas las filas son del mismo
    signo, así que divergir no aportaba nada y desperdiciaba la mitad del ancho.
    Cada pestaña escala a su propio máximo (compartir escala dejaría la pestaña
    "pequeña" con todas las barras al mínimo). El color sigue distinguiendo el
    signo con los mismos tokens que `DesviacionBadge` y los KPI: positivo rojo,
    negativo verde.
  - Cada fila lleva **el código Y la descripción** del artículo (pedido
    explícito) en la misma línea —en dos líneas, con 10 filas, la tarjeta se iba
    de alto— más su impacto en € (0 decimales: son importes de rango completo,
    los céntimos son ruido). El código nunca se trunca (`shrink-0`), porque es
    lo que se usa para cruzar con JDE; lo que cede es la descripción, que además
    se repite entera en el `title`. Las barras se escalan al máximo absoluto de
    la serie, con un mínimo del 3% para que los últimos del top no queden
    invisibles.
  - **Al pulsar una fila se selecciona ese artículo en el panel de desglose**
    (`onSelect` → `setSelectedCodigo`): el gráfico señala al culpable y se entra
    a su despiece sin buscarlo a mano en la tabla. Cada fila es un `<button>`,
    no un `<div>`, para que funcione con teclado y lectores de pantalla.
- **Las dos tarjetas de la fila miden lo mismo, y la que manda es "Artículos
  por impacto"** (pedido explícito: que esa mida lo que mide su contenido, sin
  espacio muerto abajo, y que la de coste se iguale a ella). Quién impone el
  alto y quién se adapta es lo único delicado de esto:
  - `chart-04` NO lleva `h-full` ni `flex-1` — alto natural, el de su contenido.
    Sí lleva `contentClassName="min-h-[180px]"` en el `AnimatedTabs`, que es lo
    que ocupan las 5 filas de una pestaña llena: sin ese suelo, un rango sin
    datos encogía la tarjeta a poco más que el selector y arrastraba con ella a
    la de coste, que se adapta a esta (caso real visto en pantalla).
  - `chart-03` sí lleva `className="h-full"` desde `app/costes/page.tsx` (llena
    su celda del grid, que ya se estira al alto de la fila) y dentro es `flex
    flex-col` con el área del gráfico en `flex-1`.
  - El `min-h-[200px]` del área del gráfico es **solo un suelo** por si la otra
    tarjeta se queda muy corta (pocos artículos), no el alto de trabajo. Era
    `h-[253px]` fijo en su día: con eso, era `chart-03` quien imponía el alto de
    la fila, justo al revés de lo pedido.
  - **`aspect-auto` en el `ChartContainer`, imprescindible**: ese componente
    (`components/nova/ui/chart.tsx`) trae `aspect-video` de serie, así que con
    el ancho de la tarjeta (~800px) se imponía ~450px de alto y la fila la
    seguía marcando el gráfico de coste por mucho `h-full`/`flex-1` que se
    pusiera — son propiedades distintas (aspect-ratio vs. height) y
    `tailwind-merge` no las fusiona, así que el aspect-ratio ganaba.
- **El selector de `chart-04` ocupa todo el ancho de la tarjeta**, también
  pedido explícito: `listClassName="sm:w-full *:flex-1"` anula el `sm:w-fit` con
  el que `tabs-08` deja el selector del ancho de sus etiquetas, y reparte las
  dos pestañas a partes iguales.
- **Mismo reparto 2/3-1/3** que la fila de tabla+desglose de abajo (`app/costes/page.tsx`):
  el gráfico de barras agrupadas (`Coste real vs. teórico`) a la izquierda en `lg:col-span-2`,
  el de barras de impacto (`Artículos por impacto`) a la derecha en `lg:col-span-1`.
- **Sin las tarjetas KPI del bloque original** ("Sales this year/last year" en
  chart-03, "$96,850 -5% Last 7 days" + desplegable "Weekly/Monthly/Yearly" en
  chart-04) — mismo criterio que ya se aplicó a `chart-15`: no hay un periodo
  anterior con el que comparar de forma automática, y un segundo selector de
  rango sería redundante con el `MonthRangePicker` del propio panel. En su
  lugar, leyenda de puntos en la cabecera (mismo patrón que `Charts15`).
  Tampoco se resalta ninguna barra en concreto (el original de `chart-04`
  marcaba un día fijo por índice) — aquí no hay un mes "de referencia" obvio.
- **Barras: cápsula completa, no rectángulo redondeado, y centradas de
  verdad — bug real corregido**. Primera versión: `radius={[8,8,8,8]}` (poco
  redondeado) y el `<div className="-me-3 rtl:...">` del bloque original
  envolviendo el `<ResponsiveContainer>` directamente, sin `CardContent`. Ese
  margen negativo compensaba el `p-6` que el DEMO del catálogo aplica al
  `<Card>` entero desde fuera (`className="max-w-sm ... p-6 ..."` en su propio
  `page.tsx`) — como aquí el `<Card>` no lleva ese padding exterior, el mismo
  hack solo desequilibraba las barras hacia la derecha (visto en captura,
  pedido explícito: "más centrado"). Arreglo: `radius={[40,40,40,40]}` en una
  barra de 32px (`barSize={32}`) — con el radio mayor que la mitad del ancho,
  redondea las 4 esquinas hasta formar una cápsula completa, igual que la
  captura de referencia — y `<CardContent>` (mismo padding horizontal que ya
  usa el resto del panel) en vez del `div` con margen negativo.
- **Eje X**: `formatMesCorto()` (`coste-a1-shared.tsx`) — `'YYYY-MM'` a "ene
  26" (año a 2 dígitos, para que quepan hasta 12 puntos sin apretar).
- **Eje Y del gráfico de área — bug real corregido**: el `margin.left: -20`
  del bloque original (pensado para ticks cortos tipo "8k", 2-3 caracteres) se
  heredó sin más al principio — con un tick real como "23,00 €" (7-8
  caracteres) el texto se salía del todo y se veía cortado por el borde de la
  tarjeta (comprobado con `agent-browser`). Corregido con `margin.left: 0` +
  `width={48}` en el `<YAxis>`. De paso, un segundo bug al mismo tiempo:
  formatear el tick sin decimales (`Math.round`) hacía que dos ticks
  distintos redondearan al mismo entero en el rango real típico (1-2 €) y se
  veían duplicados ("2€" dos veces seguidas) — con 1 decimal
  (`toLocaleString('es-ES', { maximumFractionDigits: 1 })`) cada tick es
  distinguible.
- **Rejilla (`CartesianGrid`) — bug real corregido, tema oscuro**: el bloque
  original usa `stroke="var(--color-border)"` — token que en este proyecto
  solo existe en `app/globals.css` (el sistema de diseño VIEJO,
  `--color-border: var(--border)`), **fuera** de `[data-nova-theme]`. En modo
  oscuro de Nova no seguía al `--border` real de `app/nova-theme.css` (casi
  blanco a propósito, `oklch(1 0 0 / 10%)`), así que la rejilla se veía con un
  gris claro FIJO encima del fondo oscuro de la tarjeta — "las líneas de
  puntos se notan mucho... se ve mucho el blanco", pedido explícito.
  Corregido a `stroke="var(--border)"` (mismo token que ya usa `chart-15` en
  compras, sí sensible al tema) + `strokeWidth` por defecto (1, no 2) +
  `strokeOpacity={0.5}` — mismo criterio que `chart-15` — para que la rejilla
  quede de fondo en los dos temas, sin competir visualmente con las líneas de
  coste. Verificado con `agent-browser` en claro y oscuro.
- **Tooltip**: tabla → `ChartTooltipContent` de Nova (`components/nova/ui/chart.tsx`)
  con `formatter` propio (usa `euros()`, hasta 4 decimales reales — igual que
  el resto del panel). Producción → tooltip a medida (`CustomTooltip` dentro de
  `chart-04/chart.tsx`, calcado del original) con `toLocaleString('es-ES')`.
- **Verificado con datos reales** (`agent-browser`, enero-mayo 2026, filtro
  "Todas las familias" y luego "Tortilla"): el tooltip de un punto del área
  coincide con los valores calculados a mano en §3.5, y los dos gráficos
  reaccionan al cambiar el filtro de familia de la tabla (confirmando que
  usan `filtros.filtered`, no el dataset sin filtrar).
- **Las dos tarjetas, exactamente igual de altas — bug real corregido.**
  Pedido explícito: "quiero que el gráfico de producciones y el gráfico de
  desviación de coste sean igual de altos". Las dos ya compartían el mismo
  alto de CHART (253px), pero medían distinto en total (349px vs. 353px,
  comprobado con `agent-browser`) porque sus `CardHeader` usaban mecanismos
  de layout distintos: `chart-04` se apoya en el `grid` por defecto de
  `CardHeader` (`components/nova/ui/card.tsx`, `CardTitle` + `<p>` como hijos
  directos); `chart-03` envolvía título+subtítulo en un `<div>` propio y
  ponía la leyenda al lado con `flex justify-between` (override completo del
  `grid` del componente) para tener la leyenda de puntos ancladas arriba a la
  derecha — un mecanismo de layout diferente para el mismo tipo de contenido
  cambia cómo el navegador calcula la altura, aunque el texto sea del mismo
  tamaño. Arreglo: `chart-03` pasa a usar `CardAction` (el slot que ya trae
  `card.tsx` para "acción arriba a la derecha", activa
  `has-data-[slot=card-action]:grid-cols-[1fr_auto]` en el propio
  `CardHeader`) para la leyenda, con `CardTitle`/`<p>` como hijos directos —
  mismo `grid` que `chart-04`, ya sin necesidad de override. Verificado con
  `agent-browser`: las dos tarjetas miden 353px de alto, cabecera 52px cada
  una, exactas.

---

## 5. Exportación a Excel

Dos hojas (mismo patrón multi-hoja que compras/MRP):
- **Coste por artículo final**: un artículo final por fila.
- **Despiece completo**: árbol aplanado (una fila por nodo, con `Nivel` y
  `ArticuloFinal` para poder reconstruir la jerarquía en Excel).
