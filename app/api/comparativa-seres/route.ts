import { NextRequest, NextResponse } from 'next/server';
import { getDbConnection } from '@/lib/db';
import { getDayOfYear } from 'date-fns';
import https from 'https';
import { requireScreenAccess } from '@/lib/permissions';
import { getDb } from '@/lib/sqlite';
import { verifySession } from '@/lib/auth';

// --- Helpers SERES ---

interface ReqOptions {
    hostname: string;
    path: string;
    method: string;
    headers: Record<string, string | number>;
}

interface ReqResponse {
    status: number;
    headers: Record<string, string | string[]>;
    body: string;
}

function httpsReq(options: ReqOptions, postData?: string): Promise<ReqResponse> {
    return new Promise((resolve, reject) => {
        const r = https.request(options, (res) => {
            const chunks: Buffer[] = [];
            res.on('data', (c: Buffer) => chunks.push(c));
            res.on('end', () => resolve({
                status: res.statusCode ?? 0,
                headers: res.headers as Record<string, string | string[]>,
                body: Buffer.concat(chunks).toString('utf8'),
            }));
        });
        r.on('error', reject);
        if (postData) r.write(postData);
        r.end();
    });
}

function parseCookies(hdrs: Record<string, string | string[]>): string[] {
    const raw = hdrs['set-cookie'];
    const arr = Array.isArray(raw) ? raw : (raw ? [raw] : []);
    return arr.map((c: string) => c.split(';')[0]).filter(Boolean);
}

function formatDate(d: Date): string {
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}/${d.getFullYear()}`;
}

function buildForm(pageNumber: number, dateFrom: string, dateTo: string): string {
    return [
        `pageNumber=${pageNumber}`,
        'inputOrder.field=', 'inputOrder.direction=',
        'inputFolder.idFolder=REC',
        'inputFilter.idFilter=', 'inputFilter.idFolder=REC',
        'inputFilter.fieldList[0].idField=1000', 'inputFilter.fieldList[0].operator=', 'inputFilter.fieldList[0].value=', 'inputFilter.fieldList[0].maxValue=',
        'inputFilter.fieldList[1].idField=1001', 'inputFilter.fieldList[1].operator=', 'inputFilter.fieldList[1].value=', 'inputFilter.fieldList[1].maxValue=',
        'inputFilter.fieldList[2].idField=1002', 'inputFilter.fieldList[2].operator=', 'inputFilter.fieldList[2].value=', 'inputFilter.fieldList[2].maxValue=',
        'inputFilter.fieldList[3].idField=1003', 'inputFilter.fieldList[3].operator=',
        `inputFilter.fieldList[3].value=${encodeURIComponent(dateFrom)}`,
        `inputFilter.fieldList[3].maxValue=${encodeURIComponent(dateTo)}`,
        'inputFilter.fieldList[4].idField=1004', 'inputFilter.fieldList[4].operator=', 'inputFilter.fieldList[4].value=', 'inputFilter.fieldList[4].maxValue=',
        'inputFilter.fieldList[5].idField=1006', 'inputFilter.fieldList[5].operator=', 'inputFilter.fieldList[5].value=', 'inputFilter.fieldList[5].maxValue=',
        'inputFilter.fieldList[6].idField=1401', 'inputFilter.fieldList[6].operator=', 'inputFilter.fieldList[6].value=', 'inputFilter.fieldList[6].maxValue=',
        'inputFilter.fieldList[7].idField=1011', 'inputFilter.fieldList[7].operator=', 'inputFilter.fieldList[7].value=', 'inputFilter.fieldList[7].maxValue=',
        'inputFilter.fieldList[8].idField=1305', 'inputFilter.fieldList[8].operator=', 'inputFilter.fieldList[8].value=', 'inputFilter.fieldList[8].maxValue=',
        'inputFilter.fieldList[9].idField=1007', 'inputFilter.fieldList[9].operator=', 'inputFilter.fieldList[9].value=', 'inputFilter.fieldList[9].maxValue=',
        'inputFilter.fieldList[10].idField=1005', 'inputFilter.fieldList[10].operator=', 'inputFilter.fieldList[10].value=', 'inputFilter.fieldList[10].maxValue=',
        'pageSize=12',
    ].join('&');
}

export interface PedidoSeres {
    referencia: string;
    fecha: string;
    hora: string;
    tipo: string;
    clienteCodigo: string;
    clienteNombre: string;
}

export interface PedidoJde {
    referencia: string;
    fecha: string | null;
    shanNum: number | null;
    shanDesc: string | null;
    shanMlnm: string | null;
    urabNum: number | null;
    urabDesc: string | null;
    // Estado del pedido EDI en JDE (F47011.SYEDSP):
    //   Y = Procesado correctamente (pedido creado)
    //   M = Modificado (la referencia llegó dos veces)
    //   N = Sin procesar (el report de JDE aún no ha intentado crearlo)
    //   E = Error (no ha podido crear el pedido)
    // Cualquier valor distinto de Y se considera incidencia.
    estado: string | null;
}

// Descripción legible de cada código SYEDSP. Centralizado aquí para que
// frontend y Excel usen el mismo texto.
export const ESTADO_LABEL: Record<string, string> = {
    Y: 'Procesado',
    M: 'Modificado (duplicado)',
    N: 'Sin procesar',
    E: 'Error',
};
export function estadoLabel(code: string | null | undefined): string {
    if (!code) return 'Desconocido';
    return ESTADO_LABEL[code] || `Otro (${code})`;
}

// Scraping completo de SERES con paginación
async function fetchSeresPedidos(days: number): Promise<PedidoSeres[]> {
    const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
    const ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
    const PAGE_SIZE = 12;
    const MAX_PAGES = 200;

    const today = new Date();
    const since = new Date(today);
    // Para "Hoy" (days=0) pedimos 1 día extra de margen porque SERES filtra por Fecha Doc.
    // y un pedido puede llegar hoy con Fecha Doc. de ayer. El filtro real se aplica abajo por Fecha Estado.
    if (days > 0) since.setDate(today.getDate() - days);
    else since.setDate(today.getDate() - 1);
    const dateFrom = formatDate(since);
    const todayStr = formatDate(today); // solo para filtro de "Hoy"
    // dateTo = mañana para que SERES incluya los documentos de hoy (límite superior exclusivo)
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    const dateTo = formatDate(tomorrow);

    // Paso 1: GET /web/login → JSESSIONID
    const s1 = await httpsReq({
        hostname: 'webconnect.seresnet.com', path: '/web/login', method: 'GET',
        headers: { 'User-Agent': UA, 'Accept': ACCEPT },
    });
    let cookies = parseCookies(s1.headers);

    // Paso 2: POST /login-captcha
    const username = process.env.SERES_USERNAME ?? '';
    const password = process.env.SERES_PASSWORD ?? '';
    const loginBody = `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
    const s2 = await httpsReq({
        hostname: 'webconnect.seresnet.com', path: '/login-captcha', method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(loginBody),
            'Cookie': cookies.join('; '),
            'Referer': 'https://webconnect.seresnet.com/web/login',
            'Origin': 'https://webconnect.seresnet.com',
            'User-Agent': UA, 'Accept': ACCEPT,
        },
    }, loginBody);
    cookies = [...new Set([...cookies, ...parseCookies(s2.headers)])];

    // Paso 3: seguir redirect
    let redirectPath = (s2.headers['location'] as string) || '/web/controlPanel';
    if (redirectPath.startsWith('http')) {
        try { redirectPath = new URL(redirectPath).pathname + new URL(redirectPath).search; } catch { }
    }
    const s3 = await httpsReq({
        hostname: 'webconnect.seresnet.com', path: redirectPath, method: 'GET',
        headers: { 'Cookie': cookies.join('; '), 'User-Agent': UA, 'Accept': ACCEPT },
    });
    cookies = [...new Set([...cookies, ...parseCookies(s3.headers)])];

    // Paso 4: bucle de paginación — POST /web/documentList
    const docHeaders: Record<string, string | number> = {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cookie': cookies.join('; '),
        'Referer': 'https://webconnect.seresnet.com/web/documentList',
        'Origin': 'https://webconnect.seresnet.com',
        'User-Agent': UA, 'Accept': ACCEPT,
    };

    const isDateTime = (v: string) => /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}$/.test(v);
    const tdRegex = /style="cursor: pointer;">([^<]+)<\/td>/g;

    const allPedidos: PedidoSeres[] = [];
    const seen = new Set<string>();
    let pageNumber = 1;
    let keepFetching = true;

    while (keepFetching && pageNumber <= MAX_PAGES) {
        const formBody = buildForm(pageNumber, dateFrom, dateTo);
        const pageResp = await httpsReq({
            hostname: 'webconnect.seresnet.com', path: '/web/documentList', method: 'POST',
            headers: { ...docHeaders, 'Content-Length': Buffer.byteLength(formBody) },
        }, formBody);

        const vals: string[] = [];
        let m: RegExpExecArray | null;
        tdRegex.lastIndex = 0;
        while ((m = tdRegex.exec(pageResp.body)) !== null) vals.push(m[1].trim());

        let rowsOnPage = 0;
        for (let i = 0; i < vals.length - 6; i++) {
            if (isDateTime(vals[i])) {
                rowsOnPage++;
                const tipo = vals[i + 6] || '';
                // Filtramos aquí, antes del seen, para que los Albaranes no bloqueen
                // la referencia del Pedido relacionado en el set de deduplicación
                if (tipo !== 'Pedido') continue;
                // Para "Hoy" filtramos por Fecha Estado (vals[i]) en lugar de Fecha Doc.
                if (days === 0 && vals[i].split(' ')[0] !== todayStr) continue;
                const ref = vals[i + 4];
                if (ref && !seen.has(ref)) {
                    seen.add(ref);
                    const [datePart, timePart] = vals[i].split(' ');
                    const parts = datePart.split('/');
                    allPedidos.push({
                        referencia: ref,
                        fecha: `${parts[2]}-${parts[1]}-${parts[0]}`,
                        hora: timePart || '',
                        tipo,
                        clienteCodigo: vals[i + 2] || '',
                        clienteNombre: vals[i + 3] || '',
                    });
                }
            }
        }

        if (rowsOnPage < PAGE_SIZE) keepFetching = false;
        else pageNumber++;
    }

    return allPedidos;
}

// Consulta JDE F47011
async function fetchJdePedidos(days: number): Promise<PedidoJde[]> {
    const since = new Date();
    if (days > 0) since.setDate(since.getDate() - days);
    // Para "Hoy" (days=0) pedimos 1 día extra de margen, simétrico a SERES.
    // Motivo: un pedido reprocesado HOY en SERES conserva su Fecha Documento original
    // (ayer). Cuando SERES lo re-envía a JDE, JDE lo guarda con SYTRDJ = ayer.
    // Si pedimos sólo SYTRDJ >= hoy se nos quedaría fuera y aparecería como
    // falso positivo en "Solo en SERES". La asimetría se corrige aquí.
    // Los pedidos REALES de ayer (no reprocesados hoy) que entren en este rango
    // ampliado se filtran después en el handler GET — ver "filtrado days=0".
    else since.setDate(since.getDate() - 1);
    const sinceJde = 100000 + (since.getFullYear() - 2000) * 1000 + getDayOfYear(since);

    let conn;
    try {
        conn = await getDbConnection();
        const result = await conn.execute(
            `SELECT TRIM(A.SYVR01) AS REFERENCIA,
                    A.SYTRDJ      AS FECHA_JDE,
                    A.SYSHAN      AS SHAN_NUM,
                    TRIM(B.ABALPH) AS SHAN_DESC,
                    TRIM(D.WWMLNM) AS SHAN_MLNM,
                    A.SYURAB      AS URAB_NUM,
                    TRIM(C.ABALPH) AS URAB_DESC,
                    TRIM(A.SYEDSP) AS ESTADO
             FROM F47011 A
             LEFT JOIN F0101 B ON B.ABAN8 = A.SYSHAN
             LEFT JOIN F0101 C ON C.ABAN8 = A.SYURAB
             LEFT JOIN (SELECT WWAN8, MIN(TRIM(WWMLNM)) AS WWMLNM FROM F0111 GROUP BY WWAN8) D ON D.WWAN8 = A.SYSHAN
             WHERE A.SYTRDJ >= :fechaDesde
               AND TRIM(A.SYVR01) IS NOT NULL
             ORDER BY A.SYTRDJ DESC`,
            { fechaDesde: sinceJde }
        );
        return (result.rows as any[]).map(row => {
            const dateStr = String(row.FECHA_JDE || '0').padStart(6, '0');
            const yearShort = parseInt(dateStr.substring(1, 3), 10);
            const dayOfYear = parseInt(dateStr.substring(3), 10);
            const date = new Date(Date.UTC(2000 + yearShort, 0, dayOfYear));
            return {
                referencia: String(row.REFERENCIA).trim(),
                fecha: dayOfYear > 0 ? date.toISOString().split('T')[0] : null,
                shanNum: row.SHAN_NUM ?? null,
                shanDesc: row.SHAN_DESC ? String(row.SHAN_DESC).trim() : null,
                shanMlnm: row.SHAN_MLNM ? String(row.SHAN_MLNM).trim() : null,
                urabNum: row.URAB_NUM ?? null,
                urabDesc: row.URAB_DESC ? String(row.URAB_DESC).trim() : null,
                estado: row.ESTADO ? String(row.ESTADO).trim() : null,
            };
        });
    } finally {
        if (conn) { try { await conn.close(); } catch (e) { console.error(e); } }
    }
}

// --- Handler ---

export async function GET(req: NextRequest) {
    const denied = await requireScreenAccess('comparativa')
    if (denied) return denied
    const startTime = Date.now();
    const { searchParams } = new URL(req.url);
    const days = Math.min(Math.max(parseInt(searchParams.get('days') || '7', 10), 0), 90);

    try {
        // Lanzar SERES y JDE en paralelo
        const [seresResult, jdeResult] = await Promise.all([
            fetchSeresPedidos(days),
            fetchJdePedidos(days),
        ]);

        // fetchSeresPedidos ya devuelve solo Pedidos (filtro aplicado en el bucle)
        const seresPedidos = seresResult;

        const jdeRefs = new Set(jdeResult.map(p => p.referencia.toUpperCase()));
        const seresRefs = new Set(seresPedidos.map(p => p.referencia.toUpperCase()));
        // Mapa JDE por referencia para enriquecer "en_ambos" con campos de destino/comprador
        const jdeByRef = new Map(jdeResult.map(p => [p.referencia.toUpperCase(), p]));

        const soloEnSeres = seresPedidos.filter(p => !jdeRefs.has(p.referencia.toUpperCase()));

        // Filtrado days=0: cuando ampliamos el rango JDE a ayer (ver fetchJdePedidos),
        // los pedidos REALES de ayer no reprocesados hoy NO deben aparecer como
        // "Solo en JDE" (SERES con days=0 los descarta y crearían falsos positivos).
        // Los conservamos en jdeResult / enAmbos por si machean con un row SERES de
        // hoy (caso reproceso), pero los excluimos de soloEnJde si SYTRDJ < hoy.
        const todayIso = new Date().toISOString().split('T')[0];
        const soloEnJdeRaw = jdeResult.filter(p => !seresRefs.has(p.referencia.toUpperCase()));
        const soloEnJde = days === 0
            ? soloEnJdeRaw.filter(p => !p.fecha || p.fecha >= todayIso)
            : soloEnJdeRaw;

        const enAmbos = seresPedidos
            .filter(p => jdeRefs.has(p.referencia.toUpperCase()))
            .map(p => {
                const jde = jdeByRef.get(p.referencia.toUpperCase());
                return {
                    ...p,
                    shanNum: jde?.shanNum ?? null,
                    shanDesc: jde?.shanDesc ?? null,
                    shanMlnm: jde?.shanMlnm ?? null,
                    urabNum: jde?.urabNum ?? null,
                    urabDesc: jde?.urabDesc ?? null,
                    estado: jde?.estado ?? null,
                };
            });

        // Pestaña "Incidencias": todos los pedidos JDE con estado distinto de 'Y'
        // (independientemente de si están o no en SERES). Sirve como vista
        // ejecutiva: aquí está todo lo que requiere acción.
        const incidencias = jdeResult.filter(p => p.estado !== 'Y');

        const resultCount = soloEnSeres.length + soloEnJde.length + enAmbos.length;

        // Registrar consulta en logs
        try {
            const user = await verifySession().catch(() => null);
            const db = getDb();
            db.prepare(
                'INSERT INTO query_logs (user_id, username, source, filters, result_count, execution_time_ms) VALUES (?, ?, ?, ?, ?, ?)'
            ).run(
                user?.id ?? null,
                user ? user.username : 'Invitado',
                'comparativa_seres',
                JSON.stringify({ days }),
                resultCount,
                Date.now() - startTime
            );
        } catch (logErr) {
            console.error('Error logging query:', logErr);
        }

        // Conteo de incidencias desglosado por estado (útil para tooltip o futuras métricas)
        const incidenciasByEstado: Record<string, number> = {};
        for (const p of incidencias) {
            const k = p.estado || '(sin estado)';
            incidenciasByEstado[k] = (incidenciasByEstado[k] || 0) + 1;
        }

        return NextResponse.json({
            resumen: {
                total_seres_todos: seresResult.length,
                total_seres_pedidos: seresPedidos.length,
                total_jde: jdeResult.length,
                solo_en_seres: soloEnSeres.length,
                solo_en_jde: soloEnJde.length,
                en_ambos: enAmbos.length,
                incidencias: incidencias.length,
                incidencias_por_estado: incidenciasByEstado,
                days,
            },
            solo_en_seres: soloEnSeres,
            solo_en_jde: soloEnJde,
            en_ambos: enAmbos,
            incidencias,
        });

    } catch (err: any) {
        console.error('Error /api/comparativa-seres:', err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
