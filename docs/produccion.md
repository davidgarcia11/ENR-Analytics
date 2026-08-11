# Documentación — Dashboard de Producción (`/produccion`)

> Documentación específica del panel de producción de Elaborados Naturales.
> Ver [DOCUMENTACION.md](../DOCUMENTACION.md) para la documentación base del proyecto (auth, admin, logs, presets, stack técnico).

---

## 1. ¿Qué hace este panel?

El dashboard de producción es la pantalla principal de la app. Permite a los usuarios de fábrica consultar en tiempo real:

- **Qué se ha fabricado** por fecha, planta, artículo y línea de producción
- **Cuánta merma** ha habido (desperdicio en el proceso) y qué porcentaje representa
- **KPIs globales**: unidades totales, órdenes activas, % merma global, planta con mayor volumen
- **Exportar a Excel** con formato condicional (las filas con más merma se resaltan en rojo)

Los datos vienen de **Oracle JD Edwards (JDE)**, el ERP de la empresa. La app consulta sus tablas en tiempo real cada vez que el usuario pulsa "Filtrar".

---

## 2. Archivos involucrados

```
app/
  produccion/
    page.tsx                  ← Página principal (Client Component)
  api/
    production/
      route.ts                ← GET /api/production — endpoint principal de datos
      merma-breakdown/
        route.ts              ← GET /api/production/merma-breakdown — desglose por tipo (Q/P)
    categories/
      route.ts                ← GET /api/categories?field=X — opciones de filtros
    production-lines/
      route.ts                ← GET /api/production-lines — líneas de producción

components/
  FilterPanel.tsx             ← Panel de filtros (incluye presets)
  ArticleMultiSelect.tsx      ← Desplegable multi-selección con búsqueda
  MermaBreakdown.tsx          ← Tabla agrupada Q/P para card global y popover
  MermaCellPopover.tsx        ← Envoltorio popover para la celda Merma de la tabla

lib/
  utils.ts                    ← parseJdeDate(), parseWasOqs(), cn()
  db.ts                       ← Conexión Oracle
```

---

## 3. Flujo completo de datos

Este es el recorrido completo desde que el usuario abre la app hasta que ve la tabla de producción:

```
1. El usuario abre /produccion
   └── page.tsx se monta
       ├── checkSession() → GET /api/auth/me (¿está logueado?)
       └── fetchData() con filtros de HOY → GET /api/production?startDate=hoy&endDate=hoy

2. La API /api/production recibe la petición
   ├── Construye SQL dinámico (JOINs y WHERE condicionales según filtros)
   ├── Ejecuta contra Oracle JDE
   ├── Obtiene unidades primarias (F4101) y conversiones (F41002)
   ├── Procesa filas: parsea fechas JDE, convierte unidades, agrupa por orden+día
   ├── Calcula % merma por fila
   ├── Registra la consulta en SQLite (query_logs)
   └── Devuelve { data: [...], sqlRowCount: N }

3. page.tsx recibe los datos
   ├── Actualiza state data[]
   ├── Calcula métricas (KPIs): totalQtyUN, totalQtyKG, totalOrders, byPlant, totalMerma
   ├── Extrae artículos únicos para el multi-select de Artículo
   └── React renderiza: tarjetas KPI + tabla

4. La tabla (ProductionTable) muestra los datos via displayData (useMemo)
   └── displayData agrupa opcionalmente por artículo y ordena por % merma descendente
```

---

## 4. Tablas de Oracle JDE

### ¿Qué es JDE y por qué las tablas tienen nombres raros?

JD Edwards es el ERP que usa la empresa. Sus tablas tienen nombres tipo `F4801`, `F4111`, etc. — son nombres estándar del software, no los hemos puesto nosotros. Los campos también tienen nombres crípticos (`WADOCO`, `ILTRQT`...) porque vienen de los años 80 cuando los nombres de columna tenían un límite de caracteres muy corto.

### Tablas principales

| Tabla | Descripción | Campos clave usados |
|---|---|---|
| **F55TAR12** | Tareas de producción (tabla custom) | `TODOCO` (nº orden), `TO55TAREA` (código fecha+sublínea) |
| **F4801** | Órdenes de fabricación | `WADOCO` (nº orden), `WAMCU` (planta), `WAAITM` (artículo display), `WAITM` (artículo corto interno) |
| **F4111** | Movimientos de inventario (Item Ledger) | `ILDOC` (nº orden), `ILTRDJ` (fecha JDE), `ILDCT` (tipo: `IC`=producción, `IS`=merma), `ILTRQT` (cantidad ×100), `ILRCD` (código razón), `ILTRUM` (unidad de medida), `ILMCUZ` (línea producción), `ILTDAY` (hora HHMMSS) |
| **F4101** | Maestro de artículos | `IMITM` (ID corto), `IMUOM1` (UM primaria), `IMDSC1` (descripción), `IMPRP6` (tipo proceso), `IMSRP1..5` (categorías) |
| **F554101** | Extensión del maestro (tabla custom) | `AAITM` (ID corto), `AAZE03` (gramaje) |
| **F41002** | Conversiones de unidad de medida | `UMITM` (ID corto), `UMUM` (UM origen), `UMRUM` (UM destino), `UMCONV` (factor ×10.000.000) |
| **F30006** | Centros de trabajo (Work Center) | `IWMCU` (código línea), `IWAPSC` (estado activo) |
| **F0006** | Unidades de negocio (Business Units) | `MCMCU` (código), `MCDL01` (descripción) |
| **prodctl.f0005** | Catálogos UDC (User Defined Codes) | `DRSY` (sistema), `DRRT` (tipo), `DRKY` (código), `DRDL01` (descripción) |

### Relaciones entre tablas

```
F55TAR12 (tareas)
    │ TODOCO = WADOCO
    ▼
F4801 (órdenes de fabricación)
    │ WAITM = IMITM
    ├──────────────► F4101 (maestro artículos)
    │                    │ IMITM = AAITM
    │                    └──► F554101 (extensión — gramaje)
    │                    │ IMPRP6/IMSRP1..5 = DRKY
    │                    └──► prodctl.f0005 (catálogos UDC)
    │ WADOCO = ILDOC
    ▼
F4111 (movimientos de inventario)
    │ ILTRUM = UMUM, WAITM = UMITM
    └──► F41002 (conversiones de UM)
    │ ILMCUZ = IWMCU
    └──► F30006 + F0006 (líneas de producción)
```

### El campo TO55TAREA — el más importante (y confuso)

`TO55TAREA` es un campo entero de 6 dígitos que JDE usa de forma "creativa":

```
Ejemplo: 326061
│
├── Primer dígito (3) → Sub-línea de producción
│   └── Funes: 3=Funes1, 4=Funes2, 5=Funes Past. / Aguilar: 1 / Corella: 2
│
└── Últimos 5 dígitos (26061) → Fecha en formato YYDDD
    ├── YY = 26 → año 2026
    └── DDD = 061 → día 61 del año → 2 de marzo de 2026
```

Por eso `MOD(TO55TAREA, 100000)` extrae solo la parte de fecha (sin el código de sub-línea).

**Problema histórico:** En el pasado, todas las plantas usaban el subcode `1` y `2`. Luego se migró a `3`, `4`, `5` para Funes. Para no perder datos históricos, la API busca ambos rangos cuando hay sub-línea:

```ts
// Funes 1 (subcode actual=3, antiguo=1)
oldSubCodeMap = { '10300': { 3: 1, 4: 2 } }
// Esto hace que al filtrar "Funes 1" se incluyan registros con subcode 3 Y con subcode 1
```

---

## 5. API Route — `GET /api/production`

**Archivo:** `app/api/production/route.ts`

Este es el endpoint más complejo de toda la app. Se encarga de todo el procesamiento de datos.

### Parámetros de entrada

| Parámetro | Tipo | Descripción |
|---|---|---|
| `plant` | string | Código de planta (`10100`, `10200`, `10300`) o vacío = todas |
| `subLine` | string | Código de sub-línea (`3`, `4`, `5` para Funes) o `all` |
| `startDate` | string | Fecha inicio `YYYY-MM-DD` |
| `endDate` | string | Fecha fin `YYYY-MM-DD` |
| `startTime` | string | Hora inicio `HH:MM` (opcional) |
| `endTime` | string | Hora fin `HH:MM` (opcional) |
| `article[]` | string[] | Artículos (10 dígitos exactos, multi-valor) |
| `prp6[]` | string[] | Tipo proceso OF (multi-valor) |
| `srp1[]`..`srp5[]` | string[] | Categorías (multi-valor) |
| `ze03[]` | string[] | Gramaje (multi-valor) |
| `prodLine[]` | string[] | Líneas de producción (multi-valor) |
| `page` | number | Página (por defecto 1) |
| `limit` | number | Registros por página (150 normal, 0 = todos) |

### Lógica paso a paso

#### Paso 1: JOINs condicionales

El SQL base solo une las tablas imprescindibles. Los JOINs a F4101 y F554101 se añaden **solo si** el usuario está filtrando por esas categorías:

```ts
// Solo hace JOIN a F4101 si hay filtro de categoría (prp6, srp1..5)
const extraJoins = (prp6s.length > 0 || srp3s.length > 0 || ...)
    ? `INNER JOIN F4101 D ON D.IMITM = A.WAITM`
    : '';

// Solo hace JOIN a F554101 si hay filtro de gramaje (ze03)
const extraJoins554101 = ze03s.length > 0
    ? `INNER JOIN F554101 E ON E.AAITM = A.WAITM`
    : '';
```

Esto evita JOINs innecesarios que ralentizan la consulta.

#### Paso 2: SQL base

```sql
SELECT
  A.WADOCO,              -- Número de orden
  B.TO55TAREA,           -- Código fecha+sublínea
  TRIM(M.IMDSC1) AS IMDSC1,  -- Descripción (del maestro, no de la orden)
  SUM(CASE WHEN C.ILDCT = 'IC' THEN C.ILTRQT ELSE 0 END) as WASOQS,  -- Producción total
  SUM(CASE WHEN C.ILDCT = 'IS' THEN C.ILTRQT ELSE 0 END) as MERMA,   -- Merma total
  A.WAMCU,               -- Código de planta
  A.WAAITM,              -- Artículo display (lo que ve el usuario)
  A.WAITM,               -- Artículo corto interno (para conversiones)
  C.ILTRUM as ILTRUM     -- Unidad de medida del movimiento
FROM (
  -- Subquery de deduplicación: si hay 2 registros de F55TAR12
  -- para la misma orden+fecha (subcodes 1 y 3), quedarse con el más reciente (MAX)
  SELECT TODOCO, MAX(TO55TAREA) as TO55TAREA
  FROM F55TAR12
  GROUP BY TODOCO, MOD(TO55TAREA, 100000)
) B
INNER JOIN F4801 A ON A.WADOCO = B.TODOCO
INNER JOIN F4101 M ON M.IMITM = A.WAITM
LEFT JOIN F4111 C ON C.ILDOC = A.WADOCO
  AND MOD(C.ILTRDJ, 100000) = MOD(B.TO55TAREA, 100000)  -- Mismo día
  AND (
    C.ILDCT = 'IC'  -- Movimiento de producción
    OR (C.ILDCT = 'IS' AND TRIM(C.ILRCD) IN ('P01',...,'Q10'))  -- Merma con código válido
  )
```

**¿Por qué LEFT JOIN en F4111?** Porque una orden puede existir sin movimientos de inventario (recién creada). Con INNER JOIN perderíamos esas órdenes.

**¿Por qué la descripción viene de F4101 y no de F4801?** `F4801.WADL01` (descripción de la orden) puede variar entre órdenes del mismo artículo. `F4101.IMDSC1` (descripción del maestro) es siempre la misma para el mismo artículo. Si usáramos F4801, el multi-select de artículo mostraría duplicados.

#### Paso 3: Filtro de fechas

Las fechas se convierten de `YYYY-MM-DD` a formato JDE (`YYDDD`) para compararlas con `TO55TAREA`:

```ts
const startYY = start.getFullYear() - 2000;  // 2026 → 26
const startDDD = getDayOfYear(start);          // 2 marzo → 61
const startJdeSuffix = (startYY * 1000) + startDDD;  // 26061

// En SQL: MOD(B.TO55TAREA, 100000) >= 26061
// MOD elimina el primer dígito (sub-línea) dejando solo la fecha
```

#### Paso 4: Filtro de horas

`ILTDAY` en F4111 es un entero con formato `HHMMSS` sin ceros a la izquierda:
- `083000` = 08:30:00 → pero Oracle lo guarda como `83000` (sin cero inicial)

La conversión `HH * 10000 + MM * 100 + SS`:
- `08:30` → `8 * 10000 + 30 * 100 + 0` = `83000`
- `22:39:16` → `223916`

```ts
// Al filtrar por hora fin, si el usuario pone "08:30" sin segundos,
// usamos :59 para incluir todo el minuto 08:30
const timeToIntEnd = (hhmmss) => {
    const [hh, mm, ss] = hhmmss.split(':').map(Number);
    return hh * 10000 + mm * 100 + (ss !== undefined ? ss : 59);
}
```

`COALESCE(C.ILTDAY, 0)` trata los registros sin hora como medianoche (0). Así no se pierden movimientos sin timestamp.

#### Paso 5: Filtros de categoría y artículo

Los artículos se validan con regex antes de añadirlos al SQL:
```ts
if (!/^\d{10}$/.test(a)) return error 400;  // Debe ser exactamente 10 dígitos
```

Los filtros de categoría usan bind variables dinámicas (una por valor):
```ts
// Para prp6 = ['A', 'B', 'C']
// Genera: AND TRIM(D.IMPRP6) IN (:prp6_0, :prp6_1, :prp6_2)
const placeholders = prp6s.map((_, i) => `:prp6_${i}`).join(', ');
sql += ` AND TRIM(D.IMPRP6) IN (${placeholders})`;
```

> **¿Por qué bind variables y no concatenar?** Seguridad. Si concatenaras el valor del usuario directamente en el SQL, alguien podría inyectar SQL malicioso. Con bind variables, Oracle trata el valor siempre como dato, nunca como código.

#### Paso 6: Conversión de unidades (BFS)

Este es el mecanismo más complejo. JDE puede tener la producción registrada en una unidad (ej: `KG`) pero la unidad primaria del artículo es otra (ej: `UN`). La API necesita convertirlo todo a la misma unidad para sumar correctamente.

**El problema:** Las conversiones no siempre son directas. Puede que no haya conversión de `KG` a `UN` directa, pero sí `KG` → `CJ` → `UN`.

**La solución:** BFS (Breadth-First Search, búsqueda en anchura) hasta 3 niveles de profundidad.

```
Ejemplo:
F41002 tiene: KG→CJ (factor 0.5), CJ→UN (factor 12)
Para convertir KG→UN: no hay ruta directa
BFS nivel 1: KG→CJ (factor 0.5)
BFS nivel 2: CJ→UN (factor 12)
Factor acumulado: 0.5 × 12 = 6 → 1 KG = 6 UN
```

```ts
// Los factores en F41002 vienen × 10.000.000
// Factor "1.0" se guarda como 10000000 → dividir siempre por 10^7
const stepFactor = step.factorObj / 10000000.0;
```

#### Paso 7: Agrupación y cálculo de merma

El SQL agrupa por `(orden, fecha, artículo, unidad)`. Pueden venir varias filas con distintas unidades para la misma orden+día. La API las agrupa en memoria:

```ts
// Clave única: orden + fecha
const groupKey = `${order}-${productionDateRaw}`;
// Si ya existe el grupo, sumamos cantidad y merma
group.quantity += finalQty;
group.merma += finalMerma;
```

**Fórmula % merma:**
```
merma viene como número NEGATIVO de Oracle (los IS restan stock)
|merma| / (|merma| + producido) × 100

Ejemplo: producido=1000, merma=-50
→ 50 / (50 + 1000) × 100 = 4.76%
```

#### Paso 8: Respuesta

```json
{
  "data": [
    {
      "order": "12345",
      "date": "2026-03-02T00:00:00.000Z",
      "productionDateRaw": 326061,
      "description": "CHORIZO EXTRA 250G",
      "quantity": 1500,
      "merma": -50,
      "mermaPercent": 3.23,
      "unit": "UN",
      "plantCode": "10300",
      "article": "0001234567",
      "subLine": "Funes 1",
      "subLineCode": "3"
    }
  ],
  "sqlRowCount": 150
}
```

`sqlRowCount` es el número de filas SQL **antes** de agrupar en memoria. Se usa en el frontend para saber si hay más páginas (si < 150, no hay más).

---

## 6. API Route — `GET /api/categories`

**Archivo:** `app/api/categories/route.ts`

Devuelve las opciones disponibles para cada desplegable de filtro (Tipo Proceso, Formato, Sabor, etc.).

### FIELD_MAP — la clave del sistema

```ts
const FIELD_MAP = {
    prp6: { col: 'IMPRP6', drsy: '41', drrt: '01' },            // Tipo Proceso OF
    srp3: { col: 'IMSRP3', drsy: '41', drrt: 'S3', directF0005: true }, // Formato
    srp5: { col: 'IMSRP5', drsy: '41', drrt: 'S5', directF0005: true }, // Sabor
    srp2: { col: 'IMSRP2', drsy: '41', drrt: 'S2', directF0005: true }, // Familia
    srp1: { col: 'IMSRP1', drsy: '41', drrt: 'S1', directF0005: true }, // Categoría
    srp4: { col: 'IMSRP4', drsy: '41', drrt: 'S4', directF0005: true }, // Marca
    ze03: { col: 'AAZE03', drsy: '17', drrt: 'B3', directF0005: true }, // Gramaje
}
```

Cada clave del mapa es el nombre del parámetro que se pasa en la URL (`?field=prp6`).

### Dos modos de consulta

**Sin `directF0005`** (ej: `prp6`): Consulta F4101 para obtener solo los valores **realmente en uso** y los cruza con F0005 para la descripción. Así el desplegable no muestra opciones vacías.

**Con `directF0005`** (ej: `srp3`, `srp5`...): Consulta directamente F0005. Necesario cuando el campo CHAR de F0005 tiene padding diferente al de F4101 y el JOIN no funciona bien.

### Respuesta

```json
[
  { "id": "A", "description": "Ahumados" },
  { "id": "B", "description": "Cocidos" }
]
```

---

## 7. API Route — `GET /api/production-lines`

**Archivo:** `app/api/production-lines/route.ts`

Devuelve las líneas de producción activas cruzando F30006 (Work Center) con F0006 (Business Units).

El filtro `IWAPSC >= '1'` excluye líneas inactivas.

Se añade `{ id: '__empty__', description: 'Sin línea' }` al inicio para permitir filtrar registros sin línea asignada (`ILMCUZ` vacío).

---

## 8. Componente `FilterPanel.tsx`

**Archivo:** `components/FilterPanel.tsx`

Este componente gestiona todo el panel de filtros del dashboard: categorías, fechas, horas, planta, sub-planta, presets y acciones.

### Diseño clave: "draft state" aislado

El estado de los filtros **vive dentro de FilterPanel**, no en el Dashboard padre. Esto es fundamental para el rendimiento:

```
Usuario escribe en un input
  → setState en FilterPanel        ← solo re-renderiza FilterPanel
  → Dashboard NO re-renderiza      ← la tabla con miles de filas no se toca

Usuario pulsa "Filtrar"
  → onApply(filtros) → Dashboard   ← Dashboard recibe los filtros definitivos
  → fetchData() → nueva consulta a la API
```

Si el estado estuviera en el Dashboard, cada tecla que el usuario pulse re-renderizaría la tabla entera.

### Props

| Prop | Tipo | Descripción |
|---|---|---|
| `sessionUser` | `SessionUser \| null` | Usuario logueado (null = invitado) |
| `availableArticles` | `{ id, description }[]` | Artículos para el multi-select (actualiza tras cada búsqueda) |
| `loading` | `boolean` | Deshabilita el botón Filtrar mientras carga |
| `dataLength` | `number` | Deshabilita el botón Excel si no hay datos |
| `groupByArticle` | `boolean` | Estado del toggle "Agrupar por artículo" |
| `onApply` | `(filters) => void` | Callback cuando el usuario pulsa "Filtrar" |
| `onExcel` | `() => void` | Callback cuando el usuario pulsa "Excel" |
| `onGroupByArticleChange` | `(value) => void` | Callback para el toggle de agrupación |
| `openPresetsSignal` | `number` | Se incrementa desde el header para abrir el panel de presets |

### Carga de opciones al montar

Al montarse el componente, dispara 8 fetches en paralelo para poblar todos los desplegables:

```ts
useEffect(() => {
    ['prp6', 'srp3', 'srp5', 'srp2', 'srp1', 'srp4', 'ze03'].forEach((field, i) =>
        fetch(`/api/categories?field=${field}`).then(...)
    )
    fetch('/api/production-lines').then(...)
}, [])
```

Esto ocurre **una sola vez** al cargar la página, no en cada búsqueda.

### Plantas hardcodeadas — ¿por qué?

Las plantas (`Aguilar`, `Corella`, `Funes`) están hardcodeadas en el `<select>`. **No** se cargan dinámicamente desde Oracle como en otros paneles.

El motivo: la lógica de sub-plantas de Funes depende del primer dígito de `TO55TAREA`, que es un campo custom de la empresa. No hay forma de determinar eso dinámicamente desde F0006.

### Señal para presets desde el header

El botón "Presets" se renderiza dentro de `<Navbar>` (montado por `AppShell`), pero el panel de presets está dentro de `FilterPanel`. Para comunicarlos sin hacer que FilterPanel sea descendiente del header, se usa un "signal counter":

```ts
// En page.tsx: onPresetsClick se pasa dentro del objeto navbar de AppShell,
// que lo reenvía a <Navbar>. Al pulsar el botón "Presets" del Navbar:
<AppShell navbar={{ ..., onPresetsClick: () => setPresetsSignal(s => s + 1) }} ...>
  <FilterPanel openPresetsSignal={presetsSignal} ... />
</AppShell>

// En FilterPanel: observa cambios en la señal
useEffect(() => {
    if ((openPresetsSignal ?? 0) > 0) setShowPresets(true)
}, [openPresetsSignal])
```

Cada vez que el número cambia, FilterPanel abre su panel de presets.

### Estructura visual del panel de filtros

```
┌─ Panel de Presets (solo visible si logueado y abierto) ──────┐
│ [Guardar preset actual: nombre + checkboxes fechas/horas]    │
│ [Lista de presets guardados con botones cargar/editar/borrar] │
└──────────────────────────────────────────────────────────────┘

┌─ Panel de Filtros ───────────────────────────────────────────┐
│ ── CATEGORÍAS ──                                             │
│ Artículo │ Tipo Proc. │ Formato │ Sabor │ Familia │ ...     │
│                                                              │
│ ── FECHAS Y PLANTA ──                                        │
│ F.Inicio │ F.Fin │ H.Inicio │ H.Fin │ Planta │ Sub-planta  │
│                                                              │
│ ── ACCIONES ──                                               │
│ [Agrupar] [Filtrar] [Excel] [Limpiar] [Preset ▼] [Guardar] │
└──────────────────────────────────────────────────────────────┘
```

---

## 9. Componente `ArticleMultiSelect.tsx`

**Archivo:** `components/ArticleMultiSelect.tsx`

Desplegable reutilizable de multi-selección con búsqueda. Se usa para los 9 filtros de categoría del panel.

### Props

| Prop | Tipo | Default | Descripción |
|---|---|---|---|
| `articles` | `{ id, description }[]` | — | Opciones disponibles |
| `selected` | `string[]` | — | IDs seleccionados actualmente |
| `onChange` | `(selected) => void` | — | Callback cuando cambia la selección |
| `label` | `string` | `"Artículos"` | Texto del placeholder y buscador |
| `showId` | `boolean` | `true` | Si mostrar el ID además de la descripción |

### Comportamiento

1. El botón muestra "Filtrar por X..." si nada seleccionado, o "N seleccionados" si hay selección
2. Al hacer clic, abre un panel flotante (`z-50`) con un input de búsqueda
3. La búsqueda filtra en tiempo real por ID o descripción
4. Botones "Sel. todos" / "Ninguno" para selección masiva
5. Cierra al hacer clic fuera (via event listener en `document`)

---

## 10. Página principal `app/produccion/page.tsx`

**Archivo:** `app/produccion/page.tsx`

Client Component. Orquesta todos los componentes y gestiona el estado global del dashboard.

### Estados del componente Dashboard

| Estado | Tipo | Para qué |
|---|---|---|
| `sessionUser` | `SessionUser \| null` | Usuario logueado (null = invitado) |
| `presetsSignal` | `number` | Señal para abrir el panel de presets desde el header |
| `data` | `any[]` | Registros de producción cargados |
| `loading` | `boolean` | `true` mientras hay una petición en curso |
| `page` | `number` | Página actual para paginación |
| `hasMore` | `boolean` | Si hay más páginas por cargar |
| `availableArticles` | `{ id, description }[]` | Artículos para el multi-select (se extrae de los datos cargados) |
| `groupByArticle` | `boolean` | Toggle de agrupación por artículo |
| `appliedFilters` | `AppliedFilters` | Últimos filtros enviados a la API (para paginación) |
| `metrics` | `object` | KPIs calculados: totalQtyUN, totalQtyKG, totalOrders, byPlant, totalMerma, totalProduced |

### Función `fetchData`

Es la función central. Construye la URL con todos los parámetros y llama a `/api/production`.

```ts
// 00:00 y 00:00:00 se consideran "sin hora" y no se envían a la API
if (startTime && startTime !== '00:00' && startTime !== '00:00:00')
    params.append('startTime', startTime)
```

`isNewSearch=true` reinicia los datos (nueva búsqueda). `isNewSearch=false` los añade a los existentes (paginación).

### `displayData` — agrupación en el frontend

Además de la agrupación que hace la API en Oracle, el frontend hace **una segunda agrupación** en `useMemo`:

```ts
const displayData = useMemo(() => {
    // Clave normal: artículo + fecha + sub-línea + unidad
    // Clave con agrupación: artículo + sub-línea + unidad (sin fecha)
    const key = groupByArticle
        ? `${item.article}-${item.subLineCode}-${item.unit}`
        : `${item.article}-${item.productionDateRaw}-${item.subLineCode}-${item.unit}`
    // Suma cantidades y merma de grupos coincidentes
    // Recalcula % merma
    // Ordena por % merma descendente
}, [deferredData, deferredGroupByArticle])
```

¿Por qué agrupar dos veces? La API agrupa por `(orden, fecha, artículo, unidad)` — misma orden en mismo día. El frontend puede además colapsar todas las fechas en una sola línea por artículo (modo "Agrupar por artículo").

### Rendimiento con datasets grandes

Con miles de filas, editar un input sin optimización hace que React re-calcule y re-renderice la tabla entera en cada tecla.

**Solución en dos capas:**

**1. `useDeferredValue`** — marca los datos como "baja prioridad". React procesa primero los cambios en los inputs y actualiza la tabla cuando tiene tiempo libre:

```ts
const deferredData = useDeferredValue(data)               // Baja prioridad
const deferredGroupByArticle = useDeferredValue(groupByArticle)
const displayData = useMemo(() => { ... }, [deferredData, deferredGroupByArticle])
// displayData solo cambia cuando cambian los datos reales, no al editar filtros
```

**2. `React.memo` en `ProductionTable`** — la tabla es un componente separado. `React.memo` hace que React solo la re-renderice si sus props cambian:

```
Usuario edita fecha en FilterPanel
  → FilterPanel re-renderiza (solo él)
  → Dashboard re-renderiza (pero deferredData no ha cambiado)
  → ProductionTable: props idénticas → React.memo cancela el render ← NO hace nada

Usuario pulsa "Filtrar"
  → fetchData() → data cambia → deferredData cambia → displayData recalcula
  → ProductionTable: props nuevas → re-render normal
```

**¿Por qué `getMermaColor` está dentro de `ProductionTable` y no en `Dashboard`?** Si estuviera fuera, sería una prop o una función nueva en cada render del Dashboard, lo que haría fallar `React.memo` al comparar props.

### Cálculo de métricas (KPIs)

```ts
newData.forEach(item => {
    if (item.unit === 'UN') qtyUN += item.quantity     // Solo cuenta UN como unidades
    else if (item.unit === 'KG') qtyKG += item.quantity // Solo cuenta KG como kilos
    orders.add(item.order)                              // Set para contar órdenes únicas
    plants[item.subLine] = (plants[item.subLine] || 0) + item.quantity
    totalMerma += Math.abs(item.merma)
    totalProduced += item.quantity
})
```

### Tarjetas KPI (4)

| Tarjeta | Muestra | Color del % merma |
|---|---|---|
| Cantidad Total | UN y KG (si hay) | — |
| Órdenes | Total de órdenes únicas | — |
| Merma | % global + cantidad/producido | Verde <2%, Ámbar 2-5%, Rojo >5% |
| Top Planta | Planta con más volumen | — |

### Paginación

- La API devuelve 150 registros por página por defecto
- `hasMore` se pone a `false` cuando `sqlRowCount < 150` (la API devolvió menos de una página completa)
- "Cargar más" llama a `fetchData` con `page+1` y `isNewSearch=false` (añade al array)
- "Cargar todos" llama a `fetchData` con `limit=0` (todos de golpe, sin paginación)

### Accesos rápidos en la barra superior

La barra superior (junto a la sesión del usuario) incluye botones de navegación a otros paneles:

| Botón | Destino | Visible para |
|---|---|---|
| Caducados | `/caducados` | Todos |
| Logs | `/admin/logs` | Solo admins |

---

## 11. Exportación a Excel

**Función:** `exportToExcel()` en `app/produccion/page.tsx`

Genera un `.xlsx` con los datos visibles actualmente en `displayData` (respetando la agrupación activa).

### Columnas generadas

| Columna | Valor | Tipo Excel |
|---|---|---|
| Fecha | Fecha localizada o raw | Texto |
| Articulo | Código artículo (WAAITM) | Texto |
| Descripcion | Descripción del maestro | Texto |
| Planta | Nombre sub-línea | Texto |
| Fabricado | Cantidad redondeada | Número |
| Merma | Merma absoluta redondeada | Número |
| Fabricado + Merma | Suma de ambos | Número |
| % Merma | `mermaPercent / 100` | Porcentaje (formato `0.00%`) |
| Unidad | UM (UN, KG...) | Texto |

### Formato condicional en % Merma

Las filas con % merma en el top 25% se resaltan en rojo en Excel:

```ts
// Calcula el umbral del percentil 75
const p75Idx = Math.floor(mermaValues.length * 0.75)
const p75Threshold = mermaValues.sort((a, b) => a - b)[p75Idx]

// Aplica estilo rojo a las celdas que superan el umbral
ws[cellRef].s = {
    fill: { fgColor: { rgb: 'FFCCCC' } },
    font: { bold: true, color: { rgb: 'CC0000' } }
}
```

El nombre del archivo incluye las fechas del filtro: `Produccion_2026-03-01_2026-03-31.xlsx`.

### Hojas adicionales con el desglose de merma

A partir de la feature "Desglose de merma" el `.xlsx` incluye dos hojas extra (si hay merma):

| Hoja | Origen | Formato |
|---|---|---|
| **Merma por tipo** | `globalBreakdown` (ya cargado en pantalla) | Una fila por código de motivo: Tipo (Etiquetado/Pasteurizado) · Código · Descripción · Cantidad · % sobre merma. Última fila con `TOTAL`. |
| **Merma por artículo** | Fetch on-demand a `/api/production/merma-breakdown?mode=matrix` | **Formato largo**: una fila por par `(artículo, código)`. Columnas: Artículo · Descripción artículo · Tipo · Código · Descripción código · Cantidad. Diseñada para crear tablas dinámicas en Excel. |

Detalles completos en la sección 16 (Desglose de merma por tipo).

---

## 12. La función `parseJdeDate` en detalle

**Archivo:** `lib/utils.ts`

Esta función traduce el formato de fechas críptico de JDE a fechas normales de JavaScript.

### Formato JDE CYYDDD

```
Ejemplo: 326061
│││└──┘
│││  └── DDD = 061 → día 61 del año
││└───── YY = 26 → año 2026
│└────── (parte de YY)
└─────── C = primer dígito, usado como código de sub-línea
```

La confusión es que JDE originalmente usaba `C` como "century" (0=1900s, 1=2000s), pero en este proyecto **se reutiliza como código de sub-línea**. Por eso `parseJdeDate` extrae el primer dígito como `subBlockCode`.

### Nombres de sub-línea por planta

```ts
if (plantCode === "10300") {  // Funes
    switch (subBlockCode) {
        case '1': case '3': return "Funes 1"   // '1' = histórico, '3' = actual
        case '2': case '4': return "Funes 2"   // '2' = histórico, '4' = actual
        case '5':            return "Funes Pasteurizado"
    }
}
// Aguilar (10100) y Corella (10200) no tienen sub-líneas
```

---

## 13. Cómo añadir un nuevo filtro de categoría

Ejemplo: añadir "Subcategoría" con campo `IMSRP6`, `DRSY=41`, `DRRT=S6`.

### Paso 1 — `app/api/categories/route.ts`

Añadir al `FIELD_MAP`:
```ts
srp6: { col: 'IMSRP6', drsy: '41', drrt: 'S6', directF0005: true },
```

### Paso 2 — `app/api/production/route.ts`

1. Leer el parámetro al inicio:
```ts
const srp6s = searchParams.getAll('srp6');
```

2. Añadir a la condición de `extraJoins` (si el campo está en F4101):
```ts
const extraJoins = (prp6s.length > 0 || ... || srp6s.length > 0)
    ? `INNER JOIN F4101 D ON D.IMITM = A.WAITM`
    : '';
```

3. Añadir cláusula WHERE:
```ts
if (srp6s.length > 0) {
    const placeholders = srp6s.map((_, i) => `:srp6_${i}`).join(', ');
    sql += ` AND TRIM(D.IMSRP6) IN (${placeholders})`;
    srp6s.forEach((v, i) => { binds[`srp6_${i}`] = v; });
}
```

### Paso 3 — `components/FilterPanel.tsx`

1. Añadir estado:
```ts
const [selectedSrp6, setSelectedSrp6] = useState<string[]>([])
const [availableSrp6, setAvailableSrp6] = useState<{ id: string; description: string }[]>([])
```

2. Añadir al fetch de categorías en el `useEffect`:
```ts
const fields = ['prp6', 'srp3', 'srp5', 'srp2', 'srp1', 'srp4', 'ze03', 'srp6']
const setters = [..., setAvailableSrp6]
```

3. Añadir al `clearFilters`:
```ts
setSelectedSrp6([])
```

4. Añadir al `handleApply`:
```ts
onApply({ ..., selectedSrp6 })
```

5. Añadir el `<ArticleMultiSelect>` en la sección Categorías del render.

6. Añadir `selectedSrp6` al tipo `AppliedFilters`.

### Paso 4 — `app/produccion/page.tsx`

Añadir `srp6` al `URLSearchParams` en `fetchData`:
```ts
filtersArg.selectedSrp6.forEach(v => params.append('srp6', v))
```

---

## 14. Cómo añadir plantas y sub-plantas

Las plantas están **hardcodeadas** porque la lógica de sub-plantas depende del primer dígito de `TO55TAREA`, un campo custom que no puede resolverse dinámicamente.

### Añadir una nueva planta sin sub-plantas

Ejemplo: "Tudela" con código `10400`.

**Cambio 1 — `components/FilterPanel.tsx`** (dropdown de planta):
```tsx
<option value="10400">Tudela</option>
```

**Cambio 2 — `lib/utils.ts`** (`parseJdeDate`):
```ts
} else if (plantCode === "10400") {
    subBlockName = "Tudela";
}
```

**Cambio 3 — `lib/utils.ts`** (switch genérico al final):
Añadir case para el subcode que usará Tudela.

### Añadir una sub-planta a Funes

Ejemplo: "Funes 3" con subcode `6`.

**Cambio 1 — `lib/utils.ts`** (dentro del case `'10300'`):
```ts
case '6': subBlockName = "Funes 3"; break;
```

**Cambio 2 — `components/FilterPanel.tsx`** (el `<select>` condicional de sub-planta):
```tsx
{filters.plant === '10300' && (
    <>
      <option value="3">Funes 1</option>
      <option value="4">Funes 2</option>
      <option value="5">Funes Past.</option>
      <option value="6">Funes 3</option>  {/* NUEVO */}
    </>
)}
```

**Cambio 3 — `app/api/production/route.ts`** (si "Funes 3" reutiliza un subcode histórico):
```ts
'10300': { 3: 1, 4: 2, 6: X }, // X = subcode antiguo que usaba este mismo slot
```
Si es completamente nueva y sin datos históricos, no hace falta tocar el mapa.

---

## 15. Gotchas específicos de producción

### Merma viene negativa de Oracle

Los movimientos tipo `IS` (salida de stock) vienen como números negativos en `ILTRQT`. En el código se usa `Math.abs()` para mostrarlos como positivos y calcular el porcentaje correctamente.

### La descripción del artículo viene de F4101, no de F4801

`F4801.WADL01` es la descripción de la orden de fabricación — puede variar. `F4101.IMDSC1` es la descripción del maestro — siempre es la misma para el mismo artículo. Si usáramos F4801, el multi-select de artículo mostraría duplicados con descripciones distintas.

### Deduplicación de F55TAR12

Una misma orden+fecha puede tener dos registros en F55TAR12 (uno con subcode antiguo, uno con subcode nuevo). Sin deduplicar, el JOIN con F4111 duplicaría las cantidades. La subquery `MAX(TO55TAREA) GROUP BY TODOCO, MOD(TO55TAREA, 100000)` se queda con el más reciente.

### `sqlRowCount` vs `data.length`

La API agrupa filas SQL en memoria (varias filas por unidad → una fila agrupada). `data.length` (filas devueltas) puede ser menor que `sqlRowCount` (filas SQL originales). Para la paginación, hay que usar `sqlRowCount` — si usáramos `data.length` podríamos pensar que no hay más páginas cuando sí las hay.

### Filtro de línea de producción con "Sin línea"

`__empty__` es un valor especial que representa registros con `ILMCUZ` vacío. En Oracle, los campos CHAR vacíos con padding de espacios se tratan como NULL tras el TRIM. La condición usa `IS NULL`:

```sql
-- Si el usuario seleccionó "Sin línea" + algunas líneas específicas:
AND (TRIM(C.ILMCUZ) IN (:prodLine_0, ...) OR TRIM(C.ILMCUZ) IS NULL)
```

---

## 16. Desglose de merma por tipo (Q/P)

Funcionalidad complementaria al cálculo de merma total. Permite ver, para una consulta dada, **qué tipos de motivo** (`ILRCD` de F4111) componen esa merma y en qué cantidades.

### Motivación

Producción necesita saber qué etapa está generando la merma. Los códigos `Q*` corresponden a la fase de **Etiquetado** y los `P*` a la fase de **Pasteurizado**, así que la UI los agrupa en dos bloques con subtotal por bloque.

### Catálogo de códigos — `prodctl.f0005`

Los códigos válidos para producción están en F0005 con `DRSY=42`, `DRRT=RC`. Solo se incluyen en el cálculo los que empiezan por `Q` o `P` (el resto se ignora aunque existan en F0005):

```sql
SELECT TRIM(DRKY) as CODE, TRIM(DRDL01) as DESCRIPTION
FROM prodctl.f0005
WHERE TRIM(DRSY) = '42' AND TRIM(DRRT) = 'RC'
```

La lista cerrada que se usa en el código (idéntica a la del endpoint principal) es:

```
P01, P02, P03, P04, P05,
Q01, Q02, Q03, Q04, Q05, Q06, Q07, Q08, Q09, Q10
```

### Endpoint — `GET /api/production/merma-breakdown`

Acepta exactamente los mismos parámetros de filtro que `/api/production` (plant, subLine, startDate, endDate, startTime, endTime, article, prp6, srp1..5, ze03, prodLine) más un parámetro `mode` que controla la forma de respuesta:

| `mode` | Parámetros extra | Devuelve |
|---|---|---|
| `global` (default) | — | `{ mode, codes: [{code, description, group, qty, percent}], total }` — desglose agregado por código respetando los filtros |
| `row` | `order`, `productionDateRaw`, `rowArticle` (10 dígitos) | `{ mode, codes: [...], total }` — desglose para una fila concreta de la tabla |
| `matrix` | — | `{ mode, items: [{article, articleDesc, code, description, group, qty}] }` — formato largo para Excel (una entrada por par artículo×código) |

`group` es `'Q'`, `'P'` o `'O'` (otros, no debería aparecer dado el filtro `IN`).

#### SQL clave

El endpoint reutiliza la misma estructura de JOINs y filtros que `/api/production`, pero filtra solo movimientos `IS` con `ILRCD` en la lista, y agrupa por `WAITM + ILRCD + ILTRUM` (más `WAAITM + IMDSC1` en modo `matrix`). La conversión de UM se aplica igual que en el endpoint principal (busca `IMUOM1` en F4101 y resuelve cadenas hasta 3 saltos en F41002). El JOIN a F0005 se hace **al final, solo con los códigos que aparecen** en el resultado para minimizar lecturas.

```sql
-- Núcleo del JOIN (idéntico al de /api/production pero solo IS)
LEFT JOIN F4111 C ON C.ILDOC = A.WADOCO
  AND MOD(C.ILTRDJ, 100000) = MOD(B.TO55TAREA, 100000)
  AND C.ILDCT = 'IS'
  AND TRIM(C.ILRCD) IN ('P01',...,'Q10')
```

#### Por qué un endpoint nuevo y no extender `/api/production`

Para no tocar el endpoint más complejo del proyecto y mantener la SQL principal estable. El cálculo de merma total que se muestra en la tabla y los KPIs sigue exactamente igual; el desglose es un fetch adicional opcional.

### UI

**Card global "Desglose de merma"** (debajo de los KPIs en `/produccion`):
- Se carga en cada Filtrar / Cargar todos junto con la tabla principal (fetch paralelo, no bloqueante)
- Dos columnas: **Etiquetado (Q*)** y **Pasteurizado (P*)** con subtotal por bloque
- La card arranca **colapsada**; el header completo actúa como botón de abrir/cerrar (icono chevron a la izquierda + indicador "Pulsa para desplegar/ocultar")
- Dentro de cada bloque: lista ordenada por cantidad descendente, con código, descripción, cantidad y % sobre merma total

**Popover por fila** (al pulsar la celda Merma de una fila):
- Hace fetch en modo `row` solo al abrir (lazy)
- Se desactiva si la fila no tiene merma o si la tabla está en modo "Agrupar por artículo" (porque la fila no corresponde a una orden/día concreto)
- Misma estructura visual que la card global, en versión compacta

### Componentes

- `components/MermaBreakdown.tsx` — Componente puro: recibe `codes` y `total` y renderiza los dos bloques Q/P. Reutilizado por la card global y por el popover.
- `components/MermaCellPopover.tsx` — Envuelve la celda Merma de la tabla. Gestiona el estado del popover y el fetch on-demand al modo `row`.

### Hojas Excel añadidas

El export del panel (`exportToExcel` en `page.tsx`) añade dos hojas además de "Producción":

1. **"Merma por tipo"** — Una fila por código de motivo (los Q primero, luego P, ordenados por cantidad dentro de cada bloque). Última fila con `TOTAL`. Reutiliza el `globalBreakdown` ya cargado en pantalla, no hace fetch extra.
2. **"Merma por artículo"** — Fetch al modo `matrix` en el momento del export. Formato largo: una fila por par `(artículo, código)`. Pensado para que el usuario pivote fácilmente en Excel sin depender de columnas dinámicas.

Si no hay merma en el rango filtrado, las hojas se omiten.

### Cómo añadir un código nuevo o cambiar la lista

La lista de códigos válidos está embebida en dos sitios y debe mantenerse sincronizada:
- `app/api/production/route.ts` → constante `MERMA_CODES` (controla qué entra en la suma total)
- `app/api/production/merma-breakdown/route.ts` → constante `MERMA_CODES_ARR` (controla qué entra en el desglose)

Si se diera de alta un código nuevo en F0005 con DRSY=42/DRRT=RC para una fase ya existente (Etiquetado/Pasteurizado), hay que añadirlo en ambos sitios. Si apareciera una **fase nueva** (prefijo distinto de Q o P), además habría que añadir un bloque nuevo en `components/MermaBreakdown.tsx` con su título e icono.
