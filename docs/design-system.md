# Sistema de diseño — Dashboard de Producción

> **Audiencia:** cualquiera (persona o Claude Code) que vaya a construir o tocar la UI de un panel — nuevo o existente.
> **Origen:** rama `redesign/ui-ux-v2`. Antes de esta rama, cada página tenía su propio `#D30B15` hardcodeado, sus propios grises y su propio panel de presets copiado. Esto documenta las reglas para que no vuelva a pasar.

Este documento es la referencia obligatoria antes de escribir JSX/CSS en cualquier panel. Si algo de lo que necesitas no está aquí, es más probable que falte un componente por crear que una excepción por hacer.

---

## 1. Regla de oro

**Ningún panel define su propio color, espaciado arbitrario o componente de presentación duplicado.** Todo pasa por:

1. Los **tokens** de [`app/globals.css`](../app/globals.css) — nunca un hex suelto.
2. Los **componentes base** de `components/ui/` — nunca un `<div>` reinventando una card, un badge o un spinner.
3. Los **componentes compartidos** de `components/` (`AppShell`, `KpiCard`, `PresetPanel`, `Navbar`, `FilterPanel`) — nunca un layout de página o un panel de presets copiado y pegado.

Si dudas entre "hago esto a mano" o "uso el componente", usa el componente. Si el componente no cubre el caso, amplíalo (con una prop nueva) en vez de bypassearlo con estilos ad-hoc.

---

## 2. Tokens de color (`app/globals.css`)

Todos los colores viven en `@theme inline` dentro de `app/globals.css`. Tailwind 4 genera automáticamente las clases (`bg-primary`, `text-muted-foreground`, `border-border`...) a partir de estas variables — no hay `tailwind.config.js`.

| Token Tailwind | Variable CSS | Valor | Uso |
|---|---|---|---|
| `bg-primary` / `text-primary` | `--color-primary` | `#D30B15` | Rojo corporativo: botón principal, borde superior de cards, iconos destacados |
| `bg-primary-hover` | `--color-primary-hover` | `#B00A12` | Hover/pressed del rojo corporativo |
| `text-primary-foreground` | `--color-primary-foreground` | `#FFFFFF` | Texto sobre fondo `primary` |
| `bg-background` | `--color-background` | `#F7F7F6` | Fondo general de cada página (lo pone `AppShell`, no lo repitas) |
| `text-foreground` | `--color-foreground` | `#171717` | Texto principal, títulos |
| `bg-card` / `text-card-foreground` | `--color-card` | `#FFFFFF` | Tarjetas, paneles, inputs |
| `bg-popover` / `text-popover-foreground` | `--color-popover` | `#FFFFFF` | Popovers, dropdowns, menús |
| `bg-muted` / `text-muted-foreground` | `--color-muted` | `#F4F4F4` / `#6B7280` | Fondos sutiles (filas hover, cabeceras) / texto secundario atenuado |
| `border-border` / `border-input` | `--color-border` | `#E5E7EB` | Bordes, separadores, borde de inputs |
| `ring-ring` | `--color-ring` | `#D30B15` | Anillo de foco (accesibilidad, `focus-visible:ring-1 focus-visible:ring-ring`) |
| `bg-secondary` / `text-secondary-foreground` | `--color-secondary` | `#F4F4F4` / `#374151` | Texto de énfasis medio (labels, valores de tabla) |
| `bg-accent` / `text-accent-foreground` | `--color-accent` | `#F4F4F4` | Hover de botones `ghost`/`outline` |
| `bg-destructive` / `text-destructive` | `--color-destructive` | `#EF4444` | Errores, acciones destructivas |
| `text-success` (usar clases `green-*` de Tailwind si necesitas fondo suave) | `--color-success` | `#22C55E` | Estados correctos |
| `text-warning` | `--color-warning` | `#F59E0B` | Avisos |
| `text-info` / `bg-info` | `--color-info` | `#2563EB` | Informativo, modo edición |

**Reglas:**
- **Nunca** escribas `#D30B15`, `style={{ color: '...' }}` o `style={{ backgroundColor: '...' }}` para un color de marca. Usa la clase del token.
- Si necesitas un matiz que no está como token (ej. `bg-green-50 text-green-700` para un badge de éxito), usa las clases de color de Tailwind directamente — están para eso — pero **no inventes un hex nuevo**. Los únicos hex "legítimos" fuera de `globals.css` son los que van dentro de props SVG de **recharts** (`fill`, `stroke`, `stop-color`), porque esa librería no entiende clases Tailwind.
- Si un color se repite en 2+ paneles, es candidato a subir a token. Pídelo antes de copiarlo.
- No añadas modo oscuro. Se quitó deliberadamente (ver `DECISIONS.md`) porque ningún componente lo soporta y generaba fondos negros no controlados en algunos navegadores.

## 3. Tipografía y espaciado

- Fuente única: **Geist** (`--font-sans`, cargada vía `next/font` en `app/layout.tsx`). No añadas `@import` de Google Fonts ni fuentes nuevas.
- Escala de tamaños: usa las utilidades de Tailwind (`text-xs`, `text-sm`, `text-base`, `text-lg`, `text-xl`). **No uses tamaños arbitrarios** (`text-[10px]`, `text-[11px]`) — el tamaño más pequeño permitido es `text-xs`.
- Espaciado: escala estándar de Tailwind (4px). Evita anchos arbitrarios (`w-[145px]`) salvo que sea el ancho real de un control de formulario donde el diseño ya lo requiere (el `FilterPanel` existente usa algunos por consistencia con inputs de fecha/hora — no los repliques en paneles nuevos si puedes usar `w-full`/`flex-1` dentro de un grid).

## 4. Componentes base (`components/ui/`)

Estilo shadcn simplificado. Todos aceptan `className` para extender, nunca para sobrescribir el color de marca.

| Componente | Uso | Notas |
|---|---|---|
| `Button` | Cualquier acción clicable | Variantes: `default` (rojo corporativo), `destructive`, `outline`, `secondary`, `ghost`, `link`. Tamaños: `default`, `sm`, `lg`, `icon`. El botón "principal" de una página (Filtrar, Guardar, Crear) es siempre `variant="default"` — no le pongas `style={{backgroundColor:'#D30B15'}}`, ya lo es. |
| `Card` | Contenedor con borde y sombra | Prop **`accent`** (`<Card accent>`) añade el borde superior rojo de 3px + `overflow-hidden`. Es el reemplazo directo de `style={{borderTop:'3px solid #D30B15'}}`. Úsalo en toda tarjeta de panel/filtros/KPI. |
| `Input` | Campo de texto | Ya trae borde, foco y disabled tokenizados. |
| `Table` / `TableHeader` / `TableBody` / `TableRow` / `TableHead` / `TableCell` | Tablas de datos | `TableRow` ya tiene hover; si la fila no debe reaccionar al hover (fila de estado, spinner, empty state), añade `className="hover:bg-transparent"`. |
| `Popover` / `PopoverTrigger` / `PopoverContent` | Desplegables posicionados | Basado en Radix, con Portal. |
| `Badge` | Etiqueta de estado/categoría | Variantes: `default` (gris), `primary` (rojo suave), `success`, `warning`, `destructive`, `info`, `outline`. Sustituye a cualquier `<span className="bg-X-100 text-X-700 rounded px-2">` ad-hoc. |
| `Spinner` | Estado de carga | `<Spinner label="Cargando..." className="py-10" />`. Sustituye a `<Loader2 className="animate-spin" />` suelto. El `label` es opcional pero recomendado (accesibilidad + claridad). |
| `Skeleton` | Placeholder de carga con pulso | Para bloques de contenido que no son una tabla (cards, texto). |
| `EmptyState` | Tabla/panel sin resultados | `<EmptyState icon={SearchX} title="Sin resultados" description="..." action={<Button>...</Button>} />`. Sustituye al `<TableCell>texto centrado gris</TableCell>` de antes. |
| `Dialog` / `ConfirmDialog` | Modal / confirmación | Sobre `<dialog>` nativo (foco y Escape gratis, sin dependencia nueva). **`ConfirmDialog` sustituye a `confirm()` nativo** para cualquier borrado u acción irreversible — ver patrón en el punto 6. |
| `useToast` (de `components/ui/toast.tsx`) | Notificación no intrusiva | `const { toast } = useToast(); toast("Mensaje", "success" | "error" | "info")`. **Sustituye a `alert()`** siempre. El `ToastProvider` ya está montado una vez en `app/layout.tsx`; no lo vuelvas a montar en una página. |
| `Tabs` | Navegación por pestañas dentro de una página | `<Tabs value={tab} onValueChange={setTab} tabs={[{value,label,count?}]} />`. Solo pinta la barra; el contenido condicional lo sigue decidiendo la página con `{tab === 'x' && ...}`, igual que antes. |

## 5. Componentes de panel (`components/`)

### `AppShell` + `PageHeader` (`components/AppShell.tsx`)

Es el punto de entrada obligatorio de **toda página de panel**. Sustituye a:
```tsx
// ❌ antes — cada página con su propio contenedor
<main className="min-h-screen bg-gray-100 p-8 font-sans text-gray-900">
  <div className="mx-auto max-w-7xl space-y-8">
    <Navbar currentPanel="x" user={sessionUser} onLogout={logout} />
    {/* ... */}
  </div>
</main>
```
```tsx
// ✅ ahora
<AppShell
  navbar={{ currentPanel: "x", user: sessionUser, onLogout: logout, onPresetsClick: () => setPresetsSignal(s => s + 1) }}
  title="Nombre del panel"
  description="Una frase que explique qué se ve aquí"
>
  {/* filtros, KPIs, tabla... */}
</AppShell>
```

- `navbar` recibe exactamente las mismas props que hoy le pasas a `<Navbar>` directamente.
- `title`/`description` son opcionales pero **debes** ponerlos en cualquier panel nuevo — es la orientación mínima que le faltaba a la app (sin esto, el usuario no sabe en qué pantalla está salvo por la URL).
- `width="narrow"` (max-w-4xl) solo para páginas tipo formulario/admin sin tablas anchas. Por defecto (`"default"`, max-w-7xl) para paneles de datos.
- No metas `<main>` ni el contenedor `max-w-*` tú mismo si usas `AppShell` — lo duplicarías.

### `KpiCard` (`components/KpiCard.tsx`)

Sustituye a la tarjeta KPI copiada en cada panel (`Card` + `CardHeader` + icono + número grande + caption).

```tsx
// Caso simple: valor + caption
<KpiCard title="Órdenes" icon={Calendar} value={metrics.totalOrders} caption="Total de órdenes (cargadas)" />

// Caso con color semántico en el icono (ej. verde para "Completados")
<KpiCard title="Completados" icon={CheckCircle2} iconClassName="text-green-500">
  <div className="text-2xl font-black text-green-600">{n}</div>
  <p className="mt-1 text-xs font-medium text-muted-foreground">100% asignado</p>
</KpiCard>
```
Usa `children` en vez de `value`/`caption` cuando el cuerpo necesita más de una línea o un color condicional. El grid de KPIs es siempre `grid gap-4 sm:grid-cols-2 md:grid-cols-4` (o menos columnas si hay menos de 4 KPIs) — el `sm:grid-cols-2` es obligatorio para que no se aplasten en tablet vertical.

### `PresetPanel` + `PresetQuickSelect` + `usePresets` (`components/PresetPanel.tsx`)

**Nunca vuelvas a escribir un panel de presets a mano.** Antes estaba copiado y pegado en 4 páginas (con pequeñas divergencias que eran bugs latentes). Todo panel con presets guardados debe ofrecer **dos** formas de usarlos: el panel completo (guardar/editar/borrar) y un **desplegable de carga rápida** en la barra de acciones — no uses solo uno de los dos.

```tsx
const { presets, reload: reloadPresets } = usePresets('nombre_del_panel')  // mismo valor que /api/presets?screen=...

const applyPresetFilters = (f: Record<string, unknown>) => {
  /* setters para restaurar cada filtro, con sus defaults — la usan AMBOS componentes de abajo */
}

// 1) Panel completo (guardar/editar/listar/borrar) — normalmente antes de los filtros
<PresetPanel
  screen="nombre_del_panel"
  presets={presets}
  onReload={reloadPresets}
  open={showPresets}
  onClose={() => setShowPresets(false)}
  getFilters={() => ({ /* objeto con TUS filtros actuales */ })}
  applyFilters={applyPresetFilters}
  hint="Se guardarán X, Y y Z."       // opcional, texto de ayuda bajo el botón Guardar
  dateFields={['startDate', 'endDate']}  // opcional, ver más abajo — omite si tu panel no tiene fechas
/>

// 2) Desplegable de carga rápida — junto a los botones Filtrar/Excel/Limpiar
{sessionUser && (
  <PresetQuickSelect presets={presets} onSelect={(p) => applyPresetFilters(JSON.parse(p.filters))} />
)}
```

La página aporta:
- `screen`: la clave de tu panel (consistente con lo que ya guardas en `/api/presets`).
- `getFilters`: serializa tu estado de filtros actual a un objeto plano.
- `applyPresetFilters` (nómbrala como quieras): hace el `setX(f.x ?? default)` de cada filtro al cargar un preset — **una sola función**, compartida por `PresetPanel` y `PresetQuickSelect`, para que cargar un preset se comporte igual desde cualquiera de los dos sitios.

El hook `usePresets(screen)` es quien de verdad hace el fetch a `/api/presets?screen=...` — se llama **una vez** en la página y se reparte a ambos componentes. Esto es importante: si cada componente hiciera su propio fetch, el desplegable rápido y el panel podrían mostrar listas desincronizadas después de guardar/borrar un preset. `PresetPanel` llama a `onReload()` (el `reload` del hook) tras guardar/editar/borrar, así que el desplegable rápido se actualiza solo.

**`dateFields` — "Incluir fechas" opcional al guardar (igual que producción/`FilterPanel`)**: si tu panel filtra por rango de fechas, pásale la lista de claves de fecha que devuelve tu `getFilters()` (ej. `['startDate', 'endDate']`, o con fecha de entrega `['startDate','endDate','deliveryStartDate','deliveryEndDate']` como en pedidos). Con esto:
- Aparece un checkbox **"Incluir fechas"** junto al nombre, desmarcado por defecto — si no lo marcas, esas claves se borran del objeto antes de guardarlo, así el preset sirve para cualquier día.
- Los presets guardados con fecha muestran un icono de calendario junto al nombre.
- Al editar un preset que ya tenía fechas, el checkbox aparece premarcado solo.

Si tu panel no tiene filtro de fechas (ej. caducados) o usa un filtro relativo que no caduca igual (ej. "últimos N días" en comparativa SERES), simplemente **omite** `dateFields` — el componente se comporta exactamente igual que antes, sin checkbox.

Todo lo demás (guardar, editar, listar, `ConfirmDialog` al borrar, toasts de éxito/error) lo gestiona `PresetPanel`. La página sigue necesitando su propio estado `showPresets` (booleano) y `presetsSignal` (para que el botón "Presets" del Navbar lo abra) — eso no cambia.

### `Navbar` (`components/Navbar.tsx`)

No se toca su API al añadir un panel nuevo salvo un paso: añadir la entrada al array `PANELS` (clave, label, href, icono) — ver `DOCUMENTACION.md` sección 10.

### `FilterPanel` (`components/FilterPanel.tsx`)

Es específico del dashboard de producción (categorías JDE). Para un panel nuevo con filtros propios, **no lo reutilices tal cual** — construye tu propio bloque de filtros dentro de un `<Card accent>` siguiendo el patrón visual: `p-4 space-y-4`, secciones separadas por `<div className="border-t border-border" />`, labels `text-xs font-semibold text-secondary-foreground`, título de sección `text-xs font-semibold text-muted-foreground uppercase tracking-wider`.

---

## 6. Patrones de interacción obligatorios

Estas cuatro reglas sustituyeron comportamientos concretos que existían en el código pre-rediseño. No repitas los patrones antiguos.

| Antes (no repetir) | Ahora |
|---|---|
| `alert(mensaje)` para errores o confirmaciones de éxito | `const { toast } = useToast(); toast(mensaje, 'error' \| 'success')` |
| `if (!confirm('¿Seguro?')) return` antes de borrar | `<ConfirmDialog open={...} onOpenChange={...} title="..." description="..." destructive onConfirm={...} />` — guarda el elemento a borrar en un `useState` y abre el diálogo en vez de borrar directamente |
| `<Loader2 className="animate-spin" />` suelto en cada sitio distinto | `<Spinner label="Cargando X..." />` |
| Fila de tabla con texto gris centrado para "sin resultados" | `<EmptyState icon={...} title="Sin resultados" description="..." />` dentro de la celda con `colSpan` |
| Panel de presets copiado por página | `<PresetPanel>` + `<PresetQuickSelect>` compartiendo `usePresets(screen)` (ver punto 5) |

---

## 7. Checklist para crear un panel nuevo

Sigue este orden; cada paso da por hecho que el anterior está hecho.

1. **Página** (`app/mi-panel/page.tsx`, `"use client"`): monta `<AppShell navbar={{...}} title="..." description="...">` como contenedor raíz. No repitas `<main>`/`max-w-*`/`<Navbar>` sueltos.
2. **Navbar**: añade tu panel al array `PANELS` en `components/Navbar.tsx` (clave, label, href, icono de lucide-react). Si el panel debe poder restringirse por rol, añade su `key` a `SCREEN_KEYS` en `app/admin/page.tsx` para que aparezca en la pestaña "Pantallas".
3. **Filtros**: bloque propio en un `<Card accent>` siguiendo el patrón del punto 5 (FilterPanel). Usa `Input`, `DatePicker`, `ArticleMultiSelect`/`SingleSelect` según el tipo de filtro.
4. **Presets** (si el panel los necesita): estado `showPresets`/`presetsSignal` + `const { presets, reload } = usePresets('mi_panel')` + `<PresetPanel .../>` **y** `<PresetQuickSelect .../>` en la barra de acciones — ver punto 5. Recuerda pasar `onPresetsClick` al `navbar` del `AppShell`.
5. **KPIs** (si aplica): `<KpiCard>` en un grid `sm:grid-cols-2 md:grid-cols-N`.
6. **Tabla**: `Table`/`TableHeader`/`TableBody`/`TableRow`/`TableHead`/`TableCell` dentro de `<Card accent>`. Estados de `loading` → `Spinner`, sin resultados → `EmptyState`, ambos en una `TableRow className="hover:bg-transparent"` con `colSpan` al nº de columnas.
7. **Acciones destructivas o de escritura**: `toast()` para feedback, `ConfirmDialog` para confirmaciones — nunca `alert()`/`confirm()`.
8. **Logs de consultas** (si el panel consulta datos de Oracle): añade el `INSERT` en tu API route con `source: 'mi_panel'` y la etiqueta en `SOURCE_LABELS` de `app/admin/logs/page.tsx` — ver `DOCUMENTACION.md` sección 7.
9. **Colores**: repasa que no haya ni un hex ni un `style={{ color/backgroundColor/borderTop }}` en tu diff. Si Grep encuentra `#` seguido de 3 o 6 dígitos hex en tu archivo (fuera de `globals.css` o de props de recharts), es un bug.
10. **Responsive**: prueba la página en viewport tablet (≈768px) — es el uso real en planta. Los grids deben tener al menos un breakpoint `sm:`/`md:` antes de llegar a la columna final.
11. **Verificación**: `bun run build` y `bun test` deben pasar antes de dar el panel por terminado.

---

## 8. Qué NO hacer

- No añadir una librería de iconos nueva. Solo `lucide-react`.
- No añadir una librería de toast/modal/tooltip nueva (`sonner`, `react-hot-toast`, `@radix-ui/react-dialog`...). Ya existen `useToast`, `Dialog`/`ConfirmDialog` y `Popover` — amplíalos si les falta algo.
- No crear un `tailwind.config.js`. Tailwind 4 en este proyecto vive enteramente en `app/globals.css` (`@theme inline`).
- No usar `localStorage`/`sessionStorage` (regla ya existente del proyecto, sigue aplicando a componentes de UI).
- No reactivar el modo oscuro sin auditar antes que **todos** los componentes lo soporten (hoy ninguno lo hace).
