// Genera el archivo .msg de un mensaje de la loteadora, en el formato propio de
// la máquina, para enviarlo con el comando 50 (Send File, lib/loteadora-printer.ts).
//
// El protocolo no documenta este formato: se ha deducido comparando .msg creados en
// la máquina (septiembre 2026, Loteadora Pruebas). Es una serialización con enteros
// de 4 bytes big-endian y textos UTF-16BE precedidos de su largo en bytes, con una
// lista por tipo de módulo (textos, relojes, ..., campos). El comando 1C, que se
// usaba antes, no tiene módulo de reloj; este formato sí.
//
// De lo que no se entiende (cabecera con meses/días y un bloque final de ajustes)
// se copia tal cual el de un .msg real (BASE, el N01 creado en la máquina): es
// idéntico en todos los .msg de muestra. Ver docs/loteadora.md §13.
import type { MensajeDispuesto } from './loteadora-plantilla';

// N01.msg tal como lo guardó la máquina (un campo, sin relojes).
const BASE = Buffer.from(
  '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' +
  'AAAABQU=',
  'base64',
);

const i32 = (n: number) => { const b = Buffer.alloc(4); b.writeInt32BE(n); return b; };
const utf16 = (s: string) => Buffer.from(s, 'utf16le').swap16();
const texto = (s: string) => { const u = utf16(s); return Buffer.concat([i32(u.length), u]); };
const posDe = (s: string) => BASE.indexOf(utf16(s)) - 4;

// Cortes de BASE: cabecera tras el nombre, hasta el contador de listTimeModule;
// del resto de listas hasta el preámbulo de fieldModule; y el bloque final.
const NOMBRE_FIN = 8 + BASE.readInt32BE(4);
const TIME_CONTADOR = posDe('listTimeModule') + 4 + BASE.readInt32BE(posDe('listTimeModule'));
const FIELD_PREAMBULO = posDe('fieldModule') + 4 + BASE.readInt32BE(posDe('fieldModule'));
const PREAMBULO_LARGO = 15; // 01 00000002 00000000 00000002 003B
const FINAL = BASE.indexOf(Buffer.from([0x00, 0x05, 0x05, 0x0c]), FIELD_PREAMBULO);

// Caja de cada módulo (ancho y alto). La máquina coloca y dibuja el texto dentro de
// ella: si es más ancha que lo que ocupa de verdad, el siguiente elemento se monta.
// El ancho es el que ha calculado la disposición (ancho por carácter × caracteres);
// el alto, el que guarda la máquina con Arial 35 (40), escalado con el tamaño.
const caja = (fontSize: number, ancho: number) => [i32(ancho), i32(Math.round((fontSize * 40) / 35))];

// Piezas del reloj: 7 = hora, 8 = minutos; un carácter suelto va por su código.
const PIEZAS_RELOJ = { HHmm: [7, 8], 'HH:mm': [7, 0x3a, 8] } as const;
const MUESTRA_RELOJ = { HHmm: '1200', 'HH:mm': '12:00' } as const;

// El espaciado va en su valor (0 = normal), no en el índice de ESPACIADOS del 1C.
// ponytail: en las muestras siempre es 0; si un espaciado distinto sale raro en la
// máquina, crear uno a mano con espaciado y comparar.
function moduloReloj(r: MensajeDispuesto['relojes'][number]): Buffer {
  const piezas = PIEZAS_RELOJ[r.formato];
  return Buffer.concat([
    i32(1), i32(piezas.length), ...piezas.map(i32), i32(0), i32(1), i32(3), texto(MUESTRA_RELOJ[r.formato]),
    texto(r.font), i32(r.fontSize), i32(r.espaciado), i32(0), i32(r.x), i32(r.y), ...caja(r.fontSize, r.ancho),
    Buffer.from([1]), texto('HEX'), i32(16), utf16('0123456789ABCDEF'), i32(0),
  ]);
}

function moduloCampo(c: MensajeDispuesto['campos'][number]): Buffer {
  return Buffer.concat([
    texto(c.font), i32(c.fontSize), i32(c.espaciado), texto('NULL'), i32(0), i32(c.x), i32(c.y), ...caja(c.fontSize, c.ancho),
    i32(c.length), i32(c.id), i32(1), i32(0),
  ]);
}

/** Archivo .msg completo (campos y relojes ya colocados por disponerMensaje). */
export function generarMsg(nombre: string, m: MensajeDispuesto): Buffer {
  if (m.campos.length === 0) throw new Error('El mensaje necesita al menos un campo');
  return Buffer.concat([
    BASE.subarray(0, 4), texto(`${nombre}.msg`), BASE.subarray(NOMBRE_FIN, TIME_CONTADOR),
    i32(m.relojes.length), ...m.relojes.map(moduloReloj),
    BASE.subarray(TIME_CONTADOR + 4, FIELD_PREAMBULO + PREAMBULO_LARGO),
    i32(m.campos.length), ...m.campos.map(() => i32(1)), ...m.campos.map(moduloCampo),
    BASE.subarray(FINAL),
  ]);
}
