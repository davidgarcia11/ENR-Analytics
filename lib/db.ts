import oracledb from 'oracledb';

// Set to Object format for easier handling
oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;

// Init for Thin mode (optional but good practice to allow env override if needed)
try {
    oracledb.initOracleClient();
} catch (e) {
    // Ignore if already init or not needed
}

export async function getDbConnection() {
    const user = process.env.ORACLE_USER;
    const password = process.env.ORACLE_PASSWORD;
    const host = process.env.ORACLE_HOST;
    const port = process.env.ORACLE_PORT || '1521';
    const service = process.env.ORACLE_SERVICE;

    if (!user || !password || !host || !service) {
        throw new Error('Database configuration missing. Please check .env.local');
    }

    const connectString = `${host}:${port}/${service}`;

    return await oracledb.getConnection({
        user,
        password,
        connectString,
    });
}
