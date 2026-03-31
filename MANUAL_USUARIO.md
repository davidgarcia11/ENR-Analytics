# Manual de Usuario — Dashboard de Producción

## 1. Acceso al Dashboard

Desde JDE: pestaña **"Planta"** → **"Prod_Diaria_Agrupada"**.

Al entrar verás la pantalla principal con el panel de filtros, las tarjetas de métricas y la tabla de datos.

---

## 2. Iniciar Sesión

En la esquina superior derecha verás un enlace **"Iniciar sesión"**. Haz clic para ir a la página de login.

1. Introduce tu **Usuario** y **Contraseña**.
2. Pulsa **"Entrar"**.
3. Si es tu primer acceso, se te pedirá cambiar la contraseña antes de continuar.

> **Nota:** Puedes consultar datos sin iniciar sesión, pero **necesitas tener sesión iniciada para guardar y cargar filtros (presets)**.

---

## 3. Consultar Datos de Producción

### 3.1 Filtros de Categoría

En la primera sección del panel de filtros encontrarás desplegables para filtrar por:

- **Artículo** — Código y descripción del producto
- **Tipo Proceso OF** — Tipo de proceso de fabricación
- **Formato** — Formato del producto (bolsa, brik, etc.)
- **Sabor** — Sabor del producto
- **Familia** — Familia de producto
- **Categoría** — Categoría general
- **Marca** — Marca comercial
- **Gramaje** — Peso/gramaje del envase
- **Línea Producción** — Línea de producción

Cada desplegable permite **selección múltiple**:
- Haz clic en el desplegable para abrirlo.
- Usa la **caja de búsqueda** para encontrar valores rápidamente.
- Marca las casillas de los valores que quieras filtrar.
- Usa **"Sel. todos"** para seleccionar todos los resultados visibles.
- Usa **"Ninguno"** para quitar toda la selección.
- Haz clic fuera del desplegable para cerrarlo.

Cuando hay valores seleccionados, verás un indicador con el número de elementos elegidos.

### 3.2 Fechas, Horas y Planta

En la segunda sección puedes filtrar por:

- **Fecha Inicio** y **Fecha Fin** — Rango de fechas a consultar (por defecto, la fecha de hoy).
- **Hora Inicio** y **Hora Fin** — Rango horario opcional, con precisión de segundos (HH:MM:SS). Si se dejan vacíos, a `00:00` o a `00:00:00`, no se aplica filtro de horas y se consultan todos los movimientos del día independientemente de la hora.
- **Planta** — Selecciona una planta:
  - *Todas* — Todas las plantas
  - *Aguilar*
  - *Corella*
  - *Funes*
- **Sub-planta / Línea** — Solo aparece si seleccionas *Funes* o *Todas*. Permite elegir entre Funes 1, Funes 2 o Funes Past.

### 3.3 Ejecutar la consulta

Pulsa el botón **"Filtrar"** (rojo, con icono de lupa) para cargar los datos con los filtros seleccionados.

Los resultados aparecerán en la tabla inferior y las tarjetas de métricas se actualizarán.

---

## 4. Interpretar los Resultados

### 4.1 Tarjetas de Métricas

En la parte superior de los resultados verás 4 tarjetas resumen:

| Tarjeta | Qué muestra |
|---------|-------------|
| **Cantidad Total** | Unidades fabricadas (UN) y kilogramos (KG) |
| **Órdenes** | Número total de órdenes de fabricación |
| **Merma** | Porcentaje de merma global (verde < 2%, amarillo 2-5%, rojo > 5%) |
| **Top Planta** | Planta con mayor volumen de producción |

### 4.2 Tabla de Detalle

La tabla muestra cada registro agrupado por artículo, fecha, línea y unidad de medida:

| Columna | Descripción |
|---------|-------------|
| Fecha | Fecha de la orden |
| Artículo | Código del producto |
| Descripción | Nombre del producto |
| Fabricado | Unidades o kilos fabricados |
| Merma | Cantidad de merma |
| Fabricado + Merma | Total bruto (fabricado más merma) |
| % Merma | Porcentaje de merma (con colores: verde, amarillo o rojo) |
| UM | Unidad de medida (UN, KG...) |
| Planta / Línea | Planta y línea de producción |

Los registros con mayor porcentaje de merma aparecen primero y se resaltan en rojo.

### 4.3 Agrupar por artículo

El botón **"Agrupar por artículo"** (junto al botón Filtrar) permite colapsar los resultados eliminando la columna de fecha y sumando todas las cantidades y mermas de un mismo artículo en una sola fila. Es útil para ver el total acumulado por producto en un rango de fechas.

- Pulsa el botón para activarlo (se pondrá oscuro).
- Pulsa de nuevo para desactivarlo y volver a la vista por fecha.
- No requiere volver a filtrar: el cambio es inmediato sobre los datos ya cargados.

### 4.4 Cargar más datos

Si hay más registros disponibles, aparecerán dos botones debajo de la tabla:
- **"Cargar más (150)"** — Carga los siguientes 150 registros.
- **"Cargar todos"** — Carga todos los registros restantes de una vez.

---

## 5. Exportar a Excel

1. Realiza una consulta con los filtros deseados.
2. Pulsa el botón **"Excel"** (verde, con icono de descarga).
3. Se descargará un archivo `.xlsx` con los datos visibles en la tabla.

El archivo incluye formato: los porcentajes de merma más altos aparecen resaltados en rojo.

---

## 6. Limpiar Filtros

Pulsa el botón **"Limpiar"** (gris, con icono de X) para restablecer todos los filtros a su valor por defecto:
- Planta: Todas
- Fechas: Fecha de hoy
- Horas: vacías / `00:00:00` (sin filtro horario)
- Todas las categorías: Sin selección

---

## 7. Guardar Filtros (Presets)

> **Requisito:** Debes tener sesión iniciada para usar presets.

Los presets permiten guardar una combinación de filtros para reutilizarla en el futuro. Se guardan siempre los filtros de categoría, planta y sub-planta. Las fechas y las horas son **opcionales**: solo se incluyen si marcas los checkboxes correspondientes al guardar.

### 7.1 Abrir el panel de Presets

Tienes dos formas de abrirlo:
- Pulsa el botón **"Guardar"** (azul) en la sección de acciones del panel de filtros.
- Pulsa el botón **"Presets"** en la barra superior derecha.

Se desplegará el panel **"Mis Presets de Filtros"** encima de los filtros.

### 7.2 Guardar un preset

1. Configura los filtros que quieras guardar.
2. Abre el panel de Presets.
3. Escribe un nombre descriptivo en el campo de texto (ej: *"Bolsas Aguilar"*).
4. Marca los checkboxes según lo que quieras incluir en el preset:
   - **Incluir fechas** — guarda el rango de fechas actual. Si no lo marcas, al cargar el preset se mantendrán las fechas que tengas en ese momento.
   - **Incluir horas** — guarda el rango horario actual. Si no lo marcas, al cargar el preset las horas quedarán vacías.
5. Pulsa **"Guardar"** o la tecla Enter.

Los presets que tienen fechas guardadas muestran un icono de calendario junto a su nombre.

### 7.3 Cargar un preset guardado

**Opción A — Desde el panel de filtros (desplegable rápido):**
1. Si tienes presets guardados, aparecerá un desplegable **"Cargar preset"** en la sección de acciones.
2. Selecciona el preset deseado.
3. Los filtros se aplicarán automáticamente.

**Opción B — Desde el panel de Presets:**
1. Abre el panel de Presets.
2. Haz clic en el nombre del preset que quieras cargar.
3. Los filtros se aplicarán y el panel se cerrará.

> Después de cargar un preset, pulsa **"Filtrar"** para ejecutar la consulta con esos filtros.

### 7.4 Editar un preset

1. Abre el panel de Presets.
2. Haz clic en el icono de **lápiz** junto al preset que quieras modificar.
3. El panel cambiará a modo edición (el preset se resaltará en azul).
4. Modifica el nombre o los checkboxes de fechas/horas según necesites.
5. Pulsa **"Actualizar"** para guardar los cambios, o **"Cancelar"** para descartarlos.

### 7.5 Eliminar un preset

1. Abre el panel de Presets.
2. Junto a cada preset aparece un icono de papelera.
3. Haz clic en la papelera para eliminar el preset.

---

## 8. Cerrar Sesión

Pulsa el botón **"Salir"** en la esquina superior derecha para cerrar tu sesión.

---

## 9. Resumen Rápido

| Acción | Cómo hacerlo |
|--------|-------------|
| Consultar datos | Ajusta filtros y pulsa **"Filtrar"** |
| Filtrar por horas | Rellena Hora Inicio y/o Hora Fin → pulsa **"Filtrar"** |
| Agrupar por artículo | Pulsa **"Agrupar por artículo"** (activo = oscuro) |
| Exportar a Excel | Pulsa **"Excel"** tras una consulta |
| Limpiar filtros | Pulsa **"Limpiar"** |
| Guardar filtros | Inicia sesión → Pulsa **"Guardar"** → Escribe un nombre → Elige si incluir fechas/horas |
| Cargar filtros guardados | Selecciona en **"Cargar preset"** o abre **"Presets"** y haz clic en el nombre |
| Editar un preset | Abre **"Presets"** → Icono de lápiz → Modifica → **"Actualizar"** |
| Eliminar filtros guardados | Abre **"Presets"** → Icono de papelera |
| Sin sesión | Puedes consultar y exportar, pero **no guardar filtros** |
