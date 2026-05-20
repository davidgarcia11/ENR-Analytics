# Documentación Técnica — Dashboard de Producción

> **Audiencia:** Desarrolladores que se incorporan al proyecto.
> **Última actualización:** Marzo 2026

---

## 1. Visión General

Esta aplicación es un **panel de control (dashboard) de producción** para la empresa Elaborados Naturales. Conecta con la base de datos **Oracle JD Edwards (JDE)** y muestra en tiempo real:

- Órdenes de fabricación y cantidades producidas
- Porcentaje de merma (desperdicio) por artículo
- Desglose por planta, línea de producción y fechas
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
│   ├── ArticleMultiSelect.tsx    ← Desplegable multi-selección con búsqueda (aria-label en botón combobox, input búsqueda y acciones)
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
| `app/api/production/route.ts` | `produccion` | Cada consulta de datos (con o sin resultados) |
| `app/api/auth/login/route.ts` | `login` | Cada inicio de sesión exitoso |
| `app/api/caducados/route.ts` | `caducados_obsoletos` | Cada consulta de palets caducados/obsoletos/bloqueados |

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

---

## 9. Paneles de la aplicación

Cada panel tiene su documentación específica en la carpeta `docs/`:

| Panel | Ruta | Documentación |
|---|---|---|
| Dashboard de producción | `/produccion` | [docs/produccion.md](docs/produccion.md) |
| Control de pedidos | `/preparacion-pedidos` | [docs/control-pedidos.md](docs/control-pedidos.md) |
| Palets caducados/obsoletos/bloqueados | `/caducados` | [docs/palets-caducados.md](docs/palets-caducados.md) |
| Comparativa SERES vs JDE | `/comparativa-seres` | [docs/seres-jde-comparativa.md](docs/seres-jde-comparativa.md) |

### Panel Comparativa SERES vs JDE

Panel integrado en el dashboard que cruza pedidos EDI recibidos en SERES con los registrados en JDE (tabla `F47011`) para detectar discrepancias. Hace scraping de SERES y consulta Oracle directamente desde el servidor Next.js.

Existe también un **workflow N8N** equivalente (`n8n-local`, ID `nhTMqtPSA8RZZMT1`) útil para automatizar ejecuciones programadas o enviar alertas.

Ver documentación completa: [docs/seres-jde-comparativa.md](docs/seres-jde-comparativa.md)

### API externa — `GET /api/jde-orders`

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

## 10. Componentes UI base (`components/ui/`)

| Componente | Descripción |
|---|---|
| `button.tsx` | Botón con variantes (default, outline, ghost, destructive, secondary, link) |
| `card.tsx` | Card, CardHeader, CardTitle, CardContent |
| `input.tsx` | Input estilizado |
| `table.tsx` | Table, TableHeader, TableBody, TableRow, TableHead, TableCell |

---

## 11. Gotchas y Patrones Importantes

### Oracle CHAR vs VARCHAR2

El driver `oracledb` envía bind variables como VARCHAR2. Los campos CHAR tienen padding de espacios y no coinciden.

- Valores **hardcodeados**: embeber en SQL directamente
- Valores **del usuario**: usar `TRIM()` en la columna + bind variables

### Fechas JDE (CYYDDD)

Usar `parseJdeDate()`. Para convertir a JDE: `(year - 2000) * 1000 + getDayOfYear(date)`.

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
- **Páginas (`/produccion`, `/caducados`):** el elemento raíz del contenido es `<main>` (no `<div>`). Todos los botones de navegación llevan `type="button"`. El botón "Salir" usa `text-gray-500` (no `text-gray-400`) para cumplir el ratio de contraste WCAG AA.

### Color corporativo `#D30B15`

Se usa en: borde superior de tarjetas KPI/filtros/tabla, botón Filtrar, iconos KPI.

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
