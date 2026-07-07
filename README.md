# Dashboard de Producción — Elaborados Naturales

Panel de control de producción que conecta con Oracle JD Edwards (JDE) y muestra en tiempo real órdenes de fabricación, merma, producción por planta/línea y palets caducados/obsoletos/bloqueados.

## Stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript 5**
- **Oracle JDE** — datos de producción y stock
- **SQLite** (`better-sqlite3`) — usuarios, presets y logs locales
- **Tailwind CSS 4** + **Radix UI** + **Recharts**
- **Bun** — runtime y gestor de paquetes

## Sistema de diseño

Toda la UI comparte una única paleta de tokens (`app/globals.css`, `@theme inline` de Tailwind 4 — sin `tailwind.config.js`) y un catálogo de componentes en `components/ui/` (button, card, input, table, popover, badge, skeleton, spinner, empty-state, dialog/toast, tabs) más componentes de panel en `components/` (`AppShell`, `KpiCard`, `PresetPanel`, `Navbar`).

**Antes de tocar o crear UI de cualquier panel, lee [`docs/design-system.md`](docs/design-system.md).** Documenta la tabla de tokens, la API de cada componente y un checklist paso a paso para montar un panel nuevo — es la referencia que mantiene consistente el diseño a medida que crecen los paneles.

## Comandos

```bash
bun install       # Instalar dependencias
bun dev           # Desarrollo con hot reload → http://localhost:3000/produccion
bun run build     # Compilar para producción
bun start         # Servir build de producción
```

## Primer acceso

1. Ir a `/login` → usuario `admin`, contraseña `admin123`
2. Ir a `/admin` para crear usuarios

## Documentación

Toda la documentación técnica está en [`DOCUMENTACION.md`](DOCUMENTACION.md). Decisiones de arquitectura/diseño relevantes en [`DECISIONS.md`](DECISIONS.md).

Documentación específica por panel en [`docs/`](docs/):
- [`docs/design-system.md`](docs/design-system.md) — Sistema de diseño (tokens, componentes, checklist de panel nuevo)
- [`docs/produccion.md`](docs/produccion.md) — Dashboard de producción
- [`docs/control-pedidos.md`](docs/control-pedidos.md) — Control de pedidos
- [`docs/palets-caducados.md`](docs/palets-caducados.md) — Palets caducados/obsoletos/bloqueados
- [`docs/seres-jde-comparativa.md`](docs/seres-jde-comparativa.md) — Comparativa SERES vs JDE

Manuales de usuario:
- [`MANUAL_USUARIO_PRODUCCION.md`](MANUAL_USUARIO_PRODUCCION.md)
- [`MANUAL_USUARIO_CADUCADOS.md`](MANUAL_USUARIO_CADUCADOS.md)
