# Documentación — Explosión de compras / MRP (`/mrp`)

> Panel sobre el sistema **Nova** (ShadcnSpace). Ver
> [`components/nova/README.md`](../components/nova/README.md) para el mecanismo de
> aislamiento del tema y [`docs/compras.md`](compras.md) §6 para los patrones de UI
> compartidos (header, KPIs) — no se repiten aquí. Origen: ClickUp `#869eq7nqd`.

## 1. Descripción general

Responde a "¿cuánto tengo que comprar de cada material, y cuándo?" — a partir de la
previsión de venta (`F3460`, planta `10999`) y la lista de materiales (`F3002`,
planta `10999`), calcula la explosión recursiva de materiales finales (envases,
materia prima) que hacen falta para cubrir esa previsión, mes a mes.

**No es `/costes`** (que también usa `F3002`), ver `docs/costes.md` §1 para la
tabla comparativa completa. Diferencia clave: MRP parte de la previsión de venta y
aplana el resultado (solo el material final comprable, cantidades acumuladas); la
vigencia del BOM se evalúa contra el **mes de cada previsión**, no contra hoy.

**Acceso**: `requireScreenAccess('mrp')`, entrada `mrp` en `lib/panels.ts`.
**Logging**: `query_logs`, `source: 'mrp'`.

## 2. Archivos relevantes

| Archivo | Descripción |
|---|---|
| `app/mrp/page.tsx` | Página cliente — selector de rango de meses, KPIs (`Statistics`), tabla, exportar a Excel (3 hojas: resumen, detalle por artículo, desglose por mes) |
| `app/api/mrp/route.ts` | API Route — explosión recursiva completa (ver §3) |
| `components/nova/mrp-materials-table.tsx` | Tabla jerárquica (TanStack, `subRows`): material → desglose por mes (solo si hay más de un mes en el rango). Búsqueda + orden por cantidad/familia. `agregarPorMes()` (exportada, reutilizada también en el Excel) agrega las contribuciones de todos los artículos padre de un mes |
| `components/nova/month-range-picker.tsx` | Selector de rango de meses, reutilizado tal cual de `/compras` |

## 3. Esquema Oracle/JDE y lógica

| Tabla | Uso |
|---|---|
| `F3460` | Previsión de venta. `MFMCU`=planta, `MFLITM`=artículo largo, `MFITM`=artículo corto, `MFDRQJ`=fecha JDE, `MFFQT`÷100=cantidad |
| `F3002` | Lista de materiales (BOM). `IXCMCU`=planta (`10999`), `IXKITL`=padre, `IXLITM`=componente, `IXQNTY`÷**10000** (no ÷100 como el resto de cantidades JDE) =cantidad, `IXUM`=unidad, `IXEFFF`/`IXEFFT`=vigencia |
| `F4101` | Descripción (`IMDSC1`) y familia (`IMSRP2`), por código corto (`IMITM`) |
| `prodctl.f0005` | Catálogo UDC `41/S2` (familia) — descripción real en vez del código crudo |

**Tipo de artículo = prefijo de 2 dígitos del código largo**: `10`/`11`/`12` son
intermedios (tienen su propia lista de materiales, hay que explotarlos también,
recursivo); cualquier otro prefijo es material final comprable. A diferencia de
`/costes` (que resuelve el tipo real contra `F4101.IMSRP1`, ver `docs/costes.md`
§3.1.1), aquí el prefijo sí es válido porque solo se usa para decidir "¿sigo
explotando o ya es un material final?", no para mostrar una categoría al usuario.

**Explosión en cascada**: `factor = ratio_nivel1 × ratio_nivel2 × ... × ratio_nivelN`,
multiplicado por la previsión mensual del artículo padre inicial (`explode()` en
`api/mrp/route.ts`). Corte de ciclos con un `Set` de visitados por rama (un BOM real
no debería tener ciclos, pero uno colgaría la petición si no se corta — mismo
patrón que `/api/costes`).

**Vigencia del BOM por mes de previsión, no por hoy**: cada bucket
(artículo × mes) usa la última fecha JDE de ese mes como referencia; la consulta a
`F3002` se repite una vez por cada fecha de referencia distinta (normalmente una por
mes de previsión), filtrando `IXEFFF <= fecha AND (IXEFFT >= fecha OR IXEFFT = 0)`.
Si la previsión es de enero, se usa el BOM vigente en enero, aunque hoy ya no lo esté.

**Rango de fechas**: `startDate`/`endDate` ('YYYY-MM-DD'), default mes en curso —
mismo patrón que `/compras`/`/costes`. Filtro opcional `parentArticle` (repetible,
validado con `/^\d{10}$/`) para acotar a unos artículos concretos.

## 4. UI

Layout a una columna (a diferencia de `/costes`, que es a 2 columnas con panel de
desglose): selector de rango + botón Filtrar arriba, KPIs (`Statistics`,
3 columnas: artículos con previsión, materiales a comprar, meses cubiertos), tabla
jerárquica debajo, botón Exportar.

Tabla: cada fila es un material final; al desplegar (solo si el rango cubre más de
un mes) se ve su desglose mes a mes. Búsqueda por descripción/código y orden por
cantidad o familia. Colores de familia: paleta fija por hash del código (`PALETA`
en `mrp-materials-table.tsx`) — la lista de familias no es cerrada, así que no se
puede asignar un color por código a mano.

Excel (`exportToExcel` en `page.tsx`): 3 hojas — "Compra por material" (resumen),
"Detalle por artículo" (cada contribución con su artículo padre y mes) y "Desglose
por mes" (mismo agregado que ver en pantalla, `agregarPorMes()` reutilizada).

## Presets

Botón «Mis filtros» en la barra de filtros (los filtros guardados comunes de Nova, `components/nova/README.md` punto 15).
Como el panel solo filtra por periodo, cada preset guarda un periodo (`screen = 'mrp'`): fijo o
relativo de meses completos (mes en curso, últimos 3/12 meses, año en curso…). El predeterminado
(estrella) se aplica al abrir, antes del primer cálculo, para no calcular la explosión dos veces.
