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
app/                    # Rutas Next.js (App Router)
  produccion/page.tsx   # Dashboard principal (client component)
  admin/page.tsx        # Panel de administración de usuarios
  admin/logs/page.tsx   # Logs de consultas (solo admin)
  login/page.tsx        # Login
  cambiar-contrasena/   # Cambio forzado de contraseña
  api/                  # API Routes (servidor)
    production/         # GET datos producción (endpoint más complejo)
    categories/         # GET opciones para filtros
    production-lines/   # GET líneas de producción
    auth/               # login, logout, me, change-password
    admin/              # users CRUD, logs
    presets/            # CRUD presets de filtros
lib/
  db.ts                 # Conexión Oracle (getDbConnection)
  sqlite.ts             # Conexión SQLite + migraciones + seed admin
  auth.ts               # JWT, bcrypt, verifySession, cookieOptions
  utils.ts              # parseJdeDate, parseWasOqs, cn()
components/
  ArticleMultiSelect.tsx  # Desplegable multi-selección con búsqueda
  ui/                     # button, card, input, table (estilo shadcn)
middleware.ts           # Protege /api/admin/* (JWT + role admin)
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
- Color corporativo: `#D30B15` (borde superior tarjetas, botón Filtrar, iconos KPI)
- Fuente: Geist (via next/font)
- Componentes UI base en `components/ui/` (estilo shadcn simplificado)
- Dark mode definido en CSS pero no activamente usado en componentes

### TypeScript
- `tsconfig.json`: target ES2017, strict: true, moduleResolution: bundler
- `next.config.ts`: `serverExternalPackages: ['better-sqlite3']` (necesario para build producción)

## Patrones importantes

### Añadir nuevo filtro de categoría
1. `api/categories/route.ts` → añadir entrada al `FIELD_MAP`
2. `api/production/route.ts` → leer param, añadir JOIN condicional + WHERE con TRIM + bind
3. `app/produccion/page.tsx` → estado, fetch useEffect, añadir a URLSearchParams, clearFilters, ArticleMultiSelect

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
- Actualizar `DOCUMENTACION.md` o el `docs/*.md` correspondiente si el cambio afecta a algo documentado
- Sugerir commit con mensaje siguiendo el estilo del proyecto (conventional + español)

### Testing
- Verificar compilación con `bun run build` después de cambios significativos

### Git
- La carpeta `data/` está en `.gitignore`
- La carpeta `.idea/` está en el repo (IntelliJ) — no tocar
- Documentación de features específicas en `docs/` (no en `DOCUMENTACION.md` directamente)
