# Documentación — Panel de Coste A1 (`/coste-a1`)

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

| | `/mrp` | `/coste-a1` |
|---|---|---|
| Punto de partida | Previsión de venta (F3460), por mes | Todo artículo con lista de materiales propia |
| Explosión | Aplanada — solo el material final comprable, cantidades acumuladas | Árbol completo — cada nivel (11, 10...) es un nodo visible |
| Vigencia del BOM | La del mes de cada previsión | **Hoy** — foto del estado actual |
| Objetivo | Cuánto comprar de cada material | Coste y estructura de cada producto vendible |

**Acceso**: `requireScreenAccess('coste_a1')`, entrada `coste_a1` en `lib/panels.ts`
(público por defecto, restringible desde `/admin`). **Logging**: `query_logs`,
`source: 'coste_a1'`.

---

## 2. Archivos relevantes

| Archivo | Descripción |
|---|---|
| `app/coste-a1/page.tsx` | Página cliente — KPIs, botón Recalcular/Exportar, layout a 2 columnas (tabla + panel de desglose), pide `startDate`/`endDate` a la API con el `monthRange` de los filtros |
| `app/api/coste-a1/route.ts` | API Route — construye los árboles, resuelve coste/descripción/familia y la producción real por final en el rango de fechas pedido (ver §3.3) |
| `components/nova/coste-a1-table.tsx` | Tabla jerárquica (columna izquierda, TanStack Table v8, `subRows` de profundidad variable) + buscador + filtro de familia + `MonthRangePicker`/"Filtrar" + orden por coste/nombre + selección del artículo que se ve en el panel de desglose |
| `components/nova/month-range-picker.tsx` | Selector de rango de meses (reutilizado tal cual de `/compras`) — usado aquí para pedir la producción real |
| `components/nova/coste-a1-desglose-panel.tsx` | Panel de desglose (columna derecha) — selector plano (`tabs-08`) con el artículo final + cada "11"/"10" del árbol completo por código, detalle (descripción/tipo/Coincide + lista de materiales) del nodo elegido (ver §4.2) |
| `components/nova/coste-a1-shared.tsx` | Helpers compartidos entre tabla y panel: formateo (`euros`), poda 11/12 (`podar1112`), comprobación de coste (`estadoLocal`, `estadoSubarbol`, `Descuadre` — ver §4.2.4) |

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
(`tipoDescMap` en `api/coste-a1/route.ts`, mismo patrón que `familiaDescMap`,
con `capitalizarFrase()` porque el catálogo viene en MAYÚSCULAS — mismo caso que
familia, ver `docs/compras.md` §3.2). La
regla de "final por categoría" compara directamente contra el código `'12'`, no
contra una etiqueta de texto. Un artículo sin fila en F4101 (no debería pasar con
datos reales, pero por si acaso) cae en `"Sin categoría"`.

### 3.2 Corte de ciclos

`construir()` en `api/coste-a1/route.ts` lleva un `Set` de visitados por rama — un
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

---

## 4. UI

### 4.0 Layout a 2 columnas (tabla + panel de desglose)

El panel ya no es una única tabla a ancho completo con un modal aparte — desde el
rediseño pedido explícitamente por el usuario ("que sea la tabla a la izquierda y a
la derecha el desglose, parecido al panel de compras"), `app/coste-a1/page.tsx` monta
un `grid lg:grid-cols-3` (mismo patrón que `/compras`: `Charts15`/`DeviationByFamilyChart`)
con la tabla en `lg:col-span-2` y el panel de desglose en `lg:col-span-1`.

**Ancho y filtros, igual que `/compras`** (segunda ronda de feedback, tras ver la
primera versión): el `<main>` usa `max-w-7xl`, el mismo que el resto de paneles —
la primera versión de este layout usaba `max-w-[100rem]` para que las 5 columnas de
la tabla cupieran sin scroll horizontal, pero eso rompía la coherencia de ancho con
el resto de la app; se volvió a `max-w-7xl` y en su lugar la tabla soporta scroll
horizontal (ver §4.1). Los filtros (buscador, familia, obsoletos) ya no viven dentro
de la tabla — pedido explícito ("quiero que los filtros estén arriba de los KPI") —
sino en la misma barra que Recalcular/Exportar, **antes** de las tarjetas KPI, igual
que `/compras` (`MonthRangePicker`/`Filtrar`/`Tabs` de unidad, todo antes de
`Statistics`). El estado de los filtros vive en un hook compartido,
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
defecto el primero al cargar o tras un Recalcular). El mismo clic también
pliega/despliega sus `subRows` en la tabla — no hay un botón dedicado ni una acción
separada.

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
`mrp-materials-table.tsx`), cabecera "Coste Teórico" ordenable siguiendo el patrón
real de ShadcnSpace (`datatable-03`: `onClick`/`cursor-pointer` en la propia
`<TableHead>`, sin `<button>` envolviendo el contenido).

Columnas: **Artículo** (código+descripción, badge de tipo, badge "Obsoleto" si
aplica) · **Coste Teórico** (el coste A1 de siempre) · **Producción** · **Coste
Real** · **Desviación**. La columna Familia y el botón "Ver despiece completo" de
versiones anteriores de este documento ya no existen — la familia se puede filtrar
desde el desplegable de la barra de herramientas, y el desglose se abre por
selección de fila (§4.0), no por botón.

**Producción ya es un dato real** (ver §3.3) — `DespieceNode.produccion`, solo en
la raíz. **Coste Real y Desviación siguen siendo ficticios** — pedido explícito
original del usuario ("rellena con datos ficticios porque no lo sé todavía"):
Coste Real se muestra igual al Coste Teórico y Desviación en `0,0 %`, sin
ninguna variación aleatoria que pudiera parecer un análisis real. Un aviso en
texto gris bajo la barra de herramientas lo deja explícito (actualizado al
quitar Producción de la lista de campos ficticios). Cuando exista una fuente
real para estos dos campos, sustituir el cálculo inline de `coste-a1-table.tsx`
(no hay ningún campo nuevo en `DespieceNode` para ellos, a diferencia de
`produccion` — se computan en el render a partir de `costeA1`) y del mismo modo
en `coste-a1-desglose-panel.tsx` (§4.2.1).

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

**Vigencia del BOM/coste, sin selector de fecha**: la lista de materiales y el
coste A1 siguen siendo una foto del estado vigente **hoy** — a diferencia de
compras/MRP, no dependen de ningún rango. El rango de fechas que sí existe
(`MonthRangePicker`, ver §4.1.1 y §3.3) es solo para la producción real y para
decidir qué obsoletos se ven — no recalcula el árbol ni el coste. El único
control para recargar TODO (árbol, costes, producción) es el botón
"Recalcular".

#### 4.1.1 Obsoletos — visibles solo si tuvieron producción en el rango elegido

Pregunta directa del usuario: "tengo que quitar los artículos obsoletos, no sé si
lo tenemos en cuenta". Ya existía el campo en el proyecto — `F4101.IMSTKT = 'O'`,
mismo campo que usa `/caducados` (`api/caducados/route.ts`) para el maestro de
artículo (no confundir con stock/palet obsoleto, que es un concepto distinto sobre
F41021). No se usaba en ningún panel de la familia JDE (`/produccion`, `/compras`,
MRP, coste-a1) hasta ahora.

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
en la lista). La API (`api/coste-a1/route.ts`) sigue devolviendo **todos** los
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
ensanchar el grid de `app/coste-a1/page.tsx` de `lg:grid-cols-3` (66%/33%) a
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

---

## 5. Exportación a Excel

Dos hojas (mismo patrón multi-hoja que compras/MRP):
- **Coste por artículo final**: un artículo final por fila.
- **Despiece completo**: árbol aplanado (una fila por nodo, con `Nivel` y
  `ArticuloFinal` para poder reconstruir la jerarquía en Excel).
