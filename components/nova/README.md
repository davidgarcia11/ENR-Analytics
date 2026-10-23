# Sistema de diseño Nova (ShadcnSpace) — en construcción

Base del nuevo sistema de diseño sobre [ShadcnSpace](https://shadcnspace.com), aislada
del sistema actual (`app/globals.css`, `components/ui/`) que siguen usando todos los
paneles en producción sin ningún cambio de comportamiento.

**Primer panel real construido con Nova: `/compras`** (rama `feat/panel-prevision`) — ya
sustituyó a la versión anterior del panel (sistema viejo, `components/ui/`). Ver
[`docs/compras.md`](../../docs/compras.md) para el detalle del panel y §"Cómo construir
el siguiente panel Nova" más abajo para los patrones reutilizables (estructura de página,
nav, tabla jerárquica, selector de meses, gráficos, cabecera compartida) que salieron de
construirlo.

## Configuración elegida

| Opción | Valor |
|---|---|
| Librería base de componentes | Base UI (`@base-ui/react`), no Radix |
| Estilo | Nova (`base-nova`) |
| Color base | Zinc |
| Librería de iconos | Lucide (`lucide-react`, se reutiliza la versión `^0.563.0` ya instalada — ver riesgo abajo) |
| Radius | El de fábrica del preset Nova (`0.625rem`), sin override |
| Fuente | Geist Sans / Geist Mono — ya estaban instaladas y fijadas en `app/layout.tsx`, se reutilizan tal cual (ambos sistemas comparten `--font-sans`, no hace falta nada especial) |
| Dark mode | **Sí, solo dentro de Nova** — pedido explícitamente por el usuario (el sistema viejo lo sigue sin tener, ver `DECISIONS.md`). Claro/Oscuro/Sistema, ver más abajo |

`components.json` en la raíz del proyecto registra esta configuración para el CLI de shadcn.

## Mecanismo de aislamiento: por SELECTOR, no por nombre de variable

Un block de ShadcnSpace trae en su código clases estándar tal cual las genera el CLI:
`bg-primary`, `text-muted-foreground`, `border-border`, `rounded-lg`... Si aislásemos
con nombres de variable distintos (`--nova-primary`, `bg-nova-primary`), cada block
habría que reescribirlo a mano para usarlos — inviable, y rompe la idea de "una sola
variable para el color corporativo".

En su lugar, el aislamiento es 100% por **selector CSS**: los mismos nombres estándar
(`--primary`, `--background`, `--muted-foreground`, `--border`, `--radius-lg`...) solo
se REDEFINEN dentro de `[data-nova-theme]`. Fuera de ese atributo, esas variables siguen
siendo las que ya define `app/globals.css` (rojo corporativo), porque `app/nova-theme.css`
no toca `:root` para ninguna de ellas.

```css
/* app/globals.css (sistema actual, sin cambio de comportamiento) */
:root { --primary: #d30b15; --background: #f7f7f6; ... }

/* app/nova-theme.css (nuevo) */
[data-nova-theme] { --primary: oklch(0.21 0.006 285.885); --background: oklch(1 0 0); ... }
```

Un `<div data-nova-theme="light">` y todo lo que haya dentro ve el rojo corporativo
reemplazado por Zinc. Cualquier página sin ese atributo (todos los paneles actuales) ve
exactamente lo mismo que antes.

### Por qué hizo falta tocar `app/globals.css`

Antes de este cambio, `app/globals.css` definía los tokens como **literales directos**
(`--color-primary: #d30b15`), y Tailwind compilaba `.bg-primary{background-color:#d30b15}`
— un valor estático, sin ninguna variable en tiempo de ejecución. No había nada que
`[data-nova-theme]` pudiera sobrescribir.

Se cambió a una indirección de dos niveles: `--color-primary: var(--primary)` (mapeo
Tailwind) + `--primary: #d30b15` (valor real, en `:root`). El resultado visual y el
valor computado son **idénticos** para todo lo que no lleva `data-nova-theme` — solo
cambia CÓMO se resuelve (variable en vez de literal). Verificado con build (ver más
abajo).

Los `--radius-sm/md/lg/xl/2xl/3xl` no necesitaron este cambio: Tailwind ya los expone
por defecto como variables reales en `:root` (comprobado con build), así que
`app/nova-theme.css` los sobrescribe directamente dentro de `[data-nova-theme]` sin
tocar `app/globals.css`.

### Verificado con build

```
.bg-primary{background-color:var(--primary)}       ← utilidad compartida, usa variable
:root{--primary:#d30b15;...}                        ← fuera del scope: rojo corporativo
[data-nova-theme]{--primary:#18181b;...}             ← dentro del scope: Zinc de Nova

.rounded-lg{border-radius:var(--radius-lg)}
:root{--radius-lg:.5rem}                             ← Tailwind por defecto, sin tocar
[data-nova-theme]{--radius-lg:.625rem}               ← radio de fábrica de Nova
```

## Estructura de carpetas (aislamiento de componentes)

- **Componentes**: `components/nova/` y `components/nova/ui/` (aliases `components`/`ui`
  en `components.json`), nunca `components/ui/` a secas.
- **CSS**: `app/nova-theme.css`, importado en `app/layout.tsx`.
- **`cn()`**: se reutiliza `@/lib/utils` (ya existe, es idéntico al que trae el preset).

## Regla de oro para cualquier componente Nova

Cualquier color en JSX se pone por variable/utilidad de tema estándar (`bg-primary`,
`text-muted-foreground`, `border-border`...), **nunca** un literal
(`style={{color: '#...'}}` o un hex a mano). Un block instalado tal cual ya cumple esto
porque así es como el CLI de shadcn genera su código.

## Cómo activar el tema en una pantalla nueva

```tsx
<div data-nova-theme="light" className="bg-background text-foreground">
  {/* ... */}
</div>
```

o, si se agrupan varias pantallas Nova bajo un route group (`app/(nova)/layout.tsx`),
poner el atributo ahí una sola vez. `app/compras/page.tsx` es el ejemplo real: pone el
atributo en el `<div>` raíz de la página (no hay route group todavía, es la única
pantalla Nova).

## Aplicar el rojo corporativo al final

Cuando se decida, cambiar únicamente estas dos variables en `app/nova-theme.css`
(bloque `[data-nova-theme]`, modo claro):

```css
--primary: #d30b15;            /* o el oklch equivalente */
--primary-foreground: #ffffff;
```

Un solo cambio, se propaga a todos los componentes Nova instalados sin tocar ni un JSX,
porque ninguno usa el rojo como literal.

## Claro / Oscuro / Sistema

Los tokens `[data-nova-theme="dark"]` en `app/nova-theme.css` ya existían (paridad con
el preset), solo faltaba activarlos. Mecanismo, por si se reutiliza en otro panel:

1. **`app/nova-theme.css`** redefine la variante `dark:` de Tailwind:
   `@custom-variant dark (&:is([data-nova-theme="dark"] *));` — sin esto, los `dark:`
   que ya traen los primitivos instalados (`button.tsx`, `select.tsx`...) mirarían
   `prefers-color-scheme` directamente, desincronizados del toggle explícito de la
   página. Seguro para el sistema viejo: no usa ninguna clase `dark:` en ningún sitio
   (comprobado con grep antes de tocar esto).
2. **`components/nova/mode-toggle.tsx`**: botón + `DropdownMenu` (Claro/Oscuro/Sistema),
   con los iconos de Lucide `Sun`/`Moon`/`Monitor` — construido con primitivos ya
   instalados, no hay ningún bloque de "toggle de tema" en el catálogo de ShadcnSpace ni
   en el registro `base-nova` (comprobado antes de escribirlo a mano).
3. **En la página** (`app/compras/page.tsx`): `useState<ThemeMode>("system")` +
   `useEffect` con `window.matchMedia('(prefers-color-scheme: dark)')` (con listener de
   `change`, para reaccionar si el SO cambia de tema mientras la página está abierta) →
   `effectiveTheme` se pasa al `data-nova-theme` del div raíz en vez del `"light"` fijo.
   **No persiste entre recargas** (el proyecto no usa `localStorage`/`sessionStorage` en
   componentes) — vuelve a "Sistema" en cada carga. Si se quiere persistente, la vía
   compatible con las reglas del proyecto es una cookie simple, no localStorage.
4. **`<Header>`** recibe `mode`/`onModeChange` como props (mismo patrón que
   `user`/`onLogout`) y renderiza `<ModeToggle>` — si un panel no los pasa, el botón
   simplemente no aparece.

**Aviso de FOUC conocido, no resuelto**: en el primer render (SSR y primer paint en
cliente, antes de que corra el `useEffect` de `matchMedia`) `effectiveTheme` es
`"light"` aunque el SO esté en oscuro — puede verse un parpadeo claro→oscuro al cargar
si el usuario tiene el SO en modo oscuro y `mode` sigue en `"system"`. `next-themes` trae
un script inline para evitar esto (por eso lo usa el preset de referencia), pero
requeriría dejar que gestione `document.documentElement` — lo que rompería el
aislamiento (ver nota más arriba). Si el parpadeo molesta, pedirlo explícitamente antes
de intentar un script inline propio.

## Notas / decisiones tomadas sin preguntar dos veces

- **`lucide-react` — riesgo abierto**: el preset Nova de referencia pide `^1.33.0`, pero
  el proyecto ya usa `^0.563.0` en todos los paneles existentes. Subir la versión es un
  cambio compartido que puede afectar iconos ya en producción, así que **no se ha
  tocado**: se reutiliza la `^0.563.0` instalada. Si al instalar el primer block/página
  Nova falta un icono que no existe en `0.563` o cambia de API, se trata en ese momento
  (import roto de un icono concreto, no un problema de todo el sistema).
- **Dark mode, pedido explícitamente (ver §"Claro/Oscuro/Sistema" más abajo)**: no se
  usa el `ThemeProvider` de `next-themes` del preset de referencia (manipula
  `document.documentElement` globalmente — habría filtrado el tema oscuro a TODO la app,
  incluido el sistema viejo, que no tiene dark mode por decisión propia). En su lugar,
  estado React local por página (`useState<ThemeMode>`) que solo cambia el atributo
  `data-nova-theme` del div raíz de esa página — el aislamiento por selector CSS ya
  existente hace el resto. `next-themes` sigue como dependencia (la necesita
  `components/nova/ui/sonner.tsx`), pero no se usa su `ThemeProvider`.
- **`baseColor` de referencia era `neutral`**: el preset Nova no expone un flag de CLI
  para elegir color base (solo hay 7 presets fijos: nova, vega, maia, lyra, mira, luma,
  sera, rhea, cada uno con su paleta). Los valores de este archivo son la paleta
  **Zinc** oficial de Tailwind, mapeados a mano sustituyendo la paleta `neutral` que trae
  el preset por defecto.
- **`@tanstack/react-table` fijado a `^8`, no `^9`**: al instalar `datatable-12` (bloque
  ya retirado, ver más abajo) el CLI resolvió la `9.1.2` (última), pero el código del
  propio block (y el de los ejemplos de shadcn/ui en general) usa la API de v8
  (`useReactTable`), que v9 eliminó/renombró — build roto (`useReactTable was not found
  in module`). Es un bug de resolución de dependencias del catálogo, no algo introducido
  en este proyecto. Fijado en `package.json` a `^8` porque es la versión que espera el
  código instalado, no un workaround. Comprobado antes de tocarlo: ningún panel existente
  usaba esta librería, así que no hay conflicto con nada previo. Sigue fijado aunque
  `datatable-12` ya no está: `components/nova/hierarchical-table.tsx` (tabla del panel de
  compras) también usa la API v8.
- **Bloques instalados y luego retirados**: `dashboard-shell-03`, `datatable-12` y
  `statistics-01` se instalaron explorando alternativas, pero no se llegaron a usar en
  ningún panel (`/compras` usa `topbar-02` + `statistics-04` + `chart-15`, y una tabla
  jerárquica propia en vez de un datatable genérico). Se borraron sin haber sido
  personalizados — reinstalarlos más adelante es el mismo comando de una línea
  (`bunx --bun shadcn@latest add @shadcn-space/<nombre>`), no se perdió trabajo.
- **Base UI marca estado abierto con `data-open`/`data-popup-open`, NUNCA
  `data-[state=open]`** (eso es de Radix, no de Base UI). Si copias un patrón de
  ejemplos/documentación pensados para Radix (muy común, es la librería más extendida),
  revisa el atributo real antes de asumirlo — un `data-[state=open]:...` que no coincide
  con lo que el primitivo realmente emite no da error, simplemente **no hace nada**, y
  gana el estilo por defecto del primitivo por debajo (bug real: la píldora activa del
  nav quedaba casi ilegible al abrir el desplegable, ver `docs/compras.md` §8 punto 10).
- **Bloques animados con `motion/react` pueden traer `bun run build` roto por tipos, no
  por lógica**: detectado en `tabs-08` (instalado, borrado al no usarse, y vuelto a
  instalar dos veces más para `/costes` según fue cambiando el diseño de ese panel —
  la versión actual sí lo usa de verdad, ver `docs/costes.md` §4.2) y en
  `animated-list-03` (instalado dos veces solo para consultar su código como
  referencia y borrado las dos, nunca llegó a usarse tal cual — mismo sitio de la
  documentación). Ambos usan objetos sin anotar el tipo de `motion/react` que les
  corresponde — TypeScript infiere `type: "spring"`/`ease: "easeIn"` como `string`
  genérico en vez del literal que la librería espera, y `tsc` falla (`Type 'string' is
  not assignable to type 'AnimationGeneratorType'`). No es un bug introducido en este
  proyecto ni una excusa para reescribir el componente a mano — es un fix mínimo y
  legítimo sobre el archivo instalado, cada vez que se reinstale: anotar
  explícitamente `Variants` (en los objetos de variantes) y, si hace falta,
  `Transition` (en constantes de transición compartidas reutilizadas como valor por
  defecto de un parámetro — ese fue el caso de `animated-list-03`, un poco distinto al
  de `tabs-08`), ambos importados como `import type { ... } from "motion/react"`. Si
  otro bloque `motion/react` de ShadcnSpace falla igual al instalarlo, es el mismo
  tipo de arreglo — y si el bloque acaba sin usarse, se puede borrar sin más (no hace
  falta dejar el fix "por si acaso"; si se vuelve a necesitar más adelante, es el
  mismo arreglo de una línea al reinstalarlo).
- **`ScrollArea` + `<Table>` compartido + cabecera `sticky` no se llevan bien
  anidados**: `components/nova/ui/table.tsx` envuelve siempre su `<table>` en un
  `<div overflow-x-auto>` propio; anidar ESE div dentro del `Viewport` de
  `ScrollArea` activa la regla de interdependencia de `overflow` de CSS y lo
  convierte en su propio contenedor con scroll — una cabecera `sticky` dentro se
  "pega" a ese div (que nunca se mueve él mismo) en vez del `Viewport` real que el
  usuario desplaza, y visualmente deja de funcionar. Detectado y corregido en
  `/costes` (ver `docs/costes.md` §4.1): si otra tabla necesita `ScrollArea` +
  cabecera fija, usar un `<table>` suelto (mismas clases que `ui/table.tsx`) en vez
  del componente `Table`, dentro del `ScrollArea`. De paso, `ui/scroll-area.tsx`
  ganó una prop `orientation?: "vertical" | "horizontal" | "both"` (por defecto
  `"vertical"`, igual que antes) para pedir scrollbar horizontal cuando haga falta.

- **`components/nova/portal-container.tsx`** (`NovaPortalProvider`/`useNovaPortalContainer`)
  corrige un bug real: los primitivos de Base UI que usan `*Primitive.Portal` escapan
  por defecto a `document.body` — fuera de `[data-nova-theme]`, heredan los tokens del
  sistema viejo (visto primero como un botón "Aplicar" en rojo corporativo dentro de un
  `Sheet`, en vez del negro casi-negro de Nova). Cada página Nova envuelve su contenido en
  `<NovaPortalProvider container={portalContainerRef}>` (`portalContainerRef` apunta al
  div raíz `[data-nova-theme]`), y cada primitivo con Portal debe pasarle
  `container={useNovaPortalContainer()}`. Parcheados: `popover.tsx`, `select.tsx`,
  `navigation-menu.tsx`, `dialog.tsx`, `sheet.tsx` (el `Combobox`, si se instala,
  necesitará el mismo tratamiento). **Al instalar cualquier primitivo nuevo con
  `*Primitive.Portal` — Tooltip, Menu, HoverCard..., hay que aplicar el mismo patrón antes
  de darlo por terminado**, no solo cuando el bug se vea a simple vista (el `Sheet` estuvo
  meses sin el parche porque nadie lo había usado de verdad todavía en una rama mergeada).
- **`Dialog` instalado** (`bunx --bun shadcn@latest add dialog`, panel de coste A1): trae
  animación de apertura/cierre (fade+zoom) ya incluida en el primitivo — no hace falta
  añadirla a mano. El `sm:max-w-sm` por defecto es para diálogos de confirmación pequeños;
  para un modal grande centrado (ej. un panel de detalle/verificación), sobreescribe el
  ancho vía `className` en `<DialogContent>` (`w-[90vw] max-w-3xl` o similar) en vez de
  tocar el primitivo compartido.
- **`Combobox` instalado** (`bunx --bun shadcn@latest add combobox`, panel de loteadora —
  primer desplegable Nova con búsqueda de texto sobre una lista grande; los `Select`
  existentes hasta entonces eran listas cortas cerradas): primitivo nativo de Base UI
  (`@base-ui/react/combobox`), **no** `cmdk`. El fichero instalado trajo dos bugs de
  registro que hubo que corregir a mano, mismo tipo de arreglo legítimo que el resto de
  esta lista — no reinstales sin repetirlos:
  - `import { cn } from "cn"` en vez de `"@/lib/utils"` (y el CLI añadió el paquete npm
    `cn` como dependencia sin que nada lo usara — se quitó de `package.json`).
  - `<ComboboxPrimitive.Portal>` sin `container={useNovaPortalContainer()}` — el mismo
    bug de portal de siempre (ver más arriba), aplícalo igual que en
    `popover.tsx`/`select.tsx`.
  - **Uso**: pasa `items` como array plano del tipo del VALOR seleccionado (ej. `string[]`
    de IDs), no como objetos `{value,label}` con `<ComboboxItem value={item.value}>`
    aplanado — mezclar ambos formatos rompe el filtrado y el texto que se muestra tras
    seleccionar. Si necesitas mostrar más que el propio valor (código + descripción),
    pásale `itemToStringLabel={(id) => ...}` al `<Combobox>` y renderiza tú mismo el label
    dentro de `<ComboboxItem>` — ver `app/loteadora/page.tsx` y `docs/loteadora.md` §14.
- **No hay "date picker" de una fecha única en el catálogo ShadcnSpace** (comprobado con
  `searchBlocks`/`listComponents` antes de construir uno) — solo el rango
  (`date-range-picker.tsx`). Para una fecha exacta, `components/nova/date-picker.tsx`
  (panel de loteadora) reutiliza `Calendar`+`Popover` ya instalados a mano, mismo patrón
  artesanal que `month-range-picker.tsx`/`mode-toggle.tsx` cuando el catálogo no cubre
  algo — reutilízalo en vez de construir otro desde cero.
- **`Alert` instalado** (`bunx --bun shadcn@latest add alert`, panel de loteadora — para
  sustituir avisos ámbar/error escritos a mano por `<p>`/`<div>` sueltos, ver
  `docs/loteadora.md` §14): **no** viene del catálogo de ShadcnSpace (comprobado con
  `searchBlocks`/`listComponents` — no tiene ningún componente de alerta/banner/callout,
  solo bloques compuestos), sino del registro base de shadcn/ui, con el mismo comando
  oficial. Mismo bug de registro que `Combobox` — no reinstales sin corregirlo:
  - `import { cn } from "cn"` en vez de `"@/lib/utils"` (y el CLI volvió a añadir el
    paquete npm `cn` a `package.json` sin que nada lo usara — se quitó otra vez).
  - Solo trae variantes `default`/`destructive` (sin "warning"/"success") — para el aviso
    ámbar se pasa el color por `className` en el propio `<Alert>` y `<AlertDescription>`
    en vez de añadir una variante nueva al componente compartido (ver
    `app/loteadora/page.tsx`). Sin problema de portal: `Alert` no usa
    `*Primitive.Portal`, así que no necesita `useNovaPortalContainer()`.

- **`Sidebar` y `Label` instalados** (`bunx --bun shadcn@latest add sidebar` / `label`,
  rediseño de `/admin`): mismo bug de registro que `Combobox`/`Alert` — `import { cn }
  from "cn"` y el paquete npm `cn` añadido a `package.json`; se corrigió el import y se
  quitó el paquete (`bun remove cn`). El CLI pregunta si sobreescribir los primitivos
  que el sidebar arrastra (`button`, `sheet`, `tooltip`...) y sin terminal interactiva se
  queda colgado: lanzarlo como `yes n | bunx --bun shadcn@latest add sidebar` para que
  conteste "no" y **no pise los parches de portal** ya hechos. Trae el hook
  `hooks/nova/use-mobile.ts` (alias `hooks` de `components.json`).
  - **`tooltip.tsx` no tenía el parche de portal** (nadie lo había usado de verdad hasta
    el sidebar colapsado, que lo usa en cada icono): añadido `container={useNovaPortalContainer()}`.
  - El sidebar guarda su estado abierto/colapsado en una cookie (`sidebar_state`) — es
    del propio componente de shadcn y cumple la regla de no usar `localStorage`.
- **`Select` de Base UI con clave distinta del texto** (ej. `admin` → "Administrador"):
  pasar `items={[{ value, label }]}` al `<Select>` raíz; sin eso, `<SelectValue>` muestra
  la clave. Base UI no distingue `""` de "sin valor", así que una opción "Todas" que viaja
  como `""` a la API necesita un valor propio en el desplegable (ver
  `components/nova/admin/usuarios.tsx`, `TODAS`).

## Cómo construir el siguiente panel Nova

Checklist basada en lo que realmente se usó/decidió construyendo `/compras` (detalle
completo en [`docs/compras.md`](../../docs/compras.md) §6) — pensada para no repetir
desde cero las mismas decisiones de diseño:

1. **Estructura de página**: raíz `<div data-nova-theme={effectiveTheme} className="min-h-screen bg-sidebar text-foreground">`
   (nunca `"light"` fijo — ver §"Claro/Oscuro/Sistema" para calcular `effectiveTheme`),
   con un `<div className="md:m-2 md:rounded-xl md:outline md:outline-border md:shadow-sm md:overflow-hidden bg-background">`
   envolviendo header + `<main>`. Es el patrón `Sidebar variant="inset"` de shadcn
   replicado a mano (sin sidebar real) — ver `app/compras/page.tsx`.
2. **Header/nav** *(sustituido: ahora todos los paneles Nova usan la barra lateral de `components/nova/panel-shell.tsx`, ver punto 12; esto describe el header antiguo `topbar-02`, que sigue en el repo pero ya sin uso)*: `topbar-02` (`components/shadcn-space/blocks/topbar-02/`) tal cual está
   instalado — ya tiene el fix de imports rotos, el active-state por ruta exacta (no
   `startsWith` suelto), la caja `rounded-lg border border-border` alrededor del grupo de
   dropdowns, y el nav filtrado por permisos reales (`getNavData(role, screensConfig)`,
   `<Header>` hace su propio `fetch('/api/screen-permissions')` — un panel al que el
   usuario no tiene acceso ni aparece en la lista). Los items de nav viven en
   `topbar-02/data.ts` (`lib/panels.ts` es la fuente, igual que en el sistema viejo).
   `<Header>` acepta `user`/`onLogout`/`onPresetsClick`/`mode`/`onModeChange` (mismo tipo
   `SessionUser` y mismo patrón `fetch('/api/auth/me')` + `POST /api/auth/logout` que ya
   usa `components/Navbar.tsx` en el resto de paneles) — la página nueva tiene que
   pasarlos, no hay wiring automático (si no se pasan `mode`/`onModeChange`, el botón de
   tema simplemente no aparece). El logo es `/logo.png` (el real, no el de ShadcnSpace).
   El dropdown de perfil (`dropdown-profile.tsx`) y el de notificaciones
   (`notification-dropdown.tsx`) ya están adaptados a datos/acciones reales — no vuelvas a
   dejar contenido de ejemplo si los tocas. El grupo "Maestros" del nav es solo-admin
   (`role === 'admin'`), no un ejemplo a copiar sin más — cualquier grupo nuevo debe
   decidir explícitamente si necesita esa misma restricción.
3. **KPIs**: bloque `statistics-04` (`components/shadcn-space/blocks/statistics-04/`),
   acepta un array `data` de hasta 4 tarjetas.
4. **Gráfico de evolución temporal**: bloque `chart-15`
   (`components/shadcn-space/blocks/chart-15/`), adaptado a barras agrupadas (sin
   `stackId`).
5. **Selector de rango de meses**: `components/nova/month-range-picker.tsx` tal cual —
   **no** usar `<input type="month">` nativo (calendario del navegador, desentona).
5.1. **Filtrado explícito + feedback con toast**: si un panel tiene un filtro que dispara
   una consulta a Oracle (fechas, artículo...), que se aplique con un botón explícito
   ("Filtrar", mismo estilo que "Exportar"), no en cada cambio del control. Al recargar,
   nunca vaciar el `data` ya cargado — usar un toast (`sonner`, ya instalado en
   `components/nova/ui/sonner.tsx`, montar `<Toaster />` una vez por página) para el
   feedback de carga/éxito/error, en vez de un estado de carga que tape el contenido. Ver
   `app/compras/page.tsx`.
6. **Tabla con jerarquía/drill-down**: `components/nova/hierarchical-table.tsx` como
   plantilla (TanStack Table v8, `subRows`, píldoras de ruta) si el panel nuevo necesita
   lo mismo — si no, un `datatable-12` reinstalado puede bastar para una tabla plana.
7. **Exportar a Excel**: mismo patrón `xlsx` que `app/compras/page.tsx` — hojas Resumen/
   Tendencia mensual/Detalle, `setColNumFmt()` para formato nativo de Excel.
8. **Antes de dar por bueno el diseño visual**: comparar contra capturas reales del
   usuario o contra el proyecto completo descargado (si sigue disponible en
   `c:\Users\dgarcia\Projects\Shadcn Space Admin Dashboard - Next.js`) en vez de adivinar
   estructura por CSS suelto — varias decisiones de este panel (caja redondeada, borde de
   nav) solo se confirmaron leyendo el código fuente real del proyecto, no a ojo.
9. **Panel con varias secciones de configuración** (no un dashboard): shell con
   `Sidebar variant="inset"` real (logo arriba, secciones agrupadas, "Ir a paneles"
   abajo) + `SidebarInset` con una cabecera fina propia (trigger + breadcrumb + tema/
   avisos/perfil de `topbar-02`) — **no** la barra completa de `topbar-02`, cuyo ancho
   centrado no cuadra con un contenido a todo el ancho. Un componente por sección con
   `CabeceraSeccion` + `TablaCard` (`components/nova/admin/comun.tsx`) — ver
   `app/admin/page.tsx` y DOCUMENTACION.md §5. Dentro de cada sección, patrón de gestión de ShadcnSpace:
   tarjeta con `CardAction` para la acción principal, tabla con menú "⋯"
   (`DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" />}`), y
   alta/edición/borrado en `Dialog` (confirmación con `ConfirmarDialog` de
   `components/nova/admin/comun.tsx`), nunca filas que se convierten en formulario.

10. **Gráficos de ShadcnSpace parametrizados (`/servicio`, pestaña Indicadores)**: se
    instalaron con el CLI oficial `chart-16` (áreas por canal con línea de objetivo),
    `chart-02` (donut con total en el centro), `chart-01` (barras apiladas) y `chart-12`
    (ver punto 13). Los bloques traen datos de ejemplo fijos, así que — igual que
    `chart-15` — se **parametrizaron** (`data`, `series`/`title`/`description` por props):
    `chart-16` añade `objetivo` (línea de referencia), `domain` y sufijo `%`; `chart-02`
    pinta el total en el centro y el % de cada segmento; `chart-01` recibe el titular como
    `headline`. `chart-16` lleva además los retoques de estilo pedidos («más redondeado y
    limpio»): rejilla solo horizontal, curvas `monotone` sin puntos con degradado, marcas
    del eje Y de 10 en 10, margen izquierdo 0 (para que no se corte «100%») y sin el icono
    de la cabecera. Se probó `chart-07` (titular + filas por canal + selector) en su lugar y
    se descartó a favor de `chart-16` (comparar los canales de un vistazo); si se quiere
    volver: `bunx --bun shadcn@latest add @shadcn-space/chart-07`. **No reinstales sin
    repetir esos cambios.** Al instalar: el CLI pregunta si sobrescribir `card.tsx`,
    `badge.tsx`, `select.tsx` y `chart.tsx` (responder «no» — son los de Nova, ya con
    ajustes), crea páginas de demo en `app/chart-XX/` (borrarlas) y añade el paquete `cn`
    (y a veces `@iconify/react`) a `package.json` (`bun remove cn @iconify/react`), igual
    que en las notas de arriba.

11. **Tabla de seguimiento al estilo ShadcnSpace (`/servicio`)**: se evaluaron con el CLI
    oficial `table-02` (facturas), `table-09` (productos con progreso y estado) y
    `datatable-14` (cola de tickets). `datatable-14` se descartó: usa la API de TanStack
    Table **v9** (`tableFeatures`, `columnOrderingFeature`) y el proyecto está fijado a
    `^8` (ver arriba), además de traer `@dnd-kit` (se desinstaló con `bun remove`). La
    tabla de `components/nova/servicio-table.tsx` copia el patrón de **`table-09`**
    (Card `p-6 gap-6`, cabecera `px-6`, primera celda `ps-6`, filas con `divide-y`, celdas
    de dos líneas, icono en cuadro tintado, `Progress` de 1 px con indicador por color,
    `Badge` `bg-*-400/10 text-*-400`, menú «⋮») en vez de importarlo: el bloque es un
    ejemplo con imágenes remotas y datos fijos. Los archivos de `table-02`/`table-09` se
    borraron tras la prueba (reinstalables con `bunx --bun shadcn@latest add
    @shadcn-space/table-09`). Mismas notas de instalación que arriba (responder «no» a
    sobrescribir primitivos, borrar `app/table-XX/`, `bun remove cn`).

12. **Barra lateral común (`components/nova/panel-shell.tsx` + bloque `sidebar-01`)**:
    `/compras`, `/mrp`, `/costes`, `/muestras`, `/servicio` y `/loteadora` ya no llevan la barra de
    arriba (`topbar-02`, sin uso desde entonces): se montan con
    `<NovaPanelShell title="…" grupo="Dashboards|Apps">`. La barra lateral es el bloque
    oficial **Sidebar 01 de ShadcnSpace** (`bunx --bun shadcn@latest add
    @shadcn-space/sidebar-01`; `components/shadcn-space/blocks/sidebar-01/`), con
    `variant="inset"` y colapso a iconos (como `/admin` y el dashboard de referencia).
    Adaptaciones al bloque, sin tocar su estilo: `app-sidebar.tsx` recibe `items` por
    props, usa el logo de Elaborados Naturales y pierde la tarjeta promocional «Grab Pro
    Now»; `nav-main.tsx` recibe el estado activo por props (`active`, antes era un estado
    interno por clic), usa `next/link` y admite subítems que son botones (`onSelect`) para
    cambiar de sección sin navegar. Los paneles con secciones (`SECCIONES_PANEL` en `lib/panels.ts`; hoy solo `/servicio`) llevan SIEMPRE su submenú con la flecha en la barra de todos los paneles: desde otro panel los subítems son enlaces a `/<panel>?seccion=<key>`, y la página lee ese parámetro. El armazón construye el menú con `getNavData()`
    (`topbar-02/data.ts` → `lib/panels.ts`, filtrado por permisos, sin el grupo
    «Maestros» que no tiene rutas): una sección por grupo (DASHBOARDS / APPS) y, en el
    panel actual, sus secciones propias como subítems (`secciones`, `seccionActiva`,
    `onSeccion`; ej. `/servicio`: Seguimiento / Indicadores). Además del menú, el armazón
    lleva la cabecera fina (botón de la barra, miga de pan, tema, avisos, perfil), el tema
    claro/oscuro/sistema, el contenedor de portales y el `<Toaster />`: las páginas ya no
    los montan; el contenido va a todo el ancho (sin `max-w-7xl`). **No reinstales sin
    repetir esos cambios.** Al instalar: responder «no» a sobrescribir primitivos, borrar
    `app/sidebar-01/` y `assets/` (logo de ShadcnSpace) y `bun remove cn`. Antes de este
    bloque hubo un menú escrito a mano con las clases de la plantilla de administración
    (`Shadcn Space Admin Dashboard - Next.js/…/sidebar/nav-collapse`); se descartó por ser
    una imitación.

13. **Colores y forma de los gráficos (`/servicio`)**: la paleta es la que usan los bloques
    de ShadcnSpace — el par `blue-500` / `sky-400` como principal, `teal-400` y `orange-400`
    de acento y un gris suave para «otros» (`PALETA` en `servicio-indicadores.tsx`);
    nada de ámbar ni otros tonos propios. Barras en cápsula fina (`chart-01`: `barSize` 10,
    `radius` 5, segmentos separados por el color de la tarjeta, como `chart-17`). El
    ranking de incidencias por motivo es el bloque **`chart-12`** (barras de 30 px con la
    mayor resaltada y el resto al 20 %, dos totales debajo), parametrizado como los
    demás: `data` por props, iconos de `lucide-react` en vez de `@iconify/react` (que el
    CLI añade a `package.json`: `bun remove @iconify/react`) y 4 motivos + «Otros motivos»
    para que quepan las etiquetas. Mismas notas de instalación que en el punto 10.

14. **Líneas, separadores y sombras = dashboard de referencia de ShadcnSpace** (medido
    píxel a píxel sobre su captura y contrastado con su código, `package/main`):
    - **Tarjetas** (`components/nova/ui/card.tsx`): sin anillo, solo la sombra azulada
      `0 1px 4px rgba(133,146,173,.2)`. Las tarjetas KPI (`statistics-04`) llevan además
      `border`, como las `statistics` de la referencia. Los bloques de gráficos ya no
      pisan la sombra con `shadow-none` / `shadow-xs`: no hay que volver a ponérselo.
    - **Tarjeta de contenido** (`SidebarInset` en `panel-shell.tsx`): contorno de 1 px y
      sombra `0 2px 4px rgba(0,0,0,.075)`. La línea que separa la barra lateral es ese
      contorno: arranca en la esquina redondeada, no llega al borde de la ventana. No
      hay `border-r` en la barra (se probó y se revirtió: la referencia no lo tiene).
      **Ojo con el `px-0` del bloque `sidebar-01`**: con él, el panel de la barra (`z-10`)
      llega hasta el píxel donde la tarjeta dibuja contorno y sombra y los tapa, y la línea
      se ve blanca (medido: `#fbfbfb` en vez de `#e5e5e5`). `app-sidebar.tsx` lleva `pl-0 pr-2`;
      con 8 px libres a la derecha se ve la sombra (`#f6f6f6`), el contorno (`#e5e5e5`) y el
      blanco del contenido, igual que en la referencia. No volver a `px-0`.
    - **Separador de la cabecera** (junto al botón de la barra): 1 px `#e5e5e5` y 16 px de
      alto, centrado (`data-vertical:self-center`). Sin esa clase, `self-stretch` del
      primitivo lo dejaba pegado arriba de la cabecera.
    - **Bordes** en gris neutro (`--border`, `--input`, `--sidebar-border`
      `oklch(.922 0 0)` = `#e5e5e5`), no el Zinc con matiz violeta.
    - **Botón `outline`, `Input` y `SelectTrigger`**: `shadow-xs`, como la referencia.
    - Las sombras van como valor literal en la clase (`shadow-[...]`), **no** redefiniendo
      `--shadow-md`/`--shadow-sm` en `[data-nova-theme]`: Tailwind compila `shadow-md`
      con el valor incrustado y esas variables no cambian nada en tiempo de ejecución.
      Los menús y popovers siguen con el `shadow-md` por defecto de Tailwind.
    - La cabecera no es `sticky`: la referencia lo declara, pero su `SidebarInset` lleva
      `overflow-hidden`, así que nunca se queda fija; no se replica una clase que no hace nada.
