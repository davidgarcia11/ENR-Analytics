# Documentación Técnica — Dashboard de Producción

> **Audiencia:** Desarrolladores que se incorporan al proyecto.
> **Última actualización:** Marzo 2026

---

## 1. Visión General

Esta aplicación es un **panel de control (dashboard) de producción** para la empresa Elaborados Naturales. Conecta con la base de datos **Oracle JD Edwards (JDE)** y muestra en tiempo real:

- Órdenes de fabricación y cantidades producidas
- Porcentaje de merma (desperdicio) por artículo
- Desglose por planta, línea de producción y fechas
- Exportación a Excel con formato condicional

### Tech Stack

| Tecnología | Versión | Para qué se usa |
|---|---|---|
| **Next.js** | 16 | Framework web (App Router) |
| **React** | 19 | Librería de interfaz de usuario |
| **TypeScript** | 5 | Tipado estático sobre JavaScript |
| **Tailwind CSS** | 4 | Estilos utilitarios (clases CSS) |
| **oracledb** | 6 | Driver para conectar con Oracle desde Node.js |
| **xlsx** | 0.18 | Generar archivos Excel (.xlsx) |
| **lucide-react** | 0.563 | Iconos SVG (Search, Factory, Download...) |
| **date-fns** | 4 | Utilidades de fecha (`getDayOfYear`) |
| **Bun** | — | Gestor de paquetes y runtime (alternativa a npm/node) |

---

## 2. Estructura del Proyecto

```
dashboard/
├── .env.local                    ← Credenciales Oracle (NUNCA se sube a Git)
├── package.json                  ← Dependencias y scripts
├── next.config.ts                ← Configuración de Next.js (cabecera HSTS)
├── tsconfig.json                 ← Configuración de TypeScript
├── postcss.config.mjs            ← Configuración de PostCSS (Tailwind v4)
├── eslint.config.mjs             ← Reglas de linting
│
├── public/
│   └── logo.png                  ← Logo de la empresa (se sirve en /logo.png)
│
├── lib/                          ← Lógica reutilizable (utilidades)
│   ├── db.ts                     ← Conexión a Oracle
│   └── utils.ts                  ← Funciones auxiliares (fechas, cantidades, clases CSS)
│
├── components/                   ← Componentes React reutilizables
│   ├── ArticleMultiSelect.tsx    ← Desplegable multi-selección con búsqueda
│   └── ui/                       ← Componentes de interfaz base (botón, card, tabla, input)
│       ├── button.tsx
│       ├── card.tsx
│       ├── input.tsx
│       └── table.tsx
│
└── app/                          ← Rutas de Next.js (App Router)
    ├── globals.css               ← Estilos globales + importación de Tailwind
    ├── layout.tsx                ← Layout raíz (envuelve todas las páginas)
    ├── page.tsx                  ← Ruta "/" → muestra un 404 simple
    ├── produccion/
    │   └── page.tsx              ← Ruta "/produccion" → DASHBOARD PRINCIPAL
    └── api/
        ├── categories/
        │   └── route.ts          ← GET /api/categories?field=X
        ├── production/
        │   └── route.ts          ← GET /api/production?...filtros...
        └── production-lines/
            └── route.ts          ← GET /api/production-lines
```

---

## 3. Configuración

### `.env.local` — Credenciales de base de datos

```env
ORACLE_USER=<usuario_oracle>
ORACLE_PASSWORD=<contraseña_oracle>
ORACLE_HOST=<ip_servidor_oracle>
ORACLE_PORT=1521
ORACLE_SERVICE=<nombre_servicio_oracle>
```

> **IMPORTANTE:** Este archivo NUNCA se sube al repositorio. Está en `.gitignore`.

### `package.json` — Scripts principales

| Comando | Qué hace |
|---|---|
| `bun dev` | Arranca el servidor en modo desarrollo (hot reload) |
| `bun run build` | Compila la app para producción |
| `bun start` | Sirve la app compilada (producción) |

### `next.config.ts`

Solo tiene una configuración: añade la cabecera HTTP `Strict-Transport-Security` a todas las respuestas para forzar HTTPS.

### `tsconfig.json` — Alias `@/`

La línea más importante para el día a día:

```json
"paths": { "@/*": ["./*"] }
```

Esto permite importar así:

```ts
import { getDbConnection } from '@/lib/db'   // En vez de '../../lib/db'
```

El `@` apunta a la raíz del proyecto (`dashboard/`).

---

## 4. Carpeta `lib/` — Utilidades Base

### `lib/db.ts` — Conexión a Oracle

**Qué hace:** Exporta una función `getDbConnection()` que devuelve una conexión activa a Oracle.

**Configuración global:**
- `oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT` → Las filas de los queries vienen como objetos `{ COLUMNA: valor }` en vez de arrays. Las columnas siempre son en **MAYÚSCULAS**.

**Cómo se usa en cada API route:**
```ts
let conn;
try {
    conn = await getDbConnection();
    const result = await conn.execute(sql);
    // usar result.rows
} finally {
    if (conn) await conn.close();  // SIEMPRE cerrar la conexión
}
```

> **Regla de oro:** Siempre usar `try/finally` para cerrar la conexión. Si no la cierras, el pool de Oracle se agota y el servidor se cuelga.

---

### `lib/utils.ts` — Funciones auxiliares

#### `cn(...inputs)` — Combinar clases CSS

Mezcla de `clsx` (lógica condicional) y `tailwind-merge` (resuelve conflictos de Tailwind).

```ts
cn('p-4', isError && 'bg-red-500')
// → 'p-4 bg-red-500'  (si isError es true)
// → 'p-4'             (si isError es false)
```

Se usa en todos los componentes UI para permitir sobreescribir clases.

#### `parseJdeDate(jdeDate, wamcu?)` — Convertir fecha JDE

JDE guarda las fechas como números de 6 dígitos en formato **CYYDDD**:
- **C** = Código de sub-línea (1=Aguilar, 2=Corella, 3=Funes 1, 4=Funes 2, 5=Funes Past.)
- **YY** = Año (24 = 2024, 26 = 2026)
- **DDD** = Día del año (1-366)

Ejemplo: `126061` → sub-línea `1`, año `26` (2026), día `61` (2 de marzo) → `{ date: 2026-03-02, subBlock: '1', subBlockName: 'Aguilar' }`

El parámetro `wamcu` (código de planta) personaliza los nombres:
- `10100` → siempre "Aguilar"
- `10200` → siempre "Corella"
- `10300` → usa el código C: `1`/`3`=Funes 1, `2`/`4`=Funes 2, `5`=Funes Pasteurizado

#### `parseWasOqs(val)` — Convertir cantidad JDE

JDE almacena cantidades multiplicadas por 100. Esta función divide entre 100.

```ts
parseWasOqs(150000)  // → 1500.00
```

---

## 5. Tablas de Oracle JDE

Estas son las tablas de la base de datos con las que trabaja el proyecto:

### Tablas principales

| Tabla | Descripción | Campos clave |
|---|---|---|
| **F4801** | **Órdenes de fabricación** (Work Orders) | `WADOCO` (nº orden), `WADL01` (descripción), `WAMCU` (planta), `WAAITM` (artículo display), `WAITM` (artículo corto/numérico) |
| **F4111** | **Movimientos de inventario** (Item Ledger) | `ILDOC` (nº orden), `ILTRDJ` (fecha JDE), `ILDCT` (tipo: IC=producción, IS=merma), `ILTRQT` (cantidad), `ILRCD` (código razón), `ILTRUM` (unidad medida), `ILMCUZ` (línea producción) |
| **F4101** | **Maestro de artículos** (Item Master) | `IMITM` (ID corto), `IMUOM1` (UM primaria), `IMPRP6` (tipo proceso), `IMSRP1..5` (categorías) |
| **F554101** | **Extensión del maestro** de artículos | `AAITM` (ID corto), `AAZE03` (gramaje) |
| **F55TAR12** | **Tareas de producción** (custom) | `TODOCO` (nº orden), `TO55TAREA` (código fecha+sublínea) |

### Tablas auxiliares

| Tabla | Descripción | Campos clave |
|---|---|---|
| **prodctl.f0005** | **Códigos definidos por usuario** (UDC) — es la tabla de "catálogos" | `DRSY` (sistema), `DRRT` (tipo), `DRKY` (código), `DRDL01` (descripción) |
| **F41002** | **Conversiones de unidad de medida** | `UMITM` (artículo), `UMUM` (UM origen), `UMRUM` (UM destino), `UMCONV` (factor ×10.000.000) |
| **F30006** | **Centros de trabajo** (Work Centers) | `IWMCU` (código centro) |
| **F0006** | **Unidades de negocio** (Business Units) | `MCMCU` (código), `MCDL01` (descripción) |

### Relaciones entre tablas

```
F55TAR12 (tareas)
    │ TODOCO
    ▼
F4801 (órdenes) ──WAITM──► F4101 (maestro artículos)
    │ WADOCO                      │ IMITM
    ▼                             ▼
F4111 (movimientos)          F554101 (extensión)
    │                             │
    └── ILTRUM ──► F41002 (conversiones UM)

F4101.IMPRP6/IMSRP1..5 ──► prodctl.f0005 (catálogos UDC)
F4111.ILMCUZ ──► F30006 + F0006 (líneas producción)
```

---

## 6. API Routes (Endpoints del Servidor)

Las API routes se ejecutan en el **servidor** (nunca en el navegador). El navegador las llama mediante `fetch()`.

---

### `GET /api/categories?field=X`

**Archivo:** `app/api/categories/route.ts`

**Qué hace:** Devuelve las opciones `[{ id, description }]` para un desplegable de filtro.

**Parámetro `field`:** Define qué categoría consultar.

| field | Columna F4101 | DRSY | DRRT | Nombre en UI |
|---|---|---|---|---|
| `prp6` | IMPRP6 | 41 | 01 | Tipo Proceso OF |
| `srp3` | IMSRP3 | 41 | S3 | Formato |
| `srp5` | IMSRP5 | 41 | S5 | Sabor |
| `srp2` | IMSRP2 | 41 | S2 | Familia |
| `srp1` | IMSRP1 | 41 | S1 | Categoría |
| `srp4` | IMSRP4 | 41 | S4 | Marca |
| `ze03` | AAZE03 (F554101) | 17 | B3 | Gramaje |

**Dos estrategias SQL:**

1. **`directF0005: true`** (la mayoría) → Consulta directamente la tabla `prodctl.f0005` filtrando por DRSY/DRRT. Devuelve todos los códigos existentes.

2. **`directF0005: false`** (solo `prp6`) → Hace JOIN entre `F4101` y `f0005`. Así solo aparecen códigos que realmente se usan en artículos existentes.

**Respuesta:**
```json
[
  { "id": "ML", "description": "MERMELADAS Y CONFITURAS" },
  { "id": "ZU", "description": "ZUMOS Y GAZPACHOS" }
]
```

---

### `GET /api/production?...filtros...`

**Archivo:** `app/api/production/route.ts`

**Qué hace:** Devuelve los datos de producción filtrados. Es el endpoint más complejo del proyecto.

**Parámetros de consulta:**

| Parámetro | Tipo | Ejemplo | Descripción |
|---|---|---|---|
| `plant` | string | `10300` | Código de planta |
| `subLine` | string | `3` | Sub-línea (1-5) |
| `startDate` | string | `2026-03-01` | Fecha inicio (YYYY-MM-DD) |
| `endDate` | string | `2026-03-02` | Fecha fin (YYYY-MM-DD) |
| `article` | string[] | `0000012345` | Códigos de artículo (10 dígitos) |
| `prp6` | string[] | `ML` | Filtro Tipo Proceso |
| `srp3` | string[] | `01` | Filtro Formato |
| `srp5` | string[] | `FR` | Filtro Sabor |
| `srp2` | string[] | `AB` | Filtro Familia |
| `srp1` | string[] | `CD` | Filtro Categoría |
| `srp4` | string[] | `EF` | Filtro Marca |
| `ze03` | string[] | `500` | Filtro Gramaje |
| `prodLine` | string[] | `WC001` | Línea de producción (`__empty__` = sin línea) |
| `page` | number | `1` | Página (paginación) |
| `limit` | number | `150` | Registros por página (0 = todos) |

**Lógica paso a paso:**

1. **Parsear parámetros** — extrae todos los filtros de la URL
2. **Construir SQL dinámicamente:**
   - Base: JOIN entre `F55TAR12` (deduplicado) → `F4801` → `F4111`
   - Si hay filtros de categoría → añade `INNER JOIN F4101`
   - Si hay filtro de gramaje → añade `INNER JOIN F554101`
   - Cada filtro activo añade una cláusula `WHERE`
3. **Ejecutar SQL** contra Oracle
4. **Consultas secundarias:**
   - Obtener la UM primaria de cada artículo (de F4101)
   - Obtener factores de conversión de UM (de F41002)
5. **Procesar cada fila:**
   - Parsear fecha JDE → fecha JavaScript
   - Convertir cantidad a UM primaria (usando BFS en el grafo de conversiones)
   - Agrupar por orden+fecha, sumar cantidades y merma
   - Calcular `mermaPercent`
6. **Devolver respuesta**

**El truco de F55TAR12 (deduplicación):**

```sql
SELECT TODOCO, MAX(TO55TAREA) as TO55TAREA
FROM F55TAR12
GROUP BY TODOCO, MOD(TO55TAREA, 100000)
```

Antes de agosto, todos los registros usaban sub-código `1`. Después, Funes pasó a usar `3`, `4`, `5`. Para un mismo día y orden, pueden existir ambos registros (el viejo con `1` y el nuevo con `3`). Sin esta deduplicación, las cantidades se duplicarían porque ambos hacen JOIN al mismo registro de F4111.

`MOD(TO55TAREA, 100000)` extrae solo la parte de fecha (sin el sub-código), y `MAX` se queda con el registro más reciente.

**Merma (desperdicio):**

Los movimientos de tipo `IS` (Issue Scrap) en F4111 son merma, pero solo si el código de razón (`ILRCD`) es uno de: `P01-P05`, `Q01-Q10`.

```sql
SUM(CASE WHEN C.ILDCT = 'IC' THEN C.ILTRQT ELSE 0 END) as WASOQS   -- producción
SUM(CASE WHEN C.ILDCT = 'IS' THEN C.ILTRQT ELSE 0 END) as MERMA    -- merma (negativo)
```

La merma viene como número **negativo** de Oracle.

**Fórmula del % merma:**
```
mermaPercent = |merma| / (|merma| + producido) × 100
```

**Conversión de unidades de medida (BFS):**

JDE puede tener la misma cantidad en distintas UM. El sistema usa un algoritmo BFS (Breadth-First Search) de hasta 3 niveles para encontrar un camino de conversión:

```
UN → CJ → KG  (si no hay conversión directa UN→KG, busca un camino intermedio)
```

El factor de conversión en F41002 se almacena multiplicado por **10.000.000**, así que hay que dividir.

**Respuesta:**
```json
{
  "data": [
    {
      "order": "12345",
      "date": "2026-03-02T00:00:00.000Z",
      "productionDateRaw": 126061,
      "description": "MERMELADA FRESA 350G",
      "quantity": 150.5,
      "merma": -2.3,
      "mermaPercent": 1.5,
      "unit": "UN",
      "plantCode": "10300",
      "article": "0000012345",
      "subLine": "Funes 1",
      "subLineCode": "3"
    }
  ],
  "sqlRowCount": 148
}
```

`sqlRowCount` es el número de filas que devolvió Oracle (antes de agrupar en JS). Se usa para saber si hay más páginas.

---

### `GET /api/production-lines`

**Archivo:** `app/api/production-lines/route.ts`

**Qué hace:** Devuelve las líneas de producción disponibles para el filtro.

**SQL:** Consulta `F30006` (centros de trabajo) con JOIN a `F0006` (descripciones). Filtra centros activos (`IWAPSC >= '1'`).

Añade al principio de la lista: `{ id: '__empty__', description: 'Sin línea' }` para permitir filtrar registros sin línea asignada.

**Respuesta:**
```json
[
  { "id": "__empty__", "description": "Sin línea" },
  { "id": "WC001", "description": "LÍNEA 1 ENVASADO" },
  { "id": "WC002", "description": "LÍNEA 2 PROCESADO" }
]
```

---

## 7. Página Principal — `app/produccion/page.tsx`

Esta es la página más grande del proyecto (~760 líneas). Es un **Client Component** (`"use client"`) porque usa hooks de React.

### Estados (variables reactivas)

| Estado | Tipo | Para qué |
|---|---|---|
| `data` | `any[]` | Registros de producción cargados |
| `loading` | `boolean` | True mientras se cargan datos (muestra spinner) |
| `page` | `number` | Página actual para paginación |
| `hasMore` | `boolean` | ¿Hay más datos por cargar? |
| `filters` | `object` | `{ plant, subLine, startDate, endDate }` |
| `selectedArticles` | `string[]` | Artículos seleccionados en el filtro |
| `availableArticles` | `{id, description}[]` | Opciones del desplegable de artículos |
| `selectedPrp6..Ze03` | `string[]` | Valores seleccionados en cada filtro de categoría |
| `availablePrp6..Ze03` | `{id, description}[]` | Opciones de cada desplegable de categoría |
| `selectedProdLines` | `string[]` | Líneas de producción seleccionadas |
| `metrics` | `object` | Totales calculados (cantidad UN/KG, órdenes, merma, por planta) |

### Funciones principales

#### `fetchData(pageNum, isNewSearch, allRecords?)`

La función central. Construye la URL con todos los filtros activos, llama a `/api/production`, y procesa la respuesta:

1. Construye `URLSearchParams` con todos los filtros
2. Hace `fetch()` al servidor
3. Con la respuesta:
   - Determina si hay más páginas (`sqlRowCount >= limit`)
   - Reemplaza o añade datos según `isNewSearch`
   - Reconstruye la lista de artículos disponibles
   - Recalcula métricas (totales UN, KG, órdenes, merma, por planta)

#### `applyFilters()`

Se ejecuta al pulsar "Filtrar". Resetea la página a 1, limpia datos, y llama a `fetchData(1, true, true)` para traer todos los registros que coinciden.

#### `clearFilters()`

Se ejecuta al pulsar "Limpiar". Resetea todos los filtros a sus valores por defecto (fechas = hoy, planta = "all", todos los multi-select vacíos).

#### `handlePlantChange(plantValue)`

Cuando el usuario cambia la planta, auto-configura la sub-línea:
- Aguilar (10100) → sub-línea `1`
- Corella (10200) → sub-línea `2`
- Funes (10300) → sub-línea `all` (el usuario elige)
- Todas → sub-línea `all`

#### `exportToExcel()`

Genera un archivo `.xlsx` con los datos actuales:

1. Ordena por `% merma` de mayor a menor
2. Mapea columnas: Fecha, Artículo, Descripción, Cantidad, Merma, % Merma, UM, Planta/Línea
3. Aplica formato porcentaje a la columna % Merma
4. Colorea en rojo las filas del top 25% de merma (percentil 75)
5. Descarga el archivo con nombre `Produccion_[fechaInicio]_[fechaFin].xlsx`

#### `displayData` (useMemo)

Dato procesado y agrupado que alimenta la tabla. Se recalcula cuando `data` cambia:

1. Agrupa por `artículo + fecha + sub-línea + unidad`
2. Suma `quantity` y `merma` dentro de cada grupo
3. Calcula `mermaPercent = |merma| / (|merma| + cantidad) × 100`
4. Ordena por `mermaPercent` descendente (más desperdicio primero)

#### `mermaP75` (useMemo)

Calcula el percentil 75 de los valores de `mermaPercent`. Se usa como umbral para el coloreado "crítico".

#### `getMermaColor(percent)`

Devuelve clases CSS según el nivel de merma:

| Condición | Color | Significado |
|---|---|---|
| `= 0%` | Gris | Sin merma |
| `≥ mermaP75` (top 25%) | Rojo oscuro + negrita | Crítico |
| `≥ 5%` | Rojo | Alto |
| `≥ 2%` | Ámbar | Medio |
| `< 2%` | Verde | Bajo |

### Estructura visual (UI)

```
┌─────────────────────────────────────────────────────────┐
│  [LOGO]                                                 │
│  DASHBOARD DE PRODUCCIÓN                                │
│                                                         │
│  ┌─ Filtros ──────────────────────────────────────────┐ │
│  │ Artículo │ Tipo Proceso │ Formato │ Sabor │ ...    │ │
│  │ Fecha Inicio │ Fecha Fin │ Planta │ Sub-línea      │ │
│  │ [Filtrar] [Excel] [Limpiar]                        │ │
│  └────────────────────────────────────────────────────┘ │
│                                                         │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │
│  │ Cantidad │ │ Órdenes  │ │  Merma   │ │Top Planta│  │
│  │ Total    │ │          │ │  2.34%   │ │ Funes 1  │  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘  │
│                                                         │
│  ┌─ Detalle de Producción ────────────────────────────┐ │
│  │ Fecha │ Artículo │ Desc. │ Cant. │ Merma │ %M │UM │ │
│  │ 02/03 │ 00001234 │ MERM..│ 1500  │ -23   │2.3%│UN │ │
│  │ ...   │ ...      │ ...   │ ...   │ ...   │... │.. │ │
│  │         [Cargar más] [Cargar todos]                │ │
│  └────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

---

## 8. Componentes Reutilizables

### `ArticleMultiSelect.tsx` — Desplegable multi-selección

**Props:**

| Prop | Tipo | Default | Descripción |
|---|---|---|---|
| `articles` | `{id, description}[]` | — | Opciones disponibles |
| `selected` | `string[]` | — | IDs seleccionados |
| `onChange` | `(string[]) => void` | — | Callback al cambiar selección |
| `label` | `string` | `"Artículos"` | Texto del placeholder |
| `showId` | `boolean` | `true` | Mostrar ID junto a descripción |

**Comportamiento:**
- Botón muestra "Filtrar por [label]..." o badge "N seleccionados"
- Al abrir: panel flotante con buscador (auto-focus) + lista de checkboxes
- Busca por ID o descripción (insensible a mayúsculas)
- "Sel. todos" selecciona los filtrados visibles; "Ninguno" deselecciona todo
- Click fuera cierra el desplegable

Se usa para los **9 filtros**: Artículo, Tipo Proceso, Formato, Sabor, Familia, Categoría, Marca, Gramaje, Línea de Producción.

### `ui/button.tsx` — Botón con variantes

Usa `class-variance-authority` para gestionar variantes:

| Variante | Aspecto | Uso en el proyecto |
|---|---|---|
| `default` | Fondo oscuro | — |
| `outline` | Borde, fondo blanco | Excel, Limpiar |
| `ghost` | Transparente | Cargar más |
| `destructive` | Rojo | — |
| `secondary` | Gris claro | — |
| `link` | Parece enlace | — |

El botón "Filtrar" usa `style` inline con el color corporativo `#D30B15`.

### `ui/card.tsx` — Tarjeta

Cuatro componentes: `Card`, `CardHeader`, `CardTitle`, `CardContent`. Componen el layout de las tarjetas KPI y la tabla.

### `ui/input.tsx` — Campo de texto

Input estilizado con Tailwind. Se usa para los campos de fecha.

### `ui/table.tsx` — Tabla

Seis componentes: `Table`, `TableHeader`, `TableBody`, `TableRow`, `TableHead`, `TableCell`. El `Table` envuelve en un div con `overflow-auto` para scroll horizontal.

---

## 9. Flujo Completo: Click en "Filtrar"

```
1. USUARIO pulsa "Filtrar"
   └─► applyFilters()
       ├─► setPage(1)
       ├─► setData([])
       └─► fetchData(1, true, true)

2. fetchData() construye URL:
   /api/production?plant=10300&startDate=2026-03-01&endDate=2026-03-02&limit=0

3. NAVEGADOR → GET /api/production?... → SERVIDOR

4. production/route.ts (en el servidor):
   a. Parsea parámetros
   b. Abre conexión Oracle (getDbConnection)
   c. Construye SQL dinámico:
      - F55TAR12 (deduplicado) → JOIN F4801 → JOIN F4111
      - + JOIN F4101 (si hay filtros de categoría)
      - + JOIN F554101 (si hay filtro de gramaje)
      - + WHERE para cada filtro activo
   d. Ejecuta SQL → Oracle devuelve filas
   e. Consultas secundarias: UM primarias + factores conversión
   f. Procesa cada fila:
      - Parsea fecha JDE
      - Convierte UM (BFS)
      - Agrupa por orden+fecha
      - Calcula mermaPercent
   g. Cierra conexión
   h. Devuelve JSON: { data: [...], sqlRowCount: N }

5. SERVIDOR → JSON → NAVEGADOR

6. fetchData() recibe respuesta:
   a. Actualiza estado `data`
   b. Recalcula métricas
   c. Determina `hasMore`

7. displayData (useMemo) se recalcula:
   - Agrupa por artículo+fecha+sublínea+unidad
   - Suma cantidades y merma
   - Ordena por % merma descendente

8. React re-renderiza:
   - 4 tarjetas KPI se actualizan
   - Tabla muestra filas con colores condicionales
   - Botones de paginación se muestran/ocultan
```

---

## 10. Gotchas y Patrones Importantes

### Oracle CHAR vs VARCHAR2

**El problema:** Oracle tiene dos tipos de texto: `CHAR` (longitud fija, relleno con espacios) y `VARCHAR2` (longitud variable). El driver `oracledb` envía los bind variables como VARCHAR2. Cuando comparas un VARCHAR2 con un CHAR, **no coinciden** aunque el valor sea el mismo.

**La solución en este proyecto:**
- Valores **hardcodeados** (como `DRSY='41'`): se embeben directamente en el SQL
- Valores **del usuario** (como artículos): se usa `TRIM()` en la columna Oracle + bind variables

```ts
// ✅ BIEN — valor hardcodeado, seguro embeber
WHERE TRIM(F.DRSY) = '41'

// ✅ BIEN — valor del usuario, usar bind variable con TRIM
WHERE TRIM(D.IMPRP6) IN (:prp6_0, :prp6_1)

// ❌ MAL — bind variable contra CHAR sin TRIM, no funciona
WHERE F.DRSY = :drsy
```

### Fechas JDE (CYYDDD)

Nunca intentes interpretar fechas JDE manualmente. Usa `parseJdeDate()` de `lib/utils.ts`.

Para convertir una fecha JavaScript a formato JDE (para filtros SQL):
```ts
const jdeDate = (year - 2000) * 1000 + getDayOfYear(date);
// 2026-03-02 → 26 * 1000 + 61 = 26061
```

### Cantidades JDE (×100)

Todas las cantidades en F4111/F4801 están **multiplicadas por 100**. Siempre dividir entre 100 al mostrar.

### Factores de conversión UM (×10.000.000)

Los factores de conversión en F41002 están multiplicados por **10.000.000**. Dividir al aplicar.

### `"use client"` vs Server Components

- **`"use client"`** al principio del archivo → se ejecuta en el **navegador**. Puede usar `useState`, `useEffect`, eventos de click, etc.
- **Sin directiva** → se ejecuta en el **servidor**. No puede usar hooks ni eventos del navegador.
- Las API routes (`app/api/...`) siempre son servidor, no necesitan directiva.

### Siempre cerrar conexiones Oracle

```ts
// ✅ SIEMPRE usar try/finally
let conn;
try {
    conn = await getDbConnection();
    // ... hacer queries
} finally {
    if (conn) await conn.close();
}
```

Si olvidas cerrar una conexión, el pool de Oracle se agota y la aplicación deja de funcionar.

### Prevención de SQL Injection

- Valores del usuario → **bind variables** (`:param`)
- Artículos → validados con regex `/^\d{10}$/` antes de usarse
- Valores del `FIELD_MAP` → embebidos directamente (son constantes del código, no del usuario)

### Color corporativo

El color principal de la marca es `#D30B15` (rojo). Se usa en:
- Borde superior de tarjetas KPI y paneles
- Botón "Filtrar"
- Iconos de las tarjetas KPI
- Línea bajo el subtítulo del dashboard

---

## 11. Cómo Añadir un Nuevo Filtro de Categoría

Si necesitas añadir un nuevo filtro (ejemplo: "Subcategoría" con campo `IMSRP6`, DRSY=`41`, DRRT=`S6`):

### Paso 1: `app/api/categories/route.ts`

Añadir entrada al `FIELD_MAP`:
```ts
srp6: { col: 'IMSRP6', drsy: '41', drrt: 'S6', directF0005: true },
```

### Paso 2: `app/api/production/route.ts`

1. Leer el parámetro:
```ts
const srp6s = searchParams.getAll('srp6');
```

2. Añadir la columna a la condición de `extraJoins` (si usa F4101):
```ts
const extraJoins = (prp6s.length > 0 || srp3s.length > 0 || ... || srp6s.length > 0)
    ? `INNER JOIN F4101 D ON D.IMITM = A.WAITM` : '';
```

3. Añadir cláusula WHERE:
```ts
if (srp6s.length > 0) {
    const placeholders = srp6s.map((_, i) => `:srp6_${i}`).join(',');
    sql += ` AND TRIM(D.IMSRP6) IN (${placeholders})`;
    srp6s.forEach((v, i) => { binds[`srp6_${i}`] = v; });
}
```

### Paso 3: `app/produccion/page.tsx`

1. Añadir estados:
```ts
const [selectedSrp6, setSelectedSrp6] = useState<string[]>([])
const [availableSrp6, setAvailableSrp6] = useState<{ id: string; description: string }[]>([])
```

2. En el `useEffect`, añadir fetch:
```ts
fetch('/api/categories?field=srp6').then(r => r.json()).then(setAvailableSrp6)
```

3. En `fetchData`, añadir al `URLSearchParams`:
```ts
selectedSrp6.forEach(v => params.append('srp6', v));
```

4. En `clearFilters`, añadir:
```ts
setSelectedSrp6([]);
```

5. En el JSX, añadir el desplegable:
```tsx
<div className="grid gap-1.5">
  <label className="text-xs font-semibold text-gray-700">Subcategoría</label>
  <div className="w-[200px]">
    <ArticleMultiSelect
      articles={availableSrp6}
      selected={selectedSrp6}
      onChange={setSelectedSrp6}
      label="Subcategoría"
      showId={false}
    />
  </div>
</div>
```

---

## 12. Cómo Arrancar el Proyecto

```bash
# 1. Instalar dependencias
cd dashboard
bun install

# 2. Configurar credenciales (copiar y editar)
cp .env.local.example .env.local

# 3. Desarrollo (hot reload)
bun dev
# Abrir http://localhost:3000/produccion

# 4. Producción
bun run build
bun start
```

> **Nota:** La ruta raíz `/` muestra un 404 a propósito. La app está en `/produccion`.
