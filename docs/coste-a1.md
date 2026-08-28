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
| `app/coste-a1/page.tsx` | Página cliente — KPIs, botón Recalcular/Exportar, tabla |
| `app/api/coste-a1/route.ts` | API Route — construye los árboles y resuelve coste/descripción/familia |
| `components/nova/coste-a1-table.tsx` | Tabla jerárquica (TanStack Table v8, `subRows` de profundidad variable) + buscador + filtro de familia + orden por coste/nombre |

---

## 3. Esquema Oracle/JDE

| Tabla | Uso |
|---|---|
| `F3002` | Lista de materiales (BOM). `IXCMCU`=planta (`10999`), `IXKITL`=padre, `IXLITM`=componente, `IXQNTY`÷10000=cantidad, `IXUM`=unidad, `IXEFFF`/`IXEFFT`=vigencia (evaluada a **hoy**, no por mes como en MRP) |
| `F30026` | Coste A1. `IELEDG='07'` (Coste Estándar), `IECOST='A1'` (tipo de coste), `IEMMCU=10999`, importe = `IECSL`÷10000 |
| `F4101` | Descripción (`IMDSC1`) y familia (`IMSRP2`) — aquí se busca por **código largo** (`IMLITM`), no por el corto (`IMITM`) como en compras/MRP: evita el mapeo largo↔corto porque cada nodo del árbol puede ser un artículo distinto sin una previsión que traiga ya su código corto |
| `prodctl.f0005` | Catálogo UDC `41/S2` — descripción real de familia, mismo patrón que compras/MRP |

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
2. **Por tipo**: un `12` (Terminado) o `99` (Comercializado) con lista de materiales
   propia se lista como final **siempre**, aunque también aparezca como componente
   de otra línea — el reprocesado es una salida OCASIONAL, no la única. Ejemplo real
   comprobado: `1210100242` se vende normalmente tal cual (su propia BOM: materia
   prima + un "10", sin ningún "11"), pero a veces se consume como componente de
   `1110100295`, que a su vez lo consume `1110100296` (el final real de esa cadena
   de reprocesado, capturado por el caso 1). Sin el caso 2, `1210100242` quedaba
   excluido del informe por completo — solo se veía anidado dentro del despiece de
   `1110100296`, nunca por su cuenta.

Un mismo código puede así aparecer como final por sí mismo **y** anidado dentro del
despiece de otro final — no es un duplicado ni un bug, son dos hechos reales
distintos ("si se vende tal cual" / "si se reprocesa").

Los "99" entran automáticamente por el caso 2 sin caso especial en el código (mismo
`tipoDe()` que ya resuelve el resto de tipos).

`tipo` de cada nodo (solo para mostrar, no afecta a la lógica de arriba): prefijo del
código largo — `10`→Semielaborado, `11`→Semiterminado, `12`→Terminado,
`99`→Comercializado, cualquier otro (sin lista de materiales propia, hoja del
árbol)→Materia prima.

### 3.2 Corte de ciclos

`construir()` en `api/coste-a1/route.ts` lleva un `Set` de visitados por rama — un
BOM real no debería tener ciclos, pero uno los colgaría la petición si no se corta
(mismo patrón que el `explode()` de `/api/mrp`).

---

## 4. UI

### 4.1 Informe (tabla principal) — solo 11/12

El usuario pidió explícitamente que el informe no enseñe más que artículos tipo
"11"/"12" — nada de envases/etiquetas/materia prima (10, 13, 14...) ni "10". La tabla
principal usa `podar1112()` (`coste-a1-table.tsx`): copia el árbol de cada final
filtrando recursivamente sus `children` a solo `tipo === "Semiterminado" || tipo ===
"Terminado"`. Es una poda **por tipo, no por profundidad** — una cadena
`12 → 11 → 11` se ve entera; en cuanto un nodo no es 11/12 se corta ahí (y con él,
todo lo que cuelgue debajo, aunque más abajo hubiera otro 11 — no se espera ese caso
en la práctica, pero si apareciera quedaría oculto del informe a propósito).

Tabla jerárquica con `subRows` de **profundidad variable** (no fija como los 3
niveles de compras o los 2 de MRP) — la API ya devuelve el árbol completo anidado,
`coste-a1-table.tsx` solo traduce la forma (podada) a `TreeRow`. Fila completa
clicable para desplegar (mismo patrón que `hierarchical-table.tsx` y
`mrp-materials-table.tsx`), cabecera "Coste A1" ordenable siguiendo el patrón real de
ShadcnSpace (`datatable-03`: `onClick`/`cursor-pointer` en la propia `<TableHead>`,
sin `<button>` envolviendo el contenido).

**Sin scroll interno**: se probó una tabla con `max-h`+`overflow-y-auto` propio y
cabecera `sticky` (para los 200+ artículos finales), pero rompía la consistencia
visual con el resto de tablas de la app (compras, MRP), que dejan crecer la página
entera. Se quitó — la página larga es el patrón establecido, no una tabla que se
desliza dentro de sí misma.

**Orden**: solo se reordena el nivel RAÍZ (los artículos finales), nunca con
`getSortedRowModel` de TanStack — eso también reordenaría los hijos de cada árbol,
descolocando el orden por cantidad descendente que ya viene calculado desde la API
(mismo cuidado que el orden manual de `mrp-materials-table.tsx` con los meses).

**Sin selector de fecha**: a diferencia de compras/MRP, este panel no depende de un
rango — es una foto del estado vigente hoy. El único control de recarga es el botón
"Recalcular".

### 4.2 Verificación — "Ver despiece completo" (Dialog centrado)

El informe podado no sirve para comprobar que el coste A1 del final cuadra con sus
componentes (para eso hace falta ver TODO: 10/13/14 incluidos). Cada fila de final
lleva un botón "Ver despiece completo" que abre un `Dialog` centrado (no un `Sheet`
lateral — pedido explícito: "una subpantalla que aparece en medio", con animación de
apertura/cierre ya incluida en el primitivo instalado por `bunx --bun shadcn@latest
add dialog`, sin construirla a mano) con **dos comprobaciones distintas**, no una sola:

- **Global** (cabecera del Dialog): coste A1 declarado (F30026) del final vs. suma de
  TODOS sus componentes recompuesta hasta materia prima (`costeDesdeHojas()`: para
  cada hoja, `cantidad_acumulada × su_coste`, recursivo — la operación inversa a como
  JDE calcula su propio coste A1). Si algún componente no tiene coste A1, cuenta como
  0 en la suma **y no bloquea el cálculo** — se avisa aparte de cuáles son (pedido
  explícito del usuario: "si algún componente no tiene coste, se indica pero la suma
  se puede hacer igual").
- **Local, por nivel** (`TarjetaActual`): el nodo que se está viendo en cada momento
  es una **tarjeta** (`Card` de `components/nova/ui/card.tsx`) con una mini-tabla de
  sus componentes DIRECTOS (con el coste declarado de cada uno, sin bajar más, +
  subtotal por línea) y una barra de comprobación al pie — ¿esos componentes suman su
  propio coste A1 declarado? Esto es lo que permite ver en qué nivel exacto empieza
  un descuadre (ej. el "10" cuadra pero el "11" que lo usa no), sin tener que
  interpretar solo el número global de arriba.

### 4.2.1 Navegación por niveles (drill-down), sin scroll — iteración de diseño

Versiones probadas y descartadas, en orden, cada una por feedback directo del
usuario tras verla con datos reales:

1. Árbol completo indentado en una lista continua (texto suelto bajo cada nodo) →
   "se hace pesado, separar por cada desglose su resumen en recuadros".
2. Tarjetas anidadas dentro de su padre (`border-l-2` + sangría, todo el árbol de
   golpe) → el padding se acumulaba en cada nivel, seguía pesando a partir del 3er
   nivel.
3. Tarjetas independientes en grid de 2 columnas, todo el árbol de golpe, con
   `Breadcrumb` (`components/nova/ui/breadcrumb.tsx`) mostrando la ruta de cada una
   → mejor, pero para verlo entero hacía falta scroll dentro del modal (vertical) y
   a veces horizontal — rechazado explícitamente: "no quiero que haya deslizables
   ni de arriba para abajo ni de izquierda a derecha".
4. **Actual — drill-down de una tarjeta a la vez**: el modal solo pinta el nodo
   "actual" (`nodoActual`, estado `caminoActual: DespieceNode[]` = ruta desde la
   raíz). Pulsar un componente con desglose propio (`children.length > 0`, marcado
   con `<ChevronRight>`) sustituye la tarjeta por la suya; los componentes sin
   desglose (materia prima) no son clicables. El `Breadcrumb` de la tarjeta hace de
   "volver atrás": pulsar un nivel anterior recorta `caminoActual` a ese punto — el
   mismo componente que en la v3 solo mostraba la ruta, aquí además navega.

El `DialogContent` no lleva `max-h`/`overflow` — nunca hay scroll propio porque nunca
hay más que UNA tarjeta pintada a la vez. Anclado arriba (`top-8`, no centrado
verticalmente): con contenido más alto que el viewport, un modal centrado de verdad
dejaba el título fuera de la pantalla nada más abrirlo. El espaciado va más
compacto que el resto de la app (`gap-3`/`py-1.5` en vez de `gap-4`/`py-2`) para que
quepa sin scroll incluso un nodo con 8-10 componentes directos en un viewport normal
(comprobado con `agent-browser` a 1440×900).

### 4.2.2 Ruido visual y tamaño fijo — segunda ronda de feedback

Dos ajustes más, tras ver la v4 con datos reales:

- **Menos color/texto**: los badges de tipo (`Terminado`/`Semiterminado`/...) por
  fila de la mini-tabla se quitan — quedan como texto gris pequeño (`c.tipo`), no
  una píldora de color repetida en cada línea. En la cabecera de la tarjeta el
  badge del nodo actual pasa a `variant="outline"` (borde, sin relleno de color) en
  vez del `TIPO_COLOR` de 5 tonos. Los textos de comprobación (global y local) se
  acortan a `Declarado X · Suma Y [· N sin coste]` — sin la frase explicativa larga
  ni el listado de nombres de componentes sin coste (si hace falta ese detalle, se
  ve entrando en ese componente concreto). `TIPO_COLOR` se mantiene para la tabla
  del INFORME principal (`buildColumns`), que no ha cambiado — el ruido señalado era
  del modal, no del informe.
- **Tamaño fijo, no según el contenido** (probado y luego revertido): se probó una
  altura FIJA con `ScrollArea` (`components/nova/ui/scroll-area.tsx`) para que la
  tarjeta midiera igual en todos los niveles. Feedback tras verlo: "al final que no
  sea tamaño fijo el componente emergente" — se quitó `ScrollArea` y la altura fija;
  la tarjeta vuelve a ajustarse al número de componentes de cada nodo (más alta en
  un "12" con 8 componentes, compacta en un "10" con 2). Sigue sin haber scroll en
  el caso normal porque solo se pinta un nodo a la vez — la comprobación de si haría
  falta scroll en un caso extremo (un nodo con muchísimos componentes) queda
  pendiente de que se dé el caso real, no resuelta de antemano.

### 4.2.3 Columna "Cantidad" quitada del informe

Pedido explícito: la tabla principal (el informe, no el modal de verificación) ya no
tiene columna "Cantidad" — se queda en Artículo / Familia / Coste A1. La cantidad
sigue viéndose en el modal (mini-tabla de `TarjetaActual`), donde sí tiene sentido
(cantidad de cada componente por unidad de su padre).

El botón "Ver despiece completo" usa `e.stopPropagation()` — sin eso, el clic también
dispara el `onClick` de la fila entera (desplegar/plegar) a la vez que abre el Dialog.

**Portal del Dialog y del Sheet corregidos**: ambos primitivos (`components/nova/ui/dialog.tsx`,
`components/nova/ui/sheet.tsx`) se parchearon con `useNovaPortalContainer()` — mismo
bug ya corregido en popover/select/navigation-menu (el `Portal` escapa de
`[data-nova-theme]` a `document.body` por defecto y hereda los tokens del sistema
viejo). El Sheet no se había parcheado antes porque, hasta este panel, nadie lo
usaba de verdad en una rama mergeada — sigue viviendo en el menú móvil del `Header`
(`topbar-02/header/index.tsx`).

### 4.2.4 Indicadores de descuadre interno (informe + filas del desglose)

Pedido explícito: no basta con la comprobación global (final vs. suma hasta materia
prima) ni con la comprobación local de un solo nivel — puede haber un descuadre
"escondido" varios niveles más abajo que la suma global no deja ver (dos errores
podrían compensarse por casualidad y la global "cuadrar" sin que nada esté realmente
bien). `tieneProblemaInterno(n)` (`coste-a1-table.tsx`) recorre TODO el subárbol de
`n` y devuelve `true` si el propio nodo o **cualquier** descendiente tiene un
descuadre local (sus componentes directos no suman su propio coste declarado).

- **Informe (tabla principal)**: si `tieneProblemaInterno(final)` es `true` sobre el
  árbol SIN PODAR (no `podar1112(n)` — un descuadre puede estar en un "10"/"13"/"14"
  que el informe no enseña, y aun así hay que avisar), aparece un icono de alerta
  rojo junto al botón "Ver despiece completo". Se calcula una vez al construir
  `treeData` y se guarda en `TreeRow.tieneProblema` (solo relleno en la fila raíz).
- **Modal — mini-tabla de `TarjetaActual`**: cada fila con desglose propio
  (`children.length > 0`) se pinta con un tinte de fondo — rojo
  (`bg-[color:var(--color-destructive)]/8`) si `tieneProblemaInterno(componente)` es
  `true`, verde (`bg-[color:var(--color-success)]/8`) si es `false`. Las filas de
  materia prima (sin desglose propio, nada "de dentro" que comprobar) se quedan sin
  colorear. Así, al entrar en un "11", se ve de un vistazo en qué "10" concreto
  empieza el problema sin tener que abrir cada uno para comprobarlo.

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
