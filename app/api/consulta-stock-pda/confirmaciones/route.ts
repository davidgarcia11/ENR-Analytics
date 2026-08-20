import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/sqlite';
import { verifySession } from '@/lib/auth';
import { requireScreenAccess } from '@/lib/permissions';

// SSCC de palet: siempre 18 dígitos (AI 00 de GS1-128, ver lib/gs1.ts)
const SSCC_REGEX = /^\d{18}$/;
const ESTADOS_VALIDOS = ['correcto', 'aviso', 'no_encontrado', 'sin_fecha', 'otra_subplanta'];

// Registra que un operario ha aceptado el pop-up mostrado al escanear un SSCC, con el
// mensaje exacto que vio. Trazabilidad, no bloquea el flujo de escaneo si falla.
export async function POST(req: NextRequest) {
    const denied = await requireScreenAccess('consulta_stock_pda');
    if (denied) return denied;

    const { sscc, articulo, estado, mensajes } = await req.json();

    if (!sscc || !SSCC_REGEX.test(sscc)) {
        return NextResponse.json({ error: 'SSCC inválido' }, { status: 400 });
    }
    if (!ESTADOS_VALIDOS.includes(estado)) {
        return NextResponse.json({ error: 'Estado inválido' }, { status: 400 });
    }
    if (!Array.isArray(mensajes) || mensajes.length === 0 || !mensajes.every(m => typeof m === 'string')) {
        return NextResponse.json({ error: 'Mensajes inválidos' }, { status: 400 });
    }

    try {
        const user = await verifySession().catch(() => null);
        const db = getDb();
        db.prepare(
            'INSERT INTO stock_scan_confirmations (user_id, username, sscc, articulo, estado, mensajes) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(
            user?.id ?? null,
            user ? user.username : 'Invitado',
            sscc,
            typeof articulo === 'string' ? articulo : null,
            estado,
            JSON.stringify(mensajes)
        );
        return NextResponse.json({ ok: true });
    } catch (err: any) {
        console.error('Error registrando confirmación de escaneo:', err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
