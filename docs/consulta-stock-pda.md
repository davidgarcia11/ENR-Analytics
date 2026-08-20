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
si ese palet en concreto es correcto para consumir o si hay otro lote que caduca antes, si está
caducado o bloqueado por calidad (§7.3). El stock se agrupa por lote, con el detalle por palet
desplegable (§7.1), y cada escaneo exige aceptar un pop-up que queda registrado (§8) — trazabilidad
por si un producto se mete erróneamente en línea y hay que saber a quién le salió el aviso.

**Solo se busca por SSCC** (número de palet, AI `00` de GS1-128) — nunca por el EAN del artículo.
Si se escanea el EAN "pelado" de la etiqueta del artículo (sin SSCC), el panel rechaza el escaneo
con el mensaje "Debes escanear el número de palet (SSCC), no el código del artículo": buscar solo
por EAN no permite validar qué palet concreto coger (§7.3), que es el objetivo del panel.

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
| `app/api/consulta-stock-pda/route.ts` | API Route servidor — consulta a Reflex (SQL Server), agrupado por lote y validación FEFO/calidad |
| `app/api/consulta-stock-pda/confirmaciones/route.ts` | API Route servidor — registra la aceptación del pop-up (§8.2) en SQLite |
| `app/api/admin/scan-confirmations/route.ts` | API Route servidor — lista/filtra las confirmaciones registradas (§8.2), solo admin |
| `app/admin/logs/page.tsx` | Pestaña "Confirmaciones PDA" (además de la ya existente "Consultas") — ver §8.2 |
| `lib/reflex.ts` | Conexión a SQL Server (Reflex), análoga a `lib/db.ts` para Oracle |
| `lib/gs1.ts` | Parser de códigos de barras GS1-128 (separa EAN/lote/cantidad/SSCC/fechas) |
| `lib/plants.ts` | Fuente única de plantas y de las sub-plantas de Funes (§7.5) |
| `__tests__/gs1.test.ts` | Tests del parser GS1 |
| `__tests__/consulta-stock-pda-validacion.test.ts` | Tests de la validación FEFO y del filtro de sub-planta (§7.5) |

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
| `reflex.HLSUPPP` | Soporte (palet/SSCC) → depósito + ubicación + calidad | `SUNSUP` (SSCC), `SUCDPO` (depósito), `SUNEMP` (nº ubicación), `SUCQAL` (código de calidad) |
| `reflex.HLEMPLP` | Maestro de ubicaciones | `EMCDPO` (depósito/planta), `EMCMGN` (sub-planta, ver §7.5), `EMNEMP` (nº ubicación), `EMC1EM`..`EMC5EM` (código ubicación), `EMLIEM` (descripción ubicación) |

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

### 6.1b Bloqueo de calidad (`SUCQAL`)

`HLSUPPP.SUCQAL` es el código de calidad del soporte/palet. `esBloqueadoPorCalidad()` en el route
lo recorta y compara: `'STD'` (calidad estándar) = válido para consumir, **cualquier otro código**
= bloqueado. Confirmado consultando datos reales de Reflex — la mayoría son `STD`, pero hay muchos
códigos de bloqueo distintos (`CAD`, `CAL`, `CUA`, `PTE`, `ROT`, `OBS`, `SOB`, `NOC`, `M01`..`M09`,
entre otros). El mensaje al operario no distingue el motivo concreto (solo "bloqueado por
Calidad"): el código exacto no es accionable desde el PDA, solo importa que no se puede consumir.

`SUCQAL` viene de un `LEFT JOIN`, pero en la práctica todo palet con stock (`GEQGEI > 0`) tiene fila
en `HLSUPPP` (comprobado: cobertura 100%) — si algún día no la tuviera, se trata como no bloqueado
(mismo criterio defensivo que la ubicación en §6.1).

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

Funes se subdivide además en dos naves, y eso cambia qué palet hay que coger — ver §7.5.

### 6.4 Descripción de artículo

`HLARTIP.ARLART` da la descripción legible del artículo (`ARCART` = código). El panel muestra
`{código} {descripción}` junto al listado de lotes.

---

## 7. API — `GET /api/consulta-stock-pda`

| Parámetro | Tipo | Validación |
|---|---|---|
| `sscc` | string, **obligatorio** | `/^\d{18}$/` (SSCC de palet, AI `00` de GS1-128) — 400 si falta o no cumple el formato |
| `planta` | string, opcional | Debe ser una clave de `PLANTAS` (`001`/`002`/`004`/`006`) — 400 si no |
| `subplanta` | string, opcional | Solo válida con `planta=004` (Funes) — 400 si se manda con otra planta o si no es `004`/`005`. Ver §7.5 |

No se acepta búsqueda por EAN. Si `sscc` falta, la API responde 400 con
"Debes escanear el número de palet (SSCC)".

Respuesta:
```json
{
  "articulo": "1313300003",
  "descripcion": "JAMON COCIDO EXTRA 1KG",
  "grupos": [
    {
      "lote": "250110240D",
      "fechaCaducidad": "2025-01-31",
      "cantidadTotal": 2000,
      "cantidadBloqueada": 500,
      "totalPalets": 2,
      "paletsBloqueados": 1,
      "palets": [
        {
          "lote": "250110240D",
          "sscc": "584370129261191942",
          "cantidad": 1500,
          "fechaCaducidad": "2025-01-31",
          "ubicacion": "Cámara 2 - Suelo 1",
          "planta": "Corella",
          "caducado": false,
          "bloqueado": false,
          "primeroEnCaducar": true
        },
        {
          "lote": "250110240D",
          "sscc": "584370129261191943",
          "cantidad": 500,
          "fechaCaducidad": "2025-01-31",
          "ubicacion": "Cámara 2 - Suelo 2",
          "planta": "Corella",
          "caducado": false,
          "bloqueado": true,
          "primeroEnCaducar": false
        }
      ]
    }
  ],
  "validacionSscc": {
    "estado": "correcto",
    "mensajes": ["Correcto para consumir."]
  }
}
```

`grupos` reemplaza al antiguo array plano `lotes` — ver §7.1 para el porqué de agrupar por lote.
Los grupos vienen ordenados por `fechaCaducidad` ascendente (FEFO) — ver §6.2 para el porqué del
reordenado final en JS en vez de confiar solo en el `ORDER BY` de la query.

### 7.1 Agrupado por lote

El panel muestra un **resumen por lote** como lista de tarjetas apiladas (no una tabla de
columnas fijas — ver §7.2b para el porqué), cada una desplegable — mismo concepto que el
desplegable de pedidos por artículo en `/preparacion-pedidos`, pero en tarjeta en vez de fila de
tabla — que revela el detalle por palet (también en tarjetas: SSCC, caducidad, cantidad,
ubicación). El route agrupa los palets (`palets` en la respuesta anterior a agrupar) por
`GELOTF` con un `Map<lote, palets[]>` y calcula, por lote:

- `fechaCaducidad`: la del primer palet del lote que tenga fecha (en la práctica todos los palets
  de un mismo lote comparten fecha, es el mismo dato de fabricación).
- `cantidadTotal` / `cantidadBloqueada`: suma de `GEQGEI` de todos los palets del lote / solo de
  los bloqueados (§6.1b).
- `totalPalets` / `paletsBloqueados`: recuento de palets del lote / solo bloqueados.

En la cabecera de la tarjeta (visible **sin desplegar**), si `paletsBloqueados > 0` lleva un badge
tipo "2/5 bloqueados", y si `cantidadBloqueada > 0` otro badge "500/2000 bloqueada" — mismo
componente `<Badge>` que usa el badge "Escaneado" del detalle. Al desplegar un lote, `page.tsx`
abre por defecto (`expandedLotes`) el lote que contiene el SSCC recién escaneado.

**Qué lote se está leyendo, sin desplegar:** `loteContieneEscaneado()` marca la tarjeta del lote
que contiene el SSCC recién escaneado con un badge **"Escaneado"** en la cabecera y un borde/anillo
en rojo corporativo (`border-primary ring-1 ring-primary`) — visible tanto si la tarjeta está
desplegada como colapsada. Antes solo se veía el "Escaneado" en el detalle del palet, había que
desplegar el lote para saber cuál era.

### 7.2 Resaltado por caducidad

`app/consulta-stock-pda/page.tsx` colorea el fondo de cada tarjeta (tanto la de resumen del lote
como las de detalle por palet) según cuántos días quedan hasta `fechaCaducidad`
(`fondoCaducidadClassName()`):

| Estado | Condición | Estilo |
|---|---|---|
| Caducado | días restantes < 0 | fondo rojo (`bg-red-50`) |
| Próximo a caducar | 0 ≤ días restantes ≤ `DIAS_AVISO_CADUCIDAD` (5) | fondo ámbar (`bg-amber-50`) |
| Normal | días restantes > 5 | sin resaltado |

`DIAS_AVISO_CADUCIDAD` es una constante en el propio archivo — cambiar ahí el umbral de 5 días si
el almacén pide otro valor.

En el detalle por palet, además del color de fondo, cada tarjeta lleva badges explícitos calculados
por el route (no solo color, para que el estado se entienda sin ambigüedad):

- **"Caducado"** (rojo) si `palet.caducado` es `true` — sustituye a cualquier otro badge de
  caducidad; un palet caducado **nunca** lleva "Primero en caducar" (ver §7.3). En la cabecera del
  lote (sin desplegar) se muestra el mismo badge si **algún** palet del lote está caducado
  (`grupo.palets.some(p => p.caducado)`).
- **"Primero en caducar"** (ámbar) si `palet.primeroEnCaducar` es `true` — solo puede haber uno por
  artículo, y solo entre los palets consumibles (§7.3). Solo se muestra en el detalle por palet:
  es una distinción a nivel de palet concreto, no de lote.
- **"Escaneado"** (rojo corporativo) si el `sscc` coincide con el SSCC recién escaneado
  (`parsed.sscc`) — también en la cabecera del lote, ver §7.1.
- **"Bloqueado por Calidad"** (rojo) si `palet.bloqueado` es `true` (§6.1b).

Si la tarjeta del palet no tiene ya aviso de caducidad (rojo/ámbar manda, por ser más urgente) y es
la del SSCC escaneado, además se tiñe en tono de marca (`bg-primary/10`) —
`paletClassName()` en `page.tsx` decide esta prioridad.

### 7.2b Tarjetas apiladas en vez de tabla — por qué

Este panel es de uso casi exclusivo en PDA/móvil de almacén (a diferencia de paneles de oficina
como `/produccion`). Una tabla con columnas fijas (Lote, Caducidad, SSCC, Cantidad, Ubicación, más
los badges de bloqueo) no cabe en una pantalla de PDA de 320-375px de ancho sin scroll horizontal
— y el operario necesita ver toda la información **sin desplazarse lateralmente**, con las manos
ocupadas o con guantes.

Por eso tanto el resumen por lote como el detalle por palet se pintan como listas de `<div>`
apiladas (cada campo en su propia línea, envuelto con `flex-wrap`), no con `<Table>`/`<table>` de
columnas fijas — es la única vista de la app que se desvía del componente `Table` de
`components/ui/` (ver `docs/design-system.md` §4), justificado porque el dispositivo objetivo real
es distinto al del resto de paneles. Verificado en viewport móvil (375px) y tablet (768px): ningún
elemento fuerza scroll horizontal (`document.documentElement.scrollWidth` = `clientWidth`).

### 7.3 Validación del SSCC escaneado

Como toda búsqueda se hace por SSCC, la API responde siempre si el palet escaneado se puede
consumir o no, y por qué. La respuesta es una lista de `mensajes` (no un único mensaje): si
coinciden varios problemas a la vez (ej. un palet caducado que además está bloqueado), se listan
**todos**, en este orden de prioridad — ver el porqué de cada uno en §6.1b/§7.1/§6.2:

1. **Caducado** — `palet.caducado` (por palet).
2. **Bloqueado por Calidad** — `palet.bloqueado` (por palet).
3. **Hay lote anterior** — solo se comprueba si el palet **no** está caducado ni bloqueado (no
   tiene sentido decir "hay uno antes" de un palet que de por sí no se puede consumir), y solo
   contra otros **lotes** que **tampoco** estén caducados ni bloqueados (`consumibles` en el route,
   excluyendo el lote escaneado entero — ver §7.5) — no sirve de nada recomendar como alternativa
   un palet que en realidad tampoco se puede consumir.

Toda la lógica vive en `validarPaletEscaneado()`, una función pura exportada desde el route y
cubierta por `__tests__/consulta-stock-pda-validacion.test.ts`.

| `estado` | Cuándo | `mensajes` |
|---|---|---|
| `aviso` | Caducado, bloqueado, y/o hay un lote consumible anterior (uno o varios a la vez) | Uno o más de: "Este palet no se puede consumir: está Caducado.", "...: está bloqueado por Calidad.", "...: hay lotes de este artículo que caducan antes." |
| `correcto` | Ni caducado, ni bloqueado, ni hay ningún lote consumible con caducidad anterior | `["Correcto para consumir."]` |
| `no_encontrado` | El SSCC no aparece en los palets devueltos (consumido ya, cantidad a 0, o no está en la planta/sub-planta filtrada) | `["Palet no está en stock en Corella"]` (con el nombre de la sub-planta si se filtró por una, ej. "en Funes 1") |
| `otra_subplanta` | El **lote** del SSCC escaneado no está en la sub-planta consultada pero sí en la otra nave de Funes — ver §7.5 | `["Este lote está en Funes 2, no en Funes 1."]` |
| `sin_fecha` | El SSCC escaneado sí está en stock, no está bloqueado, pero su `fechaCaducidad` es `null` (ni DLC ni DLU) | `["Este palet no tiene fecha de caducidad registrada; no se puede comprobar si hay lotes anteriores."]` |

El `estado` sigue sirviendo para el color del aviso en pantalla (verde=correcto,
ámbar=sin_fecha/otra_subplanta, rojo=aviso/no_encontrado) — ver §8 para dónde se muestra (banner en
la página + pop-up obligatorio).

### 7.4 Rechazo de códigos sin SSCC (EAN suelto, etc.)

Si el código escaneado no trae SSCC (ej. el EAN-13/DUN-14 suelto de la etiqueta del artículo, o un
código sin AI `00`), `handleScan()` en `page.tsx` no llama a la API: muestra directamente el error
"Debes escanear el número de palet (SSCC), no el código del artículo". Buscar solo por EAN no
permite identificar qué palet concreto se tiene en la mano ni validar FEFO por SSCC (§7.3), que es
el objetivo del panel.

Por si algún llamador externo o futuro cambio de cliente saltara esta comprobación, el servidor
(`route.ts`) también exige `sscc` y responde 400 si falta — la validación no depende solo del
cliente.

### 7.5 Sub-plantas de Funes

**El problema:** Funes tiene dos naves físicas, y el stock de un mismo artículo se reparte entre
ellas (comprobado con datos reales: 2.746 palets con stock en una y 233 en la otra, y decenas de
artículos presentes en ambas). Sin distinguirlas, el panel podía decirle a un operario de una nave
"hay lotes que caducan antes" por un palet que está en la nave de al lado y al que no tiene acceso
— o al revés, darle por bueno un palet cuando en su propia nave había otro anterior.

**El dato:** `HLEMPLP.EMCMGN` (magasin/sub-planta de la ubicación). En el depósito de Funes
(`EMCDPO = '004'`):

| `EMCMGN` | Nave | Ubicaciones | Palets con stock |
|---|---|---|---|
| `004` | Funes 1 | 688 | 2.746 |
| `005` | Funes 2 | 542 | 233 |
| *(vacío)* | — | 31 | 0 |

> **`EMCMGN` NO es único entre depósitos.** Comprobado contra datos reales: el valor `001` aparece
> en los depósitos `001` y `002`, y `006` en `002` y `006`. Solo `004`/`005` son exclusivos de
> Funes. **Cualquier filtro por sub-planta debe ir siempre acompañado del depósito**
> (`EMCDPO = '004'`), nunca por `EMCMGN` suelto — de ahí que `plantHasSubplants()` en
> `lib/plants.ts` valide primero la planta.

No mapean 1:1 con las sub-líneas de `/produccion` (que salen de JDE y son **tres**: Funes 1 /
Funes 2 / Funes Past.) — son sistemas distintos, con granularidades distintas. `lib/plants.ts` es
la fuente única de ambos códigos.

**Cómo se pide al operario.** Cuando la planta seleccionada es Funes (venga de su planta por
defecto o la elija a mano en el `<select>`), aparece un segundo selector **"Sub-planta"**
(`¿Dónde estás?` / Funes 1 / Funes 2) y `handleScan()` **rechaza el escaneo** hasta que se elija
("Elige primero en qué sub-planta de Funes estás"), con un aviso ámbar explicando por qué. Al
cambiar de planta, la sub-planta elegida se limpia (`handlePlantaChange`). Fuera de Funes el
selector no existe.

Se eligió un selector fijo (que se elige una vez y queda visible) en vez de preguntar en cada
escaneo: repetir la misma pregunta decenas de veces por turno entrena a responder sin leer, y eso
contamina el pop-up que de verdad importa (§8.2), que quedaría como segundo modal seguido. El
riesgo del selector fijo —que se quede desactualizado si el operario cambia de nave— se cubre con
la detección cruzada de abajo, que lo caza con el dato real en vez de fiarse de su memoria.

**La unidad de decisión es el LOTE, no el palet.** Lo que determina si el operario puede consumir
es si ese **lote** está en su nave y si hay otro **lote** de su nave que caduque antes. El palet
solo aporta su propio estado (caducado / bloqueado, que sí es por palet: dentro de un mismo lote
puede haber palets bloqueados y otros no — caso real, el lote `M-C-B/4` con 19 de 20 bloqueados).

Esto importa porque un lote puede estar repartido entre las dos naves — y, comprobado con datos
reales, incluso con **fechas distintas según el palet** (el lote `123456` del artículo `1313300003`
resuelve `2026-05-25` en sus 2 palets de Funes 1 y `2026-08-04` en sus 23 de Funes 2, por la mezcla
DLC/DLU de §6.2). Por eso la comparación de "hay lotes que caducan antes" excluye el **lote**
escaneado entero, no solo el palet: si no, un palet avisaría contra otro palet de su propio lote.

**Detección cruzada (`estado: 'otra_subplanta'`).** El filtro de sub-planta **no** se aplica en
SQL: la query trae `EMCMGN` como columna y el filtro se hace después en JS. Así, cuando el SSCC
escaneado no aparece en la nave consultada, el route puede mirar en el conjunto completo
(`todosLosPalets`) y distinguir tres casos:

| Situación | Qué se responde |
|---|---|
| El **lote** entero está en la otra nave | `estado: 'otra_subplanta'` + `subplantaReal`, mensaje *"Este lote está en Funes 2, no en Funes 1."* El pop-up ofrece un botón **"Ver en Funes 2"** que cambia el selector y relanza la consulta sin volver a escanear (`cambiarASubplantaReal` en `page.tsx`, que registra la confirmación igual antes de cambiar). |
| El palet está registrado en la otra nave **pero su lote sí está en la mía** | Se valida con normalidad (el lote está disponible donde el operario está) y se añade una `nota`: *"Ojo: este palet está registrado en Funes 2, aunque el lote sí está en Funes 1."* — es el caso de un movimiento físico sin registrar, y no tiene sentido cortarle el flujo. |
| El SSCC no existe en ninguna nave | El `no_encontrado` de siempre. |

`nota` es información secundaria y se muestra en **cualquier** estado, incluido `correcto` (a
diferencia de `mensajes`, que en `correcto` no se pintan porque el titular ya lo dice todo).

**Palets sin sub-planta asignada** (`EMCMGN` vacío) se dejan pasar **siempre**, sea cual sea la
nave elegida: son ubicaciones de tránsito/playa de Funes (muelles, transpaletas, apiladoras — hoy 0
palets con stock), accesibles desde cualquier nave. Filtrarlas escondería stock real; mismo criterio
defensivo que los `LEFT JOIN` de §6.1.

**Un lote presente en las dos naves** se muestra solo con los palets de la nave consultada — la
cantidad total y el recuento de bloqueados del lote (§7.1) se calculan con esos, para que reflejen
lo que el operario realmente puede coger ahí, no stock que no tiene a mano.

El filtro de sub-planta afecta a **todo** lo que se calcula después: el listado agrupado (§7.1), el
"primero en caducar" y la comparación de "hay lotes que caducan antes" (§7.3).

**Tests:** `__tests__/consulta-stock-pda-validacion.test.ts` cubre esta lógica (`validarPaletEscaneado()`,
función pura exportada desde el route) con los casos construidos a partir de los datos reales de
arriba — incluido el que motiva la funcionalidad: un lote anterior en la otra nave **no** debe
avisar, y sin filtro de sub-planta sí.

---

## 8. Pop-up obligatorio y logging

### 8.1 Logging de la consulta

Cada consulta inserta un registro en `query_logs` (SQLite) con `source = 'consulta_stock_pda'` y
`filters: { sscc, planta?, subplanta? }` (los dos últimos solo si se usaron). El logging nunca bloquea la respuesta
(try/catch independiente), igual que en el resto de paneles. Esto registra *qué se consultó*, no
quién aceptó qué aviso — para eso está §8.2.

### 8.2 Pop-up de confirmación (`stock_scan_confirmations`)

Cada vez que el escaneo resuelve un `validacionSscc` (siempre que hay resultado, incluido
`estado: 'correcto'`), `page.tsx` abre un `<Dialog>` **no descartable** (`dismissible={false}` en
`components/ui/dialog.tsx` — ni Escape, ni clic fuera, ni la X lo cierran) con los mismos
`mensajes` que se ven en el banner de la página, y un único botón "Aceptar". El operario tiene que
pulsarlo sí o sí para seguir usando el panel.

El título del pop-up es `Palet {sscc} · Lote {lote} · {sub-planta}` (SSCC completo, sin truncar —
igual que en el detalle por palet, ver §7.2b) — `loteEscaneado` se resuelve buscando en `grupos` qué
lote contiene ese SSCC (mismo cálculo que decide qué lote se despliega por defecto, §7.1). Cada
parte se omite si no aplica: sin lote cuando el SSCC no está en stock (`no_encontrado`), y sin
sub-planta cuando no se está filtrando por una (§7.5).

**Lenguaje visual (`ESTADO_VISUAL` en `page.tsx`)** — pensado para que "se puede o no consumir" se
entienda de un vistazo, sin tener que leer el texto, tanto en el pop-up como en el banner de la
página (comparten la misma tabla de estilos):

| `estado` | Icono grande | Titular | Color |
|---|---|---|---|
| `correcto` | `CheckCircle2` | "SE PUEDE CONSUMIR" | verde |
| `aviso` | `XCircle` | "NO SE PUEDE CONSUMIR" | rojo |
| `no_encontrado` | `PackageX` | "PALET NO ENCONTRADO" | rojo |
| `sin_fecha` | `HelpCircle` | "SIN FECHA DE CADUCIDAD" | ámbar |
| `otra_subplanta` | `MapPinOff` | "ESTÁ EN OTRA SUB-PLANTA" | ámbar |

`otra_subplanta` va en ámbar y no en rojo a propósito: el palet no tiene ningún problema, es que el
operario está consultando la nave equivocada (§7.5) — y su pop-up lleva un botón extra
**"Ver en {la otra nave}"** además del "Aceptar".

Cuando el estado no es `correcto`, cada mensaje de `mensajes[]` se pinta en su propia fila con un
icono según el motivo concreto (`iconoMensaje()`, por coincidencia de texto — no hay un campo
`tipo` en la respuesta de la API, los mensajes son fijos y se controlan en ambos lados):
`CalendarX` (Caducado), `MapPinOff` (otra sub-planta), `ShieldAlert` (Bloqueado por Calidad),
`ArrowLeftRight` (hay lote anterior), `AlertTriangle` como genérico. El botón "Aceptar" del pop-up
también cambia de color según `estado` (verde/rojo/ámbar) — refuerza el mensaje en vez de ser
siempre el rojo corporativo por defecto.

Al pulsar "Aceptar", `acceptAck()` hace `POST /api/consulta-stock-pda/confirmaciones` (best-effort:
si falla la petición, el pop-up se cierra igual — un fallo de red no debe atrapar al operario) con
`{ sscc, articulo, estado, mensajes }`. La ruta inserta en SQLite:

```sql
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

Objetivo: trazabilidad. Si un producto se mete erróneamente en línea, se puede consultar esta tabla
por `sscc` o `articulo` y saber exactamente qué usuario escaneó ese palet, qué aviso vio (el texto
literal, no solo el estado) y a qué hora lo aceptó.

**Dónde verlo:** `/admin/logs` → pestaña **"Confirmaciones PDA"** (junto a la pestaña "Consultas"
existente). Lista paginada con filtros por usuario, resultado (correcto/aviso/no encontrado/sin
fecha), SSCC y rango de fechas — `GET /api/admin/scan-confirmations` (solo admin). Cada fila
muestra fecha, usuario, SSCC completo, artículo y el resultado aceptado con sus mensajes exactos.

---

## 9. Registro del panel

- `lib/panels.ts` → entrada `consulta_stock_pda` en `PANELS` (icono `ScanBarcode`) — fuente única que alimenta Navbar, portada, login y permisos de admin (ver `docs/design-system.md` §5.1).
- `lib/sqlite.ts` → seed en la tabla `screens` (`is_public=1` por defecto).
