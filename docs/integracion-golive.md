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
| `500` o sin respuesta | — | Reintentar 2-3 veces con el mismo `id` |

`prueba: true` en la respuesta quiere decir que llegó con una clave de prueba. El `401` no dice por qué falla la clave (no existe, revocada, caducada o sin acceso a esta API), para no dar pistas: se mira en el panel. La respuesta solo confirma que el mensaje ha llegado y es correcto, no lo que haga el panel después.

---

## 2. La bandeja de entrada (`integracion_mensajes`)

Se guarda **cada** llamada con clave válida, correcta o no: fecha, tipo (`escaneo`), origen (`real` / `prueba`, el entorno de la clave), **con qué clave llegó** (su nombre, copiado: sigue aunque se elimine la clave), el cuerpo **tal cual llegó**, si era válido y por qué no, el `id` de GoLive, la IP y un `estado` (por ahora siempre `recibido`). Las llamadas sin clave válida (`401`) no se guardan: no son de GoLive.

- **Rechazados también:** si GoLive dice «os lo hemos mandado», en `/admin` → Integración se ve qué llegó y por qué se rechazó.
- **Reintentos:** con el mismo `id`, mismo tipo y misma clave, y si el primero era válido, se responde `duplicado` sin guardar otra fila. Sin `id`, cada llamada es un mensaje.
- **Prueba frente a real:** lo que llega con una clave de prueba se guarda marcado y **nunca** se procesará. GoLive puede probar contra producción sin riesgo, porque la API solo guarda.
- Cuerpo de 10.000 caracteres como mucho (`MAX_CUERPO`).

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

## 5. Siguiente paso: procesar los mensajes

Cuando se decida qué hace el panel con cada caso (`OK` / `NO_OK`, por línea…):
- Programarlo aparte de la ruta (la ruta solo recibe), sobre los mensajes con `origen = 'real'` y `valido = 1`, y pasar su `estado` a `procesado` / `error` / `ignorado`.
- Encenderlo con un interruptor (p. ej. una variable en `.env.local`) para poder apagarlo sin desplegar.
- Probarlo primero volviendo a procesar mensajes ya guardados.
- Si hace falta otro tipo de mensaje, otra ruta bajo `/api/integracion/v1/` (y añadirla a `SIN_SESION`). Si cambia el contrato de uno existente de forma incompatible, una `v2`.
