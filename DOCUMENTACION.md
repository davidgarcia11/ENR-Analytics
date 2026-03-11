# Documentación Técnica — Dashboard de Producción

> **Audiencia:** Desarrolladores que se incorporan al proyecto.
> **Última actualización:** Marzo 2026

---

## 1. Visión General

Esta aplicación es un **panel de control (dashboard) de producción** para la empresa Elaborados Naturales. Conecta con la base de datos **Oracle JD Edwards (JDE)** y muestra en tiempo real:

- Órdenes de fabricación y cantidades producidas
- Porcentaje de merma (desperdicio) por artículo
- Desglose por planta, línea de producción y fechas
- **Preparación de pedidos**: control de asignación de palets/lotes a pedidos de venta (F4211)
- Exportación a Excel con formato condicional
- Sistema de autenticación con gestión de usuarios (admin crea usuarios)
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
| **jose** | — | Firma/verificación de JWT para sesiones |
| **bcryptjs** | — | Hash de contraseñas |
| **xlsx** | 0.18 | Generar archivos Excel (.xlsx) |
| **recharts** | — | Gráficos de líneas para estadísticas de logs |
| **lucide-react** | 0.563 | Iconos SVG (Search, Factory, Download...) |
| **date-fns** | 4 | Utilidades de fecha (`getDayOfYear`) |
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
├── data/
│   └── app.db                    ← Base de datos SQLite (usuarios, presets, logs — NO se sube a Git)
│
├── public/
│   └── logo.png                  ← Logo de la empresa (se sirve en /logo.png)
│
├── lib/                          ← Lógica reutilizable (utilidades)
│   ├── db.ts                     ← Conexión a Oracle
│   ├── sqlite.ts                 ← Conexión a SQLite (usuarios, presets, migraciones)
│   ├── auth.ts                   ← JWT, bcrypt, SessionUser, cookieOptions
│   └── utils.ts                  ← Funciones auxiliares (fechas, cantidades, clases CSS)
│
├── components/                   ← Componentes React reutilizables
│   ├── ArticleMultiSelect.tsx    ← Desplegable multi-selección con búsqueda
│   └── ui/                       ← Componentes de interfaz base (botón, card, tabla, input)
│       ├── button.tsx
│       ├── card.tsx
│       ├── input.tsx
│       └── table.tsx
│
└── app/                          ← Rutas de Next.js (App Router)
    ├── globals.css               ← Estilos globales + importación de Tailwind
    ├── layout.tsx                ← Layout raíz (envuelve todas las páginas)
    ├── page.tsx                  ← Ruta "/" → muestra un 404 simple
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
    ├── preparacion-pedidos/
    │   └── page.tsx              ← Ruta "/preparacion-pedidos" → CONTROL DE PEDIDOS
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
        │   └── users/
        │       ├── route.ts      ← GET/POST /api/admin/users
        │       └── [id]/
        │           └── route.ts  ← PATCH/DELETE /api/admin/users/:id
        ├── presets/
        │   ├── route.ts          ← GET/POST /api/presets
        │   └── [id]/
        │       └── route.ts      ← DELETE /api/presets/:id
        ├── categories/
        │   └── route.ts          ← GET /api/categories?field=X
        ├── production/
        │   └── route.ts          ← GET /api/production?...filtros...
        ├── production-lines/
        │   └── route.ts          ← GET /api/production-lines
        ├── plants/
        │   └── route.ts          ← GET /api/plants (plantas desde Oracle F0006)
        └── orders/
            └── route.ts          ← GET /api/orders?...filtros... (pedidos de venta)
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
```

> **IMPORTANTE:** Este archivo NUNCA se sube al repositorio. Está en `.gitignore`.

### `package.json` — Scripts principales

| Comando | Qué hace |
|---|---|
| `bun dev` | Arranca el servidor en modo desarrollo (hot reload) |
| `bun run build` | Compila la app para producción |
| `bun start` | Sirve la app compilada (producción) |

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
  created_at TEXT DEFAULT (datetime('now'))
);

-- Presets de filtros
CREATE TABLE presets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  filters TEXT NOT NULL,   -- JSON con los 13 filtros
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

**Migraciones automáticas:** Al arrancar, comprueba si faltan columnas (`must_change_password`, `name`, `surname` en users; `source` en query_logs) y las añade con `ALTER TABLE`. Esto permite actualizar DBs creadas antes de estas funcionalidades.

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
}
```

### Flujo de autenticación

```
LOGIN:
  /login → POST /api/auth/login → JWT en cookie
    ├── mustChangePassword=true → /cambiar-contrasena
    └── mustChangePassword=false → /produccion

CAMBIO DE CONTRASEÑA FORZADO:
  /cambiar-contrasena → POST /api/auth/change-password
    → Actualiza hash + must_change_password=0 → /produccion

SESIÓN EN DASHBOARD:
  /produccion → GET /api/auth/me (silencioso)
    ├── Si logueado: muestra nombre + botón Presets + Salir
    └── Si no: muestra enlace "Iniciar sesión"
```

### Cookie `secure` en LAN

Las cookies con `secure: true` no funcionan sobre HTTP (solo HTTPS). Cuando el dashboard se sirve por LAN sin SSL, `cookieOptions(req)` detecta el protocolo real de la request (`req.url.startsWith('https')`) en vez de confiar en `NODE_ENV`.

---

## 5. Panel de Administración (`/admin`)

### Acceso
Solo usuarios con `role === 'admin'`. Si no eres admin, te redirige a `/produccion`.

### Funcionalidades

1. **Crear usuario:** Formulario con campos Nombre, Apellido, Usuario (login), Contraseña, Rol (user/admin), checkbox "Forzar cambio de contraseña"
2. **Listar usuarios:** Tabla con ID, Nombre completo, Usuario, Rol (badge rojo/gris), Fecha creación
3. **Editar usuario:** Botón lápiz azul por usuario → la fila se convierte en inputs editables (nombre, apellido, usuario, rol) con "Guardar" y "Cancelar". Valida que el username no esté duplicado (error 409 inline)
4. **Resetear contraseña:** Botón llave ámbar por usuario → input inline → nueva contraseña + fuerza cambio en próximo login
5. **Eliminar usuario:** Con confirmación. No puedes eliminarte a ti mismo.
6. **Acceso a logs:** Botón "Logs" en la cabecera que lleva a `/admin/logs`

### APIs de administración

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/admin/users` | Lista todos los usuarios (id, username, role, name, surname, created_at) |
| POST | `/api/admin/users` | Crea usuario (acepta name, surname, username, password, role, mustChangePassword). Devuelve 409 si el username ya existe |
| PUT | `/api/admin/users/:id` | Edita datos del usuario (name, surname, username, role). Valida unicidad del username contra otros usuarios (409 si duplicado) |
| PATCH | `/api/admin/users/:id` | Resetea contraseña (fuerza cambio en próximo login) |
| DELETE | `/api/admin/users/:id` | Elimina usuario (no permite auto-eliminación) |
| GET | `/api/admin/logs` | Logs de consultas con paginación, filtros y estadísticas (ver sección 7) |

---

## 6. Presets de Filtros

Los usuarios logueados pueden guardar combinaciones de filtros con nombre para reutilizarlos.

### Qué se guarda en un preset (JSON)

```json
{
  "plant": "10300",
  "subLine": "all",
  "startDate": "2026-01-01",
  "endDate": "2026-03-02",
  "selectedArticles": [],
  "selectedPrp6": [],
  "selectedSrp3": [],
  "selectedSrp5": [],
  "selectedSrp2": [],
  "selectedSrp1": [],
  "selectedSrp4": [],
  "selectedZe03": [],
  "selectedProdLines": []
}
```

### UI de presets

Dos formas de interactuar:

1. **Panel expandible (botón "Presets"):** Lista completa de presets con opción de guardar y eliminar
2. **Acceso rápido en la barra de acciones:** Dropdown "Cargar preset" + botón "Guardar" (pide nombre con prompt)

### APIs de presets

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/presets` | Lista presets del usuario autenticado |
| POST | `/api/presets` | Guarda nuevo preset |
| DELETE | `/api/presets/:id` | Elimina preset propio |

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
| `app/api/production/route.ts` | `produccion` | Cada consulta de datos de producción |
| `app/api/orders/route.ts` | `pedidos` | Cada consulta de pedidos de venta |
| `app/api/auth/login/route.ts` | `login` | Cada inicio de sesión exitoso |

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
  "dailyStats": [          // últimos 14 días (para gráfico)
    { "day": "2026-03-01", "queries": 15, "avgTime": 300, "uniqueUsers": 3 }
  ]
}
```

### Página de logs — `/admin/logs`

**Archivo:** `app/admin/logs/page.tsx`

Solo accesible para admins. Se accede desde:
- Botón "Logs" en el panel de administración (`/admin`)
- Botón "Logs" en la barra de sesión del dashboard (`/produccion`, solo admins)

**Componentes visuales:**

1. **4 tarjetas de estadísticas:** Consultas totales, Tiempo medio, Tiempo máximo, Resultados medio
2. **Gráfico de líneas (recharts):** Toggle con botón "Ver gráfico"/"Ocultar gráfico". Muestra consultas y tiempo medio por día (últimos 14 días) con dos ejes Y (consultas a la izquierda, tiempo a la derecha)
3. **Filtros:** Usuario (dropdown), Fecha desde, Fecha hasta, botones Filtrar/Limpiar
4. **Tabla de logs:** Fecha/Hora, Usuario, Panel (badge con color), Filtros (resumen), Resultados, Tiempo
5. **Paginación:** Anterior/Siguiente con indicador de página

**Detalles de implementación:**
- Los logins se resaltan con fondo azul claro y icono LogIn
- La columna "Panel" muestra badges con colores según el source (`SOURCE_LABELS`)
- `summarizeFilters()` convierte el JSON de filtros en un resumen legible (ej: "Aguilar · 01/03 - 02/03 · 3 filtros")
- Las estadísticas y gráfico excluyen entradas de login (solo consultas reales)

### Persistencia

Los logs se almacenan en `data/app.db` (SQLite), igual que usuarios y presets. No se pierden al hacer `git pull`, `bun install` o `bun run build`.

### Extensibilidad — Nuevos paneles

Al crear un nuevo panel, basta con:
1. Añadir el INSERT en la ruta API del nuevo panel con `source: 'nombre_panel'`
2. Añadir la etiqueta en `SOURCE_LABELS` en `admin/logs/page.tsx`
3. Los logs aparecerán automáticamente en la página de logs con su badge identificativo

**Paneles actuales registrados:** `produccion` (Producción), `pedidos` (Preparación Pedidos), `login` (Login)

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

---

## 8. Tablas de Oracle JDE

### Tablas principales

| Tabla | Descripción | Campos clave |
|---|---|---|
| **F4801** | **Órdenes de fabricación** | `WADOCO` (nº orden), `WADL01` (descripción), `WAMCU` (planta), `WAAITM` (artículo display), `WAITM` (artículo corto) |
| **F4211** | **Líneas de pedido de venta** | `SDDOCO` (nº pedido), `SDPDDJ` (fecha carga JDE), `SDRSDJ` (fecha entrega JDE), `SDMCU` (planta), `SDAITM` (artículo), `SDDSC1` (descripción), `SDUORG` (cant. pedida ×100), `SDLOTN` (lote/palet), `SDLNID` (nº línea), `SDUOM` (UM), `SDNXTR` (estado — 999=cerrado) |
| **F4111** | **Movimientos de inventario** | `ILDOC` (nº orden), `ILTRDJ` (fecha JDE), `ILDCT` (tipo: IC=producción, IS=merma), `ILTRQT` (cantidad), `ILRCD` (código razón), `ILTRUM` (UM), `ILMCUZ` (línea producción) |
| **F4101** | **Maestro de artículos** | `IMITM` (ID corto), `IMUOM1` (UM primaria), `IMPRP6` (tipo proceso), `IMSRP1..5` (categorías) |
| **F554101** | **Extensión del maestro** | `AAITM` (ID corto), `AAZE03` (gramaje) |
| **F55TAR12** | **Tareas de producción** (custom) | `TODOCO` (nº orden), `TO55TAREA` (código fecha+sublínea) |

### Tablas auxiliares

| Tabla | Descripción |
|---|---|
| **prodctl.f0005** | Códigos definidos por usuario (UDC) — catálogos |
| **F41002** | Conversiones de unidad de medida |
| **F30006** | Centros de trabajo (líneas producción) |
| **F0006** | Unidades de negocio (Business Units) |

### Relaciones

```
F55TAR12 (tareas)
    │ TODOCO
    ▼
F4801 (órdenes) ──WAITM──► F4101 (maestro artículos) ──► F554101 (extensión)
    │ WADOCO
    ▼
F4111 (movimientos)
    └── ILTRUM ──► F41002 (conversiones UM)

F4101.IMPRP6/IMSRP1..5 ──► prodctl.f0005 (catálogos UDC)
F4111.ILMCUZ ──► F30006 + F0006 (líneas producción)
```

---

## 10. API Routes — Datos de producción

### `GET /api/categories?field=X`

**Archivo:** `app/api/categories/route.ts`

Devuelve las opciones `[{ id, description }]` para un desplegable de filtro.

| field | Columna | DRSY | DRRT | UI |
|---|---|---|---|---|
| `prp6` | IMPRP6 | 41 | 01 | Tipo Proceso OF |
| `srp3` | IMSRP3 | 41 | S3 | Formato |
| `srp5` | IMSRP5 | 41 | S5 | Sabor |
| `srp2` | IMSRP2 | 41 | S2 | Familia |
| `srp1` | IMSRP1 | 41 | S1 | Categoría |
| `srp4` | IMSRP4 | 41 | S4 | Marca |
| `ze03` | AAZE03 (F554101) | 17 | B3 | Gramaje |

### `GET /api/production?...filtros...`

**Archivo:** `app/api/production/route.ts`

El endpoint más complejo. Devuelve datos de producción filtrados.

**Parámetros:** `plant`, `subLine`, `startDate`, `endDate`, `article[]`, `prp6[]`, `srp3[]`, `srp5[]`, `srp2[]`, `srp1[]`, `srp4[]`, `ze03[]`, `prodLine[]`, `page`, `limit`

**Lógica:**
1. Construye SQL dinámico (JOINs condicionales según filtros activos)
2. Ejecuta contra Oracle
3. Obtiene UM primarias y factores de conversión
4. Procesa filas: parsea fechas JDE, convierte UM (BFS), agrupa, calcula merma
5. Devuelve `{ data: [...], sqlRowCount: N }`

**Deduplicación F55TAR12:** `MOD(TO55TAREA, 100000)` extrae la fecha sin sub-código, `MAX` se queda con el registro más reciente (evita duplicados por migración de sub-códigos).

**Merma:** Movimientos `IS` con código razón `P01-P05`, `Q01-Q10`. Viene como número negativo. Fórmula: `|merma| / (|merma| + producido) × 100`.

**Conversión UM:** BFS de hasta 3 niveles en F41002. Factor ×10.000.000.

### `GET /api/production-lines`

**Archivo:** `app/api/production-lines/route.ts`

Devuelve líneas de producción activas de F30006+F0006. Incluye `{ id: '__empty__', description: 'Sin línea' }` al principio.

---

## 11. Página Principal — `app/produccion/page.tsx`

Client Component (~850 líneas). Es el dashboard principal.

### Estados principales

| Estado | Tipo | Para qué |
|---|---|---|
| `data` | `any[]` | Registros de producción |
| `loading` | `boolean` | Spinner mientras carga |
| `page` / `hasMore` | `number` / `boolean` | Paginación |
| `filters` | `object` | `{ plant, subLine, startDate, endDate }` |
| `selectedArticles`, `selectedPrp6`...`selectedZe03`, `selectedProdLines` | `string[]` | Multi-selects |
| `sessionUser` | `SessionUser \| null` | Usuario autenticado |
| `presets` | `Preset[]` | Presets del usuario |
| `metrics` | `object` | KPIs calculados |

### Funciones principales

| Función | Descripción |
|---|---|
| `fetchData(page, isNew, all?)` | Fetch a `/api/production`, procesa respuesta, calcula métricas |
| `applyFilters()` | Reset + fetchData con limit=0 (todos) |
| `clearFilters()` | Resetea todos los filtros (no borra datos de la tabla) |
| `exportToExcel()` | Genera .xlsx con coloreado condicional (top 25% merma en rojo) |
| `checkSession()` | GET `/api/auth/me`, redirige si mustChangePassword |
| `savePreset(name?)` | POST `/api/presets` con filtros actuales |
| `loadPreset(preset)` | Restaura los 13 filtros desde el JSON del preset |
| `displayData` (useMemo) | Agrupa, suma, ordena por %merma descendente |

### Estructura visual

```
┌─────────────────────────────────────────────────────────┐
│ [LOGO]                          [Usuario ▪ Admin ▪ Salir]│
│                                                         │
│ ┌─ Filtros ──────────────────────────────────────────┐  │
│ │ ── Categorías ──                                   │  │
│ │ Artículo│Tipo Proc│Formato│Sabor│Familia│...       │  │
│ │ ─────────────────────────────────────────          │  │
│ │ ── Fechas y Planta ──                              │  │
│ │ F.Inicio│F.Fin│Planta│Sub-planta                   │  │
│ │ ─────────────────────────────────────────          │  │
│ │             [Filtrar][Excel][Limpiar][Preset▼][+]  │  │
│ └────────────────────────────────────────────────────┘  │
│                                                         │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐   │
│ │ Cantidad │ │ Órdenes  │ │  Merma   │ │Top Planta│   │
│ │ Total    │ │          │ │  2.34%   │ │ Funes 1  │   │
│ └──────────┘ └──────────┘ └──────────┘ └──────────┘   │
│                                                         │
│ ┌─ Detalle de Producción ────────────────────────────┐  │
│ │ Fecha │ Artículo │ Desc. │ Cant. │ Merma │ %M │UM │  │
│ │ 02/03 │ 00001234 │ MERM..│ 1500  │ -23   │2.3%│UN │  │
│ │         [Cargar más] [Cargar todos]                │  │
│ └────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

**Panel de filtros organizado en 3 secciones:**
1. **Categorías:** 9 multi-selects (Artículo, Tipo Proceso, Formato, Sabor, Familia, Categoría, Marca, Gramaje, Línea Producción)
2. **Fechas y Planta:** Fecha Inicio, Fecha Fin, Planta, Sub-planta (condicional)
3. **Acciones:** Filtrar (rojo), Excel (verde), Limpiar (gris), Cargar preset (dropdown), Guardar preset (azul)

Cada sección separada por divisores sutiles (`border-t border-gray-100`).

---

## 12. Componentes Reutilizables

### `ArticleMultiSelect.tsx`

Desplegable multi-selección con búsqueda. Se usa para los 9 filtros de categoría.

**Props:** `articles`, `selected`, `onChange`, `label`, `showId`

**Comportamiento:** Botón con badge de seleccionados → panel flotante con buscador + checkboxes + "Sel. todos" / "Ninguno".

### Componentes UI (`components/ui/`)

| Componente | Descripción |
|---|---|
| `button.tsx` | Botón con variantes (default, outline, ghost, destructive, secondary, link) |
| `card.tsx` | Card, CardHeader, CardTitle, CardContent |
| `input.tsx` | Input estilizado |
| `table.tsx` | Table, TableHeader, TableBody, TableRow, TableHead, TableCell |

---

## 13. Gotchas y Patrones Importantes

### Oracle CHAR vs VARCHAR2

El driver `oracledb` envía bind variables como VARCHAR2. Los campos CHAR tienen padding de espacios y no coinciden.

- Valores **hardcodeados**: embeber en SQL directamente
- Valores **del usuario**: usar `TRIM()` en la columna + bind variables

### Fechas JDE (CYYDDD)

Usar `parseJdeDate()`. Para convertir a JDE: `(year - 2000) * 1000 + getDayOfYear(date)`.

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

### Color corporativo `#D30B15`

Se usa en: borde superior de tarjetas KPI/filtros/tabla, botón Filtrar, iconos KPI.

### Cookie `secure` en LAN

No usar `secure: process.env.NODE_ENV === 'production'`. En su lugar, `cookieOptions(req)` detecta HTTPS desde la URL real de la request.

### `serverExternalPackages` en next.config.ts

`better-sqlite3` es un módulo nativo. Sin `serverExternalPackages: ['better-sqlite3']`, el build de producción falla.

---

## 14. Preparación de Pedidos — `/preparacion-pedidos`

### Visión general

Panel para controlar el progreso de asignación de palets/lotes a pedidos de venta. Consulta la tabla **F4211** (Sales Order Detail) de Oracle JDE.

**Concepto clave:** Una línea de pedido está **asignada** si tiene lote (`SDLOTN` no vacío). Si no tiene lote, está **pendiente**. El progreso se calcula como la proporción de cantidad asignada (con lote) sobre la cantidad total pedida.

### Navegación

- Desde `/produccion`: botón "Pedidos" en la barra de sesión
- Desde `/preparacion-pedidos`: botón "Producción" para volver

### API — `GET /api/plants`

**Archivo:** `app/api/plants/route.ts`

Devuelve la lista de plantas desde Oracle (tabla F0006, filtro `MCSTYL = 'BP'`).

**Respuesta:**
```json
[
  { "id": "10100", "description": "Aguilar" },
  { "id": "10200", "description": "Corella" },
  { "id": "10300", "description": "Funes" }
]
```

> **Nota:** Este endpoint se usa **solo en Pedidos**. El panel de Producción tiene las plantas hardcodeadas porque maneja lógica de sub-plantas (ver sección 17).

### API — `GET /api/orders`

**Archivo:** `app/api/orders/route.ts`

**Parámetros:**

| Param | Tipo | Descripción |
|---|---|---|
| `plant` | string | Código planta (MCMCU de F0006) o vacío para todas |
| `startDate` | string | Fecha carga desde (YYYY-MM-DD) → filtra `SDPDDJ` |
| `endDate` | string | Fecha carga hasta (YYYY-MM-DD) → filtra `SDPDDJ` |
| `deliveryStartDate` | string | Fecha entrega desde (YYYY-MM-DD) → filtra `SDRSDJ` |
| `deliveryEndDate` | string | Fecha entrega hasta (YYYY-MM-DD) → filtra `SDRSDJ` |

**Lógica:**
1. Carga nombres de planta desde F0006 (`MCSTYL = 'BP'`) para resolver `plantName` dinámicamente
2. Consulta F4211 excluyendo líneas cerradas (`SDNXTR != 999`)
2. Agrupa por pedido (`SDDOCO`) y por artículo (`SDAITM`)
3. Clasifica cada línea como asignada (tiene `SDLOTN`) o pendiente (sin `SDLOTN`)
4. Suma `SDUORG/100` por artículo: `totalOrdered`, `totalAssigned` (con lote), `totalPending` (sin lote)
5. Calcula progreso: `totalAssigned / totalOrdered × 100`
6. Determina estado del pedido: `completado` (todos los artículos al 100%), `en_progreso` (alguno asignado), `pendiente` (ninguno asignado)
7. Registra en logs con `source: 'pedidos'`

**Respuesta:**
```json
{
  "orders": [{
    "orderNumber": 12345,
    "loadDate": "2026-03-09T...",
    "deliveryDate": "2026-03-12T...",
    "plant": "10300",
    "plantName": "Funes",
    "articles": [{
      "itemNumber": "0001234567",
      "description": "PRODUCTO X",
      "totalOrdered": 500,
      "totalAssigned": 300,
      "totalPending": 200,
      "uom": "UN",
      "progress": 60,
      "lots": [
        { "lineNumber": 1, "qtyOrdered": 300, "lot": "PAL001", "assigned": true },
        { "lineNumber": 2, "qtyOrdered": 200, "lot": "", "assigned": false }
      ]
    }],
    "totalArticles": 1,
    "overallProgress": 60,
    "status": "en_progreso"
  }],
  "summary": {
    "totalOrders": 50,
    "completados": 10,
    "enProgreso": 25,
    "pendientes": 15
  }
}
```

### Campos de F4211 utilizados

| Campo | Descripción |
|---|---|
| `SDDOCO` | Número de pedido de venta |
| `SDPDDJ` | Fecha de carga (formato JDE CYYDDD) |
| `SDRSDJ` | Fecha de entrega (formato JDE CYYDDD) |
| `SDMCU` | Planta (Business Unit) |
| `SDAITM` | Artículo (display) |
| `SDDSC1` | Descripción del artículo |
| `SDUORG` | Cantidad pedida (×100) |
| `SDLOTN` | Lote/palet asignado (vacío = pendiente) |
| `SDLNID` | Número de línea |
| `SDUOM` | Unidad de medida |
| `SDNXTR` | Estado siguiente (999 = cerrado, se excluye) |

### Página — `app/preparacion-pedidos/page.tsx`

Client Component. Estructura visual:

```
┌─────────────────────────────────────────────────────────┐
│ [LOGO]                      [Usuario ▪ Producción ▪ Salir]│
│                                                         │
│ Preparación de Pedidos                                  │
│                                                         │
│ ┌─ Filtros ──────────────────────────────────────────┐  │
│ │ F.Carga Inicio│F.Carga Fin│F.Entrega Inicio│       │  │
│ │ F.Entrega Fin│Planta                                │  │
│ │ ─────────────────────────────────────────          │  │
│ │ ☑ Pendientes ☑ En Progreso ☑ Completados          │  │
│ │                    [Filtrar][Excel][Limpiar]        │  │
│ └────────────────────────────────────────────────────┘  │
│                                                         │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐   │
│ │  Total   │ │Completad.│ │En Progr. │ │Pendientes│   │
│ │   50     │ │    10    │ │    25    │ │    15    │   │
│ └──────────┘ └──────────┘ └──────────┘ └──────────┘   │
│                                                         │
│ ┌─ Pedidos (tabla expandible) ──────────────────────┐  │
│ │ ▶ 12345 │ 09/03 │ 12/03 │ Funes │ 3 │ ██░ 60% │  │
│ │   ▼ (expandido)                                    │  │
│ │   Artículo │ Desc. │ Pedido │ Asig. │ Pend. │ %  │  │
│ │   00001234 │ PROD..│  500   │  300  │  200  │60% │  │
│ │     ▼ (expandido)                                  │  │
│ │     Línea 1 │ 300 │ ✓ 300 │       │ PAL001       │  │
│ │     Línea 2 │ 200 │       │ 200   │ —            │  │
│ └────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

**Tabla expandible a 3 niveles:**
1. **Pedido:** Nº pedido, Fecha carga, Fecha entrega, Planta, Nº artículos, Barra progreso, Estado (badge)
2. **Artículos (agrupados por `SDAITM`):** Artículo, Descripción, Total pedido, Total asignado (verde), Total pendiente (ámbar), Barra progreso, UM
3. **Lotes/líneas individuales:** Nº línea, Cantidad, Asignado/Pendiente, Lote/Palet

**Ordenamiento:** Pendientes primero, En Progreso segundo, Completados último.

**Checkboxes de estado:** Permiten mostrar/ocultar pedidos por estado sin re-consultar la API. Filtro local instantáneo.

**Filtros:**
- Fecha Carga Inicio / Fin (`SDPDDJ`)
- Fecha Entrega Inicio / Fin (`SDRSDJ`)
- Planta (dinámicas desde Oracle F0006 vía `/api/plants`, o "Todas")
- Por defecto: fecha carga = hoy, fechas entrega vacías

**Export Excel:** Incluye todas las líneas de los pedidos filtrados con: Pedido, Fecha Carga, Fecha Entrega, Planta, Artículo, Descripción, Línea, Cant. Pedida, Lote/Palet, Asignado (SÍ/NO), Totales por artículo, % Progreso, UM, Estado.

---

## 15. Cómo Añadir un Nuevo Filtro de Categoría (panel Producción)

Si necesitas un nuevo filtro (ejemplo: "Subcategoría" con campo `IMSRP6`, DRSY=`41`, DRRT=`S6`):

### Paso 1: `app/api/categories/route.ts`

Añadir entrada al `FIELD_MAP`:
```ts
srp6: { col: 'IMSRP6', drsy: '41', drrt: 'S6', directF0005: true },
```

### Paso 2: `app/api/production/route.ts`

1. Leer parámetro: `const srp6s = searchParams.getAll('srp6');`
2. Añadir a condición de `extraJoins` (JOIN F4101)
3. Añadir cláusula WHERE con TRIM y bind variables

### Paso 3: `app/produccion/page.tsx`

1. Añadir estados: `selectedSrp6` + `availableSrp6`
2. Fetch en `useEffect`: `/api/categories?field=srp6`
3. Añadir al `URLSearchParams` en `fetchData`
4. Añadir al `clearFilters`
5. Añadir `<ArticleMultiSelect>` en la sección "Categorías" del panel de filtros

---

## 16. Cómo Arrancar el Proyecto

```bash
# 1. Instalar dependencias
cd dashboard
bun install

# 2. Configurar credenciales (copiar y editar)
cp .env.local.example .env.local

# 3. Desarrollo (hot reload)
bun dev
# Abrir http://localhost:3000/produccion

# 4. Producción
bun run build
bun start
```

> **Nota:** La ruta raíz `/` muestra un 404 a propósito. La app está en `/produccion`.

### Primer acceso

1. Ir a `/login` → usuario `admin`, contraseña `admin123`
2. Ir a `/admin` → crear usuarios con nombre, apellido y contraseña
3. La base de datos SQLite (`data/app.db`) se crea automáticamente al arrancar
4. `data/` está en `.gitignore` → los usuarios y presets **no se pierden** al hacer `git pull`

### Despliegue en servidor

- `data/app.db` persiste entre despliegues (no se sube a Git, no se sobreescribe)
- Si necesitas reiniciar usuarios: eliminar `data/app.db` y se recreará con el admin por defecto

---

## 17. Cómo Añadir Plantas y Sub-plantas al Dashboard de Producción

> **Importante:** El panel de Producción tiene las plantas y sub-plantas **hardcodeadas** a propósito. La lógica de sub-plantas (Funes 1, Funes 2, Funes Past.) está acoplada al campo `F55TAR12.TO55TAREA` y no puede resolverse dinámicamente desde Oracle. El panel de **Pedidos** sí usa plantas dinámicas desde `/api/plants` (F0006).

### 17.1 Añadir una nueva planta (sin sub-plantas)

Ejemplo: añadir planta "Tudela" con código `10400`.

**Cambio 1 — `app/produccion/page.tsx`** (dropdown de planta):

Buscar el `<select>` de plantas y añadir una nueva `<option>`:
```tsx
<option value="10400">Tudela</option>
```

**Cambio 2 — `lib/utils.ts`** (función `parseJdeDate`):

En el `switch` que resuelve el nombre de planta, añadir:
```ts
case '10400':
  plantName = 'Tudela';
  break;
```

Con estos 2 cambios, la planta aparecerá en el filtro y los registros de F55TAR12 con `TRIM(TO55MCU) = '10400'` se mostrarán correctamente.

### 17.2 Añadir una nueva sub-planta a una planta existente

Ejemplo: añadir sub-planta "Funes Conservas" con código de tarea `6` a la planta Funes (`10300`).

Las sub-plantas se determinan por el campo `TO55TAREA` de la tabla `F55TAR12`:
- `3` → Funes 1
- `4` → Funes 2
- `5` → Funes Past.

**Cambio 1 — `lib/utils.ts`** (función `parseJdeDate`):

En el `switch` de `TO55TAREA` dentro del case `'10300'`, añadir:
```ts
case '6':
  subPlantName = 'Funes Conservas';
  break;
```

**Cambio 2 — `app/produccion/page.tsx`** (dropdown de sub-planta):

Buscar el `<select>` de sub-planta (visible cuando `selectedPlant === '10300'`) y añadir:
```tsx
<option value="6">Funes Conservas</option>
```

### 17.3 Añadir sub-plantas a una planta que no las tenía

Si la nueva planta (ej. Tudela `10400`) necesita sub-plantas:

1. En `lib/utils.ts` → `parseJdeDate`: dentro del `switch` de planta, añadir un case `'10400'` con un `switch` anidado por `TO55TAREA` (siguiendo el patrón de Funes `10300`).
2. En `app/produccion/page.tsx`: añadir lógica condicional para mostrar el dropdown de sub-planta cuando `selectedPlant === '10400'`, siguiendo el patrón existente de `10300`.

### 17.4 Panel de Pedidos — plantas automáticas

El panel de Pedidos **no necesita cambios** al añadir una nueva planta. Las plantas se cargan dinámicamente desde Oracle (tabla `F0006`, filtro `MCSTYL = 'BP'`). Si se da de alta una nueva Business Unit en JDE con estilo `BP`, aparecerá automáticamente en el dropdown de pedidos
