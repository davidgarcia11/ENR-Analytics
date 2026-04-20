# Dashboard de Producción — Elaborados Naturales

Panel de control de producción que conecta con Oracle JD Edwards (JDE) y muestra en tiempo real órdenes de fabricación, merma, producción por planta/línea y palets caducados/obsoletos/bloqueados.

## Stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript 5**
- **Oracle JDE** — datos de producción y stock
- **SQLite** (`better-sqlite3`) — usuarios, presets y logs locales
- **Tailwind CSS 4** + **Radix UI** + **Recharts**
- **Bun** — runtime y gestor de paquetes

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

Toda la documentación técnica está en [`DOCUMENTACION.md`](DOCUMENTACION.md).

Documentación específica por panel en [`docs/`](docs/):
- [`docs/produccion.md`](docs/produccion.md) — Dashboard de producción
- [`docs/palets-caducados.md`](docs/palets-caducados.md) — Palets caducados/obsoletos/bloqueados

Manuales de usuario:
- [`MANUAL_USUARIO_PRODUCCION.md`](MANUAL_USUARIO_PRODUCCION.md)
- [`MANUAL_USUARIO_CADUCADOS.md`](MANUAL_USUARIO_CADUCADOS.md)
