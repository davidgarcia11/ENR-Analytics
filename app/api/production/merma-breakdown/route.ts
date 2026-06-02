import { NextRequest, NextResponse } from 'next/server';
import { getDbConnection } from '@/lib/db';
import { getDayOfYear } from 'date-fns';
import { requireScreenAccess } from '@/lib/permissions';

// Endpoint auxiliar para el desglose de merma por código de motivo (ILRCD).
// No modifica la lógica del endpoint principal /api/production: comparte los
// filtros, JOINs y conversión de UM, pero agrega por código en lugar de por orden.
//
// Modos:
//   ?mode=global  -> Desglose global agregado por código, respetando filtros.
//   ?mode=row     -> Desglose para una fila concreta (order + productionDateRaw + article).
//   ?mode=matrix  -> Desglose por artículo y código (formato largo, usado en Excel).
//
// Códigos de merma (F0005 con DRSY=42, DRRT=RC) — solo los que empiezan por Q o P.

const MERMA_CODES_ARR = [
    'P01', 'P02', 'P03', 'P04', 'P05',
    'Q01', 'Q02', 'Q03', 'Q04', 'Q05', 'Q06', 'Q07', 'Q08', 'Q09', 'Q10',
];
const MERMA_CODES_SQL = MERMA_CODES_ARR.map(c => `'${c}'`).join(',');

type Mode = 'global' | 'row' | 'matrix';

export async function GET(req: NextRequest) {
    const denied = await requireScreenAccess('produccion');
    if (denied) return denied;

    const { searchParams } = new URL(req.url);

    const modeParam = (searchParams.get('mode') || 'global') as Mode;
    if (!['global', 'row', 'matrix'].includes(modeParam)) {
        return NextResponse.json({ error: 'Modo no válido' }, { status: 400 });
    }
    const mode: Mode = modeParam;

    // Mismos parámetros de filtro que /api/production
    const plant = searchParams.get('plant');
    const subLine = searchParams.get('subLine');
    const startDateStr = searchParams.get('startDate');
    const endDateStr = searchParams.get('endDate');
    const articles = searchParams.getAll('article');
    const prp6s = searchParams.getAll('prp6');
    const prodLines = searchParams.getAll('prodLine');
    const srp3s = searchParams.getAll('srp3');
    const srp5s = searchParams.getAll('srp5');
    const srp2s = searchParams.getAll('srp2');
    const srp1s = searchParams.getAll('srp1');
    const srp4s = searchParams.getAll('srp4');
    const ze03s = searchParams.getAll('ze03');
    const startTimeStr = searchParams.get('startTime');
    const endTimeStr = searchParams.get('endTime');

    // Parámetros exclusivos del modo 'row'
    const rowOrder = searchParams.get('order');
    const rowDateRaw = searchParams.get('productionDateRaw');
    const rowArticle = searchParams.get('rowArticle');

    if (mode === 'row') {
        if (!rowOrder || !rowDateRaw || !rowArticle) {
            return NextResponse.json(
                { error: 'En modo row se requieren order, productionDateRaw y rowArticle.' },
                { status: 400 }
            );
        }
        if (!/^\d{10}$/.test(rowArticle)) {
            return NextResponse.json(
                { error: 'Formato inválido: rowArticle debe contener exactamente 10 números.' },
                { status: 400 }
            );
        }
    }

    let conn;
    try {
        conn = await getDbConnection();

        // JOINs condicionales (idénticos al endpoint principal)
        const extraJoins = (prp6s.length > 0 || srp3s.length > 0 || srp5s.length > 0 || srp2s.length > 0 || srp1s.length > 0 || srp4s.length > 0)
            ? `INNER JOIN F4101 D ON D.IMITM = A.WAITM`
            : '';
        const extraJoins554101 = ze03s.length > 0
            ? `INNER JOIN F554101 E ON E.AAITM = A.WAITM`
            : '';

        const timeToIntStart = (hhmmss: string): number => {
            const parts = hhmmss.split(':').map(Number);
            const [hh, mm, ss = 0] = parts;
            return hh * 10000 + mm * 100 + ss;
        };
        const timeToIntEnd = (hhmmss: string): number => {
            const parts = hhmmss.split(':').map(Number);
            const [hh, mm, ss] = parts;
            return hh * 10000 + mm * 100 + (ss !== undefined ? ss : 59);
        };
        const startTimeInt = startTimeStr ? timeToIntStart(startTimeStr) : null;
        const endTimeInt = endTimeStr ? timeToIntEnd(endTimeStr) : null;

        const timeJoinCondition = (startTimeInt !== null && endTimeInt !== null)
            ? `AND COALESCE(C.ILTDAY, 0) >= :startTime AND COALESCE(C.ILTDAY, 0) <= :endTime`
            : startTimeInt !== null
                ? `AND COALESCE(C.ILTDAY, 0) >= :startTime`
                : endTimeInt !== null
                    ? `AND COALESCE(C.ILTDAY, 0) <= :endTime`
                    : '';

        // El SELECT y GROUP BY cambian según el modo.
        // Siempre necesitamos: WAITM (para conversión UM), ILRCD (código), ILTRUM (origen UM), SUM(ILTRQT).
        // En modo matrix añadimos WAAITM (article display) y descripción del artículo.
        const selectColumns =
            mode === 'matrix'
                ? `A.WAAITM as WAAITM, TRIM(M.IMDSC1) AS IMDSC1, A.WAITM, TRIM(C.ILRCD) as ILRCD, C.ILTRUM as ILTRUM, SUM(C.ILTRQT) as MERMA_RAW`
                : `A.WAITM, TRIM(C.ILRCD) as ILRCD, C.ILTRUM as ILTRUM, SUM(C.ILTRQT) as MERMA_RAW`;

        const groupByColumns =
            mode === 'matrix'
                ? `A.WAAITM, M.IMDSC1, A.WAITM, TRIM(C.ILRCD), C.ILTRUM`
                : `A.WAITM, TRIM(C.ILRCD), C.ILTRUM`;

        // En modo matrix necesitamos F4101 M para la descripción del artículo
        const matrixItemJoin = mode === 'matrix' ? `INNER JOIN F4101 M ON M.IMITM = A.WAITM` : '';

        let sql = `
          SELECT ${selectColumns}
          FROM (
            SELECT TODOCO, MAX(TO55TAREA) as TO55TAREA
            FROM F55TAR12
            GROUP BY TODOCO, MOD(TO55TAREA, 100000)
          ) B
          INNER JOIN F4801 A ON A.WADOCO = B.TODOCO
          ${matrixItemJoin}
          INNER JOIN F4111 C ON C.ILDOC = A.WADOCO
            AND MOD(C.ILTRDJ, 100000) = MOD(B.TO55TAREA, 100000)
            AND C.ILDCT = 'IS'
            AND TRIM(C.ILRCD) IN (${MERMA_CODES_SQL})
            ${timeJoinCondition}
          ${extraJoins}
          ${extraJoins554101}
          WHERE 1=1
        `;

        const binds: any = {};
        if (startTimeInt !== null) binds.startTime = startTimeInt;
        if (endTimeInt !== null) binds.endTime = endTimeInt;

        if (plant && plant !== 'all') {
            sql += ` AND TRIM(A.WAMCU) = :plant`;
            binds.plant = plant;
        }

        if (subLine && subLine !== 'all') {
            const subLineNum = parseInt(subLine);
            const oldSubCodeMap: Record<string, Record<number, number>> = {
                '10200': { 2: 1 },
                '10300': { 3: 1, 4: 2 },
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
                sql += ` AND B.TO55TAREA >= :subLineStart AND B.TO55TAREA < :subLineEnd`;
                binds.subLineStart = subLineNum * 100000;
                binds.subLineEnd = (subLineNum + 1) * 100000;
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
            if (hasEmpty && realLines.length > 0) {
                const placeholders = realLines.map((_, i) => `:prodLine_${i}`).join(', ');
                sql += ` AND (TRIM(C.ILMCUZ) IN (${placeholders}) OR TRIM(C.ILMCUZ) IS NULL)`;
                realLines.forEach((v, i) => { binds[`prodLine_${i}`] = v; });
            } else if (hasEmpty) {
                sql += ` AND TRIM(C.ILMCUZ) IS NULL`;
            } else {
                const placeholders = realLines.map((_, i) => `:prodLine_${i}`).join(', ');
                sql += ` AND TRIM(C.ILMCUZ) IN (${placeholders})`;
                realLines.forEach((v, i) => { binds[`prodLine_${i}`] = v; });
            }
        }

        // Filtros adicionales solo para modo 'row'
        if (mode === 'row') {
            sql += ` AND A.WADOCO = :rowOrder`;
            sql += ` AND B.TO55TAREA = :rowDateRaw`;
            sql += ` AND TRIM(A.WAAITM) = :rowArticle`;
            binds.rowOrder = Number(rowOrder);
            binds.rowDateRaw = Number(rowDateRaw);
            binds.rowArticle = rowArticle;
        }

        sql += ` GROUP BY ${groupByColumns}`;

        const result = await conn.execute(sql, binds);
        const rows = result.rows as any[];

        if (rows.length === 0) {
            return NextResponse.json(emptyPayload(mode));
        }

        // --- Conversión de UM (misma lógica que /api/production) ---
        const itemIds = Array.from(new Set(rows.map(r => String(r.WAITM).trim()).filter(Boolean)));

        const itemBinds: any = {};
        itemIds.forEach((id, i) => { itemBinds[`id${i}`] = id; });

        const primaryUomSql = `SELECT IMITM, IMUOM1 FROM F4101 WHERE IMITM IN (${itemIds.map((_, i) => `:id${i}`).join(',')})`;
        const primaryUomResult = await conn.execute(primaryUomSql, itemBinds);
        const primaries = new Map<string, string>();
        (primaryUomResult.rows as any[]).forEach(r => {
            primaries.set(String(r.IMITM).trim(), String(r.IMUOM1).trim());
        });

        const convSql = `SELECT UMITM, UMUM, UMRUM, UMCONV FROM F41002 WHERE UMITM IN (${itemIds.map((_, i) => `:id${i}`).join(',')})`;
        const convResult = await conn.execute(convSql, itemBinds);
        const conversionsMap = new Map<string, any[]>();
        (convResult.rows as any[]).forEach(r => {
            const itemId = String(r.UMITM).trim();
            if (!conversionsMap.has(itemId)) conversionsMap.set(itemId, []);
            conversionsMap.get(itemId)!.push({
                from: String(r.UMUM).trim(),
                to: String(r.UMRUM).trim(),
                factorObj: r.UMCONV,
            });
        });

        const getConversionFactor = (itemId: string, fromUom: string, targetUom: string): number | null => {
            if (fromUom === targetUom) return 1;
            const itemConversions = conversionsMap.get(itemId) || [];
            const queue = [{ uom: fromUom, factor: 1, depth: 0 }];
            const visited = new Set<string>();
            visited.add(fromUom);
            while (queue.length > 0) {
                const current = queue.shift()!;
                if (current.depth >= 3) continue;
                const nextSteps = itemConversions.filter(c => c.from === current.uom);
                for (const step of nextSteps) {
                    const stepFactor = step.factorObj / 10000000.0;
                    const newFactor = current.factor * stepFactor;
                    if (step.to === targetUom) return newFactor;
                    if (!visited.has(step.to)) {
                        visited.add(step.to);
                        queue.push({ uom: step.to, factor: newFactor, depth: current.depth + 1 });
                    }
                }
            }
            return null;
        };

        // Convertir cantidades a UM primaria. Las cantidades vienen ×100 y negativas (IS resta inventario).
        // El desglose lo mostramos siempre como valor positivo (cantidad de merma).
        const convertedRows = rows.map(r => {
            const itemShortId = String(r.WAITM).trim();
            const code = String(r.ILRCD || '').trim();
            const fromUom = r.ILTRUM ? String(r.ILTRUM).trim() : '';
            const targetUom = primaries.get(itemShortId) || fromUom || 'EA';
            const rawMerma = r.MERMA_RAW || 0;
            const mermaVal = rawMerma / 100.0;
            let finalMerma = mermaVal;
            if (fromUom && fromUom !== targetUom) {
                const factor = getConversionFactor(itemShortId, fromUom, targetUom);
                if (factor !== null) finalMerma = mermaVal * factor;
            }
            return {
                itemShortId,
                article: r.WAAITM != null ? String(r.WAAITM).trim() : '',
                articleDesc: r.IMDSC1 != null ? String(r.IMDSC1).trim() : '',
                code,
                qty: Math.abs(finalMerma),
                unit: targetUom,
            };
        });

        // Descripciones de códigos desde F0005 (solo los que aparecen en el resultado)
        const codesPresent = Array.from(new Set(convertedRows.map(r => r.code)));
        const descByCode = new Map<string, string>();
        if (codesPresent.length > 0) {
            const codeBinds: any = {};
            codesPresent.forEach((c, i) => { codeBinds[`c${i}`] = c; });
            const codeSql = `
                SELECT TRIM(DRKY) as CODE, TRIM(DRDL01) as DESCRIPTION
                FROM prodctl.f0005
                WHERE TRIM(DRSY) = '42'
                  AND TRIM(DRRT) = 'RC'
                  AND TRIM(DRKY) IN (${codesPresent.map((_, i) => `:c${i}`).join(',')})
            `;
            const codeResult = await conn.execute(codeSql, codeBinds);
            (codeResult.rows as any[]).forEach(r => {
                descByCode.set(String(r.CODE).trim(), String(r.DESCRIPTION || '').trim());
            });
        }

        const groupOf = (code: string): 'Q' | 'P' | 'O' => {
            if (code.startsWith('Q')) return 'Q';
            if (code.startsWith('P')) return 'P';
            return 'O';
        };

        if (mode === 'matrix') {
            // Formato largo: una entrada por (artículo, código)
            const matrixMap = new Map<string, any>();
            for (const r of convertedRows) {
                const key = `${r.article}||${r.code}`;
                if (!matrixMap.has(key)) {
                    matrixMap.set(key, {
                        article: r.article,
                        articleDesc: r.articleDesc,
                        code: r.code,
                        description: descByCode.get(r.code) || '',
                        group: groupOf(r.code),
                        qty: 0,
                    });
                }
                matrixMap.get(key).qty += r.qty;
            }
            const items = Array.from(matrixMap.values())
                .filter(it => it.qty > 0)
                .sort((a, b) => a.article.localeCompare(b.article) || b.qty - a.qty);
            return NextResponse.json({ mode, items });
        }

        // Modos 'global' y 'row': agregamos por código
        const codeMap = new Map<string, any>();
        for (const r of convertedRows) {
            if (!codeMap.has(r.code)) {
                codeMap.set(r.code, {
                    code: r.code,
                    description: descByCode.get(r.code) || '',
                    group: groupOf(r.code),
                    qty: 0,
                });
            }
            codeMap.get(r.code).qty += r.qty;
        }
        const codes = Array.from(codeMap.values()).filter(it => it.qty > 0);
        const total = codes.reduce((s, c) => s + c.qty, 0);
        const codesWithPercent = codes
            .map(c => ({
                ...c,
                percent: total > 0 ? Math.round((c.qty / total) * 10000) / 100 : 0,
            }))
            .sort((a, b) => {
                if (a.group !== b.group) return a.group.localeCompare(b.group);
                return b.qty - a.qty;
            });

        return NextResponse.json({ mode, codes: codesWithPercent, total });
    } catch (err: any) {
        console.error('Merma Breakdown Error:', err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    } finally {
        if (conn) {
            try { await conn.close(); } catch (e) { console.error(e); }
        }
    }
}

function emptyPayload(mode: Mode) {
    if (mode === 'matrix') return { mode, items: [] };
    return { mode, codes: [], total: 0 };
}
