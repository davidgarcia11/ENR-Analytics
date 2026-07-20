# Documentación — Consulta de stock por escaneo (`/consulta-stock-pda`)

> Documentación específica del panel de consulta de stock FEFO por escaneo de palet.
> Ver [DOCUMENTACION.md](../DOCUMENTACION.md) para la documentación base del proyecto.

---

## 1. Descripción general

Panel pensado para operarios de almacén: escanean el código de barras de un palet (con pistola
láser en PDA, o cámara en móvil/PC) y el panel muestra el artículo identificado y el stock de ese
artículo **ordenado por fecha de caducidad ascendente** (FEFO — First Expired, First Out), para
saber qué palet coger primero.

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

Solo se usa el **EAN** (`fields.ean`) para buscar el artículo; el resto de campos (lote, cantidad,
SSCC, fechas) se muestran en pantalla como referencia del propio palet escaneado, no se usan en la
consulta al servidor.

### 3.3 EAN-13 / DUN-14 sueltos (sin envoltorio de AIs)

En las etiquetas reales, el **SSCC del palet** va en GS1-128 (AI `00`), pero el **artículo** suele
llevar su propio barcode "pelado" — directamente los 13 dígitos del EAN-13, o los 14 del DUN-14
(GTIN-14), sin ningún AI alrededor. `parseGs1()` comprueba esto **antes** de intentar el parseo por
AIs:

- Cadena de **exactamente 13 dígitos** → se usa tal cual como EAN.
- Cadena de **exactamente 14 dígitos** → se usa tal cual (DUN-14/GTIN-14), **sin quitar el dígito
  indicador inicial**.

Sin esto, un EAN-13/DUN-14 suelto se interpretaba erróneamente como un AI de 2 dígitos desconocido
y se descartaba en silencio (bug real detectado al probar con lector físico en planta).

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

Confirmado y verificado contra la base de datos de test `RFXTEST`. Cuatro tablas encadenadas:

| Tabla | Descripción | Campos usados |
|---|---|---|
| `reflex.HLVLIDP` | Identificador (EAN) de una variante logística de artículo | `VICIVL` (EAN), `VICART` (artículo) |
| `reflex.HLGEINP` | Elemento (lote/SSCC) en stock, por artículo | `GECART` (artículo), `GENSUP` (SSCC), `GELOTF` (lote), `GEQGEI` (cantidad), `GEJDLC`/`GEMDLC`/`GEADLC` (día/mes/año de caducidad) |
| `reflex.HLSUPPP` | Soporte (palet/SSCC) → depósito + ubicación | `SUNSUP` (SSCC), `SUCDPO` (depósito), `SUNEMP` (nº ubicación) |
| `reflex.HLEMPLP` | Maestro de ubicaciones | `EMCDPO` (depósito/planta), `EMNEMP` (nº ubicación), `EMC1EM`..`EMC5EM` (código ubicación), `EMLIEM` (descripción ubicación) |

### 6.1 Encadenamiento (JOIN)

```
HLVLIDP.VICIVL = @ean            → obtiene VICART (artículo)
HLGEINP.GECART = HLVLIDP.VICART  → obtiene lote/SSCC/cantidad/caducidad (INNER JOIN)
HLSUPPP.SUNSUP = HLGEINP.GENSUP  → obtiene depósito+nº ubicación del soporte (LEFT JOIN)
HLEMPLP.EMCDPO = HLSUPPP.SUCDPO
  AND HLEMPLP.EMNEMP = HLSUPPP.SUNEMP → obtiene descripción/código de ubicación y planta (LEFT JOIN)
```

Los JOIN hacia `HLSUPPP`/`HLEMPLP` son `LEFT` a propósito: si un lote no tiene soporte físico
asociado (ej. en tránsito), sigue apareciendo en el listado con ubicación `null`, en vez de
desaparecer silenciosamente.

Filtro `g.GEQGEI > 0` — igual que `/caducados` con `LIPQOH > 0`, solo interesa stock con cantidad
positiva.

### 6.2 Fecha de caducidad

`HLGEINP` guarda la caducidad en **3 campos separados** (día/mes/año), con el **año a 2 dígitos**
(`25` → 2025, sin lógica de siglo tipo JDE). `buildFechaCaducidad()` en el propio route construye
el ISO `YYYY-MM-DD` sumando `2000 + año`.

### 6.3 Planta

`HLEMPLP.EMCDPO` (código de depósito/planta) se traduce a nombre legible con un mapa fijo en el
propio route (`PLANTAS`), confirmado directamente por el usuario:

| Código | Planta |
|---|---|
| `001` | Aguilar |
| `002` | Corella |
| `004` | Funes |
| `006` | Tudefrigo |

### 6.4 Sin descripción de artículo

No hay (todavía) una tabla de descripción de artículo confirmada para este flujo — el panel
muestra el **código** de artículo (`GECART`/`VICART`), no un nombre legible. Añadir la descripción
más adelante si se localiza la tabla adecuada (candidata: `HLARTIP.ARLART` en el volcado de
esquema general, pendiente de confirmar que aplica a esta base de datos).

---

## 7. API — `GET /api/consulta-stock-pda`

| Parámetro | Tipo | Validación |
|---|---|---|
| `ean` | string | `/^\d{8,14}$/` (EAN-8/12/13 o GTIN-14) — 400 si no cumple |

Respuesta:
```json
{
  "articulo": "1313300003",
  "lotes": [
    {
      "lote": "250110240D",
      "sscc": "584370129261191942",
      "cantidad": 1000,
      "fechaCaducidad": "2025-01-31",
      "ubicacion": "Cámara 2 - Suelo 1",
      "planta": "Corella"
    }
  ]
}
```

Los lotes vienen ya ordenados por caducidad ascendente desde la query (FEFO). El primero de la
lista se resalta en la tabla con el badge "Primero en caducar".

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

---

## 8. Logging de consultas

Cada consulta inserta un registro en `query_logs` (SQLite) con `source = 'consulta_stock_pda'` y
`filters: { ean }`. El logging nunca bloquea la respuesta (try/catch independiente), igual que en
el resto de paneles.

---

## 9. Registro del panel

- `components/Navbar.tsx` → entrada `consulta_stock_pda` en el array `PANELS` (icono `ScanBarcode`).
- `lib/sqlite.ts` → seed en la tabla `screens` (`is_public=1` por defecto).
