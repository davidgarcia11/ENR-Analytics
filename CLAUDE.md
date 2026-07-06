# CLAUDE.md — Dashboard de Producción (Elaborados Naturales)

## Proyecto
Dashboard de producción para Elaborados Naturales. Conecta con Oracle JDE y muestra órdenes de fabricación, merma, producción por planta/línea. Incluye autenticación, presets de filtros, logs de consultas y exportación a Excel.

## Stack
- **Framework:** Next.js 16 (App Router)
- **UI:** React 19 + TypeScript 5 + Tailwind CSS 4
- **Runtime/Package Manager:** Bun (no npm/node)
- **BD Oracle:** oracledb 6 (driver nativo, requiere `try/finally` para cerrar conexiones SIEMPRE)
- **BD Local:** better-sqlite3 (usuarios, presets, logs) en `data/app.db`
- **Auth:** JWT (jose) + bcryptjs, cookie httpOnly
- **Excel:** xlsx 0.18
- **Gráficos:** recharts
- **Iconos:** lucide-react
- **Componentes UI:** Radix UI (solo Slot), class-variance-authority, clsx, tailwind-merge

## Comandos
```bash
bun install          # Instalar dependencias
bun dev              # Desarrollo (hot reload)
bun run build        # Compilar producción
bun start            # Servir producción
bun lint             # ESLint (eslint-config-next)
```

## Estructura clave
```
app/                          # Rutas Next.js (App Router)
  produccion/page.tsx         # Dashboard de producción (client component)
  preparacion-pedidos/        # Panel control de pedidos
  caducados/                  # Panel palets caducados/obsoletos/bloqueados
  comparativa-seres/          # Panel comparativa SERES vs JDE
  admin/page.tsx              # Panel de administración de usuarios
  admin/logs/page.tsx         # Logs de consultas (solo admin)
  login/page.tsx              # Login
  cambiar-contrasena/         # Cambio forzado de contraseña
  api/                        # API Routes (servidor)
    production/               # GET datos producción (endpoint más complejo)
    production/merma-breakdown/ # GET desglose de merma por tipo (Q/P), modos global/row/matrix
    categories/               # GET opciones para filtros de producción
    production-lines/         # GET líneas de producción
    orders/                   # GET control de pedidos
    plants/                   # GET plantas dinámicas (usado en pedidos y caducados)
    caducados/                # GET palets caducados/obsoletos/bloqueados
    jde-orders/               # GET órdenes JDE (API externa, usada por herramientas externas)
    comparativa-seres/        # GET comparativa SERES vs JDE
    auth/                     # login, logout, me, change-password
    admin/                    # users CRUD, logs
    presets/                  # CRUD presets de filtros
lib/
  db.ts                       # Conexión Oracle (getDbConnection)
  sqlite.ts                   # Conexión SQLite + migraciones + seed admin
  auth.ts                     # JWT, bcrypt, verifySession, cookieOptions
  utils.ts                    # parseJdeDate, parseWasOqs, cn()
components/
  AppShell.tsx                # AppShell (contenedor de página + Navbar) y PageHeader — punto de entrada de todo panel
  KpiCard.tsx                 # Tarjeta KPI reutilizable (icono + valor + caption, o children para casos custom)
  PresetPanel.tsx             # Sistema de presets compartido: usePresets(screen) hook + PresetPanel (panel completo) + PresetQuickSelect (desplegable rápido)
  Navbar.tsx                  # Barra de navegación compartida por todos los paneles (dropdown "Paneles ▾")
  FilterPanel.tsx             # Panel de filtros del dashboard de producción (incluye presets)
  ArticleMultiSelect.tsx      # Desplegable multi-selección con búsqueda (usado en FilterPanel)
  MermaBreakdown.tsx          # Desglose de merma agrupado Q=Etiquetado / P=Pasteurizado (card global + popover en /produccion)
  MermaCellPopover.tsx        # Popover por fila al pulsar celda Merma en /produccion
  ui/                         # button, card (prop `accent`), input, table, popover, badge, skeleton,
                               # spinner, empty-state, dialog (Dialog/ConfirmDialog), toast (useToast), tabs
middleware.ts                 # Protege /api/admin/* (JWT + role admin)
docs/                         # Documentación específica por panel
  design-system.md            # SISTEMA DE DISEÑO — leer antes de tocar UI de cualquier panel (obligatorio)
  produccion.md               # Dashboard de producción — completo para juniors
  control-pedidos.md          # Panel de pedidos
  palets-caducados.md         # Panel de caducados
  seres-jde-comparativa.md    # Panel comparativa SERES vs JDE
```

## Convenciones de código

### General
- Idioma del código: **inglés** para variables/funciones, **español** para UI y comentarios
- Alias de importación: `@/` apunta a la raíz del proyecto (`import { getDbConnection } from '@/lib/db'`)
- Componentes cliente llevan `"use client"` en la primera línea
- API Routes son siempre servidor (sin directiva)

### Oracle / JDE
- Columnas Oracle siempre en **MAYÚSCULAS** (OUT_FORMAT_OBJECT)
- Fechas JDE formato **CYYDDD**: usar `parseJdeDate()` de `lib/utils.ts`
- Cantidades JDE vienen **×100**: dividir siempre
- Factores conversión UM vienen **×10.000.000**: dividir siempre
- Campos CHAR tienen padding de espacios: usar `TRIM()` en SQL
- Valores del usuario → **bind variables** (`:param`), nunca concatenar
- Valores de FIELD_MAP → embeber directamente (son constantes del código)
- Artículos validados con regex `/^\d{10}$/`
- **SIEMPRE** cerrar conexiones Oracle con `try/finally`

### SQLite
- Migraciones automáticas con `ALTER TABLE` en `lib/sqlite.ts`
- `data/app.db` está en `.gitignore`, no se pierde con git pull/build
- Usuario admin por defecto: `admin` / `admin123`

### Autenticación
- JWT firmado HS256, expira 7 días, cookie `session` httpOnly
- `cookieOptions(req)` detecta HTTPS desde URL real (no NODE_ENV) para funcionar en LAN
- `middleware.ts` protege rutas `/api/admin/*`
- Logging de consultas nunca bloquea la respuesta (try/catch independiente)

### Estilo visual
- **Sistema de diseño completo:** [`docs/design-system.md`](docs/design-system.md) — léelo antes de escribir o tocar JSX/CSS de cualquier panel. Es de lectura obligatoria, no opcional.
- Todos los colores son **tokens Tailwind 4** definidos en `@theme inline` dentro de `app/globals.css` (no hay `tailwind.config.js`). Color corporativo: `bg-primary`/`text-primary` (`#D30B15`). **Nunca** un hex hardcodeado ni `style={{color/backgroundColor/borderTop}}` fuera de props SVG de recharts.
- Fuente: Geist (via next/font), única en toda la app
- Componentes UI base en `components/ui/` (estilo shadcn simplificado): button, card (prop `accent` = borde superior rojo), input, table, popover, badge, skeleton, spinner, empty-state, dialog/ConfirmDialog, toast (`useToast`), tabs
- Toda página de panel se monta con `<AppShell>` (`components/AppShell.tsx`) — no se repite `<main>`/`max-w-*`/`<Navbar>` sueltos
- No hay dark mode (se quitó deliberadamente; ver `DECISIONS.md`)

### TypeScript
- `tsconfig.json`: target ES2017, strict: true, moduleResolution: bundler
- `next.config.ts`: `serverExternalPackages: ['better-sqlite3']` (necesario para build producción)

## Patrones importantes

### Crear o tocar la UI de un panel (nuevo o existente)
1. Lee **[`docs/design-system.md`](docs/design-system.md)** primero — tokens de color, componentes base y checklist paso a paso para un panel nuevo
2. Todo panel se monta con `<AppShell navbar={{...}} title="..." description="...">` (`components/AppShell.tsx`)
3. Presets → `usePresets(screen)` + `<PresetPanel>` + `<PresetQuickSelect>` (`components/PresetPanel.tsx`), nunca un panel de presets escrito a mano — ver `docs/design-system.md` §5
4. `alert()`/`confirm()` → `useToast()` / `<ConfirmDialog>` (`components/ui/toast.tsx`, `components/ui/dialog.tsx`)
5. KPIs → `<KpiCard>` (`components/KpiCard.tsx`); tarjetas con borde superior de marca → `<Card accent>`

### Añadir nuevo filtro de categoría (dashboard de producción)
1. `api/categories/route.ts` → añadir entrada al `FIELD_MAP`
2. `api/production/route.ts` → leer param, añadir JOIN condicional + WHERE con TRIM + bind
3. `components/FilterPanel.tsx` → estado, fetch useEffect, añadir a `handleApply` y `clearFilters`, añadir `<ArticleMultiSelect>`
4. `app/produccion/page.tsx` → añadir el nuevo campo al `URLSearchParams` en `fetchData`
5. Ver guía completa en `docs/produccion.md` sección 13

### Añadir nuevo panel/fuente de logs
1. Añadir INSERT en la ruta API con `source: 'nombre_panel'`
2. Añadir etiqueta en `SOURCE_LABELS` en `admin/logs/page.tsx`

### Merma
- Movimientos `IS` con códigos razón `P01-P05`, `Q01-Q10`
- Valor negativo de Oracle
- Fórmula: `|merma| / (|merma| + producido) × 100`

## Reglas para Claude Code

### Antes de hacer cambios
- Verificar en qué rama estamos antes de actuar
- Ofrecer plan detallado y esperar confirmación antes de ejecutar si el cambio afecta a más de 2 archivos
- Lee los archivos afectados antes de modificarlos
- Si tocas `api/production/route.ts`, ten especial cuidado: es el endpoint más complejo

### Al escribir código
- Respeta el patrón existente de manejo de errores (try/catch/finally)
- No cambies el estilo de los componentes UI existentes sin que te lo pida
- Mantén los comentarios en español
- Usa bind variables para valores de usuario en consultas Oracle
- No uses `localStorage` ni `sessionStorage` en componentes
- No crear archivos nuevos sin confirmación explícita

### Después de hacer cambios
- **Documentación — dónde actualizar:**
  - Cambios en tokens de color, componentes de `components/ui/`, `AppShell`, `KpiCard` o `PresetPanel` → `docs/design-system.md`
  - Cambios en auth, admin, logs, presets, lib/, stack o estructura general → `DOCUMENTACION.md`
  - Cambios en el panel de producción (`/produccion`, `FilterPanel`, `api/production`, `api/categories`, `api/production-lines`) → `docs/produccion.md`
  - Cambios en el panel de pedidos → `docs/control-pedidos.md`
  - Cambios en el panel de caducados → `docs/palets-caducados.md`
  - Cambios en el panel comparativa SERES vs JDE → `docs/seres-jde-comparativa.md`
  - Nuevo panel → crear `docs/nombre-panel.md` y añadir referencia en `DOCUMENTACION.md` sección 9
- Sugerir commit con mensaje siguiendo el estilo del proyecto (conventional + español)

### Testing
- Verificar compilación con `bun run build` después de cambios significativos

### Git — Flujo de trabajo
```
# 1. Crear feature desde develop
git checkout develop
git pull
git checkout -b feature/nombre

# 2. Trabajar y hacer commits
git add <archivos>
git commit -m "..."

# 3. Subir a GitHub
git push -u origin feature/nombre

# 4. En GitHub: crear PR → revisar → merge a develop

# 5. Volver a develop y actualizar
git checkout develop
git pull --prune

# 6. Borrar rama feature local (ya mergeada)
git branch -d feature/nombre
```

### Git — Reglas
- La carpeta `data/` está en `.gitignore`
- La carpeta `.idea/` está en el repo (IntelliJ) — no tocar
- `DOCUMENTACION.md` = documentación general del proyecto (auth, stack, lib/, patrones comunes)
- `docs/*.md` = documentación específica por panel (uno por panel, para juniors)
- Al crear una nueva feature de panel: crear `docs/nombre-panel.md` en la misma rama
- Rama principal de integración: `develop`. `main` es producción
