# Documentación — Consulta de stock por escaneo (`/consulta-stock-pda`)

> Documentación específica del panel de consulta de stock FEFO por escaneo de palet.
> Ver [DOCUMENTACION.md](../DOCUMENTACION.md) para la documentación base del proyecto.

---

## 1. Descripción general

Panel pensado para operarios de almacén: escanean el código de barras de la etiqueta del **palet**
(con pistola láser en PDA, o cámara en móvil/PC) y el panel muestra el artículo identificado y el
stock de ese artículo **ordenado por fecha de caducidad ascendente** (FEFO — First Expired, First
Out), para saber qué palet coger primero. Un selector de planta permite acotar la consulta a un
depósito concreto. Como el código escaneado siempre trae el SSCC del palet, el panel avisa además
si ese palet en concreto es correcto para consumir o si hay otro lote que caduca antes (§7.2).

**Solo se busca por SSCC** (número de palet, AI `00` de GS1-128) — nunca por el EAN del artículo.
Si se escanea el EAN "pelado" de la etiqueta del artículo (sin SSCC), el panel rechaza el escaneo
con el mensaje "Debes escanear el número de palet (SSCC), no el código del artículo": buscar solo
por EAN no permite validar qué palet concreto coger (§7.2), que es el objetivo del panel.

**Fuente de datos:** a diferencia del resto de paneles (Oracle/JDE), este consulta la base de datos
de **Reflex (SQL Server)**, un sistema externo distinto de JDE. Es la primera integración del
proyecto con SQL Server.

**Acceso configurable** — público por defecto (`is_public=1`), igual que el resto de paneles. El
administrador puede restringirlo a roles específicos desde `/admin` → pestaña Pantallas.

**Navegación:** dropdown "Paneles ▾" en la barra superior (clave `consulta_stock_pda`).

---

## 2. Archivos relevantes

| Archivo | Descripción |
|---|---|
| `app/consulta-stock-pda/page.tsx` | Página cliente (input de escaneo + cámara, tabla de lotes), envuelta en `<AppShell>` |
| `app/api/consulta-stock-pda/route.ts` | API Route servidor — consulta a Reflex (SQL Server) |
| `lib/reflex.ts` | Conexión a SQL Server (Reflex), análoga a `lib/db.ts` para Oracle |
| `lib/gs1.ts` | Parser de códigos de barras GS1-128 (separa EAN/lote/cantidad/SSCC/fechas) |
| `__tests__/gs1.test.ts` | Tests del parser GS1 |

---

## 3. Formato del código de barras (GS1-128)

El código de barras del palet es **GS1-128 estándar**: concatena varios campos logísticos
mediante Application Identifiers (AI) en una sola cadena. `lib/gs1.ts` los separa.

### 3.1 AIs soportados

| AI | Campo | Longitud | Ejemplo |
|---|---|---|---|
| `00` | SSCC | Fija (18) | `123456789012345675` |
| `01` | GTIN de la unidad comercial | Fija (14) | `08412345678905` → EAN `08412345678905` (tal cual, sin quitar el 0) |
| `02` | GTIN de artículos contenidos (packs/cajas) | Fija (14) | mismo tratamiento que `01`, también rellena `fields.ean` |
| `10` | Lote | Variable | `LOTE123` |
| `11` | Fecha de producción (AAMMDD) | Fija (6) | `260101` → `2026-01-01` |
| `17` | Fecha de caducidad (AAMMDD) | Fija (6) | `260315` → `2026-03-15` |
| `21` | Número de serie | Variable | — |
| `37` | Cantidad | Variable | `000012` → `12` |

> `ponytail:` solo se cubren los AIs de uso real. Si aparece un código con un AI nuevo, añadirlo a
> `FIXED_LENGTHS` (si es de longitud fija) en `lib/gs1.ts`; los AIs no reconocidos se guardan igual
> en `fields.otros` sin romper el parseo.

### 3.2 Dos formatos de entrada aceptados

`parseGs1()` detecta automáticamente el formato:

- **Crudo** (el que emite el lector físico): AIs de 2 dígitos pegados al valor, con el carácter de
  control **FNC1** (`GS`, `\x1d`) separando los campos de longitud variable cuando no son el último.
- **Legible entre paréntesis**: `(01)08412345678905(10)LOTE123(17)260315(37)000012` — algunos
  lectores/configuraciones lo emiten así; los paréntesis delimitan cada campo sin necesitar FNC1.

Solo se usa el **SSCC** (`fields.sscc`) para buscar el artículo; el resto de campos (EAN, lote,
cantidad, fechas) se muestran en pantalla como referencia del propio palet escaneado, no se usan en
la consulta al servidor.

### 3.3 EAN-13 / DUN-14 sueltos (sin envoltorio de AIs)

En las etiquetas reales, el **SSCC del palet** va en GS1-128 (AI `00`), pero el **artículo** suele
llevar su propio barcode "pelado" — directamente los 13 dígitos del EAN-13, o los 14 del DUN-14
(GTIN-14), sin ningún AI alrededor. `parseGs1()` comprueba esto **antes** de intentar el parseo por
AIs:

- Cadena de **exactamente 13 dígitos** → se usa tal cual como EAN.
- Cadena de **exactamente 14 dígitos** → se usa tal cual (DUN-14/GTIN-14), **sin quitar el dígito
  indicador inicial**.

Sin esto, un EAN-13/DUN-14 suelto se interpretaba erróneamente como un AI de 2 dígitos desconocido
y se descartaba en silencio (bug real detectado al probar con lector físico en planta). Este
código sigue sin traer SSCC, así que el panel lo rechaza igual (§7) — solo se parsea para poder
mostrarlo en pantalla si aparece junto a un SSCC válido, no para permitir la búsqueda por sí solo.

> **Importante:** en versiones anteriores de este parser, el GTIN-14 (tanto vía AI `01` como
> suelto) se convertía a EAN-13 quitando el dígito indicador inicial (asumiendo que casi siempre es
> `0`). Se quitó esa conversión porque `reflex.HLVLIDP.VICIVL` guarda el identificador **completo,
> con el dígito incluido** (comprobado contra datos reales: `08437012926073`, 14 caracteres) — si
> se buscaba con el 0 recortado, la búsqueda no encontraba el artículo.

---

## 4. Lectura del código de barras (dual)

| Método | Cómo funciona | Cuándo se usa |
|---|---|---|
| **Input manual/HID** (primario) | Un `<input>` con autofocus. Los lectores láser de PDA "teclean" el código como si fuera un teclado físico + `Enter`. `onKeyDown` detecta `Enter` y dispara el parseo. | Siempre disponible, en PC y PDA, sin permisos ni dependencias. |
| **Cámara** (secundario) | Botón "Cámara" que usa la API nativa del navegador **`BarcodeDetector`** (`getUserMedia` + detección en bucle con `requestAnimationFrame`). | Solo aparece si `window.BarcodeDetector` existe (Chrome/Android). Se oculta automáticamente en navegadores sin soporte (ej. Safari/iOS, Firefox). |

> `ponytail:` la cámara usa `BarcodeDetector` nativo (0 dependencias). Si en el futuro hace falta
> soporte de cámara en iOS/Safari o Firefox, subir a una librería como `@zxing/browser` — añadir
> solo si se pide, porque no todos los dispositivos objetivo (PDA Android) lo necesitan.

### 4.1 Cámara sobre HTTP en LAN (sin HTTPS)

El despliegue de este proyecto es HTTP en LAN, nunca HTTPS (ver `cookieOptions()` en
`lib/auth.ts`, que ya asume esto para las cookies). Con HTTP, el navegador solo considera
"contexto seguro" a `localhost` — un móvil accediendo por IP (ej. `http://192.168.2.102:3001`)
no lo es, y Chrome/Android **oculta `BarcodeDetector` y `getUserMedia`** aunque el navegador los
soporte en general. No es un bug de la app: no hay forma de habilitarlo desde el servidor.

**Workaround por dispositivo** (solo si un móvil/PDA concreto necesita la cámara; el input
manual/HID no lo necesita y funciona igual):
1. En Chrome del dispositivo, ir a `chrome://flags/#unsafely-treat-insecure-origin-as-secure`
2. Añadir el origen exacto (ej. `http://192.168.2.102:3001`, o la URL/puerto reales)
3. Activar el flag y reiniciar Chrome

Configuración manual de una vez por dispositivo, no algo que se resuelva en el código.

---

## 5. Conexión a Reflex (SQL Server)

`lib/reflex.ts` sigue el mismo patrón que `lib/db.ts` (Oracle): lee credenciales de `.env.local`,
lanza un error claro si falta alguna, y devuelve una conexión que la ruta debe cerrar en su
`finally` (`conn.close()`).

### 5.1 Variables de entorno (`.env.local`, nunca commiteadas)

```
REFLEX_HOST=
REFLEX_PORT=1433
REFLEX_DATABASE=
REFLEX_USER=
REFLEX_PASSWORD=
```

### 5.2 Driver

`mssql` (paquete JS puro sobre `tedious`, sin binarios nativos — no requiere entrada en
`serverExternalPackages` de `next.config.ts`).

---

## 6. Esquema real de Reflex

Confirmado y verificado contra la base de datos de test `RFXTEST`. Cuatro tablas encadenadas
(la búsqueda es siempre por SSCC — `reflex.HLVLIDP`, que relaciona EAN → artículo, no se usa):

| Tabla | Descripción | Campos usados |
|---|---|---|
| `reflex.HLARTIP` | Maestro de artículo (descripción + activo/inactivo) | `ARCART` (artículo), `ARLART` (descripción), `ARTOPD` (0=activo, 1=desactivado) |
| `reflex.HLGEINP` | Elemento (lote/SSCC) en stock, por artículo | `GECART` (artículo), `GENSUP` (SSCC), `GELOTF` (lote), `GEQGEI` (cantidad), `GEJDLC`/`GEMDLC`/`GEADLC` (día/mes/año de DLC), `GEJDLU`/`GEMDLU`/`GEADLU` (día/mes/año de DLU, fallback) |
| `reflex.HLSUPPP` | Soporte (palet/SSCC) → depósito + ubicación | `SUNSUP` (SSCC), `SUCDPO` (depósito), `SUNEMP` (nº ubicación) |
| `reflex.HLEMPLP` | Maestro de ubicaciones | `EMCDPO` (depósito/planta), `EMNEMP` (nº ubicación), `EMC1EM`..`EMC5EM` (código ubicación), `EMLIEM` (descripción ubicación) |

### 6.1 Encadenamiento (JOIN)

```
HLGEINP.GECART IN (SELECT GECART FROM HLGEINP WHERE GENSUP = @sscc)
                                  → identifica el artículo a partir del SSCC escaneado, y
                                    devuelve TODOS los lotes de ese artículo (no solo el
                                    SSCC escaneado), necesario para la validación FEFO (§7.2)
HLARTIP.ARCART = HLGEINP.GECART
  AND HLARTIP.ARTOPD = 0          → descripción del artículo, solo si está activo (INNER JOIN)
HLSUPPP.SUNSUP = HLGEINP.GENSUP  → obtiene depósito+nº ubicación del soporte (LEFT JOIN)
HLEMPLP.EMCDPO = HLSUPPP.SUCDPO
  AND HLEMPLP.EMNEMP = HLSUPPP.SUNEMP → obtiene descripción/código de ubicación y planta (LEFT JOIN)
```

El `IN` en vez de `=` en el filtro por SSCC es por si el mismo SSCC tuviera más de una fila en
`HLGEINP`.

Los JOIN hacia `HLSUPPP`/`HLEMPLP` son `LEFT` a propósito: si un lote no tiene soporte físico
asociado (ej. en tránsito), sigue apareciendo en el listado con ubicación `null`, en vez de
desaparecer silenciosamente.

El JOIN hacia `HLARTIP` es **INNER** a propósito, con `ARTOPD = 0`: si el artículo del palet
escaneado está desactivado, la consulta no devuelve filas y el panel lo trata igual que un SSCC no
encontrado (no se distingue "desactivado" de "no existe").

Filtro `g.GEQGEI > 0` — igual que `/caducados` con `LIPQOH > 0`, solo interesa stock con cantidad
positiva.

### 6.2 Fecha de caducidad (DLC / DLU)

`HLGEINP` guarda **dos** fechas candidatas, cada una en 3 campos separados (día/mes/año, año a 2
dígitos, `25` → 2025, sin lógica de siglo tipo JDE):

- **DLC** (`GEJDLC`/`GEMDLC`/`GEADLC`) — fecha de caducidad "principal".
- **DLU** (`GEJDLU`/`GEMDLU`/`GEADLU`) — fecha alternativa, usada por artículos que no rellenan la
  DLC (confirmado con datos reales: un artículo con las 3 columnas de DLC a `0` en sus 30 lotes,
  pero DLU sí poblada).

`buildFechaCaducidadConFallback()` en el route construye la DLC con `buildFechaCaducidad()`
(ISO `YYYY-MM-DD` sumando `2000 + año`); si sale `null` (cualquiera de los 3 campos a `0`), repite
el cálculo con los campos DLU. Como no todos los lotes usan la misma fuente, el `ORDER BY` de la
query no basta para garantizar FEFO — los `lotes` se reordenan en JS por la `fechaCaducidad` ya
resuelta (nulls al final) antes de devolver la respuesta.

### 6.3 Planta

`HLEMPLP.EMCDPO` (código de depósito/planta) se traduce a nombre legible con un mapa fijo en el
propio route (`PLANTAS`), confirmado directamente por el usuario:

| Código | Planta |
|---|---|
| `001` | Aguilar |
| `002` | Corella |
| `004` | Funes |
| `006` | Tudefrigo |

El mismo mapa está duplicado en `app/consulta-stock-pda/page.tsx` (solo para poblar el `<select>`
de planta) — son 4 líneas fijas, no se ha extraído a un módulo compartido para no crear un archivo
nuevo solo por eso.

El panel tiene un selector de planta (`<select>`, valor vacío = "Todas"). Si se elige una, el
parámetro `planta` (código, ej. `002`) se manda en **todas** las peticiones — filtra tanto el
listado de lotes como la validación de SSCC (§7.2) a esa planta.

Si el usuario logueado tiene una planta por defecto asignada en `/admin` (ver `lib/plants.ts` y
`DOCUMENTACION.md` §4), al comprobar la sesión (`checkAccess`) se preselecciona en este `<select>`
mapeada al código Reflex con `plantReflexCode()`. A diferencia de `/produccion`, este panel sí
tiene opción para las 4 plantas, así que aquí nunca cae a "Todas" por planta no soportada.

### 6.4 Descripción de artículo

`HLARTIP.ARLART` da la descripción legible del artículo (`ARCART` = código). El panel muestra
`{código} {descripción}` junto al listado de lotes.

---

## 7. API — `GET /api/consulta-stock-pda`

| Parámetro | Tipo | Validación |
|---|---|---|
| `sscc` | string, **obligatorio** | `/^\d{18}$/` (SSCC de palet, AI `00` de GS1-128) — 400 si falta o no cumple el formato |
| `planta` | string, opcional | Debe ser una clave de `PLANTAS` (`001`/`002`/`004`/`006`) — 400 si no |

No se acepta búsqueda por EAN. Si `sscc` falta, la API responde 400 con
"Debes escanear el número de palet (SSCC)".

Respuesta:
```json
{
  "articulo": "1313300003",
  "descripcion": "JAMON COCIDO EXTRA 1KG",
  "lotes": [
    {
      "lote": "250110240D",
      "sscc": "584370129261191942",
      "cantidad": 1000,
      "fechaCaducidad": "2025-01-31",
      "ubicacion": "Cámara 2 - Suelo 1",
      "planta": "Corella"
    }
  ],
  "validacionSscc": {
    "estado": "correcto",
    "mensaje": "Correcto para consumir: no hay lotes que caduquen antes"
  }
}
```

Los lotes vienen ya ordenados por caducidad ascendente (FEFO) — ver §6.2 para el porqué del
reordenado final en JS en vez de confiar solo en el `ORDER BY` de la query. El primero de la lista
se resalta en la tabla con el badge "Primero en caducar".

### 7.1 Resaltado de filas por caducidad

`app/consulta-stock-pda/page.tsx` colorea cada fila según cuántos días quedan hasta
`fechaCaducidad` (`filaCaducidadClassName()`):

| Estado | Condición | Estilo |
|---|---|---|
| Caducado | días restantes < 0 | fondo rojo (`bg-red-50`) |
| Próximo a caducar | 0 ≤ días restantes ≤ `DIAS_AVISO_CADUCIDAD` (5) | fondo ámbar (`bg-amber-50`) |
| Normal | días restantes > 5 | sin resaltado |

`DIAS_AVISO_CADUCIDAD` es una constante en el propio archivo — cambiar ahí el umbral de 5 días si
el almacén pide otro valor.

Además, la fila cuyo `sscc` coincide con el SSCC recién escaneado (`parsed.sscc`) siempre lleva un
badge **"Escaneado"** junto al SSCC, sea cual sea el color de fondo de la fila. Si esa fila no
tiene ya aviso de caducidad (rojo/ámbar manda, por ser más urgente), además se tiñe en tono de
marca (`bg-primary/10`) para localizarla de un vistazo en listados largos —
`filaClassName()` en `page.tsx` decide esta prioridad.

### 7.2 Validación FEFO por SSCC

Como toda búsqueda se hace por SSCC, la API responde siempre si el palet escaneado es correcto para
consumir o si hay otro lote del mismo artículo que caduca antes.

La comparación se hace **después** de construir y ordenar `lotes` (mismo array que se devuelve
para la tabla, ya filtrado por `planta` si se indicó) — no es una query aparte:

| `estado` | Cuándo | Ejemplo de `mensaje` |
|---|---|---|
| `correcto` | Ningún otro lote tiene `fechaCaducidad` estrictamente menor que la del SSCC escaneado (empate cuenta como correcto) | "Correcto para consumir: no hay lotes que caduquen antes" |
| `incorrecto` | Existe al menos un lote con `fechaCaducidad` anterior | "Este palet no se puede consumir: hay lotes de este artículo que caducan antes" |
| `no_encontrado` | El SSCC no aparece en `lotes` (consumido ya, cantidad a 0, o no está en la planta filtrada) | "Palet no está en stock en Corella" (o sin "en X" si no se filtró planta) |
| `sin_fecha` | El SSCC escaneado sí está en stock pero su `fechaCaducidad` es `null` (ni DLC ni DLU) | "Este palet no tiene fecha de caducidad registrada; no se puede comprobar si hay lotes anteriores" |

### 7.3 Rechazo de códigos sin SSCC (EAN suelto, etc.)

Si el código escaneado no trae SSCC (ej. el EAN-13/DUN-14 suelto de la etiqueta del artículo, o un
código sin AI `00`), `handleScan()` en `page.tsx` no llama a la API: muestra directamente el error
"Debes escanear el número de palet (SSCC), no el código del artículo". Buscar solo por EAN no
permite identificar qué palet concreto se tiene en la mano ni validar FEFO por SSCC (§7.2), que es
el objetivo del panel.

Por si algún llamador externo o futuro cambio de cliente saltara esta comprobación, el servidor
(`route.ts`) también exige `sscc` y responde 400 si falta — la validación no depende solo del
cliente.

---

## 8. Logging de consultas

Cada consulta inserta un registro en `query_logs` (SQLite) con `source = 'consulta_stock_pda'` y
`filters: { sscc, planta? }` (`planta` solo si se usó). El logging nunca bloquea la respuesta
(try/catch independiente), igual que en el resto de paneles.

---

## 9. Registro del panel

- `lib/panels.ts` → entrada `consulta_stock_pda` en `PANELS` (icono `ScanBarcode`) — fuente única que alimenta Navbar, portada, login y permisos de admin (ver `docs/design-system.md` §5.1).
- `lib/sqlite.ts` → seed en la tabla `screens` (`is_public=1` por defecto).
