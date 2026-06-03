import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/sqlite';

// PUT /api/admin/jde-statuses/:code
// Actualiza la descripción de un código de estado JDE existente.
// No permite crear ni borrar códigos: los 4 (Y, M, N, E) están sembrados
// por la migración. Solo se edita el texto descriptivo.
// Pasa por middleware.ts que ya valida rol admin para /api/admin/*.
export async function PUT(
    req: NextRequest,
    { params }: { params: Promise<{ code: string }> }
) {
    const { code } = await params;
    if (!code) {
        return NextResponse.json({ error: 'Código requerido' }, { status: 400 });
    }

    let body: { description?: string };
    try {
        body = await req.json();
    } catch {
        return NextResponse.json({ error: 'Body JSON inválido' }, { status: 400 });
    }

    const description = (body.description ?? '').trim();
    if (!description) {
        return NextResponse.json({ error: 'La descripción no puede estar vacía' }, { status: 400 });
    }

    try {
        const db = getDb();
        // Validar que el código existe — no permitimos crear nuevos por aquí
        const existing = db.prepare('SELECT code FROM jde_status_descriptions WHERE code = ?').get(code) as { code: string } | undefined;
        if (!existing) {
            return NextResponse.json({ error: `Código ${code} no existe` }, { status: 404 });
        }
        db.prepare(
            "UPDATE jde_status_descriptions SET description = ?, updated_at = datetime('now') WHERE code = ?"
        ).run(description, code);
        return NextResponse.json({ ok: true, code, description });
    } catch (err: any) {
        console.error('Error PUT /api/admin/jde-statuses/[code]:', err);
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
