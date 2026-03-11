import { NextRequest, NextResponse } from 'next/server';
import { getDbConnection } from '@/lib/db';
import { getDayOfYear } from 'date-fns';
import { getDb } from '@/lib/sqlite';
import { verifySession } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const startTime = Date.now();
  const { searchParams } = new URL(req.url);

  const plant = searchParams.get('plant');
  const startDateStr = searchParams.get('startDate');
  const endDateStr = searchParams.get('endDate');
  const deliveryStartStr = searchParams.get('deliveryStartDate');
  const deliveryEndStr = searchParams.get('deliveryEndDate');

  let conn;
  try {
    conn = await getDbConnection();

    // Cargar nombres de planta desde Oracle
    const plantResult = await conn.execute(
      `SELECT TRIM(MCMCU) AS PLANT_CODE, TRIM(MCDL01) AS PLANT_NAME FROM F0006 WHERE MCSTYL = 'BP'`
    );
    const plantNames: Record<string, string> = {};
    for (const r of plantResult.rows as any[]) {
      plantNames[String(r.PLANT_CODE || '').trim()] = String(r.PLANT_NAME || '').trim();
    }

    let sql = `
      SELECT SDDOCO, SDPDDJ, SDRSDJ, TRIM(SDMCU) AS SDMCU,
             SDITM, TRIM(SDAITM) AS SDAITM, TRIM(SDDSC1) AS SDDSC1,
             SDUORG, SDSOQS, SDSOBK, SDSOCN,
             TRIM(SDUOM) AS SDUOM, TRIM(SDLOTN) AS SDLOTN, SDLNID
      FROM F4211
      WHERE SDNXTR != 999
    `;
    const binds: any = {};

    if (plant && plant !== 'all') {
      sql += ` AND TRIM(SDMCU) = :plant`;
      binds.plant = plant;
    }

    if (startDateStr && endDateStr) {
      const start = new Date(startDateStr);
      const end = new Date(endDateStr);

      if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
        const startYY = start.getFullYear() - 2000;
        const startDDD = getDayOfYear(start);
        const startJde = (1 * 100000) + (startYY * 1000) + startDDD;

        const endYY = end.getFullYear() - 2000;
        const endDDD = getDayOfYear(end);
        const endJde = (1 * 100000) + (endYY * 1000) + endDDD;

        sql += ` AND SDPDDJ BETWEEN :startJde AND :endJde`;
        binds.startJde = startJde;
        binds.endJde = endJde;
      }
    }

    if (deliveryStartStr && deliveryEndStr) {
      const dStart = new Date(deliveryStartStr);
      const dEnd = new Date(deliveryEndStr);

      if (!isNaN(dStart.getTime()) && !isNaN(dEnd.getTime())) {
        const dStartYY = dStart.getFullYear() - 2000;
        const dStartDDD = getDayOfYear(dStart);
        const dStartJde = (1 * 100000) + (dStartYY * 1000) + dStartDDD;

        const dEndYY = dEnd.getFullYear() - 2000;
        const dEndDDD = getDayOfYear(dEnd);
        const dEndJde = (1 * 100000) + (dEndYY * 1000) + dEndDDD;

        sql += ` AND SDRSDJ BETWEEN :delStartJde AND :delEndJde`;
        binds.delStartJde = dStartJde;
        binds.delEndJde = dEndJde;
      }
    }

    sql += ` ORDER BY SDDOCO, SDITM`;

    const result = await conn.execute(sql, binds);
    const rows = result.rows as any[];

    // Agrupar por pedido (SDDOCO)
    const orderMap = new Map<number, any>();

    for (const row of rows) {
      const doco = row.SDDOCO;

      if (!orderMap.has(doco)) {
        // Parsear fecha JDE (CYYDDD)
        const dateStr = String(row.SDPDDJ).padStart(6, '0');
        const yearShort = parseInt(dateStr.substring(1, 3), 10);
        const dayOfYearVal = parseInt(dateStr.substring(3), 10);
        const fullYear = 2000 + yearShort;
        const date = new Date(fullYear, 0, dayOfYearVal);

        // Parsear fecha entrega (SDRSDJ)
        const delDateStr = String(row.SDRSDJ || '0').padStart(6, '0');
        const delYearShort = parseInt(delDateStr.substring(1, 3), 10);
        const delDayOfYear = parseInt(delDateStr.substring(3), 10);
        const delFullYear = 2000 + delYearShort;
        const deliveryDate = new Date(delFullYear, 0, delDayOfYear);

        const plantCode = String(row.SDMCU || '').trim();

        orderMap.set(doco, {
          orderNumber: doco,
          loadDate: date.toISOString(),
          deliveryDate: deliveryDate.toISOString(),
          plant: plantCode,
          plantName: plantNames[plantCode] || plantCode,
          lines: [],
          totalLines: 0,
          overallProgress: 0,
          status: 'pendiente',
        });
      }

      const order = orderMap.get(doco)!;
      const itemNumber = String(row.SDAITM || row.SDITM || '').trim();
      const qtyOrdered = (row.SDUORG || 0) / 100;
      const lot = String(row.SDLOTN || '').trim();
      const hasLot = lot.length > 0;

      // Agrupar por artículo (SDAITM) dentro del pedido
      if (!order.articleMap) order.articleMap = new Map();
      if (!order.articleMap.has(itemNumber)) {
        order.articleMap.set(itemNumber, {
          itemNumber,
          description: String(row.SDDSC1 || '').trim(),
          totalOrdered: 0,
          totalAssigned: 0,
          totalPending: 0,
          uom: String(row.SDUOM || '').trim(),
          progress: 0,
          lots: [],
        });
      }

      const article = order.articleMap.get(itemNumber)!;
      article.totalOrdered += qtyOrdered;
      if (hasLot) {
        article.totalAssigned += qtyOrdered;
      } else {
        article.totalPending += qtyOrdered;
      }

      article.lots.push({
        lineNumber: row.SDLNID,
        qtyOrdered,
        lot,
        assigned: hasLot,
      });
    }

    // Calcular progreso y construir respuesta
    const orders: any[] = [];
    let completados = 0;
    let enProgreso = 0;
    let pendientes = 0;

    orderMap.forEach(order => {
      // Convertir articleMap a array y calcular progreso por artículo
      const articles = Array.from(order.articleMap.values()).map((a: any) => {
        a.progress = a.totalOrdered > 0
          ? Math.round(Math.min(100, (a.totalAssigned / a.totalOrdered) * 100) * 100) / 100
          : 0;
        return a;
      });

      order.articles = articles;
      order.totalArticles = articles.length;
      delete order.articleMap;

      const totalOrdered = articles.reduce((s: number, a: any) => s + a.totalOrdered, 0);
      const totalAssigned = articles.reduce((s: number, a: any) => s + a.totalAssigned, 0);
      order.overallProgress = totalOrdered > 0
        ? Math.round(Math.min(100, (totalAssigned / totalOrdered) * 100) * 100) / 100
        : 0;

      const allComplete = articles.every((a: any) => a.totalAssigned >= a.totalOrdered && a.totalOrdered > 0);
      const anyAssigned = articles.some((a: any) => a.totalAssigned > 0);
      order.status = allComplete ? 'completado' : anyAssigned ? 'en_progreso' : 'pendiente';

      if (order.status === 'completado') completados++;
      else if (order.status === 'en_progreso') enProgreso++;
      else pendientes++;

      orders.push(order);
    });

    const summary = {
      totalOrders: orders.length,
      completados,
      enProgreso,
      pendientes,
    };

    // Registrar consulta en logs
    try {
      const user = await verifySession().catch(() => null);
      const filters = { plant, startDate: startDateStr, endDate: endDateStr, deliveryStartDate: deliveryStartStr, deliveryEndDate: deliveryEndStr };
      const db = getDb();
      db.prepare(
        'INSERT INTO query_logs (user_id, username, source, filters, result_count, execution_time_ms) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(
        user?.id ?? null,
        user ? user.username : 'Invitado',
        'pedidos',
        JSON.stringify(filters),
        orders.length,
        Date.now() - startTime
      );
    } catch (logErr) {
      console.error('Error logging query:', logErr);
    }

    return NextResponse.json({ orders, summary });

  } catch (err: any) {
    console.error("Database Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  } finally {
    if (conn) {
      try {
        await conn.close();
      } catch (e) {
        console.error(e);
      }
    }
  }
}
