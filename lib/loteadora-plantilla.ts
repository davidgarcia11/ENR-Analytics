// Modelo de plantilla de la loteadora: una plantilla (mensaje de la máquina) tiene
// varios CAMPOS — uno por Field Module de la máquina, identificado por su ID de
// datos — y cada campo es una secuencia ordenada de PIEZAS que se concatenan para
// formar el texto que se le envía:
//
//   Campo ID 1 = [texto "L"] [cocida AAJJJ] [turno]   → "L263641"
//   Campo ID 3 = [texto "CAD "] [caducidad DD/MM/AA]   → "CAD 06/01/27"
//   Campo ID 4 = [caducidad DD/MM/AA] [texto "  "] [dato fijo "Precio"]
//
// Así los literales ("L", "CAD ", "EXP: "...) los manda el sistema en vez de
// dibujarlos a mano en la máquina, y cada cliente puede tener su propio formato.
// Ver docs/loteadora.md §13.
//
// Sin dependencias de servidor a propósito: lo usan el envío
// (app/api/loteadora/enviar), la vista previa de /loteadora y el constructor de
// plantillas de /admin. Las funciones de BD reciben la conexión por parámetro.
import type Database from 'better-sqlite3';

export const TIPOS_PIEZA = ['texto', 'fijo', 'fresco', 'cocida', 'caducidad', 'turno', 'hora', 'linea', 'manual'] as const;
export type TipoPieza = (typeof TIPOS_PIEZA)[number];
export type TipoVariable = Exclude<TipoPieza, 'texto' | 'fijo'>;

// 'DD' = solo el día (p. ej. el día anterior a la caducidad en otro campo: "24").
export const FORMATOS_CADUCIDAD = ['DD/MM/AA', 'DD/MM/AAAA', 'MM/DD/AA', 'MM/DD/AAAA', 'DD'] as const;
// La cocida también puede imprimirse como fecha ("PROD: 21/09/26").
export const FORMATOS_COCIDA = ['AAJJJ', 'AJJJ', 'JJJ', ...FORMATOS_CADUCIDAD] as const;

export interface Pieza {
  tipo: TipoPieza;
  /** 'texto': el literal; 'fijo': el valor (precio, nº de certificado...);
   *  'caducidad': ajuste en días sobre la caducidad ("-1" = el día anterior) */
  valor?: string;
  /** 'fijo': nombre del dato, para editarlo sin tocar la plantilla ("Precio");
   *  'manual': lo que ve el operario en /loteadora ("Nº certificado Kosher").
   *  En 'manual', `valor` es el valor por defecto (opcional). */
  nombre?: string;
  /** 'caducidad' → FORMATOS_CADUCIDAD; 'cocida' → FORMATOS_COCIDA */
  formato?: string;
}

export interface Campo {
  /** ID de datos del Field Module en la máquina (0-255) */
  fieldId: number;
  piezas: Pieza[];
  /** Línea de la etiqueta (1-3) — solo para crear el mensaje en la máquina (1C) */
  linea?: number;
  /** Dejar detrás el hueco del reloj (HHmm), que se inserta a mano en la máquina */
  reloj?: boolean;
}

export const INFO_PIEZA: Record<TipoPieza, { label: string; ayuda: string }> = {
  texto: { label: 'Texto', ayuda: 'Literal que se imprime tal cual ("L", "CAD ", un espacio...)' },
  fijo: { label: 'Dato fijo', ayuda: 'Valor constante de la plantilla (precio, nº de certificado). Editable por quien tenga el permiso' },
  fresco: { label: 'Lote fresco', ayuda: 'Lo que escribe el operario en "Lote Fresco", tal cual' },
  cocida: { label: 'Cocida', ayuda: 'Lo que escribe el operario en "Juliano Cocida" (día juliano), con su año: como AAJJJ, AJJJ, JJJ o como fecha' },
  caducidad: { label: 'Caducidad', ayuda: 'Cocida + días de caducidad' },
  turno: { label: 'Turno', ayuda: 'Turno elegido en /loteadora (1, 2 o 3)' },
  hora: { label: 'Hora', ayuda: 'Hora del envío, HHmm' },
  linea: { label: 'Línea', ayuda: 'Línea de fabricación de la loteadora' },
  manual: { label: 'Dato a introducir', ayuda: 'Lo escribe el operario en /loteadora al enviar (p. ej. un nº de certificado que cambia). Obligatorio' },
};

// Máximo de caracteres de un dato a introducir: es lo que se reserva para él en
// el campo de la máquina al crear el mensaje (largoPieza).
export const MAX_MANUAL = 20;

/** Valores de una impresión concreta (los calcula /loteadora; la línea la pone el servidor). */
export interface ValoresEtiqueta {
  fresco?: string;
  cocidaAnio?: number;
  cocidaDia?: number;
  /** YYYY-MM-DD */
  caducidad?: string;
  /** HHmm */
  hora?: string;
  turno?: string;
  linea?: string;
  /** Datos a introducir, por nombre de la pieza ("Nº certificado Kosher" → "KSR-123") */
  manuales?: Record<string, string>;
}

// El comando 1D envía el texto en ASCII (lib/loteadora-printer.ts): un carácter
// fuera de ASCII imprimible llegaría a la máquina como basura.
export const ASCII_IMPRIMIBLE = /^[\x20-\x7E]*$/;

const dos = (n: number) => String(n).padStart(2, '0');

/** YYYY-MM-DD + n días (en UTC para que el cambio de hora no mueva el día). */
export function sumarDias(iso: string, dias: number): string {
  if (!dias) return iso;
  const [a, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}

export function formatearCaducidad(iso: string, formato: string = 'DD/MM/AAAA'): string {
  const [a, m, d] = iso.split('-');
  if (formato === 'DD') return d;
  const anio = formato.endsWith('AAAA') ? a : a.slice(-2);
  return formato.startsWith('MM') ? `${m}/${d}/${anio}` : `${d}/${m}/${anio}`;
}

export function formatearCocida(anio: number, dia: number, formato: string = 'AAJJJ'): string {
  if (formato.includes('/')) {
    // Día juliano → fecha (UTC para que no se mueva un día por la zona horaria)
    return formatearCaducidad(new Date(Date.UTC(anio, 0, dia)).toISOString().slice(0, 10), formato);
  }
  const jjj = String(dia).padStart(3, '0');
  if (formato === 'JJJ') return jjj;
  if (formato === 'AJJJ') return String(anio).slice(-1) + jjj;
  return String(anio).slice(-2) + jjj;
}

/** Texto de una pieza, o null si falta el valor que necesita. */
export function textoPieza(p: Pieza, v: ValoresEtiqueta): string | null {
  switch (p.tipo) {
    case 'texto':
    case 'fijo':
      return p.valor ?? '';
    case 'fresco':
      return v.fresco ? v.fresco : null;
    case 'cocida':
      return v.cocidaAnio && v.cocidaDia ? formatearCocida(v.cocidaAnio, v.cocidaDia, p.formato) : null;
    case 'caducidad':
      return v.caducidad ? formatearCaducidad(sumarDias(v.caducidad, Number(p.valor ?? 0)), p.formato) : null;
    case 'turno':
      return v.turno ? v.turno : null;
    case 'hora':
      return v.hora ? v.hora : null;
    case 'linea':
      return v.linea ? v.linea : null;
    case 'manual':
      return v.manuales?.[p.nombre ?? ''] || null;
  }
}

/** Datos a introducir de una plantilla (uno por nombre), con su valor por defecto. */
export function piezasManuales(campos: Campo[]): { nombre: string; porDefecto: string }[] {
  const vistos = new Map<string, string>();
  for (const c of campos) for (const p of c.piezas) {
    if (p.tipo === 'manual' && p.nombre && !vistos.has(p.nombre)) vistos.set(p.nombre, p.valor ?? '');
  }
  return [...vistos].map(([nombre, porDefecto]) => ({ nombre, porDefecto }));
}

/** Variables (no literales) que usa una plantilla: decide qué pide /loteadora. */
export function variablesUsadas(campos: Campo[]): Set<TipoVariable> {
  const usadas = new Set<TipoVariable>();
  for (const c of campos) for (const p of c.piezas) {
    if (p.tipo !== 'texto' && p.tipo !== 'fijo') usadas.add(p.tipo);
  }
  return usadas;
}

export interface CampoCompuesto {
  fieldId: number;
  texto: string;
  /** Variables que faltaban (su pieza se ha dejado fuera del texto) */
  faltan: TipoVariable[];
}

/** Compone el texto de cada campo concatenando sus piezas en orden. */
export function componerCampos(campos: Campo[], v: ValoresEtiqueta): CampoCompuesto[] {
  return campos.map((c) => {
    const faltan: TipoVariable[] = [];
    let texto = '';
    for (const p of c.piezas) {
      const t = textoPieza(p, v);
      if (t === null) faltan.push(p.tipo as TipoVariable);
      else texto += t;
    }
    return { fieldId: c.fieldId, texto, faltan };
  });
}

// ─── Validación (servidor: alta/edición de plantillas) ───────────────────────────

export function validarPlantilla(body: any): { error: string } | { value: { name: string; campos: Campo[] } } {
  const name = String(body?.name ?? '').trim();
  if (!name) return { error: 'El nombre es obligatorio' };
  if (!ASCII_IMPRIMIBLE.test(name)) return { error: 'El nombre solo puede tener caracteres ASCII (sin tildes ni símbolos especiales), igual que en la máquina' };
  // La máquina lista y carga los mensajes sin extensión; con la impresión parada
  // acepta "X.msg" sin quejarse pero no carga nada (probado en planta).
  if (/\.msg$/i.test(name)) return { error: 'Pon el nombre sin ".msg", tal como aparece en la lista de plantillas de la máquina' };

  if (!Array.isArray(body?.campos) || body.campos.length === 0) {
    return { error: 'La plantilla necesita al menos un campo' };
  }

  const campos: Campo[] = [];
  const ids = new Set<number>();
  for (const [i, c] of (body.campos as any[]).entries()) {
    const n = i + 1;
    const fieldId = Number(c?.fieldId);
    if (!Number.isInteger(fieldId) || fieldId < 0 || fieldId > 255) return { error: `Campo ${n}: el ID debe ser un entero entre 0 y 255` };
    if (ids.has(fieldId)) return { error: `El ID ${fieldId} está repetido: cada campo de la máquina tiene un ID distinto` };
    ids.add(fieldId);

    if (!Array.isArray(c?.piezas) || c.piezas.length === 0) return { error: `Campo ID ${fieldId}: necesita al menos una pieza` };

    const piezas: Pieza[] = [];
    for (const p of c.piezas as any[]) {
      const tipo = p?.tipo;
      if (!TIPOS_PIEZA.includes(tipo)) return { error: `Campo ID ${fieldId}: tipo de pieza desconocido` };
      const pieza: Pieza = { tipo };

      if (tipo === 'texto' || tipo === 'fijo') {
        const valor = String(p.valor ?? '');
        if (!valor) return { error: `Campo ID ${fieldId}: hay una pieza de ${INFO_PIEZA[tipo as TipoPieza].label.toLowerCase()} vacía` };
        if (!ASCII_IMPRIMIBLE.test(valor)) {
          return { error: `Campo ID ${fieldId}: "${valor}" tiene caracteres que no son ASCII (€, tildes...). La loteadora recibe los campos en ASCII: usa p. ej. "EUR" o deja ese símbolo fijo en el diseño de la máquina` };
        }
        pieza.valor = valor;
      }
      if (tipo === 'fijo') {
        const nombre = String(p.nombre ?? '').trim();
        if (!nombre) return { error: `Campo ID ${fieldId}: el dato fijo necesita un nombre (p. ej. "Precio")` };
        pieza.nombre = nombre;
      }
      if (tipo === 'manual') {
        const nombre = String(p.nombre ?? '').trim();
        if (!nombre) return { error: `Campo ID ${fieldId}: el dato a introducir necesita un nombre (lo que verá el operario, p. ej. "Nº certificado Kosher")` };
        if (nombre.length > 40) return { error: `Campo ID ${fieldId}: el nombre del dato a introducir no puede pasar de 40 caracteres` };
        pieza.nombre = nombre;
        const porDefecto = String(p.valor ?? '').trim();
        if (porDefecto.length > MAX_MANUAL || !ASCII_IMPRIMIBLE.test(porDefecto)) {
          return { error: `Campo ID ${fieldId}: el valor por defecto de "${nombre}" debe tener como mucho ${MAX_MANUAL} caracteres ASCII` };
        }
        if (porDefecto) pieza.valor = porDefecto;
      }
      if (tipo === 'caducidad') {
        const formato = p.formato ?? 'DD/MM/AAAA';
        if (!(FORMATOS_CADUCIDAD as readonly string[]).includes(formato)) return { error: `Campo ID ${fieldId}: formato de caducidad no válido` };
        pieza.formato = formato;
        const ajuste = Number(p.valor ?? 0);
        if (!Number.isInteger(ajuste) || ajuste < -365 || ajuste > 365) return { error: `Campo ID ${fieldId}: el ajuste de la caducidad debe ser un número entero de días (p. ej. -1)` };
        if (ajuste) pieza.valor = String(ajuste);
      }
      if (tipo === 'cocida') {
        const formato = p.formato ?? 'AAJJJ';
        if (!(FORMATOS_COCIDA as readonly string[]).includes(formato)) return { error: `Campo ID ${fieldId}: formato de cocida no válido` };
        pieza.formato = formato;
      }
      piezas.push(pieza);
    }
    const linea = c.linea === undefined || c.linea === null ? 1 : Number(c.linea);
    if (![1, 2, 3].includes(linea)) return { error: `Campo ID ${fieldId}: la línea debe ser 1, 2 o 3` };
    campos.push({ fieldId, piezas, linea, reloj: c.reloj === true });
  }

  return { value: { name, campos } };
}

// ─── Disposición en la etiqueta (para crear el mensaje en la máquina, 1C) ─────────
// Automática, igual que se crearon los N01…N17: en cada línea los campos van de
// izquierda a derecha en su orden, separados por un espacio, y detrás de los que
// llevan `reloj` queda un hueco de 4 caracteres (+ espacio) para el reloj, que se
// inserta a mano en la máquina (el 1C no tiene módulo de reloj). Medidas de
// Prueba2.msg: Arial-MonoBold 35 → 21 puntos por carácter y 36 entre líneas; con
// 3 líneas, tamaño 23 (14 y 24) para que quepa en la misma altura.

export const FUENTE_MENSAJE = 'Arial-MonoBold';
const ANCHO_RELOJ = 4;

/** Nº máximo de caracteres que puede ocupar una pieza (dimensiona el campo en la máquina). */
export function largoPieza(p: Pieza): number {
  switch (p.tipo) {
    case 'texto': return (p.valor ?? '').length;
    case 'fijo': return Math.max((p.valor ?? '').length, 6); // margen: el valor se edita después
    case 'fresco': return 6;
    case 'turno': return 1;
    case 'linea': return 2;
    case 'hora': return 4;
    case 'cocida': return ({ AAJJJ: 5, AJJJ: 4, JJJ: 3 } as Record<string, number>)[p.formato ?? 'AAJJJ'] ?? (p.formato ?? '').length;
    case 'caducidad': return (p.formato ?? 'DD/MM/AAAA').length;
    case 'manual': return MAX_MANUAL;
  }
}

export interface CampoDispuesto {
  id: number; x: number; y: number; fontSize: number; font: string; length: number;
  /** Línea (1-3) y columna en caracteres, para la vista previa */
  linea: number; columna: number; reloj: boolean;
}

export function disponerCampos(campos: Campo[]): CampoDispuesto[] {
  const lineas = Math.max(1, ...campos.map((c) => c.linea ?? 1));
  const [fontSize, cw, lh] = lineas >= 3 ? [23, 14, 24] : [35, 21, 36];
  const columna = new Map<number, number>();
  return campos.map((c) => {
    const linea = c.linea ?? 1;
    const col = columna.get(linea) ?? 0;
    const length = Math.max(1, c.piezas.reduce((n, p) => n + largoPieza(p), 0));
    columna.set(linea, col + length + 1 + (c.reloj ? ANCHO_RELOJ + 1 : 0));
    return { id: c.fieldId, x: col * cw, y: (linea - 1) * lh, fontSize, font: FUENTE_MENSAJE, length, linea, columna: col, reloj: !!c.reloj };
  });
}

/** Texto de cada línea de la etiqueta tal como quedaría (el reloj como "HHmm"). */
export function lineasEtiqueta(campos: Campo[], v: ValoresEtiqueta): string[] {
  const textos = componerCampos(campos, v);
  const lineas: string[] = [];
  disponerCampos(campos).forEach((d, i) => {
    let l = lineas[d.linea - 1] ?? '';
    l = l.padEnd(d.columna) + textos[i].texto.padEnd(d.length);
    if (d.reloj) l += ' HHmm';
    lineas[d.linea - 1] = l;
  });
  return Array.from(lineas, (l) => (l ?? '').trimEnd());
}

// ─── Persistencia (tabla loteadora_mensaje_segmentos) ────────────────────────────
// Una fila por pieza, con el field_id de su campo. `orden` = campo × 1000 + pieza:
// ordena a la vez los campos (por su primera pieza) y las piezas dentro de cada uno.

interface FilaSegmento {
  id: number;
  mensaje_id: number;
  orden: number;
  field_id: number;
  tipo: TipoPieza;
  valor: string | null;
  nombre: string | null;
  formato: string | null;
}

export function filasACampos(filas: FilaSegmento[]): Campo[] {
  const porCampo = new Map<number, Campo>();
  for (const f of [...filas].sort((a, b) => a.orden - b.orden)) {
    if (!porCampo.has(f.field_id)) porCampo.set(f.field_id, { fieldId: f.field_id, piezas: [] });
    const pieza: Pieza = { tipo: f.tipo };
    if (f.valor !== null) pieza.valor = f.valor;
    if (f.nombre !== null) pieza.nombre = f.nombre;
    if (f.formato !== null) pieza.formato = f.formato;
    porCampo.get(f.field_id)!.piezas.push(pieza);
  }
  return [...porCampo.values()];
}

/** Campos de varias plantillas de una vez (clave = mensaje_id). */
export function leerCampos(db: Database.Database, mensajeIds?: number[]): Map<number, Campo[]> {
  const filas = (mensajeIds
    ? db.prepare(`SELECT * FROM loteadora_mensaje_segmentos WHERE mensaje_id IN (${mensajeIds.map(() => '?').join(',') || 'NULL'})`).all(...mensajeIds)
    : db.prepare('SELECT * FROM loteadora_mensaje_segmentos').all()) as FilaSegmento[];
  const porMensaje = new Map<number, FilaSegmento[]>();
  for (const f of filas) porMensaje.set(f.mensaje_id, [...(porMensaje.get(f.mensaje_id) ?? []), f]);
  const disp = db.prepare('SELECT mensaje_id, field_id, linea, reloj FROM loteadora_mensaje_campos').all() as
    { mensaje_id: number; field_id: number; linea: number; reloj: number }[];
  const dispDe = new Map(disp.map((d) => [`${d.mensaje_id}|${d.field_id}`, d]));
  return new Map([...porMensaje].map(([id, fs]) => [id, filasACampos(fs).map((c) => {
    const d = dispDe.get(`${id}|${c.fieldId}`);
    return { ...c, linea: d?.linea ?? 1, reloj: d?.reloj === 1 };
  })]));
}

/** Sustituye todos los campos de una plantilla (llamar dentro de una transacción). */
export function guardarCampos(db: Database.Database, mensajeId: number, campos: Campo[]): void {
  db.prepare('DELETE FROM loteadora_mensaje_segmentos WHERE mensaje_id = ?').run(mensajeId);
  const insertar = db.prepare(`
    INSERT INTO loteadora_mensaje_segmentos (mensaje_id, orden, field_id, tipo, valor, nombre, formato)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  campos.forEach((c, ci) => c.piezas.forEach((p, pi) => {
    insertar.run(mensajeId, ci * 1000 + pi, c.fieldId, p.tipo, p.valor ?? null, p.nombre ?? null, p.formato ?? null);
  }));
  db.prepare('DELETE FROM loteadora_mensaje_campos WHERE mensaje_id = ?').run(mensajeId);
  const disp = db.prepare('INSERT INTO loteadora_mensaje_campos (mensaje_id, field_id, linea, reloj) VALUES (?, ?, ?, ?)');
  for (const c of campos) disp.run(mensajeId, c.fieldId, c.linea ?? 1, c.reloj ? 1 : 0);
}

// ─── Copia de seguridad: exportar / importar (/admin → Plantillas) ───────────────
// Plantillas + asociaciones artículo → plantilla en un JSON. Las asociaciones van
// por NOMBRE de plantilla: los IDs internos cambian de una BD a otra.

export interface CopiaLoteadora {
  version: 1;
  exportadaAt: string;
  plantillas: { name: string; campos: Campo[] }[];
  articulos: { articuloId: string; plantilla: string }[];
}

export function exportarCopia(db: Database.Database): CopiaLoteadora {
  const mensajes = db.prepare('SELECT id, name FROM loteadora_mensajes ORDER BY name').all() as { id: number; name: string }[];
  const campos = leerCampos(db);
  const articulos = db.prepare(
    `SELECT am.articulo_id AS articuloId, m.name AS plantilla
     FROM loteadora_articulo_mensajes am JOIN loteadora_mensajes m ON m.id = am.mensaje_id
     ORDER BY am.articulo_id`
  ).all() as { articuloId: string; plantilla: string }[];
  return {
    version: 1,
    exportadaAt: new Date().toISOString(),
    plantillas: mensajes.map((m) => ({ name: m.name, campos: campos.get(m.id) ?? [] })),
    articulos,
  };
}

interface Recuento { creadas: number; sustituidas: number; omitidas: number }
export interface ResultadoImportacion { plantillas: Recuento; articulos: Recuento }

/**
 * Importa una copia. Valida TODO antes de escribir (si algo está mal no se toca
 * nada). Sin `sustituir`, lo que ya existe (plantilla con el mismo nombre, o
 * artículo ya asociado a otra plantilla) se deja como está.
 */
export function importarCopia(db: Database.Database, copia: any, sustituir: boolean): { error: string } | { value: ResultadoImportacion } {
  if (!copia || copia.version !== 1 || !Array.isArray(copia.plantillas)) {
    return { error: 'El archivo no es una copia de plantillas de la loteadora' };
  }
  const plantillas: { name: string; campos: Campo[] }[] = [];
  const nombres = new Set<string>();
  for (const p of copia.plantillas) {
    const v = validarPlantilla(p);
    if ('error' in v) return { error: `Plantilla "${p?.name ?? '?'}": ${v.error}` };
    if (nombres.has(v.value.name)) return { error: `La plantilla "${v.value.name}" está repetida en el archivo` };
    nombres.add(v.value.name);
    plantillas.push(v.value);
  }

  const idDe = db.prepare('SELECT id FROM loteadora_mensajes WHERE name = ?');
  const articulos: { articuloId: string; plantilla: string }[] = [];
  for (const a of Array.isArray(copia.articulos) ? copia.articulos : []) {
    const articuloId = String(a?.articuloId ?? '').trim();
    const plantilla = String(a?.plantilla ?? '');
    if (!/^\d{10}$/.test(articuloId)) return { error: `Artículo "${articuloId}": debe tener exactamente 10 dígitos` };
    if (!nombres.has(plantilla) && !idDe.get(plantilla)) return { error: `Artículo ${articuloId}: la plantilla "${plantilla}" no está en el archivo ni en esta instalación` };
    articulos.push({ articuloId, plantilla });
  }

  const r: ResultadoImportacion = {
    plantillas: { creadas: 0, sustituidas: 0, omitidas: 0 },
    articulos: { creadas: 0, sustituidas: 0, omitidas: 0 },
  };
  db.transaction(() => {
    const insertar = db.prepare('INSERT INTO loteadora_mensajes (name) VALUES (?)');
    for (const p of plantillas) {
      const existente = idDe.get(p.name) as { id: number } | undefined;
      if (!existente) { guardarCampos(db, Number(insertar.run(p.name).lastInsertRowid), p.campos); r.plantillas.creadas++; }
      else if (sustituir) { guardarCampos(db, existente.id, p.campos); r.plantillas.sustituidas++; }
      else r.plantillas.omitidas++;
    }
    const actual = db.prepare('SELECT mensaje_id FROM loteadora_articulo_mensajes WHERE articulo_id = ?');
    const asociar = db.prepare(
      `INSERT INTO loteadora_articulo_mensajes (articulo_id, mensaje_id) VALUES (?, ?)
       ON CONFLICT(articulo_id) DO UPDATE SET mensaje_id = excluded.mensaje_id`
    );
    for (const a of articulos) {
      const mensajeId = (idDe.get(a.plantilla) as { id: number }).id;
      const ya = actual.get(a.articuloId) as { mensaje_id: number } | undefined;
      if (!ya) { asociar.run(a.articuloId, mensajeId); r.articulos.creadas++; }
      else if (ya.mensaje_id !== mensajeId && sustituir) { asociar.run(a.articuloId, mensajeId); r.articulos.sustituidas++; }
      else r.articulos.omitidas++;
    }
  })();
  return { value: r };
}
