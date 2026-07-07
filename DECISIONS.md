# Decisiones de diseño — rediseño UI/UX (`redesign/ui-ux-v2`)

Registro de decisiones de arquitectura/diseño tomadas durante el rediseño visual completo de la aplicación. No repite lo que ya está en `docs/design-system.md` (esa es la referencia de *cómo usar* el sistema); esto es el *por qué* de las decisiones que no eran obvias.

## 1. Tokens en `app/globals.css` (`@theme inline`), no `tailwind.config.js`

El proyecto usa Tailwind CSS 4, que resuelve el tema en CSS puro (`@theme`) en vez de un archivo de configuración JS. No se creó `tailwind.config.js` porque no existía antes y hubiera sido una capa nueva redundante con lo que Tailwind 4 ya resuelve nativamente.

## 2. Paleta exacta de la auditoría, ningún color inventado

Todos los valores hex de `--color-*` en `globals.css` provienen literalmente del código pre-rediseño (90 apariciones de `#D30B15`, más los semánticos `#22c55e`/`#f59e0b`/`#ef4444`/`#2563eb` ya usados sueltos en `caducados`). No se introdujo ningún matiz nuevo — el trabajo fue centralizar, no rediseñar la marca.

## 3. Se eliminó el `@media (prefers-color-scheme: dark)` de `globals.css`

Definía un fondo casi negro que ningún componente de la app soporta activamente (ni antes ni después del rediseño). En navegadores/SO con tema oscuro del sistema, esto producía fondos oscuros con texto también oscuro en zonas sin estilos explícitos — un bug visual, no una feature. Si en el futuro se quiere dark mode real, hay que auditar **todos** los componentes de `components/ui/` primero.

## 4. `<dialog>` nativo en vez de una librería de modales

`components/ui/dialog.tsx` se construyó sobre el elemento `<dialog>` del navegador (`showModal()`/`close()`), no sobre `@radix-ui/react-dialog` ni ninguna otra dependencia nueva. El navegador ya resuelve gratis: focus trap, cierre con Escape, y renderizado en el top-layer (sin gestionar z-index a mano). Coherente con la regla del proyecto de no añadir dependencias para lo que la plataforma ya cubre.

## 5. Toast propio (`components/ui/toast.tsx`), no `sonner`/`react-hot-toast`

Un `ToastProvider` de ~80 líneas con contexto de React cubre el caso de uso real (notificación con variante success/error/info, autodescarte a los 4s, `aria-live`). Añadir una librería para esto hubiera sido una dependencia nueva para un problema pequeño y ya resuelto.

## 6. `Card` con prop `accent` en vez de mantener `style={{borderTop:...}}`

La prop booleana `accent` (`<Card accent>`) fue el reemplazo mecánico de las 41 apariciones de `style={{ borderTop: '3px solid #D30B15' }}`. Se eligió una prop y no una clase Tailwind suelta (`border-t-[3px] border-t-primary`) porque es más fácil de detectar en revisión de código ("¿esta card lleva el sello visual del panel o no?") y evita que alguien vuelva a escribir el valor a mano.

## 7. `PresetPanel` extraído a componente único, con contrato idéntico por panel

Antes de esta rama, el panel "Mis Presets de Filtros" estaba copiado en 4 sitios (`FilterPanel` de producción, `caducados`, `preparacion-pedidos`, `comparativa-seres`) con divergencias sutiles entre copias — cada una con su propio manejo de `alert()`, sin confirmación de borrado, con timings de `useEffect` ligeramente distintos. Se extrajo a `components/PresetPanel.tsx` con una API de dos funciones (`getFilters`/`applyFilters`) que cada página implementa con su propio shape de filtros, verificado campo a campo contra el comportamiento original antes de sustituir el código viejo (ver historial de commits `feat(caducados|comparativa-seres|pedidos)`).

**Corrección posterior:** la primera versión de la extracción dejó que `PresetPanel` gestionara su lista de presets internamente (`useState` propio), lo que hizo desaparecer sin querer el desplegable "Cargar preset" que `caducados` y `preparacion-pedidos` tenían en la barra de filtros (una segunda forma de cargar un preset, sin abrir el panel completo) — un efecto colateral no detectado hasta que se pidió explícitamente comprobarlo. La lista se subió a un hook compartido, `usePresets(screen)`, que ahora reparte los mismos `presets` a `<PresetPanel>` (gestión completa) y al nuevo `<PresetQuickSelect>` (carga rápida), quedando ambos siempre sincronizados. Regla resultante: **todo panel con presets debe montar los tres juntos** — ver `docs/design-system.md` §5.

## 8. `AppShell`/`PageHeader` en vez de retocar cada `<main>` suelto

Los 4 paneles de datos usaban anchos máximos distintos sin motivo (`max-w-7xl` en unos, mezcla de estilos en la home) y ninguno tenía un `<h1>` visible con el nombre de la sección — la única pista de en qué panel estabas era la URL o el dropdown "Paneles". `AppShell` fuerza un contenedor único y un título de sección obligatorio en la práctica (aunque técnicamente opcional en la prop, todo panel nuevo debe pasarlo — ver checklist de `docs/design-system.md`).

## 9. `/admin` y `/admin/logs` no comparten exactamente el mismo patrón que los 4 paneles

`/admin` no usa `AppShell`/`Navbar`: mantiene su propio header (logo + título + botones "Logs"/"Dashboard"), igual que antes del rediseño, porque no es un "panel" del dropdown de `Navbar` — es la sección de administración, y forzarla dentro de `Navbar.PanelKey` (que solo admite los 4 paneles reales) hubiera exigido inflar ese tipo con una clave que no representa un panel navegable de negocio. `/admin/logs` sí adoptó `AppShell` (para heredar el spinner/EmptyState/tokens sin duplicar layout), pero por eso mismo `currentPanel` en `Navbar` se hizo **opcional**: una página que no es ninguno de los 4 paneles reales no debe fingir que uno de ellos está activo en el dropdown.

## 10. Alcance: cero cambios de lógica de negocio o contratos de API

En todas las páginas rediseñadas, los `fetch()`, los parámetros enviados, el shape de los objetos guardados en presets y los mensajes de error de servidor son idénticos a los que había antes de esta rama. Los cambios de comportamiento visible para el usuario se limitan a: `alert()` → toast, `confirm()` → `ConfirmDialog`, y estados de carga/vacío más claros — nunca a qué datos se piden o cómo se calculan.

## 11. `any` tipado solo en frontend, no en rutas API

Se tipó el `any` residual en `components/` y páginas cliente (8 apariciones: `FilterPanel.tsx`, `produccion/page.tsx`, `comparativa-seres/page.tsx`). Los `any` de las rutas API (`app/api/**`, ~91 apariciones concentradas en `production/route.ts` y `orders/route.ts`) se dejaron fuera de esta rama a propósito: tocar ese código es un cambio de otra naturaleza (tipado de queries dinámicas a Oracle) y `CLAUDE.md` pide especial cuidado en `api/production/route.ts` por ser el endpoint más complejo del proyecto.
