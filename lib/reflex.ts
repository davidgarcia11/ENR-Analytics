import sql from 'mssql'; // Driver de SQL Server para Node.js (JS puro sobre tedious)

// Función asíncrona para obtener una conexión a la base de datos de Reflex (SQL Server).
// Mismo patrón que lib/db.ts (Oracle): credenciales desde .env.local, error claro si falta algo,
// y la ruta que llama es responsable de cerrar la conexión con conn.close() en su finally.
export async function getReflexConnection(): Promise<sql.ConnectionPool> {
    const user = process.env.REFLEX_USER;
    const password = process.env.REFLEX_PASSWORD;
    const server = process.env.REFLEX_HOST;
    const port = Number(process.env.REFLEX_PORT || '1433');
    const database = process.env.REFLEX_DATABASE;

    if (!user || !password || !server || !database) {
        throw new Error('Falta configuración de Reflex (SQL Server). Por favor revisa el archivo .env.local');
    }

    const pool = new sql.ConnectionPool({
        user,
        password,
        server,
        port,
        database,
        options: {
            encrypt: true,
            // ponytail: true asume certificado no verificado (típico en SQL Server on-prem);
            // pasar a false si Reflex expone un certificado válido
            trustServerCertificate: true,
        },
    });

    return pool.connect();
}

export { sql };
