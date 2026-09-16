# Documentación Técnica — Dashboard de Producción

> **Audiencia:** Desarrolladores que se incorporan al proyecto.
> **Última actualización:** Julio 2026

---

## 1. Visión General

Esta aplicación es un **panel de control (dashboard) de producción** para la empresa Elaborados Naturales. Conecta con la base de datos **Oracle JD Edwards (JDE)** y muestra en tiempo real:

- Órdenes de fabricación y cantidades producidas
- Porcentaje de merma (desperdicio) por artículo
- Desglose por planta, línea de producción y fechas
- Exportación a Excel con formato condicional
- Sistema de autenticación con gestión de usuarios (admin crea usuarios)
- Sistema de roles dinámicos y permisos por pantalla (configurable desde admin)
- Presets de filtros guardados por usuario
- Logs de consultas con estadísticas y gráfico de rendimiento (solo admin)

### Tech Stack

| Tecnología | Versión | Para qué se usa |
|---|---|---|
| **Next.js** | 16 | Framework web (App Router) |
| **React** | 19 | Librería de interfaz de usuario |
| **TypeScript** | 5 | Tipado estático sobre JavaScript |
| **Tailwind CSS** | 4 | Estilos utilitarios (clases CSS) |
| **oracledb** | 6 | Driver para conectar con Oracle desde Node.js |
| **better-sqlite3** | — | Base de datos local para usuarios y presets |
| **mssql** | 12 | Driver para conectar con SQL Server (Reflex) desde Node.js — JS puro sobre `tedious`, sin binarios nativos |
| **jose** | — | Firma/verificación de JWT para sesiones |
| **bcryptjs** | — | Hash de contraseñas |
| **xlsx** | 0.18 | Generar archivos Excel (.xlsx) |
| **recharts** | — | Gráficos de líneas para estadísticas de logs |
| **lucide-react** | 0.563 | Iconos SVG (Search, Factory, Download...) |
| **@radix-ui/react-popover** | — | Popover posicionado con Portal (usado por `MermaCellPopover`; la versión anterior de `app/compras/page.tsx` también lo usaba — el `/compras` actual, sobre Nova, usa `components/nova/ui/popover.tsx` en su lugar) |
| **Bun** | — | Gestor de paquetes y runtime (alternativa a npm/node) |

---

## 2. Estructura del Proyecto

```
dashboard/
├── .env.local                    ← Credenciales Oracle + JWT_SECRET (NUNCA se sube a Git)
├── .gitignore                    ← Incluye /data/ para no subir la BD de usuarios
├── package.json                  ← Dependencias y scripts
├── next.config.ts                ← Configuración de Next.js (HSTS + serverExternalPackages)
├── middleware.ts                 ← Protección de rutas /api/admin/* (verifica JWT + admin)
├── tsconfig.json                 ← Configuración de TypeScript
├── postcss.config.mjs            ← Configuración de PostCSS (Tailwind v4)
├── eslint.config.mjs             ← Reglas de linting
│
├── __tests__/                    ← Tests de seguridad (bun test)
│   ├── middleware.test.ts        ← JWT forgery, expiración, bypass de rol
│   ├── sanitization.test.ts      ← SQL injection, XSS en entradas de usuario
│   ├── permissions.test.ts       ← requireScreenAccess con DB en memoria
│   ├── admin-guards.test.ts      ← Protección del rol/pantalla admin, inyección
│   └── gs1.test.ts               ← Parser de códigos de barras GS1-128 (lib/gs1.ts)
│
├── data/
│   └── app.db                    ← Base de datos SQLite (usuarios, presets, logs — NO se sube a Git)
│
├── public/
│   └── logo.png                  ← Logo de la empresa (se sirve en /logo.png)
│
├── lib/                          ← Lógica reutilizable (utilidades)
│   ├── db.ts                     ← Conexión a Oracle
│   ├── sqlite.ts                 ← Conexión a SQLite (usuarios, presets, migraciones, roles, pantallas)
│   ├── auth.ts                   ← JWT, bcrypt, SessionUser, cookieOptions
│   ├── permissions.ts            ← Control de acceso por pantalla (getAllScreensConfig, requireScreenAccess)
│   ├── panels.ts                 ← Fuente única de los paneles reales (clave, label, href, icono, descripción)
│   ├── utils.ts                  ← Funciones auxiliares (fechas, cantidades, clases CSS)
│   ├── reflex.ts                 ← Conexión a SQL Server (Reflex), análoga a db.ts para Oracle
│   └── gs1.ts                    ← Parser de códigos de barras GS1-128 (EAN/lote/cantidad/SSCC/fechas)
│
├── components/                   ← Componentes React reutilizables
│   ├── ArticleMultiSelect.tsx    ← Desplegable multi-selección con búsqueda
│   ├── DatePicker.tsx            ← Selector de fecha (wrapper de <input type="date"> nativo)
│   ├── FilterPanel.tsx           ← Panel de filtros del dashboard de producción
│   ├── MermaBreakdown.tsx        ← Desglose de merma agrupado Q/P (usado en /produccion)
│   ├── MermaCellPopover.tsx      ← Popover por fila al pulsar celda Merma en /produccion
│   ├── Navbar.tsx                ← Barra de navegación compartida
│   ├── SingleSelect.tsx          ← Variante de selección única de ArticleMultiSelect
│   └── ui/                       ← Componentes de interfaz base (estilo shadcn)
│       ├── button.tsx
│       ├── card.tsx
│       ├── input.tsx
│       ├── popover.tsx           ← Popover Radix con Portal
│       └── table.tsx
│
└── app/                          ← Rutas de Next.js (App Router)
    ├── globals.css               ← Estilos globales + importación de Tailwind
    ├── layout.tsx                ← Layout raíz (envuelve todas las páginas)
    ├── page.tsx                  ← Ruta "/" → página de inicio (paneles públicos o redirect si hay sesión)
    ├── login/
    │   └── page.tsx              ← Ruta "/login" → formulario de inicio de sesión
    ├── admin/
    │   ├── page.tsx              ← Ruta "/admin" → panel de administración de usuarios
    │   └── logs/
    │       └── page.tsx          ← Ruta "/admin/logs" → logs de consultas (solo admin)
    ├── cambiar-contrasena/
    │   └── page.tsx              ← Ruta "/cambiar-contrasena" → cambio forzado de contraseña
    ├── produccion/
    │   └── page.tsx              ← Ruta "/produccion" → DASHBOARD PRINCIPAL
    └── api/
        ├── auth/
        │   ├── login/route.ts    ← POST /api/auth/login
        │   ├── logout/route.ts   ← POST /api/auth/logout
        │   ├── me/route.ts       ← GET /api/auth/me
        │   └── change-password/
        │       └── route.ts      ← POST /api/auth/change-password
        ├── admin/
        │   ├── logs/
        │   │   └── route.ts      ← GET /api/admin/logs (logs de consultas)
        │   ├── users/
        │   │   ├── route.ts      ← GET/POST /api/admin/users
        │   │   └── [id]/
        │   │       └── route.ts  ← PUT/PATCH/DELETE /api/admin/users/:id
        │   ├── roles/
        │   │   ├── route.ts      ← GET/POST /api/admin/roles
        │   │   └── [id]/
        │   │       └── route.ts  ← DELETE /api/admin/roles/:id
        │   └── screens/
        │       └── [key]/
        │           └── route.ts  ← PUT /api/admin/screens/:key
        ├── screen-permissions/
        │   └── route.ts          ← GET /api/screen-permissions (público, sin auth)
        ├── presets/
        │   ├── route.ts          ← GET/POST /api/presets
        │   └── [id]/
        │       └── route.ts      ← DELETE /api/presets/:id
        ├── categories/
        │   └── route.ts          ← GET /api/categories?field=X
        ├── production/
        │   ├── route.ts          ← GET /api/production?...filtros...
        │   └── merma-breakdown/
        │       └── route.ts      ← GET /api/production/merma-breakdown (modos global/row/matrix)
        ├── production-lines/
        │   └── route.ts          ← GET /api/production-lines
        └── jde-orders/
            └── route.ts          ← GET /api/jde-orders?days=7 (API key, CORS abierto)
```

---

## 3. Configuración

### `.env.local` — Credenciales y secretos

```env
ORACLE_USER=<usuario_oracle>
ORACLE_PASSWORD=<contraseña_oracle>
ORACLE_HOST=<ip_servidor_oracle>
ORACLE_PORT=1521
ORACLE_SERVICE=<nombre_servicio_oracle>
JWT_SECRET=<clave_secreta_para_firmar_jwt>
SERES_API_KEY=<clave_para_endpoint_externo_jde_orders>
REFLEX_HOST=<ip_servidor_sql_server_reflex>
REFLEX_PORT=1433
REFLEX_DATABASE=<nombre_base_datos_reflex>
REFLEX_USER=<usuario_reflex>
REFLEX_PASSWORD=<contraseña_reflex>
```

> **IMPORTANTE:** Este archivo NUNCA se sube al repositorio. Está en `.gitignore`.

### `package.json` — Scripts principales

| Comando | Qué hace |
|---|---|
| `bun dev` | Arranca el servidor en modo desarrollo (hot reload) |
| `bun run build` | Compila la app para producción |
| `bun start` | Sirve la app compilada (producción) |
| `bun test` | Ejecuta los tests de seguridad |
| `bun test --watch` | Tests en modo watch |

### `next.config.ts`

- Cabecera HTTP `Strict-Transport-Security` para forzar HTTPS
- `serverExternalPackages: ['better-sqlite3']` — necesario para que el módulo nativo de SQLite funcione en producción con `npm start`

### `middleware.ts` — Protección de rutas admin

Intercepta todas las peticiones a `/api/admin/*`. Verifica:
1. Que existe un JWT válido en la cookie `session`
2. Que el usuario tiene `role === 'admin'`

Si no cumple, devuelve 403.

### `tsconfig.json` — Alias `@/`

```json
"paths": { "@/*": ["./*"] }
```

Permite importar así: `import { getDbConnection } from '@/lib/db'`

---

## 4. Sistema de Autenticación

### Arquitectura

- **Base de datos:** SQLite local (`data/app.db`) — cero dependencias externas
- **Sesiones:** JWT firmado con HS256, almacenado en cookie httpOnly
- **Contraseñas:** Hash con bcryptjs (10 salt rounds)
- **Dashboard público:** No se requiere login para ver datos. Los presets son un "plus" opcional.

### `lib/sqlite.ts` — Inicialización y migraciones

**Tablas:**

```sql
-- Usuarios
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',        -- 'admin' | 'user'
  must_change_password INTEGER DEFAULT 0,   -- 1 = forzar cambio en próximo login
  name TEXT NOT NULL DEFAULT '',             -- Nombre del usuario
  surname TEXT NOT NULL DEFAULT '',          -- Apellido del usuario
  default_plant TEXT NOT NULL DEFAULT '',    -- id de lib/plants.ts, '' = sin planta por defecto (todas)
  created_at TEXT DEFAULT (datetime('now'))
);

-- Presets de filtros
CREATE TABLE presets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  filters TEXT NOT NULL,                        -- JSON con los filtros del panel
  screen TEXT NOT NULL DEFAULT 'produccion',    -- panel al que pertenece el preset
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, name)
);
```

```sql
-- Logs de consultas
CREATE TABLE query_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  username TEXT NOT NULL DEFAULT 'Invitado',  -- se guarda aunque se borre el usuario
  source TEXT NOT NULL DEFAULT 'produccion',  -- panel origen: 'produccion', 'login', etc.
  filters TEXT NOT NULL,                       -- JSON con filtros usados
  result_count INTEGER,                        -- nº filas devueltas (NULL en logins)
  execution_time_ms INTEGER,                   -- tiempo de consulta (NULL en logins)
  created_at TEXT DEFAULT (datetime('now'))
);
```

```sql
-- Roles disponibles en la aplicación
CREATE TABLE roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,           -- identificador interno (ej: 'supervisor')
  label TEXT NOT NULL,                  -- nombre visible en UI (ej: 'Supervisor')
  created_at TEXT DEFAULT (datetime('now'))
);

-- Pantallas/paneles del dashboard
CREATE TABLE screens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,             -- clave interna (ej: 'produccion')
  label TEXT NOT NULL,                  -- nombre visible
  path TEXT NOT NULL,                   -- ruta Next.js (ej: '/produccion')
  is_public INTEGER NOT NULL DEFAULT 1  -- 1 = pública (sin login), 0 = restringida
);

-- Qué roles tienen acceso a cada pantalla restringida
CREATE TABLE screen_permissions (
  screen_id INTEGER NOT NULL REFERENCES screens(id) ON DELETE CASCADE,
  role_id   INTEGER NOT NULL REFERENCES roles(id)   ON DELETE CASCADE,
  PRIMARY KEY (screen_id, role_id)
);

-- Descripciones editables de los códigos SYEDSP de F47011 (consumidas por /comparativa-seres)
CREATE TABLE jde_status_descriptions (
  code TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Mapeo mes -> código de ledger IELEDG de F30026 (coste real mensual, JDE), editable desde /admin (ver docs/costes.md §3.4)
CREATE TABLE coste_a1_coledg_mensual (
  mes TEXT PRIMARY KEY,
  coledg TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Registro de aceptación del pop-up de /consulta-stock-pda (ver docs/consulta-stock-pda.md §8.2)
CREATE TABLE stock_scan_confirmations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  username TEXT NOT NULL DEFAULT 'Invitado',
  sscc TEXT NOT NULL,
  articulo TEXT,
  estado TEXT NOT NULL,
  mensajes TEXT NOT NULL,        -- JSON array de los mensajes exactos mostrados
  created_at TEXT DEFAULT (datetime('now'))
);
```

**Seeds iniciales:**
- Roles: `admin` (Administrador) y `user` (Usuario)
- Pantallas: `produccion`, `pedidos`, `caducados`, `comparativa` (todas `is_public=1`), `admin` (`is_public=0`)
- Permisos: rol `admin` → pantalla `admin`
- Estados JDE: `Y`, `M`, `N`, `E` con sus descripciones por defecto

Todos los seeds usan `INSERT OR IGNORE` para no romper DBs existentes.

**Migraciones automáticas:** Al arrancar, comprueba si faltan columnas y las añade con `ALTER TABLE`. Columnas gestionadas:
- `must_change_password`, `name`, `surname`, `default_plant` → tabla `users`
- `source` → tabla `query_logs`
- `screen` → tabla `presets` (con `DEFAULT 'produccion'` para no romper presets anteriores)

**Usuario admin por defecto:** Si la tabla `users` está vacía, crea `admin` / `admin123` con role `admin`.

### `lib/auth.ts` — Utilidades de autenticación

| Función | Descripción |
|---|---|
| `createToken(user)` | Crea JWT con `{ sub, username, role, name, surname }`, expira en 7 días |
| `verifySession()` | Lee cookie, verifica JWT, devuelve `SessionUser` o `null` |
| `hashPassword(password)` | Hash bcrypt con 10 rounds |
| `verifyPassword(password, hash)` | Compara contraseña contra hash |
| `cookieOptions(req?)` | Genera opciones de cookie. `secure` depende de si la request es HTTPS |

**Interfaz SessionUser:**
```ts
interface SessionUser {
  id: number;
  username: string;
  role: string;
  name: string;
  surname: string;
  defaultPlant: string;
}
```

### `lib/plants.ts` — Plantas, sub-plantas y planta por defecto del usuario

Fuente única de las 4 plantas físicas de la empresa (Aguilar, Corella, Funes, Tudefrigo). Cada
sistema tiene su propio código para la misma planta física — JDE (`F0006.MCMCU`) y Reflex
(`HLEMPLP.EMCDPO`) — así que `lib/plants.ts` define un `id` canónico por planta (el que se guarda
en `users.default_plant`) y expone `plantJdeCode(id)` / `plantReflexCode(id)` / `plantLabel(id)`
para traducirlo al código que necesita cada panel. `id` vacío = el usuario no tiene planta por
defecto (se comporta como "Todas", igual que antes de tener esta función).

Los códigos JDE se confirmaron consultando `F0006` (`WHERE MCSTYL = 'BP'`), no son una suposición:

| Planta | `id` canónico | Código JDE | Código Reflex |
|---|---|---|---|
| Aguilar | `aguilar` | `10100` | `001` |
| Corella | `corella` | `10200` | `002` |
| Funes | `funes` | `10300` | `004` |
| Tudefrigo | `tudefrigo` | `10003` | `006` |

**Uso en los paneles con filtro de planta** (`/produccion`, `/preparacion-pedidos`, `/caducados`,
`/consulta-stock-pda`): al cargar, cada panel espera a conocer la sesión (`/api/auth/me`) antes de
disparar su primera consulta, resuelve `defaultPlant` al código de su propio sistema, y lo usa como
filtro inicial — así la primera pantalla ya sale filtrada, sin parpadeo de "todas las plantas" y
luego solo la suya. `/produccion` solo tiene como opción Aguilar/Corella/Funes (Tudefrigo es
almacén, no se produce ahí): si la planta por defecto de un usuario es Tudefrigo, ese panel en
concreto cae a "Todas", los demás paneles sí la aplican. `/compras` y `/comparativa-seres` no
tienen filtro de planta, no usan este módulo.

**Sub-plantas de Funes** (`FUNES_SUBPLANTS`, `funesSubplantLabel()`, `plantHasSubplants()`): Funes
es la única planta con dos naves físicas, y el stock del mismo artículo se reparte entre ellas. Se
identifican con `HLEMPLP.EMCMGN` en Reflex (`004` = Funes 1, `005` = Funes 2) y las usa
`/consulta-stock-pda` para no recomendar un palet que está en la nave de al lado — ver
`docs/consulta-stock-pda.md` §7.5 para el detalle (incluido el aviso de que `EMCMGN` **no** es único
entre depósitos, así que siempre se filtra junto con `EMCDPO`). No mapean 1:1 con las sub-líneas de
`/produccion`, que salen de JDE y son tres (Funes 1 / Funes 2 / Funes Past.).

### Flujo de autenticación

```
LOGIN:
  /login → POST /api/auth/login → JWT en cookie
    ├── mustChangePassword=true → /cambiar-contrasena
    └── mustChangePassword=false → primer panel accesible según permisos
                                   (produccion → pedidos → caducados → comparativa)
                                   si ninguno accesible → error "Contacta con el administrador"

CAMBIO DE CONTRASEÑA FORZADO:
  /cambiar-contrasena → POST /api/auth/change-password
    → Actualiza hash + must_change_password=0 → primer panel accesible

SESIÓN EN DASHBOARD:
  Cada panel → GET /api/auth/me + GET /api/screen-permissions
    ├── Si logueado y tiene acceso: muestra nombre + botones según rol
    ├── Si logueado pero sin acceso: redirect /login
    └── Si no logueado y pantalla pública: carga sin sesión
    └── Si no logueado y pantalla privada: redirect /login
```

### Cookie `secure` en LAN

Las cookies con `secure: true` no funcionan sobre HTTP (solo HTTPS). Cuando el dashboard se sirve por LAN sin SSL, `cookieOptions(req)` detecta el protocolo real de la request (`req.url.startsWith('https')`) en vez de confiar en `NODE_ENV`.

---

## 5. Panel de Administración (`/admin`)

### Acceso
Solo usuarios con `role === 'admin'`. Si no eres admin, te redirige a `/produccion`.

### Pestañas

El panel tiene cuatro pestañas: **Usuarios**, **Roles**, **Pantallas** y **Estados JDE**.

#### Pestaña Usuarios
1. **Crear usuario:** Formulario con campos Nombre, Apellido, Usuario (login), Contraseña, Rol (dropdown dinámico desde BD), Planta por defecto (dropdown desde `lib/plants.ts` — "Todas" + las 4 plantas), checkbox "Forzar cambio de contraseña"
2. **Listar usuarios:** Tabla con ID, Nombre completo, Usuario, Rol (badge), Planta, Fecha creación
3. **Editar usuario:** Botón lápiz azul → fila editable (nombre, apellido, usuario, rol, planta por defecto). Valida unicidad del username (409 inline)
4. **Resetear contraseña:** Botón llave ámbar → input inline → nueva contraseña + fuerza cambio en próximo login
5. **Eliminar usuario:** Con confirmación. No permite auto-eliminación.

#### Pestaña Roles
1. **Listar roles:** Tabla con ID, Nombre interno, Label, Acciones
2. **Crear rol:** Formulario con Nombre (se normaliza a minúsculas+guiones bajos, sin caracteres especiales) + Label visible
3. **Eliminar rol:** Botón deshabilitado para `admin`. Al borrar un rol, los usuarios que lo tenían asignado pasan automáticamente a `user`

#### Pestaña Pantallas
Para cada pantalla del dashboard:
- Radio **Pública** / **Restringida** (`is_public`)
- Si restringida: checkboxes de roles con acceso
- Botón **Guardar** por pantalla → `PUT /api/admin/screens/:key`
- La pantalla `admin` no es editable (siempre solo accesible para `admin`)

#### Pestaña Estados JDE
Edición de las descripciones de los códigos `F47011.SYEDSP` que se muestran en `/comparativa-seres` (badge tooltip, columna "Descripción" y export Excel).

- Tabla con los 4 códigos sembrados (`Y`, `M`, `N`, `E`) — no se pueden añadir ni borrar nuevos códigos desde aquí, solo editar el texto.
- Input por fila con la descripción + botón **Guardar** que se habilita solo si el texto ha cambiado respecto al guardado.
- Persistencia en SQLite (tabla `jde_status_descriptions`). El seed inicial es idempotente (`INSERT OR IGNORE`), por lo que las ediciones manuales **no se sobreescriben** en futuros despliegues.
- Cuando el admin guarda un cambio, el panel `/comparativa-seres` lo verá la próxima vez que se cargue (hace `fetch('/api/jde-statuses')` al montar).

#### Pestaña Coste real (Costes)
Mapeo mes → código de ledger `IELEDG` de `F30026` (mismo `IECOST='A1'` que el coste teórico, coste real mensual JDE) usado por `/costes` para ponderar el coste real por producción — ver `docs/costes.md` §3.4.

- JDE genera un código `IELEDG` nuevo cada mes (ej. `'6M'` = enero 2026) sin fórmula deducible — hay que consultar `F30026` y añadirlo aquí cada vez que aparezca un mes nuevo.
- Formulario **Añadir mes** (selector `<input type="month">` + código) y tabla de meses ya configurados, cada uno editable (input + botón **Guardar**) y borrable.
- Persistencia en SQLite (tabla `coste_a1_coledg_mensual`, `mes` 'YYYY-MM' como clave primaria). Sin seed inicial — vacía hasta que el admin la rellene.
- Un mes del rango de `/costes` sin código configurado aquí se ignora en el cálculo (no bloquea el resto) y se reporta en `meta.mesesSinConfigurar` de la respuesta de la API.

### APIs de administración

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/admin/users` | Lista todos los usuarios |
| POST | `/api/admin/users` | Crea usuario. Rol validado contra tabla `roles`. 409 si username duplicado |
| PUT | `/api/admin/users/:id` | Edita datos (nombre, apellido, username, rol, planta por defecto). 409 si username duplicado |
| PATCH | `/api/admin/users/:id` | Resetea contraseña (fuerza cambio en próximo login) |
| DELETE | `/api/admin/users/:id` | Elimina usuario (no permite auto-eliminación) |
| GET | `/api/admin/roles` | Lista todos los roles |
| POST | `/api/admin/roles` | Crea rol (`name` + `label`). Nombre normalizado automáticamente |
| DELETE | `/api/admin/roles/:id` | Elimina rol. Bloqueado para `admin`. Reasigna usuarios afectados a `user` |
| PUT | `/api/admin/screens/:key` | Actualiza `is_public` y `allowed_roles[]` de una pantalla. Bloqueado para `admin` |
| GET | `/api/admin/jde-statuses` | Lista las descripciones de los códigos SYEDSP (con `updated_at`) |
| PUT | `/api/admin/jde-statuses/:code` | Actualiza la descripción de un código existente. No permite crear ni borrar |
| GET | `/api/jde-statuses` | Lista pública (con sesión) consumida por `/comparativa-seres` |
| GET | `/api/admin/logs` | Logs de consultas con paginación, filtros y estadísticas (ver sección 7) |
| GET | `/api/admin/coste-a1-coledg` | Lista el mapeo mes→código de ledger IELEDG (F30026, con `updated_at`) |
| POST | `/api/admin/coste-a1-coledg` | Crea un mes nuevo (`mes` 'YYYY-MM' + `coledg`). 409 si el mes ya existe |
| PUT | `/api/admin/coste-a1-coledg/:mes` | Actualiza el código de un mes existente |
| DELETE | `/api/admin/coste-a1-coledg/:mes` | Elimina el mapeo de un mes |

---

## 5b. Sistema de Roles y Permisos por Pantalla

### Concepto

El admin puede crear roles personalizados (ej: `supervisor`, `operario`) y configurar qué roles pueden acceder a cada pantalla. Las pantallas son **públicas por defecto** — hay que habilitarlas explícitamente como restringidas.

### Regla de acceso

```
canAccess = is_public || role === 'admin' || allowed_roles.includes(role)
```

El rol `admin` siempre tiene acceso a todo, hardcoded en la lógica (no solo en la BD).

### `lib/permissions.ts`

| Función | Descripción |
|---|---|
| `getAllScreensConfig()` | Devuelve `Record<string, ScreenConfig>` con `{ is_public, allowed_roles[] }` para cada pantalla |
| `requireScreenAccess(screenKey)` | Usada en API routes: devuelve `NextResponse` 401/403 si no hay acceso, o `null` si está permitido |

### `GET /api/screen-permissions`

Endpoint **público** (sin autenticación) que devuelve la configuración de todas las pantallas. Lo consumen:
- Cada página del dashboard en su `checkSession` para decidir si redirigir a `/login`
- La `Navbar` para filtrar qué paneles mostrar en el dropdown
- La página `/login` para redirigir al primer panel accesible tras el login
- La página `/` (inicio) para mostrar solo los paneles públicos

Ejemplo de respuesta:
```json
{
  "produccion":  { "is_public": false, "allowed_roles": ["admin", "supervisor"] },
  "pedidos":     { "is_public": true,  "allowed_roles": [] },
  "caducados":   { "is_public": true,  "allowed_roles": [] },
  "comparativa": { "is_public": false, "allowed_roles": ["admin"] },
  "admin":       { "is_public": false, "allowed_roles": ["admin"] }
}
```

### Protección en API routes

Las 7 rutas de datos llevan al inicio de su `GET`:

```ts
import { requireScreenAccess } from '@/lib/permissions'
// ...
const denied = await requireScreenAccess('produccion') // clave correspondiente
if (denied) return denied
```

| Ruta API | Clave |
|---|---|
| `api/production`, `api/categories`, `api/production-lines` | `produccion` |
| `api/orders`, `api/plants` | `pedidos` |
| `api/caducados` | `caducados` |
| `api/comparativa-seres` | `comparativa` |

### Protección en páginas

Cada página de panel incluye en su `checkSession`:

```ts
const screensRes = await fetch('/api/screen-permissions')
const screens = await screensRes.json()
const mine = screens['KEY_DE_LA_PANTALLA']
if (mine && !mine.is_public) {
  if (!user || (user.role !== 'admin' && !mine.allowed_roles.includes(user.role))) {
    router.push('/login')
    return
  }
}
```

### Página de inicio (`/`)

**Comportamiento según sesión:**
- Con sesión activa → redirige automáticamente al primer panel accesible según permisos del rol
- Sin sesión → muestra la página de bienvenida (landing) con dos secciones diferenciadas

**Diseño (Notion/Linear style):**
- Estética minimalista y plana: sin gradientes, sin sombras decorativas
- Tipografía Geist (la única de la app — antes cargaba Inter de Google Fonts aparte, se unificó)
- Estilos con tokens del sistema de diseño (`bg-background`, `bg-card`, `border-border`...), no CSS-in-JSX. Ver [`docs/design-system.md`](docs/design-system.md)

**Sección "Acceso público"** (`Badge variant="success"`):
- Muestra los paneles con `is_public = true`
- Tarjetas con icono ámbar, nombre, descripción y flecha. Al hacer clic → acceso directo al panel
- Grid `auto-fit, minmax(280px, 1fr)`

**Sección "Requiere inicio de sesión"** (`Badge` variante por defecto, con candado):
- Muestra los paneles con `is_public = false`
- Tarjetas atenuadas (`bg-muted`), icono atenuado, candado en esquina superior derecha
- Al hacer clic → redirige a `/login?redirect=<href-del-panel>`
- Grid `auto-fit, minmax(160px, 1fr)` (más compacto que el público)

**Fallback sin paneles:** Si no hay ningún panel (público ni privado) → estado vacío centrado con botón de login

**Estado React:**
```ts
const [publicPanels, setPublicPanels] = useState<typeof PANELS>([])   // is_public = true
const [privatePanels, setPrivatePanels] = useState<typeof PANELS>([]) // is_public = false
```

**Lógica de clasificación:**
```ts
const pub = PANELS.filter(p => screens[p.key]?.is_public ?? true)
const priv = PANELS.filter(p => !(screens[p.key]?.is_public ?? true))
```
Si la API falla (catch), todos los paneles van a `publicPanels` como fallback seguro.

---

## 6. Presets de Filtros

Los usuarios logueados pueden guardar combinaciones de filtros con nombre para reutilizarlos. El sistema es compartido entre paneles, pero **cada panel solo ve sus propios presets** gracias a la columna `screen`.

### Aislamiento por panel

| Panel | Valor `screen` |
|---|---|
| Producción | `'produccion'` |
| Caducados | `'caducados'` |
| Pedidos | `'pedidos'` |
| Comparativa SERES vs JDE | `'comparativa'` |

### Qué se guarda en un preset

El JSON varía según el panel. Ejemplos:

**Producción:**
```json
{
  "plant": "10300", "subLine": "all",
  "startDate": "2026-01-01", "endDate": "2026-03-02",
  "selectedArticles": [], "selectedPrp6": [], "selectedSrp3": [],
  "selectedSrp5": [], "selectedSrp2": [], "selectedSrp1": [],
  "selectedSrp4": [], "selectedZe03": [], "selectedProdLines": []
}
```

**Caducados:**
```json
{
  "type": "bloqueados",
  "selectedLotStates": ["B"], "selectedSrp1": [], "selectedSrp2": [],
  "selectedPlants": ["10100"], "selectedLocations": ["__blank__"],
  "paletSearch": "", "loteSearch": "", "selectedArticles": []
}
```

**Pedidos:**
```json
{
  "filters": { "startDate": "2026-05-01", "endDate": "2026-05-31", "deliveryStartDate": "", "deliveryEndDate": "" },
  "showStatus": { "pendiente": true, "en_progreso": true, "completado": false },
  "selectedArticles": ["0001234567"],
  "selectedDestinos": ["1234"],
  "selectedDestinoMlnm": [],
  "selectedFamilia": ["01"],
  "pedidoSearch": "",
  "refClienteSearch": ""
}
```

**Comparativa SERES vs JDE:**
```json
{
  "days": 7,
  "selectedDestinoMlnm": ["CLIENTE A", "CLIENTE B"]
}
```

### UI de presets

Tres formas de interactuar, disponibles en los **4 paneles por igual** (ver `docs/design-system.md` — es una regla explícita del sistema de diseño, no una opción por panel):

1. **Panel expandible (botón "Guardar"/"Presets" en la barra de filtros):** Lista completa de presets con opción de guardar, editar y eliminar.
2. **Acceso rápido en la barra de acciones:** `<PresetQuickSelect>` — dropdown "Cargar preset" para carga inmediata sin abrir el panel.
3. **Botón "Presets" en la Navbar superior:** Cada `page.tsx` incrementa una señal `presetsSignal` que un `useEffect` observa para hacer `setShowPresets(true)`.

`produccion` implementa las tres dentro de `FilterPanel` (con su propio estado, no usa el componente `PresetPanel` compartido). `caducados`, `pedidos` y `comparativa-seres` usan `usePresets` + `PresetPanel` + `PresetQuickSelect` de `components/PresetPanel.tsx`.

### APIs de presets

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/presets?screen=<panel>` | Lista presets del usuario para ese panel (`produccion` por defecto) |
| POST | `/api/presets` | Guarda nuevo preset (body: `{ name, filters, screen }`) |
| PUT | `/api/presets/:id` | Actualiza nombre y filtros de un preset existente |
| DELETE | `/api/presets/:id` | Elimina preset propio |

### Añadir presets a un nuevo panel

1. En el `GET` del componente: `fetch('/api/presets?screen=nuevo_panel')`
2. En el `POST`: incluir `screen: 'nuevo_panel'` en el body
3. Los presets del nuevo panel no interferirán con los de otros paneles

---

## 7. Sistema de Logs de Consultas

### Qué se registra

Cada vez que un usuario (o invitado) consulta datos o inicia sesión, se inserta un registro en `query_logs`. Esto permite al admin ver:

- **Quién** consulta (username o "Invitado" si no hay sesión)
- **Qué** filtros usó (JSON completo)
- **Cuántos** resultados obtuvo
- **Cuánto** tardó la consulta (ms)
- **Desde qué panel** (`source`: `produccion`, `login`, futuros paneles)

### Dónde se registra

| Archivo | Source | Qué registra |
|---|---|---|
| `app/api/production/route.ts` | `produccion` | Cada consulta de datos (con o sin resultados) |
| `app/api/auth/login/route.ts` | `login` | Cada inicio de sesión exitoso |
| `app/api/caducados/route.ts` | `caducados_obsoletos` | Cada consulta de palets caducados/obsoletos/bloqueados |
| `app/api/comparativa-seres/route.ts` | `comparativa_seres` | Cada comparativa SERES vs JDE ejecutada |
| `app/api/orders/route.ts` | `pedidos` | Cada consulta del panel de preparación de pedidos |

El logging nunca bloquea la respuesta: se ejecuta en un `try/catch` independiente. Si falla el INSERT, se logea el error en consola pero el usuario recibe su respuesta normalmente.

### Detección de usuario

```ts
const user = await verifySession().catch(() => null);
// user !== null → usuario logueado → se guarda user.username
// user === null → invitado → se guarda 'Invitado'
```

### API de logs — `GET /api/admin/logs`

**Archivo:** `app/api/admin/logs/route.ts`

Protegido con `verifySession()` + `role === 'admin'`.

**Parámetros:**

| Param | Tipo | Descripción |
|---|---|---|
| `page` | number | Página (50 registros por página) |
| `startDate` | string | Filtro desde fecha (YYYY-MM-DD) |
| `endDate` | string | Filtro hasta fecha (YYYY-MM-DD) |
| `username` | string | Filtro por usuario exacto |
| `source` | string | Filtro por panel (produccion, login, caducados_obsoletos…) |
| `chartDays` | number | Días del gráfico de actividad (7, 14, 30, 90). Por defecto: 14 |

**Respuesta:**

```json
{
  "logs": [...],           // registros paginados
  "total": 150,            // total de registros
  "page": 1,
  "totalPages": 3,
  "usernames": ["admin", "Invitado", "juan"],  // para dropdown de filtro
  "stats": {               // estadísticas (excluyendo logins)
    "totalQueries": 120,
    "avgTime": 345,
    "maxTime": 2100,
    "minTime": 50,
    "avgResults": 87
  },
  "dailyStats": [          // últimos N días según chartDays (para gráfico)
    { "day": "2026-03-01", "queries": 15, "avgTime": 300, "uniqueUsers": 3 }
  ],
  "topUsers": [            // top 5 usuarios autenticados (excluye Invitado y logins)
    { "username": "admin", "queries": 87 }
  ],
  "invitadoCount": 33      // total de consultas anónimas (sin login)
}
```

### Página de logs — `/admin/logs`

**Archivo:** `app/admin/logs/page.tsx`

Solo accesible para admins. Se accede desde:
- Botón "Logs" en el panel de administración (`/admin`)
- Botón "Logs" en la barra de sesión del dashboard (`/produccion`, solo admins)

**Componentes visuales:**

1. **4 tarjetas de estadísticas:** Consultas totales, Tiempo medio, Tiempo máximo, Resultados medio
2. **Gráfico de líneas (recharts):** Toggle con botón "Ver gráfico"/"Ocultar gráfico". Muestra consultas y tiempo medio por día con dos ejes Y (consultas izquierda, tiempo derecha). Selector de rango: 7 / 14 / 30 / 90 días.
3. **Ranking de usuarios:** Tarjeta con top 5 usuarios autenticados por nº de consultas + contador de consultas anónimas (Invitado)
4. **Filtros:** Usuario (dropdown), Panel/fuente (dropdown), Fecha desde, Fecha hasta, botones Filtrar/Limpiar
5. **Tabla de logs:** Fecha/Hora, Usuario, Panel (badge con color), Filtros (resumen), Resultados, Tiempo. Las filas con tiempo > 3 segundos se resaltan en rojo.
6. **Exportación Excel:** Botón "Exportar Excel" descarga todos los logs filtrados actuales
7. **Paginación:** Anterior/Siguiente con indicador de página

**Detalles de implementación:**
- `SLOW_QUERY_MS = 3000` — umbral para resaltado de consultas lentas (rojo)
- Los logins se resaltan con fondo azul claro y icono LogIn
- La columna "Panel" muestra badges con colores según el source (`SOURCE_LABELS`)
- `summarizeFilters()` convierte el JSON de filtros en un resumen legible (ej: "Aguilar · 01/03 - 02/03 · 3 filtros"). También maneja filtros específicos de caducados (type, location).
- Las estadísticas, gráfico y ranking excluyen entradas de login (solo consultas reales)

### Pestaña "Confirmaciones PDA" (`/admin/logs`)

Segunda pestaña de la misma página (`<Tabs>`, junto a "Consultas"), con su propio estado y su
propia API — no reutiliza `query_logs`. Lista el registro de aceptación del pop-up obligatorio de
`/consulta-stock-pda` (ver `docs/consulta-stock-pda.md` §8.2): quién aceptó qué aviso, con qué SSCC
y cuándo — trazabilidad si un producto se mete erróneamente en línea.

- **Archivo:** mismo `app/admin/logs/page.tsx`, tabla `stock_scan_confirmations`.
- **API:** `GET /api/admin/scan-confirmations` (`app/api/admin/scan-confirmations/route.ts`) — paginada, filtros por usuario, resultado (correcto/aviso/no_encontrado/sin_fecha/otra_subplanta), SSCC (parcial) y rango de fechas. Solo admin.
- **Tabla:** Fecha/Hora, Usuario, SSCC completo, Artículo, Resultado aceptado (badge de color + los mensajes exactos que vio el operario).
- No comparte filtros, paginación ni contador de página con la pestaña "Consultas" — son datasets independientes.

### Persistencia

Los logs se almacenan en `data/app.db` (SQLite), igual que usuarios y presets. No se pierden al hacer `git pull`, `bun install` o `bun run build`.

### Extensibilidad — Nuevos paneles

Al crear un nuevo panel (ej: ventas), basta con:
1. Añadir el INSERT en la ruta API del nuevo panel con `source: 'ventas'`
2. Añadir la etiqueta en `SOURCE_LABELS` en `admin/logs/page.tsx`
3. Los logs aparecerán automáticamente en la página de logs con su badge identificativo

---

## 8. Carpeta `lib/` — Utilidades Base

### `lib/db.ts` — Conexión a Oracle

**Qué hace:** Exporta una función `getDbConnection()` que devuelve una conexión activa a Oracle.

**Configuración global:**
- `oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT` → Las filas vienen como objetos `{ COLUMNA: valor }`. Columnas siempre en **MAYÚSCULAS**.

**Regla de oro:** Siempre usar `try/finally` para cerrar la conexión.

```ts
let conn;
try {
    conn = await getDbConnection();
    const result = await conn.execute(sql);
} finally {
    if (conn) await conn.close();
}
```

### `lib/utils.ts` — Funciones auxiliares

#### `cn(...inputs)` — Combinar clases CSS

Mezcla de `clsx` + `tailwind-merge`.

#### `parseJdeDate(jdeDate, wamcu?)` — Convertir fecha JDE

JDE guarda fechas como **CYYDDD**: C=sub-línea, YY=año, DDD=día del año.

Ejemplo: `126061` → sub-línea `1`, año `26` (2026), día `61` → `{ date: 2026-03-02, subBlock: '1', subBlockName: 'Aguilar' }`

El parámetro `wamcu` personaliza los nombres de sub-línea según planta (10100=Aguilar, 10200=Corella, 10300=Funes 1/2/Past).

#### `parseWasOqs(val)` — Convertir cantidad JDE

Divide entre 100 (JDE almacena cantidades ×100).

#### `getDayOfYear(date)` — Día del año

Devuelve el día del año (1-366) para una `Date`. Equivalente nativo a `getDayOfYear` de `date-fns`, sin dependencia externa. Usado en las rutas API que construyen fechas JDE para filtrar consultas Oracle.

### `lib/reflex.ts` — Conexión a SQL Server (Reflex)

**Qué hace:** Exporta `getReflexConnection()`, análoga a `getDbConnection()` de `lib/db.ts` pero para la BD externa de almacén **Reflex** (SQL Server, vía driver `mssql`). Credenciales `REFLEX_*` desde `.env.local`; lanza error claro si falta alguna. Misma regla de oro: `try/finally` para cerrar la conexión (`conn.close()`).

Única fuente de datos del proyecto que no es Oracle/JDE. Usada solo por el panel `/consulta-stock-pda` — esquema de tablas y JOINs documentado en [docs/consulta-stock-pda.md](docs/consulta-stock-pda.md).

### `lib/gs1.ts` — Parser de códigos de barras GS1-128

**Qué hace:** Exporta `parseGs1(rawInput)`, que separa un código de barras de palet (GS1-128) en sus campos logísticos (EAN, lote, cantidad, SSCC, fechas). Soporta formato crudo (con separador FNC1) y formato legible entre paréntesis, además de EAN-13/DUN-14 sueltos sin envoltorio de AIs.

Usado solo por `/consulta-stock-pda`. Detalle de los Application Identifiers soportados y casos límite en [docs/consulta-stock-pda.md](docs/consulta-stock-pda.md); tests en `__tests__/gs1.test.ts`.

---

## 9. Paneles de la aplicación

Cada panel tiene su documentación específica en la carpeta `docs/`:

| Panel | Ruta | Documentación |
|---|---|---|
| Dashboard de producción | `/produccion` | [docs/produccion.md](docs/produccion.md) |
| Control de pedidos | `/preparacion-pedidos` | [docs/control-pedidos.md](docs/control-pedidos.md) |
| Palets caducados/obsoletos/bloqueados | `/caducados` | [docs/palets-caducados.md](docs/palets-caducados.md) |
| Comparativa SERES vs JDE | `/comparativa-seres` | [docs/seres-jde-comparativa.md](docs/seres-jde-comparativa.md) |
| Consulta de stock por escaneo (FEFO, Reflex) | `/consulta-stock-pda` | [docs/consulta-stock-pda.md](docs/consulta-stock-pda.md) |
| Compras (previsión de ventas vs. venta real, rediseño sobre sistema Nova) | `/compras` | [docs/compras.md](docs/compras.md) |
| Explosión de compras (MRP) | `/mrp` | [docs/mrp.md](docs/mrp.md) |
| Coste A1 y despiece recursivo de materiales (sistema Nova) | `/costes` | [docs/costes.md](docs/costes.md) |
| Control de muestras (pendiente/enviado/completado) | `/muestras` | [docs/muestras.md](docs/muestras.md) |
| Loteadora | `/loteadora` | [docs/loteadora.md](docs/loteadora.md) |

### API externa — `GET /api/jde-orders`

> **No confundir con `/api/orders`:** ese endpoint consulta `F4211` (pedidos de venta) y es el que usa el panel `/preparacion-pedidos` con sesión JWT. Este endpoint consulta `F47011` (pedidos EDI entrantes) y está pensado para herramientas externas.

Endpoint diseñado para ser consumido desde herramientas externas (artefactos Claude, scripts) que no pueden usar cookies JWT. Devuelve pedidos recibidos vía EDI de la tabla **F47011** de JDE.

**Autenticación:** Header `x-api-key` con el valor de `SERES_API_KEY` en `.env.local`.

**CORS:** Abierto (`Access-Control-Allow-Origin: *`) para permitir llamadas desde artefactos que corren en el navegador del usuario.

**Parámetros:**

| Param | Tipo | Descripción |
|---|---|---|
| `days` | number | Días hacia atrás a consultar (por defecto: 7, máximo: 90) |

**Respuesta:**
```json
[
  { "referencia": "PED-001234", "fecha": "2025-04-28" },
  { "referencia": "PED-001235", "fecha": "2025-04-29" }
]
```

**Campos devueltos:** `referencia` (SYVR01 trimado) y `fecha` (SYUPMJ convertido de CYYDDD a ISO).

---

## 10. Componentes reutilizables (`components/`)

> **Sistema de diseño:** para tokens de color, reglas de estilo y el checklist de cómo montar un panel nuevo, ver [`docs/design-system.md`](docs/design-system.md) — es la referencia obligatoria, esta sección solo documenta la API de cada componente.

### `AppShell.tsx` — `AppShell` y `PageHeader`

Contenedor de página unificado. Sustituye al `<main className="min-h-screen bg-gray-100 p-8">` + `<div className="mx-auto max-w-7xl">` que antes repetía cada panel con su propio ancho máximo (`max-w-7xl`/`5xl`/`4xl` según la página).

**Props de `AppShell`:**

| Prop | Tipo | Descripción |
|---|---|---|
| `navbar` | Props de `<Navbar>` | Se reenvían tal cual (`currentPanel`, `user`, `onLogout`, `onPresetsClick?`) |
| `title` | `string` (opcional) | Si se pasa, renderiza `<PageHeader>` con el título de la sección |
| `description` | `string` (opcional) | Subtítulo bajo el título |
| `actions` | `ReactNode` (opcional) | Nodo a la derecha del título (ej. un botón) |
| `width` | `"default" \| "narrow"` | `"default"` = `max-w-7xl` (paneles de datos), `"narrow"` = `max-w-4xl` (formularios/admin) |

`PageHeader` se exporta también de forma independiente para casos donde no se use `AppShell` completo.

### `KpiCard.tsx`

Tarjeta de métrica (borde superior rojo corporativo vía `Card accent`, icono, valor y caption). Sustituye a las cards KPI repetidas inline en cada panel.

**Props:** `title`, `icon?` (componente de lucide-react), `iconClassName?` (color del icono; por defecto `text-primary` — usar para iconos con semántica de estado, ej. verde/ámbar), `value?`, `caption?`, `children?` (para cuerpos con más de una línea o color condicional — sustituye a `value`/`caption`).

### `PresetPanel.tsx` — `PresetPanel`, `PresetQuickSelect`, `usePresets`

Sistema de presets compartido por los paneles con presets (`caducados`, `preparacion-pedidos`, `comparativa-seres`; `produccion` mantiene su propia variante integrada en `FilterPanel`). Antes estaba duplicado (con pequeñas divergencias que eran bugs latentes) en cada página. **`/compras` (sobre Nova) no tiene filtros ni presets conectados todavía** — la versión anterior sí los tenía; ver `docs/compras.md` §10 y la nota sobre "Presets" en el dropdown de perfil de `components/nova/README.md`.

- **`usePresets(screen)`** — hook que hace el `fetch('/api/presets?screen=...')` y expone `{ presets, reload }`. Se llama **una vez por página** y su resultado se reparte a los otros dos componentes, para que ambos vean siempre la misma lista sin fetches duplicados ni desincronización tras guardar/borrar.
- **`PresetPanel`** — panel "Mis Presets de Filtros" (guardar/editar/listar/borrar). Props: `screen`, `presets`, `onReload` (del hook), `open`, `onClose`, `getFilters()` (serializa el estado de filtros actual), `applyFilters(filters)` (restaura cada filtro con sus defaults), `hint?`, `dateFields?` (nombres de campos de fecha; si se pasan, añade el checkbox "Incluir fechas" — ver `docs/design-system.md` §5). Gestiona guardar/editar (`toast` de éxito/error) y borrado con `ConfirmDialog` de confirmación (antes era un borrado inmediato sin confirmar); llama a `onReload()` tras cada cambio.
- **`PresetQuickSelect`** — desplegable de carga inmediata en la barra de acciones (junto a Filtrar/Excel/Limpiar), para cargar un preset sin abrir el panel completo. Props: `presets`, `onSelect(preset)`. No renderiza nada si no hay presets guardados.

Cada panel debe montar los tres juntos — ver el checklist de [`docs/design-system.md`](docs/design-system.md#5-componentes-de-panel-components) para el patrón completo.

### `Navbar.tsx`

Barra de navegación compartida por todos los paneles. Reemplaza el top bar duplicado que había en cada página.

**Props:**

| Prop | Tipo | Descripción |
|---|---|---|
| `currentPanel` | `PanelKey` (de `lib/panels.ts`, opcional) | Panel activo (se marca con punto rojo en el dropdown). Se omite en páginas que usan `Navbar`/`AppShell` pero no son uno de los paneles reales (ej. `/admin/logs`) — así no marcan ninguno como activo |
| `user` | `SessionUser \| null` | Usuario de sesión. Si es null, muestra botón "Iniciar sesión" |
| `onLogout` | `() => void` | Callback para cerrar sesión |
| `onPresetsClick` | `() => void` (opcional) | Si se pasa, aparece el botón "Presets". Lo wirean los paneles con presets (`/produccion`, `/preparacion-pedidos`, `/caducados`, `/comparativa-seres`) sólo con sesión activa. `/compras` (Nova) no usa `Navbar`/`AppShell` y no tiene presets conectados todavía — ver `docs/compras.md` §10 |

**Comportamiento:**
- Logo a la izquierda
- Botón **"Paneles ▾"** con dropdown filtrado según permisos: solo muestra los paneles a los que el usuario actual tiene acceso. Si no hay ninguno accesible, el botón se oculta.
- Botón "Presets" visible en los paneles con presets cuando hay sesión. Al pulsarlo, cada panel incrementa una señal interna (`presetsSignal`) que abre su propio panel/modal de presets. Los presets están aislados por `screen` (`produccion`, `pedidos`, `caducados`, `comparativa`, `compras`)
- Con sesión: nombre del usuario, botones Admin y Logs (solo si `role === 'admin'`), botón Salir
- Sin sesión: enlace "Iniciar sesión"

La Navbar obtiene la configuración de pantallas de `GET /api/screen-permissions` en un `useEffect` al montarse. Usa la misma función `canAccessPanel()` que las páginas para decidir qué mostrar.

**Añadir un nuevo panel al dropdown:** añadir una entrada a `PANELS` en `lib/panels.ts` — **no** en `Navbar.tsx` directamente. Es la fuente única que también usan la portada (`app/page.tsx`), el login (`app/login/page.tsx`) y `SCREEN_KEYS` de `app/admin/page.tsx`; ver `docs/design-system.md` §5.1 para el porqué (dos bugs reales salieron de tener esta lista copiada en cada sitio).

### `FilterPanel.tsx`

Panel de filtros del dashboard de producción. Ver [docs/produccion.md](docs/produccion.md).

### `DatePicker.tsx`

Wrapper fino sobre `<input type="date">` nativo del navegador. Devuelve y recibe fechas en formato `YYYY-MM-DD`, que es el formato nativo del input — no se necesita ninguna conversión.

**Props:**

| Prop | Tipo | Descripción |
|---|---|---|
| `value` | `string` | Fecha seleccionada en formato `YYYY-MM-DD` (vacío = sin selección) |
| `onChange` | `(value: string) => void` | Callback al cambiar la fecha. Devuelve `YYYY-MM-DD` o `''` al limpiar |
| `placeholder` | `string` | Reservado para compatibilidad de API (el input nativo no lo usa) |
| `className` | `string` | Clases CSS adicionales (ej: `w-[150px]`) |

**Comportamiento:**
- El navegador renderiza su propio picker nativo (varía según OS/browser)
- Al limpiar la fecha, el input devuelve `''` y `onChange` recibe `''`
- Sin dependencias externas de calendario

**Usado en:**
- `components/FilterPanel.tsx` — fechas inicio/fin del dashboard de producción
- `app/preparacion-pedidos/page.tsx` — fechas carga y entrega del panel de pedidos
- `app/admin/logs/page.tsx` — filtros de fecha en los logs de consultas

### `components/ui/popover.tsx`

Componente `Popover` / `PopoverTrigger` / `PopoverContent` estilo shadcn/ui basado en `@radix-ui/react-popover`. `PopoverContent` renderiza en Portal para garantizar z-index correcto sobre cualquier elemento. Lo usa `MermaCellPopover` (y lo usaba la tarjeta KPI de Kg de la versión anterior de `/compras`, ver `docs/compras-v1-historico.md` §13.1 — el `/compras` actual usa el `Popover` propio del sistema Nova, `components/nova/ui/popover.tsx`, no este).

### `ArticleMultiSelect.tsx`

Desplegable multi-selección con búsqueda. Ver [docs/produccion.md](docs/produccion.md).

### `MermaBreakdown.tsx`

Tabla puramente visual que muestra el desglose de merma agrupado en dos bloques: Etiquetado (códigos `Q*`) y Pasteurizado (códigos `P*`), con subtotales por bloque. Recibe `codes` (lista con `{code, description, group, qty, percent}`) y `total`. Reutilizado por la card global en `/produccion` y por el popover por fila. Detalles en [docs/produccion.md sección 16](docs/produccion.md).

### `MermaCellPopover.tsx`

Envuelve la celda Merma de cada fila en la tabla de `/produccion`. Al abrirse, hace fetch on-demand a `/api/production/merma-breakdown?mode=row` con los filtros vigentes + parámetros de la fila (`order`, `productionDateRaw`, `rowArticle`). Si la fila no tiene merma o la tabla está en modo agrupar-por-artículo, la celda no es clicable. Ver [docs/produccion.md sección 16](docs/produccion.md).

### `SingleSelect.tsx`

Variante de `ArticleMultiSelect` para selección única. Mismo estilo visual (buscador interno, layout código+descripción, mismo botón trigger) pero solo permite seleccionar una opción a la vez. Props: `options`, `value`, `onChange`, `label`, `allLabel`, `showId`. La opción especial `id: 'all'` representa "sin filtro". Usado internamente en el panel de caducados.

### Componentes UI base (`components/ui/`)

| Componente | Descripción |
|---|---|
| `button.tsx` | Botón con variantes (default, outline, ghost, destructive, secondary, link) |
| `card.tsx` | Card, CardHeader, CardTitle, CardContent. `Card` acepta la prop `accent` (borde superior de 3px en `primary` + `overflow-hidden`) — reemplaza al `style={{borderTop:'3px solid #D30B15'}}` que se repetía en cada tarjeta |
| `input.tsx` | Input estilizado |
| `popover.tsx` | Popover / PopoverTrigger / PopoverContent (Radix UI con Portal) |
| `table.tsx` | Table, TableHeader, TableBody, TableRow, TableHead, TableCell |
| `badge.tsx` | Badge — etiqueta de estado/categoría. Variantes: `default`, `primary`, `success`, `warning`, `destructive`, `info`, `outline` |
| `skeleton.tsx` | Bloque de carga con pulso, para contenido que no es tabla |
| `spinner.tsx` | Indicador de carga unificado (`<Spinner label="..." />`), sustituye a `<Loader2 className="animate-spin">` suelto |
| `empty-state.tsx` | Estado vacío unificado (`icon`, `title`, `description`, `action?`) para tablas y paneles sin resultados |
| `dialog.tsx` | `Dialog` (modal sobre `<dialog>` nativo, sin dependencias nuevas) y `ConfirmDialog` (confirmación de acciones destructivas — sustituye a `confirm()` nativo) |
| `toast.tsx` | `ToastProvider` (montado una vez en `app/layout.tsx`) y el hook `useToast()` — sustituye a `alert()` en toda la app |
| `tabs.tsx` | `Tabs` — barra de pestañas accesible (ARIA, navegación con flechas, contador opcional). Usada en `/admin` y `/comparativa-seres` |

---

## 11. Gotchas y Patrones Importantes

### Oracle CHAR vs VARCHAR2

El driver `oracledb` envía bind variables como VARCHAR2. Los campos CHAR tienen padding de espacios y no coinciden.

- Valores **hardcodeados**: embeber en SQL directamente
- Valores **del usuario**: usar `TRIM()` en la columna + bind variables

### Fechas JDE (CYYDDD)

Usar `parseJdeDate()`. Para convertir a JDE: `(year - 2000) * 1000 + getDayOfYear(date)` donde `getDayOfYear` se importa desde `@/lib/utils`.

#### Conversión en TypeScript (frontend / API)

```ts
// parseJdeDate(jdeDate, wamcu?) en lib/utils.ts
const str = jdeDate.toString().padStart(6, '0');
const yearShort = parseInt(str.substring(1, 3), 10); // dígitos 1-2
const dayOfYear = parseInt(str.substring(3), 10);    // dígitos 3-5
const date = new Date(2000 + yearShort, 0, dayOfYear);
```

#### Conversión en SQL Oracle (consultas directas)

Usar `YYYYDDD` con `TO_DATE` — Oracle interpreta `DDD` como día del año y gestiona bisiestos automáticamente. Proteger siempre con `CASE` para valores `NULL` o `0`:

```sql
CASE WHEN campo_fecha IS NULL OR campo_fecha = 0 THEN NULL
     ELSE TO_CHAR(
         TO_DATE(
             TO_CHAR(2000 + MOD(FLOOR(campo_fecha / 1000), 100), '0000')
             || LPAD(MOD(campo_fecha, 1000), 3, '0'),
             'YYYYDDD'
         ), 'DD/MM/YYYY')
END AS fecha_legible
```

Ejemplo con `SDPDDJ` (fecha de carga) e `IOMMEJ` (fecha de caducidad):

```sql
CASE WHEN f.SDPDDJ IS NULL OR f.SDPDDJ = 0 THEN NULL
     ELSE TO_CHAR(
         TO_DATE(
             TO_CHAR(2000 + MOD(FLOOR(f.SDPDDJ / 1000), 100), '0000')
             || LPAD(MOD(f.SDPDDJ, 1000), 3, '0'),
             'YYYYDDD'
         ), 'DD/MM/YYYY')
END AS FECHA_CARGA,
CASE WHEN l.IOMMEJ IS NULL OR l.IOMMEJ = 0 THEN NULL
     ELSE TO_CHAR(
         TO_DATE(
             TO_CHAR(2000 + MOD(FLOOR(l.IOMMEJ / 1000), 100), '0000')
             || LPAD(MOD(l.IOMMEJ, 1000), 3, '0'),
             'YYYYDDD'
         ), 'DD/MM/YYYY')
END AS FECHA_CADUCIDAD
```

> **Por qué `CASE WHEN = 0`:** registros sin fecha definida en JDE almacenan `0`, lo que generaría año `0000` y lanzaría `ORA-01841`.

### Cantidades JDE (×100) y Conversiones UM (×10.000.000)

Siempre dividir. Las cantidades vienen ×100. Los factores de conversión ×10.000.000.

### `"use client"` vs Server Components

- `"use client"` → navegador (hooks, eventos)
- Sin directiva → servidor
- API routes → siempre servidor

### Conexiones Oracle — siempre cerrar

Si no cierras con `try/finally`, el pool se agota y la app se cuelga.

### Prevención de SQL Injection

- Valores del usuario → bind variables (`:param`)
- Artículos → validados con regex `/^\d{10}$/`
- Valores del FIELD_MAP → embebidos (constantes del código)

### Accesibilidad (WCAG / Lighthouse)

Los componentes compartidos y páginas siguen estas convenciones para pasar la auditoría de accesibilidad:

- **`ArticleMultiSelect`:** el `<Button>` combobox lleva `aria-label="Filtrar por {label}"`. El input de búsqueda lleva `aria-label="Buscar {label}"`. Los botones de acción ("Sel. todos", "Ninguno") llevan `type="button"` y `aria-label` explícito.
- **`FilterPanel`:** todos los `<Input>` y `<select>` llevan `id` con prefijo `filter-` y el `<label>` correspondiente usa `htmlFor`. Los botones icono (cerrar presets, editar/eliminar preset) llevan `aria-label` dinámico.
- **Páginas de panel:** el elemento raíz del contenido es `<main>` (lo aporta `AppShell`, no un `<div>` suelto). Todos los botones de navegación llevan `type="button"`. Iconos decorativos llevan `aria-hidden="true"`.
- **Color de texto secundario:** el token `text-muted-foreground` (`#6B7280`) cumple el ratio de contraste WCAG AA sobre `bg-background`/`bg-card` — es el que hay que usar para texto atenuado, nunca un gris más claro suelto.

### Sistema de tokens de color

Todos los colores (incluido el corporativo `#D30B15` → token `primary`) viven en `@theme inline` dentro de `app/globals.css`, no hardcodeados en cada página. Ver [`docs/design-system.md`](docs/design-system.md) para la tabla completa de tokens y las reglas de uso.

### Cookie `secure` en LAN

No usar `secure: process.env.NODE_ENV === 'production'`. En su lugar, `cookieOptions(req)` detecta HTTPS desde la URL real de la request.

### `serverExternalPackages` en next.config.ts

`better-sqlite3` es un módulo nativo. Sin `serverExternalPackages: ['better-sqlite3']`, el build de producción falla.

---

## 12. Cómo Arrancar el Proyecto

```bash
# 1. Instalar dependencias
cd dashboard
bun install

# 2. Configurar credenciales (copiar y editar)
cp .env.local.example .env.local

# 3. Desarrollo (hot reload)
bun dev
# Abrir http://localhost:3000

# 4. Producción
bun run build
bun start
```

### Primer acceso

1. Ir a `/login` → usuario `admin`, contraseña `admin123`
2. Ir a `/admin` → crear usuarios con nombre, apellido y contraseña
3. La base de datos SQLite (`data/app.db`) se crea automáticamente al arrancar
4. `data/` está en `.gitignore` → los usuarios y presets **no se pierden** al hacer `git pull`

### Despliegue en servidor

- `data/app.db` persiste entre despliegues (no se sube a Git, no se sobreescribe)
- Si necesitas reiniciar usuarios: eliminar `data/app.db` y se recreará con el admin por defecto

---

## 13. Tests de Seguridad

### Ejecutar

```bash
bun test           # ejecutar todos los tests
bun test --watch   # modo watch (re-ejecuta al guardar)
```

### Archivos

```
__tests__/
  middleware.test.ts     ← Seguridad JWT del middleware /api/admin/*
  sanitization.test.ts   ← Sanitización de entradas (SQL injection, XSS)
  permissions.test.ts    ← Sistema de permisos por pantalla (requireScreenAccess)
  admin-guards.test.ts   ← Reglas de protección del panel de administración
```

### Qué cubre cada archivo

**`middleware.test.ts`** (11 tests) — Ataques contra el JWT de `/api/admin/*`:
- Sin cookie, token inválido, texto no JWT → 401
- JWT firmado con secreto incorrecto → 401
- JWT expirado aunque tenga rol `admin` → 401
- Payload manipulado para forjar rol `admin` → 401 (la firma no coincide)
- Algoritmo `"none"` (bypass clásico de JWT) → 401
- Rol `user` o `supervisor` con JWT válido → 403
- Admin con JWT válido → pasa (200)

**`sanitization.test.ts`** (18 tests) — Función de limpieza de nombres de rol:
- SQL injection clásica (`'; DROP TABLE roles; --`) → solo `[a-z0-9_]`
- UNION SELECT, OR 1=1, comentarios `--`
- XSS (`<script>`, `onerror=`)
- Rutas de sistema (`../../../etc/passwd`), null bytes, unicode, emojis
- Cadenas muy largas (10.000 chars)

**`permissions.test.ts`** (22 tests) — `requireScreenAccess` y `getAllScreensConfig`:
- Pantalla pública → `null` sin sesión
- Clave desconocida → `null` (pasa sin restricción)
- Pantalla privada sin sesión → 401
- Pantalla privada con rol incorrecto → 403
- Pantalla privada con rol correcto → `null`
- Rol `admin` → siempre `null` (bypass garantizado)
- Inyección SQL en la clave de pantalla → tratada como literal (no hay esa pantalla → `null`)
- `getAllScreensConfig` devuelve estructura `{ is_public, allowed_roles[] }` correcta

**`admin-guards.test.ts`** (19 tests) — Reglas de negocio en los handlers de admin:
- Rol `admin` no se puede eliminar → 400
- Al borrar un rol, los usuarios de ese rol pasan a `user`
- Pantalla `admin` no se puede modificar → 400
- Roles con SQL injection en `allowed_roles` son ignorados silenciosamente (bind variables)
- Admin siempre mantiene acceso aunque no esté en `allowed_roles`
- `DROP TABLE` en nombre de rol: sanitización + bind variables lo convierten en string literal
- Nombre duplicado → 409; nombre vacío o sin label → 400
- Usuario no puede auto-eliminarse → 400

### Notas técnicas

- Los tests usan `bun:sqlite` (SQLite nativo de Bun) en memoria, nunca tocan `data/app.db`
- `permissions.test.ts` y `admin-guards.test.ts` usan `mock.module` de Bun para reemplazar `@/lib/sqlite` y `@/lib/auth` antes de importar los módulos bajo test
- `middleware.test.ts` y `sanitization.test.ts` no necesitan mocks (funciones puras y JWT con `jose`)
- Los tests son estables: no dependen de estado externo ni del orden de ejecución
