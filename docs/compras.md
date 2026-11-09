# Documentación — Panel de Compras (`/compras`)

> Panel de comparativa previsión de ventas vs. venta real, rediseñado sobre el sistema de
> diseño **Nova** (ShadcnSpace) — sustituye a la versión anterior (basada en
> `components/ui/`, sin jerarquía Familia›Canal›Artículo). Esa versión anterior queda
> documentada en [`docs/compras-v1-historico.md`](./compras-v1-historico.md) — tiene
> conocimiento de JDE que sigue vigente aquí (mapeo artículo largo/corto, filtro
> `SDNXTR`, recordatorio anual de `COLEDG_VIGENTE`...). Ver
> [DOCUMENTACION.md](../DOCUMENTACION.md) para la base del proyecto y
> [`components/nova/README.md`](../components/nova/README.md) para el sistema de diseño
> Nova (aislamiento, configuración, decisiones de instalación) — es el primer panel real
> construido con Nova, sirve de referencia para los siguientes.

---

## 1. Descripción general

Mismo objetivo de negocio que la versión anterior (anticipar necesidades de compra
comparando previsión JDE vs. venta real), con dos cambios de fondo:

- **Jerarquía en vez de tabla plana**: Familia › Canal › Artículo, con drill-down real
  (expandir/colapsar) en lugar de filtros de artículo/marca sueltos.
- **UI construida sobre Nova** (`[data-nova-theme]`, ver README de Nova) en vez del
  sistema de componentes `components/ui/`.

Este panel es también el banco de pruebas de Nova: la mayoría de decisiones documentadas
aquí (estructura de página, nav con caja redondeada, selector de meses propio, cabecera
compartida) aplican igual al construir el próximo panel Nova, no solo a compras.

**Acceso**: `requireScreenAccess('compras')`, misma entrada `compras` de `screens` que
tenía la versión anterior. **Logging de consultas**: sí, en `query_logs` con
`source: 'compras'` (mismo source que la versión anterior, para que `/admin/logs` muestre
continuidad — ver §7.1).

---

## 2. Archivos relevantes

| Archivo | Descripción |
|---|---|
| `app/compras/page.tsx` | Página cliente — toolbar (selector de meses + tabs de unidad + exportar), KPIs, gráficos, tabla jerárquica |
| `app/api/compras/route.ts` | API Route servidor — agregación bottom-up Familia›Canal›Artículo, modo real y modo `?mock=1` |
| `components/nova/hierarchical-table.tsx` | Tabla jerárquica (TanStack Table v8, `subRows`) + píldoras de ruta (`DrillPills`) |
| `components/nova/deviation-by-family-chart.tsx` | Gráfico de desviación por familia (barras divergentes desde el centro, sin Recharts) |
| `components/nova/month-range-picker.tsx` | Selector de rango de meses completos (sin día) |
| `components/nova/mode-toggle.tsx` | Selector Claro/Oscuro/Sistema |
| `components/shadcn-space/blocks/topbar-02/` | Header compartido (nav por dropdowns, perfil, notificaciones) — bloque del catálogo ShadcnSpace |
| `components/nova/panel-shell.tsx` | **Actual**: armazón con barra lateral ShadcnSpace que sustituyó a la barra de arriba (`topbar-02`, ya sin uso) en todos los paneles Nova — ver README Nova punto 12. Las notas de este documento sobre `topbar-02` son históricas |
| `components/shadcn-space/blocks/statistics-04/` | Tarjetas KPI (bloque del catálogo) |
| `components/shadcn-space/blocks/chart-15/` | Gráfico de barras agrupadas de evolución mensual (bloque del catálogo, adaptado) |

---

## 3. Esquema Oracle/JDE

Reutiliza las mismas tablas que la versión anterior (`F3460`, `F4211`, `F4105`,
`F554101`, `F4101`), más dos consultas nuevas al catálogo UDC (`prodctl.f0005`) para
resolver códigos a descripciones:

| Tabla | Uso | Diferencia con la versión anterior |
|---|---|---|
| `F3460` | Previsión (`MFDRQJ`, `MFFQT`) | Igual, más `MFDRQJ` ahora usado para bucket mensual (antes solo se sumaba el periodo completo) |
| `F4211` | Venta real (`SDADDJ`, `SDSOQS`, `SDUPRC`) | Mismo filtro (`SDDCTO != 'ST'`, `SDADDJ != 0`). Campo de cantidad cambiado de `SDUORG` (el que usaba la versión anterior) a `SDSOQS` |
| `F4105` | Coste (`COUNCS`, `COLEDG_VIGENTE` constante) | Igual |
| `F4101` | Familia (`IMSRP2`) | **Antes se mostraba el código crudo** (`IMSRP2`, ej. `"101"`) sin resolver. Ahora se resuelve contra `prodctl.f0005` (UDC `41`/`S2`) — bug real encontrado solo con datos reales, ver §8 |
| `F554101` | Canal (`AAZE06`) + gramaje (`AAZE03`) | Antes no había canal — se usaba **Marca** (`F4101.IMSRP4`) como segunda dimensión. Ahora se usa **Canal**, un campo distinto (ver §3.1) |
| `prodctl.f0005` | Catálogo UDC — `41/S2` (familia), `17/B6` (canal) | Nuevo. Resuelve código → descripción legible, nunca se muestra el código crudo |

### 3.5 Previsión original (PN) vs. modificada (PM)

`F3460.MFTYPF` distingue la previsión original (`PN`) de la modificada (`PM`). La
consulta filtra siempre por uno solo (`TRIM(MFTYPF) = :tipoPrev`, bind variable) y
**nunca los suma**: son dos versiones de la misma previsión. El panel tiene un
selector PM/PN (default PM) que recarga los datos; el tipo va en el nombre del Excel
exportado. Antes de esta rama la consulta no filtraba por `MFTYPF`, así que "previsto"
sumaba ambos tipos si coexistían para un mismo artículo y mes.

### 3.1 Canal (actual) no es Marca (versión anterior) — son campos distintos

**Importante para quien compare contra la versión anterior**: aquella agrupaba/filtraba
por **Marca** (`F4101.IMSRP4`). Este panel agrupa por **Canal** (`F554101.AAZE06`). No es
el mismo dato con otro nombre — son dos UDC distintos del maestro de artículos,
confirmados contra el esquema real. Canal es un atributo del **artículo** (como el
gramaje), no del cliente que compra — un artículo pertenece a un único canal, y sus
ventas se atribuyen íntegramente a él, independientemente de quién lo compre.
**Pendiente de validar con comercial** que este supuesto sea correcto de cara a negocio.

### 3.2 Casing de los catálogos UDC — no es simétrico

`prodctl.f0005.DRDL01` (descripción) viene ya bien formateada para el catálogo de canal
(`17/B6`, ej. `"Mercadona LPC"`), pero **en mayúsculas** para el de familia (`41/S2`, ej.
`"TORTILLA"`) — comprobado empíricamente, no es un patrón general de JDE. Por eso
`capitalizarFrase()` (sentence-case, no Title Case: `"Preparados a base de patata"`, no
`"Preparados A Base De Patata"`) se aplica **solo** a `familiaLabels`, nunca a
`canalLabels` — aplicarlo ahí mangling acrónimos reales como `"LPC"`.

### 3.3 Importe (€) — misma fórmula asimétrica que la versión anterior

```
previsto = unidades_previstas × coste_unitario_fijo   (F4105.COUNCS, foto sin mes propio)
real     = Σ (SDSOQS/100 × SDUPRC/10000)              (línea a línea, NUNCA unidades_reales × coste)
```

### 3.4 Venta real agregada en Oracle

`GET /api/compras` no trae una fila por línea de F4211: la consulta hace `GROUP BY` artículo (largo y corto) × mes y devuelve `SUM(SDSOQS)` (×100) y `SUM(SDSOQS × SDUPRC)` (×1.000.000, porque cantidad ×100 y precio ×10.000). El mes sale de `TO_CHAR(TO_DATE(TO_CHAR(SDADDJ + 1900000), 'YYYYDDD'), 'YYYYMM')`. Es equivalente a sumar línea a línea en JS (el importe sigue siendo línea a línea, nunca unidades × coste), pero mueve muchas menos filas. **Validar contra producción** que los totales coinciden con los de antes de este cambio (misma consulta, mismo rango).


Igual que antes (§4 de `docs/compras-v1-historico.md`): el precio de venta real no es el
coste presupuestado, así que el importe real nunca sale de multiplicar cantidad×coste.

---

## 4. Agregación bottom-up (`aggregate()` en `api/compras/route.ts`)

Artículo → Canal → Familia → Total, en las 3 unidades (Unidades/Kg/Importe) y en series
mensuales, con una única función `aggregate()` usada **tanto para datos reales como para
el modo `?mock=1`** — los totales cuadran por construcción en ambos casos, no hay dos
implementaciones que puedan desincronizarse.

- Un artículo sin gramaje (`F554101.AAZE03` nulo/no numérico) se excluye de las sumas de
  Kg en todos los niveles que lo contienen; se reporta en `resumen.articulosSinGramaje`.
- Un artículo sin coste (`F4105`) se excluye igual de las sumas de Importe; se reporta en
  `resumen.articulosSinCoste`.
- **A diferencia de la versión anterior, no hay avisos por artículo+mes**
  (`"Sin previsión este mes"`, `"Sin venta este mes"`...) — solo estas dos listas a nivel
  de artículo completo. Gap conocido, ver §9.

### 4.1 Orden de familias

`FAMILIA_ORDEN` fija el orden de visualización (no alfabético), para que tabla y gráfico
de desviación se puedan leer fila a fila. Familias fuera de esa lista van al final,
alfabéticas entre sí.

---

## 5. Modo de datos de ejemplo (`?mock=1`)

Generado con la misma función `aggregate()` que el camino real, sobre una campaña fija
sep-2025→ago-2026 (`CAMPANA`/`MOCK_CANAL_LABELS` hardcodeados **solo** en la rama mock).
Pensado para desarrollar la interacción de los 3 niveles sin depender de Oracle.

**No hay botón en la UI para activarlo** (decisión del usuario: el panel siempre pide
datos reales). Sigue accesible solo por URL (`/api/compras?mock=1`) para depuración
puntual — no se ha quitado del backend porque es inofensivo y sin él se perdería la
garantía de "misma función para ambos caminos". **No genera entrada en `query_logs`**
(el logging solo corre en la rama de datos reales, ver §7.1).

---

## 6. UI — patrones Nova (referencia para el próximo panel)

- **Estructura de página**: fondo `bg-sidebar` (gris muy claro) + caja `bg-background`
  con `rounded-xl outline outline-border shadow-sm overflow-hidden` envolviendo header +
  contenido, con `m-2` en desktop. Es el patrón `Sidebar variant="inset"` de shadcn
  (`SidebarProvider` con `has-data-[variant=inset]:bg-sidebar` + `SidebarInset` con
  `bg-background` + margen/radio), replicado a mano porque este panel no usa un sidebar
  real — confirmado leyendo el proyecto completo de ShadcnSpace (`layout.tsx` +
  `sidebar.tsx`), no adivinado. (Hoy ese armazón lo monta `NovaPanelShell` con la barra
  lateral real, `components/nova/panel-shell.tsx`; ver `components/nova/README.md`
  puntos 12 y 14.)
- **Aspecto: líneas, separadores y sombras** (igual que el dashboard de referencia de
  ShadcnSpace, medido píxel a píxel): tarjetas sin anillo y con sombra azulada
  `shadow-[0_1px_4px_rgba(133,146,173,.2)]` (las KPI, además, `border`); bordes
  `#e5e5e5`; `shadow-xs` en botón `outline`, `Input` y `SelectTrigger`; tarjeta de
  contenido con contorno de 1 px y sombra suave. No pisar la sombra de una `Card` con
  `shadow-none`, ni volver al `px-0` en la barra lateral (taparía la línea que la
  separa del contenido). Detalle y motivos en `components/nova/README.md`, punto 14.
- **Nav con caja bordeada propia**: la fila de dropdowns (`topbar-02`) va envuelta en
  `rounded-lg border border-border px-2 py-2`, separada del bloque logo/iconos de arriba
  (que no tiene ninguna línea divisoria) — mismo patrón que
  `layout/horizontal/header/index.tsx` del proyecto ShadcnSpace descargado.
- **Tabla jerárquica** (`hierarchical-table.tsx`): árbol real con `subRows` de TanStack
  Table (no un panel de detalle aparte), acordeón de un solo camino abierto a la vez.
  Fila resaltada al expandir reutiliza el selector `has-aria-expanded:bg-muted/50` ya
  incluido en el `Table` primitivo (poniendo `aria-expanded` en el botón de toggle) — no
  hace falta CSS nuevo. Filas siempre blancas, nunca tintadas por umbral (pedido
  explícito: "no quiero que se vea la fila verdosa en ningún momento").
- **Píldoras de ruta** (`DrillPills`, dentro de `hierarchical-table.tsx`): sincronizadas
  con el mismo estado `drill` que filtra el gráfico de evolución mensual — un solo punto
  de verdad, no dos estados que puedan desincronizarse.
- **Gráfico de desviación por familia**: no es un chart de Recharts con ejes — son divs
  (pista `bg-muted` de ancho completo + relleno de color desde el centro), más simple y
  más fácil de ajustar pixel a pixel que forzar Recharts a un diseño sin ejes reales.
- **Selector de meses**: dos `<Select>` (Mes + Año) por extremo dentro de un `Popover`,
  **no** `<input type="month">` nativo — el calendario que abre el navegador (en inglés,
  con su propio estilo) desentonaba con el resto del panel. Ver `month-range-picker.tsx`.
- **Filtrado explícito, no reactivo**: cambiar el rango de meses en el selector solo
  actualiza el estado local (`range`) — no dispara ninguna consulta a Oracle hasta que se
  pulsa el botón **"Filtrar"** (al lado del selector, mismo estilo que "Exportar"). Evita
  una consulta por cada clic en el popover. Por defecto se carga el **mes en curso** (mismo
  default que `api/compras/route.ts` sin `startDate`/`endDate`).
  El **sabor** y el **tipo de previsión (PN/PM)** sí se aplican al elegirlos (reutilizan el
  `range` del selector), sin pulsar "Filtrar".
- **Recarga sin vaciar la pantalla**: al filtrar, `data` nunca se pone a `null` — se sigue
  viendo el desglose anterior mientras llega la respuesta nueva. El feedback de "cargando"
  es un toast (`sonner`, `components/nova/ui/sonner.tsx` + `<Toaster />` montado en la
  página) que pasa a éxito/error según la respuesta, no un estado de carga que tape el
  contenido.
- **Exportación a Excel**: mismo patrón de `xlsx` que la versión anterior (§6.1 de
  `docs/compras-v1-historico.md`, number format nativo, sin color/negrita), adaptado a 3
  hojas (Resumen por familia, Tendencia mensual, Detalle familia›canal›artículo) y a las
  3 unidades.
- **Header compartido (`topbar-02`) conectado a la sesión real**: el bloque instalado tal
  cual traía logo/avatar/notificaciones de ejemplo (en inglés, sin ninguna conexión a la
  app). `<Header>` acepta `user`/`onLogout`/`onPresetsClick` — la página los obtiene con
  el mismo patrón que el resto de paneles (`fetch('/api/auth/me')` +
  `POST /api/auth/logout`, ver `app/caducados/page.tsx`). El dropdown de perfil muestra
  iniciales + nombre/usuario/rol reales (no hay página de perfil todavía, se queda en el
  propio dropdown), enlaza a `/admin`+`/admin/logs` solo si `role === 'admin'`, y tiene un
  item deshabilitado "Suscripciones de notificaciones" (idea futura, sin implementar —
  tarea ClickUp en la lista "Plataforma y administración"). El dropdown de notificaciones
  muestra un estado vacío real ("No hay notificaciones todavía") — no hay sistema de
  notificaciones construido aún. Se quitó el selector de idioma del bloque original (app
  solo en español, no tenía ninguna función real).
- **Nav filtrado por permisos reales**: el bloque instalado renderizaba siempre todos los
  paneles de `lib/panels.ts` en "Dashboards"/"Apps", sin comprobar sesión ni rol — bug
  real corregido. `<Header>` hace ahora `fetch('/api/screen-permissions')` (mismo
  endpoint y misma regla `canAccessPanel` que `components/Navbar.tsx`) y `getNavData()`
  (`topbar-02/data.ts`) filtra cada panel por `is_public`/`allowed_roles`/rol admin; un
  grupo sin ningún panel visible desaparece entero (no se queda vacío). El grupo
  **"Maestros" solo se muestra si `role === 'admin'`** — antes era visible para
  cualquiera, solo con sus items deshabilitados.
- **Claro / Oscuro / Sistema**: pedido explícitamente por el usuario. `ModeToggle`
  (`components/nova/mode-toggle.tsx`) en la cabecera; el estado `mode` vive en la página
  (`useState`, no persiste entre recargas — el proyecto no usa `localStorage` en
  componentes) y se traduce a `effectiveTheme` con `window.matchMedia
  ('prefers-color-scheme: dark')` cuando `mode === "system"`. `app/nova-theme.css`
  redefine la variante `dark:` de Tailwind para que dependa de
  `[data-nova-theme="dark"]` en vez del SO directamente — necesario porque los
  primitivos instalados ya traen clases `dark:` sueltas. Detalle completo en
  `components/nova/README.md` §"Claro/Oscuro/Sistema" (incluye un aviso de FOUC
  conocido y sin resolver: el primer render siempre es claro, aunque el SO esté en
  oscuro).

---

## 7. API — `GET /api/compras`

| Parámetro | Tipo | Notas |
|---|---|---|
| `startDate` | string `YYYY-MM-DD`, opcional | Default: día 1 del mes en curso |
| `endDate` | string `YYYY-MM-DD`, opcional | Default: último día del mes en curso |
| `mock` | `"1"`, opcional | Devuelve `aggregate()` sobre datos de ejemplo, ignora Oracle. Solo por URL, sin botón en la UI (ver §5) |
| `umbral` | number, opcional | % de desviación para `resumen.familiasFueraDeUmbral`. Default `10` |
| `sabor` | string, opcional | Descripción del sabor (F4101.`IMSRP5`, UDC `41`/`S5`) tal como la devuelve `sabores`; vacío = todos. Filtra en memoria tras armar los artículos, nunca llega a una query. Artículos sin sabor → `"Sin sabor"`. La respuesta trae `sabores` (todos los del periodo, antes de filtrar, para poblar el desplegable). Ignorado con `mock=1` |
| `tipoPrevision` | `"PN"` \| `"PM"`, opcional | Filtra `F3460.MFTYPF`: `PN` = previsión original, `PM` = modificada. Default `PM`. Cualquier otro valor cae al default. Se ignora con `mock=1` (ver §3.5) |

Respuesta (resumida — ver `app/api/compras/route.ts` para el detalle completo de
`mensual.*`):

```json
{
  "mock": false,
  "familias": [
    {
      "tipo": "familia", "familia": "Tortilla",
      "unidades": { "previsto": 605200, "real": 653170, "desviacionAbs": 47970, "desviacionPct": 7.9 },
      "kg": { "previsto": 425640, "real": 461510, "desviacionAbs": 35870, "desviacionPct": 8.4 },
      "importe": { "previsto": 1417832, "real": 1523940, "desviacionAbs": 106108, "desviacionPct": 7.5 },
      "canales": [
        {
          "tipo": "canal", "canal": "HOR", "canalLabel": "Horeca",
          "unidades": { "...": "..." }, "kg": { "...": "..." }, "importe": { "...": "..." },
          "articulos": [
            { "tipo": "articulo", "item": "1210100009", "descripcion": "TORT CHORIZO 600g FR BF",
              "unidades": { "...": "..." }, "kg": { "...": "..." }, "importe": { "...": "..." } }
          ]
        }
      ]
    }
  ],
  "resumen": {
    "unidades": { "...": "..." }, "kg": { "...": "..." }, "importe": { "...": "..." },
    "totalFamilias": 6, "familiasFueraDeUmbral": 2, "umbralPct": 10,
    "articulosSinGramaje": [], "articulosSinCoste": []
  },
  "mensual": {
    "total": [ { "sortKey": "2025-09", "mes": "sep", "previsto": 57500, "real": 65300, "importeReal": 0 } ],
    "totalKg": [ "..." ], "totalImporte": [ "..." ],
    "porFamilia": { "Tortilla": [ "..." ] },
    "porFamiliaCanal": { "Tortilla::HOR": [ "..." ] },
    "kgPorFamilia": { "...": "..." }, "kgPorFamiliaCanal": { "...": "..." },
    "importePorFamilia": { "...": "..." }, "importePorFamiliaCanal": { "...": "..." }
  }
}
```

La clave de `porFamiliaCanal`/etc. es `` `${familia}::${canal ?? '__sin_canal__'}` `` — el
mismo sentinel en la API, en `toTree()` de `hierarchical-table.tsx` y en el estado `drill`
de la página, para que tabla, píldoras y gráfico mensual nunca se desincronicen.

### 7.1 Logging de consultas

Cada consulta con datos reales (no `?mock=1`) inserta un registro en `query_logs`
(SQLite) con `source = 'compras'` — el mismo source que usaba la versión anterior, para
que `/admin/logs` muestre continuidad en vez de un panel nuevo. `filters` guarda
`{ startDate, endDate, umbralPct }` (todavía no hay filtro de artículo/canal en la UI,
ver §9), `result_count` cuenta los artículos hoja del árbol devuelto (equivalente a "filas"
en la versión anterior). El logging nunca bloquea la respuesta (try/catch independiente),
igual que en el resto de paneles.

---

## 8. Historial de bugs reales encontrados (solo visibles con datos reales)

Ninguno de estos se habría detectado con el modo mock (que ya tenía los nombres escritos
a mano):

1. **Familia mostraba el código crudo** (`"101"`) en vez de la descripción —
   `F4101.IMSRP2` es un código UDC, no texto libre. Corregido resolviendo contra
   `prodctl.f0005` (§3.2).
2. **Familia `106` resuelve a `"Producto comercializado"`**, no `"Otros"` como asumía
   `FAMILIA_ORDEN` — discrepancia detectada, pendiente de decisión del usuario sobre si
   renombrar o mantener ambas etiquetas.
3. **Canal es atributo del artículo, no del cliente** — se comprobó explícitamente contra
   el esquema real que `AAZE06` vive en `F554101` (extensión de artículo), no en ninguna
   tabla de cliente/pedido.
4. **`toLocaleString('es-ES')` no pone separador de miles** en este runtime Node/Bun (falta
   ICU completo) — confirmado con prueba directa. Se usa un formateador manual
   (`numeroEs()`, regex) en vez de `Intl`. **Posible bug latente en el resto de la app**
   (todos los demás paneles usan el mismo patrón `toLocaleString('es-ES')`) — señalado, no
   investigado ni corregido fuera de este panel.
5. **Nav activo por `startsWith` de texto** marcaba "Dashboards" en negro estando en
   `/compras-v2` (nombre de la ruta mientras convivía en paralelo, antes de sustituir a la
   versión anterior) solo porque el string empieza por `/compras`, sin que esa ruta
   estuviera realmente enlazada en `data.ts`. Corregido a coincidencia exacta o de
   segmento (`pathname === href || pathname.startsWith(href + '/')`).
6. **Línea negra en el header** (`border-b` sin color explícito cae en `currentColor`
   dentro de `[data-nova-theme]`) — corregido con un reset `border-color: var(--border)`
   en `app/nova-theme.css` (mismo problema que ya tenía resuelto el sistema viejo en
   `globals.css`, pero el scope Nova necesitaba el suyo).
7. **`@tanstack/react-table` resolvía a v9** (API incompatible con el código instalado,
   que usa `useReactTable` de v8) — fijado a `^8` en `package.json` (ver README de Nova).
8. **Dependencias huérfanas** (`chart`, `motion`) y 3 bloques de catálogo instalados y
   nunca usados (`dashboard-shell-03`, `datatable-12`, `statistics-01`) — explorados y
   retirados antes del primer PR, sin haber sido personalizados (ver README de Nova).
9. **El nav no filtraba por permisos** — `topbar-02` tal cual instalado mostraba
   siempre todos los paneles de `lib/panels.ts` en "Dashboards"/"Apps", y el grupo
   "Maestros" era visible para cualquier usuario (solo sus items estaban
   deshabilitados). Corregido: `<Header>` consulta `/api/screen-permissions` y filtra
   con la misma regla que `components/Navbar.tsx`; "Maestros" solo se muestra a `admin`.
10. **Píldora activa del nav casi ilegible al abrir el desplegable** — `desktop-nav.tsx`
    marcaba el estado abierto con `data-[state=open]:...` (convención de Radix), pero el
    primitivo de navegación instalado es Base UI, que usa `data-open`/`data-popup-open`.
    Con el atributo equivocado el override nunca se aplicaba al abrir, y ganaba el
    `data-open:bg-muted/50` gris del primitivo por defecto combinado con nuestro
    `text-background` — texto casi invisible (bug real en ambos temas, no solo en
    oscuro, más visible en oscuro por el pedido explícito de modo oscuro). Corregido a
    `data-open:`/`data-popup-open:`, igual que ya usaba correctamente el propio
    primitivo.

---

## 9. Diferencias conocidas con la versión anterior (gaps, no decisiones cerradas)

| | Versión anterior (`docs/compras-v1-historico.md`) | Actual (`/compras`) |
|---|---|---|
| Segunda dimensión | Marca (`IMSRP4`) | Canal (`AAZE06`) — campo distinto, ver §3.1 |
| Precio unitario (€/ud) | Sí, con su propia desviación | **No existe** — solo importe total agregado |
| Avisos granulares por artículo+mes | Sí (`"Sin previsión este mes"`, etc.) | **No** — solo 2 listas a nivel de artículo completo |
| Filtro por artículo/marca en la UI | Sí | **No** — sin ningún filtro en la barra todavía |

Logging de consultas y registro en navegación/`lib/panels.ts`: ya resueltos (§7.1) — este
panel es ahora el `/compras` real, no hay diferencia en esos dos puntos.

---

## 10. Idea futura registrada (no implementada)

Selector de "modo de comparativa" (hoy: Previsión vs. Venta real; futuro posible: Venta
real vs. Venta real año anterior), para no tener que crear un dashboard nuevo por cada
tipo de comparativa — mismo panel, mismo gráfico/tabla, cambia solo la fuente de datos.
Tarea ClickUp: lista "Compras" (ENR Analytics), "[Compras] Rediseño de compras-v2 sobre
sistema Nova...". Sin fecha de inicio, sin diseño de datos aún.

## 11. Presets

Botón «Mis filtros» en la barra de filtros: los filtros guardados comunes de Nova (`components/nova/presets.tsx`, ver
`components/nova/README.md` punto 15). Un preset de `/compras` (`screen = 'compras'`) guarda
**previsión (PN/PM), sabor y vista (uds/kg/€)** y, si se elige, el periodo: fijo o relativo de meses
completos (mes en curso, últimos 3/12 meses, año en curso…). Aplicarlo recarga los datos. El
predeterminado (estrella) se aplica al abrir, antes de la primera consulta, así que no se consulta
Oracle dos veces. Si el sabor guardado no está entre los del periodo cargado, se añade al desplegable
para que se vea elegido.
