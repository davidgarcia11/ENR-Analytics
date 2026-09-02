# Documentación — Control de muestras (`/muestras`)

## 1. Descripción general

Panel operativo (App, no Dashboard) para controlar las muestras de producto terminado
que se envían a laboratorio/calidad: qué lotes están **pendientes** de enviar, cuáles ya
se han **enviado** y cuáles están **completadas**, con un campo de observación libre por
lote. Antes no existía ningún control centralizado ("es un descontrol" — petición
original del usuario).

Primera **App** (no Dashboard) construida sobre el sistema de diseño Nova/ShadcnSpace —
hasta ahora Nova solo tenía paneles analíticos (`/compras`, `/mrp`). Ver
`components/nova/README.md` para el mecanismo de aislamiento del tema.

Origen: ClickUp `[Muestras] Crear panel de control de muestras pendientes/enviadas/completadas`
(#869etmf6d), lista **Muestras** nueva dentro de `ENR Analytics`.

## 2. Archivos relevantes

```
app/muestras/page.tsx                       # Página (client component, Nova)
app/api/muestras/route.ts                   # GET (listado) + PATCH (estado/observación, individual o masivo)
app/api/muestras/config/route.ts            # GET/POST/DELETE — lista global de artículos visibles
app/api/admin/users/[id]/muestras-config/route.ts  # Activa/desactiva can_configure_muestras de un usuario
lib/muestras.ts                             # Helpers compartidos (allowlist, permiso de configuración)
components/nova/muestras-table.tsx          # Tabla: búsqueda/filtro local, selección múltiple, paginación
components/nova/muestras-article-config.tsx # Sheet de configuración de artículos visibles
components/nova/date-range-picker.tsx       # Selector de fechas (día a día, estilo /produccion)
components/shadcn-space/pagination/pagination-02.tsx  # Pagination 02 - Premium Ribbon (ShadcnSpace), parametrizado
lib/panels.ts                               # Entrada 'muestras' (fuente única de paneles)
lib/sqlite.ts                               # Tablas sample_tracking, sample_article_filter; users.can_configure_muestras
components/shadcn-space/blocks/topbar-02/data.ts  # 'muestras' en el grupo Apps del nav
app/admin/page.tsx                          # Columna "Responsable Muestras" en la tabla de Usuarios
app/admin/logs/page.tsx                     # Etiqueta 'muestras' -> 'Muestras' en SOURCE_LABELS
```

## 3. Origen de datos JDE

No hay ninguna tabla de "muestras" en JDE — el listado se construye cruzando tres
tablas ya usadas en otros paneles de este dashboard:

| Tabla | Uso | Campos |
|---|---|---|
| `F4111` | Item Ledger (movimientos de inventario) | `ILDCT` (tipo de movimiento, `'IC'`=producción real — mismo campo/valor que `/produccion` y `/coste-a1`), `ILTRDJ` (fecha JDE del movimiento), `ILITM` (artículo **corto**), `ILLITM` (artículo **largo**, el que se muestra en pantalla) |
| `F4101` | Maestro de artículos | `IMITM` (corto, join), `IMDSC1` (descripción), `IMSRP1` (categoría/tipo real — filtro `= '12'`, Producto terminado, catálogo UDC `41/S1`, mismo campo/valor que `docs/coste-a1.md` §3.1), `IMSRP4` (marca — mismo campo que el filtro "Marca" de `/produccion`, `FilterPanel.tsx`, catálogo UDC `41/S4`) |
| `F4108` | Lot Master | `IOITM` (artículo **corto**, join), `IORLOT` (lote — ver §4) |

Query base (`app/api/muestras/route.ts`):

```sql
SELECT DISTINCT
  TRIM(C.ILLITM) AS ARTICULO,
  TRIM(M.IMDSC1) AS DESCRIPCION,
  TRIM(M.IMSRP4) AS MARCA_COD,
  SUBSTR(TRIM(L.IORLOT), 1, 5) AS LOTE
FROM F4111 C
INNER JOIN F4101 M ON M.IMITM = C.ILITM AND TRIM(M.IMSRP1) = '12'
INNER JOIN F4108 L ON L.IOITM = C.ILITM
WHERE C.ILDCT = 'IC'
  AND C.ILTRDJ BETWEEN :startJde AND :endJde
  AND TRIM(L.IORLOT) IS NOT NULL
```

**Por qué no hace falta pasar por `F4801`** (a diferencia de `/produccion`): no se
necesita el número de orden ni la sub-línea/turno, solo qué se produjo y de qué lote —
`F4111` ya tiene todo lo necesario (tipo de movimiento, fecha, artículo) sin el
`F55TAR12`/`TO55TAREA` que complica la query de `/produccion`.

**Cruce por código CORTO, no largo**: `F4108.IOITM` (corto) con `F4111.ILITM` (corto) —
evita pasar por `F4101` para convertir corto↔largo, a diferencia de `/coste-a1` que
necesita el largo porque busca por `F4101.IMLITM`. El artículo que se enseña en pantalla
es igualmente el largo (`F4111.ILLITM`, directo, sin conversión).

La descripción de marca se resuelve contra el catálogo UDC `41/S4` (`prodctl.f0005`,
`DRSY='41'`, `DRRT='S4'`), mismo patrón que la familia en `/mrp` y `/coste-a1`.

## 4. Regla del lote (`F4108.IORLOT`)

`IORLOT` puede venir en formato compuesto `AAJJJ-AAAAA` — **solo se usan los 5 primeros
caracteres empezando por la izquierda** (`SUBSTR(TRIM(IORLOT), 1, 5)`, petición
explícita del usuario). El `SELECT DISTINCT` sobre `(ARTICULO, LOTE)` ya deduplica: un
lote puede tener varias líneas en `F4108`/`F4111` pero aparece una sola vez en el
listado.

## 5. Estado y observación — capa propia (SQLite)

Estado (`pendiente`/`enviado`/`completado`) y observación **no existen en JDE**: es una
capa propia en `data/app.db`, tabla `sample_tracking` (clave natural `(articulo, lote)`,
igual patrón que `jde_status_descriptions`):

```sql
CREATE TABLE sample_tracking (
  articulo TEXT NOT NULL,
  lote TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'pendiente',
  observacion TEXT NOT NULL DEFAULT '',
  updated_by TEXT,
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (articulo, lote)
);
```

El `GET` cruza el listado de JDE con esta tabla (en memoria, no `JOIN` en SQL — dos
fuentes de datos distintas); si un lote no tiene fila todavía, su estado por defecto es
`pendiente`. El `PATCH` hace `upsert` (`INSERT ... ON CONFLICT(articulo, lote) DO
UPDATE`) — un lote nuevo aparece en la tabla la primera vez que se edita, no antes.

## 6. API

### `GET /api/muestras?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD`

Por defecto, últimos 30 días. Devuelve:

```json
{
  "muestras": [
    { "articulo": "...", "descripcion": "...", "marca": "...", "lote": "...", "estado": "pendiente", "observacion": "" }
  ],
  "resumen": { "total": 0, "pendientes": 0, "enviados": 0, "completados": 0 }
}
```

Registra la consulta en `query_logs` con `source: 'muestras'`, igual que el resto de
paneles.

### `PATCH /api/muestras`

Dos modos, según el body:

- **Individual**: `{ articulo, lote, estado?, observacion? }` — al menos uno de
  `estado`/`observacion`. La observación siempre se edita así, nunca en modo masivo.
- **Masivo** (selección múltiple en la tabla): `{ items: [{articulo, lote}, ...], estado }`
  — todos los lotes de `items` pasan al mismo `estado`, en una única transacción SQLite
  (`db.transaction`, no N peticiones sueltas). Límite de 2000 lotes por petición
  (protección contra un body desproporcionado, no un límite funcional real).

Valida `estado` contra el enum (`pendiente`/`enviado`/`completado`) y acota longitud de
`articulo`/`lote`/`observacion` antes de escribir (bind variables de SQLite ya evitan
inyección, pero se valida igualmente en el límite de la API — ver
`__tests__/sanitization.test.ts` y la regla de `CLAUDE.md`).

### `GET/POST/DELETE /api/muestras/config` — lista de artículos visibles

Lista **global** (no por usuario — ver §8.1) de qué artículos aparecen en `/muestras`.
Si está vacía, no hay restricción (se ven todos los artículos tipo "12"). En cuanto
tiene al menos uno, `GET /api/muestras` restringe el listado a esa lista para todo el
mundo excepto `admin`.

- `GET ?q=texto` → `{ allowlist, results }`. Sin `q`, solo devuelve `allowlist` (la lista
  actual). Con `q`, además busca en `F4101` (mismo filtro `IMSRP1='12'`) por código o
  descripción, máx. 30 resultados, para elegir qué añadir.
- `POST { articulo, descripcion }` → añade (upsert) un artículo a la lista.
- `DELETE ?articulo=...` → lo quita.

Gate propio (`requireMuestrasConfigAccess` en `lib/muestras.ts`, no `requireScreenAccess`):
`admin`, o cualquier usuario con `users.can_configure_muestras = 1`.

## 7. UI (Nova)

- `topbar-02` (header global) — panel registrado en el grupo **Apps** del nav (no
  Dashboards: es una herramienta operativa donde el usuario actúa, no una vista
  analítica — ver comentario en `components/shadcn-space/blocks/topbar-02/data.ts`).
- KPIs (`statistics-04`, 4 tarjetas): Pendientes / Enviados / Completados / Total lotes.
- **Sin gráfico**: herramienta de checklist operativo, no analítica — se añade si
  luego hace falta ver tendencia en el tiempo.
- Rango de fechas: `components/nova/date-range-picker.tsx` — mismo `<input type="date">`
  nativo que `/produccion` (`components/DatePicker.tsx`), envuelto en un popover con
  botón+icono al estilo `MonthRangePicker` de Nova ("el calendario más bonito", petición
  explícita) — no se reutilizó `MonthRangePicker` porque es por mes completo, aquí se
  filtra por día. Por defecto últimos 30 días, con botón "Filtrar" explícito.
- Tabla plana (`components/nova/muestras-table.tsx`, `Table` primitivo de
  `components/nova/ui/`, no la jerárquica de `/compras`/`/mrp`):
  - Búsqueda y filtro de estado son **locales** (sobre los datos ya cargados). **Filtro
    de estado por defecto: "Pendiente"** (petición explícita) — el usuario cambia a
    Enviado/Completado/Todos si quiere.
  - Estado se edita con un `Select` por fila (color de fondo distinto por estado) y
    observación con un `Input` por fila que guarda al perder el foco (`onBlur`).
  - **Selección múltiple**: checkbox por fila + checkbox de cabecera (selecciona la
    página actual). Si hay más lotes filtrados que los de la página, aparece un enlace
    "Seleccionar los N lotes filtrados" para extender la selección a todo lo filtrado,
    no solo la página visible (patrón tipo Gmail). Con algo seleccionado aparece una
    barra con un `Select` de estado + botón "Aplicar a N", que llama al modo masivo del
    `PATCH`.
  - **Paginación**: `components/shadcn-space/pagination/pagination-02.tsx` (bloque
    oficial `@shadcn-space/pagination-02`, "Pagination 02 - Premium Ribbon", instalado
    con `bunx shadcn add` y adaptado para recibir `page`/`totalPages`/`onPageChange` en
    vez del estado interno de ejemplo con el que viene el bloque), 50 lotes por página.
    Solo se muestra si hay más de una página.
- Actualización **optimista**: el cambio (individual o masivo) se refleja en pantalla al
  instante; si la petición falla, se avisa con un toast y se vuelve a pedir el listado
  completo para no dejar la pantalla desincronizada de la BD.
- **Configuración de artículos visibles** (`components/nova/muestras-article-config.tsx`,
  botón "Artículos visibles" junto al filtro de fechas): solo se monta si
  `sessionUser.role === 'admin' || sessionUser.canConfigureMuestras` — comprobación de
  UI únicamente, el servidor vuelve a comprobarlo en `/api/muestras/config`. `Sheet`
  lateral con buscador (debounce 300ms) sobre `F4101` y la lista actual como `Badge`s
  con botón de quitar.

## 8. Permisos

Pantalla `muestras` con `requireScreenAccess('muestras')` en `GET` y `PATCH` — sin
lógica de roles especial en código: el rol dedicado se crea y asigna desde `/admin`
(pestaña Roles/Pantallas), junto con `admin` (acceso siempre garantizado por
`canAccessPanel`).

### 8.1 Quién puede configurar qué artículos se ven (`can_configure_muestras`)

Decisión explícita del usuario: la lista de artículos visibles (§6, `sample_article_filter`)
**no es por usuario individual** — es una única lista compartida por todo el mundo que
usa `/muestras`. Lo que sí es por usuario individual es el **permiso para editar esa
lista**: columna `users.can_configure_muestras` (0/1), activable por `admin` desde
`/admin` (pestaña Usuarios, columna "Responsable Muestras") para cualquier usuario
concreto — no ligado a un rol, para poder dárselo a una sola persona sin tener que crear
un rol nuevo solo para eso (petición explícita: *"¿y si quiero que un usuario concreto
tenga eso?"*).

`admin` siempre puede **configurar** la lista (igual que siempre tiene acceso a
cualquier pantalla, `canAccessPanel`), pero a diferencia del resto de restricciones
del proyecto, **aquí no hay bypass de admin al consultar el listado**: si hay una
lista configurada, se aplica también a admin — petición explícita del usuario ("no
puede ser que el admin vea todos los artículos, querrá ver los que se hayan
configurado para que salgan"). Cualquiera con `can_configure_muestras = 1` (admin o
no) sigue viendo `/muestras` restringido a la lista que él mismo configura — si
necesita ver algo fuera de esa lista, lo añade él mismo.

## 9. Registro del panel — checklist seguido

1. `lib/panels.ts` → entrada `muestras` (fuente única de paneles, ver comentario en el
   propio archivo).
2. `components/shadcn-space/blocks/topbar-02/data.ts` → `muestras` en `APP_KEYS`.
3. `lib/sqlite.ts` → tablas `sample_tracking`, `sample_article_filter`, columna
   `users.can_configure_muestras` (se siembra automáticamente `screens` desde `PANELS`,
   pública por defecto, restringible desde `/admin`).
4. `app/api/muestras/route.ts` → `requireScreenAccess('muestras')`, logging en
   `query_logs` con `source: 'muestras'`.
5. `app/admin/logs/page.tsx` → etiqueta `'muestras'` → `'Muestras'` en `SOURCE_LABELS`.

## 10. Fuera de alcance en esta primera versión

- **Export a Excel**: no incluido — se añade si hace falta compartir el listado fuera
  de la app (patrón ya usado en `/mrp` y `/compras` con `xlsx`, fácil de replicar).
- **Filtro por planta**: la planta del lote está disponible en `F4108.IOMCU` pero no se
  usa todavía (ni como columna ni como filtro) — se añade si se pide.
- **Gráfico/tendencia temporal**: ver §7, decisión deliberada de la v1.
- **Historial de quién añadió/quitó un artículo de la lista** (§6): `sample_article_filter`
  no guarda auditoría de cambios, solo el estado actual — se añade si hace falta trazar
  quién configuró qué.
