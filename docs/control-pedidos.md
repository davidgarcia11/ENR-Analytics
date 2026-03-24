# Documentación — Control de Pedidos (`/preparacion-pedidos`)

> Documentación específica del dashboard de preparación de pedidos.
> Ver [DOCUMENTACION.md](../DOCUMENTACION.md) para la documentación base del proyecto.

---

## Preparación de Pedidos — `/preparacion-pedidos`

### Visión general

Panel para controlar el progreso de asignación de palets/lotes a pedidos de venta. Consulta la tabla **F4211** (Sales Order Detail) de Oracle JDE.

**Concepto clave:** Una línea de pedido está **asignada** si tiene lote (`SDLOTN` no vacío). Si no tiene lote, está **pendiente**. El progreso se calcula como la proporción de cantidad asignada (con lote) sobre la cantidad total pedida.

### Navegación

- Desde `/produccion`: botón "Pedidos" en la barra de sesión
- Desde `/preparacion-pedidos`: botón "Producción" para volver

### API — `GET /api/plants`

**Archivo:** `app/api/plants/route.ts`

Devuelve la lista de plantas desde Oracle (tabla F0006, filtro `MCSTYL = 'BP'`).

**Respuesta:**
```json
[
  { "id": "10100", "description": "Aguilar" },
  { "id": "10200", "description": "Corella" },
  { "id": "10300", "description": "Funes" }
]
```

> **Nota:** Este endpoint se usa **solo en Pedidos**. El panel de Producción tiene las plantas hardcodeadas porque maneja lógica de sub-plantas (ver sección "Cómo Añadir Plantas").

### API — `GET /api/orders`

**Archivo:** `app/api/orders/route.ts`

**Parámetros:**

| Param | Tipo | Descripción |
|---|---|---|
| `plant` | string | Código planta (MCMCU de F0006) o vacío para todas |
| `startDate` | string | Fecha carga desde (YYYY-MM-DD) → filtra `SDPDDJ` |
| `endDate` | string | Fecha carga hasta (YYYY-MM-DD) → filtra `SDPDDJ` |
| `deliveryStartDate` | string | Fecha entrega desde (YYYY-MM-DD) → filtra `SDRSDJ` |
| `deliveryEndDate` | string | Fecha entrega hasta (YYYY-MM-DD) → filtra `SDRSDJ` |

**Lógica:**
1. Carga nombres de planta desde F0006 (`MCSTYL = 'BP'`) para resolver `plantName` dinámicamente
2. Consulta F4211 excluyendo líneas cerradas (`SDNXTR != 999`)
3. Agrupa por pedido (`SDDOCO`) y por artículo (`SDAITM`)
4. Clasifica cada línea como asignada (tiene `SDLOTN`) o pendiente (sin `SDLOTN`)
5. Suma `SDUORG/100` por artículo: `totalOrdered`, `totalAssigned` (con lote), `totalPending` (sin lote)
6. Calcula progreso: `totalAssigned / totalOrdered × 100`
7. Determina estado del pedido: `completado` (todos los artículos al 100%), `en_progreso` (alguno asignado), `pendiente` (ninguno asignado)
8. Registra en logs con `source: 'pedidos'`

**Respuesta:**
```json
{
  "orders": [{
    "orderNumber": 12345,
    "loadDate": "2026-03-09T...",
    "deliveryDate": "2026-03-12T...",
    "plant": "10300",
    "plantName": "Funes",
    "articles": [{
      "itemNumber": "0001234567",
      "description": "PRODUCTO X",
      "totalOrdered": 500,
      "totalAssigned": 300,
      "totalPending": 200,
      "uom": "UN",
      "progress": 60,
      "lots": [
        { "lineNumber": 1, "qtyOrdered": 300, "lot": "PAL001", "assigned": true },
        { "lineNumber": 2, "qtyOrdered": 200, "lot": "", "assigned": false }
      ]
    }],
    "totalArticles": 1,
    "overallProgress": 60,
    "status": "en_progreso"
  }],
  "summary": {
    "totalOrders": 50,
    "completados": 10,
    "enProgreso": 25,
    "pendientes": 15
  }
}
```

### Campos de F4211 utilizados

| Campo | Descripción |
|---|---|
| `SDDOCO` | Número de pedido de venta |
| `SDPDDJ` | Fecha de carga (formato JDE CYYDDD) |
| `SDRSDJ` | Fecha de entrega (formato JDE CYYDDD) |
| `SDMCU` | Planta (Business Unit) |
| `SDAITM` | Artículo (display) |
| `SDDSC1` | Descripción del artículo |
| `SDUORG` | Cantidad pedida (×100) |
| `SDLOTN` | Lote/palet asignado (vacío = pendiente) |
| `SDLNID` | Número de línea |
| `SDUOM` | Unidad de medida |
| `SDNXTR` | Estado siguiente (999 = cerrado, se excluye) |

### Página — `app/preparacion-pedidos/page.tsx`

Client Component. Estructura visual:

```
┌─────────────────────────────────────────────────────────┐
│ [LOGO]                      [Usuario ▪ Producción ▪ Salir]│
│                                                         │
│ Preparación de Pedidos                                  │
│                                                         │
│ ┌─ Filtros ──────────────────────────────────────────┐  │
│ │ F.Carga Inicio│F.Carga Fin│F.Entrega Inicio│       │  │
│ │ F.Entrega Fin│Planta                                │  │
│ │ ─────────────────────────────────────────          │  │
│ │ ☑ Pendientes ☑ En Progreso ☑ Completados          │  │
│ │                    [Filtrar][Excel][Limpiar]        │  │
│ └────────────────────────────────────────────────────┘  │
│                                                         │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐   │
│ │  Total   │ │Completad.│ │En Progr. │ │Pendientes│   │
│ │   50     │ │    10    │ │    25    │ │    15    │   │
│ └──────────┘ └──────────┘ └──────────┘ └──────────┘   │
│                                                         │
│ ┌─ Pedidos (tabla expandible) ──────────────────────┐  │
│ │ ▶ 12345 │ 09/03 │ 12/03 │ Funes │ 3 │ ██░ 60% │  │
│ │   ▼ (expandido)                                    │  │
│ │   Artículo │ Desc. │ Pedido │ Asig. │ Pend. │ %  │  │
│ │   00001234 │ PROD..│  500   │  300  │  200  │60% │  │
│ │     ▼ (expandido)                                  │  │
│ │     Línea 1 │ 300 │ ✓ 300 │       │ PAL001       │  │
│ │     Línea 2 │ 200 │       │ 200   │ —            │  │
│ └────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

**Tabla expandible a 3 niveles:**
1. **Pedido:** Nº pedido, Fecha carga, Fecha entrega, Planta, Nº artículos, Barra progreso, Estado (badge)
2. **Artículos (agrupados por `SDAITM`):** Artículo, Descripción, Total pedido, Total asignado (verde), Total pendiente (ámbar), Barra progreso, UM
3. **Lotes/líneas individuales:** Nº línea, Cantidad, Asignado/Pendiente, Lote/Palet

**Ordenamiento:** Pendientes primero, En Progreso segundo, Completados último.

**Checkboxes de estado:** Permiten mostrar/ocultar pedidos por estado sin re-consultar la API. Filtro local instantáneo.

**Filtros:**
- Fecha Carga Inicio / Fin (`SDPDDJ`)
- Fecha Entrega Inicio / Fin (`SDRSDJ`)
- Planta (dinámicas desde Oracle F0006 vía `/api/plants`, o "Todas")
- Por defecto: fecha carga = hoy, fechas entrega vacías

**Export Excel:** Incluye todas las líneas de los pedidos filtrados con: Pedido, Fecha Carga, Fecha Entrega, Planta, Artículo, Descripción, Línea, Cant. Pedida, Lote/Palet, Asignado (SÍ/NO), Totales por artículo, % Progreso, UM, Estado.

---

## Cómo Añadir Plantas y Sub-plantas al Dashboard de Producción

> **Importante:** El panel de Producción tiene las plantas y sub-plantas **hardcodeadas** a propósito. La lógica de sub-plantas (Funes 1, Funes 2, Funes Past.) está acoplada al campo `F55TAR12.TO55TAREA` y no puede resolverse dinámicamente desde Oracle. El panel de **Pedidos** sí usa plantas dinámicas desde `/api/plants` (F0006).

### Añadir una nueva planta (sin sub-plantas)

Ejemplo: añadir planta "Tudela" con código `10400`.

**Cambio 1 — `app/produccion/page.tsx`** (dropdown de planta):

Buscar el `<select>` de plantas y añadir una nueva `<option>`:
```tsx
<option value="10400">Tudela</option>
```

**Cambio 2 — `lib/utils.ts`** (función `parseJdeDate`):

En el `switch` que resuelve el nombre de planta, añadir:
```ts
case '10400':
  plantName = 'Tudela';
  break;
```

Con estos 2 cambios, la planta aparecerá en el filtro y los registros de F55TAR12 con `TRIM(TO55MCU) = '10400'` se mostrarán correctamente.

### Añadir una nueva sub-planta a una planta existente

Ejemplo: añadir sub-planta "Funes Conservas" con código de tarea `6` a la planta Funes (`10300`).

Las sub-plantas se determinan por el campo `TO55TAREA` de la tabla `F55TAR12`:
- `3` → Funes 1
- `4` → Funes 2
- `5` → Funes Past.

**Cambio 1 — `lib/utils.ts`** (función `parseJdeDate`):

En el `switch` de `TO55TAREA` dentro del case `'10300'`, añadir:
```ts
case '6':
  subPlantName = 'Funes Conservas';
  break;
```

**Cambio 2 — `app/produccion/page.tsx`** (dropdown de sub-planta):

Buscar el `<select>` de sub-planta (visible cuando `selectedPlant === '10300'`) y añadir:
```tsx
<option value="6">Funes Conservas</option>
```

### Añadir sub-plantas a una planta que no las tenía

Si la nueva planta (ej. Tudela `10400`) necesita sub-plantas:

1. En `lib/utils.ts` → `parseJdeDate`: dentro del `switch` de planta, añadir un case `'10400'` con un `switch` anidado por `TO55TAREA` (siguiendo el patrón de Funes `10300`).
2. En `app/produccion/page.tsx`: añadir lógica condicional para mostrar el dropdown de sub-planta cuando `selectedPlant === '10400'`, siguiendo el patrón existente de `10300`.

### Panel de Pedidos — plantas automáticas

El panel de Pedidos **no necesita cambios** al añadir una nueva planta. Las plantas se cargan dinámicamente desde Oracle (tabla `F0006`, filtro `MCSTYL = 'BP'`). Si se da de alta una nueva Business Unit en JDE con estilo `BP`, aparecerá automáticamente en el dropdown de pedidos.
