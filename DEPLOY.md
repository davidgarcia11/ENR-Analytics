# Guía de Despliegue en Otro Ordenador

Para ejecutar este proyecto en otro ordenador, **necesitas tener Bun instalado**. Node.js ya no es estrictamente necesario, aunque puede ser útil tenerlo si falla la instalación de Bun.

## Pasos para la instalación

### 1. Instalar Bun
Abre **PowerShell** o  **Linux** como administrador y ejecuta:
```powershell
powershell -c "irm bun.sh/install.ps1 | iex"
curl -fsSL https://bun.sh/install | bash
```

> **Nota**: Si este comando falla, puedes instalar [Node.js](https://nodejs.org/) primero y luego ejecutar `npm install -g bun`.

### 2. Clonar el repositorio
Descarga el código desde GitHub:
```bash
git clone https://github.com/davidgarcia11/produccionENR.git
cd produccionENR
```

### 3. Instalar dependencias
Dentro de la carpeta del proyecto, ejecuta:
```bash
bun install
```

### 4. Configurar entorno
Asegúrate de copiar tu archivo `.env.local` si tienes claves secretas (o créalo de nuevo con los datos de conexión a Oracle).

### 5. Ejecutar
Para desarrollo:
```bash
bun dev
```

Para producción (más rápido y menos consumo):
```bash
bun run build
bun start
```

---

## Migración desde otro servidor (sin perder datos)

Si ya tienes el dashboard funcionando en otro servidor y quieres moverlo a uno nuevo **sin perder usuarios, presets ni logs**, sigue estos pasos:

### 1. En el servidor viejo
Copia el archivo de base de datos:
```
dashboard/data/app.db
```
Este único archivo contiene todos los usuarios, presets de filtros y logs de consultas.

### 2. En el servidor nuevo
Sigue los pasos 1-4 de arriba (instalar Bun, clonar, instalar dependencias, configurar `.env.local`).

### 3. Copiar la base de datos
Antes de arrancar, copia el `app.db` del servidor viejo a la carpeta `data/`:
```bash
mkdir data
# Copiar aquí el app.db del servidor viejo
```

### 4. Compilar y arrancar
```bash
bun run build
bun start
```

### Notas importantes

- **`JWT_SECRET`**: Usa el mismo valor en `.env.local` que en el servidor viejo. Si lo cambias, las sesiones activas se invalidarán y los usuarios tendrán que volver a loguearse (no se pierden datos, solo la sesión).
- **`data/app.db`**: Está en `.gitignore`, así que `git pull`, `bun install` y `bun run build` nunca lo sobreescriben.
- Si no copias el `app.db`, se creará uno nuevo automáticamente con el usuario admin por defecto (`admin` / `admin123`).
