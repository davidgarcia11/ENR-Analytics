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

export const TIPOS_PIEZA = ['texto', 'fijo', 'fresco', 'cocida', 'caducidad', 'turno', 'hora', 'linea', 'manual', 'reloj'] as const;
export type TipoPieza = (typeof TIPOS_PIEZA)[number];
// 'reloj' no es un dato de /loteadora: lo rellena la máquina (ver FORMATOS_RELOJ)
export type TipoVariable = Exclude<TipoPieza, 'texto' | 'fijo' | 'reloj'>;

// 'DD' = solo el día (p. ej. el día anterior a la caducidad en otro campo: "24").
// Con "/" o con "-" como separador.
export const FORMATOS_CADUCIDAD = [
  'DD/MM/AA', 'DD/MM/AAAA', 'MM/DD/AA', 'MM/DD/AAAA',
  'DD-MM-AA', 'DD-MM-AAAA', 'MM-DD-AA', 'MM-DD-AAAA', 'DD',
  'MM/AAAA', 'MM-AAAA', // solo mes y año: "02/2027"
  'AAAA MES DD', // mes en siglas (SIGLAS_MES): "2027 FE 24"
] as const;
// Siglas del mes del formato "AAAA MES DD", pedidas por un cliente.
// ponytail: fijas; si otro cliente pide otras, otro formato (o pasarlas al admin)
export const SIGLAS_MES = ['JA', 'FE', 'MR', 'AL', 'MA', 'JN', 'JL', 'AU', 'SE', 'OC', 'NO', 'DE'] as const;
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
  /** 'caducidad' → FORMATOS_CADUCIDAD; 'cocida' → FORMATOS_COCIDA; 'reloj' → FORMATOS_RELOJ */
  formato?: string;
}

export interface Campo {
  /** ID de datos del Field Module en la máquina (0-255) */
  fieldId: number;
  piezas: Pieza[];
  /** Línea de la etiqueta (1-3) — solo para crear el mensaje en la máquina */
  linea?: number;
  /** Espaciado entre caracteres de este campo (uno de ESPACIADOS); sin él, el del mensaje */
  espaciado?: number;
  /** Tamaño de letra de este campo (y de su reloj); sin él, el del mensaje */
  tamano?: number;
}

// Pieza 'reloj': hora real de la máquina en cada impresión. No se envía por el 1D
// (el campo de la máquina es un texto y el reloj otro módulo aparte): al crear el
// mensaje (lib/loteadora-msg.ts) va como un reloj pegado al campo, por eso solo
// puede ser la primera o la última pieza.
export const FORMATOS_RELOJ = ['HHmm', 'HH:mm'] as const;
export type FormatoReloj = (typeof FORMATOS_RELOJ)[number];

// Caducidad según el turno: días que se suman (o restan) a TODAS las caducidades de la
// plantilla según el turno elegido en /loteadora (p. ej. { '3': 1 }: el turno de noche,
// un día más). Por plantilla porque suele venir del cliente. Los turnos que no estén,
// 0. Se aplica antes de componer (aplicarAjusteTurno) y encima del ajuste de cada pieza.
export type AjusteTurno = Partial<Record<'1' | '2' | '3', number>>;
export const TURNOS = ['1', '2', '3'] as const;

export interface Plantilla { name: string; campos: Campo[]; ajusteTurno?: AjusteTurno }

export const tieneAjusteTurno = (a?: AjusteTurno | null): boolean => !!a && Object.values(a).some((n) => !!n);

/** Días del ajuste para ese turno (0 si no hay) */
export const diasPorTurno = (a: AjusteTurno | null | undefined, turno?: string): number =>
  (turno && a ? a[turno as '1' | '2' | '3'] ?? 0 : 0);

/** Los valores con la caducidad ya movida según el turno (si la plantilla lo lleva). */
export function aplicarAjusteTurno(v: ValoresEtiqueta, a?: AjusteTurno | null): ValoresEtiqueta {
  const dias = diasPorTurno(a, v.turno);
  return dias && v.caducidad ? { ...v, caducidad: sumarDias(v.caducidad, dias) } : v;
}

export const INFO_PIEZA: Record<TipoPieza, { label: string; ayuda: string }> = {
  texto: { label: 'Texto', ayuda: 'Literal que se imprime tal cual ("L", "CAD ", un espacio...)' },
  fijo: { label: 'Dato fijo', ayuda: 'Valor constante de la plantilla (precio, nº de certificado). Editable por quien tenga el permiso' },
  fresco: { label: 'Lote fresco', ayuda: 'Lo que escribe el operario en "Lote Fresco", tal cual' },
  cocida: { label: 'Cocida', ayuda: 'Lo que escribe el operario en "Juliano Cocida" (día juliano), con su año: como AAJJJ, AJJJ, JJJ o como fecha' },
  caducidad: { label: 'Caducidad', ayuda: 'Cocida + días de caducidad' },
  turno: { label: 'Turno', ayuda: 'Turno elegido en /loteadora (1, 2 o 3)' },
  hora: { label: 'Hora del envío', ayuda: 'Hora a la que se pulsa Enviar, HHmm (fija en todas las impresiones)' },
  linea: { label: 'Línea', ayuda: 'Línea de fabricación de la loteadora' },
  manual: { label: 'Dato a introducir', ayuda: 'Lo escribe el operario en /loteadora al enviar (p. ej. un nº de certificado que cambia). Obligatorio' },
  reloj: { label: 'Reloj', ayuda: 'Hora real de la máquina en cada impresión (HHmm o HH:mm). Solo al principio o al final del campo' },
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
  /** Solo vista previa: pinta el reloj con su formato. Al enviar no va (lo pone la máquina) */
  conReloj?: boolean;
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
  if (formato === 'AAAA MES DD') return `${a} ${SIGLAS_MES[Number(m) - 1]} ${d}`;
  const anio = formato.endsWith('AAAA') ? a : a.slice(-2);
  const sep = formato.includes('-') ? '-' : '/';
  if (formato.length === 7) return `${m}${sep}${a}`; // MM/AAAA, MM-AAAA
  return formato.startsWith('MM') ? `${m}${sep}${d}${sep}${anio}` : `${d}${sep}${m}${sep}${anio}`;
}

export function formatearCocida(anio: number, dia: number, formato: string = 'AAJJJ'): string {
  if ((FORMATOS_CADUCIDAD as readonly string[]).includes(formato)) {
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
    case 'reloj':
      return v.conReloj ? p.formato ?? 'HHmm' : '';
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

/**
 * Variables (no literales) que usa una plantilla: decide qué pide /loteadora. Con
 * caducidad según el turno, el turno es obligatorio aunque no se imprima.
 */
export function variablesUsadas(campos: Campo[], ajusteTurno?: AjusteTurno | null): Set<TipoVariable> {
  const usadas = new Set<TipoVariable>();
  for (const c of campos) for (const p of c.piezas) {
    if (p.tipo !== 'texto' && p.tipo !== 'fijo' && p.tipo !== 'reloj') usadas.add(p.tipo);
  }
  if (usadas.has('caducidad') && tieneAjusteTurno(ajusteTurno)) usadas.add('turno');
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

export function validarPlantilla(body: any): { error: string } | { value: Plantilla } {
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
      if (tipo === 'reloj') {
        const formato = p.formato ?? 'HHmm';
        if (!(FORMATOS_RELOJ as readonly string[]).includes(formato)) return { error: `Campo ID ${fieldId}: el reloj debe ser ${FORMATOS_RELOJ.join(' o ')}` };
        pieza.formato = formato;
      }
      piezas.push(pieza);
    }
    // Copias y clientes antiguos: "reloj: true" = hueco de un espacio y reloj HHmm detrás
    if (c.reloj === true && !piezas.some((p) => p.tipo === 'reloj')) piezas.push({ tipo: 'texto', valor: ' ' }, { tipo: 'reloj', formato: 'HHmm' });
    const relojes = piezas.filter((p) => p.tipo === 'reloj').length;
    if (relojes > 1) return { error: `Campo ID ${fieldId}: solo puede llevar un reloj` };
    if (relojes && piezas[0].tipo !== 'reloj' && piezas[piezas.length - 1].tipo !== 'reloj') {
      return { error: `Campo ID ${fieldId}: el reloj tiene que ser la primera o la última pieza (lo que vaya detrás, en otro campo)` };
    }
    if (relojes && piezas.length === 1) return { error: `Campo ID ${fieldId}: además del reloj necesita otra pieza (p. ej. un texto)` };
    const linea = c.linea === undefined || c.linea === null ? 1 : Number(c.linea);
    if (![1, 2, 3].includes(linea)) return { error: `Campo ID ${fieldId}: la línea debe ser 1, 2 o 3` };
    const espaciado = c.espaciado === undefined || c.espaciado === null || c.espaciado === '' ? undefined : Number(c.espaciado);
    if (espaciado !== undefined && !(ESPACIADOS as readonly number[]).includes(espaciado)) {
      return { error: `Campo ID ${fieldId}: el espaciado debe ser uno de: ${ESPACIADOS.join(', ')}` };
    }
    const tamano = c.tamano === undefined || c.tamano === null || c.tamano === '' ? undefined : Number(c.tamano);
    if (tamano !== undefined && (!Number.isInteger(tamano) || tamano < 5 || tamano > 1200)) {
      return { error: `Campo ID ${fieldId}: el tamaño debe ser un número entero entre 5 y 1200` };
    }
    campos.push({ fieldId, piezas, linea, ...(espaciado !== undefined ? { espaciado } : {}), ...(tamano !== undefined ? { tamano } : {}) });
  }

  // Caducidad según el turno: días enteros entre -30 y 30; los 0 no se guardan
  const ajusteTurno: AjusteTurno = {};
  if (body?.ajusteTurno !== undefined && body?.ajusteTurno !== null) {
    if (typeof body.ajusteTurno !== 'object') return { error: 'La caducidad según el turno no es válida' };
    for (const t of TURNOS) {
      const v = body.ajusteTurno[t];
      if (v === undefined || v === null || v === '' || Number(v) === 0) continue;
      const n = Number(v);
      if (!Number.isInteger(n) || n < -30 || n > 30) return { error: `Caducidad según el turno: el turno ${t} debe ser un número entero de días entre -30 y 30` };
      ajusteTurno[t] = n;
    }
  }

  return { value: { name, campos, ...(tieneAjusteTurno(ajusteTurno) ? { ajusteTurno } : {}) } };
}

// ─── Disposición en la etiqueta (para crear el mensaje en la máquina) ────────────
// Automática, igual que se crearon los N01…N17: en cada línea los campos van de
// izquierda a derecha en su orden, separados por un espacio. Un campo con reloj
// ocupa el campo más el reloj pegado (delante o detrás, según su pieza).
//
// Las MEDIDAS (fuente, tamaño, espaciado, ancho por carácter y separación entre
// líneas) se eligen al crear el mensaje en cada máquina y se recuerdan por mensaje
// y máquina (loteadora_medidas_mensaje). Por defecto Arial: tamaño 35 → 33 puntos por
// carácter (la caja que guarda la máquina en sus .msg; con 21, lo que valía para
// Arial-MonoBold, los campos y el reloj se montaban) y 36 entre líneas; con 3 líneas,
// tamaño 23 (22 y 24) para que quepa en la misma altura.

export const FUENTE_MENSAJE = 'Arial';

// Espaciado entre caracteres, en puntos: de 5 en 5 entre +30 y −30, más ±2 (los que
// daba el antiguo comando 1C). El .msg lo guarda con su valor (lib/loteadora-msg.ts).
// ponytail: los intermedios (±25, ±15) no los ofrece el comando 1C; si alguno sale
// raro en la máquina, probarlo con un .msg hecho a mano con ese espaciado.
export const ESPACIADOS = [30, 25, 20, 15, 10, 5, 2, 0, -2, -5, -10, -15, -20, -25, -30] as const;

export interface MedidasMensaje {
  fuente: string;
  tamano: number;
  /** Uno de ESPACIADOS */
  espaciado: number;
  /** Puntos que ocupa cada carácter (para colocar los campos) */
  ancho: number;
  /** Puntos entre una línea y la siguiente */
  interlineado: number;
}

/** Ancho y separación entre líneas que corresponden a un tamaño y espaciado. */
export function medidasDeTamano(tamano: number, espaciado = 0, fuente = FUENTE_MENSAJE): MedidasMensaje {
  return { fuente, tamano, espaciado, ancho: Math.max(1, Math.round((tamano * 33) / 35) + espaciado), interlineado: tamano + 1 };
}

export const numeroLineas = (campos: Campo[]) => Math.max(1, ...campos.map((c) => c.linea ?? 1));

/** Medidas por defecto de un mensaje según su nº de líneas. */
export function medidasPorDefecto(campos: Campo[]): MedidasMensaje {
  return numeroLineas(campos) >= 3 ? medidasDeTamano(23) : medidasDeTamano(35);
}

export function validarMedidas(m: any): { error: string } | { value: MedidasMensaje } {
  const fuente = String(m?.fuente ?? '').trim();
  const [tamano, espaciado, ancho, interlineado] = ['tamano', 'espaciado', 'ancho', 'interlineado'].map((k) => Number(m?.[k]));
  if (!fuente || fuente.length > 40 || !ASCII_IMPRIMIBLE.test(fuente)) return { error: 'La fuente debe ser un nombre ASCII de hasta 40 caracteres, igual que en la máquina' };
  if (!Number.isInteger(tamano) || tamano < 5 || tamano > 1200) return { error: 'El tamaño de letra debe estar entre 5 y 1200' };
  if (!(ESPACIADOS as readonly number[]).includes(espaciado)) return { error: `El espaciado debe ser uno de: ${ESPACIADOS.join(', ')}` };
  if (!Number.isInteger(ancho) || ancho < 1 || ancho > 1000) return { error: 'El ancho por carácter debe ser un entero entre 1 y 1000' };
  if (!Number.isInteger(interlineado) || interlineado < 1 || interlineado > 2000) return { error: 'La separación entre líneas debe ser un entero entre 1 y 2000' };
  return { value: { fuente, tamano, espaciado, ancho, interlineado } };
}

/**
 * Nº máximo de caracteres que puede ocupar una pieza (dimensiona el campo en la máquina).
 * `largoLinea`: lo que mide la línea de la loteadora ("5" → 1, "18" → 2); sin ella, 2.
 */
export function largoPieza(p: Pieza, largoLinea = 2): number {
  switch (p.tipo) {
    case 'texto': return (p.valor ?? '').length;
    // Justo lo que mide: sin margen, para que lo que se pone detrás en la máquina (p. ej. el «€»
    // tras el precio) quede pegado. Si el valor cambia de largo, hay que volver a crear el mensaje
    // (lo avisa /admin → Datos fijos).
    case 'fijo': return (p.valor ?? '').length;
    case 'fresco': return 6;
    case 'turno': return 1;
    case 'linea': return Math.max(1, largoLinea);
    case 'hora': return 4;
    // Lo que mide con una fecha cualquiera (todos los formatos tienen largo fijo)
    case 'cocida': return formatearCocida(2000, 1, p.formato).length;
    case 'caducidad': return formatearCaducidad('2000-01-01', p.formato).length;
    case 'manual': return MAX_MANUAL;
    case 'reloj': return 0; // va en su propio módulo, no ocupa sitio en el campo
  }
}

// `ancho`: puntos que ocupa (length × ancho por carácter con su espaciado). La
// máquina coloca y dibuja cada elemento dentro de esa caja (lib/loteadora-msg.ts).
export interface CampoDispuesto {
  id: number; x: number; y: number; fontSize: number; font: string; length: number; ancho: number;
  /** Espaciado entre caracteres (uno de ESPACIADOS) */
  espaciado: number;
  /** Línea (1-3) y columna en caracteres, para la vista previa */
  linea: number; columna: number;
}

export interface RelojDispuesto {
  x: number; y: number; fontSize: number; font: string; length: number; ancho: number; espaciado: number;
  formato: FormatoReloj; linea: number; columna: number;
}

export interface MensajeDispuesto { campos: CampoDispuesto[]; relojes: RelojDispuesto[] }

// Un campo con tamaño propio escala el ancho por carácter y el alto de su línea en
// proporción al tamaño del mensaje. Cada línea mide lo que su campo más grande; los
// campos de una misma línea se alinean por arriba. `largoLinea`: ver largoPieza.
export function disponerMensaje(
  campos: Campo[], medidas: MedidasMensaje = medidasPorDefecto(campos), largoLinea?: number,
): MensajeDispuesto {
  const { fuente: font } = medidas;
  // Ancho de un carácter sin espaciado (con el tamaño del mensaje); cada campo le suma
  // el suyo (o el del mensaje). El espacio entre campos va con el ancho base.
  const base = Math.max(1, medidas.ancho - medidas.espaciado);
  const escala = (c: Campo) => (c.tamano ?? medidas.tamano) / medidas.tamano;
  const alto = [1, 2, 3].map((l) => Math.max(0, ...campos.filter((c) => (c.linea ?? 1) === l).map((c) => Math.round(medidas.interlineado * escala(c)))) || medidas.interlineado);
  const yDe = (linea: number) => alto.slice(0, linea - 1).reduce((a, b) => a + b, 0);
  const columna = new Map<number, number>(); // en caracteres (vista previa)
  const posicion = new Map<number, number>(); // en puntos (máquina)
  const d: MensajeDispuesto = { campos: [], relojes: [] };
  for (const c of campos) {
    const linea = c.linea ?? 1;
    const espaciado = c.espaciado ?? medidas.espaciado;
    const fontSize = c.tamano ?? medidas.tamano;
    const baseCampo = Math.max(1, Math.round(base * escala(c)));
    const cw = Math.max(1, baseCampo + espaciado);
    const y = yDe(linea);
    let col = columna.get(linea) ?? 0;
    let x = posicion.get(linea) ?? 0;
    const reloj = c.piezas.find((p) => p.tipo === 'reloj');
    const formato = (reloj?.formato ?? 'HHmm') as FormatoReloj;
    const ponReloj = () => {
      d.relojes.push({ x, y, fontSize, font, length: formato.length, ancho: formato.length * cw, espaciado, formato, linea, columna: col });
      col += formato.length;
      x += formato.length * cw;
    };
    if (reloj && c.piezas[0] === reloj) ponReloj();
    const length = Math.max(1, c.piezas.reduce((n, p) => n + largoPieza(p, largoLinea), 0));
    d.campos.push({ id: c.fieldId, x, y, fontSize, font, length, ancho: length * cw, espaciado, linea, columna: col });
    col += length;
    x += length * cw;
    if (reloj && c.piezas[0] !== reloj) ponReloj();
    columna.set(linea, col + 1);
    posicion.set(linea, x + baseCampo);
  }
  return d;
}

/** Texto de cada línea de la etiqueta tal como quedaría (el reloj con su formato, "HHmm"). */
export function lineasEtiqueta(campos: Campo[], v: ValoresEtiqueta): string[] {
  const textos = new Map(componerCampos(campos, { ...v, conReloj: false }).map((c) => [c.fieldId, c.texto]));
  return trozosEtiqueta(campos, textos, v.linea?.length).map((l) => l.map((t) => t.texto).join('').trimEnd());
}

export interface TrozoEtiqueta { texto: string; reloj?: boolean }

/**
 * Cada línea de la etiqueta como trozos, con los espacios de delante ya puestos: el
 * texto de cada campo (`textos`, por fieldId) en su sitio y el reloj con su formato.
 * Lo usan la vista previa (lineasEtiqueta) y el último envío de /loteadora.
 */
export function trozosEtiqueta(campos: Campo[], textos: Map<number, string>, largoLinea?: number): TrozoEtiqueta[][] {
  const d = disponerMensaje(campos, undefined, largoLinea);
  const todos = [
    ...d.campos.map((c) => ({ linea: c.linea, columna: c.columna, texto: (textos.get(c.id) ?? '').padEnd(c.length), reloj: false })),
    ...d.relojes.map((r) => ({ linea: r.linea, columna: r.columna, texto: r.formato as string, reloj: true })),
  ].sort((a, b) => a.columna - b.columna);
  const lineas: TrozoEtiqueta[][] = [];
  const largo: number[] = [];
  for (const t of todos) {
    const n = largo[t.linea - 1] ?? 0;
    (lineas[t.linea - 1] ??= []).push({ texto: ' '.repeat(Math.max(0, t.columna - n)) + t.texto, ...(t.reloj ? { reloj: true } : {}) });
    largo[t.linea - 1] = Math.max(n, t.columna) + t.texto.length;
  }
  return Array.from(lineas, (l) => l ?? []);
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
  const disp = db.prepare('SELECT mensaje_id, field_id, linea, espaciado, tamano FROM loteadora_mensaje_campos').all() as
    { mensaje_id: number; field_id: number; linea: number; espaciado: number | null; tamano: number | null }[];
  const dispDe = new Map(disp.map((d) => [`${d.mensaje_id}|${d.field_id}`, d]));
  return new Map([...porMensaje].map(([id, fs]) => [id, filasACampos(fs).map((c) => {
    const d = dispDe.get(`${id}|${c.fieldId}`);
    return { ...c, linea: d?.linea ?? 1, ...(d?.espaciado != null ? { espaciado: d.espaciado } : {}), ...(d?.tamano != null ? { tamano: d.tamano } : {}) };
  })]));
}

/** Caducidad según el turno de varias plantillas (clave = mensaje_id); sin ajuste, no aparece. */
export function leerAjustesTurno(db: Database.Database): Map<number, AjusteTurno> {
  const filas = db.prepare('SELECT id, ajuste_turno FROM loteadora_mensajes WHERE ajuste_turno IS NOT NULL').all() as { id: number; ajuste_turno: string }[];
  return new Map(filas.map((f) => [f.id, JSON.parse(f.ajuste_turno) as AjusteTurno]));
}

export function guardarAjusteTurno(db: Database.Database, mensajeId: number, a?: AjusteTurno): void {
  db.prepare('UPDATE loteadora_mensajes SET ajuste_turno = ? WHERE id = ?').run(tieneAjusteTurno(a) ? JSON.stringify(a) : null, mensajeId);
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
  const disp = db.prepare('INSERT INTO loteadora_mensaje_campos (mensaje_id, field_id, linea, espaciado, tamano) VALUES (?, ?, ?, ?, ?)');
  for (const c of campos) disp.run(mensajeId, c.fieldId, c.linea ?? 1, c.espaciado ?? null, c.tamano ?? null);
}

// ─── Copia de seguridad: exportar / importar (/admin → Plantillas) ───────────────
// Plantillas + asociaciones artículo → plantilla en un JSON. Las asociaciones van
// por NOMBRE de plantilla: los IDs internos cambian de una BD a otra.

// Las copias de antes del reloj como pieza traen "reloj: true" en el campo: validarPlantilla lo convierte.
export interface CopiaLoteadora {
  version: 1;
  exportadaAt: string;
  plantillas: Plantilla[];
  articulos: { articuloId: string; plantilla: string }[];
}

export function exportarCopia(db: Database.Database): CopiaLoteadora {
  const mensajes = db.prepare('SELECT id, name FROM loteadora_mensajes ORDER BY name').all() as { id: number; name: string }[];
  const campos = leerCampos(db);
  const ajustes = leerAjustesTurno(db);
  const articulos = db.prepare(
    `SELECT am.articulo_id AS articuloId, m.name AS plantilla
     FROM loteadora_articulo_mensajes am JOIN loteadora_mensajes m ON m.id = am.mensaje_id
     ORDER BY am.articulo_id`
  ).all() as { articuloId: string; plantilla: string }[];
  return {
    version: 1,
    exportadaAt: new Date().toISOString(),
    plantillas: mensajes.map((m) => ({ name: m.name, campos: campos.get(m.id) ?? [], ...(ajustes.has(m.id) ? { ajusteTurno: ajustes.get(m.id) } : {}) })),
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
  const plantillas: Plantilla[] = [];
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
      if (!existente) {
        const id = Number(insertar.run(p.name).lastInsertRowid);
        guardarCampos(db, id, p.campos); guardarAjusteTurno(db, id, p.ajusteTurno); r.plantillas.creadas++;
      } else if (sustituir) { guardarCampos(db, existente.id, p.campos); guardarAjusteTurno(db, existente.id, p.ajusteTurno); r.plantillas.sustituidas++; }
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
