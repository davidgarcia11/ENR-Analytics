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
app/api/muestras/route.ts                   # GET (listado, lee la caché local) + PATCH (estado/observación, individual o masivo)
app/api/muestras/config/route.ts            # GET/POST/DELETE — lista global de artículos visibles; POST dispara runFullSync()
app/api/admin/muestras-sync/route.ts        # GET (estado) + POST (botón "Sincronizar ahora" manual, admin)
app/api/admin/users/[id]/permisos/route.ts  # Activa/desactiva un permiso suelto (aquí 'muestras.config') de un usuario
lib/muestras.ts                             # runFullSync, ensureSyncScheduler, allowlist, permiso de configuración
components/nova/muestras-table.tsx          # Tabla: búsqueda/filtro local, selección múltiple, paginación
components/nova/muestras-article-config.tsx # Sheet de configuración de artículos visibles
components/nova/date-range-picker.tsx       # Selector de fechas (día a día, estilo /produccion)
components/shadcn-space/pagination/pagination-02.tsx  # Pagination 02 - Premium Ribbon (ShadcnSpace), parametrizado
lib/panels.ts                               # Entrada 'muestras' (fuente única de paneles)
lib/sqlite.ts                               # Tablas sample_tracking, sample_article_filter, sample_candidates, sample_sync_state; user_permissions
lib/permisos.ts                             # Catálogo de permisos sueltos (incluye 'muestras.config')
components/shadcn-space/blocks/topbar-02/data.ts  # 'muestras' en el grupo Apps del nav
components/nova/admin/muestras-sync.tsx     # /admin → Muestras → Sincronización (estado de la caché + sincronización manual)
components/nova/admin/logs-consultas.tsx  # Fuentes 'muestras'/'muestras-sync' en SOURCE_LABELS + resumen de filtros de sincronización
```

## 3. Origen de datos JDE y caché local

No hay ninguna tabla de "muestras" en JDE. El panel **nunca consulta Oracle en
directo** — siempre lee de `sample_candidates` (SQLite), una caché local mantenida por
`lib/muestras.ts` (`runFullSync`). Motivo (medido contra Oracle real, no supuesto):

- Sin filtrar por artículo, `F4111` solo tiene un índice sobre `ILDCT` — cualquier
  consulta (con o sin fecha) obliga a repasar los ~544.000 movimientos "IC" de toda la
  empresa antes de poder filtrar nada más. Sin límite de fechas, esto **rompe la
  conexión a Oracle** (probado: 3+ minutos sin terminar). Acotado por fecha, sigue
  constando varios segundos a decenas de segundos, inestable.
- Cruzar con `F4108` (Lot Master) para sacar el lote, sin ningún filtro de fecha en el
  lado del lote, es otro cuello de botella aparte (13,6s en un tramo de 1 día, medido).
- **Filtrando por los artículos concretos de la lista de "Artículos visibles"** (10-15
  en la práctica), Oracle sí puede usar un índice que combina tipo de movimiento +
  artículo (`F4111_14`) — el histórico **completo**, sin ningún límite de fecha, de un
  puñado de artículos tarda segundos, no minutos (medido: 6 artículos, todo el
  histórico, 6,4s). Por eso la sincronización siempre va filtrada por esa lista — ver
  §"Caché y sincronización" más abajo.

| Tabla | Uso | Campos |
|---|---|---|
| `F4111` | Item Ledger (movimientos de inventario) | `ILDCT` (tipo de movimiento, `'IC'`=producción real — mismo campo/valor que `/produccion` y `/coste-a1`), `ILTRDJ` (fecha JDE del movimiento), `ILLITM` (artículo **largo**, el que se muestra en pantalla y el que se usa para filtrar), `ILLOTN` (SSCC del palet + lote concatenados — ver §4) |
| `F4101` | Maestro de artículos | `IMITM` (corto, join con `F4111.ILITM`), `IMDSC1` (descripción), `IMSRP1` (categoría/tipo real, `= '12'` = Producto terminado — solo como filtro de seguridad, ya no hace falta para nada más porque la propia lista de artículos configurados ya son todos tipo 12), `IMSRP4` (marca — mismo campo que el filtro "Marca" de `/produccion`, `FilterPanel.tsx`, catálogo UDC `41/S4`) |

Query de sincronización (`lib/muestras.ts`, `runFullSync`) — `:a0, :a1, ...` son los
artículos de `sample_article_filter`, sin ningún límite de fecha:

```sql
SELECT DISTINCT
  TRIM(C.ILLITM) AS ARTICULO,
  TRIM(M.IMDSC1) AS DESCRIPCION,
  TRIM(M.IMSRP4) AS MARCA_COD,
  SUBSTR(TRIM(C.ILLOTN), INSTR(TRIM(C.ILLOTN), '_') + 1, 5) AS LOTE,
  C.ILTRDJ AS FECHA_JDE
FROM F4111 C
INNER JOIN F4101 M ON M.IMITM = C.ILITM AND TRIM(M.IMSRP1) = '12'
WHERE C.ILDCT = 'IC'
  AND TRIM(C.ILLITM) IN (:a0, :a1, ...)
  AND INSTR(TRIM(C.ILLOTN), '_') > 0
```

**Ya NO se cruza con `F4108`** (versión anterior de este panel sí lo hacía) — el lote
sale directo de `F4111.ILLOTN` (ver §4), y quitar ese cruce elimina uno de los dos
cuellos de botella descritos arriba.

La descripción de marca se resuelve con una consulta suelta al catálogo UDC `41/S4`
(`prodctl.f0005`, `DRSY='41'`, `DRRT='S4'`) — no con un `LEFT JOIN` por fila, que tiene
el mismo problema de rendimiento que el cruce a `F4108` (medido: 70s en un tramo de 90
días). Mismo patrón (consulta aparte + mapa en memoria) que la familia en `/mrp` y
`/coste-a1`.

## 4. Regla del lote (`F4111.ILLOTN`)

`ILLOTN` es un campo compuesto: `<SSCC del palet>_<lote>`, por ejemplo
`984365783310659485_26153102`. El SSCC de la izquierda a veces sale recortado (le
faltan dígitos) si el lote de la derecha es largo, pero **el lote de la derecha
siempre sale completo**. La regla (confirmada con datos reales) es: todo lo que hay
después del primer `_`, y de eso, **los 5 primeros caracteres empezando por la
izquierda** — `SUBSTR(TRIM(ILLOTN), INSTR(TRIM(ILLOTN), '_') + 1, 5)`. En el ejemplo
de arriba, el lote es `26153` (y coincide con el propio `ILTRDJ` de esa fila, `YYDDD`).

El `SELECT DISTINCT` sobre `(ARTICULO, LOTE)` ya deduplica: un lote puede tener varias
líneas en `F4111` (varios palets) pero aparece una sola vez en el listado.

## 4bis. Caché y sincronización (`sample_candidates`, `lib/muestras.ts`)

```sql
CREATE TABLE sample_candidates (
  articulo TEXT NOT NULL,
  lote TEXT NOT NULL,
  descripcion TEXT NOT NULL DEFAULT '',
  marca TEXT NOT NULL DEFAULT '',
  fecha_jde INTEGER,          -- ILTRDJ, solo para el filtro de fechas del panel (en memoria, no vuelve a Oracle)
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (articulo, lote)
);

CREATE TABLE sample_sync_state (        -- fila única (id=1)
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_synced_at TEXT,
  candidatos_sincronizados INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);
```

**`runFullSync()`** trae SIEMPRE el histórico completo de los artículos que haya en
`sample_article_filter` (nunca "solo lo nuevo") — sin marca de agua, sin backfill por
tramos, sin distinguir tipos de fecha JDE. Como cada sincronización vuelve a traer todo,
nunca se puede perder una corrección tardía de JDE por antigua que sea la fecha que
lleve, sea cual sea el campo de fecha que la registre — no hay ningún límite de fecha
del que depender para eso.

Se dispara en tres momentos:
1. **Al cambiar la lista de artículos** (`POST /api/muestras/config`, ver §6) —
   síncrono, la petición espera a que termine (segundos) antes de responder.
2. **Cada 30 minutos**, de fondo (`ensureSyncScheduler`, `setInterval` de servidor —
   sin cron externo, este proyecto no tiene nada así montado; se registra una sola vez
   por proceso, llamado de forma barata desde `GET /api/muestras`).
3. **Manualmente**, botón "Sincronizar ahora" en `/admin` → pestaña Muestras
   (`POST /api/admin/muestras-sync`) — por si acaso, no hace falta para el
   funcionamiento normal.

**Cada ejecución queda registrada** en `query_logs` (mismo sistema de logs que el resto
de paneles, `/admin/logs`), fuente `muestras-sync` — no solo la última: cada
sincronización real (no las que no hacen nada por lista vacía) inserta una fila nueva,
con quién/qué la disparó (`trigger`: `scheduled`/`config-change`/`manual`, y el usuario
si lo hay), cuántos artículos había configurados, cuántos lotes trajo (`result_count`),
cuánto tardó (`execution_time_ms`) y el error si falló. `sample_sync_state` (arriba)
sigue existiendo aparte, solo para el vistazo rápido del estado actual en `/admin` — el
historial completo de todas las sincronizaciones vive en `query_logs`.

**Si `sample_article_filter` está vacía** (antes de que admin/responsable configure
algún artículo — el único momento en que esto pasa en la práctica), `runFullSync` no
hace nada: sincronizar sin filtrar por artículo es precisamente la consulta
lenta/inestable que se quería evitar. `GET /api/muestras` devuelve `sinConfigurar: true`
y el panel avisa de que hace falta configurar artículos primero, en vez de intentar
mostrar el universo entero.

**Quitar un artículo de la lista** no borra sus filas de `sample_candidates` — se
quedan tal cual, simplemente dejan de sincronizarse y quedan ocultas (el filtro por
lista ya las esconde). Si se vuelve a añadir el mismo artículo más adelante, la
siguiente sincronización trae de golpe tanto lo que ya había como lo que se haya
producido mientras estuvo fuera — no se pierde nada por el camino. El estado y la
observación de sus lotes (`sample_tracking`, tabla totalmente aparte, ver §5) tampoco
se tocan nunca por esto, así que reaparecen tal cual al reconfigurar el artículo.

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

Lee de la caché local (`sample_candidates`), nunca de Oracle. Sin `startDate`/`endDate`,
sin límite de fechas (todo lo sincronizado) — ver §4bis para por qué no hace falta.
Devuelve:

```json
{
  "muestras": [
    { "articulo": "...", "descripcion": "...", "marca": "...", "lote": "...", "estado": "pendiente", "observacion": "" }
  ],
  "resumen": { "total": 0, "pendientes": 0, "enviados": 0, "completados": 0 },
  "sinConfigurar": false
}
```

`sinConfigurar: true` (y `muestras: []`) cuando `sample_article_filter` está vacía —
ver §4bis. Registra la consulta en `query_logs` con `source: 'muestras'`, igual que el
resto de paneles. También llama a `ensureSyncScheduler()` (idempotente) para asegurar
que el repaso de 30 min está registrado.

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
**Si está vacía, no se ve nada** (ya no "se ven todos" — cambio deliberado respecto a la
primera versión, ver §4bis: sin lista no hay nada sincronizado, y sincronizar sin
filtrar por artículo es justo la consulta inviable).

- `GET ?q=texto` → `{ allowlist, results }`. Sin `q`, solo devuelve `allowlist` (la lista
  actual). Con `q`, además busca en `F4101` (mismo filtro `IMSRP1='12'`) por código o
  descripción, máx. 30 resultados, para elegir qué añadir.
- `POST { articulo, descripcion }` → añade (upsert) un artículo a la lista y dispara
  `runFullSync()` de forma síncrona (la petición espera esos segundos) — así el
  artículo recién añadido aparece en `/muestras` sin esperar al repaso de 30 min.
- `DELETE ?articulo=...` → lo quita de la lista (no borra sus filas de la caché, ver
  §4bis) — no dispara sincronización, no hay nada nuevo que traer.

Gate propio (`requireMuestrasConfigAccess` en `lib/muestras.ts`, no `requireScreenAccess`):
`admin`, o cualquier usuario con el permiso suelto `muestras.config`  (`user_permissions`) o que lo tenga por su rol (`role_permissions`).

### `GET/POST /api/admin/muestras-sync` — sincronización manual (admin)

Botón "Sincronizar ahora" de `/admin` → pestaña Muestras. `GET` devuelve
`{ lastSyncedAt, candidatosSincronizados, error, articulosConfigurados }`; `POST` llama
a `runFullSync()` y espera a que termine (ya no hace falta barra de progreso ni
polling, como en la primera versión con backfill por tramos — con la lista de
artículos configurada, tarda segundos).

## 7. UI (Nova)

- `topbar-02` (header global) — panel registrado en el grupo **Apps** del nav (no
  Dashboards: es una herramienta operativa donde el usuario actúa, no una vista
  analítica — ver comentario en `components/shadcn-space/blocks/topbar-02/data.ts`).
- KPIs (`statistics-04`, 4 tarjetas): Pendientes / Enviados / Completados / Total lotes.
  El número grande de cada KPI de estado lleva el mismo color que ese estado en la
  tabla (`ESTADO_TEXT_COLOR`, exportado desde `muestras-table.tsx` para no duplicar la
  paleta) — requirió añadir `valueClassName` a `statistics-04/statistics.tsx` (no
  existía en esta rama; sí en el WIP de `/produccion-v2`, de donde se copió el patrón).
- **Sin gráfico**: herramienta de checklist operativo, no analítica — se añade si
  luego hace falta ver tendencia en el tiempo.
- Rango de fechas: `components/nova/date-range-picker.tsx` — mismo `<input type="date">`
  nativo que `/produccion` (`components/DatePicker.tsx`), envuelto en un popover con
  botón+icono al estilo `MonthRangePicker` de Nova ("el calendario más bonito", petición
  explícita) — no se reutilizó `MonthRangePicker` porque es por mes completo, aquí se
  filtra por día. Por defecto últimos 30 días, con botón "Filtrar" explícito.
- Tabla plana (`components/nova/muestras-table.tsx`, `Table` primitivo de
  `components/nova/ui/`, no la jerárquica de `/compras`/`/mrp` — estructura distinta a
  propósito, no hace falta drill-down aquí). **Mismo tratamiento visual que
  `hierarchical-table.tsx`** (petición explícita: que se "parezcan" aunque el contenido
  sea distinto) — mismos componentes compartidos (`Card`/`CardHeader`/`CardContent` de
  `components/nova/ui/`), cabecera de columnas con fondo `bg-muted/40`, alto de fila
  `h-12`, celdas `px-4 py-0 align-middle`, borde `border-border/60`. El título ("Lotes")
  y el contador van en `CardHeader`, igual que compras pone su título + píldoras de
  ruta ahí; el buscador y el filtro de estado (propios de esta tabla, no de la página)
  van en el mismo `CardHeader`, en vez de sueltos encima de la tarjeta.
  - Búsqueda y filtro de estado son **locales** (sobre los datos ya cargados). **Filtro
    de estado por defecto: "Pendiente"** (petición explícita) — el usuario cambia a
    Enviado/Completado/Todos si quiere.
  - **Ordenación** (local, sobre `filtradas`, antes de paginar): clic en cabecera de
    Artículo/Marca/Lote (únicas columnas ordenables) alterna sin orden → ascendente →
    descendente, con icono `ArrowUp`/`ArrowDown`/`ArrowUpDown` (lucide-react) junto al
    texto. Un solo criterio de orden a la vez (clic en otra columna sustituye al
    anterior). `localeCompare(..., "es", { numeric: true })` para que el Lote (numérico
    como texto) ordene por valor y no lexicográficamente.
  - Estado se edita con un `Select` por fila y observación con un `Input` por fila que
    guarda al perder el foco (`onBlur`). El texto del estado siempre sale con mayúscula
    inicial (`ESTADO_LABEL`, no el valor crudo `pendiente`/`enviado`/`completado`) —
    también en los toasts de `page.tsx`, que reutilizan el mismo `ESTADO_LABEL`
    exportado desde `muestras-table.tsx` en vez de tener su propia copia.
  - Los tres `Select` de estado (filtro de cabecera, barra de selección múltiple y el de
    cada fila) siguen el patrón oficial ShadcnSpace **"Select 03 - Select with status"**
    (`@shadcn-space/select-03`, petición explícita): un `CircleIcon` de `lucide-react`
    relleno con el color del estado (`ESTADO_DOT_COLOR`, formato `text-x fill-x`) delante
    de la etiqueta, tanto en el trigger cerrado como en cada opción del desplegable — en
    vez del fondo/borde de color en el trigger que se usó al principio.
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
  `tienePermiso(sessionUser, 'muestras.config')` (lib/permisos.ts, cuenta al admin) — comprobación de
  UI únicamente, el servidor vuelve a comprobarlo en `/api/muestras/config`. `Sheet`
  lateral con buscador (debounce 300ms) sobre `F4101` y la lista actual como `Badge`s
  con botón de quitar.

## 8. Permisos

Pantalla `muestras` con `requireScreenAccess('muestras')` en `GET` y `PATCH` — sin
lógica de roles especial en código: el rol dedicado se crea y asigna desde `/admin`
(pestaña Roles/Pantallas), junto con `admin` (acceso siempre garantizado por
`canAccessPanel`).

### 8.1 Quién puede configurar qué artículos se ven (permiso `muestras.config`)

Decisión explícita del usuario: la lista de artículos visibles (§6, `sample_article_filter`)
**no es por usuario individual** — es una única lista compartida por todo el mundo que
usa `/muestras`. Lo que sí es por usuario individual es el **permiso para editar esa
lista**: permiso suelto `muestras.config` (tabla `user_permissions`, catálogo en
`lib/permisos.ts` — ver DOCUMENTACION.md §5b), que el admin concede a un rol entero
(`/admin` → Roles y permisos) o, como excepción, a un usuario concreto (sus accesos en
`/admin` → Usuarios). Hasta la rama
`feature/admin-sidebar-permisos` era la columna `users.can_configure_muestras`; se
migró automáticamente (quien lo tenía lo conserva) y la columna se eliminó. Sigue siendo
por usuario concreto — no ligado a un rol, para poder dárselo a una sola persona sin tener que crear
un rol nuevo solo para eso (petición explícita: *"¿y si quiero que un usuario concreto
tenga eso?"*).

`admin` siempre puede **configurar** la lista (igual que siempre tiene acceso a
cualquier pantalla, `canAccessPanel`), pero a diferencia del resto de restricciones
del proyecto, **aquí no hay bypass de admin al consultar el listado**: si hay una
lista configurada, se aplica también a admin — petición explícita del usuario ("no
puede ser que el admin vea todos los artículos, querrá ver los que se hayan
configurado para que salgan"). Cualquiera con el permiso `muestras.config` (admin o
no) sigue viendo `/muestras` restringido a la lista que él mismo configura — si
necesita ver algo fuera de esa lista, lo añade él mismo.

## 9. Registro del panel — checklist seguido

1. `lib/panels.ts` → entrada `muestras` (fuente única de paneles, ver comentario en el
   propio archivo).
2. `components/shadcn-space/blocks/topbar-02/data.ts` → `muestras` en `APP_KEYS`.
3. `lib/sqlite.ts` → tablas `sample_tracking`, `sample_article_filter`,
   `sample_candidates`, `sample_sync_state` (el permiso de configuración vive en
   `user_permissions`, ver §8.1)
   (se siembra automáticamente `screens` desde `PANELS`, pública por defecto,
   restringible desde `/admin`).
4. `app/api/muestras/route.ts` → `requireScreenAccess('muestras')`, logging en
   `query_logs` con `source: 'muestras'`.
5. `app/admin/logs/page.tsx` (hoy `components/nova/admin/logs-consultas.tsx`) → etiquetas `'muestras'` → `'Muestras'` y `'muestras-sync'`
   → `'Muestras (sincronización)'` en `SOURCE_LABELS`, más un caso especial en
   `summarizeFilters` para mostrar el disparador/artículos/error de cada sincronización.

## 10. Fuera de alcance en esta primera versión

- **Export a Excel**: no incluido — se añade si hace falta compartir el listado fuera
  de la app (patrón ya usado en `/mrp` y `/compras` con `xlsx`, fácil de replicar).
- **Filtro por planta**: ya no se cruza con `F4108` (§3), así que la planta del lote no
  está disponible en la caché actual — habría que añadirla desde otra tabla si se pide.
- **Gráfico/tendencia temporal**: ver §7, decisión deliberada de la v1.
- **Historial de quién añadió/quitó un artículo de la lista** (§6): `sample_article_filter`
  no guarda auditoría de cambios, solo el estado actual — se añade si hace falta trazar
  quién configuró qué.

## Presets

Botón «Presets» en la barra de filtros (los comunes de Nova, `components/nova/README.md` punto 15).
Como el panel solo filtra por fechas, cada preset guarda un periodo (`screen = 'muestras'`): fijo o
relativo (últimos 7/30/90 días, mes en curso…). Sin preset predeterminado se sigue abriendo con todas
las fechas; con él, se abre con su periodo.
