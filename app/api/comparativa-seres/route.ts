import { NextRequest, NextResponse } from 'next/server';
import { getDbConnection } from '@/lib/db';
import { getDayOfYear } from 'date-fns';
import { parseJdeDate } from '@/lib/utils';
import { verifySession } from '@/lib/auth';
import https from 'https';

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
    tipo: string;
}

export interface PedidoJde {
    referencia: string;
    fecha: string | null;
}

// Scraping completo de SERES con paginación
async function fetchSeresPedidos(days: number): Promise<PedidoSeres[]> {
    const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
    const ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
    const PAGE_SIZE = 12;
    const MAX_PAGES = 200;

    const today = new Date();
    const since = new Date(today);
    since.setDate(today.getDate() - days);
    const dateFrom = formatDate(since);
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
                const ref = vals[i + 4];
                const tipo = vals[i + 6] || '';
                if (ref && !seen.has(ref)) {
                    seen.add(ref);
                    const parts = vals[i].split(' ')[0].split('/');
                    allPedidos.push({
                        referencia: ref,
                        fecha: `${parts[2]}-${parts[1]}-${parts[0]}`,
                        tipo,
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
    since.setDate(since.getDate() - days);
    const sinceJde = 100000 + (since.getFullYear() - 2000) * 1000 + getDayOfYear(since);

    let conn;
    try {
        conn = await getDbConnection();
        const result = await conn.execute(
            `SELECT TRIM(SYVR01) AS REFERENCIA, SYUPMJ AS FECHA_JDE
             FROM F47011
             WHERE SYUPMJ >= :fechaDesde
               AND TRIM(SYVR01) IS NOT NULL
             ORDER BY SYUPMJ DESC`,
            { fechaDesde: sinceJde }
        );
        return (result.rows as any[]).map(row => {
            const parsed = parseJdeDate(row.FECHA_JDE);
            return {
                referencia: String(row.REFERENCIA).trim(),
                fecha: parsed ? parsed.date.toISOString().split('T')[0] : null,
            };
        });
    } finally {
        if (conn) { try { await conn.close(); } catch (e) { console.error(e); } }
    }
}

// --- Handler ---

export async function GET(req: NextRequest) {
    // Requiere sesión activa
    const session = await verifySession();
    if (!session) {
        return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const days = Math.min(Math.max(parseInt(searchParams.get('days') || '7', 10), 1), 90);

    try {
        // Lanzar SERES y JDE en paralelo
        const [seresResult, jdeResult] = await Promise.all([
            fetchSeresPedidos(days),
            fetchJdePedidos(days),
        ]);

        // Comparar tipo "Pedido" y "Albarán" de SERES contra JDE
        const seresPedidos = seresResult.filter(p =>
            p.tipo === 'Pedido' || p.tipo.toLowerCase().startsWith('albar')
        );

        const jdeRefs = new Set(jdeResult.map(p => p.referencia.toUpperCase()));
        const seresRefs = new Set(seresPedidos.map(p => p.referencia.toUpperCase()));

        const soloEnSeres = seresPedidos.filter(p => !jdeRefs.has(p.referencia.toUpperCase()));
        const soloEnJde = jdeResult.filter(p => !seresRefs.has(p.referencia.toUpperCase()));
        const enAmbos = seresPedidos.filter(p => jdeRefs.has(p.referencia.toUpperCase()));

        return NextResponse.json({
            resumen: {
                total_seres_todos: seresResult.length,
                total_seres_pedidos: seresPedidos.length,
                total_jde: jdeResult.length,
                solo_en_seres: soloEnSeres.length,
                solo_en_jde: soloEnJde.length,
                en_ambos: enAmbos.length,
                days,
            },
            solo_en_seres: soloEnSeres,
            solo_en_jde: soloEnJde,
            en_ambos: enAmbos,
        });

    } catch (err: any) {
        console.error('Error /api/comparativa-seres:', err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
