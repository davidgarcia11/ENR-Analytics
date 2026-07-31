# Documentación — Loteadora (`/loteadora`)

> Documentación específica del panel de loteadora (impresión de lote y fecha de caducidad).
> Ver [DOCUMENTACION.md](../DOCUMENTACION.md) para la documentación base del proyecto.

---

## 1. Estado actual

**El envío a la loteadora ya es real** (comando `1D` del protocolo TIJ por TCP, ver §6-9). La selección de artículo es directa (búsqueda por código o descripción, sin marca — ver §3); el cálculo de lote/caducidad y la vista previa siguen igual que antes.

Rama: `feature/loteadora`. Creada antes del rediseño UI/UX (PR #53), por lo que **no usa `AppShell`/tokens** como el resto de paneles — usa maquetación y colores hardcodeados heredados del diseño anterior.

**No sigue todavía el patrón de acceso configurable (`is_public`/`allowed_roles`) de otros paneles** — comprueba sesión con `/api/auth/me` y redirige a `/login` si no hay sesión, sin pasar por `middleware.ts` ni por la tabla de permisos de pantalla.

---

## 2. Archivos relevantes

| Archivo | Descripción |
|---|---|
| `app/loteadora/page.tsx` | Página cliente: búsqueda de artículo, formulario, cálculo y vista previa |
| `app/api/loteadora/articulos/route.ts` | GET — artículos utilizables en la loteadora desde `F4101` (sin marca), incluye días de caducidad |
| `app/api/loteadora/impresoras/route.ts` | GET público — loteadoras habilitadas (`id`, `name`) para el desplegable del panel |
| `app/api/loteadora/enviar/route.ts` | POST — envía lote/caducidad a la loteadora seleccionada (requiere sesión) |
| `app/api/loteadora/estado/route.ts` | GET público — estado en vivo (`activa`/`en_error`/`standby`/`apagada`) de las loteadoras habilitadas |
| `app/api/loteadora/mensajes/route.ts` | GET — lista las plantillas guardadas en una loteadora (requiere sesión) |
| `app/api/loteadora/cargar-mensaje/route.ts` | POST — carga/aplica una plantilla en la loteadora (requiere sesión, bloquea si está imprimiendo) |
| `app/api/admin/loteadoras/route.ts` y `[id]/route.ts` | CRUD de loteadoras desde `/admin` (solo admin) |
| `app/api/admin/loteadoras/estado/route.ts` | GET admin — estado en vivo de **todas** las loteadoras (habilitadas o no) |
| `lib/loteadora-printer.ts` | Construye las tramas del protocolo TIJ y las envía por TCP (`buildRemoteFieldFrame`, `sendRemoteFields`, `getPrinterStatus`, `listMessageNames`, `loadPrintMessage`) |
| `components/SingleSelect.tsx` | Desplegable de selección única con buscador (reutilizado de otros paneles) |
| `lib/utils.ts` | `isoToJulian()` — convierte fecha ISO a formato Julian JDE (no usada aún por `page.tsx`, que tiene su propia función local `toJulianDay()`) |
| `__tests__/loteadora-printer.test.ts` | Test de `buildRemoteFieldFrame` contra el ejemplo del manual del protocolo |

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

## 5. Cálculo de lote y fecha de caducidad

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

- **Lote** = año (2 dígitos) + día juliano de la **fecha de fabricación**, con padding a 3 dígitos.
- **Fecha de caducidad** = fecha de fabricación + días de caducidad (JDE o manual).
- La fecha de fabricación por defecto es la de hoy (botón "Hoy" para restablecerla).

Ambos valores se muestran en una vista previa tipo etiqueta (lote y fecha en grande) antes de enviar.

---

## 6. Envío a la loteadora

El botón "Enviar a loteadora" llama a `POST /api/loteadora/enviar` con `{ loteadoraId, lote, fechaCaducidad }`. La ruta:

1. Exige sesión (`verifySession()`) — es el único punto del panel que sí valida sesión en servidor, porque dispara una acción física real (imprime una etiqueta). El resto del panel sigue con el gap descrito en §1.
2. Carga la fila de `loteadoras` (`id`, `enabled = 1`) desde SQLite.
3. Llama a `sendRemoteFields()` (`lib/loteadora-printer.ts`) con dos campos: `lot_field_id` → lote, `expiry_field_id` → fecha de caducidad (formateada `dd/mm/aaaa`, `formatDateES`).
4. Si falla de verdad (timeout, conexión rechazada, NAK, o un `P_Status` que no sea de éxito), devuelve 502 con el mensaje de error y, si se pudo, el detalle en crudo (`detail`, ver §7 "ver más"), que `page.tsx` muestra inline (estado `sendError`/`sendErrorDetail`).

**`P_Status` 42/43 no son fallos** — el manual documenta que `42` ("Remote buffer now full") ocurre precisamente porque *este* envío ha ocupado la última plaza libre del buffer de campos remotos (hasta 10 en cola); `43` ("still full") es ambiguo (según la configuración de la máquina, sustituye al más antiguo de la cola o descarta el nuevo envío). `sendRemoteFields()` trata ambos como **éxito con aviso** (`{ warning }`), no como error — `page.tsx` lo muestra en ámbar en vez de en rojo. Solo se lanza error de verdad para el resto de códigos (`01`, `12`, NAK...).

`canSend` exige además: lote calculado, fecha de caducidad calculada, artículo seleccionado, **loteadora seleccionada** y que no haya un envío en curso.

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
| `lot_field_id` / `expiry_field_id` | ID de datos de cada Field Module (§7) |
| `enabled` | Si aparece en el desplegable de `/loteadora` |

CRUD en `app/api/admin/loteadoras/route.ts` (GET/POST) y `[id]/route.ts` (PUT/DELETE), protegido por `middleware.ts` (`/api/admin/:path*`). Lectura pública (solo `id`/`name`, solo habilitadas) en `app/api/loteadora/impresoras/route.ts`, consumida por el desplegable "Loteadora" del panel.

Ejemplo real configurado durante el desarrollo de esta función: IP `192.168.111.119:8010`, Slave Address `0`, campo lote ID `1`, campo caducidad ID `2` (plantilla de prueba en la máquina: `pruebaDavid.msg`, elegida en vivo desde `/loteadora`, no guardada en el admin — ver §11).

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

Al seleccionar una loteadora en `/loteadora` aparece un desplegable **"Plantilla"** con los mensajes guardados en esa máquina (`GET /api/loteadora/mensajes?loteadoraId=...`, comando `1F`), sin preseleccionar ninguno — el operador elige cada vez. El botón **"Cargar plantilla"** llama a `POST /api/loteadora/cargar-mensaje` (`{loteadoraId, messageName}`), que ejecuta `loadPrintMessage()` (`1E` + `01`) directamente, sin comprobar el estado de impresión antes.

**`loteadoras` ya no guarda ningún nombre de plantilla** (columna `message_name` eliminada, migración `DROP COLUMN` en `lib/sqlite.ts`) — no tenía función real (el envío `1D` nunca la usaba) más allá de preseleccionar un valor por defecto, y con el selector en vivo ya no hacía falta.

**Corrección importante (probado en planta):** la primera versión de esto bloqueaba la carga si la impresora estaba imprimiendo, pensando que cambiar de plantilla en caliente interrumpiría un trabajo real. Eso creaba una contradicción imposible de resolver: **tanto `1F` (listar) como `1E` (cargar) exigen la impresión iniciada** para funcionar (`P_Status=12` "impresión no iniciada" si no) — con el bloqueo puesto, para poder listar plantillas había que iniciar, pero para cargarlas había que pararla. Además, el manual documenta explícitamente que en el firmware **T1/T2** (la variante de 5 bytes que ya confirmamos que usa esta máquina, ver §9) **está permitido actualizar el contenido con la impresión iniciada** — es el comportamiento que el propio fabricante espera, no un riesgo a evitar. Se quitó el bloqueo por completo.

El comando `1D` (envío de lote/caducidad) sigue actuando igual que antes: sobre lo que esté cargado en ese momento, se haya cambiado de plantilla desde el dashboard o no.

---

## 12. Limpiar el buffer de campos remotos

El botón **"Limpiar buffer"** de `/loteadora` llama a `POST /api/loteadora/limpiar-buffer` (`{loteadoraId}`), que ejecuta `clearRemoteFieldBuffer()` (comando `21` — Clear Buffers of 1D). Equivale a pulsar el botón "Clear" de **Ajustes de comunicación → Buffer** en la propia máquina: vacía la cola de envíos `1D` pendientes sin imprimir nada ni cambiar ningún valor.

**Por qué hace falta:** el campo remoto solo se actualiza cuando la impresora consume la cola al disparar una impresión real (paso por la célula fotoeléctrica). Si se hacen varios envíos de prueba sin que la máquina llegue a imprimir, la cola (hasta 10 según el "Number" configurado en Buffer Setting) se llena y no se vacía sola — los envíos siguientes devuelven aviso de buffer lleno (`42`/`43`, ver §6) y el valor mostrado en pantalla puede quedarse desactualizado (`Null Null` hasta el primer disparo real). Este botón permite desatascarlo desde el dashboard sin ir a la máquina.

Se descartó automatizar el disparo de impresión en sí (comando `13`, Trigger Print) porque dispara una impresión física real cada vez — limpiar el buffer no imprime nada, así que es una acción segura de repetir.
