import oracledb from 'oracledb'; // Importamos el driver oficial de Oracle para Node.js

// Configuramos el formato de salida para que las filas vengan como objetos { columna: valor }
// en vez de arrays [valor1, valor2]. Es mucho más fácil de manejar.
oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;

// Inicializamos el cliente de Oracle.
// Esto es necesario en algunos entornos para que encuentre las librerías nativas.
try {
    oracledb.initOracleClient(); // Intenta inicializar el cliente
} catch (e) {
    // Si falla (por ejemplo, si ya estaba inicializado o no hay librerías nativas),
    // lo ignoramos para que no rompa la aplicación.
}

// Función asíncrona para obtener una conexión a la base de datos
export async function getDbConnection() {
    // Leemos las credenciales y configuración desde las variables de entorno (.env.local)
    // Es vital NO escribir contraseñas directamente en el código por seguridad.
    const user = process.env.ORACLE_USER;
    const password = process.env.ORACLE_PASSWORD;
    const host = process.env.ORACLE_HOST;
    const port = process.env.ORACLE_PORT || '1521'; // Si no hay puerto, usamos el 1521 por defecto
    const service = process.env.ORACLE_SERVICE;

    // Verificamos que tengamos toda la información necesaria
    if (!user || !password || !host || !service) {
        // Si falta algo, lanzamos un error claro para saber qué arreglar
        throw new Error('Falta configuración de base de datos. Por favor revisa el archivo .env.local');
    }

    // Construimos la cadena de conexión estándar de Oracle (Host:Puerto/Servicio)
    const connectString = `${host}:${port}/${service}`;

    // Pedimos a la librería que nos devuelva una conexión abierta
    // 'await' espera a que la conexión se establezca antes de continuar
    return await oracledb.getConnection({
        user,
        password,
        connectString,
    });
}
