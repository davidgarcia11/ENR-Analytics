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
    const articles = searchParams.getAll('article'); // Filtro por uno o varios artículos
    const prp6s = searchParams.getAll('prp6'); // Filtro por Tipo Proceso OF (IMPRP6)
    const prodLines = searchParams.getAll('prodLine'); // Filtro por Línea de producción (F4111.ILMCUZ)
    const srp3s = searchParams.getAll('srp3'); // Filtro por Formato (IMPRP6 con DRRT='S3')
    const srp5s = searchParams.getAll('srp5'); // Filtro por Sabor (IMSRP5 con DRRT='S5')
    const srp2s = searchParams.getAll('srp2'); // Filtro por Familia (IMSRP2 con DRRT='S2')
    const srp1s = searchParams.getAll('srp1'); // Filtro por Categoría (IMSRP1 con DRRT='S1')
    const srp4s = searchParams.getAll('srp4'); // Filtro por Marca (IMSRP4 con DRRT='S4')
    const ze03s = searchParams.getAll('ze03'); // Filtro por Formato (AAZE03 de F554101 con DRRT='B3')

    let conn; // Declaramos la variable para la conexión fuera del try para poder cerrarla en el finally
    try {
        // Intentamos abrir la conexión a la base de datos
        conn = await getDbConnection();

        // JOIN condicional a F4101 solo cuando se filtra por categoría (evita JOIN innecesario)
        const extraJoins = (prp6s.length > 0 || srp3s.length > 0 || srp5s.length > 0 || srp2s.length > 0 || srp1s.length > 0 || srp4s.length > 0)
            ? `INNER JOIN F4101 D ON D.IMITM = A.WAITM`
            : '';

        // JOIN condicional a F554101 (extensión de F4101) cuando se filtra por campos de esa tabla
        const extraJoins554101 = ze03s.length > 0
            ? `INNER JOIN F554101 E ON E.AAITM = A.WAITM`
            : '';

        // Construimos la consulta SQL.
        // F55TAR12 (Tareas) JOIN F4801 (Orden) JOIN F4111 (Item Ledger)
        // Agrupamos por Orden, Día y UNIDAD para luego convertir y sumar
        // Deduplicamos F55TAR12 por orden+fecha (sin subcode) usando subquery,
        // porque registros antiguos (subcode 1) y nuevos (subcode 3/4) pueden coexistir
        // para la misma orden+fecha, lo que duplicaría cantidades al hacer JOIN con F4111.
        // Códigos de motivo de merma (ILRCD) que se incluyen en el cálculo
        const MERMA_CODES = "'P01','P02','P03','P04','P05','Q01','Q02','Q03','Q04','Q05','Q06','Q07','Q08','Q09','Q10'";

        let sql = `
          SELECT
            A.WADOCO,
            B.TO55TAREA,
            A.WADL01,
            SUM(CASE WHEN C.ILDCT = 'IC' THEN C.ILTRQT ELSE 0 END) as WASOQS,
            SUM(CASE WHEN C.ILDCT = 'IS' THEN C.ILTRQT ELSE 0 END) as MERMA,
            A.WAMCU,
            A.WAAITM,
            A.WAITM,
            C.ILTRUM as ILTRUM
          FROM (
            SELECT TODOCO, MAX(TO55TAREA) as TO55TAREA
            FROM F55TAR12
            GROUP BY TODOCO, MOD(TO55TAREA, 100000)
          ) B
          INNER JOIN F4801 A ON A.WADOCO = B.TODOCO
          LEFT JOIN F4111 C ON C.ILDOC = A.WADOCO
            AND MOD(C.ILTRDJ, 100000) = MOD(B.TO55TAREA, 100000)
            AND (
              C.ILDCT = 'IC'
              OR (C.ILDCT = 'IS' AND TRIM(C.ILRCD) IN (${MERMA_CODES}))
            )
          ${extraJoins}
          ${extraJoins554101}
          WHERE 1=1
        `;

        const binds: any = {};

        if (plant && plant !== 'all') {
            sql += ` AND TRIM(A.WAMCU) = :plant`;
            binds.plant = plant;
        }

        if (subLine && subLine !== 'all') {
            const subLineNum = parseInt(subLine);

            // Registros antiguos: TODAS las plantas usaban subcode '1'
            // Mapa de subcode antiguo por planta para incluir ambos rangos (histórico + actual)
            // Corella: actual '2', antiguo '1'
            // Funes 1: actual '3', antiguo '1' | Funes 2: actual '4', antiguo '2'
            const oldSubCodeMap: Record<string, Record<number, number>> = {
                '10200': { 2: 1 },       // Corella: subcode 2 → antiguo 1
                '10300': { 3: 1, 4: 2 }, // Funes: subcode 3→1, 4→2
            };

            const oldSubCode = plant ? oldSubCodeMap[plant]?.[subLineNum] : undefined;

            if (oldSubCode !== undefined && oldSubCode !== null) {
                sql += ` AND (
                    (B.TO55TAREA >= :subLineStart AND B.TO55TAREA < :subLineEnd)
                    OR (B.TO55TAREA >= :subLineOldStart AND B.TO55TAREA < :subLineOldEnd)
                )`;
                binds.subLineStart = subLineNum * 100000;
                binds.subLineEnd = (subLineNum + 1) * 100000;
                binds.subLineOldStart = oldSubCode * 100000;
                binds.subLineOldEnd = (oldSubCode + 1) * 100000;
            } else {
                const min = subLineNum * 100000;
                const max = (subLineNum + 1) * 100000;
                sql += ` AND B.TO55TAREA >= :subLineStart AND B.TO55TAREA < :subLineEnd`;
                binds.subLineStart = min;
                binds.subLineEnd = max;
            }
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

        if (articles.length > 0) {
            for (const a of articles) {
                if (!/^\d{10}$/.test(a)) {
                    return NextResponse.json(
                        { error: 'Formato inválido: El artículo debe contener exactamente 10 números.' },
                        { status: 400 }
                    );
                }
            }
            const placeholders = articles.map((_, i) => `:article${i}`).join(', ');
            sql += ` AND TRIM(A.WAAITM) IN (${placeholders})`;
            articles.forEach((a, i) => { binds[`article${i}`] = a; });
        }

        if (prp6s.length > 0) {
            const placeholders = prp6s.map((_, i) => `:prp6_${i}`).join(', ');
            sql += ` AND TRIM(D.IMPRP6) IN (${placeholders})`;
            prp6s.forEach((v, i) => { binds[`prp6_${i}`] = v; });
        }

        if (srp3s.length > 0) {
            const placeholders = srp3s.map((_, i) => `:srp3_${i}`).join(', ');
            sql += ` AND TRIM(D.IMSRP3) IN (${placeholders})`;
            srp3s.forEach((v, i) => { binds[`srp3_${i}`] = v; });
        }

        if (srp5s.length > 0) {
            const placeholders = srp5s.map((_, i) => `:srp5_${i}`).join(', ');
            sql += ` AND TRIM(D.IMSRP5) IN (${placeholders})`;
            srp5s.forEach((v, i) => { binds[`srp5_${i}`] = v; });
        }

        if (srp2s.length > 0) {
            const placeholders = srp2s.map((_, i) => `:srp2_${i}`).join(', ');
            sql += ` AND TRIM(D.IMSRP2) IN (${placeholders})`;
            srp2s.forEach((v, i) => { binds[`srp2_${i}`] = v; });
        }

        if (srp1s.length > 0) {
            const placeholders = srp1s.map((_, i) => `:srp1_${i}`).join(', ');
            sql += ` AND TRIM(D.IMSRP1) IN (${placeholders})`;
            srp1s.forEach((v, i) => { binds[`srp1_${i}`] = v; });
        }

        if (srp4s.length > 0) {
            const placeholders = srp4s.map((_, i) => `:srp4_${i}`).join(', ');
            sql += ` AND TRIM(D.IMSRP4) IN (${placeholders})`;
            srp4s.forEach((v, i) => { binds[`srp4_${i}`] = v; });
        }

        if (ze03s.length > 0) {
            const placeholders = ze03s.map((_, i) => `:ze03_${i}`).join(', ');
            sql += ` AND TRIM(E.AAZE03) IN (${placeholders})`;
            ze03s.forEach((v, i) => { binds[`ze03_${i}`] = v; });
        }

        if (prodLines.length > 0) {
            const hasEmpty = prodLines.includes('__empty__');
            const realLines = prodLines.filter(v => v !== '__empty__');

            // Oracle trata '' como NULL, así que usamos IS NULL para detectar vacíos
            // TRIM(C.ILMCUZ) IS NULL cubre: campo con espacios (CHAR padding) y campo NULL (LEFT JOIN sin match)
            if (hasEmpty && realLines.length > 0) {
                // Ambos: líneas específicas + registros sin línea
                const placeholders = realLines.map((_, i) => `:prodLine_${i}`).join(', ');
                sql += ` AND (TRIM(C.ILMCUZ) IN (${placeholders}) OR TRIM(C.ILMCUZ) IS NULL)`;
                realLines.forEach((v, i) => { binds[`prodLine_${i}`] = v; });
            } else if (hasEmpty) {
                // Solo registros sin línea
                sql += ` AND TRIM(C.ILMCUZ) IS NULL`;
            } else {
                // Solo líneas específicas
                const placeholders = realLines.map((_, i) => `:prodLine_${i}`).join(', ');
                sql += ` AND TRIM(C.ILMCUZ) IN (${placeholders})`;
                realLines.forEach((v, i) => { binds[`prodLine_${i}`] = v; });
            }
        }

        // Paginación
        const page = parseInt(searchParams.get('page') || '1');
        const limit = parseInt(searchParams.get('limit') || '150');

        // Agrupamos también por C.ILTRUM para poder convertir cada paquete de unidades por separado
        if (limit > 0) {
            const offset = (page - 1) * limit;
            sql += `
              GROUP BY A.WADOCO, B.TO55TAREA, A.WADL01, A.WAMCU, A.WAAITM, A.WAITM, C.ILTRUM
              ORDER BY B.TO55TAREA DESC
              OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY
            `;
        } else {
            // limit=0 significa sin paginación: traer todos los registros
            sql += `
              GROUP BY A.WADOCO, B.TO55TAREA, A.WADL01, A.WAMCU, A.WAAITM, A.WAITM, C.ILTRUM
              ORDER BY B.TO55TAREA DESC
            `;
        }

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
                    merma: 0, // Merma acumulada (será valor negativo)
                    unit: primUom, // La unidad final siempre será la primaria
                    plantCode: row.WAMCU != null ? String(row.WAMCU).trim() : '',
                    article: itemDisplayId, // Mantenemos el ID que el usuario ve (WAAITM)
                    subLine: jdeParsed?.subBlockName || 'Desconocido',
                    subLineCode: jdeParsed?.subBlock
                });
            }

            // Calcular Cantidad Convertida (producción y merma)
            const group = processedGroups.get(groupKey);
            const rawQty = row.WASOQS || 0; // Cantidad producción (IC) multiplicada por 100
            const rawMerma = row.MERMA || 0; // Cantidad merma (IS) multiplicada por 100 (negativa)
            const quantityVal = rawQty / 100.0;
            const mermaVal = rawMerma / 100.0;
            const fromUom = row.ILTRUM ? String(row.ILTRUM).trim() : group.unit;

            let finalQty = quantityVal;
            let finalMerma = mermaVal;

            // Si las unidades difieren, buscamos conversión usando el ID Corto
            if (fromUom !== group.unit) {
                const factor = getConversionFactor(itemShortId, fromUom, group.unit);
                if (factor !== null) {
                    finalQty = quantityVal * factor;
                    finalMerma = mermaVal * factor;
                }
            }

            // Sumamos al acumulado del grupo
            group.quantity += finalQty;
            group.merma += finalMerma;
        });

        // Convertimos el Map a array y calculamos % merma
        // Fórmula: (-1*merma) / (-1*merma + producido) * 100
        // merma viene negativa de Oracle (IS resta), así que -1*merma = valor positivo
        const data = Array.from(processedGroups.values()).map(item => {
            const absMerma = Math.abs(item.merma);
            const total = absMerma + item.quantity;
            const mermaPercent = total > 0
                ? Math.round((absMerma / total) * 10000) / 100 // Redondear a 2 decimales
                : 0;
            return { ...item, mermaPercent };
        });

        // Devolvemos los datos junto con el conteo de filas SQL originales
        // para que el frontend pueda determinar correctamente si hay más páginas
        return NextResponse.json({ data, sqlRowCount: rows.length });

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
