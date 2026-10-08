# Documentación — API de integración con GoLive

GoLive (JDE) avisa al dashboard de cada palet escaneado contra una orden de fabricación. La idea a futuro es que, con esos avisos, `/loteadora` se prepare sola (elegir el artículo en la loteadora de esa línea, sacar la cocida del lote…).

**Estado actual (oct. 2026): bandeja de entrada.** La API comprueba cada mensaje y lo **guarda**, pero el panel **no hace nada** con él. Así GoLive puede programar y probar desde ya. Qué hace el panel con cada caso se programará después, con los mensajes reales a la vista en `/admin` → Integración.

Archivos:

| Archivo | Qué hace |
|---|---|
| `app/api/integracion/v1/escaneo/route.ts` | `POST`: comprueba la clave y el cuerpo, guarda y responde |
| `lib/integracion.ts` | Validación del escaneo y lectura/escritura de la bandeja (`integracion_mensajes`) |
| `lib/api-claves.ts` | Claves de API: generar, comprobar, editar, rotar, revocar y eliminar (`api_claves`) |
| `app/api/admin/integracion/route.ts` | `GET` de los mensajes recibidos, con filtros (permiso `admin.integracion.ver`) |
| `app/api/admin/api-claves/…` | Gestión de las claves (solo admin) |
| `components/nova/admin/integracion.tsx` | `/admin` → Integración › **Mensajes recibidos** |
| `components/nova/admin/api-claves.tsx` | `/admin` → Integración › **Claves de API** |
| `proxy.ts` | `/api/integracion/v1/escaneo` está en `SIN_SESION`: se autentica con `x-api-key`, no con la cookie. Solo esa ruta exacta |

---

## 1. Contrato (lo que se le pasa a GoLive)

**Especificación OpenAPI 3: la fuente de verdad del contrato.** [`integracion-golive.openapi.yaml`](integracion-golive.openapi.yaml): campos, formatos, respuestas y ejemplos. Es lo que se le da a GoLive. No lleva claves ni IPs reales (el servidor es una variable). Ver §6 para cómo se ve, se descarga y se mantiene al día.

**POST** `http://<servidor del dashboard>:3000/api/integracion/v1/escaneo`

Cabeceras:
- `Content-Type: application/json`
- `x-api-key: <clave>`: una clave creada en el panel, **de prueba** (`enr_test_…`) o **real** (`enr_live_…`) (ver §3).

Cuerpo:

```json
{
  "articulo": "1210500019",
  "resultado": "OK",
  "linea": "18",
  "lote": "263221",
  "sscc": "384123450000000017",
  "orden": "490387",
  "id": "a1b2c3d4-0001"
}
```

| Campo | Obligatorio | Formato |
|---|---|---|
| `articulo` | Sí | Código largo de 10 cifras |
| `resultado` | Sí | `"OK"` (el artículo está en la orden) o `"NO_OK"` |
| `linea` | Sí | Línea donde se ha escaneado (la misma que tiene cada loteadora en Máquinas) |
| `lote` | Sí, puede ir `""` | Lote de la orden, tal cual en JDE (hasta 30 caracteres) |
| `sscc` | Sí, puede ir `""` | 18 cifras del palet, sin el `(00)` |
| `orden` | No | Nº de la orden de fabricación |
| `motivo` | No | Texto, si es `NO_OK` (hasta 200) |
| `id` | No, recomendado | Identificador único del mensaje (hasta 64). Si se reintenta con el mismo `id`, no se guarda dos veces |

- **Todo como texto, entre comillas.** El SSCC tiene 18 cifras y como número JSON pierde precisión, así que un número se rechaza.
- Campos que no estén en la tabla se aceptan y se guardan (no se rompe nada si mañana mandan uno más).

Respuestas:

| HTTP | Cuerpo | Qué hacer |
|---|---|---|
| `202` | `{"ok": true, "id": "…", "estado": "recibido", "prueba": false}` | Nada: entregado |
| `200` | `{"ok": true, "id": "…", "estado": "duplicado", …}` | Nada: ese `id` ya había llegado |
| `400` | `{"ok": false, "errores": ["sscc: deben ser 18 cifras, sin el (00)"]}` | Corregir; **no reintentar** |
| `401` | `{"ok": false, "error": "Clave no válida (cabecera x-api-key)"}` | Revisar la clave; no reintentar |
| `413` | `{"ok": false, "errores": ["El cuerpo ocupa demasiado (máximo 10000 bytes)"]}` | Corregir lo que se envía; no reintentar |
| `429` | `{"ok": false, "error": "Demasiadas peticiones: como mucho 120 por minuto con cada clave"}` + cabecera `Retry-After` | Esperar esos segundos y reintentar con el mismo `id` |
| `500` o sin respuesta | — | Reintentar 2-3 veces con el mismo `id` |

`prueba: true` en la respuesta quiere decir que llegó con una clave de prueba. El `401` no dice por qué falla la clave (no existe, revocada, caducada o sin acceso a esta API), para no dar pistas: se mira en el panel. La respuesta solo confirma que el mensaje ha llegado y es correcto, no lo que haga el panel después.

---

## 2. La bandeja de entrada (`integracion_mensajes`)

Se guarda **cada** llamada con clave válida, correcta o no: fecha, tipo (`escaneo`), origen (`real` / `prueba`, el entorno de la clave), **con qué clave llegó** (su nombre, copiado: sigue aunque se elimine la clave), el cuerpo **tal cual llegó**, si era válido y por qué no, el `id` de GoLive, la IP y un `estado` (por ahora siempre `recibido`). Las llamadas sin clave válida (`401`) no se guardan: no son de GoLive.

- **Rechazados también:** si GoLive dice «os lo hemos mandado», en `/admin` → Integración se ve qué llegó y por qué se rechazó.
- **Reintentos:** con el mismo `id`, mismo tipo y misma clave, y si el primero era válido, se responde `duplicado` sin guardar otra fila. Sin `id`, cada llamada es un mensaje.
- **Prueba frente a real:** lo que llega con una clave de prueba se guarda marcado y **nunca** se procesará. GoLive puede probar contra producción sin riesgo, porque la API solo guarda.
- **Tamaño:** 10.000 bytes como mucho (`MAX_CUERPO`). `leerCuerpo()` deja de leer al pasar del límite, aunque la cabecera `Content-Length` mienta o no venga: un cuerpo enorme no se carga en memoria (`413`).
- **Límite de envíos:** 120 por minuto con cada clave (`LIMITE_POR_MINUTO`, `dentroDelLimite()` en `lib/api-claves.ts`), comprobado antes de leer el cuerpo; por encima, `429` con `Retry-After` y no se guarda nada. Contra una clave filtrada o un bucle en el programa que llama. En memoria del proceso: basta con un único servidor.
- **Conservación:** los mensajes **reales se guardan siempre** (trazabilidad); los **de prueba se borran a los 90 días** (`DIAS_MENSAJES_PRUEBA`, `limpiarPruebasAntiguas()`), al arrancar el servidor y luego una vez al día (`arrancarLimpieza()`, desde `instrumentation.ts`).

**Ver lo recibido:** `/admin` → Integración › **Mensajes recibidos**, con el permiso **«Integración: ver»** (el admin siempre). Lo más reciente primero, de 50 en 50, con filtros de origen, correctos o con errores, fechas y búsqueda en el cuerpo (artículo, lote, SSCC…). Cada fila enseña los datos principales y, desplegando, el JSON recibido.

---

## 3. Claves de API

Se gestionan en **`/admin` → Integración › Claves de API**, **solo el admin** (`lib/api-claves.ts`). Nada en `.env.local`.

| Acción | Qué hace |
|---|---|
| **Nueva clave** | Nombre (*«GoLive pruebas»*), entorno (**prueba** → `enr_test_…`, **real** → `enr_live_…`), a qué APIs da acceso (`AMBITOS`; hoy solo el escaneo), caducidad opcional y notas. La clave completa se enseña **una sola vez**, con botón de copiar |
| **Editar** | Nombre, APIs, caducidad y notas. La clave no cambia |
| **Rotar…** | Crea otra con la misma configuración y pone fin a la vieja: ya (se revoca) o dentro de 1 o 7 días. Mientras tanto valen las dos, para cambiarla sin cortes. Si la vieja ya caducaba antes, se respeta |
| **Revocar** | Deja de valer al momento. No se puede deshacer |
| **Eliminar** | Solo revocadas o caducadas. Los mensajes recibidos con ella se conservan, con su nombre |

- **Caducidad:** una fecha (vale hasta ese día incluido, hora local) o ninguna (vale hasta que se revoque). En la lista sale en ámbar si caduca en los próximos 7 días.
- **Estado y uso:** Activa / Caducada / Revocada; quién la creó o revocó y cuándo; último uso (fecha e IP).
- **En la BD solo la huella SHA-256** (tabla `api_claves`) y el prefijo visible (`enr_test_3f9a…`): aunque alguien copie la BD, no saca las claves. Son 192 bits al azar.
- **Comprobación** (`verificarClave`): existe, no está revocada ni caducada y da acceso a esa API. Si vale, apunta el último uso.
- Pasárselas a GoLive **por un canal privado** (no en un correo con más destinatarios, no en ClickUp). Empezar con **una de prueba**; la real, el día que pasen a producción.
- Solo dentro de la red de la empresa: va por `http://`, sin cifrar. Si algún día llaman desde fuera, hace falta HTTPS antes de abrirlo.
- **La IP que se ve (mensajes y «Último uso») es orientativa, no comprobada.** Sale de `x-forwarded-for`, que Next.js solo rellena si no viene en la petición: quien llama puede poner la que quiera (probado: con `x-forwarded-for: 10.99.99.99` se apunta esa). Por eso **no hay restricción por IP en la app**: sería falsa. Si hace falta de verdad (p. ej. cuando el panel actúe con los mensajes), la forma es que la integración escuche en **otro puerto** y abrir ese puerto en el **cortafuegos de Windows** solo a la IP de GoLive: ahí la IP la comprueba el sistema operativo.
- **Una API nueva con clave:** una entrada en `AMBITOS` (`lib/api-claves.ts`) y `verificarClave(db, clave, '<ámbito>', ip)` en su ruta (y la ruta en `SIN_SESION` de `proxy.ts`).

Historia: en la v1.28.0 había dos claves fijas en `.env.local` (`INTEGRACION_API_KEY` / `_PRUEBAS`); desde la v1.29.0 se gestionan en el panel y esas variables ya no se usan (se pueden borrar). En la misma versión se quitó `/api/jde-orders` (y su `SERES_API_KEY`), que no usaba nadie.

---

## 4. Probar a mano

```bash
curl -i -X POST http://localhost:3000/api/integracion/v1/escaneo -H "Content-Type: application/json" -H "x-api-key: <clave de prueba>" -d "{\"articulo\":\"1210500019\",\"resultado\":\"OK\",\"linea\":\"18\",\"lote\":\"263221\",\"sscc\":\"384123450000000017\"}"
```

Debe responder `202` y aparecer en `/admin` → Integración › Mensajes recibidos marcado como **Prueba**, con el nombre de la clave. En Claves de API, su «Último uso» se actualiza.

---

## 6. Documentación, contrato y versiones

**Dónde se ve:** `/admin` → Integración › **Documentación de la API** (permiso «Integración: ver»), con Swagger UI.
- Lee el `.yaml` **del código desplegado** (`GET /api/admin/integracion/openapi`): siempre coincide con la API que está corriendo, sin copias.
- **Try it out** funciona contra este mismo servidor: *Authorize* con una clave de prueba y *Try it out*. Lo enviado aparece en Mensajes recibidos, marcado como prueba.
- **Descargar openapi.yaml** (`?descargar=1`): para importarlo en Apidog, Postman o Insomnia (documentación, mock, pruebas), o pasárselo a GoLive.
- **Cabeceras de seguridad del visor:** política de contenido estricta (solo scripts y estilos de este servidor, sin scripts en línea: el arranque va en `iniciar.js`; peticiones solo a este servidor), `frame-ancestors 'self'` (solo se puede incrustar en el propio dashboard), `nosniff` y `Referrer-Policy: no-referrer`. Comprobado que Swagger UI y «Try it out» funcionan con ella.
- Swagger UI va **instalado en el proyecto** (`swagger-ui-dist`, versión fija en `package.json`) y lo sirve `app/api/admin/integracion/docs/[[...archivo]]/route.ts` (solo sus dos archivos, de una lista). No se carga de una web externa: en una página con sesión no se ejecuta código de terceros de Internet. Su telemetría de instalación (`@scarf/scarf`) está desactivada (`scarfSettings` en `package.json`; Bun además no ejecuta su script).

**Test de contrato** (`__tests__/openapi.test.ts`): falla si el `.yaml` y el código dejan de decir lo mismo. Comprueba que:
- los ejemplos de envío los acepta la validación real;
- los obligatorios, los opcionales, las longitudes máximas, los formatos y el enum de `resultado` coinciden con `validarEscaneo`;
- los errores de los ejemplos de `400` y `401`, y los estados de `202`/`200`, son los que dan el código y la ruta;
- la cabecera es `x-api-key` y no hay claves ni IPs reales en el archivo.

Así que **cambiar la API obliga a cambiar el `.yaml`** (y al revés): `bun test` lo para.

**Versiones** (`info.version` en el `.yaml`, versionado semántico):
- **Compatible** (añadir un campo opcional, una respuesta nueva, mejorar textos): sube la versión menor o el parche (`1.1.0`, `1.0.1`). La dirección sigue siendo `/v1`.
- **Incompatible** (quitar o renombrar un campo, hacer obligatorio uno opcional, cambiar un formato o el significado de una respuesta): **ruta nueva `/v2`**, con su propio `.yaml` o sección. La `/v1` sigue funcionando hasta que GoLive migre, y se avisa con tiempo.
- Cada cambio se apunta en el historial.

**Historial de cambios de la API:**

| Versión | Fecha | Cambio |
|---|---|---|
| 1.1.0 | oct. 2026 | Respuestas `413` (cuerpo de más de 10000 bytes) y `429` (más de 120 peticiones por minuto con una clave, con `Retry-After`). Compatible: no cambia nada de lo que ya funcionaba |
| 1.0.0 | oct. 2026 | Primera versión: `POST /api/integracion/v1/escaneo` (`articulo`, `resultado`, `linea`, `lote`, `sscc`; `orden`, `motivo`, `id` opcionales). Claves de API desde el panel |

---

## 7. Siguiente paso: procesar los mensajes

Cuando se decida qué hace el panel con cada caso (`OK` / `NO_OK`, por línea…):
- Programarlo aparte de la ruta (la ruta solo recibe), sobre los mensajes con `origen = 'real'` y `valido = 1`, y pasar su `estado` a `procesado` / `error` / `ignorado`.
- Encenderlo con un interruptor (p. ej. una variable en `.env.local`) para poder apagarlo sin desplegar.
- Probarlo primero volviendo a procesar mensajes ya guardados.
- Si hace falta otro tipo de mensaje, otra ruta bajo `/api/integracion/v1/` (y añadirla a `SIN_SESION`). Si cambia el contrato de uno existente de forma incompatible, una `v2`.
