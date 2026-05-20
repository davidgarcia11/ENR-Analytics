# Comparativa SERES vs JDE

## ¿Qué hace?

Cruza los pedidos EDI recibidos en **SERES** (`webconnect.seresnet.com`) con los pedidos registrados en **JDE** (tabla `F47011`) para detectar discrepancias:

- **Solo en SERES:** pedidos que llegaron por EDI pero aún no se han creado en JDE
- **Solo en JDE:** pedidos en JDE sin correspondencia en SERES
- **En ambos:** pedidos correctamente sincronizados en las dos plataformas

La comparación se hace **solo por número de referencia** (no por fecha). Los tipos de documento de SERES que se comparan son `Pedido` y `Albarán` (se descartan Comunicados, Confirmaciones de entrega, Mensajes de liquidación, etc.).

---

## Implementaciones disponibles

### 1. Panel del Dashboard (herramienta principal)

**Ruta:** `/comparativa-seres`  
**API:** `GET /api/comparativa-seres?days=N`  
**Archivos:**
- `app/comparativa-seres/page.tsx` — interfaz de usuario
- `app/api/comparativa-seres/route.ts` — lógica de scraping + consulta JDE

El panel hace el scraping de SERES y la consulta a JDE **directamente** (sin pasar por N8N), requiere sesión JWT activa y es la herramienta recomendada para uso diario.

**Variables de entorno necesarias en `.env.local`:**
```
SERES_USERNAME=adm_ESB71016125
SERES_PASSWORD=Ela26003
```

### 2. Workflow N8N (herramienta auxiliar / automatización)

**Archivo local:** `C:\Users\dgarcia\AppData\Local\Temp\n8n-workflow-v11.json`  
**ID local:** `nhTMqtPSA8RZZMT1`  
**ID producción:** `Ydwo4aIgyqejUOpR`

Mismo resultado que el panel pero ejecutable desde N8N, útil para programar ejecuciones automáticas o enviar alertas por email/Slack si hay discrepancias.

---

## Lógica de scraping SERES

Ambas implementaciones usan la misma lógica. El scraping no usa Playwright ni Selenium — solo peticiones HTTP con el módulo nativo `https`/`node:https`.

### Flujo de autenticación

1. `GET https://webconnect.seresnet.com/web/login` → obtiene `JSESSIONID` (Tomcat requiere sesión previa)
2. `POST https://webconnect.seresnet.com/login-captcha` con `username` + `password` → autentica, recibe cookies de sesión
3. `GET` al redirect del login → consolida estado de sesión autenticada

### Paginación

```
POST https://webconnect.seresnet.com/web/documentList
```

Se envía un formulario con:

| Campo | Valor |
|---|---|
| `inputFolder.idFolder` | `REC` (bandeja entrada) |
| `inputFilter.fieldList[3].idField` | `1003` (campo fecha) |
| `inputFilter.fieldList[3].value` | Fecha desde `DD/MM/YYYY` |
| `inputFilter.fieldList[3].maxValue` | Fecha hasta `DD/MM/YYYY` (**mañana**, no hoy) |
| `pageNumber` | 1, 2, 3... |
| `pageSize` | `12` |
| `MAX_PAGES` | `200` (límite de seguridad) |

> **Importante — fecha hasta = mañana:** SERES trata el límite superior como exclusivo. Si se pone `dateTo = hoy`, los documentos de hoy quedan fuera. Poniendo `dateTo = mañana` se incluyen correctamente los documentos del día actual.

### Parsing HTML

La tabla de resultados tiene celdas con `style="cursor: pointer;"`. Se extrae su contenido con:

```javascript
const tdRegex = /style="cursor: pointer;">([^<]+)<\/td>/g;
```

El `[^<]+` (al menos un carácter) hace que las celdas en blanco se salten automáticamente, sin desplazar las posiciones.

**Estructura de cada fila** (el inicio se detecta por el patrón `DD/MM/YYYY HH:MM:SS`):

| Posición | Columna SERES |
|---|---|
| i+0 | Fecha Estado (DateTime — marca el inicio de fila) |
| i+1 | Buzón Origen |
| i+2 | Código Interlocutor |
| i+3 | Nombre Interlocutor |
| i+4 | **Número Doc.** ← referencia usada para comparar |
| i+5 | Fecha Doc. |
| i+6 | **Tipo Documento** (Pedido, Albarán, Comunicado...) |
| i+7 | Importe |
| i+8 | Doc. Relacionado (frecuentemente en blanco, se omite) |

---

## Lógica de consulta JDE

Tabla: `F47011` (EDI Inbound — registro de pedidos recibidos por intercambio electrónico de datos)

```sql
SELECT TRIM(SYVR01) AS REFERENCIA, SYUPMJ AS FECHA_JDE
FROM F47011
WHERE SYUPMJ >= :fechaDesde
  AND TRIM(SYVR01) IS NOT NULL
ORDER BY SYUPMJ DESC
```

**Campos utilizados:**

| Campo | Descripción |
|-------|-------------|
| `SYVR01` | Referencia del pedido (CHAR con padding de espacios → `TRIM` obligatorio) |
| `SYUPMJ` | Fecha de última actualización en formato JDE **CYYDDD** |
| `SYSHAN` | Número de dirección de destino (Ship To) |
| `SYURAB` | Número de dirección vendida a (Sold To) |

Los campos `SYSHAN` y `SYURAB` se cruzan con `F0101.ABAN8` para obtener la descripción (`ABALPH`):

```sql
SELECT TRIM(A.SYVR01) AS REFERENCIA,
       A.SYUPMJ      AS FECHA_JDE,
       A.SYSHAN      AS SHAN_NUM,
       TRIM(B.ABALPH) AS SHAN_DESC,
       A.SYURAB      AS URAB_NUM,
       TRIM(C.ABALPH) AS URAB_DESC
FROM F47011 A
LEFT JOIN F0101 B ON B.ABAN8 = A.SYSHAN
LEFT JOIN F0101 C ON C.ABAN8 = A.SYURAB
WHERE A.SYUPMJ >= :fechaDesde
  AND TRIM(A.SYVR01) IS NOT NULL
ORDER BY A.SYUPMJ DESC
```

**Tabla F0101** (Address Book Master):

| Campo | Descripción |
|-------|-------------|
| `ABAN8` | Número de dirección (clave primaria) |
| `ABALPH` | Nombre / descripción (Alpha Name) |

**Formato CYYDDD de `SYUPMJ`:**

```
Ejemplo: 126061
│││└──┘
│││  └── DDD = 061 → día 61 del año → 2 de marzo
││└───── YY  = 26  → año 2026
│└────── (parte de YY)
└─────── C   = dígito de siglo (1 = años 2000)
```

JDE almacena las fechas como enteros CYYDDD. Aquí `C=1` indica siglo XXI (diferente a F55TAR12 donde `C` se reutiliza como código de sub-línea). La API convierte `SYUPMJ` a `YYYY-MM-DD` para mostrarlo en la tabla.

---

## Comparación

Se comparan **solo los números de referencia** (en mayúsculas, con trim). La fecha de cada registro se muestra en la UI pero no influye en la comparación.

`fetchSeresPedidos` devuelve **únicamente Pedidos** — el filtro se aplica dentro del bucle de scraping (`if (tipo !== 'Pedido') continue`), antes del set de deduplicación. Esto evita que un Albarán relacionado bloquee la referencia del Pedido original en el set `seen`.

```javascript
// fetchSeresPedidos ya filtra por tipo === 'Pedido' internamente
const seresPedidos = seresResult;

const jdeRefs  = new Set(jdeResult.map(p => p.referencia.toUpperCase()));
const seresRefs = new Set(seresPedidos.map(p => p.referencia.toUpperCase()));
// Mapa JDE para enriquecer "en_ambos" con campos de destino/comprador
const jdeByRef = new Map(jdeResult.map(p => [p.referencia.toUpperCase(), p]));

const soloEnSeres = seresPedidos.filter(p => !jdeRefs.has(p.referencia.toUpperCase()));
const soloEnJde   = jdeResult.filter(p => !seresRefs.has(p.referencia.toUpperCase()));
const enAmbos     = seresPedidos
    .filter(p => jdeRefs.has(p.referencia.toUpperCase()))
    .map(p => ({ ...p, ...jdeByRef.get(p.referencia.toUpperCase()) }));
```

---

## Panel del Dashboard — detalles técnicos

**Archivos:** `app/comparativa-seres/page.tsx` + `app/api/comparativa-seres/route.ts`

**Acceso configurable** — público por defecto. Cualquier usuario puede ejecutar la comparativa sin sesión activa. La API aplica `requireScreenAccess('comparativa')`, por lo que si el administrador restringe la pantalla desde `/admin` → Pantallas, tanto la página como la API quedan protegidas. Si hay sesión activa, se muestra el nombre del usuario y los botones de Admin.

**Parámetro:** `?days=N` (0 a 90 días, default 7). El panel ofrece botones de selección rápida: Hoy / 1 / 3 / 7 / 14 / 30 días.

> **`days=0` ("Hoy"):** caso especial. SERES filtra por Fecha Doc. (cuando se creó el pedido en origen), que puede ser el día anterior incluso si llegó hoy. Para evitar falsos negativos, cuando `days=0` la API pide 1 día extra de margen a SERES y luego filtra los resultados por **Fecha Estado** (la fecha real de recepción en SERES). En JDE simplemente no se aplica el `setDate` (se usa `since = hoy`). 

**Paralelismo:** el scraping de SERES y la consulta a JDE se lanzan en paralelo con `Promise.all`.

### Interfaz de usuario

```
┌─ Barra superior ─────────────────────────────────────┐
│ [LOGO]             [Produccion] [Usuario] [Admin] [Salir]│
└──────────────────────────────────────────────────────┘

┌─ Filtros ────────────────────────────────────────────┐
│ Periodo: [Hoy] [1 día] [3 días] [7 días] [14 días] [30 días]     │
│                                                      │
│ [Comparar ▶]  [Excel ↓]  [Limpiar ×]               │
└──────────────────────────────────────────────────────┘

┌─ Tarjetas métricas (5) ──────────────────────────────┐
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ │
│ │  SERES   │ │   JDE    │ │Solo SERES│ │Solo JDE  │ │En ambos  │ │
│ │   326    │ │   350    │ │    4 ⚠️  │ │    2 🔴  │ │  322 ✅  │ │
│ └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘ │
│ Las 3 últimas tarjetas son clicables → activan la pestaña         │
└──────────────────────────────────────────────────────┘

┌─ Tabla con pestañas ─────────────────────────────────┐
│ [Solo en SERES (4)] [Solo en JDE (2)] [En ambos (322)]│
│ ─────────────────────────────────────────────────────│
│ Aviso contextual (qué significa cada pestaña)        │
│ ─────────────────────────────────────────────────────│
│ Referencia  │ Fecha     │ Tipo SERES                 │
│ 01565794    │ 06/05/26  │ Pedido                     │
│ ...                                                  │
└──────────────────────────────────────────────────────┘
```

**Columnas de la tabla:**
- **Referencia** — número de pedido (fuente monospace)
- **Fecha** — fecha del documento (SERES) o `SYUPMJ` convertida (JDE), formato `DD/MM/YY`. Los registros SERES también muestran la **hora** (`HH:MM:SS`) en gris junto a la fecha
- **Tipo SERES** — solo visible en pestaña "Solo en SERES"
- **Destino (SYSHAN)** — número + nombre de dirección de destino; visible en "Solo en JDE" y "En ambos"
- **Vendido a (SYURAB)** — número + nombre del cliente comprador; visible en "Solo en JDE" y "En ambos"

**Exportación Excel:** tres hojas — "Solo en SERES", "Solo en JDE", "En ambos". Cada hoja con columnas Referencia, Fecha y Tipo (cuando aplica). Nombre del archivo: `Comparativa_SERES_JDE_YYYY-MM-DD.xlsx`.

**Respuesta de la API:**
```json
{
  "resumen": {
    "total_seres_todos": 554,
    "total_seres_pedidos": 326,
    "total_jde": 350,
    "solo_en_seres": 4,
    "solo_en_jde": 2,
    "en_ambos": 322,
    "days": 7
  },
  "solo_en_seres": [...],
  "solo_en_jde": [...],
  "en_ambos": [...]
}
```

---

## Workflow N8N — instalación y despliegue

### Instalación de N8N (Windows)

```powershell
# 1. Crear carpeta e instalar
mkdir C:\Users\dgarcia\Projects\n8n-local
cd C:\Users\dgarcia\Projects\n8n-local
npm init -y
npm install n8n

# 2. Crear .env (desde PowerShell — el Explorador no permite archivos que empiezan por punto)
New-Item -Path ".env" -ItemType File -Force
Add-Content -Path ".env" -Value "NODE_FUNCTION_ALLOW_BUILTIN=https,http,url,querystring"
Add-Content -Path ".env" -Value "NODE_FUNCTION_ALLOW_EXTERNAL=*"

# 3. Arrancar
cd C:\Users\dgarcia\Projects\n8n-local
npx n8n
```

Accesible en `http://localhost:5678`. N8N no está configurado como servicio Windows — hay que arrancarlo manualmente.

> **El archivo `.env` es imprescindible.** Sin él, el nodo Code no puede usar el módulo `https` de Node.js y el scraping falla.

### Despliegue / actualización del workflow via API

```javascript
// Script Node.js: upload-n8n.js
const fs = require('fs');
const http = require('http');

const apiKey = '<API_KEY>'; // Settings → API en la UI de N8N
let raw = fs.readFileSync('n8n-workflow-vXX.json', 'utf8');
if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1); // quitar BOM si existe
const wf = JSON.parse(raw);
const body = JSON.stringify({ name: wf.name, nodes: wf.nodes, connections: wf.connections, settings: wf.settings });

http.request({
  hostname: 'localhost', port: 5678,
  path: '/api/v1/workflows/<WORKFLOW_ID>', // PUT para actualizar, POST /api/v1/workflows para crear
  method: 'PUT',
  headers: { 'X-N8N-API-KEY': apiKey, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
}, (res) => {
  let d = ''; res.on('data', c => d += c); res.on('end', () => console.log(res.statusCode, d.substring(0, 200)));
}).end(body);
```

> El puerto 5678 no está abierto al exterior. El script debe ejecutarse **en la misma máquina** donde corre N8N.

### Credenciales SERES en N8N

Las credenciales están **hardcodeadas** en el nodo "Login Flow SERES". Si cambia la contraseña, hay que editar el nodo y redesplegar el workflow.

| Campo | Valor |
|---|---|
| Usuario | `adm_ESB71016125` |
| Contraseña | `Ela26003` |

> En el dashboard estas credenciales se leen de `.env.local` (`SERES_USERNAME` / `SERES_PASSWORD`).

---

## Diferencias entre Dashboard y N8N

| | Dashboard | N8N |
|---|---|---|
| Credenciales SERES | Variables de entorno (`.env.local`) | Hardcodeadas en el nodo |
| Encoding credenciales | `encodeURIComponent` ✅ | Sin encoding ⚠️ |
| MAX_PAGES | 200 | 200 |
| dateTo | Mañana (incluye hoy) | Mañana (incluye hoy) |
| Días configurables | Sí (1–90) | No (fijo a 7) |
| Auth | JWT (sesión dashboard) | API key N8N |
| Automatizable | No (consulta manual) | Sí (trigger programado) |
