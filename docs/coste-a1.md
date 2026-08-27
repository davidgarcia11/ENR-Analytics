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

Por eso la regla para decidir "esto es un final, se vende tal cual" es **estructural**,
no por prefijo: un artículo es final si tiene lista de materiales propia (aparece
como `IXKITL`) y **nunca** aparece como componente (`IXLITM`) de ninguna otra línea,
en la planta `10999`. Así entran automáticamente los "99" (producto comercializado)
si califican, sin caso especial — y el "12" reprocesado del ejemplo queda
correctamente excluido de la lista de finales (su árbol se ve colgando del artículo
que sí lo consume).

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

### 4.2 Verificación — "Ver despiece completo" (Sheet)

El informe podado no sirve para comprobar que el coste A1 del final cuadra con sus
componentes (para eso hace falta ver TODO: 10/13/14 incluidos). Cada fila de final
lleva un botón "Ver despiece completo" que abre un `Sheet` lateral
(`components/nova/ui/sheet.tsx`) con:

- El árbol **completo sin podar** de ese final (componente `ArbolCompleto`, lista
  recursiva simple — no una tabla TanStack aparte, no hace falta ordenar/filtrar un
  único árbol ya acotado a un artículo).
- Una cabecera de verificación: **coste A1 declarado** (F30026) vs. **suma de
  componentes recompuesta hasta materia prima** (`costeAcumulado()`: para cada nodo,
  `Σ cantidad_hijo × coste(hijo)`, recursivo — la operación inversa a como JDE calcula
  su propio coste A1, así que en teoría debería coincidir), con un badge de
  ✓ coincide / ⚠ descuadre (tolerancia 0,01 €) / ⚠ cálculo incompleto (si algún
  componente por el camino no tiene fila en F30026, la suma parcial no es de fiar).

El botón usa `e.stopPropagation()` — sin eso, el clic también dispara el
`onClick` de la fila entera (desplegar/plegar) a la vez que abre el Sheet.

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
