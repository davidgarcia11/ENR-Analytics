# Documentación — Panel de Compras (`/compras`)

> Documentación específica del panel de comparativa previsión de ventas vs. venta real.
> Ver [DOCUMENTACION.md](../DOCUMENTACION.md) para la documentación base del proyecto.

---

## 1. Descripción general

Panel pensado para el director de compras: compara, por artículo y por mes (o rango de fechas),
la previsión de ventas presupuestada para el año en curso (JDE) frente a lo realmente vendido, para
anticipar necesidades de compra. La comparación principal es en **Unidades** (previsto vs. real,
a petición del usuario); Kg, Importe y Precio unitario acompañan como pestañas adicionales. Primera
entrega de lo que será un área de análisis de compras más amplia — en el futuro se añadirán más
análisis y probablemente agrupación por familia (el campo `familia` ya viaja en cada fila de la API
para que sea trivial añadirlo).

**Acceso configurable** — público por defecto (`is_public=1`), igual que el resto de paneles. El
administrador puede restringirlo a roles específicos desde `/admin` → pestaña Pantallas.

**Navegación:** dropdown "Paneles ▾" en la barra superior (clave `compras`).

---

## 2. Archivos relevantes

| Archivo | Descripción |
|---|---|
| `app/compras/page.tsx` | Página cliente — filtros, 4 KPI cards con gauge, gráfico de tendencia, Tabs, tabla de detalle |
| `app/api/compras/route.ts` | API Route servidor — consulta F3460/F4105/F4211/F4101/F554101, agregación y cálculo de desviaciones |

---

## 3. Esquema Oracle/JDE

Cuatro tablas sin precedente en el resto del proyecto:

| Tabla | Descripción | Campos usados |
|---|---|---|
| `F3460` | Previsión de ventas (presupuesto) | `MFMCU` (planta, filtro fijo `10999` = planta de presupuestos), `MFLITM` (artículo largo/visible), `MFITM` (artículo corto, solo para F4101/F554101), `MFDRQJ` (fecha JDE, siempre fin de mes = previsión de todo ese mes), `MFFQT` (cantidad, ÷100) |
| `F4105` | Coste de artículo | `COMCU` (almacén, filtro fijo `10999`), `COLEDG` (tipo de coste, ver §3.1), `COLITM` (artículo largo), `COUNCS` (coste unitario, ÷10000) |
| `F4211` | Ventas reales (pedidos de venta, ya usada en `api/orders`) | `SDAITM` (artículo largo/visible), `SDITM` (artículo corto, solo para F4101/F554101), `SDADDJ` (fecha real de envío), `SDDELN` (nº de albarán — filtro), `SDUORG` (cantidad, ÷100), `SDUPRC` (precio unitario, ÷10000) — **sin** filtro `SDNXTR` (ver §3.3) |
| `F554101` | Extensión del maestro de artículos (gramaje) | `AAITM` (artículo corto, = `IMITM`/`MFITM`/`SDITM`), `AAZE03` (gramos por unidad, directo — ver §3.2) |

### 3.1 Artículo "largo" vs. "corto"

**Bug real encontrado al probar contra JDE en producción** (no se habría visto sin datos reales):
`F4101` (descripción/familia del artículo) se indexa por el **artículo corto** (`IMITM`), no por el
largo/visible que usa el resto de filtros de la app. `F3460` y `F4211` tienen ambos códigos en
columnas distintas:

- `F3460`: `MFLITM` (largo, clave de agrupación) / `MFITM` (corto, solo para cruzar F4101)
- `F4211`: `SDAITM` (largo, clave de agrupación) / `SDITM` (corto, solo para cruzar F4101) — mismo
  patrón que `app/api/orders/route.ts` (`LEFT JOIN F4101 E ON E.IMITM = A.SDITM`)
- `F4105`: `COLITM` es el artículo **largo** (mismo espacio que `MFLITM`/`SDAITM`), no requiere
  traducción a corto.

`api/compras/route.ts` mantiene un `shortItemMap` (largo → corto) construido a partir de las propias
filas de F3460/F4211, y lo usa únicamente para la consulta a F4101.

### 3.2 Sin conversión de unidades — Kg por gramaje, no por UM

"Unidades"/"precio unitario" usan las cantidades tal cual vienen de JDE (`MFFQT`/`SDUORG`, solo
÷100), sin ninguna conversión de unidad de medida — no está necesariamente en la misma unidad entre
artículos distintos, es una simplificación deliberada.

Una primera versión de este panel probó a convertir a Kg con `F4101.IMUOM1` + `F41002` (mismo patrón
BFS que `app/api/production/route.ts`), pero se descartó: el enfoque correcto para este panel es el
**gramaje del artículo** (`F554101.AAZE03`), igual que hace `/produccion` para su filtro de gramaje
(ver más abajo cómo se relaciona con el artículo). `AAZE03` es directamente el nº de **gramos por
unidad** (confirmado por el usuario, no requiere parsear la descripción de `prodctl.f0005`), así que:

```
kg = cantidad * (AAZE03 / 1000)
```

Se aplica el mismo gramaje a previsto y a real — es una propiedad del artículo, no de la transacción,
así que a diferencia del antiguo enfoque por `F41002` no hace falta resolverlo línea a línea ni
manejar distintas UOM de origen.

**Relación artículo → gramaje** (la misma que usa `/produccion` para su filtro de gramaje, ver
`docs/produccion.md`): `F554101.AAITM = IMITM` (artículo corto) → `AAZE03` (gramos). En
`api/compras/route.ts` se consulta con los mismos artículos cortos que ya se resuelven para F4101
(`shortItemMap`), sin necesitar un tercer mapa de traducción.

`ponytail:` si en el futuro `AAZE03` resulta no ser fiable como número puro para algún artículo (ver
edge case en §5), el patrón de conversión por `F41002`/BFS sigue disponible en
`app/api/production/route.ts` líneas ~304-378 como alternativa.

### 3.3 Solo ventas con albarán (`SDDELN`), sin filtro `SDNXTR`

A petición del usuario, `F4211` se filtra con `AND SDDELN != 0` — solo cuentan como "venta real" los
pedidos que ya tienen un albarán generado (es decir, mercancía efectivamente enviada), no todo lo
pedido. La fecha de referencia para el rango también cambió de `SDPDDJ` (fecha de pedido) a `SDADDJ`
(fecha real de envío), para que el mes en el que se contabiliza una venta sea el mes en que
efectivamente salió, no el mes en que se pidió.

**Bug real encontrado al comparar contra JDE en vivo**: la primera versión reutilizaba el filtro
`SDNXTR != 999` de `app/api/orders/route.ts` sin validar que encajara aquí. Consultando directamente
F4211 se confirmó que sin ese filtro `SDADDJ` tiene datos repartidos por todo el año (mínimo 2 de
enero, máximo el día de hoy), pero con `SDNXTR != 999` el mínimo saltaba a mediados de julio y el
número de filas caía de ~165.000 a ~3.100 — ese filtro estaba descartando casi todo el histórico.
`SDNXTR` (estado del pedido) tiene sentido para `/preparacion-pedidos` (que quiere pedidos
*pendientes*, excluyendo los ya cerrados/históricos), pero para "venta real ya sucedida" el filtro
correcto es el opuesto: no filtrar por `SDNXTR` en absoluto (confirmado con el usuario). El único
filtro de estado que queda es `SDDELN != 0` (con albarán).

### 3.4 Constante `COLEDG_VIGENTE` (tipo de coste)

`F4105.COLEDG` identifica qué "libro de costes" usar, y **JDE lo cambia cada año** (`P6` = 2026).
No hay un patrón fiable confirmado (ej. no se sabe con certeza si 2027 será `P7`), así que en
`app/api/compras/route.ts` es una constante nombrada:

```ts
const COLEDG_VIGENTE = 'P6';
```

**Hay que actualizarla a mano cada enero.** Marcada con comentario `ponytail:` en el propio código.
Si en el futuro se confirma un patrón año→código, se puede calcular dinámicamente; hasta entonces,
mejor una constante explícita que una fórmula adivinada.

---

## 4. Cálculo de las desviaciones

Se agregan filas de F3460 y F4211 en JS por clave `` `${item}|${yyyy}-${mm}` `` (no `FULL OUTER JOIN`
en Oracle — mismo patrón que `orders/route.ts` y `production/route.ts` con `Map`s en JS). Por cada
artículo+mes:

```
qtyPrevisto        = MFFQT/100                                    // null si no hay fila F3460 ese mes
costeUnitarioPrevisto = hasPrevisto ? COUNCS/10000 : null          // ver nota abajo
importePrevisto    = qtyPrevisto * costeUnitarioPrevisto
kgPrevisto         = qtyPrevisto * (AAZE03/1000)                  // null si no hay gramaje (F554101)

// Real: agregado línea a línea de F4211 (solo líneas con SDDELN != 0)
importeLinea  = (SDUORG/100) * (SDUPRC/10000)
qtyReal            = Σ (SDUORG/100)
importeReal        = Σ importeLinea
precioMedioReal    = importeReal / qtyReal   // media ponderada, no promedio simple de precios de línea
kgReal             = qtyReal * (AAZE03/1000)                      // mismo gramaje que el previsto (propiedad del artículo)

desviacionImporte = importeReal - importePrevisto
desviacionPrecio  = precioMedioReal - costeUnitarioPrevisto
desviacionKg      = kgReal - kgPrevisto
```

Todas las desviaciones (`abs` y `pct`) son `null` (nunca `0`/`Infinity`) cuando falta un lado del
cálculo — distingue "sin dato" de "desviación real de -100%". Cada fila lleva un array `avisos`
explicando qué falta (`"Sin coste F4105"`, `"Sin gramaje (F554101)"`, `"Sin previsión este mes"`,
`"Sin venta este mes"`).

`resumen` en la respuesta de la API agrega **totales** (no promedia los `%` de cada fila), y
`resumen.porMes` reagrupa los mismos totales solo por mes (ignorando artículo) para alimentar el
gráfico de tendencia.

### 4.1 Nota de UX: color de las desviaciones

Si un valor real mayor que el previsto es "bueno" o "malo" no es simétrico entre pestañas — en
Importe, vender de más suele ser positivo, pero en Precio no está claro (¿vender más caro que el
coste presupuestado es bueno o simplemente distinto?). Para no asumir un juicio de negocio no
confirmado con el director de compras, la UI muestra las desviaciones en **color neutro**, solo con
flecha ↑/↓ y el signo del número — sin verde/rojo de "bien/mal".

---

## 5. Edge cases

- **Sin coste F4105** para un artículo → `importePrevisto` y desviación de precio quedan `null`.
- **Venta real sin previsión ese mes, o previsión sin venta real** → el lado que falta queda `null`,
  nunca `0` (evita un `-100%`/`Infinity` engañoso). El coste (`F4105`) es una foto por artículo sin
  mes propio — si el mes no tiene fila en F3460, **tampoco** se muestra `precioUnitario` previsto,
  aunque el artículo sí tenga coste, para no contradecir el aviso "Sin previsión este mes" (bug real
  visto en pantalla: salía el € /ud pero con el aviso de "sin previsión").
- **F4105 con más de una fila** para el mismo `COLITM`+`COLEDG` (no debería pasar) → se toma la
  primera y se emite `console.warn`.
- **Sin gramaje en F554101, o `AAZE03` no numérico/0** para un artículo → `kgPrevisto`/`kgReal`
  quedan `null` (parseado con `Number()`; si sale `NaN` o ≤0 se descarta), aviso `"Sin gramaje
  (F554101)"`. El resto de métricas (Unidades/Importe/Precio) no se ven afectadas.
- **Cambio de año** → ver §3.4, la constante `COLEDG_VIGENTE` es el único mecanismo de aviso, no hay
  validación automática.

---

## 6. UI — patrones visuales

Inspirado en un dashboard SaaS de analítica compartido por el usuario (tema oscuro en el original,
adaptado a los tokens en claro del proyecto — el dark mode global queda como iniciativa aparte, ver
`DECISIONS.md`):

- **KPI en gráfico de arco** (`RadialBarChart` de `recharts`, ya dependencia del proyecto): cada una
  de las 4 `DesviacionCard` (Unidades/Kg/Importe/Precio) muestra un gauge de "% cumplimiento"
  (`real/previsto`, capado visualmente a 0-150%), junto a un icono en círculo y dos `Badge` con los
  valores previsto/real. Unidades va primero — es la comparación principal que pidió el usuario.
- **Gráfico de tendencia mensual** (`LineChart` de recharts): dos líneas (previsto/real) de la
  métrica de la pestaña activa, mismos colores que `app/admin/logs/page.tsx`
  (`#D30B15` real, `#6b7280` previsto).
- **Tabla de detalle** restilizada con icono + artículo a la izquierda, previsto/real/desviación
  alineados a la derecha (patrón tipo "Sources"/"Browsers" del dashboard de inspiración).
- **Selector de periodo compartido** (`PeriodPresetSelect`, local a la página): un mismo estado
  global (`periodPreset`) se renderiza en la cabecera de cada card — no son rangos independientes
  por card, cambiar cualquiera actualiza el mismo `startDate`/`endDate` de toda la página, para no
  fragmentar la comparativa entre pestañas.

No se creó ningún componente nuevo en `components/ui/` para esto — todo vive local en
`app/compras/page.tsx` (`DesviacionCard`, `PeriodPresetSelect`), reutilizando `Card`/`CardHeader`/
`CardTitle`/`CardContent`/`Badge` ya existentes.

### 6.1 Presets — fechas opcionales

`<PresetPanel>` se usa con `dateFields={['startDate', 'endDate']}` (ver `docs/design-system.md` §5):
al guardar un preset aparece el checkbox "Incluir fechas" (desmarcado por defecto, igual que en
producción); si no se marca, el preset guarda solo los artículos seleccionados, sin fechas. Al cargar
un preset sin fechas, `applyPresetFilters` mantiene el rango de fechas ya puesto en pantalla en vez
de vaciarlo.

---

## 7. API — `GET /api/compras`

| Parámetro | Tipo | Notas |
|---|---|---|
| `startDate` | string `YYYY-MM-DD`, opcional | Default: día 1 del mes en curso (ver §11, no el año — rendimiento) |
| `endDate` | string `YYYY-MM-DD`, opcional | Default: último día del mes en curso |
| `item` | string, repetible, opcional | Filtro por uno o varios artículos (código largo/visible) |

Respuesta (resumida, ver también `app/api/compras/route.ts`):

```json
{
  "filters": { "startDate": "2026-01-01", "endDate": "2026-12-31", "items": [] },
  "rows": [
    {
      "item": "12345", "descripcion": "...", "familia": "COCIDOS",
      "anio": 2026, "mes": 7, "mesLabel": "2026-07",
      "gramaje": 500,
      "previsto": { "cantidad": 5000, "precioUnitario": 3.42, "importe": 17100, "kg": 2500 },
      "real": { "cantidad": 4820, "precioUnitario": 3.55, "importe": 17111, "kg": 2410 },
      "desviacion": {
        "cantidad": { "abs": -180, "pct": -3.6 },
        "kg": { "abs": -90, "pct": -3.6 },
        "importe": { "abs": 11, "pct": 0.06 },
        "precio": { "abs": 0.13, "pct": 3.8 }
      },
      "avisos": []
    }
  ],
  "resumen": {
    "totalCantidadPrevisto": 320000, "totalCantidadReal": 305500, "desviacionCantidadPct": -4.53,
    "totalKgPrevisto": 160000, "totalKgReal": 152750, "desviacionKgPct": -4.53,
    "totalImportePrevisto": 1250000, "totalImporteReal": 1198000, "desviacionImportePct": -4.16,
    "precioMedioPrevisto": 3.90, "precioMedioReal": 3.92, "desviacionPrecioPct": 0.51,
    "porMes": [
      { "mesLabel": "2026-01", "importePrevisto": 98000, "importeReal": 91000, "cantidadPrevisto": 25000, "cantidadReal": 23400, "kgPrevisto": 12500, "kgReal": 11700, "precioPrevisto": 3.92, "precioReal": 3.89 }
    ],
    "articulosSinGramaje": ["1210100014", "1210100059"]
  }
}
```

`gramaje` (en cada fila) y `resumen.articulosSinGramaje` alimentan el popover de la tarjeta KPI de
Kg descrito en §13.1 — `gramaje` es `null` cuando el artículo no tiene fila en `F554101` o `AAZE03`
no es un número válido (`> 0`).

---

## 8. Logging de consultas

Cada consulta inserta un registro en `query_logs` (SQLite) con `source = 'compras'` y
`filters: { startDate, endDate, items }`. El logging nunca bloquea la respuesta (try/catch
independiente), igual que en el resto de paneles.

---

## 9. Registro del panel

- `lib/panels.ts` → entrada `compras` en `PANELS` (icono `ShoppingCart`) — fuente única que alimenta Navbar, portada, login y permisos de admin (ver `docs/design-system.md` §5.1).
- `lib/sqlite.ts` → seed en la tabla `screens` (`is_public=1` por defecto).

---

## 10. Historial de bugs reales encontrados probando contra JDE

Ninguno de estos se habría detectado sin probar el panel contra la base de datos real:

1. Columna de fecha de F3460 mal escrita (`MQDRQJ` → `MFDRQJ`).
2. F4101 se indexa por el artículo corto (`MFITM`/`SDITM`), no por el largo (`MFLITM`/`SDAITM`) —
   la descripción/familia salían vacías en silencio.
3. Los presets de periodo (`Mes anterior`, etc.) calculaban la fecha con `toISOString()`, que la
   desplaza un día hacia atrás en husos horarios con offset positivo (ej. Europe/Madrid).
4. (Ver §3.2/§3.3) Se quitó la conversión a Kg y se cambió el filtro de venta real a solo pedidos
   con albarán (`SDDELN`) y fecha de envío real (`SDADDJ`), a petición del usuario, mientras se
   revisan cifras que seguían pareciendo raras incluso tras corregir 1-2.
5. El filtro `SDNXTR != 999` (heredado de `api/orders/route.ts`, pensado para "pedidos pendientes")
   descartaba casi todo el histórico real de F4211 (de ~165.000 filas a ~3.100 en 2026) porque aquí
   el sentido es el contrario: se quiere venta ya sucedida, no pedidos abiertos. Se quitó ese filtro
   por completo (ver §3.3).

---

## 11. Rendimiento — por qué el rango por defecto es "este mes" y no "el año"

Al quitar el filtro `SDNXTR` (punto 5 arriba), la consulta a F4211 pasó de ~3.100 a ~165.000 filas
para el año completo. Medido directamente contra JDE: la query de F4211 sola tarda **~150 segundos**
para un año completo (la consulta posterior a F4101, con ~166 artículos distintos, tarda 337ms — no
es el cuello de botella). Muy probablemente falta un índice adecuado para `SDDELN != 0 AND SDADDJ
BETWEEN ...` y Oracle hace un escaneo completo de tabla.

Decisión (con el usuario): en vez de tocar índices de Oracle (fuera de alcance de este panel, lo
gestionaría el DBA/administrador JDE), el rango por defecto de `app/compras/page.tsx` y de
`app/api/compras/route.ts` (cuando se llama sin `startDate`/`endDate`) es **el mes en curso**, no el
año — rápido (unos miles de filas). El usuario puede ampliar el rango manualmente sabiendo que un
año completo puede tardar minutos.

`ponytail:` si el año completo se vuelve un caso de uso habitual (no solo puntual), la solución de
fondo es un índice en Oracle sobre `F4211(SDADDJ, SDDELN)` o similar — pedirlo al equipo de JDE/DBA,
no intentar compensarlo con más código aquí.

---

## 12. Bug: precio previsto visible junto con aviso "Sin previsión este mes"

`F4105` (coste) es una foto por artículo sin mes propio — no depende de si ese mes tiene fila en
F3460. La primera versión buscaba el coste sin comprobar `hasPrevisto`, así que un mes sin previsión
de cantidad igualmente mostraba un `precioUnitario` previsto (el coste "de fondo" del artículo),
contradiciendo el aviso "Sin previsión este mes". Corregido: si no hay previsión de cantidad ese mes,
tampoco se muestra precio previsto, aunque el artículo tenga coste en F4105.

---

## 13. Kg por gramaje (F554101), no por conversión de UM

A petición del usuario, se reintroduce la comparación en Kg — pero con un enfoque distinto al de la
primera versión (§3.2): en vez de convertir unidades de medida vía `F4101.IMUOM1` + `F41002`, se usa
el **gramaje del artículo** (`F554101.AAZE03`, gramos por unidad, directo), el mismo campo que usa
`/produccion` para su filtro de gramaje (`AAITM = IMITM`, cruzado con `prodctl.f0005` DRSY='17'/
DRRT='B3' solo para la etiqueta legible — aquí no hace falta la etiqueta, solo el número).

Ventaja sobre el enfoque anterior: el gramaje es una propiedad fija del artículo (no depende de la
unidad de la transacción), así que no hace falta resolver conversión línea a línea ni manejar
distintas `SDUOM` de origen — simplemente `kg = cantidad * (AAZE03/1000)`, igual para previsto y
real. Ver fórmulas completas en §4 y esquema en §3.2.

Unidades sigue siendo la pestaña principal (primera); Kg se añadió como segunda pestaña/KPI.

### 13.1 Visibilidad de artículos sin gramaje

Cada fila lleva el gramaje crudo (`gramaje: number | null`) y el aviso `"Sin gramaje (F554101)"`
cuando falta — pero depender solo del icono de aviso fila a fila no es cómodo para detectarlo de un
vistazo. `resumen.articulosSinGramaje` (array de códigos de artículo largo, sin duplicados) se
calcula en el servidor recorriendo `rows` una vez construidas.

La tarjeta KPI de **Kg** muestra un aviso compacto ("N sin gramaje") cuando la lista no está vacía;
al **pulsarlo** (no solo al pasar el ratón) se abre un `Popover` (`components/ui/popover.tsx`, mismo
componente que `MermaCellPopover.tsx`) con la lista completa de artículos — código + descripción,
esta última cruzada en cliente contra `rows` (no requiere otra llamada a la API, la descripción ya
viaja en cada fila).
