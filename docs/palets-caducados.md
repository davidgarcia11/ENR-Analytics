# Documentación — Caducados/Obsoletos/Bloqueados (`/caducados`)

> Documentación específica del dashboard de palets caducados, con artículo obsoleto y/o bloqueados.
> Ver [DOCUMENTACION.md](../DOCUMENTACION.md) para la documentación base del proyecto.

---

## Página de Caducados/Obsoletos/Bloqueados — `app/caducados/page.tsx`

Dashboard para visualizar palets problemáticos: caducados, con artículo obsoleto o bloqueados.

### Filtros

- **Tipo:** Botones segmentados (Todos / Caducados / Obsoletos / Bloqueados)
- **Planta:** Dropdown dinámico (extraído de los datos devueltos)
- **Ubicación:** Dropdown con valores de F4100 + opción GENERICA (ubicación en blanco)

Al entrar, carga automáticamente con tipo "Todos" sin filtros.

### Tarjetas métricas (5)

| Tarjeta | Descripción |
|---|---|
| Total Palets | Nº registros encontrados |
| Cantidad Total | Suma de cantidades |
| Caducados | Palets con fecha de caducidad vencida (rojo) |
| Obsoletos | Palets cuyo artículo tiene IMSTKT='O' (ámbar) |
| Bloqueados | Palets con IOLOTS='B' en F4108 (azul) |

### Tabla

Columnas: Artículo, Descripción, Planta, Ubicación, Palet, Lote, Cantidad, Fecha Cad., Motivo.

El motivo se muestra como badge con color según tipo:
- Rojo: Caducado
- Ámbar: Obsoleto
- Azul: Bloqueado
- Morado/Rojo intenso: combinaciones (ej. "Caducado + Obsoleto")

### Exportación Excel

Incluye todos los campos visibles + Palet_Lote (dato adicional no visible en tabla).

---

## Tablas de Oracle JDE — Caducados/Obsoletos/Bloqueados

### Tablas principales

| Tabla | Descripción | Campos clave |
|---|---|---|
| **F41021** | **Stock por ubicación** (Item Location) | `LIITM` (artículo corto), `LIMCU` (planta), `LILOTN` (palet_lote), `LILOCN` (ubicación), `LIPQOH` (cantidad ×100) |
| **F4108** | **Lotes/Palets** (Lot Master) | `IOITM` (artículo corto), `IOMCU` (planta), `IOLOTN` (palet_lote), `IOLOT1` (palet), `IOLOT2` (lote), `IOMMEJ` (fecha caducidad CYYDDD), `IOLOTS` (status lote: `'B'`=bloqueado), `IOLITM` (artículo largo) |
| **F4100** | **Ubicaciones** (Location Master) | `LMLOCN` (código ubicación) — se usa para poblar el dropdown de ubicaciones |

### Relaciones

```
F41021 (stock por ubicación)
    │ LIITM + LILOTN + LIMCU
    ▼
F4108 (lotes/palets) ──► IOMMEJ (caducidad), IOLOTS (bloqueado), IOLOT1/IOLOT2 (palet/lote)
    │ LIITM
    ▼
F4101 (maestro artículos) ──► IMSTKT = 'O' (obsoleto), IMDSC1 (descripción)

F4100 (ubicaciones) ──► LMLOCN (dropdown de ubicaciones)
F0006 (plantas) ──► MCSTYL = 'BP' (dropdown de plantas)
```

---

## Cómo Añadir Plantas y Sub-plantas a Producción

El dashboard de producción tiene las plantas y sub-plantas **hardcodeadas** por diseño, porque la lógica de sub-plantas está ligada al campo `TO55TAREA` de F55TAR12 (primer dígito = subcódigo).

### Añadir una nueva planta (sin sub-plantas)

**Ejemplo:** Nueva planta "Tudela" con código `10400`.

**Paso 1:** `app/produccion/page.tsx` — Añadir `<option>` en el dropdown de planta:
```tsx
<option value="10400">Tudela</option>
```

**Paso 2:** `lib/utils.ts` → función `parseJdeDate` — Añadir case en el switch de planta:
```ts
case '10400': subBlockName = 'Tudela'; break;
```

### Añadir una nueva sub-planta a una planta existente

**Ejemplo:** Nueva sub-planta "Funes 3" con subcódigo `6`.

**Paso 1:** `lib/utils.ts` → función `parseJdeDate` — Añadir case dentro del bloque de planta `10300`:
```ts
case '6': subBlockName = 'Funes 3'; break;
```

**Paso 2:** `app/produccion/page.tsx` — Añadir `<option>` en el dropdown condicional de sub-planta:
```tsx
<option value="6">Funes 3</option>
```

**Paso 3:** `app/api/production/route.ts` — Si la nueva sub-planta reemplaza un subcódigo antiguo, añadir al `oldSubCodeMap`:
```ts
'10300': { 3: 1, 4: 2, 6: X }, // donde X es el subcódigo antiguo que usaba antes
```
Si es completamente nueva (no hay datos históricos), no hace falta tocar el mapa.

### Nota sobre el dashboard de caducados

El dashboard de caducados (`/caducados`) obtiene las plantas dinámicamente desde Oracle (F0006 con `MCSTYL='BP'`), por lo que **no necesita cambios** al añadir nuevas plantas.
