import { NextRequest, NextResponse } from 'next/server'; // Importamos tipos necesarios para manejar peticiones y respuestas en Next.js
import { getDbConnection } from '@/lib/db'; // Importamos nuestra función personalizada para conectar a la base de datos
import { parseJdeDate, parseWasOqs } from '@/lib/utils'; // Importamos funciones de utilidad para parsear fechas formato JDE y cantidades
import { getDayOfYear } from 'date-fns'; // Importamos una función de una librería externa para obtener el día del año (1-366)

// Esta función exportada 'GET' manejará las peticiones HTTP GET a esta ruta (/api/production)
export async function GET(req: NextRequest) {
    // Obtenemos los parámetros de búsqueda de la URL (ej: ?plant=Funes&subLine=1)
    const { searchParams } = new URL(req.url);

    // Extraemos los valores específicos de los parámetros
    const plant = searchParams.get('plant'); // Planta (ej: 'Funes')
    const subLine = searchParams.get('subLine'); // Sub-línea (ej: '1', '2')
    const startDateStr = searchParams.get('startDate'); // Fecha inicio (YYYY-MM-DD)
    const endDateStr = searchParams.get('endDate'); // Fecha fin
    const article = searchParams.get('article'); // Nuevo filtro: Artículo

    let conn; // Declaramos la variable para la conexión fuera del try para poder cerrarla en el finally
    try {
        // Intentamos abrir la conexión a la base de datos
        conn = await getDbConnection();

        // Construimos la consulta SQL base.
        // Seleccionamos columnas específicas de las tablas F55TAR12 (Tareas) y F4801 (Órdenes)
        // Hacemos un INNER JOIN para combinar filas donde coincida el número de documento (WADOCO = TODOCO)
        let sql = `
          SELECT A.WADOCO, B.TO55TAREA, A.WADL01, A.WASOQS, A.WAMCU, A.WAAITM, B.TOUM
          FROM F55TAR12 B
          INNER JOIN F4801 A ON A.WADOCO = B.TODOCO
          WHERE 1=1
        `;
        // WHERE 1=1 es un truco para poder concatenar condiciones con 'AND' fácilmente después

        // Objeto para guardar los valores que sustituirán a los marcadores (:plant, :subLineStart, etc.)
        // Esto es crucial para evitar Inyección SQL
        const binds: any = {};

        // Si hay un parámetro 'plant' y no es 'all', añadimos el filtro a la consulta
        if (plant && plant !== 'all') {
            sql += ` AND TRIM(A.WAMCU) = :plant`; // Usamos TRIM para quitar espacios en blanco
            binds.plant = plant; // Asignamos el valor al objeto de binds
        }

        // Si hay un parámetro 'subLine' y no es 'all', filtramos por sub-línea
        if (subLine && subLine !== 'all') {
            // La sub-línea es el primer dígito de TO55TAREA (formato CYYDDD)
            // Calculamos el rango multiplicando por 100,000.
            // Ej: si subLine es 1, buscamos entre 100,000 y 200,000
            const min = parseInt(subLine) * 100000;
            const max = (parseInt(subLine) + 1) * 100000;

            sql += ` AND B.TO55TAREA >= :subLineStart AND B.TO55TAREA < :subLineEnd`;
            binds.subLineStart = min;
            binds.subLineEnd = max;
        }

        // Filtro por rango de fechas
        if (startDateStr && endDateStr) {
            const start = new Date(startDateStr);
            const end = new Date(endDateStr);

            // Verificamos que las fechas sean válidas
            if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
                // Convertimos la fecha normal al formato JDE sufijo (YYDDD)
                // Año JDE = Año real - 2000 (ej: 2024 -> 24)
                const startYY = start.getFullYear() - 2000;
                const startDDD = getDayOfYear(start); // Día del año (1-366)
                const startJdeSuffix = (startYY * 1000) + startDDD; // Ej: 24001 para 1 Ene 2024

                const endYY = end.getFullYear() - 2000;
                const endDDD = getDayOfYear(end);
                const endJdeSuffix = (endYY * 1000) + endDDD;

                // Filtramos usando MOD (módulo) para ignorar el primer dígito (sub-línea)
                // MOD(124001, 100000) = 24001. Comparamos solo la parte de la fecha.
                sql += ` AND MOD(B.TO55TAREA, 100000) >= :startJde AND MOD(B.TO55TAREA, 100000) <= :endJde`;
                binds.startJde = startJdeSuffix;
                binds.endJde = endJdeSuffix;
            }
        }

        // Si hay un parámetro 'article', aplicamos el filtro con seguridad extra
        if (article) {
            // Control de seguridad: Validar que sea estrictamente numérico y de 10 dígitos con una Expresión Regular
            // ^ = inicio, \d = dígito, {10} = exactamente 10 veces, $ = fin
            if (!/^\d{10}$/.test(article)) {
                // Si no cumple, devolvemos un error 400 (Bad Request) inmediatamente
                return NextResponse.json(
                    { error: 'Formato inválido: El artículo debe contener exactamente 10 números.' },
                    { status: 400 }
                );
            }

            sql += ` AND TRIM(A.WAAITM) = :article`; // Filtramos por la columna de artículo
            binds.article = article; // Añadimos al bind
        }

        // Paginación: Calculamos cuántas filas saltar y cuántas traer
        const page = parseInt(searchParams.get('page') || '1'); // Página actual (default 1)
        const limit = parseInt(searchParams.get('limit') || '150'); // Filas por página (default 150)
        const offset = (page - 1) * limit; // Filas a saltar (ej: pág 2 salta las primeras 150)

        // Añadimos ordenamiento y paginación a la consulta SQL
        // OFFSET ... FETCH NEXT es la sintaxis estándar de SQL Server/Oracle modernos para paginación
        sql += ` ORDER BY B.TO55TAREA DESC OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY`;

        // Ejecutamos la consulta final en la base de datos
        const result = await conn.execute(sql, binds);

        // Obtenemos las filas crudas de la respuesta
        const rows = result.rows as any[];

        // Transformamos los datos crudos a un formato más limpio para el frontend
        const data = rows.map((row: any) => {
            const plantStr = row.WAMCU != null ? String(row.WAMCU).trim() : undefined;
            // Usamos una función auxiliar para interpretar la fecha extraña de JDE
            const jdeParsed = parseJdeDate(row.TO55TAREA, plantStr);

            return {
                order: row.WADOCO != null ? String(row.WADOCO).trim() : '', // Número de orden
                date: jdeParsed ? jdeParsed.date : null, // Fecha legible
                productionDateRaw: row.TO55TAREA, // Fecha cruda (para debug si hace falta)
                description: row.WADL01 != null ? String(row.WADL01).trim() : '', // Descripción
                quantity: parseWasOqs(row.WASOQS), // Cantidad parseada
                unit: row.TOUM != null ? String(row.TOUM).trim() : '', // Unidad de medida
                plantCode: row.WAMCU != null ? String(row.WAMCU).trim() : '', // Código de planta
                article: row.WAAITM != null ? String(row.WAAITM).trim() : '', // Artículo
                subLine: jdeParsed?.subBlockName || 'Desconocido', // Nombre de la sub-línea (ej: "Funes 1")
                subLineCode: jdeParsed?.subBlock // Código de la sub-línea (ej: 1)
            };
        });

        // Devolvemos los datos procesados como respuesta JSON
        return NextResponse.json(data);

    } catch (err: any) {
        // Si ocurre cualquier error en el bloque try, lo capturamos aquí
        console.error("Database Error:", err); // Lo registramos en la consola del servidor
        return NextResponse.json({ error: err.message }, { status: 500 }); // Devolvemos error 500 al cliente
    } finally {
        // El bloque finally se ejecuta SIEMPRE, haya error o no
        if (conn) {
            try {
                await conn.close(); // Cerramos la conexión para no saturar la base de datos
            } catch (e) {
                console.error(e);
            }
        }
    }
}
