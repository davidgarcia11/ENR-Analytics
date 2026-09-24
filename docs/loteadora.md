# Documentación — Loteadora (`/loteadora`)

> Documentación específica del panel de loteadora (impresión de lote y fecha de caducidad).
> Ver [DOCUMENTACION.md](../DOCUMENTACION.md) para la documentación base del proyecto.

---

## 1. Estado actual

**El envío a la loteadora ya es real** (comando `1D` del protocolo TIJ por TCP, ver §6-9). La selección de artículo es directa (búsqueda por código o descripción, sin marca — ver §3).

**Cada artículo tiene una plantilla (mensaje) asociada de forma global** (§13): al elegirlo en `/loteadora`, si tiene plantilla, se carga en la loteadora seleccionada tras confirmarlo (§11). Cada plantilla define **sus campos y qué se imprime en cada uno** (§13): literales como la "L" o "CAD ", la cocida, la caducidad en el formato de cada cliente, datos fijos como un precio... En `/loteadora` solo se pide lo que usa la plantilla del artículo y la vista previa enseña el texto exacto de cada campo. Además de la fecha de fabricación (solo para el lote), hay una **fecha de cocida** independiente, de la que se calcula la caducidad (§5).

Rama: `feature/loteadora`.

**Rediseñado sobre el sistema Nova (ShadcnSpace)** — no usa `AppShell`/tokens del sistema viejo (`components/ui/`), sino `components/nova/` + `app/nova-theme.css`, igual que `/compras`, `/costes`, `/mrp` y `/muestras`. Ver §14 para el detalle de los patrones nuevos que aportó este panel (Combobox con búsqueda, selector de fecha única).

**Sigue el patrón de acceso configurable (`is_public`/`allowed_roles`) del resto de paneles**, con una diferencia: es el único que nace **privado** (§16). Sus siete rutas pasan por `requireScreenAccess('loteadora')`, así que los permisos que configure un admin en `/admin` → Pantallas se aplican de verdad en servidor.

---

## 2. Archivos relevantes

| Archivo | Descripción |
|---|---|
| `app/loteadora/page.tsx` | Página cliente: búsqueda de artículo, formulario (fabricación/cocida/caducidad), cálculo, autocarga de plantilla y vista previa |
| `app/api/loteadora/articulos/route.ts` | GET — artículos utilizables en la loteadora desde `F4101` (sin marca), incluye días de caducidad y, si tiene, la plantilla asociada (`plantilla: {messageName, campos}`) |
| `lib/loteadora-plantilla.ts` | Modelo de plantilla (campos y piezas), formatos de cocida/caducidad, composición del texto de cada campo, validación y lectura/escritura en SQLite — lo usan el envío, la vista previa y el constructor del admin (§13) |
| `lib/loteadora-plantillas-iniciales.json` | Las 17 plantillas del "nuevo loteado" (`N01`–`N17`), dadas de alta una sola vez al arrancar (§13) |
| `__tests__/loteadora-plantilla.test.ts` | Formatos, composición y validación con patrones reales de clientes |
| `app/api/loteadora/impresoras/route.ts` | GET público — loteadoras habilitadas (`id`, `name`, `linea`) para el desplegable del panel — `linea` decide si se puede enviar (§6, §8) |
| `app/api/loteadora/enviar/route.ts` | POST — envía lote/cocida/caducidad/hora/turno/línea a la loteadora seleccionada, resolviendo la plantilla del artículo y la línea de la loteadora en servidor (requiere permiso de pantalla, §16) |
| `app/api/loteadora/estado/route.ts` | GET público — estado en vivo (`activa`/`en_error`/`standby`/`apagada`) de las loteadoras habilitadas |
| `app/api/loteadora/mensajes/route.ts` | GET — lista las plantillas guardadas en una loteadora (requiere permiso de pantalla, §16) |
| `app/api/loteadora/cargar-mensaje/route.ts` | POST — carga/aplica una plantilla en la loteadora (requiere permiso de pantalla §16; rechaza con `409` si la loteadora está imprimiendo, §11) |
| `app/api/admin/loteadoras/route.ts` y `[id]/route.ts` | CRUD de loteadoras (IP/puerto/slave) desde `/admin` (solo admin) |
| `app/api/admin/loteadoras/estado/route.ts` | GET admin — estado en vivo de **todas** las loteadoras (habilitadas o no) |
| `app/api/admin/loteadora-mensajes/route.ts` y `[id]/route.ts` | CRUD de plantillas (nombre + campos con piezas) desde `/admin` → Loteadora › Plantillas |
| `app/api/admin/loteadora-datos-fijos/route.ts` y `[id]/route.ts` | Lista y cambia los datos fijos de las plantillas (precio, nº de certificado) desde `/admin` → Loteadora › Datos fijos |
| `app/api/admin/loteadora-copia/route.ts` | GET exporta / POST importa en JSON las plantillas y las asociaciones de artículos (botones Exportar/Importar de Plantillas, solo admin, §13) |
| `app/api/admin/loteadora-articulos/route.ts` y `[articuloId]/route.ts` | CRUD de asociaciones artículo→plantilla (`loteadora_articulo_mensajes`) desde `/admin` → Loteadora › Artículos. Abierto también a usuarios no admin con el permiso `admin.loteadora.articulos`, por su rol o como extra (DOCUMENTACION.md §5b) |
| `lib/loteadora-printer.ts` | Construye las tramas del protocolo TIJ y las envía por TCP (`buildRemoteFieldFrame`, `sendRemoteFields`, `getPrinterStatus`, `listMessageNames`, `loadPrintMessage`) |
| `components/nova/date-picker.tsx` | Selector de UNA fecha exacta (Popover + Calendar en modo `single`) — nuevo, no existía ningún panel Nova con selector de fecha única (solo rango, `date-range-picker.tsx`) |
| `components/nova/ui/combobox.tsx` | Combobox de Base UI instalado por CLI para la búsqueda de artículo — primer uso en el proyecto, ver §14 |
| `components/nova/admin/loteadoras.tsx`, `plantillas.tsx`, `articulos-plantilla.tsx` | Secciones de `/admin` (Nova) que configuran este panel — el buscador de artículo de Loteadora › Artículos usa el mismo `Combobox` que `/loteadora` |
| `lib/utils.ts` | `isoToJulian()` — convierte fecha ISO a formato Julian JDE (no usada aún por `page.tsx`, que tiene su propia función local `toJulianDay()`) |
| `__tests__/loteadora-printer.test.ts` | Test de `buildRemoteFieldFrame` contra el ejemplo del manual del protocolo |
| `__tests__/loteadora-access.test.ts` | Blinda las dos mitades del control de acceso del panel (§16): la marca `privado` en PANELS y el guard de las 4 rutas |

---

## 3. Selección de artículo

Al montar la página (y en cada refresco de 60s del estado en vivo, ver §10) se cargan **todos** los artículos utilizables en la loteadora de una vez (`GET /api/loteadora/articulos`, sin parámetro de marca) y se pasan al mismo `<SingleSelect showId>` de siempre, que ya trae buscador integrado y filtra en cliente por **código o descripción** a la vez. No hay paso previo de marca — se busca el artículo directamente.

El código y la descripción del artículo elegido se muestran en una cabecera, justo encima del lote/fecha de caducidad en la vista previa, para que quede claro para qué artículo se está calculando/enviando.

### Consulta Oracle

**Artículos** (`F4101`):
```sql
SELECT TRIM(IMLITM) AS id, TRIM(IMDSC1) AS descripcion, NVL(IMSLD, 0) AS diasCaducidad
FROM F4101
WHERE TRIM(IMSRP1) = '12'
  AND TRIM(IMSRP6) = 'Y'
  AND TRIM(IMSTKT) NOT IN ('O', 'U')
  AND TRIM(IMLITM) IS NOT NULL
ORDER BY TRIM(IMDSC1)
```

- `IMSRP1='12'` = categoría de artículo ya usada para restringir a los que aplican a loteadora
- `IMSRP6='Y'` = indicador de artículo elegible para loteadora (no confundir con marca comercial, que ya no se usa como filtro)
- `IMSTKT NOT IN ('O','U')` = excluye artículos obsoletos/de baja (códigos de tipo de stock)
- `IMSLD` = días de caducidad del artículo en JDE (`NVL` a 0 si viene nulo)

Si en el futuro este listado resultara demasiado grande para cargarlo entero de una vez (hoy se asume un volumen similar al de las ~130 marcas que se cargaban antes), la alternativa sería una búsqueda contra el servidor con parámetro `q` y límite de resultados, en vez de traer todo el catálogo — no implementado porque no hacía falta.

### Estado JDE caído

Si cualquiera de las dos llamadas falla, `jdeOnline` pasa a `false`: los desplegables se deshabilitan visualmente y el campo de días de caducidad pasa a edición manual obligatoria.

---

## 4. Días de caducidad — automático vs manual

Al elegir un artículo:
- Si `diasCaducidad > 0` (viene de JDE) → el campo se rellena y queda en **solo lectura**, con badge "desde JDE".
- Si es `0` o JDE está caído → el campo queda **editable**, con badge de aviso "manual".

En ambos casos el usuario puede forzar el modo manual con el enlace "Introducir manualmente", y volver al valor de JDE con "Usar valor de JDE (N días)".

---

## 5. Cálculo de lote, cocida y fecha de caducidad

Todo el cálculo es local en el cliente (`app/loteadora/page.tsx`), sin llamada a Oracle. **"Fecha Fresco" (lote) y "Fecha Cocida" no son selectores de calendario** — el operario las introduce a mano porque en planta rellenan estos campos de memoria y no necesariamente con la fecha real (ver más abajo):

```typescript
function toJulianDay(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 0)
  return Math.floor((date.getTime() - start.getTime()) / 86400000)
}

// Reconstruye una fecha real a partir de año + día juliano (inverso de toJulianDay).
function fromJulianDay(year: number, day: number): Date {
  const d = new Date(year, 0, 1)
  d.setDate(d.getDate() + day - 1)
  return d
}

// Si el día introducido es POSTERIOR al día juliano de hoy, pertenece al año
// que acaba de terminar (ej. hoy 2 de enero, cocida día 364 → año anterior).
function resolveCocidaYear(julianDay: number, today: Date): number {
  const todayJulian = toJulianDay(today)
  return julianDay > todayJulian ? today.getFullYear() - 1 : today.getFullYear()
}
```

- **Lote ("Fecha Fresco")** = campo de texto libre (solo dígitos, máx. 6 caracteres), **se envía tal cual lo escribe el operario, sin transformar**. En planta no siempre meten una fecha con el formato `AAJJJ`: a veces escriben el lote completo (`263221`), a veces sin el turno al final (`26322`) — no hay cálculo posible ni deseable aquí, por eso ya no es un `DatePicker`.
- **Cocida ("Fecha Cocida")** = el operario solo introduce el **día juliano** (numérico, 1-366, máx. 3 caracteres) — el año no lo escribe nadie, se infiere con `resolveCocidaYear()`. Cómo se imprime lo decide cada plantilla (§13): `AAJJJ`, `AJJJ` o `JJJ`, o como fecha (`DD/MM/AA`, `DD/MM/AAAA`, `MM/DD/AA`, `MM/DD/AAAA`), p. ej. `PROD: 21/09/26`. Cuando se aplica el año anterior, la vista previa muestra un badge ámbar "Año anterior (AAJJJ)" junto al campo para que el operario lo pueda verificar antes de enviar.
- **Fecha de caducidad** = **fecha de cocida** (reconstruida con `fromJulianDay(año_resuelto, día_juliano)`) + días de caducidad (JDE o manual) — no se calcula desde el lote/fresco, que es texto libre sin fecha real detrás.
- **Hora** (`HHmm`) = hora del reloj del cliente en el instante exacto de pulsar "Enviar" — **no** es un campo editable. La vista previa muestra un reloj en vivo (se recalcula cada segundo, `toHHmm(new Date())`) para que el operario vea qué hora se mandaría si pulsase ahora, pero el valor que de verdad viaja al servidor se recalcula de nuevo en `handleEnviar()` en el momento del click, no el que estaba pintado en pantalla un instante antes.
- **Turno** = `1`, `2` o `3` — a diferencia de la hora, este sí lo elige el usuario a mano (desplegable, sin valor por defecto), porque no hay forma de deducirlo de la fecha/hora sin conocer los horarios reales de cada turno en cada planta.
- **Línea de fabricación** = tampoco la elige el usuario en `/loteadora` — depende **solo de la loteadora seleccionada** (`loteadoras.linea`, asignada una vez en `/admin` → Loteadoras, ver §8). Al elegir una loteadora sin línea configurada, aparece un aviso ámbar bajo el selector y se bloquea el envío, igual que un artículo sin plantilla asociada.

**Qué se pide depende de la plantilla del artículo** (`variablesUsadas()`): si la plantilla no usa el fresco, no aparece "Fecha Fresco"; si no usa turno, no se pide; la cocida aparece si se usa la cocida o la caducidad (que sale de ella). Sin artículo, o con un artículo sin plantilla, se enseña todo. La vista previa pinta una casilla **por cada campo de la máquina** con el texto exacto que se imprimirá (`componerCampos()`, la misma función que usa el servidor al enviar), y debajo las piezas que lo forman o, en ámbar, lo que falta por rellenar.

---

## 6. Envío a la loteadora

El botón "Enviar a loteadora" llama a `POST /api/loteadora/enviar` con los **valores en crudo** — `{ loteadoraId, articuloId, fresco, cocidaAnio, cocidaDia, caducidad (YYYY-MM-DD), horaEnvio, turno }` — y es el **servidor** quien compone el texto de cada campo con la plantilla del artículo. El cliente no decide ni los IDs de campo, ni la línea, ni cómo se formatea nada. `horaEnvio` (`HHmm`) se calcula justo en el momento del click (§5). La ruta:

1. Exige permiso de pantalla (`requireScreenAccess('loteadora')`, §16): dispara una acción física real.
2. Carga la loteadora (`enabled = 1`): `ip`/`port`/`slave_address`/`linea`.
3. Resuelve la plantilla del **artículo** (`loteadora_articulo_mensajes` → `loteadora_mensaje_segmentos`, §13). Sin plantilla, o con una plantilla sin campos, 404 pidiendo configurarla en `/admin` — nunca hay un campo "por defecto".
4. **Valida solo lo que la plantilla usa**: fresco (texto ASCII, hasta 30), cocida (año 2000-2100 y día 1-366), caducidad (fecha ISO válida), hora (`HHmm` real), turno (`1`/`2`/`3`) y la línea de la loteadora (404 si la plantilla la usa y la loteadora no la tiene). Cada fallo, 400 con su motivo — antes de abrir ninguna conexión con la máquina.
5. Compone el texto de cada campo (`componerCampos()`, piezas en orden) y comprueba que ninguno quede vacío, supere 255 caracteres o lleve caracteres no ASCII.
6. Llama a `sendRemoteFields()` (`lib/loteadora-printer.ts`) con **un campo por cada Field Module de la plantilla**, en una sola trama `1D`.
7. Si falla de verdad (timeout, conexión rechazada, NAK, o un `P_Status` que no sea de éxito), devuelve 502 con el mensaje de error y, si se pudo, el detalle en crudo (`detail`, ver §7 "ver más"), que `page.tsx` muestra inline (estado `sendError`/`sendErrorDetail`).

**`P_Status` 42/43 no son fallos** — el manual documenta que `42` ("Remote buffer now full") ocurre precisamente porque *este* envío ha ocupado la última plaza libre del buffer de campos remotos (hasta 10 en cola); `43` ("still full") es ambiguo (según la configuración de la máquina, sustituye al más antiguo de la cola o descarta el nuevo envío). `sendRemoteFields()` trata ambos como **éxito con aviso** (`{ warning }`), no como error — `page.tsx` lo muestra en ámbar en vez de en rojo. Solo se lanza error de verdad para el resto de códigos (`01`, `12`, NAK...).

`canSend` exige: artículo **con plantilla**, loteadora seleccionada, que a ningún campo de la vista previa le falte nada (lo mismo que comprobará el servidor) que no haya un envío en curso y que la loteadora **no esté imprimiendo** (ver más abajo). Si el artículo no tiene plantilla, aviso ámbar bajo el selector de artículo; si la plantilla usa la línea y la loteadora no la tiene, el mismo aviso bajo el selector de loteadora.

---

**Confirmación antes de enviar:** el botón abre un diálogo con la loteadora y el texto exacto de cada campo. El envío solo se hace al pulsar "Enviar".

**Imprimiendo no se envía.** Cambiar los datos a mitad de tirada dejaría parte del lote con unos datos y parte con otros, y eso rompe la trazabilidad. El servidor consulta el estado (`14`) antes del `1D` y, si es `activa`, responde `409` con "La loteadora está imprimiendo…". En el panel, el botón se desactiva con un aviso ámbar y un enlace "Comprobar de nuevo". Solo se bloquea con `00` ("imprimiendo sin avisos"): con `01` ("hay avisos", p. ej. poca tinta o sin cartucho) no se puede saber si está imprimiendo o parada, y bloquear ahí impediría trabajar.

---

## 7. La máquina física — protocolo y configuración

La loteadora es una impresora de inyección de tinta térmica (TIJ) que expone un **protocolo de comandos por Ethernet** (documentado en `TIJ_Protocol 6.7.pdf`, no versionado en el repo) — actúa como servidor TCP, un único cliente a la vez.

**Formato de trama del protocolo de red:**
```
Comando:   1B 02 [SlaveAddr] [CmdID] [Data...] 1B 03 [Checknum]
Respuesta ACK: 1B 06 [SlaveAddr] [P_Status] [CmdID] [Data...] 1B 03 [Checknum]
Respuesta NAK: 1B 15 [SlaveAddr] [C_Status] [CmdID] 1B 03 [Checknum]
```
Checknum = complemento a 2 de la suma módulo-256 de todos los bytes (desde `1B 02` hasta `1B 03`, ambos incluidos).

**Campos remotos (comando `1D` — Download Remote Field Data):** para poder actualizar lote/caducidad por red, el mensaje de la máquina necesita un **Field Module** por dato, creado en pantalla con el botón **"Insertar Campo"** (no "Insertar Base de datos" — ese botón no tiene relación con el protocolo de red, no aparece mencionado en ningún sitio del manual). Parámetros clave del Field Module:

- **Fuente de datos = Puerto serial** (no "Escáner" — el escáner es para leer un código de barras físico).
- **ID de datos**: identifica el campo (0-255). Debe ser distinto para cada campo del mismo mensaje.
- **Longitud del campo**: nº máximo de caracteres; hay que dimensionarlo al texto más largo que se vaya a enviar (lote y fecha de caducidad).
- **Cuerda = ASCII** (Unicode solo si hace falta acentos/caracteres especiales).

Con el campo ya creado, el comando `1D` rellena su valor:
```
1B 02 [SlaveAddr] 1D [N campos] { [FieldID] [LongitudTexto] [TextoASCII...] } 1B 03 [Checknum]
```

**`P_Status` relevantes de la respuesta** (capítulo 4 del manual): `00`=OK, `12`="Print not started". Es el **estado** de la impresora (parada), no un rechazo: probado en planta, el `1D` se guarda igual con la impresión parada. Se trata como aceptado con aviso ámbar, igual que `1E`/`1F` (§11). Aparece en casi todos los comandos del protocolo. `42`/`43`=buffer de campos remotos lleno, `01`=error genérico de impresora. Ver el mapeo completo en `lib/loteadora-printer.ts`.

**Mensajes exportados de la máquina (`.msg`):** de los 21 archivos revisados originalmente, ninguno tenía campos remotos configurados (todos usaban texto fijo grabado en la plantilla). El mensaje `pruebaDavid.msg` se creó/editó específicamente con dos Field Module (ver §8) para poder probar el envío real. El formato de archivo `.msg` sigue sin documentación disponible y **no** es el mismo que el protocolo de red (usa coma flotante para coordenadas, frente a enteros de 2 bytes) — no hace falta entenderlo para el envío por red, que se construye desde cero en `lib/loteadora-printer.ts` sin leer el `.msg`.

---

## 8. Gestión de loteadoras (tabla `loteadoras` + admin)

Como puede haber varias impresoras físicas, la configuración de cada una vive en la tabla SQLite `loteadoras` (`lib/sqlite.ts`), gestionada desde la pestaña **Loteadoras** de `/admin` (`app/admin/page.tsx`) — no hay ninguna loteadora hardcodeada en el código.

| Columna | Descripción |
|---|---|
| `name` | Nombre identificativo (único) |
| `ip` / `port` | IP y puerto Ethernet de la máquina |
| `slave_address` | Slave Address configurada en la máquina (por defecto `0`) |
| `enabled` | Si aparece en el desplegable de `/loteadora` |
| `linea` | Línea de fabricación que alimenta esta loteadora (texto libre, ej. "Línea 1") — obligatoria al crear/editar. Se envía como campo remoto más en `/api/loteadora/enviar` (§6), resuelta **solo por loteadora**, nunca por artículo/plantilla ni introducida por el operario en `/loteadora` |

**Ya no guarda IDs de campo** (`lot_field_id`/`expiry_field_id` se eliminaron con `ALTER TABLE ... DROP COLUMN` en `lib/sqlite.ts`) — desde que la plantilla decide esos IDs (§13), tenerlos también aquí era una segunda fuente de configuración redundante. Cuidado si se toca `app/api/admin/loteadoras/route.ts`/`[id]/route.ts`: no deben volver a referenciar esas columnas (motivo real de un bug ya corregido — el `SELECT`/`INSERT`/`UPDATE` seguía nombrándolas después de la migración, y el `GET` fallaba en silencio dejando la pestaña Loteadoras vacía en `/admin`).

CRUD en `app/api/admin/loteadoras/route.ts` (GET/POST) y `[id]/route.ts` (PUT/DELETE), protegido por `middleware.ts` (`/api/admin/:path*`). Lectura pública (solo `id`/`name`, solo habilitadas) en `app/api/loteadora/impresoras/route.ts`, consumida por el desplegable "Loteadora" del panel.

Ejemplo real configurado durante el desarrollo de esta función: IP `192.168.111.119:8010`, Slave Address `0` (los campos de cada plantilla viven en `loteadora_mensaje_segmentos`, ver §13).

---

## 9. `lib/loteadora-printer.ts`

- `sendCommand(config, frame, timeoutMs)` (interna): abre un `net.Socket` (módulo nativo de Node, sin dependencias nuevas), escribe la trama, espera la respuesta y cierra siempre el socket. Devuelve `{kind: 'ack'|'nak', status}` — solo rechaza la promesa por problemas de conexión/timeout/formato, nunca por el contenido del `P_Status`/`C_Status` (eso lo interpreta cada función pública).
- `buildRemoteFieldFrame(slaveAddress, fields)`: función pura que construye la trama del comando `1D` (incluye el checknum). Verificada en `__tests__/loteadora-printer.test.ts` contra el ejemplo resuelto del propio manual.
- `sendRemoteFields(config, fields)`: usa `sendCommand` (timeout 5s) y traduce el `P_Status`/`C_Status` a un mensaje de error en español si no es `00`.
- `getPrinterStatus(config)`: usa `sendCommand` con el comando `14` (Request Printer Status, sin datos) y timeout más corto (3s). **Nunca lanza** — cualquier fallo de conexión se traduce en `'apagada'`. Devuelve uno de `'activa'` (`P_Status=00`), `'standby'` (`P_Status=12`, conectada pero sin imprimir), `'en_error'` (`P_Status=01`, NAK, o cualquier otro código) o `'apagada'` (no se pudo conectar). No decodifica el bitmap de 32 bits de avisos específicos del capítulo 3 del manual — solo este estado agregado.
- `listMessageNames(config)`: usa `sendCommand` con el comando `1F` (Request Message Names, sin datos). La respuesta es de longitud variable (hasta 255 nombres) y puede llegar troceada en varios paquetes TCP — por eso `sendCommand` acumula los `data` recibidos hasta detectar el cierre de trama (`ESC ETX` + checknum) en vez de resolver con el primer paquete. Verificado en `__tests__/loteadora-printer.test.ts` con un servidor TCP de prueba que trocea la respuesta a propósito.
- `downloadMessage(config, messageName, fields)` / `buildDownloadMessageFrame()`: comando `1C` (Download Message Data, manual §3.5.17). **Crea o sobrescribe un mensaje en la máquina desde el PC**, con sus Field Modules: posición X/Y, fuente, tamaño, ID y longitud, fuente de datos "puerto serie", ASCII y alineado a la izquierda. La trama está verificada contra el ejemplo de Field Module del manual.
  - **Probado en planta (sept. 2026):** con la impresión parada responde `12` y el mensaje aparece en la lista `1F`.
  - Las posiciones van en la misma unidad que guarda el `.msg`: en `Arial-MonoBold` de tamaño 35, un carácter ocupa 21 puntos y las líneas van cada 36.
  - **No hay módulo de reloj** en el `1C`, así que el reloj (`HHmm`) se inserta a mano en la máquina después de crear el mensaje.
  - Los 17 mensajes del "nuevo loteado" (`N01_…` a `N17_…`) se crearon así en la Loteadora Pruebas, dejando hueco para el reloj. Después se exportan por USB al resto de máquinas.
  - Aún no hay botón en `/admin`: se crearon con un script.
- `loadPrintMessage(config, messageName)`: encadena el comando `1E` (Load Print Message) y, si tiene éxito, el `01` (Update Print contents) para aplicarlo. Lanza un error claro si la plantilla no existe en la máquina (`P_Status=10`) o si falla cualquiera de los dos pasos. Con la impresión parada (`12`) no falla: devuelve un `warning` (§11). Entre `1E` y `01` espera `LOAD_APPLY_DELAY_MS` (1 s). El ACK de `1E` solo confirma que el mensaje existe; si el `01` llegaba antes de que la máquina terminara de leerlo, aplicaba el mensaje anterior. Se vio en planta: la plantilla decía "cargada" pero no cambiaba, y había que cargarla dos veces. Si vuelve a pasar, sube esa constante.
- **Cola por máquina:** `sendCommand` encola los comandos a una misma IP:puerto, porque el protocolo solo admite un cliente a la vez. El estado cada 60 s, el listado de plantillas y la carga ya no abren conexiones simultáneas. La cola vive en memoria del proceso, así que vale con un único servidor Next.

---

## 10. Estado en vivo

Tanto `/loteadora` como la pestaña **Loteadoras** de `/admin` muestran el estado real de cada máquina, refrescado automáticamente cada 60 segundos mientras la página/pestaña está abierta (`setInterval`, limpiado al desmontar o al cambiar de pestaña):

- `/loteadora`: sección "Estado de las loteadoras" (`GET /api/loteadora/estado`, solo habilitadas) + el propio badge "JDE conectado" se refresca en el mismo ciclo (reintenta `fetchArticulos()`, que hace de comprobación de vida de JDE ahora que ya no hay marcas).
- Estados: **Imprimiendo** (`00`), **Conectada (sin imprimir)** (`12`), **En error** (`01` o NAK) y **Sin conexión**. En `/admin` el estado `12` se llama "Sin imprimir".
- `/admin` → Loteadoras: badge adicional junto a "Habilitada/Deshabilitada" (`GET /api/admin/loteadoras/estado`, todas, se comprueba solo mientras esa pestaña está activa).

Cada comprobación abre y cierra una conexión TCP breve por loteadora (el protocolo solo admite un cliente a la vez) — no se mantiene ninguna conexión persistente.

Al seleccionar una loteadora se fuerza además un refresco inmediato de `estadoLoteadoras` (no solo esperar al ciclo de 60s), para que la sección de estado no vaya desacompasada del check en vivo que hace `fetchMensajes()` al abrir el selector de plantilla (§11).

---

## 11. Elegir y cargar la plantilla (mensaje) en remoto

**Orden del formulario:** primero se elige la loteadora. El artículo queda desactivado ("Elige primero la loteadora") hasta que hay una, porque al elegirlo se carga su plantilla en ella.

**Solo se pregunta al cambiar de artículo, no al cambiar de loteadora.** Cada loteadora guarda en su formulario (`plantillaPreguntada`, §15) para qué artículo y plantilla ya se preguntó. Al volver a una loteadora con el trabajo a medias o ya enviado, no se vuelve a pedir la carga. Recargar el mensaje podría borrar los datos ya enviados que esperan para imprimir. Si se borra el artículo y se vuelve a elegir, sí se pregunta.

**La plantilla no se elige a mano** (cambio de sept. 2026): solo cambia al cambiar de artículo. Ya no hay desplegable de mensajes. Aparece el nombre de la plantilla del artículo con un botón **"Volver a cargar"**, que solo recarga esa misma, p. ej. si al elegir el artículo la máquina estaba imprimiendo o falló la carga. El panel ya no pide la lista de mensajes de la máquina. Es el servidor quien la pide (`1F`) justo antes de cargar, para comprobar que el nombre existe. Antes la comprobaba el panel, y si esa lista fallaba o aún no había llegado al cambiar de loteadora, la carga automática se saltaba en silencio. Si la máquina está imprimiendo al elegir el artículo, se avisa con un toast. El botón llama a `POST /api/loteadora/cargar-mensaje` (`{loteadoraId, messageName}`), que ejecuta `loadPrintMessage()` (`1E` + `01`). Si la loteadora está imprimiendo (`14` → `activa`), la rechaza con `409`, igual que el envío (§6). Un artículo sin plantilla asociada no se puede enviar: hay que asociársela en `/admin` → Loteadora › Artículos.

**Autocarga automática por artículo (§13):** si el artículo elegido tiene una plantilla asociada en `loteadora_articulo_mensajes`, en cuanto hay loteadora + artículo seleccionados se llama sola a `cargar-mensaje` con el `messageName` de esa plantilla (mismo código que el botón manual, extraído a la función `cargarMensaje()`), **tras confirmarlo** en un diálogo que dice qué plantilla se carga, en qué loteadora y para qué artículo. Si la loteadora está imprimiendo no se pregunta ni se carga: la plantilla queda preseleccionada para el botón "Cargar plantilla" cuando la paren. El nombre de la plantilla debe coincidir **exactamente** con el mensaje creado a mano en la máquina.

**`loteadoras` ya no guarda ningún nombre de plantilla** (columna `message_name` eliminada, migración `DROP COLUMN` en `lib/sqlite.ts`) — no tenía función real (el envío `1D` nunca la usaba) más allá de preseleccionar un valor por defecto, y con el selector en vivo ya no hacía falta.

**Corrección importante (probado en planta):** la primera versión de esto bloqueaba la carga si la impresora estaba imprimiendo, pensando que cambiar de plantilla en caliente interrumpiría un trabajo real. Eso creaba una contradicción imposible de resolver: **tanto `1F` (listar) como `1E` (cargar) exigen la impresión iniciada** para funcionar (`P_Status=12` "impresión no iniciada" si no) — con el bloqueo puesto, para poder listar plantillas había que iniciar, pero para cargarlas había que pararla. Además, el manual documenta explícitamente que en el firmware **T1/T2** (la variante de 5 bytes que ya confirmamos que usa esta máquina, ver §9) **está permitido actualizar el contenido con la impresión iniciada** — es el comportamiento que el propio fabricante espera, no un riesgo a evitar. Se quitó el bloqueo por completo.

**Cambiar de plantilla sin imprimir (septiembre 2026):** obligar a iniciar la impresión solo para cambiar de mensaje no tenía sentido, y sin cartucho iniciar da error. Según el manual (§4.2), `P_Status` es el **estado de la impresora**, no el resultado del comando. En `22`/`23`/`26`/`33` el manual lo dice explícitamente ("Succeeded but print not started"), y en `1E`/`1F` solo pone "Print not started". Por eso:
- `listMessageNames()` acepta `12` si la respuesta trae nombres (más de 8 bytes). Si no los trae, sigue dando el error de "impresión no iniciada".
- `loadPrintMessage()` acepta `12` en `1E` y en `01`. Con la impresión parada devuelve `{ warning }` en vez de fallar, y `/loteadora` lo muestra como toast ámbar para que el operario confirme en la pantalla de la máquina que el mensaje cargado es el correcto.

**El nombre va sin `.msg` (probado en planta):** la máquina lista y carga los mensajes sin extensión (`17_Dimmdisi_45d`). Una plantilla llamada `Prueba2.msg` no cargaba nada. Con la impresión parada, además, la máquina no devuelve `10` ("no existe"): responde `12` igual que si existiera. Se vio en la respuesta del `01`, cuyo ancho de mensaje seguía siendo el del mensaje anterior. Para evitarlo:
- `validarPlantilla()` rechaza nombres acabados en `.msg`.
- `POST /api/loteadora/cargar-mensaje` comprueba el nombre contra la lista `1F` de la loteadora antes de cargar, y responde `404` si no está.

**Pendiente de confirmar en la máquina real:** si con la impresión parada el mensaje cambia de verdad en pantalla. Si no cambia, el firmware exige la impresión iniciada y no hay forma de cambiarlo por red. El único comando relacionado es `11` (Start Print), que también falla sin cartucho.

El comando `1D` (envío de lote/caducidad) sigue actuando igual que antes: sobre lo que esté cargado en ese momento, se haya cambiado de plantilla desde el dashboard o no.

---

## 12. Limpiar el buffer de campos remotos

El botón **"Limpiar buffer"** de `/loteadora` llama a `POST /api/loteadora/limpiar-buffer` (`{loteadoraId}`), que ejecuta `clearRemoteFieldBuffer()` (comando `21` — Clear Buffers of 1D). Equivale a pulsar el botón "Clear" de **Ajustes de comunicación → Buffer** en la propia máquina: vacía la cola de envíos `1D` pendientes sin imprimir nada ni cambiar ningún valor.

**Por qué hace falta:** el campo remoto solo se actualiza cuando la impresora consume la cola al disparar una impresión real (paso por la célula fotoeléctrica). Si se hacen varios envíos de prueba sin que la máquina llegue a imprimir, la cola (hasta 10 según el "Number" configurado en Buffer Setting) se llena y no se vacía sola — los envíos siguientes devuelven aviso de buffer lleno (`42`/`43`, ver §6) y el valor mostrado en pantalla puede quedarse desactualizado (`Null Null` hasta el primer disparo real). Este botón permite desatascarlo desde el dashboard sin ir a la máquina.

Se descartó automatizar el disparo de impresión en sí (comando `13`, Trigger Print) porque dispara una impresión física real cada vez — limpiar el buffer no imprime nada, así que es una acción segura de repetir.

---

## 13. Plantillas por artículo (`loteadora_mensajes` + `loteadora_articulo_mensajes`)

Antes de esta función, cada loteadora tenía un único par de IDs de campo fijos, y la plantilla se elegía a mano cada vez. Con varias plantillas configuradas en la máquina (cada una con sus propios Field Module, no necesariamente en los mismos IDs), hacía falta que **el artículo determine automáticamente qué plantilla se carga**. La asociación es **global**: un artículo siempre apunta al mismo nombre de plantilla, sin importar en qué loteadora se imprima.

### Campos y piezas (`lib/loteadora-plantilla.ts`)

Cada plantilla tiene **campos**, uno por Field Module del mensaje en la máquina (su "ID de datos", §7). El texto que se envía a cada campo es la **concatenación de sus piezas**, en orden:

| Pieza | Qué pone | Opciones |
|---|---|---|
| Texto | Un literal tal cual: `L`, `CAD `, `EXP: `, un espacio... | — |
| Dato fijo | Un valor constante con nombre (precio, nº de certificado) | Nombre + valor; editable aparte (ver "Datos fijos") |
| Fecha fresco | Lo que escribe el operario, tal cual | — |
| Cocida | Día juliano de cocida con su año | `AAJJJ` (26150), `AJJJ` (6150), `JJJ` (150) |
| Caducidad | Cocida + días de caducidad, más un **ajuste en días** opcional (`-1` = el día anterior; se guarda en `valor`) | `DD/MM/AA`, `DD/MM/AAAA`, `MM/DD/AA`, `MM/DD/AAAA`, `DD` (solo el día). Ejemplo: caducidad completa en un campo (`25/07/2026`) y el día anterior en otro (`DD`, ajuste `-1` → `24`) |
| Turno | El turno elegido (1/2/3) | — |
| Hora | Hora del envío, `HHmm` | — |
| Línea | Línea de fabricación de la loteadora | — |

Ejemplos reales de clientes:

- **BENIS HORECA FRESCO** (turno pegado a la cocida): campo = `[Texto "L"] [Cocida AAJJJ] [Turno]` → `L261502`.
- **Caducidad con literal**: `[Texto "CAD "] [Caducidad DD/MM/AA]` → `CAD 14/07/26`; Trader Joes: `[Texto "BB "] [Caducidad MM/DD/AA]`.
- **Precio fijo** (Holanda): `[Caducidad DD/MM/AA] [Texto "  "] [Dato fijo "Precio" = "3,89 EUR"]`.

Así, lo que antes se dibujaba a mano en el diseño de la máquina (la "L", "CAD "...) lo manda el sistema: en la máquina basta con un Field Module por campo.

**Limitación: solo ASCII.** El comando `1D` se construye con el texto en ASCII (`buildRemoteFieldFrame`), así que un "€", una tilde o una "ñ" llegarían a la máquina como basura. Se valida al guardar la plantilla, al cambiar un dato fijo y al enviar, con un mensaje claro: para el precio, usar "EUR" o dejar el "€" como texto fijo en el propio diseño de la máquina. Si hiciera falta Unicode, habría que comprobar en el manual del protocolo si `1D` lo admite y cómo, antes de tocar el envío.

### Esquema (`lib/sqlite.ts`)

```sql
CREATE TABLE loteadora_mensajes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,           -- debe coincidir exacto con el nombre creado en la máquina
  created_at TEXT DEFAULT (datetime('now'))
);

-- Una fila por pieza, con el ID del Field Module al que pertenece
CREATE TABLE loteadora_mensaje_segmentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mensaje_id INTEGER NOT NULL REFERENCES loteadora_mensajes(id) ON DELETE CASCADE,
  orden INTEGER NOT NULL,              -- campo × 1000 + pieza: ordena campos y piezas a la vez
  field_id INTEGER NOT NULL,
  tipo TEXT NOT NULL,                  -- texto | fijo | fresco | cocida | caducidad | turno | hora | linea
  valor TEXT,                          -- texto / dato fijo
  nombre TEXT,                         -- dato fijo
  formato TEXT                         -- cocida / caducidad
);

CREATE TABLE loteadora_articulo_mensajes (
  articulo_id TEXT PRIMARY KEY,        -- código de artículo (F4101.IMLITM)
  mensaje_id INTEGER NOT NULL REFERENCES loteadora_mensajes(id) ON DELETE CASCADE,
  created_at TEXT DEFAULT (datetime('now'))
);
```

Un artículo solo puede tener una plantilla a la vez (`articulo_id` es clave primaria) — asociar de nuevo sustituye la anterior. Borrar una plantilla borra en cascada sus campos y sus asociaciones.

**Migración desde el modelo anterior** (6 columnas fijas `lot/cocida/expiry/hora/turno/linea_field_id` en `loteadora_mensajes`): al arrancar, cada columna se convierte en un campo con una sola pieza de ese tipo, sin literales, y la caducidad en `DD/MM/AAAA` (lo que se imprimía hasta entonces), así que las plantillas existentes siguen enviando exactamente lo mismo; si dos columnas compartían ID (las añadidas más tarde valían 0 por defecto) gana la primera. Después se eliminan las columnas. **Antes de tocar nada se guarda una copia completa de la BD** junto a `app.db` (`app.db.pre-plantillas-campos-<fecha>`, con `VACUUM INTO`): para volver atrás, restaurar ese fichero y desplegar la versión anterior.

**Copia de seguridad: Exportar / Importar** (botones de `/admin` → Plantillas, solo admin; `exportarCopia` / `importarCopia` en `lib/loteadora-plantilla.ts`, ruta `/api/admin/loteadora-copia`):
- **Exportar** descarga `plantillas-loteadora-<fecha>.json` con todas las plantillas y las asociaciones artículo → plantilla. Las asociaciones van **por nombre de plantilla**, porque los IDs internos cambian entre BD.
- **Importar** sube ese archivo y **valida todo antes de escribir**: plantillas con `validarPlantilla`, sin nombres repetidos, y artículos de 10 dígitos cuya plantilla esté en el archivo o en la BD. Si algo falla, no se importa nada.
- Sin marcar **"Sustituir las que ya existan"**, solo añade lo que falta: plantillas con un nombre nuevo y artículos sin asociar. Marcada, sustituye los campos de las plantillas con el mismo nombre y reasocia los artículos que apuntaban a otra. Sirve para restaurar una copia.
- Nunca borra nada que no esté en el archivo. Al terminar muestra cuántas plantillas y asociaciones se crearon, se sustituyeron o se dejaron sin tocar.
- Los tests están en `__tests__/loteadora-plantilla.test.ts`, con una BD en memoria.

**Plantillas del "nuevo loteado" incluidas en el código:** las 17 plantillas `N01_…` a `N17_…` viven en `lib/loteadora-plantillas-iniciales.json`. Son las mismas que se crearon en la máquina con el comando `1C` (§9). `lib/sqlite.ts` las da de alta al arrancar, **una sola vez por BD**: queda la marca `plantillas-nuevo-loteado` en la tabla `migraciones`. Así llegan solas a producción con el despliegue, y si luego se borra o renombra una desde `/admin`, no reaparece en el siguiente arranque. Si ya existe una plantilla con el mismo nombre, no se toca. Lo que **no** viaja: las asociaciones a artículos, los valores cambiados en Datos fijos y las loteadoras, que son de cada BD. Para añadir más plantillas en otra versión, usa una clave de migración nueva, no la misma.

### Admin — Loteadora › Plantillas (constructor)

`components/nova/admin/plantillas.tsx`. La tabla enseña, por plantilla, lo que se imprimiría en cada campo con valores de ejemplo, salvo la **Línea**, que es la real de la primera loteadora que la tenga configurada en `/admin` → Loteadoras. Se manda tal cual, sin prefijo. La plantilla es común a todas las loteadoras, así que en `/loteadora` la vista previa usa la línea de la loteadora elegida. El diálogo de alta/edición es un constructor: nombre del mensaje + lista de campos, cada uno con su ID y sus piezas (añadir con "+ Pieza", reordenar con las flechas, quitar con la ×); al lado de cada campo, **"Se imprime"** con el resultado en vivo y los espacios visibles como `·`. CRUD en `app/api/admin/loteadora-mensajes/route.ts` (GET/POST) y `[id]/route.ts` (PUT/DELETE), solo admin, que sustituyen los campos enteros en una transacción. `validarPlantilla()` exige: nombre ASCII no vacío y único, al menos un campo, IDs 0-255 **sin repetir**, al menos una pieza por campo, textos y datos fijos no vacíos y en ASCII, datos fijos con nombre y formatos válidos.

### Admin — Loteadora › Datos fijos

`components/nova/admin/datos-fijos.tsx`: todos los datos fijos de todas las plantillas en una tabla (plantilla, dato, campo, valor), editables uno a uno. Es la forma de que **personas concretas** cambien un precio o un nº de certificado sin poder tocar el resto de la plantilla: permiso `admin.loteadora.datos-fijos` (por rol o como extra, DOCUMENTACION.md §5b), que solo abre esta sección y las rutas `GET /api/admin/loteadora-datos-fijos` y `PATCH /api/admin/loteadora-datos-fijos/:id` (esta última solo modifica piezas tipo `fijo`, y valida ASCII). El cambio se aplica en el siguiente envío.

### Admin — Loteadora › Artículos

CRUD de `loteadora_articulo_mensajes` en `app/api/admin/loteadora-articulos/route.ts` (GET/POST, upsert por `articulo_id`) y `[articuloId]/route.ts` (DELETE). La sección (`components/nova/admin/articulos-plantilla.tsx`) hace la asociación en un diálogo: el buscador de artículo reutiliza `GET /api/loteadora/articulos` (el mismo catálogo y el mismo `Combobox` que `/loteadora`) y avisa si el artículo ya tiene plantilla (se sustituye); `POST` valida `articuloId` con el regex ya usado en el proyecto (`/^\d{10}$/`) y que `mensajeId` exista.

Esta sección (Loteadora › Artículos) la puede abrir también un usuario no admin con el permiso `admin.loteadora.articulos`, por su rol o como extra (DOCUMENTACION.md §5b): solo ve esta sección de `/admin`, puede leer las plantillas (`GET /api/admin/loteadora-mensajes`) pero no crearlas ni editarlas.

### Cómo llega a `/loteadora`

`GET /api/loteadora/articulos` hace, además de la consulta a Oracle, una consulta a SQLite y adjunta a cada artículo, si tiene plantilla, `{ messageName, campos }` — así `/loteadora` ya tiene todo lo necesario para autocargar la plantilla (§11), decidir qué pedir y pintar la vista previa real sin otra llamada al elegir artículo.

### Flujo de configuración (a cargo del usuario en la máquina)

1. Crear el mensaje en la loteadora con un Field Module por campo (sin dibujar a mano los literales: la "L", "CAD "... los manda el sistema), ver §7. Dimensionar la longitud de cada Field Module al texto más largo que vaya a recibir.
2. Registrar esa misma plantilla en `/admin` → Loteadora › Plantillas, con el nombre **exacto**, los mismos IDs de campo y las piezas de cada campo; comprobar en "Se imprime" que el resultado es el esperado.
3. Asociar el artículo correspondiente en `/admin` → Loteadora › Artículos.

Sin este último paso, `/loteadora` muestra un aviso ámbar en el selector de artículo y bloquea el envío (§6) — no hay plantilla "por defecto".

---

## 14. Rediseño sobre el sistema Nova (ShadcnSpace)

`app/loteadora/page.tsx` se reescribió sobre `components/nova/` + `app/nova-theme.css` (mismo sistema que `/compras`, `/costes`, `/mrp`, `/muestras`) — ver `components/nova/README.md` para el mecanismo de aislamiento `[data-nova-theme]`, dark mode y la checklist general. **Alcance original: solo el panel operativo `/loteadora`.** Las secciones de administración (Loteadora › Máquinas, Plantillas y Artículos) se pasaron a Nova después, junto con todo `/admin` — ver DOCUMENTACION.md §5.

Toda la lógica de negocio (cálculo de lote/cocida/caducidad §5, protocolo TIJ §7-9, autocarga de plantilla §11, estado en vivo §10) es la misma que antes del rediseño — solo cambió la capa visual.

### Dos patrones nuevos, no usados antes en ningún panel Nova

- **Combobox con búsqueda de texto** (`components/nova/ui/combobox.tsx`): hasta este panel, ningún desplegable Nova necesitaba filtrar una lista grande por texto (los `Select` existentes son listas cortas cerradas). Se instaló por CLI oficial (`bunx --bun shadcn@latest add combobox`, primitivo nativo de Base UI `@base-ui/react/combobox`, no `cmdk`). El fichero instalado traía **dos bugs de registro** que hubo que corregir a mano (mismo tipo de arreglo legítimo que ya documenta `components/nova/README.md` para otros primitivos instalados):
  - `import { cn } from "cn"` → debía ser `"@/lib/utils"` (y de paso el CLI añadió el paquete npm `cn` a `package.json`/`bun.lock` sin que nada lo usara — se quitó).
  - `<ComboboxPrimitive.Portal>` sin `container={useNovaPortalContainer()}` — mismo bug de portal que ya tenían `popover.tsx`/`select.tsx` antes de parchearlos (ver README, sección "portal-container.tsx").
  - **Patrón de uso** (`page.tsx`, selector de artículo): `items` es un array plano de **IDs (string)**, no de objetos `{value,label}` — mezclar ambos formatos (items como objetos pero `<ComboboxItem value={item.value}>` aplanado a string) rompe el filtrado y el texto mostrado tras seleccionar (el `itemToStringLabel` que se le pasa a `<Combobox>` recibe el valor ya resuelto, no el objeto). Con `items` como `string[]` + `itemToStringLabel={(id) => label de ese id}` todo es consistente de principio a fin.
- **Selector de una fecha exacta** (`components/nova/date-picker.tsx`): no había bloque de "date picker" en el catálogo ShadcnSpace (comprobado con `searchBlocks`/`listComponents` antes de construirlo) ni un componente Nova para fecha única (solo `date-range-picker.tsx`, un rango). Se construyó a mano reutilizando `Calendar`+`Popover` ya instalados — mismo patrón artesanal que `month-range-picker.tsx`/`mode-toggle.tsx` cuando el catálogo no cubre algo.

Ambos patrones quedan también anotados en `components/nova/README.md` para el siguiente panel que los necesite.

### Dirección visual: "etiqueta/ticket"

La vista previa de impresión (columna derecha) es el centro visual del panel, no el formulario: tarjeta con **borde sólido** (no discontinuo — se probó con `border-dashed` en el contorno exterior simulando la línea de corte de una etiqueta, pero no encajaba visualmente y se revirtió), artículo centrado arriba y, debajo, una **rejilla de 2 columnas** con **una casilla por campo de la plantilla** (texto exacto a imprimir, en `text-xl`, y debajo sus piezas o lo que falta) — con la Fase B dejó de ser una rejilla fija de seis datos, ver §5 y §13.

Pasó por tres versiones: (1) lista vertical de bloques a `text-4xl`, uno por fila — crecía demasiado según se añadían hora/turno/línea; (2) grid de 3 columnas con casillas pequeñas (`text-base`) y borde discontinuo — muy compacta, pero al ensanchar el panel a `max-w-7xl` (ver más abajo) dejaba un hueco vacío enorme entre la tarjeta y el botón "Enviar" (la columna izquierda, con más campos, marca la altura del layout vía el `<div className="flex-1" />` que empuja el botón abajo); (3) la actual, grid de 2 columnas con casillas más grandes — ocupa más alto sin volver a la lista original, reduciendo ese hueco. El formulario (columna izquierda) se mantiene compacto a propósito — fabricación y cocida van lado a lado en vez de apiladas — para no competir visualmente con la vista previa. Columnas asimétricas (`lg:grid-cols-[1fr_1.2fr]`, más peso a la derecha).

**Ancho del panel**: `<main>` usa `max-w-7xl` (antes `max-w-5xl`), igual que `/compras` y `/mrp` — el contenedor exterior (`bg-sidebar`/`md:m-2 md:rounded-xl`) ya ocupaba todo el ancho de la ventana sin límite, así que `max-w-5xl` dejaba mucho margen sin usar en tablet/desktop.

### Avisos y errores con `Alert`

Los tres mensajes de aviso/error del panel (artículo sin plantilla, loteadora sin línea, error de envío) usaban markup suelto (`<p>`/`<div>` con clases de color a mano, duplicado entre los dos avisos ámbar). Se sustituyeron por el componente `Alert` de shadcn/ui (`components/nova/ui/alert.tsx`, instalado para esta ocasión — ver `components/nova/README.md` para el bug de registro que corrigió, igual que `Combobox`). Los dos avisos de configuración faltante usan `<Alert>` con color ámbar por `className` (el componente solo trae variantes `default`/`destructive`, no hay "warning"); el error de envío usa `<Alert variant="destructive">`, conservando el toggle "Ver más" del detalle en crudo (§6) dentro de `<AlertDescription>`. Los toasts (`sonner`, feedback de acciones puntuales como cargar plantilla o limpiar buffer) no cambiaron — ya eran el componente correcto para ese caso.

---

## 15. Sesión por loteadora

**Problema detectado (probado en planta):** el formulario (artículo, fabricación, cocida, días de caducidad, turno, plantilla manual) era un único estado plano compartido por todo el panel. El selector "Loteadora" solo decidía a qué máquina apuntaba ese mismo formulario — no había nada independiente por loteadora. Consecuencia real: configurabas y enviabas a la loteadora 1, cambiabas a la loteadora 2 para configurar otro trabajo, y si volvías a la loteadora 1 el formulario seguía mostrando los datos de la loteadora 2 (no los suyos). Peor aún: la autocarga de plantilla (§11) se dispara también al cambiar de loteadora, así que volver a la 1 con el artículo de la 2 todavía seleccionado volvía a mandarle a la loteadora 1 la plantilla equivocada, sin que el usuario lo pidiera.

### Solución: `formStates`, un formulario por loteadora

`app/loteadora/page.tsx` guarda el formulario en `Record<string, LoteadoraFormState>` (`formStates`), con clave = `selectedLoteadora` (`""` = todavía no se ha elegido ninguna, es el "borrador"):

```typescript
interface LoteadoraFormState {
  selectedArticuloId: string | null;
  loteManual: string;      // "Fecha Fresco" — texto libre, se envía tal cual (§5)
  cocidaJulianDay: string; // "Fecha Cocida" — solo el día juliano, el año se infiere (§5)
  diasCad: string;
  diasDesdeJde: number | null;
  modoManual: boolean;
  turno: string;
  selectedMensaje: string;
}
```

`currentForm = formStates[selectedLoteadora] ?? defaultFormState()` es el formulario activo; `updateForm(patch)` escribe siempre sobre la clave de la loteadora seleccionada en ese momento. `selectedArticulo` ya no es estado propio: se deriva cada render de `articulos.find(a => a.id === currentForm.selectedArticuloId)` — evita duplicar el objeto artículo (que ya vive en `articulos`, refrescado cada 60s) dentro de cada sesión.

**Compatibilidad con el JSX existente:** en vez de tocar cada campo del formulario en el JSX, `loteManual`/`cocidaJulianDay`/`diasCad`/`diasDesdeJde`/`modoManual`/`turno`/`selectedMensaje` se desestructuran de `currentForm` como constantes locales, y sus "setters" (`setLoteManual`, `setTurno`...) son wrappers de una línea sobre `updateForm` — el resto del componente (`Select`, botones) no cambió una sola línea. (El `DatePicker` que usaban originalmente "Fabricación"/"Cocida" se quitó al pasar esos dos campos a introducción manual, ver §5.)

### Qué pasa al elegir una loteadora (`handleLoteadoraSelect`)

- Si esa loteadora **ya tenía su propia sesión** (se había visitado antes en este mismo montaje de la página) → se conserva tal cual, no se toca. Esto es lo que hace que volver a la loteadora 1 "siga todo igual".
- Si es la **primera vez** que se elige alguna loteadora (se venía del borrador, clave `""`) → hereda el borrador. Así el flujo de siempre (rellenar el formulario y elegir a qué loteadora mandarlo, en ese orden) no cambia nada para quien solo usa una loteadora.
- Si se cambia entre **dos loteadoras ya elegidas** hacia una tercera sin visitar → esa tercera empieza en blanco (`defaultFormState()`), nunca hereda de la que tuvieras abierta un momento antes. Es la pieza que evita mezclar artículo/turno de una loteadora con otra.

También se limpia `sendError`/`sendErrorDetail` al cambiar de loteadora — un error de envío es de la loteadora que se acaba de dejar, y dejarlo pintado sobre la sesión de otra sería engañoso.

### Otros efectos del cambio

- **`selectedMensaje` ya no se resetea al refrescar la lista de plantillas** (`fetchMensajes` dejó de hacer `setSelectedMensaje("")`) — ahora vive en `formStates`, así que volver a una loteadora restaura qué plantilla tenías elegida a mano en el desplegable "Plantilla", en vez de vaciarlo siempre.
- **La autocarga de plantilla (§11) cambió sus dependencias de `useEffect`** de `[selectedArticulo, selectedLoteadora]` a `[selectedArticulo?.id, selectedArticulo?.plantilla?.messageName, selectedLoteadora]`. Motivo no relacionado con loteadoras múltiples pero descubierto al hacer `selectedArticulo` derivado: al ser un objeto recalculado cada render a partir de `articulos` (que se refresca entero cada 60s con objetos nuevos), usar el objeto completo como dependencia habría disparado una recarga de plantilla en la loteadora cada minuto aunque nada hubiera cambiado de verdad. Comparar por `id`/`messageName` (valores primitivos) evita ese falso disparo.
- `mensajes` (los nombres de plantilla que expone la propia máquina, comando `1F`) sigue siendo estado global, no por loteadora — es una lista en vivo de la máquina, se refresca siempre al entrar, no tiene sentido cachearla por sesión.

---

## 16. Control de acceso del panel

Este panel es el único que **nace privado**. El resto de paneles se seedean con `is_public = 1` y quedan accesibles sin sesión hasta que un admin los restrinja a mano; aquí eso no vale, porque sus rutas disparan acciones físicas reales (imprimir una etiqueta, cargar una plantilla en la máquina, vaciar su buffer).

### Las dos mitades de la regla

1. **`privado: true` en `lib/panels.ts`** → el seed de `screens` (`lib/sqlite.ts`) inserta la fila con `is_public = 0`. Sin esa marca, `requireScreenAccess` sale por `if (screen.is_public === 1) return null` (`lib/permissions.ts:38`) y el panel quedaría abierto **incluso sin sesión**.
2. **`requireScreenAccess('loteadora')` en las cuatro rutas** que mandan comandos TIJ (`enviar`, `cargar-mensaje`, `limpiar-buffer`, `mensajes`), en lugar del `verifySession()` que tenían antes. La diferencia importa: `verifySession()` solo comprobaba "hay sesión", así que cualquier usuario logueado —con permiso sobre el panel o no— podía imprimir. Las tres rutas de solo lectura (`articulos`, `estado`, `impresoras`) **también** la llevan desde que el middleware cubre toda la API. Se dejaron abiertas al principio con el argumento de que "no mueven nada en la máquina", y era un mal argumento: `estado` abre una conexión TCP a cada loteadora en cada petición y `articulos` lanza una consulta a la F4101 completa, las dos sin sesión. Como el panel es privado, nadie anónimo tiene motivo para llamarlas.

Ambas mitades están blindadas en `__tests__/loteadora-access.test.ts`, porque viven en archivos distintos y quitar cualquiera de las dos reabre el agujero en silencio.

### Al desplegar: hay que dar acceso al rol

Como la pantalla nace privada, tras el primer despliegue **solo los admin entran**. Para que los operarios puedan usarla, un admin tiene que darle acceso a su rol en `/admin` → Pantallas. Si el panel "desaparece" del nav o devuelve 403 tras actualizar, es esto.

**BDs que ya tenían la fila** (entornos de desarrollo donde el panel se probó antes de este cambio): el seed usa `INSERT OR IGNORE`, así que **no** toca filas existentes — su `loteadora` sigue con `is_public = 1`. Hay que marcarla privada una vez desde `/admin` → Pantallas. Es deliberado: el seed nunca pisa lo que haya configurado un admin.

### Sesión caducada con el panel abierto

Si el token caduca con el panel abierto (tablet de planta que no se cierra en días), antes te quedabas delante de una pantalla muerta y el primer aviso era un 401 mostrado tal cual —"No autenticado"— como si fuera un error de la máquina.

Ahora lo lleva el `SessionProvider` compartido (ver `DOCUMENTACION.md`): revalida la sesión cada 60 s y al volver el foco a la pestaña, y las cuatro llamadas protegidas pasan por `useApiFetch`, que ante un 401 echa al login. El panel además va envuelto en `<RequireAccess screen="loteadora">`, así que no se pinta nada hasta saber si esta sesión puede entrar.

`app/login/page.tsx` respeta ese `next` y devuelve al usuario al panel del que venía, en vez de mandarlo siempre al primero de `PANELS` (que era `/produccion`). Dos guardas: la ruta tiene que ser interna (empezar por `/` y no por `//`, o sería un open redirect) y el usuario tiene que tener acceso real a ese panel (si no, el panel lo rebotaría al login otra vez, en bucle).

`app/login/page.tsx` respeta el `next` y devuelve al usuario al panel del que venía, con dos guardas: ruta interna (o sería un open redirect) y acceso real a ese panel (o el panel lo rebotaría al login en bucle).

Este panel fue el piloto del provider junto a `/produccion`. Los demás paneles se migran en una rama aparte; hasta entonces conviven los dos modelos.
