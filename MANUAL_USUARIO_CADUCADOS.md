# Manual de Usuario — Panel de Palets Caducados y Obsoletos

> Ver también: [MANUAL_USUARIO_PRODUCCION.md](MANUAL_USUARIO_PRODUCCION.md) — Manual del Dashboard de Producción.

## 1. Acceso al Panel

Desde el **Dashboard de Producción**: pulsa el botón **"Caducados"** en la barra superior derecha.

Al entrar verás el panel de filtros, las tarjetas de resumen y la tabla de palets.

> Al abrir el panel, se carga automáticamente la consulta completa (tipo **Todos**) sin necesidad de pulsar "Filtrar".

---

## 2. ¿Qué muestra este panel?

Este panel muestra todos los palets en almacén que tienen **algún problema** que impide su uso o comercialización:

| Tipo | Descripción |
|------|-------------|
| **Caducado** | El palet tiene una fecha de caducidad que ya ha pasado |
| **Obsoleto** | El artículo ha sido dado de baja o discontinuado en el sistema |
| **Bloqueado** | El lote está bloqueado manualmente en JDE |

Un mismo palet puede tener más de un problema a la vez (ej: "Caducado + Obsoleto").

---

## 3. Filtros

### 3.1 Tipo

Botones segmentados en la parte superior del panel:

- **Todos** — Muestra caducados, obsoletos y bloqueados a la vez *(por defecto)*
- **Caducados** — Solo palets con fecha de caducidad vencida
- **Obsoletos** — Solo palets cuyo artículo está marcado como obsoleto
- **Bloqueados** — Solo palets con el lote bloqueado

Haz clic en el botón del tipo que quieras ver. El botón activo se pone en rojo.

### 3.2 Planta

Dropdown para filtrar por planta de almacenaje:

- **Todas** — Muestra todas las plantas *(por defecto)*
- Las plantas disponibles aparecen en la lista según los datos encontrados

> El dropdown de plantas se rellena automáticamente con las plantas que aparecen en los resultados. Si no hay datos todavía, puede estar vacío.

### 3.3 Ubicación

Dropdown para filtrar por ubicación física dentro del almacén:

- **Todas** — Muestra todas las ubicaciones
- **GENERICA** — Palets sin ubicación asignada en JDE
- El resto de valores son códigos de ubicación reales del almacén

---

## 4. Ejecutar la Consulta

Pulsa el botón **"Filtrar"** (rojo, con icono de lupa) para buscar con los filtros seleccionados.

> La primera carga al abrir el panel es automática. Solo necesitas pulsar "Filtrar" cuando cambies algún filtro.

---

## 5. Interpretar los Resultados

### 5.1 Tarjetas de Resumen

Encima de la tabla aparecen 4 tarjetas con el recuento por tipo:

| Tarjeta | Qué muestra |
|---------|-------------|
| **Total Palets** | Número total de registros encontrados |
| **Caducados** | Palets con fecha de caducidad vencida *(en rojo)* |
| **Obsoletos** | Palets con artículo obsoleto *(en ámbar)* |
| **Bloqueados** | Palets con lote bloqueado *(en azul)* |

> Si un palet tiene varios problemas (ej: caducado Y bloqueado), cuenta en **cada** tarjeta correspondiente. Por eso la suma de las tres tarjetas puede ser mayor que el Total Palets.

### 5.2 Tabla de Detalle

Cada fila representa un palet o lote con algún problema:

| Columna | Descripción |
|---------|-------------|
| **Artículo** | Código del artículo (formato largo) |
| **Descripción** | Nombre del artículo |
| **Planta** | Planta donde está almacenado |
| **Ubicación** | Ubicación dentro del almacén. Si aparece *GENERICA*, el palet no tiene ubicación asignada |
| **Palet** | Número de palet |
| **Lote** | Número de lote |
| **Cantidad** | Cantidad en almacén |
| **Fecha Cad.** | Fecha de caducidad del lote. Aparece `-` si no tiene fecha de caducidad |
| **Motivo** | Por qué aparece en esta lista (ver colores abajo) |

### 5.3 Colores del Motivo

El motivo de cada palet se muestra como una etiqueta de color:

| Color | Motivo |
|-------|--------|
| 🔴 Rojo | Caducado |
| 🟡 Ámbar | Obsoleto |
| 🔵 Azul | Bloqueado |
| Rojo intenso / Morado | Combinación de varios motivos (ej: "Caducado + Bloqueado") |

---

## 6. Exportar a Excel

1. Realiza una consulta con los filtros deseados.
2. Pulsa el botón **"Excel"** (verde, con icono de descarga).
3. Se descargará un archivo `.xlsx` con todos los palets visibles.

> El botón Excel está desactivado si no hay datos cargados.

El archivo incluye las columnas: Artículo, Descripción, Planta, Ubicación, Palet_Lote, Palet, Lote, Cantidad, Fecha Caducidad y Motivo.

El nombre del archivo tiene la fecha del día: `Caducados_Obsoletos_2026-03-31.xlsx`

---

## 7. Limpiar Filtros

Pulsa el botón **"Limpiar"** (gris, con icono de X) para restablecer todos los filtros y vaciar la tabla:

- Tipo: **Todos**
- Planta: **Todas**
- Ubicación: **Todas**
- Tabla: vacía (necesitarás pulsar "Filtrar" de nuevo para cargar datos)

---

## 8. Navegación

Desde la barra superior puedes acceder a otros paneles:

- **Produccion** — Vuelve al Dashboard de Producción
- **Admin** *(solo administradores)* — Panel de gestión de usuarios
- **Logs** *(solo administradores)* — Registro de consultas

---

## 9. Resumen Rápido

| Acción | Cómo hacerlo |
|--------|--------------|
| Ver todos los palets problemáticos | Entrar al panel (carga automáticamente con tipo Todos) |
| Filtrar solo caducados | Pulsar botón **"Caducados"** → **"Filtrar"** |
| Filtrar por planta | Seleccionar planta en el dropdown → **"Filtrar"** |
| Ver palets sin ubicación | Seleccionar **"GENERICA"** en Ubicación → **"Filtrar"** |
| Exportar a Excel | Pulsar **"Excel"** (debe haber datos cargados) |
| Limpiar y empezar de nuevo | Pulsar **"Limpiar"** |
| Volver a Producción | Pulsar **"Produccion"** en la barra superior |
