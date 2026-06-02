# Documentación — Control de Pedidos (`/preparacion-pedidos`)

> Documentación específica del dashboard de preparación de pedidos.
> Ver [DOCUMENTACION.md](../DOCUMENTACION.md) para la documentación base del proyecto.

---

## Preparación de Pedidos — `/preparacion-pedidos`

### Visión general

Panel para controlar el progreso de asignación de palets/lotes a pedidos de venta. Consulta la tabla **F4211** (Sales Order Detail) de Oracle JDE.

**Concepto clave:** Una línea de pedido está **asignada** si tiene lote (`SDLOTN` no vacío). Si no tiene lote, está **pendiente**. El progreso se calcula como la proporción de cantidad asignada (con lote) sobre la cantidad total pedida.

### Acceso y navegación

**Acceso configurable** — público por defecto. Cualquier usuario puede consultar sin sesión activa. El administrador puede restringirlo a roles específicos desde `/admin` → pestaña Pantallas. Si hay sesión activa, se muestran los botones de Admin/Logs y el nombre del usuario.

**Navegación:** dropdown "Paneles ▾" en la barra superior (componente `Navbar`). Ver todos los paneles disponibles en [DOCUMENTACION.md](../DOCUMENTACION.md) sección 10.

---

### API — `GET /api/plants`

**Archivo:** `app/api/plants/route.ts`

Devuelve la lista de plantas desde Oracle (tabla F0006, filtro `MCSTYL = 'BP'`).

**Respuesta:**
```json
[
  { "id": "10100", "description": "Aguilar" },
  { "id": "10200", "description": "Corella" },
  { "id": "10300", "description": "Funes" }
]
```

> **Nota:** Este endpoint se usa **solo en Pedidos**. El panel de Producción tiene las plantas hardcodeadas porque maneja lógica de sub-plantas (ver sección "Cómo Añadir Plantas").

---

### API — `GET /api/orders`

> **No confundir con `/api/jde-orders`:** ese endpoint consulta `F47011` (pedidos EDI entrantes) y está pensado para herramientas externas con autenticación por API key. Este endpoint consulta `F4211` (pedidos de venta) y requiere sesión JWT del dashboard.

**Archivo:** `app/api/orders/route.ts`

**Parámetros:**

| Param | Tipo | Descripción |
|---|---|---|
| `plant` | string (repetible) | Código planta (MCMCU de F0006). Se puede repetir para filtrar por varias: `?plant=10100&plant=10300` |
| `startDate` | string | Fecha carga desde (YYYY-MM-DD) → filtra `SDPDDJ` |
| `endDate` | string | Fecha carga hasta (YYYY-MM-DD) → filtra `SDPDDJ` |
| `deliveryStartDate` | string | Fecha entrega desde (YYYY-MM-DD) → filtra `SDRSDJ` |
| `deliveryEndDate` | string | Fecha entrega hasta (YYYY-MM-DD) → filtra `SDRSDJ` |

> **Múltiples plantas:** se leen con `searchParams.getAll('plant')` y se generan bind variables individuales `:plant0`, `:plant1`, ... para la cláusula `IN`. Oracle no soporta bind variable de tipo array en `IN`.

**Lógica:**
1. Carga nombres de planta desde F0006 (`MCSTYL = 'BP'`) para resolver `plantName` dinámicamente
2. Consulta F4211 excluyendo líneas cerradas (`SDNXTR != 999`)
   - JOIN con F0101 aliased `B` → nombre del destino (`SDSHAN → ABALPH`)
   - JOIN con F0101 aliased `C` → nombre del comprador (`SDAN8 → ABALPH`)
   - JOIN con F0111 subconsulta `D` → nombre de mailing del destino (`SDSHAN → WWMLNM`). Subconsulta agrupada para evitar duplicados: `SELECT WWAN8, MIN(TRIM(WWMLNM)) FROM F0111 GROUP BY WWAN8`
   - JOIN con F4101 aliased `E` → familia del artículo (`SDITM → IMSRP2`)
3. Agrupa por pedido (`SDDOCO`) y por artículo (`SDAITM`)
4. Clasifica cada línea como asignada (tiene `SDLOTN`) o pendiente (sin `SDLOTN`)
5. Suma `SDUORG/100` por artículo: `totalOrdered`, `totalAssigned` (con lote), `totalPending` (sin lote)
6. Calcula progreso: `totalAssigned / totalOrdered × 100`
7. Determina estado del pedido: `completado` (todos los artículos al 100%), `en_progreso` (alguno asignado), `pendiente` (ninguno asignado)
8. Registra en logs con `source: 'pedidos'`

**Respuesta:**
```json
{
  "orders": [{
    "orderNumber": 12345,
    "customerRef": "REF-2026-001",
    "loadDate": "2026-03-09T...",
    "deliveryDate": "2026-03-12T...",
    "plant": "10300",
    "plantName": "Funes",
    "shipToNum": 1234,
    "shipToDesc": "DISTRIBUCIONES EJEMPLO S.L.",
    "shipToMlnm": "DIST. EJEMPLO (NOMBRE MAILING)",
    "soldToNum": 5678,
    "soldToDesc": "CADENA SUPERMERCADOS S.A.",
    "articles": [{
      "itemNumber": "0001234567",
      "description": "PRODUCTO X",
      "familia": "01",
      "totalOrdered": 500,
      "totalAssigned": 300,
      "totalPending": 200,
      "uom": "UN",
      "progress": 60,
      "lots": [
        { "lineNumber": 1, "qtyOrdered": 300, "lot": "PAL001", "assigned": true },
        { "lineNumber": 2, "qtyOrdered": 200, "lot": "", "assigned": false }
      ]
    }],
    "totalArticles": 1,
    "overallProgress": 60,
    "status": "en_progreso"
  }],
  "summary": {
    "totalOrders": 50,
    "completados": 10,
    "enProgreso": 25,
    "pendientes": 15
  }
}
```

### Campos de F4211 utilizados

| Campo | Descripción |
|---|---|
| `SDDOCO` | Número de pedido de venta |
| `SDPDDJ` | Fecha de carga (formato JDE CYYDDD) |
| `SDRSDJ` | Fecha de entrega (formato JDE CYYDDD) |
| `SDMCU` | Planta (Business Unit) |
| `SDAITM` | Artículo (display) |
| `SDDSC1` | Descripción del artículo |
| `SDUORG` | Cantidad pedida (×100) |
| `SDLOTN` | Lote/palet asignado (vacío = pendiente) |
| `SDLNID` | Número de línea |
| `SDUOM` | Unidad de medida |
| `SDNXTR` | Estado siguiente (999 = cerrado, se excluye) |
| `SDVR01` | Referencia del cliente |
| `SDSHAN` | Número de dirección de destino (Ship To) |
| `SDAN8` | Número de dirección del comprador (Sold To) |

### Tablas auxiliares utilizadas

| Tabla | Alias | JOIN | Descripción |
|---|---|---|---|
| `F0006` | — | — | Nombres de plantas (carga inicial, no en SELECT principal) |
| `F0101` | `B` | `B.ABAN8 = A.SDSHAN` | Address Book — nombre del destino (`SHAN_DESC`) |
| `F0101` | `C` | `C.ABAN8 = A.SDAN8` | Address Book — nombre del comprador (`AN8_DESC`) |
| `F0111` | `D` (subconsulta) | `D.WWAN8 = A.SDSHAN` | Who's Who — nombre de mailing del destino (`SHAN_MLNM` / `WWMLNM`). Se agrupa por `WWAN8` con `MIN` para evitar duplicados |
| `F4101` | `E` | `E.IMITM = A.SDITM` | Item Master — familia del artículo (`FAMILIA` / `IMSRP2`) |

---

### Página — `app/preparacion-pedidos/page.tsx`

Client Component. Arquitectura de estado dividida en **estado seleccionado** (UI en tiempo real) y **estado aplicado** (efectivo al pulsar Filtrar):

```
selectedPlants[]         → enviado a API al filtrar
selectedArticles[]       → appliedArticles   (filtro cliente)
selectedDestinos[]       → appliedDestinos   (filtro cliente — por nº dirección)
selectedDestinoMlnm[]    → appliedDestinoMlnm (filtro cliente — por nombre mailing F0111)
selectedFamilia[]        → appliedFamilia    (filtro cliente — por IMSRP2 de F4101)
pedidoSearch             → appliedPedidoSearch    (filtro cliente, wildcard *)
refClienteSearch         → appliedRefClienteSearch (filtro cliente, wildcard *)
showStatus{}             → (filtro cliente, instantáneo, sin Filtrar)
```

**Filtrado cliente vs servidor:**
- Los filtros de **planta y fechas** van al servidor (parámetros en la URL de fetch)
- Los filtros de **artículo, destino, cliente, familia, búsqueda libre y estado** son cliente (useMemo sobre los datos ya cargados, se aplican al pulsar Filtrar)
- El estado (`showStatus`) es instantáneo: cambia sin necesidad de pulsar Filtrar

**Validación de fechas:** si se pulsa Filtrar con ambos rangos de fecha vacíos (carga y entrega), se muestra el mensaje `"Debes rellenar al menos un rango de fechas (Carga o Entrega)"` y no se hace la consulta. La fecha de carga puede dejarse vacía individualmente siempre que la fecha de entrega esté completa, y viceversa.

#### Layout visual

```
┌─ Panel de Filtros ──────────────────────────────────────────────────┐
│                                                                      │
│  ─ Filtros ──────────────────────────────────────────────────────   │
│  Estado:   [● Pendiente] [● En Progreso] [● Completado]             │
│  Planta:   [Todas ▾]                                                 │
│  Artículo: [Seleccionar ▾]   Destino:  [Seleccionar ▾]              │
│  Cliente:  [Seleccionar ▾]   Familia:  [Seleccionar ▾]              │
│                                                                      │
│  ─ Búsqueda ──────────────────────────────────────────────────────  │
│  Nº pedido: [ej: *12345 ó 12345*]  Ref. cliente: [ej: *REF ó REF*] │
│                                                                      │
│  ─ Fechas ────────────────────────────────────────────────────────  │
│  F.Carga:   [dd/mm/aaaa ×] → [dd/mm/aaaa ×]  (puede dejarse vacía) │
│  F.Entrega: [dd/mm/aaaa ×] → [dd/mm/aaaa ×]                        │
│                                                                      │
│  [Filtrar 🔍] [Excel ↓] [✕ Limpiar] [Presets ▾] [💾 Guardar]       │
│  ⚠ "Debes rellenar al menos un rango de fechas" (si ambos vacíos)   │
└──────────────────────────────────────────────────────────────────────┘

┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
│  Total   │ │Completad.│ │En Progr. │ │Pendientes│
│   50     │ │    10    │ │    25    │ │    15    │
└──────────┘ └──────────┘ └──────────┘ └──────────┘

┌─ Tabla de pedidos (3 niveles expandibles) ─────────────┐
│ ▶ │ 12345         │ DIST. EJEMPLO SL │ 09/03 │ 12/03 │ Funes │ 3 │ ██░ 60% │ 🟡 En Progreso │
│   │ REF-2026-001  │ (nº 1234)        │       │       │       │   │         │               │
│   ▼ (expandido — artículos)                                                                 │
│   │ ↳ 0001234567 PROD. X  │ 500 │ 300 ✓ │ 200 ⏳ │ 60% │ UN │                            │
│      ▼ (expandido — lotes)                                                                  │
│      │ ↳ PAL001 ✓ ASIGNADO  │ 300 │                                                        │
│      │ ↳ —      ⏳ PENDIENTE │ 200 │                                                        │
└────────────────────────────────────────────────────────────────────────────────────────────┘
```

#### Columnas de la tabla de pedidos (9 columnas)

| # | Cabecera | Contenido |
|---|---|---|
| 1 | — | Chevron expand/collapse |
| 2 | **Nº Pedido** / Ref. Cliente | Número de pedido en negrita. Ref. cliente en gris debajo (se omite si está vacía) |
| 3 | **Destino** | Nombre del destino. Número de dirección en gris debajo |
| 4 | **F. Carga** | Fecha de carga (`SDPDDJ`) formateada como `DD/MMM` |
| 5 | **F. Entrega** | Fecha de entrega (`SDRSDJ`) formateada como `DD/MMM` |
| 6 | **Planta** | Nombre de planta |
| 7 | **Arts.** | Número de artículos distintos |
| 8 | **Progreso** | Barra de progreso + porcentaje |
| 9 | **Estado** | Badge: `🔴 Pendiente` / `🟡 En Progreso` / `🟢 Completado` |

#### Filas de lote (nivel 3)

Las filas de lote muestran el identificador de palet con el prefijo `↳` en la columna Artículo, y un badge de estado en la columna Descripción:

- `✓ ASIGNADO` — fondo verde, texto blanco (lote tiene valor)
- `⏳ PENDIENTE` — fondo ámbar, texto oscuro (sin lote)

#### Filtros

**Estado (toggle instantáneo, sin Filtrar):** Botones con borde rojo activo. Al desactivar todos se muestran todos los pedidos.

**Planta:** `ArticleMultiSelect` con `showId={true}` (muestra código + nombre). Cargado dinámicamente desde `/api/plants`. Las plantas seleccionadas se envían al servidor como múltiples parámetros `plant`.

**Artículo:** `ArticleMultiSelect` con `showId={true}`. Lista dinámica calculada a partir de los artículos presentes en los pedidos cargados (`order.articles[].itemNumber + description`).

**Destino:** `ArticleMultiSelect` con `showId={true}`. Lista dinámica calculada a partir de `order.shipToNum + shipToDesc`. La columna de la tabla muestra también el nombre de mailing (`shipToMlnm`) debajo del nombre principal, con el mismo estilo visual que Ref. Cliente en la columna Nº Pedido.

**Cliente:** `ArticleMultiSelect` con `showId={false}`. Lista dinámica de valores `WWMLNM` de F0111 presentes en los pedidos cargados. Filtra por el nombre de mailing del destino.

**Familia:** `ArticleMultiSelect` con `showId={true}`. Opciones cargadas desde `/api/categories?field=srp2` al montar el componente (todas las familias disponibles desde el inicio, igual que en el panel de producción). Filtra pedidos donde al menos un artículo pertenece a la familia seleccionada.

**Búsqueda con comodín (`*`):**

```typescript
// matchesWildcard() — definida fuera del componente
function matchesWildcard(value: string, pattern: string): boolean {
  if (!pattern) return true
  if (!pattern.includes('*')) return value.toLowerCase().includes(pattern.toLowerCase())
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  return new RegExp('^' + escaped.replace(/\*/g, '.*') + '$', 'i').test(value)
}
```

| Patrón | Comportamiento |
|---|---|
| `12345` | Subcadena (contiene "12345") |
| `12345*` | Empieza por "12345" |
| `*12345` | Termina en "12345" |
| `*123*` | Contiene "123" |
| `12*45` | Empieza por "12" y termina en "45" |

**Fechas:** Cuatro `DatePicker` (ver sección DatePicker en `DOCUMENTACION.md`).

#### Filtrado cliente con useMemo

```typescript
const filteredOrders = useMemo(() => {
  const anyStatusActive = Object.values(showStatus).some(Boolean)
  return orders.filter(order => {
    if (anyStatusActive && !showStatus[order.status]) return false
    if (appliedArticles.length > 0 &&
        !order.articles.some(a => appliedArticles.includes(a.itemNumber))) return false
    if (appliedDestinos.length > 0 &&
        !appliedDestinos.includes(String(order.shipToNum ?? ''))) return false
    if (appliedPedidoSearch &&
        !matchesWildcard(String(order.orderNumber), appliedPedidoSearch.trim())) return false
    if (appliedRefClienteSearch &&
        !matchesWildcard(order.customerRef, appliedRefClienteSearch.trim())) return false
    if (appliedDestinoMlnm.length > 0 &&
        !appliedDestinoMlnm.includes(order.shipToMlnm)) return false
    if (appliedFamilia.length > 0 &&
        !order.articles.some(a => appliedFamilia.includes(a.familia))) return false
    return true
  })
}, [orders, showStatus, appliedArticles, appliedDestinos, appliedPedidoSearch, appliedRefClienteSearch, appliedDestinoMlnm, appliedFamilia])

const deferredOrders = useDeferredValue(filteredOrders) // evita bloquear UI al filtrar listas grandes
```

Las tarjetas de resumen (`displaySummary`) se calculan también por `useMemo` a partir de `filteredOrders`, por lo que siempre reflejan los datos visibles tras el filtrado.

#### Presets

Sistema idéntico a producción y caducados. Usa `screen='pedidos'` para aislar los presets de este panel.

**Cómo se abre el panel de presets:**
- Botón **"💾 Guardar"** dentro de la sección de filtros (siempre visible con sesión)
- Botón **"Presets"** en la Navbar superior (común a todos los paneles): incrementa una señal `presetsSignal` que un `useEffect` observa para hacer `setShowPresets(true)`

**Filtros que se guardan en un preset de pedidos:**
```json
{
  "filters": {
    "startDate": "2026-05-01",
    "endDate": "2026-05-31",
    "deliveryStartDate": "",
    "deliveryEndDate": ""
  },
  "showStatus": { "pendiente": true, "en_progreso": true, "completado": false },
  "selectedArticles": ["0001234567"],
  "selectedDestinos": ["1234"],
  "selectedDestinoMlnm": [],
  "selectedFamilia": ["01"],
  "pedidoSearch": "",
  "refClienteSearch": ""
}
```

> La planta **no se guarda** en los presets ya que las plantas disponibles son dinámicas y pueden cambiar.

#### Ordenamiento

Pendientes primero, En Progreso segundo, Completados último.

#### Export Excel

Incluye todas las líneas de los pedidos filtrados con: Pedido, Ref. Cliente, Nº Destino, Desc. Destino, Cliente, Nº Comprador, Desc. Comprador, Fecha Carga, Fecha Entrega, Planta, Artículo, Descripción, Línea, Cant. Pedida, Lote/Palet, Asignado (SÍ/NO), Totales por artículo, % Progreso, UM, Estado.

---

## Cómo Añadir Plantas y Sub-plantas al Dashboard de Producción

> **Importante:** El panel de Producción tiene las plantas y sub-plantas **hardcodeadas** a propósito. La lógica de sub-plantas (Funes 1, Funes 2, Funes Past.) está acoplada al campo `F55TAR12.TO55TAREA` y no puede resolverse dinámicamente desde Oracle. El panel de **Pedidos** sí usa plantas dinámicas desde `/api/plants` (F0006).

### Añadir una nueva planta (sin sub-plantas)

Ejemplo: añadir planta "Tudela" con código `10400`.

**Cambio 1 — `app/produccion/page.tsx`** (dropdown de planta):

Buscar el `<select>` de plantas y añadir una nueva `<option>`:
```tsx
<option value="10400">Tudela</option>
```

**Cambio 2 — `lib/utils.ts`** (función `parseJdeDate`):

En el `switch` que resuelve el nombre de planta, añadir:
```ts
case '10400':
  plantName = 'Tudela';
  break;
```

Con estos 2 cambios, la planta aparecerá en el filtro y los registros de F55TAR12 con `TRIM(TO55MCU) = '10400'` se mostrarán correctamente.

### Añadir una nueva sub-planta a una planta existente

Ejemplo: añadir sub-planta "Funes Conservas" con código de tarea `6` a la planta Funes (`10300`).

Las sub-plantas se determinan por el campo `TO55TAREA` de la tabla `F55TAR12`:
- `3` → Funes 1
- `4` → Funes 2
- `5` → Funes Past.

**Cambio 1 — `lib/utils.ts`** (función `parseJdeDate`):

En el `switch` de `TO55TAREA` dentro del case `'10300'`, añadir:
```ts
case '6':
  subPlantName = 'Funes Conservas';
  break;
```

**Cambio 2 — `app/produccion/page.tsx`** (dropdown de sub-planta):

Buscar el `<select>` de sub-planta (visible cuando `selectedPlant === '10300'`) y añadir:
```tsx
<option value="6">Funes Conservas</option>
```

### Añadir sub-plantas a una planta que no las tenía

Si la nueva planta (ej. Tudela `10400`) necesita sub-plantas:

1. En `lib/utils.ts` → `parseJdeDate`: dentro del `switch` de planta, añadir un case `'10400'` con un `switch` anidado por `TO55TAREA` (siguiendo el patrón de Funes `10300`).
2. En `app/produccion/page.tsx`: añadir lógica condicional para mostrar el dropdown de sub-planta cuando `selectedPlant === '10400'`, siguiendo el patrón existente de `10300`.

### Panel de Pedidos — plantas automáticas

El panel de Pedidos **no necesita cambios** al añadir una nueva planta. Las plantas se cargan dinámicamente desde Oracle (tabla `F0006`, filtro `MCSTYL = 'BP'`). Si se da de alta una nueva Business Unit en JDE con estilo `BP`, aparecerá automáticamente en el dropdown de pedidos.
