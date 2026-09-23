# Documentación — Loteadora (`/loteadora`)

> Documentación específica del panel de loteadora (impresión de lote y fecha de caducidad).
> Ver [DOCUMENTACION.md](../DOCUMENTACION.md) para la documentación base del proyecto.

---

## 1. Estado actual

**El envío a la loteadora ya es real** (comando `1D` del protocolo TIJ por TCP, ver §6-9). La selección de artículo es directa (búsqueda por código o descripción, sin marca — ver §3).

**Cada artículo tiene una plantilla (mensaje) asociada de forma global** (§13): al elegirlo en `/loteadora`, si tiene plantilla, se carga sola en la loteadora seleccionada, sin botón. Los IDs de campo (lote/cocida/caducidad) ya no son fijos por loteadora — viven en la plantilla, así que máquinas distintas pueden usar Field Module en IDs distintos para el mismo artículo/mensaje. Además de la fecha de fabricación (solo para el lote), hay una **fecha de cocida** independiente, de la que se calcula la caducidad (§5).

Rama: `feature/loteadora`.

**Rediseñado sobre el sistema Nova (ShadcnSpace)** — no usa `AppShell`/tokens del sistema viejo (`components/ui/`), sino `components/nova/` + `app/nova-theme.css`, igual que `/compras`, `/costes`, `/mrp` y `/muestras`. Ver §14 para el detalle de los patrones nuevos que aportó este panel (Combobox con búsqueda, selector de fecha única).

**Sigue el patrón de acceso configurable (`is_public`/`allowed_roles`) del resto de paneles**, con una diferencia: es el único que nace **privado** (§16). Sus siete rutas pasan por `requireScreenAccess('loteadora')`, así que los permisos que configure un admin en `/admin` → Pantallas se aplican de verdad en servidor.

---

## 2. Archivos relevantes

| Archivo | Descripción |
|---|---|
| `app/loteadora/page.tsx` | Página cliente: búsqueda de artículo, formulario (fabricación/cocida/caducidad), cálculo, autocarga de plantilla y vista previa |
| `app/api/loteadora/articulos/route.ts` | GET — artículos utilizables en la loteadora desde `F4101` (sin marca), incluye días de caducidad y, si tiene, la plantilla asociada (`plantilla: {messageName, lotFieldId, cocidaFieldId, expiryFieldId, horaFieldId, turnoFieldId, lineaFieldId}`) |
| `app/api/loteadora/impresoras/route.ts` | GET público — loteadoras habilitadas (`id`, `name`, `linea`) para el desplegable del panel — `linea` decide si se puede enviar (§6, §8) |
| `app/api/loteadora/enviar/route.ts` | POST — envía lote/cocida/caducidad/hora/turno/línea a la loteadora seleccionada, resolviendo la plantilla del artículo y la línea de la loteadora en servidor (requiere permiso de pantalla, §16) |
| `app/api/loteadora/estado/route.ts` | GET público — estado en vivo (`activa`/`en_error`/`standby`/`apagada`) de las loteadoras habilitadas |
| `app/api/loteadora/mensajes/route.ts` | GET — lista las plantillas guardadas en una loteadora (requiere permiso de pantalla, §16) |
| `app/api/loteadora/cargar-mensaje/route.ts` | POST — carga/aplica una plantilla en la loteadora (requiere permiso de pantalla §16, sin bloqueo por estado de impresión) |
| `app/api/admin/loteadoras/route.ts` y `[id]/route.ts` | CRUD de loteadoras (IP/puerto/slave) desde `/admin` (solo admin) |
| `app/api/admin/loteadoras/estado/route.ts` | GET admin — estado en vivo de **todas** las loteadoras (habilitadas o no) |
| `app/api/admin/loteadora-mensajes/route.ts` y `[id]/route.ts` | CRUD de plantillas (`loteadora_mensajes`: nombre + IDs de campo lote/cocida/caducidad) desde `/admin` → Plantillas |
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

Todo el cálculo es local en el cliente (`app/loteadora/page.tsx`), sin llamada a Oracle:

```typescript
function toJulianDay(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 0)
  return Math.floor((date.getTime() - start.getTime()) / 86400000)
}

function toLote(date: Date): string {
  const yy = String(date.getFullYear()).slice(-2)
  const jd = String(toJulianDay(date)).padStart(3, '0')
  return yy + jd  // ej: 2026-01-15 → "26015"
}
```

- **Lote** = año (2 dígitos) + día juliano de la **fecha de fabricación**, con padding a 3 dígitos (`AAJJJ`).
- **Cocida** = mismo formato `AAJJJ`, pero sobre la **fecha de cocida** — es un campo independiente de fabricación, con su propio selector y botón "Hoy".
- **Fecha de caducidad** = **fecha de cocida** + días de caducidad (JDE o manual) — ya **no** se calcula desde fabricación. Fabricación solo interviene en el lote.
- **Hora** (`HHmm`) = hora del reloj del cliente en el instante exacto de pulsar "Enviar" — **no** es un campo editable como fabricación/cocida. La vista previa muestra un reloj en vivo (se recalcula cada segundo, `toHHmm(new Date())`) para que el operario vea qué hora se mandaría si pulsase ahora, pero el valor que de verdad viaja al servidor se recalcula de nuevo en `handleEnviar()` en el momento del click, no el que estaba pintado en pantalla un instante antes.
- **Turno** = `1`, `2` o `3` — a diferencia de la hora, este sí lo elige el usuario a mano (desplegable, sin valor por defecto), porque no hay forma de deducirlo de la fecha/hora sin conocer los horarios reales de cada turno en cada planta.
- **Línea de fabricación** = tampoco la elige el usuario en `/loteadora` — depende **solo de la loteadora seleccionada** (`loteadoras.linea`, asignada una vez en `/admin` → Loteadoras, ver §8). Al elegir una loteadora sin línea configurada, aparece un aviso ámbar bajo el selector y se bloquea el envío, igual que un artículo sin plantilla asociada.

Los seis valores (lote, cocida, fecha de caducidad formateada, hora, turno y línea) se muestran en una vista previa tipo etiqueta antes de enviar.

---

## 6. Envío a la loteadora

El botón "Enviar a loteadora" llama a `POST /api/loteadora/enviar` con `{ loteadoraId, articuloId, lote, fechaCocida, fechaCaducidad, horaEnvio, turno }` — **ya no manda IDs de campo, ni la línea de fabricación** (esa se resuelve enteramente en servidor a partir de la loteadora elegida, nunca la decide el cliente). `horaEnvio` (`HHmm`) se calcula en el cliente justo en el momento del click (`toHHmm(new Date())`), no es el valor que estaba pintado en la vista previa un instante antes (§5). La ruta:

1. Exige sesión (`verifySession()`) — es el único punto del panel que sí valida sesión en servidor, porque dispara una acción física real (imprime una etiqueta). El resto del panel sigue con el gap descrito en §1.
2. Carga la fila de `loteadoras` (`id`, `enabled = 1`) desde SQLite (`ip`/`port`/`slave_address`/`linea` — ya no guarda IDs de campo, ver §8). Si `linea` está vacía, responde 404 pidiendo configurarla en `/admin` antes de enviar.
3. Resuelve la plantilla del **artículo** en SQLite (`loteadora_articulo_mensajes` JOIN `loteadora_mensajes`, ver §13) para obtener `lotFieldId`/`cocidaFieldId`/`expiryFieldId`/`horaFieldId`/`turnoFieldId`/`lineaFieldId`. Si el artículo no tiene plantilla asociada, responde 404 con un mensaje claro pidiendo configurarla en `/admin` — nunca hay un ID de campo "por defecto".
4. Valida que `turno` sea `'1'`, `'2'` o `'3'` (400 si no) — es el único de los valores que llega tal cual del cliente sin ser calculado ni resuelto en servidor, así que se valida igual que cualquier otro dato de usuario (ver CLAUDE.md, sección Seguridad).
5. Llama a `sendRemoteFields()` (`lib/loteadora-printer.ts`) con **seis campos**: `lotFieldId` → lote, `cocidaFieldId` → fecha de cocida (`AAJJJ`), `expiryFieldId` → fecha de caducidad (formateada `dd/mm/aaaa`, `formatDateES`), `horaFieldId` → hora de envío (`HHmm`), `turnoFieldId` → turno (`1`/`2`/`3`), `lineaFieldId` → línea de fabricación (`loteadora.linea`, resuelta en el paso 2, no la manda el cliente).
6. Si falla de verdad (timeout, conexión rechazada, NAK, o un `P_Status` que no sea de éxito), devuelve 502 con el mensaje de error y, si se pudo, el detalle en crudo (`detail`, ver §7 "ver más"), que `page.tsx` muestra inline (estado `sendError`/`sendErrorDetail`).

**`P_Status` 42/43 no son fallos** — el manual documenta que `42` ("Remote buffer now full") ocurre precisamente porque *este* envío ha ocupado la última plaza libre del buffer de campos remotos (hasta 10 en cola); `43` ("still full") es ambiguo (según la configuración de la máquina, sustituye al más antiguo de la cola o descarta el nuevo envío). `sendRemoteFields()` trata ambos como **éxito con aviso** (`{ warning }`), no como error — `page.tsx` lo muestra en ámbar en vez de en rojo. Solo se lanza error de verdad para el resto de códigos (`01`, `12`, NAK...).

`canSend` exige además: lote calculado, cocida calculada, fecha de caducidad calculada, turno seleccionado, la loteadora elegida **con línea configurada**, artículo seleccionado **con plantilla asociada**, loteadora seleccionada y que no haya un envío en curso. Si el artículo no tiene plantilla, se muestra un aviso ámbar bajo el selector de artículo; si la loteadora no tiene línea, el mismo tipo de aviso bajo el selector de loteadora — en ambos casos el botón queda deshabilitado.

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

**`P_Status` relevantes de la respuesta** (capítulo 4 del manual): `00`=OK, `12`="Print not started" — **la máquina exige tener la impresión iniciada en pantalla** para aceptar el comando (aparece en casi todos los comandos del protocolo, no solo en `1D`), `42`/`43`=buffer de campos remotos lleno, `01`=error genérico de impresora. Ver el mapeo completo en `lib/loteadora-printer.ts`.

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

Ejemplo real configurado durante el desarrollo de esta función: IP `192.168.111.119:8010`, Slave Address `0` (los IDs de campo lote/cocida/caducidad/hora/turno/línea de la plantilla de prueba `pruebaDavid.msg` viven ahora en `loteadora_mensajes`, ver §13).

---

## 9. `lib/loteadora-printer.ts`

- `sendCommand(config, frame, timeoutMs)` (interna): abre un `net.Socket` (módulo nativo de Node, sin dependencias nuevas), escribe la trama, espera la respuesta y cierra siempre el socket. Devuelve `{kind: 'ack'|'nak', status}` — solo rechaza la promesa por problemas de conexión/timeout/formato, nunca por el contenido del `P_Status`/`C_Status` (eso lo interpreta cada función pública).
- `buildRemoteFieldFrame(slaveAddress, fields)`: función pura que construye la trama del comando `1D` (incluye el checknum). Verificada en `__tests__/loteadora-printer.test.ts` contra el ejemplo resuelto del propio manual.
- `sendRemoteFields(config, fields)`: usa `sendCommand` (timeout 5s) y traduce el `P_Status`/`C_Status` a un mensaje de error en español si no es `00`.
- `getPrinterStatus(config)`: usa `sendCommand` con el comando `14` (Request Printer Status, sin datos) y timeout más corto (3s). **Nunca lanza** — cualquier fallo de conexión se traduce en `'apagada'`. Devuelve uno de `'activa'` (`P_Status=00`), `'standby'` (`P_Status=12`, conectada pero sin imprimir), `'en_error'` (`P_Status=01`, NAK, o cualquier otro código) o `'apagada'` (no se pudo conectar). No decodifica el bitmap de 32 bits de avisos específicos del capítulo 3 del manual — solo este estado agregado.
- `listMessageNames(config)`: usa `sendCommand` con el comando `1F` (Request Message Names, sin datos). La respuesta es de longitud variable (hasta 255 nombres) y puede llegar troceada en varios paquetes TCP — por eso `sendCommand` acumula los `data` recibidos hasta detectar el cierre de trama (`ESC ETX` + checknum) en vez de resolver con el primer paquete. Verificado en `__tests__/loteadora-printer.test.ts` con un servidor TCP de prueba que trocea la respuesta a propósito.
- `loadPrintMessage(config, messageName)`: encadena el comando `1E` (Load Print Message) y, si tiene éxito, el `01` (Update Print contents) para aplicarlo. Lanza un error claro si la plantilla no existe en la máquina (`P_Status=10`) o si falla cualquiera de los dos pasos.

---

## 10. Estado en vivo

Tanto `/loteadora` como la pestaña **Loteadoras** de `/admin` muestran el estado real de cada máquina, refrescado automáticamente cada 60 segundos mientras la página/pestaña está abierta (`setInterval`, limpiado al desmontar o al cambiar de pestaña):

- `/loteadora`: sección "Estado de las loteadoras" (`GET /api/loteadora/estado`, solo habilitadas) + el propio badge "JDE conectado" se refresca en el mismo ciclo (reintenta `fetchArticulos()`, que hace de comprobación de vida de JDE ahora que ya no hay marcas).
- `/admin` → Loteadoras: badge adicional junto a "Habilitada/Deshabilitada" (`GET /api/admin/loteadoras/estado`, todas, se comprueba solo mientras esa pestaña está activa).

Cada comprobación abre y cierra una conexión TCP breve por loteadora (el protocolo solo admite un cliente a la vez) — no se mantiene ninguna conexión persistente.

Al seleccionar una loteadora se fuerza además un refresco inmediato de `estadoLoteadoras` (no solo esperar al ciclo de 60s), para que la sección de estado no vaya desacompasada del check en vivo que hace `fetchMensajes()` al abrir el selector de plantilla (§11).

---

## 11. Elegir y cargar la plantilla (mensaje) en remoto

Al seleccionar una loteadora en `/loteadora` aparece un desplegable **"Plantilla"** con los mensajes guardados en esa máquina (`GET /api/loteadora/mensajes?loteadoraId=...`, comando `1F`), sin preseleccionar ninguno. El botón **"Cargar plantilla"** llama a `POST /api/loteadora/cargar-mensaje` (`{loteadoraId, messageName}`), que ejecuta `loadPrintMessage()` (`1E` + `01`) directamente, sin comprobar el estado de impresión antes. Este desplegable manual sigue existiendo como *fallback*: reintentar a mano, o cubrir un artículo sin plantilla asociada todavía.

**Autocarga automática por artículo (§13):** si el artículo elegido tiene una plantilla asociada en `loteadora_articulo_mensajes`, en cuanto hay loteadora + artículo seleccionados se llama sola a `cargar-mensaje` con el `messageName` de esa plantilla (mismo código que el botón manual, extraído a la función `cargarMensaje()`) — sin pedir confirmación. El nombre de la plantilla debe coincidir **exactamente** con el mensaje creado a mano en la máquina.

**`loteadoras` ya no guarda ningún nombre de plantilla** (columna `message_name` eliminada, migración `DROP COLUMN` en `lib/sqlite.ts`) — no tenía función real (el envío `1D` nunca la usaba) más allá de preseleccionar un valor por defecto, y con el selector en vivo ya no hacía falta.

**Corrección importante (probado en planta):** la primera versión de esto bloqueaba la carga si la impresora estaba imprimiendo, pensando que cambiar de plantilla en caliente interrumpiría un trabajo real. Eso creaba una contradicción imposible de resolver: **tanto `1F` (listar) como `1E` (cargar) exigen la impresión iniciada** para funcionar (`P_Status=12` "impresión no iniciada" si no) — con el bloqueo puesto, para poder listar plantillas había que iniciar, pero para cargarlas había que pararla. Además, el manual documenta explícitamente que en el firmware **T1/T2** (la variante de 5 bytes que ya confirmamos que usa esta máquina, ver §9) **está permitido actualizar el contenido con la impresión iniciada** — es el comportamiento que el propio fabricante espera, no un riesgo a evitar. Se quitó el bloqueo por completo.

El comando `1D` (envío de lote/caducidad) sigue actuando igual que antes: sobre lo que esté cargado en ese momento, se haya cambiado de plantilla desde el dashboard o no.

---

## 12. Limpiar el buffer de campos remotos

El botón **"Limpiar buffer"** de `/loteadora` llama a `POST /api/loteadora/limpiar-buffer` (`{loteadoraId}`), que ejecuta `clearRemoteFieldBuffer()` (comando `21` — Clear Buffers of 1D). Equivale a pulsar el botón "Clear" de **Ajustes de comunicación → Buffer** en la propia máquina: vacía la cola de envíos `1D` pendientes sin imprimir nada ni cambiar ningún valor.

**Por qué hace falta:** el campo remoto solo se actualiza cuando la impresora consume la cola al disparar una impresión real (paso por la célula fotoeléctrica). Si se hacen varios envíos de prueba sin que la máquina llegue a imprimir, la cola (hasta 10 según el "Number" configurado en Buffer Setting) se llena y no se vacía sola — los envíos siguientes devuelven aviso de buffer lleno (`42`/`43`, ver §6) y el valor mostrado en pantalla puede quedarse desactualizado (`Null Null` hasta el primer disparo real). Este botón permite desatascarlo desde el dashboard sin ir a la máquina.

Se descartó automatizar el disparo de impresión en sí (comando `13`, Trigger Print) porque dispara una impresión física real cada vez — limpiar el buffer no imprime nada, así que es una acción segura de repetir.

---

## 13. Plantillas por artículo (`loteadora_mensajes` + `loteadora_articulo_mensajes`)

Antes de esta función, cada loteadora tenía un único par de IDs de campo fijos, y la plantilla se elegía a mano cada vez. Con varias plantillas configuradas en la máquina (cada una con sus propios Field Module, no necesariamente en los mismos IDs), hacía falta que **el artículo determine automáticamente qué plantilla se carga**. La asociación es **global**: un artículo siempre apunta al mismo nombre de plantilla, sin importar en qué loteadora se imprima.

### Esquema (`lib/sqlite.ts`)

```sql
CREATE TABLE loteadora_mensajes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,           -- debe coincidir exacto con el nombre creado en la máquina
  lot_field_id INTEGER NOT NULL,
  cocida_field_id INTEGER NOT NULL,
  expiry_field_id INTEGER NOT NULL,
  hora_field_id INTEGER NOT NULL,
  turno_field_id INTEGER NOT NULL,
  linea_field_id INTEGER NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE loteadora_articulo_mensajes (
  articulo_id TEXT PRIMARY KEY,        -- código de artículo (F4101.IMLITM)
  mensaje_id INTEGER NOT NULL REFERENCES loteadora_mensajes(id) ON DELETE CASCADE,
  created_at TEXT DEFAULT (datetime('now'))
);
```

Un artículo solo puede tener una plantilla a la vez (`articulo_id` es clave primaria) — asociar de nuevo sustituye la anterior. Borrar una plantilla borra en cascada sus asociaciones.

### Admin — pestaña "Plantillas"

CRUD de `loteadora_mensajes` en `app/api/admin/loteadora-mensajes/route.ts` (GET/POST) y `[id]/route.ts` (PUT/DELETE). Valida: nombre no vacío y único, los seis IDs de campo (lote/cocida/caducidad/hora/turno/línea) enteros 0-255 y **distintos entre sí** (misma idea que la validación de `loteadoras`, extendida a 6 campos).

### Admin — Loteadora › Artículos

CRUD de `loteadora_articulo_mensajes` en `app/api/admin/loteadora-articulos/route.ts` (GET/POST, upsert por `articulo_id`) y `[articuloId]/route.ts` (DELETE). La sección (`components/nova/admin/articulos-plantilla.tsx`) hace la asociación en un diálogo: el buscador de artículo reutiliza `GET /api/loteadora/articulos` (el mismo catálogo y el mismo `Combobox` que `/loteadora`) y avisa si el artículo ya tiene plantilla (se sustituye); `POST` valida `articuloId` con el regex ya usado en el proyecto (`/^\d{10}$/`) y que `mensajeId` exista.

Esta sección (Loteadora › Artículos) la puede abrir también un usuario no admin con el permiso `admin.loteadora.articulos`, por su rol o como extra (DOCUMENTACION.md §5b): solo ve esta sección de `/admin`, puede leer las plantillas (`GET /api/admin/loteadora-mensajes`) pero no crearlas ni editarlas.

### Cómo llega a `/loteadora`

`GET /api/loteadora/articulos` hace, además de la consulta a Oracle, una consulta a SQLite (`loteadora_articulo_mensajes` JOIN `loteadora_mensajes`) y adjunta a cada artículo, si tiene mapeo, `{ messageName, lotFieldId, cocidaFieldId, expiryFieldId, horaFieldId, turnoFieldId, lineaFieldId }` — así `/loteadora` ya tiene todo lo necesario para autocargar la plantilla (§11) y resolver el envío sin otra llamada al elegir artículo.

### Flujo de configuración (a cargo del usuario en la máquina)

1. Crear el mensaje en la loteadora con sus Field Module (lote/cocida/caducidad) — igual que se hacía antes para una única plantilla, ver §7.
2. Registrar esa misma plantilla en `/admin` → Plantillas, con el nombre **exacto** y los mismos IDs de campo.
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

La vista previa de impresión (columna derecha) es el centro visual del panel, no el formulario: tarjeta con **borde sólido** (no discontinuo — se probó con `border-dashed` en el contorno exterior simulando la línea de corte de una etiqueta, pero no encajaba visualmente y se revirtió), artículo centrado arriba y, debajo, una **rejilla de 2 columnas** (`grid grid-cols-2 gap-3`) con los seis datos (lote/cocida/caducidad/hora/turno/línea) — cada uno en su propia casilla, también con borde sólido, y valor en `text-xl`.

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
  fechaFab: string;
  fechaCocida: string;
  diasCad: string;
  diasDesdeJde: number | null;
  modoManual: boolean;
  turno: string;
  selectedMensaje: string;
}
```

`currentForm = formStates[selectedLoteadora] ?? defaultFormState()` es el formulario activo; `updateForm(patch)` escribe siempre sobre la clave de la loteadora seleccionada en ese momento. `selectedArticulo` ya no es estado propio: se deriva cada render de `articulos.find(a => a.id === currentForm.selectedArticuloId)` — evita duplicar el objeto artículo (que ya vive en `articulos`, refrescado cada 60s) dentro de cada sesión.

**Compatibilidad con el JSX existente:** en vez de tocar cada campo del formulario en el JSX, `fechaFab`/`fechaCocida`/`diasCad`/`diasDesdeJde`/`modoManual`/`turno`/`selectedMensaje` se desestructuran de `currentForm` como constantes locales, y sus "setters" (`setFechaFab`, `setTurno`...) son wrappers de una línea sobre `updateForm` — el resto del componente (inputs, `DatePicker`, `Select`) no cambió una sola línea.

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
