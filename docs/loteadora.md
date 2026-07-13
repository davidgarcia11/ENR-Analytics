# Documentación — Loteadora (`/loteadora`)

> Documentación específica del panel de loteadora (impresión de lote y fecha de caducidad).
> Ver [DOCUMENTACION.md](../DOCUMENTACION.md) para la documentación base del proyecto.

---

## 1. Estado actual

**Panel en desarrollo, no conectado todavía a la impresora real.** Existe la UI completa (selección de artículo, cálculo de lote/caducidad, vista previa) pero el envío a la loteadora es un placeholder — no hay integración de red con la máquina.

Rama: `feature/loteadora`. Creada antes del rediseño UI/UX (PR #53), por lo que **no usa `AppShell`/tokens** como el resto de paneles — usa maquetación y colores hardcodeados heredados del diseño anterior.

**No sigue todavía el patrón de acceso configurable (`is_public`/`allowed_roles`) de otros paneles** — comprueba sesión con `/api/auth/me` y redirige a `/login` si no hay sesión, sin pasar por `middleware.ts` ni por la tabla de permisos de pantalla.

---

## 2. Archivos relevantes

| Archivo | Descripción |
|---|---|
| `app/loteadora/page.tsx` | Página cliente: selección marca/artículo, formulario, cálculo y vista previa |
| `app/api/loteadora/marcas/route.ts` | GET — lista de marcas desde `prodctl.F0005` (`DRSY='41'`, `DRRT='S4'`) |
| `app/api/loteadora/articulos/route.ts` | GET — artículos de una marca desde `F4101`, incluye días de caducidad |
| `components/SingleSelect.tsx` | Desplegable de selección única con buscador (reutilizado de otros paneles) |
| `lib/utils.ts` | `isoToJulian()` — convierte fecha ISO a formato Julian JDE (no usada aún por `page.tsx`, que tiene su propia función local `toJulianDay()`) |

---

## 3. Selección en cascada Marca → Artículo

1. Al montar la página se cargan las **marcas** (`GET /api/loteadora/marcas`).
2. Al elegir una marca, se cargan sus **artículos** (`GET /api/loteadora/articulos?marca=...`), incluyendo el campo `diasCaducidad` de cada uno.
3. Cambiar de marca resetea el artículo seleccionado y vuelve a pedir la lista de artículos.

Ambos desplegables usan `<SingleSelect>` con buscador integrado.

### Consultas Oracle

**Marcas** (`prodctl.F0005`):
```sql
SELECT TRIM(DRKY) AS id, TRIM(DRDL01) AS descripcion
FROM prodctl.f0005
WHERE TRIM(DRSY) = '41'
  AND TRIM(DRRT) = 'S4'
  AND TRIM(DRKY) IS NOT NULL
ORDER BY TRIM(DRKY)
```

**Artículos de una marca** (`F4101`, filtrados también por `IMSRP1='12'`):
```sql
SELECT TRIM(IMLITM) AS id, TRIM(IMDSC1) AS descripcion, NVL(IMSLD, 0) AS diasCaducidad
FROM F4101
WHERE TRIM(IMSRP4) = :marca
  AND TRIM(IMSRP1) = '12'
  AND TRIM(IMLITM) IS NOT NULL
ORDER BY TRIM(IMDSC1)
```

- `IMSRP4` = marca del artículo (campo de categoría usado como marca en este panel)
- `IMSLD` = días de caducidad del artículo en JDE (`NVL` a 0 si viene nulo)

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

## 6. Envío a la loteadora — pendiente

El botón "Enviar a loteadora" (`handleEnviar` en `page.tsx`) **no envía nada real todavía**:

```typescript
const handleEnviar = async () => {
  if (!canSend) return
  setSending(true)
  try {
    // TODO: conectar con el endpoint de la loteadora
    await new Promise(r => setTimeout(r, 600))
    setEnviado(true)
    setTimeout(() => setEnviado(false), 3000)
  } finally {
    setSending(false)
  }
}
```

Simula el envío con una espera de 600ms y muestra un mensaje de éxito. No hay endpoint `app/api/loteadora/enviar` ni ninguna conexión de red con la máquina física.

`canSend` exige: lote calculado, fecha de caducidad calculada, artículo seleccionado y que no haya un envío en curso.

---

## 7. La máquina física — hallazgos

La loteadora es una impresora de inyección de tinta térmica (TIJ) que expone un **protocolo de comandos por Ethernet** (documentado en `TIJ_Protocol 6.7.pdf`, no versionado en el repo) — actúa como servidor TCP, un único cliente a la vez.

**Formato de trama del protocolo de red:**
```
Comando:   1B 02 [SlaveAddr] [CmdID] [Data...] 1B 03 [Checknum]
Respuesta: 1B 06 [SlaveAddr] [P_Status] [CmdID] [Data...] 1B 03 [Checknum]
```
Checknum = complemento a 2 de la suma módulo-256 de todos los bytes.

**Mensajes actuales de la máquina:** se revisaron 21 archivos `.msg` exportados (plantillas de impresión). Todos usan **texto fijo** para el lote y la fecha de caducidad (grabado directamente en la plantilla) — **ninguno tiene campos remotos configurados** (la sección `fieldModule` está vacía en todos). Esto confirma que actualmente el cambio de lote se hace editando manualmente el texto en cada plantilla desde la propia pantalla de la máquina.

**El formato de archivo `.msg` no es el mismo que el protocolo de red** documentado en el PDF — usa una codificación binaria distinta (valores de coma flotante para coordenadas, frente a enteros de 2 bytes en el protocolo de red) — no hay especificación disponible para ese formato de archivo.

---

## 8. Datos pendientes de la máquina física

Para poder implementar el envío real hacen falta estos datos, que no están recogidos en ningún sitio del proyecto todavía:

- IP y puerto Ethernet de la impresora
- Slave Address configurada
- Nombre(s) de mensaje/plantilla con campos remotos ya creados en la máquina
- IDs de los campos remotos usados para lote y caducidad
