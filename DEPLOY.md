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
