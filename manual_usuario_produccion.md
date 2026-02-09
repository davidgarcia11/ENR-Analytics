# Manual de Usuario: Dashboard de Producción v1.3

Este documento explica las nuevas funcionalidades del Panel de Control de Producción, diseñado para facilitar la consulta de órdenes de fabricación y el análisis de datos de planta.

## 1. Acceso a la Plataforma

Para acceder al cuadro de mandos, ahora debe utilizar la siguiente dirección en su navegador:

> **.../produccion**

*(Nota: Si intenta acceder solo a la dirección principal, no verá ningún dato por seguridad).*

---

## 2. Nuevos Filtros Inteligentes

Hemos mejorado la búsqueda para que sea más rápida y precisa según la planta seleccionada.

### Selección de Planta
El comportamiento del filtro se ajusta automáticamente:

*   **Aguilar (10100)**: Al seleccionar esta planta, el sistema busca automáticamente toda la producción de la **Línea 1**.
*   **Corella (10200)**: Al seleccionar esta planta, el sistema busca automáticamente toda la producción de la **Línea 2**.
*   **Funes (10300)**: Al seleccionar Funes, **aparecerá una nueva opción** a la derecha que le permitirá elegir específicamente:
    *   *Todas*: Ver todo Funes.
    *   *Funes 1*.
    *   *Funes 2*.
    *   *Funes Pasteurizado*.

### Búsqueda de Artículos
Para mejorar la seguridad y la precisión, el campo "Artículo" ahora solo acepta el código numérico completo de **10 dígitos**.

---

## 3. Visualización de Datos Mejorada

### Cantidades Totales (Unidades vs Kilos)
Para evitar errores de interpretación, el indicador de "Cantidad Total" ha sido dividido:
*   En la parte superior verá siempre el total de **UN (Unidades)** fabricadas.
*   Si hay producción registrada en kilos, aparecerá una segunda línea indicando el total en **KG**.

Esto evita que se sumen "unidades con kilos" en un mismo total, ofreciendo un dato mucho más real.

### Exportación a Excel
Recuerde que tras aplicar cualquier filtro (fecha, planta, artículo), puede pulsar el botón **Excel** para descargar un informe detallado con exactamente los datos que está viendo en pantalla.

---

**Departamento de IT**
*Febrero 2026*
