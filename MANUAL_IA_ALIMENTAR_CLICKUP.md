# Manual: cómo la IA debe alimentar ClickUp — Elaborados Naturales

> Complementa a `GUIA_GESTION_CLICKUP_ENR.md`. Ese documento define la estructura y las convenciones; este documento define **cuándo y cómo actuar automáticamente** sobre ClickUp desde distintos contextos: Claude Code (repositorio de ENR Analytics), reuniones, correo, e ideas sueltas de David.

---

## 0. Estructura de referencia (resumen)

```text
Espacio: Elaborados Naturales
├── Carpeta: ENR Analytics                    (SOLO la app/dashboard — código en este repo)
│   ├── Producción, Pedidos, Caducados, Stock PDA,
│   │   Comparativa SERES, Loteadora, Plataforma y administración, Compras
│   └── Releases
├── Carpeta: Operativa diaria
│   ├── Tareas e incidencias
│   └── Tareas recurrentes
├── Carpeta: JDE - Evolutivos e Instalaciones
│   ├── Evolutivos        (desarrollos GoLive: presupuesto → aprobación → desarrollo)
│   └── Instalaciones     (puesta en marcha en planta de un evolutivo)
└── Carpeta: Documentación
    ├── Documentación JDE
    ├── Documentación ENR Analytics
    ├── Documentación Reflex
    └── Documentación General
```

**Regla de oro de ubicación:** ENR Analytics = solo lo que es código de este dashboard. Todo lo que sea JDE/GoLive (evolutivos, presupuestos, instalaciones) va a su propia carpeta, nunca a ENR Analytics. Todo lo que sea "guardar un documento para consultarlo después" va a Documentación, nunca mezclado con tareas de trabajo.

**Fuente de verdad:** Notion queda descontinuado como sistema de gestión de proyectos. **ClickUp es la única fuente de verdad** desde la migración (agosto 2026). Notion puede consultarse como archivo histórico si hace falta recuperar contexto antiguo, pero nunca se crea ni actualiza nada ahí.

---

## 1. Claude Code trabajando en el repositorio de ENR Analytics

Este es el contexto donde Claude Code tiene el código delante y hace commits/ramas/PRs. Regla base: **cada acción de Git relevante debe reflejarse en la tarea de ClickUp correspondiente, en el momento en que ocurre**, no al final del día ni por lotes.

### 1.1 Antes de escribir código

1. Buscar en ClickUp (Producción / Pedidos / Caducados / Stock PDA / Comparativa SERES / Loteadora / Plataforma y administración / Compras) si ya existe una tarea para lo que se va a hacer.
2. Si existe: usar esa tarea, no crear otra.
3. Si no existe: crearla primero, **antes** de tocar código, con el formato `[Panel] Verbo + resultado funcional` (sección 4.3 de la guía madre), estado `pending`.
4. **Asignar siempre una prioridad** (Urgente/Alta/Normal/Baja, sección 7 de la guía madre) al crear la tarea, según impacto real — nunca dejarla sin prioridad por defecto.
5. Solo entonces pasar a estado `in progress` y empezar a trabajar.

### 1.2 Al crear una rama

- Nombrar la rama según convención de la guía madre: `feature/panel-descripcion-corta`, `fix/panel-descripcion-error`, `chore/descripcion-mantenimiento`.
- En la tarea de ClickUp: pasar a `in progress`, fijar fecha de inicio real (la del primer commit, no antes), y añadir un comentario breve:

```markdown
**Rama creada — DD/MM/AAAA**
Rama: feature/produccion-filtro-turno
```

### 1.3 Durante el desarrollo (commits)

- **No comentar cada commit individual.** Solo comentar si un commit representa una decisión relevante, un cambio de alcance, o resuelve un bloqueo (sección 10 de la guía madre).
- Si el trabajo se alarga varios días, un comentario de progreso al final de cada sesión relevante:

```markdown
**Progreso — DD/MM/AAAA**
- Realizado: ...
- Pendiente: ...
- Próximo paso: ...
```

### 1.4 Al abrir un PR (a `develop`)

1. Añadir el enlace del PR a la tarea (campo o comentario).
2. Comentario de PR:

```markdown
**PR abierto**
Enlace: <url>
Rama: feature/...
Cambios principales: ...
Pruebas realizadas: ...
Pendiente antes del merge: ...
```

3. Si el PR se fusiona solo en `develop` (no en `main`): estado → `in review`. **Nunca** `completed` en este punto.

### 1.4bis Hotfix directo a `main` (sin pasar por `develop`)

Para correcciones urgentes que saltan directamente a producción:

1. Igualmente enlazar el PR y comentar como en 1.4.
2. Marcar la tarea con prioridad `Urgente` o `Alta` si no la tenía ya.
3. Al fusionar: tratar como el punto 1.5 (release/registro) pero indicando explícitamente en la descripción de la release que fue un hotfix fuera del flujo normal, y por qué.
4. Validar en producción con el mismo rigor que un release normal (1.6) — un hotfix urgente no exime de comprobar que funciona.

### 1.5 Al fusionar a `main` / generar release

1. Comprobar si ya existe una tarea `[RELEASE] vX.Y.Z` en la lista **Releases** de ENR Analytics para esa versión. Si no existe, crearla con el formato de la sección 9.6 de la guía madre (Contenido / Git / Instalación / Validación posterior).
2. **Enlazar de verdad** (con `clickup_add_task_link` o campo de relación, no solo mencionar en texto) todas las tareas de panel incluidas en esa versión — comparar el rango de commits/PRs fusionados en `main` desde la release anterior contra las tareas `in review` existentes, para no dejar ninguna sin enlazar.
3. **No marcar las tareas de panel como `completed` todavía** — eso solo ocurre tras validar en producción (punto 1.6).
4. Comentario en cada tarea incluida:

```markdown
**Publicado en producción — DD/MM/AAAA**
Release: [RELEASE] vX.Y.Z
Commit o PR: ...
Validación realizada: ...
Resultado: ...
```

### 1.6 Tras validar en producción

1. Marcar la tarea de panel como `completed`.
2. Marcar la release como `completed` solo cuando todas sus tareas lo estén y la validación posterior (checklist de la release) esté hecha.

### 1.7 Ideas futuras que surgen mientras se trabaja (para estudiar/implementar más adelante)

Si David menciona una idea futura mientras se está trabajando en otra cosa (p. ej. "esto en el futuro habría que hacerlo también para Compras"):

1. Crear la tarea en el panel correspondiente **inmediatamente**, aunque no se vaya a tocar hoy.
2. Estado `pending`. **Sin fecha de inicio** — nunca inventar una fecha de inicio para trabajo no comenzado (regla explícita de la guía madre, sección 9.1 y checklist final).
3. Descripción mínima autosuficiente: de dónde viene la idea, qué resultado se busca, y cualquier contexto que se pierda si no se apunta ahora.
4. Si la idea no tiene panel claro todavía (afecta a varios, o es ambigua): crearla sin panel asignado en lugar de adivinar, y decirlo explícitamente a David.

### 1.8 PRs pequeños (`fix/`, `chore/`, `refactor/`) sin tarea propia evidente

No todo PR necesita una tarea de ClickUp visible de por sí — pero **todo PR que llega a `main` sí necesita quedar trazado en algún sitio**, para que ninguna release publique cambios sin registro.

- **Si el cambio es observable por el usuario** (corrige un bug visible, cambia comportamiento, afecta a un panel) → tarea propia en la lista del panel, aunque el PR sea de una línea. Ejemplo: `fix/login-paneles-hardcodeados` sí es tarea propia porque el usuario notaba paneles que no aparecían.
- **Si el cambio es interno puro** (refactor sin efecto visible, ajuste de configuración, `chore` de dependencias) → no crear tarea de panel; registrarlo como línea de la sección "Contenido" de la release correspondiente, con el número de PR.
- Ante la duda, crear la tarea — cuesta menos que reconstruirla después.

---

## 2. Reuniones (transcripciones o resúmenes que David envía)

Cuando David pega o adjunta el contenido de una reunión:

1. **Leer completo antes de crear nada.** Identificar todos los compromisos, decisiones y acciones mencionadas, no solo el primer tema.
2. Para cada acción/compromiso identificado:
   - Buscar si ya existe una tarea relacionada (por tema, no solo por texto literal — una reunión puede referirse a una incidencia con otras palabras).
   - Si existe: actualizarla (comentario con lo acordado en la reunión, cambio de estado si aplica).
   - Si no existe: crearla en la ubicación correcta según su naturaleza (panel de ENR Analytics / Operativa diaria / JDE Evolutivos-Instalaciones / Documentación).
3. Si la reunión reflejaba una **decisión** (no solo una acción pendiente) — por ejemplo "se aprueba el presupuesto de multilote, se pausan los otros dos" — reflejarlo como comentario explícito en la tarea correspondiente, con la fecha de la reunión, no la fecha en que se procesa el resumen.
4. Al terminar, dar a David un resumen tipo:

```markdown
De la reunión del DD/MM:
- Creadas: [lista]
- Actualizadas: [lista]
- Decisiones registradas: [lista]
- Sin acción clara / a confirmar: [lista, si aplica]
```

5. Si algo de la reunión es ambiguo (no está claro si es tarea, incidencia o solo información), **no forzar una clasificación** — preguntar a David antes de crear, tal como indica la sección 13 de la guía madre ("solo preguntar cuando la respuesta cambie materialmente la ubicación, prioridad o criterio de finalización").

---

## 3. Correo electrónico (Outlook)

Misma lógica que las reuniones, con matices propios del volumen de correo:

### 3.1 Cuándo activarlo
- **Solo a petición explícita de David** ("revisa el correo de esta semana", "mira si hay algo pendiente"). No se activa de forma continua ni automática por iniciativa propia.
- Esta regla se revisa si David decide fijar una cadencia regular; hasta entonces, sin petición explícita no hay revisión de correo.

### 3.2 Cómo procesar
1. Aplicar los mismos criterios de exclusión ya acordados: ignorar newsletters/formación, notificaciones automáticas (Jira, Teams, Claude/Anthropic), y correos puramente administrativos sin sustancia técnica.
2. Distinguir explícitamente entre:
   - **Incidencias/bugs** → Operativa diaria (o panel si acaban requiriendo código).
   - **Peticiones de desarrollo/funcionalidad nueva** → panel de ENR Analytics (si es del dashboard) o JDE - Evolutivos (si es JDE/GoLive con o sin presupuesto).
   - **Procedimientos documentados en el propio correo** (p. ej. pasos de cierre de mes) → Documentación General o Documentación JDE, según corresponda.
3. Para cada hilo con sustancia, igual que en incidencias/desarrollo ya trabajado antes en esta conversación: asunto exacto, personas implicadas, última actualización, estado (abierto/parcial/resuelto).
4. **Si el volumen es grande** (más de ~30-40 llamadas de búsqueda necesarias): decirlo explícitamente a David y ofrecer la función Research en lugar de agotar el chat en paginación manual — no forzar una lectura exhaustiva silenciosa que degrade la calidad.
5. Cruzar siempre con lo que ya existe en ClickUp antes de proponer creaciones — nunca asumir que algo no está ya registrado sin comprobarlo (`clickup_filter_tasks` o `clickup_search`).

---

## 4. JDE — Evolutivos e Instalaciones

Carpeta dedicada, separada de ENR Analytics. Regla de cuándo usar cada lista:

| Situación | Lista |
|---|---|
| GoLive envía un presupuesto/propuesta para un desarrollo nuevo en JDE | **Evolutivos**, estado `pending` hasta aprobación |
| El evolutivo se aprueba | Mismo registro, estado `in progress` cuando arranque el desarrollo |
| El evolutivo se pone en marcha en una o varias plantas | Nueva tarea en **Instalaciones**, enlazada al evolutivo correspondiente (mención o campo de relación si existe) |
| GoLive instala una solución/producto ya existente (no un desarrollo a medida) — ej. DCA Digital | Nueva tarea directamente en **Instalaciones**, **sin Evolutivo previo**. Dejar el enlace vacío y explicar en la descripción que es un producto ya desarrollado por GoLive, no un evolutivo interno |
| Bug o incidencia sobre JDE que ya funciona | **NO** aquí — va a Operativa diaria |

> No todas las Instalaciones vienen de un Evolutivo. Si no hay presupuesto/propuesta de desarrollo a medida de por medio, es válido crear la Instalación de forma independiente.

### Plantilla mínima para un Evolutivo

```markdown
## Petición
Quién lo pide, a quién, fecha.

## Descripción funcional
Qué cambia, en qué plantas aplica.

## Presupuesto
Importe, desglose si lo hay, documento de propuesta (adjuntar en Documentación JDE y enlazar aquí).

## Estado
pending / aprobado — en pausa / in progress / instalado

## Instalaciones relacionadas
- [enlace a tarea en lista Instalaciones]
```

### Plantilla mínima para una Instalación

```markdown
## Evolutivo relacionado
[enlace]

## Plantas
Corella / Aguilar / Funes 1 / Funes 2 — cuáles aplica

## Fecha de instalación
Real, no planificada, una vez ocurra.

## Validación
- [ ] Funciona en la planta
- [ ] Sin incidencias en los primeros días
```

---

## 5. Documentación (con adjuntos)

Cada una de las 4 listas de la carpeta Documentación funciona igual: **una tarea = un documento**. El archivo (PDF, manual, propuesta) se adjunta directamente en la tarea desde la interfaz de ClickUp — la IA no puede subir archivos por API en esta integración, así que el flujo es:

1. La IA crea la tarea con nombre y descripción del documento.
2. David adjunta el PDF manualmente en esa tarea (arrastrar archivo o botón de adjuntar).
3. La IA nunca debe asumir que un adjunto ya existe — si necesita confirmar que un documento tiene su PDF, debe preguntarlo o comprobar (`clickup_get_attachments` si está disponible) en lugar de darlo por hecho.

### Cuándo crear una entrada de Documentación
- Un presupuesto o propuesta formal de GoLive → **Documentación JDE**.
- Un manual de usuario de un panel, o documentación técnica del propio dashboard → **Documentación ENR Analytics**.
- Manuales o configuraciones de Reflex → **Documentación Reflex**.
- Procedimientos internos que no son específicos de un sistema (cierre de mes, calidad, autocontroles) → **Documentación General**.

### Nomenclatura sugerida
```text
[Tipo] Nombre del documento — AAAA-MM-DD
```
Ejemplo: `[Presupuesto] Multilote Producción — 2026-07-08`

### Tipos válidos (lista cerrada — no usar otros)

| Tipo | Cuándo usarlo |
|---|---|
| `Manual` | Guía de uso de un sistema/panel para el usuario final |
| `Procedimiento` | Pasos operativos a repetir (ej. cierre de mes) |
| `Presupuesto` | Propuesta económica formal de GoLive u otro proveedor |
| `Referencia` | Documentación técnica de consulta (esquemas, configuraciones, listados de campos) |
| `Solución` | Documento que registra cómo se resolvió algo, para no repetir la investigación |

No inventar tipos nuevos sin que David lo confirme — mantiene la lista consistente con el criterio ya usado en Notion antes de la migración.

---

## 6. Reglas transversales (aplican en todos los contextos anteriores)

1. **Buscar siempre antes de crear.** En cualquier contexto (Git, reunión, correo, idea suelta), comprobar con `clickup_filter_tasks` o `clickup_search` si ya existe algo equivalente.
2. **Nunca inventar fechas de inicio** para trabajo no comenzado.
3. **Nunca marcar `completed`** sin validación real (build + pruebas + producción, según el tipo de tarea — sección 11 de la guía madre).
4. **Un mismo hecho, un solo registro.** Si una incidencia de correo y una mención en reunión hablan de lo mismo, actualizar la misma tarea, no duplicar.
5. **Preguntar solo cuando la ubicación, prioridad o criterio de cierre cambien materialmente.** El resto, inferir razonablemente y decirlo al reportar lo hecho.
6. **Informar siempre qué se hizo:** acción (creada/actualizada/movida), tarea, ubicación, estado, próximos pasos — igual que exige la sección 13 de la guía madre.
7. **GoLive nunca aparece como responsable de tareas de ENR Analytics** (el dashboard lo desarrolla David). GoLive solo aparece en la carpeta JDE - Evolutivos e Instalaciones.
8. **Multipalet y consumos/repartos son dominios distintos** — no vincular incidencias de uno con tareas del otro salvo que David lo confirme explícitamente.
