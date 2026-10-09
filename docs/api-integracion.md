# Documentación — API de integración

API para que **sistemas externos** avisen al dashboard. Hoy tiene una: el aviso de cada palet escaneado contra una orden de fabricación (`POST /api/integracion/v1/escaneo`). La idea a futuro es que, con esos avisos, `/loteadora` se prepare sola (elegir el artículo en la loteadora de esa línea, sacar la cocida del lote…).

**Estado actual (oct. 2026): bandeja de entrada.** La API comprueba cada mensaje y lo **guarda**, pero el panel **no hace nada** con él. Así quien la integra puede programar y probar desde ya. Qué hace el panel con cada caso se programará después, con los mensajes reales a la vista en `/admin` → Integración.

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

**Quién la usa hoy (oct. 2026):** GoLive, el equipo que integra el escaneo de palets en JDE (contacto: Eduardo). El contrato se acordó con ellos, y su clave se llama «GoLive pruebas» (y «GoLive» la real, cuando pasen a producción). Es **el único sitio** donde se les nombra: el resto de la app, el código y lo que se entrega hablan de «sistemas externos», porque la API vale para cualquiera con una clave.

---

## 1. Contrato (lo que se entrega a quien integra)

**Especificación OpenAPI 3: la fuente de verdad del contrato.** [`api-integracion.openapi.yaml`](api-integracion.openapi.yaml): campos, formatos, respuestas y ejemplos. Es lo que se entrega a quien integra. No lleva claves ni IPs reales (el servidor es una variable). Ver §6 para cómo se ve y se mantiene al día.

**El `.yaml` se entrega tal cual a terceros:** va **sin comentarios** y sin referencias internas (rutas del código, `/admin`, «dashboard», «panel», loteadoras…), redactado para quien llama y **sin nombrar a ningún cliente**: la API es para cualquier sistema con una clave. Lo vigila el test de contrato. Las notas de mantenimiento van aquí, no en el archivo.

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

Se guarda **cada** llamada con clave válida, correcta o no: fecha, tipo (`escaneo`), origen (`real` / `prueba`, el entorno de la clave), **con qué clave llegó** (su nombre, copiado: sigue aunque se elimine la clave), el cuerpo **tal cual llegó**, si era válido y por qué no, el `id` de quien envía, la IP y un `estado` (por ahora siempre `recibido`). Las llamadas sin clave válida (`401`) no se guardan: no son de ningún sistema autorizado.

- **Rechazados también:** si quien integra dice «os lo hemos mandado», en `/admin` → Integración se ve qué llegó y por qué se rechazó.
- **Reintentos:** con el mismo `id`, mismo tipo y misma clave, y si el primero era válido, se responde `duplicado` sin guardar otra fila. Sin `id`, cada llamada es un mensaje.
- **Prueba frente a real:** lo que llega con una clave de prueba se guarda marcado y **nunca** se procesará. Quien integra puede probar contra producción sin riesgo, porque la API solo guarda.
- **Tamaño:** 10.000 bytes como mucho (`MAX_CUERPO`). `leerCuerpo()` deja de leer al pasar del límite, aunque la cabecera `Content-Length` mienta o no venga: un cuerpo enorme no se carga en memoria (`413`).
- **Límite de envíos:** 120 por minuto con cada clave (`LIMITE_POR_MINUTO`, `dentroDelLimite()` en `lib/api-claves.ts`), comprobado antes de leer el cuerpo; por encima, `429` con `Retry-After` y no se guarda nada. Contra una clave filtrada o un bucle en el programa que llama. En memoria del proceso: basta con un único servidor.
- **Conservación:** los mensajes **reales se guardan siempre** (trazabilidad); los **de prueba se borran a los 90 días** (`DIAS_MENSAJES_PRUEBA`, `limpiarPruebasAntiguas()`), al arrancar el servidor y luego una vez al día (`arrancarLimpieza()`, desde `instrumentation.ts`).

**Ver lo recibido:** `/admin` → Integración › **Mensajes recibidos**, con el permiso **«Integración: ver»** (el admin siempre). Lo más reciente primero, de 50 en 50, con filtros de origen, correctos o con errores, fechas y búsqueda en el cuerpo (artículo, lote, SSCC…). Cada fila enseña los datos principales y, desplegando, el JSON recibido.

---

## 3. Claves de API

Se gestionan en **`/admin` → Integración › Claves de API**, **solo el admin** (`lib/api-claves.ts`). Nada en `.env.local`.

| Acción | Qué hace |
|---|---|
| **Nueva clave** | Nombre del sistema y entorno (*«ERP pruebas»*), entorno (**prueba** → `enr_test_…`, **real** → `enr_live_…`), a qué APIs da acceso (`AMBITOS`; hoy solo «Aviso de escaneo de palet»), caducidad opcional y notas. La clave completa se enseña **una sola vez**, con botón de copiar (por `http://` el navegador no da el portapapeles moderno, que exige `https` o `localhost`: se copia seleccionando el campo, el método clásico) |
| **Editar** | Nombre, APIs, caducidad y notas. La clave no cambia |
| **Rotar…** | Crea otra con la misma configuración y pone fin a la vieja: ya (se revoca) o dentro de 1 o 7 días. Mientras tanto valen las dos, para cambiarla sin cortes. Si la vieja ya caducaba antes, se respeta |
| **Revocar** | Deja de valer al momento. No se puede deshacer |
| **Eliminar** | Solo revocadas o caducadas. Los mensajes recibidos con ella se conservan, con su nombre |

- **Caducidad:** una fecha (vale hasta ese día incluido, hora local) o ninguna (vale hasta que se revoque). En la lista sale en ámbar si caduca en los próximos 7 días.
- **Estado y uso:** Activa / Caducada / Revocada; quién la creó o revocó y cuándo; último uso (fecha e IP).
- **En la BD solo la huella SHA-256** (tabla `api_claves`) y el prefijo visible (`enr_test_3f9a…`): aunque alguien copie la BD, no saca las claves. Son 192 bits al azar.
- **Comprobación** (`verificarClave`): existe, no está revocada ni caducada y da acceso a esa API. Si vale, apunta el último uso.
- Pasárselas a quien integra **por un canal privado** (no en un correo con más destinatarios, no en ClickUp). Empezar con **una de prueba**; la real, el día que pasen a producción.
- Solo dentro de la red de la empresa: va por `http://`, sin cifrar. Si algún día llaman desde fuera, hace falta HTTPS antes de abrirlo.
- **La IP que se ve (mensajes y «Último uso») es orientativa, no comprobada.** Sale de `x-forwarded-for`, que Next.js solo rellena si no viene en la petición: quien llama puede poner la que quiera (probado: con `x-forwarded-for: 10.99.99.99` se apunta esa). Por eso **no hay restricción por IP en la app**: sería falsa. Si hace falta de verdad (p. ej. cuando el panel actúe con los mensajes), la forma es que la integración escuche en **otro puerto** y abrir ese puerto en el **cortafuegos de Windows** solo a la IP del sistema que llama: ahí la IP la comprueba el sistema operativo.
- **Una API nueva con clave:** una entrada en `AMBITOS` (`lib/api-claves.ts`), con una etiqueta que diga qué hace la API, no quién la usa (eso va en el nombre de cada clave), y `verificarClave(db, clave, '<ámbito>', ip)` en su ruta (y la ruta en `SIN_SESION` de `proxy.ts`).

Historia: en la v1.28.0 había dos claves fijas en `.env.local` (`INTEGRACION_API_KEY` / `_PRUEBAS`); desde la v1.29.0 se gestionan en el panel y esas variables ya no se usan (se pueden borrar). En la misma versión se quitó `/api/jde-orders` (y su `SERES_API_KEY`), que no usaba nadie.

---

## 4. Probar a mano

```bash
curl -i -X POST http://localhost:3000/api/integracion/v1/escaneo -H "Content-Type: application/json" -H "x-api-key: <clave de prueba>" -d "{\"articulo\":\"1210500019\",\"resultado\":\"OK\",\"linea\":\"18\",\"lote\":\"263221\",\"sscc\":\"384123450000000017\"}"
```

Debe responder `202` y aparecer en `/admin` → Integración › Mensajes recibidos marcado como **Prueba**, con el nombre de la clave. En Claves de API, su «Último uso» se actualiza.

---

## 6. Documentación, contrato y versiones

**Regla: toda API para sistemas externos se documenta siempre aquí y en `api-integracion.openapi.yaml`, en el mismo PR que el código** (pasos en `CLAUDE.md`, «Añadir o cambiar una API para sistemas externos»). Las rutas internas que usan las pantallas del panel no: esas van en `DOCUMENTACION.md`.

**Cómo verlo:** el `.yaml` se abre en IntelliJ (con soporte de OpenAPI) o VS Code con vista previa, o se importa en Postman, Apidog o Insomnia (documentación, mock, pruebas). Para entregarlo a quien integra, se manda el archivo tal cual (con el nombre `api-escaneo-palets.openapi.yaml`, por ejemplo).

Hubo una sección **Documentación de la API** en `/admin` → Integración, con Swagger UI (`swagger-ui-dist`), «Try it out» y descarga del `.yaml` (v1.30.0 – v1.30.2). Se quitó en la v1.30.3 porque nadie la usaba (GoLive no necesita el archivo): una dependencia y dos rutas menos que mantener. Si vuelve a hacer falta, está en el historial de git.

**Test de contrato** (`__tests__/openapi.test.ts`): falla si el `.yaml` y el código dejan de decir lo mismo. Comprueba que:
- los ejemplos de envío los acepta la validación real;
- los obligatorios, los opcionales, las longitudes máximas, los formatos y el enum de `resultado` coinciden con `validarEscaneo`;
- los errores de los ejemplos de `400` y `401`, y los estados de `202`/`200`, son los que dan el código y la ruta;
- la cabecera es `x-api-key` y no hay claves ni IPs reales en el archivo.

Así que **cambiar la API obliga a cambiar el `.yaml`** (y al revés): `bun test` lo para.

**Versiones** (`info.version` en el `.yaml`, versionado semántico):
- **Compatible** (añadir un campo opcional, una respuesta nueva, mejorar textos): sube la versión menor o el parche (`1.1.0`, `1.0.1`). La dirección sigue siendo `/v1`.
- **Incompatible** (quitar o renombrar un campo, hacer obligatorio uno opcional, cambiar un formato o el significado de una respuesta): **ruta nueva `/v2`**, con su propio `.yaml` o sección. La `/v1` sigue funcionando hasta que quien la usa migre, y se avisa con tiempo.
- Cada cambio se apunta en el historial.

**Historial de cambios de la API:**

| Versión | Fecha | Cambio |
|---|---|---|
| 1.1.1 | oct. 2026 | Solo textos: redactado para entregar a terceros (sin comentarios ni referencias internas); la línea, «solo el número». Sin cambios en el contrato |
| 1.1.0 | oct. 2026 | Respuestas `413` (cuerpo de más de 10000 bytes) y `429` (más de 120 peticiones por minuto con una clave, con `Retry-After`). Compatible: no cambia nada de lo que ya funcionaba |
| 1.0.0 | oct. 2026 | Primera versión: `POST /api/integracion/v1/escaneo` (`articulo`, `resultado`, `linea`, `lote`, `sscc`; `orden`, `motivo`, `id` opcionales). Claves de API desde el panel |

---

## 7. Siguiente paso: procesar los mensajes

Cuando se decida qué hace el panel con cada caso (`OK` / `NO_OK`, por línea…):
- Programarlo aparte de la ruta (la ruta solo recibe), sobre los mensajes con `origen = 'real'` y `valido = 1`, y pasar su `estado` a `procesado` / `error` / `ignorado`.
- Encenderlo con un interruptor (p. ej. una variable en `.env.local`) para poder apagarlo sin desplegar.
- Probarlo primero volviendo a procesar mensajes ya guardados.
- Si hace falta otro tipo de mensaje, otra ruta bajo `/api/integracion/v1/` (y añadirla a `SIN_SESION`). Si cambia el contrato de uno existente de forma incompatible, una `v2`.
