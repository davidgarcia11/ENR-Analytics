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
| Dark mode | No activado. El proyecto lo quitó deliberadamente (ver `DECISIONS.md`). Los tokens `[data-nova-theme="dark"]` existen por paridad con el preset pero nada los activa |

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

## Notas / decisiones tomadas sin preguntar dos veces

- **`lucide-react` — riesgo abierto**: el preset Nova de referencia pide `^1.33.0`, pero
  el proyecto ya usa `^0.563.0` en todos los paneles existentes. Subir la versión es un
  cambio compartido que puede afectar iconos ya en producción, así que **no se ha
  tocado**: se reutiliza la `^0.563.0` instalada. Si al instalar el primer block/página
  Nova falta un icono que no existe en `0.563` o cambia de API, se trata en ese momento
  (import roto de un icono concreto, no un problema de todo el sistema).
- **Sin `ThemeProvider`/`next-themes`**: el preset Nova de referencia trae un
  `ThemeProvider` con toggle claro/oscuro y atajo de teclado. No se ha instalado porque
  contradice la decisión ya tomada de no tener dark mode. Si se quiere igualmente para
  el sistema Nova en concreto, es una decisión a pedir explícitamente.
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

## Cómo construir el siguiente panel Nova

Checklist basada en lo que realmente se usó/decidió construyendo `/compras` (detalle
completo en [`docs/compras.md`](../../docs/compras.md) §6) — pensada para no repetir
desde cero las mismas decisiones de diseño:

1. **Estructura de página**: raíz `<div data-nova-theme="light" className="min-h-screen bg-sidebar text-foreground">`,
   con un `<div className="md:m-2 md:rounded-xl md:outline md:outline-border md:shadow-sm md:overflow-hidden bg-background">`
   envolviendo header + `<main>`. Es el patrón `Sidebar variant="inset"` de shadcn
   replicado a mano (sin sidebar real) — ver `app/compras/page.tsx`.
2. **Header/nav**: `topbar-02` (`components/shadcn-space/blocks/topbar-02/`) tal cual está
   instalado — ya tiene el fix de imports rotos, el active-state por ruta exacta (no
   `startsWith` suelto) y la caja `rounded-lg border border-border` alrededor del grupo de
   dropdowns. Los items de nav viven en `topbar-02/data.ts` (`lib/panels.ts` es la fuente,
   igual que en el sistema viejo). `<Header>` acepta `user`/`onLogout`/`onPresetsClick`
   (mismo tipo `SessionUser` y mismo patrón `fetch('/api/auth/me')` + `POST /api/auth/logout`
   que ya usa `components/Navbar.tsx` en el resto de paneles) — la página nueva tiene que
   pasarlos, no hay wiring automático. El logo es `/logo.png` (el real, no el de ShadcnSpace).
   El dropdown de perfil (`dropdown-profile.tsx`) y el de notificaciones
   (`notification-dropdown.tsx`) ya están adaptados a datos/acciones reales — no vuelvas a
   dejar contenido de ejemplo si los tocas.
3. **KPIs**: bloque `statistics-04` (`components/shadcn-space/blocks/statistics-04/`),
   acepta un array `data` de hasta 4 tarjetas.
4. **Gráfico de evolución temporal**: bloque `chart-15`
   (`components/shadcn-space/blocks/chart-15/`), adaptado a barras agrupadas (sin
   `stackId`).
5. **Selector de rango de meses**: `components/nova/month-range-picker.tsx` tal cual —
   **no** usar `<input type="month">` nativo (calendario del navegador, desentona).
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
