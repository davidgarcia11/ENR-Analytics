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

        // Construimos la consulta SQL.
        // F55TAR12 (Tareas) JOIN F4801 (Orden) JOIN F4111 (Item Ledger)
        // Agrupamos por Orden, Día y UNIDAD para luego convertir y sumar
        let sql = `
          SELECT 
            A.WADOCO, 
            B.TO55TAREA, 
            A.WADL01, 
            SUM(C.ILTRQT) as WASOQS, 
            A.WAMCU, 
            A.WAAITM, 
            A.WAITM,
            C.ILTRUM as ILTRUM
          FROM F55TAR12 B
          INNER JOIN F4801 A ON A.WADOCO = B.TODOCO
          LEFT JOIN F4111 C ON C.ILDOC = A.WADOCO 
            AND C.ILDCT = 'IC' 
            AND MOD(C.ILTRDJ, 100000) = MOD(B.TO55TAREA, 100000)
          WHERE 1=1
        `;

        const binds: any = {};

        if (plant && plant !== 'all') {
            sql += ` AND TRIM(A.WAMCU) = :plant`;
            binds.plant = plant;
        }

        if (subLine && subLine !== 'all') {
            const min = parseInt(subLine) * 100000;
            const max = (parseInt(subLine) + 1) * 100000;
            sql += ` AND B.TO55TAREA >= :subLineStart AND B.TO55TAREA < :subLineEnd`;
            binds.subLineStart = min;
            binds.subLineEnd = max;
        }

        if (startDateStr && endDateStr) {
            const start = new Date(startDateStr);
            const end = new Date(endDateStr);

            if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
                const startYY = start.getFullYear() - 2000;
                const startDDD = getDayOfYear(start);
                const startJdeSuffix = (startYY * 1000) + startDDD;

                const endYY = end.getFullYear() - 2000;
                const endDDD = getDayOfYear(end);
                const endJdeSuffix = (endYY * 1000) + endDDD;

                sql += ` AND MOD(B.TO55TAREA, 100000) >= :startJde AND MOD(B.TO55TAREA, 100000) <= :endJde`;
                binds.startJde = startJdeSuffix;
                binds.endJde = endJdeSuffix;
            }
        }

        if (article) {
            if (!/^\d{10}$/.test(article)) {
                return NextResponse.json(
                    { error: 'Formato inválido: El artículo debe contener exactamente 10 números.' },
                    { status: 400 }
                );
            }
            sql += ` AND TRIM(A.WAAITM) = :article`;
            binds.article = article;
        }

        // Paginación
        const page = parseInt(searchParams.get('page') || '1');
        const limit = parseInt(searchParams.get('limit') || '150');
        const offset = (page - 1) * limit;

        // Agrupamos también por C.ILTRUM para poder convertir cada paquete de unidades por separado
        sql += ` 
          GROUP BY A.WADOCO, B.TO55TAREA, A.WADL01, A.WAMCU, A.WAAITM, A.WAITM, C.ILTRUM
          ORDER BY B.TO55TAREA DESC 
          OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY
        `;

        // Ejecutamos la consulta principal
        const result = await conn.execute(sql, binds);
        const rows = result.rows as any[];

        if (rows.length === 0) {
            return NextResponse.json([]);
        }

        // --- Lógica de Conversión de Unidades ---

        // 1. Obtener lista única de IDs CORTOS (Numeric) para buscar sus unidades primarias y conversiones
        // Usamos WAITM porque las tablas F4101 y F41002 usan el Short Item Number (IMITM/UMITM)
        const itemIds = Array.from(new Set(rows.map(r => String(r.WAITM).trim()).filter(Boolean)));

        // Si no hay items, devolvemos vacío (aunque ya comprobamos rows.length)
        if (itemIds.length === 0) return NextResponse.json([]);

        // 2. Buscar Unidades Primarias (F4101)
        // IMITM = Item ID, IMUOM1 = Primary UOM
        let primaryUomSql = `SELECT IMITM, IMUOM1 FROM F4101 WHERE IMITM IN (${itemIds.map((_, i) => `:id${i}`).join(',')})`;
        // Mapeamos los IDs a binds :id0, :id1, etc.
        const itemBinds: any = {};
        itemIds.forEach((id, i) => itemBinds[`id${i}`] = id);

        const primaryUomResult = await conn.execute(primaryUomSql, itemBinds);
        const primaries = new Map<string, string>(); // ItemID (Short) -> PrimaryUOM
        (primaryUomResult.rows as any[]).forEach(r => {
            primaries.set(String(r.IMITM).trim(), String(r.IMUOM1).trim());
        });

        // 3. Buscar Definiciones de Conversión (F41002)
        // UMITM = Item ID, UMUM = From UOM, UMRUM = To UOM, UMCONV = Factor
        let convSql = `SELECT UMITM, UMUM, UMRUM, UMCONV FROM F41002 WHERE UMITM IN (${itemIds.map((_, i) => `:id${i}`).join(',')})`;
        const convResult = await conn.execute(convSql, itemBinds);

        // Estructura: ItemID (Short) -> [ConversionObj, ConversionObj...]
        const conversionsMap = new Map<string, any[]>();
        (convResult.rows as any[]).forEach(r => {
            const itemId = String(r.UMITM).trim();
            if (!conversionsMap.has(itemId)) conversionsMap.set(itemId, []);
            conversionsMap.get(itemId)!.push({
                from: String(r.UMUM).trim(),
                to: String(r.UMRUM).trim(),
                factorObj: r.UMCONV // Guardamos el valor crudo, luego lo dividimos por 10^7
            });
        });

        // 4. Función Auxiliar para buscar ruta de conversión (BFS hasta 3 niveles)
        const getConversionFactor = (itemId: string, fromUom: string, targetUom: string): number | null => {
            if (fromUom === targetUom) return 1;

            const itemConversions = conversionsMap.get(itemId) || [];

            // Cola para BFS: [{ uom: currentUom, factor: accumulatedFactor, depth: currentDepth }]
            const queue = [{ uom: fromUom, factor: 1, depth: 0 }];
            const visited = new Set<string>();
            visited.add(fromUom);

            while (queue.length > 0) {
                const current = queue.shift()!;

                if (current.depth >= 3) continue; // Límite de 3 niveles

                // Buscamos conversiones directas desde current.uom
                const nextSteps = itemConversions.filter(c => c.from === current.uom);

                for (const step of nextSteps) {
                    // Calcular factor real: JDE guarda 1.0 como 10000000 -> dividir por 10^7
                    const stepFactor = step.factorObj / 10000000.0;
                    const newFactor = current.factor * stepFactor;

                    if (step.to === targetUom) {
                        return newFactor; // Encontrado!
                    }

                    if (!visited.has(step.to)) {
                        visited.add(step.to);
                        queue.push({ uom: step.to, factor: newFactor, depth: current.depth + 1 });
                    }
                }
            }
            return null; // No se encontró camino
        };

        // 5. Procesar y Agrupar filas convertidas
        const processedGroups = new Map<string, any>();
        // Clave agrupadora: Orden + Fecha (ignorando unidad de origen)

        rows.forEach((row: any) => {
            const order = row.WADOCO != null ? String(row.WADOCO).trim() : '';
            // Usamos WAITM para la lógica interna, pero mantenemos WAAITM para mostrar si se desea (aunque article aqui usa WAAITM)
            const itemShortId = row.WAITM != null ? String(row.WAITM).trim() : '';
            const itemDisplayId = row.WAAITM != null ? String(row.WAAITM).trim() : '';

            const productionDateRaw = row.TO55TAREA;

            // Clave única para el reporte final (Orden + Dia)
            const groupKey = `${order}-${productionDateRaw}`;

            // Datos base del grupo (si no existe, lo creamos)
            if (!processedGroups.has(groupKey)) {
                // Parseamos la fecha solo una vez por grupo
                const plantStr = row.WAMCU != null ? String(row.WAMCU).trim() : undefined;
                const jdeParsed = parseJdeDate(productionDateRaw, plantStr);

                // Buscamos la unidad primaria (target goal) usando el ID Corto
                const primUom = primaries.get(itemShortId) || (row.ILTRUM ? String(row.ILTRUM).trim() : 'EA');

                processedGroups.set(groupKey, {
                    order: order,
                    date: jdeParsed ? jdeParsed.date : null,
                    productionDateRaw: productionDateRaw,
                    description: row.WADL01 != null ? String(row.WADL01).trim() : '',
                    quantity: 0, // Inicializamos en 0
                    unit: primUom, // La unidad final siempre será la primaria
                    plantCode: row.WAMCU != null ? String(row.WAMCU).trim() : '',
                    article: itemDisplayId, // Mantenemos el ID que el usuario ve (WAAITM)
                    subLine: jdeParsed?.subBlockName || 'Desconocido',
                    subLineCode: jdeParsed?.subBlock
                });
            }

            // Calcular Cantidad Convertida
            const group = processedGroups.get(groupKey);
            const rawQty = row.WASOQS || 0; // Cantidad de F4111 (multiplicada por 100 en origen)
            const quantityVal = rawQty / 100.0; // Quitamos los decimales de JDE
            const fromUom = row.ILTRUM ? String(row.ILTRUM).trim() : group.unit; // Unidad de esta fila

            let finalQty = quantityVal;

            // Si las unidades difieren, buscamos conversión usando el ID Corto
            if (fromUom !== group.unit) {
                const factor = getConversionFactor(itemShortId, fromUom, group.unit);
                if (factor !== null) {
                    finalQty = quantityVal * factor;
                } else {
                    // Si no hay factor, dejamos la cantidad tal cual (con warning silencioso si deseamos)
                    // console.warn(`No conversion found for item ${itemId} from ${fromUom} to ${group.unit}`);
                    // Log conversions
                    // console.log(`DEBUG: Conversions for ${itemId}:`, conversionsMap.get(itemId));
                }
            }

            // Sumamos al acumulado del grupo
            group.quantity += finalQty;
        });

        // Convertimos el Map a array
        const data = Array.from(processedGroups.values());

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
