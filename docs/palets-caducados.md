# Documentación — Caducados/Obsoletos/Bloqueados (`/caducados`)

> Documentación específica del dashboard de palets caducados, con artículo obsoleto y/o bloqueados.
> Ver [DOCUMENTACION.md](../DOCUMENTACION.md) para la documentación base del proyecto.

---

## 1. Descripción general

Dashboard para visualizar palets problemáticos: caducados (fecha de caducidad vencida), con artículo obsoleto o con un estado de lote activo (bloqueados, en cuarentena, etc.).

**Acceso configurable** — público por defecto. Cualquier usuario puede consultar sin sesión activa. El administrador puede restringirlo a roles específicos desde `/admin` → pestaña Pantallas.

**Navegación:** dropdown "Paneles ▾" en la barra superior (componente `Navbar`).

---

## 2. Archivos relevantes

| Archivo | Descripción |
|---|---|
| `app/caducados/page.tsx` | Página cliente (filtros, tabla, métricas, Excel) |
| `app/api/caducados/route.ts` | API Route servidor — consultas Oracle |
| `components/ArticleMultiSelect.tsx` | Componente multi-select con buscador (usado en todos los filtros desplegables) |
| `components/SingleSelect.tsx` | Componente single-select con buscador (mismo estilo visual que ArticleMultiSelect) |

---

## 3. Filtros

El panel de filtros tiene dos secciones visually separadas: **Categorías/Tipos** y **Búsqueda libre**.

### 3.1 Filtros desplegables (sección superior)

Todos usan `ArticleMultiSelect` — multi-selección con buscador interno, mismo estilo visual:

| Filtro | Estado | Fuente de datos | Param URL | Campo Oracle |
|---|---|---|---|---|
| **Tipo** | Selección única (botones) | Estático | `type` | — (condiciona la lógica de la query) |
| **Tipo de bloqueo** | Multi-select | F0005 (`DRSY=41`, `DRRT=L`) via `?onlyLotStates=1` | `lotStates[]` | `TRIM(B.IOLOTS)` |
| **Categoría** | Multi-select | `/api/categories?field=srp1&screen=caducados` | `srp1[]` | `TRIM(D.IMSRP1)` |
| **Familia** | Multi-select | `/api/categories?field=srp2&screen=caducados` | `srp2[]` | `TRIM(D.IMSRP2)` |
| **Planta** | Multi-select | `/api/plants?screen=caducados` (F0006) | `plant[]` | `TRIM(A.LIMCU)` |
| **Ubicación** | Multi-select, default=GENERICA | F4100 via respuesta API | `location[]` | `TRIM(A.LILOCN)` |

**Default al cargar:** Ubicación preseleccionada en GENERICA (`__blank__`). El resto vacío (sin filtro).

**Tipo de bloqueo** — a diferencia de los demás, este filtro aplica en **cualquier tipo** (Todos/Caducados/Obsoletos/Bloqueados), no solo en Bloqueados. Permite ver, por ejemplo, los caducados que además tienen un estado de lote activo.

### 3.2 Búsqueda por Palet / Lote

Inputs de texto libre con soporte de **comodín `*`**:

| Input | Param URL | Campo Oracle | Operador |
|---|---|---|---|
| **Palet** | `palet` | `TRIM(B.IOLOT1)` | `=` (exacto) o `LIKE` (con `*`) |
| **Lote** | `lote` | `TRIM(B.IOLOT2)` | `=` (exacto) o `LIKE` (con `*`) |

**Sintaxis del comodín:**

| Entrada | SQL generado | Resultado |
|---|---|---|
| `757585*` | `LIKE '757585%'` | Empieza por ese valor |
| `*98789` | `LIKE '%98789'` | Termina en ese valor |
| `*98789*` | `LIKE '%98789%'` | Contiene ese valor |
| `757585` | `= '757585'` | Coincidencia exacta |

Pulsar **Enter** en cualquiera de los dos inputs dispara el filtro (equivalente a pulsar "Filtrar").

---

## 4. Tarjetas métricas

| Tarjeta | Descripción |
|---|---|
| **Total Palets** | Nº registros devueltos por la query |
| **Caducados** | Palets con `IOMMEJ < hoy` (fecha JDE vencida) |
| **Obsoletos** | Palets cuyo artículo tiene `IMSTKT = 'O'` en F4101 |
| **Bloqueados** | Palets con `TRIM(IOLOTS) IS NOT NULL` en F4108 (cualquier estado activo) |

---

## 5. Tabla de resultados

Columnas: Artículo, Descripción, Planta, Ubicación, Palet, Lote, Cantidad, Fecha Cad., Motivo.

### Badge de Motivo

El campo `motivo` se construye en el backend concatenando los motivos aplicables separados por ` + `. El color del badge sigue esta lógica:

| Condición | Color |
|---|---|
| Contiene "Caducado" + "+" (combinado) | Rojo intenso |
| Solo "Caducado" | Rojo suave |
| Solo "Obsoleto" | Ámbar |
| Contiene "+" (otra combinación) | Morado |
| Cualquier otro valor (estado de lote) | Azul |
| "Desconocido" | Gris |

**El texto del badge para estados de lote es dinámico** — proviene de la descripción de F0005, no de un texto hardcodeado. Si el estado es `B` y F0005 tiene `DRDL01='Bloqueado calidad'`, el badge mostrará "Bloqueado calidad".

---

## 6. Tablas Oracle

### 6.1 Tablas principales

| Tabla | Descripción | Campos clave usados |
|---|---|---|
| **F41021** | Stock por ubicación (Item Location) | `LIITM`, `LIMCU`, `LILOTN`, `LILOCN`, `LIPQOH` (×100) |
| **F4108** | Lotes/Palets (Lot Master) | `IOITM`, `IOMCU`, `IOLOTN`, `IOLOT1` (palet), `IOLOT2` (lote), `IOMMEJ` (caducidad CYYDDD), `IOLOTS` (estado) |
| **F4101** | Maestro de artículos | `IMITM`, `IMLITM`, `IMDSC1`, `IMSTKT`, `IMSRP1` (categoría), `IMSRP2` (familia) |
| **F4100** | Ubicaciones (Location Master) | `LMLOCN` — dropdown de ubicaciones |
| **F0006** | Unidades de negocio (plantas) | `MCMCU`, `MCDL01`, `MCSTYL='BP'` |
| **prodctl.F0005** | Códigos y descripciones JDE | `DRKY` (código), `DRDL01` (descripción), `DRSY`, `DRRT` |

### 6.2 Relaciones

```
F41021 (stock)  →  JOIN  →  F4101 (artículo)    por LIITM = IMITM
F41021          →  JOIN  →  F4108 (lote/palet)  por LILOTN+LIITM+LIMCU = IOLOTN+IOITM+IOMCU
                             └─ condición JOIN: IOLOT1 IS NOT NULL OR IOLOT2 IS NOT NULL

F4100  → dropdown de ubicaciones disponibles
F0006  → nombres de planta (MCSTYL='BP')
prodctl.F0005 → estados de lote (DRSY='41', DRRT='L') y categorías/familias
```

### 6.3 Uso de prodctl.F0005 para estados de lote

```sql
SELECT TRIM(F.DRKY) AS CODE, TRIM(F.DRDL01) AS DESCRIPTION
FROM prodctl.f0005 F
WHERE TRIM(F.DRSY) = '41'
  AND TRIM(F.DRRT) = 'L'
  AND TRIM(F.DRKY) IS NOT NULL
ORDER BY TRIM(F.DRKY)
```

- `DRKY` = código almacenado en `F4108.IOLOTS`
- `DRDL01` = descripción legible (lo que aparece en el badge y en el filtro)
- **Valor en blanco = palet válido** (sin estado activo)

Esta consulta se ejecuta con `?onlyLotStates=1` en una llamada ligera al montar la página, sin ejecutar la query principal de stock.

---

## 7. Query principal completa

```sql
SELECT
  TRIM(D.IMLITM) AS IMLITM,
  A.LIITM        AS LIITM,
  TRIM(A.LILOTN) AS LILOTN,
  TRIM(A.LILOCN) AS LILOCN,
  TRIM(A.LIMCU)  AS LIMCU,
  A.LIPQOH       AS LIPQOH,
  TRIM(B.IOLOT1) AS IOLOT1,
  TRIM(B.IOLOT2) AS IOLOT2,
  B.IOMMEJ       AS IOMMEJ,
  TRIM(B.IOLOTS) AS IOLOTS,
  TRIM(D.IMDSC1) AS IMDSC1,
  TRIM(D.IMSTKT) AS IMSTKT
FROM F41021 A
INNER JOIN F4101 D ON D.IMITM = A.LIITM
INNER JOIN F4108 B ON B.IOLOTN = A.LILOTN AND B.IOITM = A.LIITM AND B.IOMCU = A.LIMCU
  AND (TRIM(B.IOLOT1) IS NOT NULL OR TRIM(B.IOLOT2) IS NOT NULL)
WHERE A.LIPQOH > 0
  -- [filtros dinámicos según selección]
ORDER BY B.IOMMEJ ASC NULLS LAST
FETCH FIRST 5000 ROWS ONLY
```

### 7.1 Filtros dinámicos (se añaden con AND)

| Filtro | SQL generado |
|---|---|
| Tipo = caducados | `AND B.IOMMEJ < :todayJde AND B.IOMMEJ > 0` |
| Tipo = obsoletos | `AND D.IMSTKT = 'O'` |
| Tipo = bloqueados | `AND TRIM(B.IOLOTS) IS NOT NULL` |
| Tipo = todos | `AND ((B.IOMMEJ < :todayJde AND B.IOMMEJ > 0) OR D.IMSTKT = 'O' OR TRIM(B.IOLOTS) IS NOT NULL)` |
| Tipo de bloqueo | `AND TRIM(B.IOLOTS) IN (:ls_0, :ls_1, ...)` |
| Categoría | `AND TRIM(D.IMSRP1) IN (:srp1_0, ...)` |
| Familia | `AND TRIM(D.IMSRP2) IN (:srp2_0, ...)` |
| Palet (exacto) | `AND TRIM(B.IOLOT1) = :paletExact` |
| Palet (wildcard) | `AND TRIM(B.IOLOT1) LIKE :paletPattern` |
| Lote (exacto) | `AND TRIM(B.IOLOT2) = :loteExact` |
| Lote (wildcard) | `AND TRIM(B.IOLOT2) LIKE :lotePattern` |
| Planta(s) | `AND TRIM(A.LIMCU) IN (:plant_0, :plant_1, ...)` |
| Ubicación(es) sin GENERICA | `AND TRIM(A.LILOCN) IN (:loc_0, ...)` |
| Ubicación solo GENERICA | `AND (TRIM(A.LILOCN) IS NULL OR TRIM(A.LILOCN) = '')` |
| Ubicación GENERICA + otras | `AND (TRIM(A.LILOCN) IS NULL OR TRIM(A.LILOCN) = '' OR TRIM(A.LILOCN) IN (:loc_0, ...))` |

### 7.2 Nota sobre GENERICA

En JDE, los palets sin ubicación asignada tienen `LILOCN` vacío o NULL. En Oracle, `''` y `NULL` son equivalentes, por lo que la comparación correcta es siempre `IS NULL`. El frontend usa el valor especial `__blank__` para representar esta opción; el backend lo convierte a la condición SQL apropiada.

---

## 8. Lógica de fechas JDE

La fecha de caducidad (`IOMMEJ`) usa el formato **CYYDDD** de JDE:
- `C` = siglo (1 = 2000+)
- `YY` = año dentro del siglo
- `DDD` = día del año

La fecha de hoy en formato JDE se calcula así:
```typescript
const today = new Date();
const yy = today.getFullYear() - 2000;
const ddd = getDayOfYear(today); // de date-fns
const todayJde = 100000 + (yy * 1000) + ddd;
```

Para mostrar la fecha en formato ISO se usa la función `jdeDateToISO()` definida en el propio route.

**Un palet está caducado si:** `IOMMEJ > 0 AND IOMMEJ < todayJde`

---

## 9. Cantidades Oracle

`LIPQOH` (cantidad en stock) viene **×100** desde Oracle. Se divide siempre:
```typescript
const quantity = (row.LIPQOH || 0) / 100;
```

---

## 10. Rendimiento — React

Con filtros amplios (tipo "Todos") se pueden cargar más de 5.000 registros (límite de la query). Para evitar lag al interactuar con los filtros:

- `useDeferredValue(data)` → diferencia la actualización de la tabla del estado de los filtros
- `CaducadosTable` es un componente memoizado (`React.memo`) → solo re-renderiza si cambian los datos reales
- `getMotivoBadge` es función pura a nivel de módulo → no se recrea en cada render

---

## 11. Carga de datos al montar

Al abrir la página se lanzan en paralelo cuatro llamadas ligeras (sin datos de stock):

| Llamada | Endpoint | Qué carga |
|---|---|---|
| `fetchLotStates()` | `GET /api/caducados?onlyLotStates=1` | Estados de lote de F0005 |
| `fetchCategories()` | `GET /api/categories?field=srp1&screen=caducados` | Opciones de Categoría |
| `fetchCategories()` | `GET /api/categories?field=srp2&screen=caducados` | Opciones de Familia |
| `fetchPlants()` | `GET /api/plants?screen=caducados` | Opciones de Planta |

Y una pesada con los datos reales:
- `fetchData()` → `GET /api/caducados` con los filtros activos

**Modo `?onlyLotStates=1`:** cuando la API recibe este parámetro, solo ejecuta la consulta a F0005 y retorna inmediatamente sin ejecutar la query principal de stock (F41021 + F4108 + F4101). Esto hace que el filtro de tipo de bloqueo esté disponible nada más abrir la página.

---

## 12. Parámetro `?screen=` en APIs compartidas

Las APIs `/api/categories` y `/api/plants` son compartidas entre paneles. Para que cada panel valide su propio permiso de acceso, ambas aceptan un parámetro `?screen=`:

```
/api/categories?field=srp1&screen=caducados   → valida acceso a pantalla 'caducados'
/api/plants?screen=caducados                  → valida acceso a pantalla 'caducados'
```

Si no se pasa `screen`, usan su valor por defecto (`produccion` y `pedidos` respectivamente).

---

## 13. Exportación Excel

El botón Excel exporta todos los registros actuales de la tabla. Columnas incluidas:

`Articulo`, `Descripcion`, `Planta`, `Ubicacion`, `Palet_Lote`, `Palet`, `Lote`, `Cantidad`, `Fecha Caducidad`, `Motivo`

El nombre del archivo incluye la fecha: `Caducados_Obsoletos_YYYY-MM-DD.xlsx`.

---

## 14. Logging de consultas

Cada consulta al panel inserta un registro en `query_logs` (SQLite) con `source = 'caducados_obsoletos'`. Filtros registrados:

```json
{
  "plant": "código(s) de planta separados por coma (o null)",
  "type": "todos | caducados | obsoletos | bloqueados",
  "location": "código(s) de ubicación (o null)",
  "lotStates": ["B", "Q"] ,
  "srp1": ["01", "02"],
  "srp2": ["FAM1"]
}
```

El logging **nunca bloquea la respuesta** — se ejecuta en un `try/catch` independiente.

---

## 15. Comportamiento Oracle — notas técnicas

### CHAR padding y TRIM

Todos los campos de texto en JDE son tipo `CHAR` con padding de espacios. Siempre se usa `TRIM()` en comparaciones:
```sql
TRIM(B.IOLOTS) IS NOT NULL   -- correcto para detectar estado vacío
TRIM(A.LIMCU) IN (...)       -- correcto para filtrar por planta
```

### NULL vs cadena vacía

En Oracle `''` (cadena vacía) es equivalente a `NULL`. Por esto:
- `TRIM(col) = ''` evalúa a `UNKNOWN`, no a `TRUE` ni `FALSE`
- La única forma correcta de comprobar si un campo CHAR está vacío es `TRIM(col) IS NULL`

### Variable shadowing en route.ts

Dentro del handler `GET`, la variable `locations` (resultado de F4100) existe en el scope del bloque `try`. El parámetro de filtro de URL se llama `filterLocations` (y `filterPlants` para plantas) para evitar que la variable Oracle tape a la del filtro.

---

## 16. Cómo añadir plantas a otros paneles

El dashboard de caducados obtiene las plantas dinámicamente desde Oracle (F0006 con `MCSTYL='BP'`), por lo que **no necesita cambios** al añadir nuevas plantas.

El dashboard de producción tiene las plantas **hardcodeadas**. Ver sección correspondiente en `docs/produccion.md`.

---

## 17. Añadir nuevos filtros de categoría

Para añadir más filtros de categoría al panel de caducados (por ejemplo Formato `srp3` o Marca `srp4`), seguir este patrón:

**Frontend (`app/caducados/page.tsx`):**
1. Añadir estado: `const [availableSrpX, setAvailableSrpX] = useState([])`
2. Añadir estado selección: `const [selectedSrpX, setSelectedSrpX] = useState<string[]>([])`
3. En `fetchCategories`: añadir `fetch('/api/categories?field=srpX&screen=caducados')`
4. En `fetchData`: añadir `selectedSrpX.forEach(v => params.append('srpX', v))`
5. En `clearFilters`: añadir `setSelectedSrpX([])`
6. En el JSX: añadir `<ArticleMultiSelect articles={availableSrpX} selected={selectedSrpX} onChange={setSelectedSrpX} label="NombreFiltro" />`

**Backend (`app/api/caducados/route.ts`):**
1. Leer el param: `const srpXs = searchParams.getAll('srpX')`
2. Añadir filtro: 
```typescript
if (srpXs.length > 0) {
    const ph = srpXs.map((_, i) => `:srpX_${i}`).join(', ')
    sql += ` AND TRIM(D.IMSRPx) IN (${ph})`
    srpXs.forEach((v, i) => { binds[`srpX_${i}`] = v })
}
```
