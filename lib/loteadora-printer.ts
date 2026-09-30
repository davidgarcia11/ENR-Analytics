import net from 'net';

// Envío/consulta por TCP a una impresora loteadora usando el protocolo TIJ
// (TIJ_Protocol 6.7.pdf). Mismo espíritu que lib/reflex.ts/lib/db.ts: sin
// dependencias nuevas (módulo nativo `net` de Node), config validada antes
// de conectar, mensajes de error claros. Cada llamada abre una conexión
// breve y la cierra al terminar (el protocolo solo admite un cliente a la vez).

const ESC = 0x1b;
const STX = 0x02;
const ETX = 0x03;
const ACK = 0x06;
const NAK = 0x15;
const CMD_UPDATE_PRINT_CONTENTS = 0x01;
const CMD_DOWNLOAD_REMOTE_FIELD = 0x1d;
const CMD_LOAD_PRINT_MESSAGE = 0x1e;
const CMD_REQUEST_MESSAGE_NAMES = 0x1f;
const CMD_REQUEST_PRINTER_STATUS = 0x14;
const CMD_CLEAR_REMOTE_FIELD_BUFFER = 0x21;
const CMD_SEND_FILE = 0x50;
// Espera entre cargar (1E) y aplicar (01) una plantilla: ver loadPrintMessage.
export const LOAD_APPLY_DELAY_MS = 1000;

export interface RemoteField {
  /** Field ID configurado en la máquina con "Insertar Campo" (0-255) */
  id: number;
  /** Texto ASCII a imprimir en ese campo */
  text: string;
}

export interface LoteadoraConfig {
  ip: string;
  port: number;
  /** Slave Address configurada en la máquina, normalmente 0 */
  slaveAddress: number;
}

export type PrinterState = 'activa' | 'en_error' | 'standby' | 'apagada';

// Checknum = complemento a 2 de la suma módulo-256 de todos los bytes de la trama (protocolo §2.4)
function checknum(bytes: number[]): number {
  const sum = bytes.reduce((acc, b) => (acc + b) & 0xff, 0);
  return (0x100 - sum) & 0xff;
}

// Construye la trama del comando 1D (Download Remote Field Data) — protocolo §3.5.18.
export function buildRemoteFieldFrame(slaveAddress: number, fields: RemoteField[]): Buffer {
  if (fields.length < 1 || fields.length > 255) {
    throw new Error('Número de campos inválido (debe haber entre 1 y 255)');
  }

  const bytes: number[] = [ESC, STX, slaveAddress & 0xff, CMD_DOWNLOAD_REMOTE_FIELD, fields.length];
  for (const field of fields) {
    const textBytes = Buffer.from(field.text, 'ascii');
    if (textBytes.length < 1 || textBytes.length > 255) {
      throw new Error(`El texto del campo ${field.id} debe tener entre 1 y 255 caracteres`);
    }
    bytes.push(field.id & 0xff, textBytes.length, ...textBytes);
  }
  bytes.push(ESC, ETX);
  bytes.push(checknum(bytes));

  return Buffer.from(bytes);
}

// Construye la trama del comando 50 (Send File) — protocolo §3.5.48, en una sola
// pieza (OPERATION 03). Esta trama no lleva ESC ETX ni checknum al final, y la
// longitud cuenta todo lo que va detrás de ella.
// ponytail: una sola pieza (hasta 10240 bytes); un .msg de plantilla ronda 2-4 KB.
export const MAX_PIEZA_ARCHIVO = 10240;
export function buildSendFileFrame(slaveAddress: number, fileName: string, file: Buffer): Buffer {
  const name = Buffer.from(fileName, 'ascii');
  if (name.length < 1 || name.length > 255) throw new Error('El nombre del archivo debe tener entre 1 y 255 caracteres');
  if (file.length < 1 || file.length > MAX_PIEZA_ARCHIVO) throw new Error(`El archivo ocupa ${file.length} bytes y el máximo en un envío es ${MAX_PIEZA_ARCHIVO}`);
  const data = Buffer.concat([Buffer.from([0x03, name.length]), name, file]);
  return Buffer.concat([Buffer.from([ESC, STX, slaveAddress & 0xff, CMD_SEND_FILE, (data.length >> 8) & 0xff, data.length & 0xff]), data]);
}

// Construye la trama de un comando sin datos (14 Request Printer Status,
// 1F Request Message Names, 01 Update Print contents...).
function buildNoDataFrame(slaveAddress: number, cmdId: number): Buffer {
  const bytes: number[] = [ESC, STX, slaveAddress & 0xff, cmdId, ESC, ETX];
  bytes.push(checknum(bytes));
  return Buffer.from(bytes);
}

// Construye la trama del comando 1E (Load Print Message) — protocolo §3.5.19.
function buildLoadMessageFrame(slaveAddress: number, messageName: string): Buffer {
  const nameBytes = Buffer.from(messageName, 'ascii');
  if (nameBytes.length < 1 || nameBytes.length > 255) {
    throw new Error('El nombre de la plantilla debe tener entre 1 y 255 caracteres');
  }
  const bytes: number[] = [ESC, STX, slaveAddress & 0xff, CMD_LOAD_PRINT_MESSAGE, nameBytes.length, ...nameBytes, ESC, ETX];
  bytes.push(checknum(bytes));
  return Buffer.from(bytes);
}

// Códigos relevantes del capítulo 4 del manual (P_Status de la respuesta ACK a 1D).
// "12" aparece con mucha frecuencia en el manual: la máquina exige tener la
// impresión iniciada en pantalla para aceptar casi cualquier comando.
const P_STATUS_MESSAGES: Record<number, string> = {
  0x01: 'La impresora tiene uno o más errores activos',
  0x10: 'Esa plantilla no existe en la impresora',
  0x12: 'La impresora no tiene la impresión iniciada — pulsa "Iniciar" en la pantalla de la máquina antes de enviar',
  0x42: 'El buffer de campos remotos se acaba de llenar',
  0x43: 'El buffer de campos remotos sigue lleno, el dato no se ha guardado',
};

// C_Status de una respuesta NAK (comando rechazado antes de ejecutarse).
const C_STATUS_MESSAGES: Record<number, string> = {
  0x06: 'Inicio de comando inválido',
  0x07: 'Fin de comando inválido',
  0x08: 'Checknum inválido',
  0x09: 'Número de campos inválido',
  0x0a: 'Tipo de módulo inválido',
  0x11: 'Command ID inválido',
};

function describeStatus(map: Record<number, string>, code: number): string {
  return map[code] ?? `código 0x${code.toString(16).padStart(2, '0').toUpperCase()}`;
}

interface CommandResult {
  kind: 'ack' | 'nak';
  /** P_Status (ack) o C_Status (nak) de la respuesta */
  status: number;
  /** Trama completa recibida, para comandos con datos de vuelta (ej. 1F) */
  data: Buffer;
}

// Abre una conexión TCP breve, envía una trama y resuelve con el ACK/NAK
// recibido. Rechaza solo por problemas de conexión/timeout/formato — el
// contenido del P_Status/C_Status se interpreta en quien llama.
//
// La respuesta puede llegar troceada en varios paquetes TCP (ej. 1F con
// muchos nombres de mensaje), así que se acumulan los `data` hasta detectar
// el cierre de trama (ESC ETX + 1 byte de checknum) en vez de resolver con
// el primer evento `data`.
//
// Los comandos a una misma máquina van en cola (el protocolo solo admite un
// cliente a la vez): así el estado cada 60s, el listado de plantillas y la
// carga de una plantilla no abren conexiones simultáneas.
// ponytail: cola en memoria del proceso, basta con un único servidor Next.
const colas = new Map<string, Promise<unknown>>();

function sendCommand(config: LoteadoraConfig, frame: Buffer, timeoutMs: number): Promise<CommandResult> {
  if (!config.ip || !config.port) {
    return Promise.reject(new Error('Falta la IP o el puerto de la loteadora'));
  }
  const clave = `${config.ip}:${config.port}`;
  const actual = (colas.get(clave) ?? Promise.resolve())
    .catch(() => {})
    .then(() => sendCommandAhora(config, frame, timeoutMs));
  colas.set(clave, actual);
  const limpiar = () => { if (colas.get(clave) === actual) colas.delete(clave); };
  actual.then(limpiar, limpiar);
  return actual;
}

function sendCommandAhora(config: LoteadoraConfig, frame: Buffer, timeoutMs: number): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let settled = false;
    let buffer = Buffer.alloc(0);

    const finish = (result?: CommandResult, err?: Error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (err) reject(err);
      else resolve(result!);
    };

    socket.setTimeout(timeoutMs);
    socket.on('timeout', () => finish(undefined, new Error('Tiempo de espera agotado conectando con la loteadora')));
    socket.on('error', (err) => finish(undefined, new Error(`Error de conexión con la loteadora: ${err.message}`)));
    // Si la máquina cierra la conexión sin contestar (p. ej. porque ya tiene otro
    // cliente), falla ya en vez de esperar al tiempo máximo.
    socket.on('close', () => finish(undefined, new Error('La loteadora cerró la conexión sin responder')));

    socket.connect(config.port, config.ip, () => socket.write(frame));

    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);

      if (buffer[0] !== ESC) {
        finish(undefined, new Error('Respuesta de la loteadora con formato inesperado'));
        return;
      }
      // Aún no ha llegado ni la cabecera completa, o la trama no ha cerrado todavía.
      if (buffer.length < 4) return;
      if (!(buffer[buffer.length - 3] === ESC && buffer[buffer.length - 2] === ETX)) return;

      if (buffer[1] === ACK) { finish({ kind: 'ack', status: buffer[3], data: buffer }); return; }
      if (buffer[1] === NAK) { finish({ kind: 'nak', status: buffer[3], data: buffer }); return; }
      finish(undefined, new Error('Respuesta de la loteadora con formato inesperado'));
    });
  });
}

// P_Status que el manual documenta como "el envío sí se ha aceptado", aunque
// no sea el 00 limpio — llenar la última plaza del buffer no es un fallo.
// Ver protocolo §3.5.18: "42: Remote buffer now full" ocurre precisamente
// cuando ESTE comando ha entrado y ha dejado el buffer lleno.
const P_STATUS_ACCEPTED_WITH_WARNING: Record<number, string> = {
  0x42: 'Se ha enviado, pero el buffer de campos remotos de la impresora se acaba de llenar (máximo 10 en cola) — deja que imprima antes de enviar más cambios.',
  // "43: sigue lleno" es ambiguo (según la configuración de la máquina, o se
  // descarta el más antiguo de la cola, o se descarta este envío) — se avisa
  // en vez de darlo por fallido sin más, porque puede que sí se haya guardado.
  0x43: 'El buffer de campos remotos ya estaba lleno. Según la configuración de la impresora puede haber sustituido al envío más antiguo en cola, o haberse descartado — revisa la impresora si tienes dudas.',
  // 12 = impresión parada: es el estado de la impresora, no un rechazo. Probado
  // en planta: con la impresión parada el envío se guarda igualmente.
  0x12: 'la impresión está parada; se imprimirá con estos datos al iniciarla.',
};

// Envía los campos remotos (lote/caducidad) a una loteadora por TCP (comando
// 1D). Devuelve un aviso (no un error) cuando el comando se aceptó pero con
// una condición a tener en cuenta (buffer lleno) — solo lanza cuando el envío
// realmente no se ha aceptado.
export async function sendRemoteFields(config: LoteadoraConfig, fields: RemoteField[]): Promise<{ warning: string | null }> {
  const frame = buildRemoteFieldFrame(config.slaveAddress, fields);
  const result = await sendCommand(config, frame, 5000);

  if (result.kind === 'nak') {
    throw new Error(`Comando rechazado por la loteadora: ${describeStatus(C_STATUS_MESSAGES, result.status)}`);
  }
  if (result.status === 0x00) {
    return { warning: null };
  }
  if (result.status in P_STATUS_ACCEPTED_WITH_WARNING) {
    return { warning: P_STATUS_ACCEPTED_WITH_WARNING[result.status] };
  }
  throw new Error(`La loteadora rechazó el envío: ${describeStatus(P_STATUS_MESSAGES, result.status)}`);
}

// Vacía la cola de campos remotos pendientes (comando 21 — Clear Buffers of
// 1D). Equivale a pulsar el botón "Clear" de Ajustes de comunicación >
// Buffer en la propia máquina. No imprime ni cambia ningún valor, solo
// descarta los envíos en cola que aún no se hayan consumido.
export async function clearRemoteFieldBuffer(config: LoteadoraConfig): Promise<void> {
  const frame = buildNoDataFrame(config.slaveAddress, CMD_CLEAR_REMOTE_FIELD_BUFFER);
  const result = await sendCommand(config, frame, 5000);

  if (result.kind === 'nak') {
    throw new Error(`Comando rechazado por la loteadora: ${describeStatus(C_STATUS_MESSAGES, result.status)}`);
  }
  if (result.status !== 0x00) {
    throw new Error(`No se pudo limpiar el buffer: ${describeStatus(P_STATUS_MESSAGES, result.status)}`);
  }
}

export interface PrinterStatusDetail {
  state: PrinterState;
  /**
   * Bytes de estado en crudo del comando 14 (ej. "50 02 00 04"), tal cual los
   * devuelve la máquina — sin traducir. La tabla de significado por bit
   * (Chart 3-1 del manual) tiene ~90 avisos repartidos en 3 variantes de
   * firmware (4/5/12 bytes) y no se puede reconstruir de forma fiable desde
   * el PDF, así que de momento se expone el dato crudo en vez de adivinar
   * una traducción que podría ser incorrecta. `null` si no se pudo consultar
   * o la máquina no devolvió datos.
   */
  rawBytes: string | null;
}

// Tiempo máximo de la consulta de estado. Con 3 s, si la máquina tardaba en
// contestar tras un rato sin tráfico (el reintento de conexión de Windows llega a
// los 3 s), salía "Sin conexión" aunque estuviera bien; un ping la "despertaba".
export const STATUS_TIMEOUT_MS = 5000;

// Estado con un reintento: solo se da por "Sin conexión" si fallan los dos. Cada
// fallo queda en el log del servidor con el motivo (tiempo agotado, rechazada,
// cortada...) para saber qué pasó la próxima vez.
async function queryPrinterStatus(config: LoteadoraConfig): Promise<PrinterStatusDetail> {
  try {
    return await queryPrinterStatusUnaVez(config);
  } catch (err: any) {
    console.warn(`[loteadora ${config.ip}] estado: sin respuesta (${err?.message}); se reintenta`);
    try {
      const detalle = await queryPrinterStatusUnaVez(config);
      console.warn(`[loteadora ${config.ip}] estado: respondió al reintento`);
      return detalle;
    } catch (err2: any) {
      console.warn(`[loteadora ${config.ip}] estado: sin conexión (${err2?.message})`);
      return { state: 'apagada', rawBytes: null };
    }
  }
}

async function queryPrinterStatusUnaVez(config: LoteadoraConfig): Promise<PrinterStatusDetail> {
  const frame = buildNoDataFrame(config.slaveAddress, CMD_REQUEST_PRINTER_STATUS);
  const result = await sendCommand(config, frame, STATUS_TIMEOUT_MS);

  if (result.kind === 'nak') return { state: 'en_error', rawBytes: null };

  // Cabecera: ESC ACK Slave P_Status CmdID [Printer Status data...] ESC ETX Checknum
  const statusBytes = result.data.subarray(5, result.data.length - 3);
  const rawBytes = statusBytes.length > 0
    ? Array.from(statusBytes).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ')
    : null;

  if (result.status === 0x00) return { state: 'activa', rawBytes };
  if (result.status === 0x12) return { state: 'standby', rawBytes };
  return { state: 'en_error', rawBytes };
}

// Consulta el estado real de una loteadora (comando 14 — Request Printer
// Status). Nunca lanza: cualquier fallo de conexión se traduce en "apagada".
export async function getPrinterStatus(config: LoteadoraConfig): Promise<PrinterState> {
  return (await queryPrinterStatus(config)).state;
}

// Como getPrinterStatus, pero además incluye los bytes de estado en crudo
// (sin traducir) para poder mostrarlos como detalle de un error.
export async function getPrinterStatusDetail(config: LoteadoraConfig): Promise<PrinterStatusDetail> {
  return queryPrinterStatus(config);
}

// Lista los nombres de mensaje guardados en la impresora (comando 1F).
export async function listMessageNames(config: LoteadoraConfig): Promise<string[]> {
  const frame = buildNoDataFrame(config.slaveAddress, CMD_REQUEST_MESSAGE_NAMES);
  const result = await sendCommand(config, frame, 5000);

  if (result.kind === 'nak') {
    throw new Error(`Comando rechazado por la loteadora: ${describeStatus(C_STATUS_MESSAGES, result.status)}`);
  }
  // Cabecera: ESC ACK Slave P_Status CmdID [NumFicheros] {[Len][Nombre]}... ESC ETX Checknum
  const data = result.data;
  // P_Status es el estado de la impresora, no del comando: con la impresión
  // parada (12) se aceptan los nombres si la respuesta los trae (más de los
  // 8 bytes de cabecera + cierre). Ver docs/loteadora.md §11.
  const traeNombres = data.length > 8;
  if (result.status !== 0x00 && !(result.status === 0x12 && traeNombres)) {
    throw new Error(`No se pudo listar las plantillas: ${describeStatus(P_STATUS_MESSAGES, result.status)}`);
  }

  const names: string[] = [];
  let offset = 5;
  const numFiles = data[offset]; offset += 1;
  for (let i = 0; i < numFiles && offset < data.length; i++) {
    const len = data[offset]; offset += 1;
    names.push(data.subarray(offset, offset + len).toString('ascii'));
    offset += len;
  }
  return names;
}

// Crea (o sobrescribe) un mensaje en la impresora enviándole su archivo .msg
// (comando 50; el archivo lo genera lib/loteadora-msg.ts). P_Status 01 = archivo
// demasiado grande o extensión no admitida; 12 (impresión parada) es estado, no rechazo.
export async function sendMessageFile(config: LoteadoraConfig, messageName: string, file: Buffer): Promise<void> {
  const frame = buildSendFileFrame(config.slaveAddress, `${messageName}.msg`, file);
  const result = await sendCommand(config, frame, 10000);
  console.log(`[loteadora ${config.ip}] crear ${JSON.stringify(messageName)} → 50: ${Array.from(result.data).map((x) => x.toString(16).padStart(2, '0')).join(' ')}`);

  if (result.kind === 'nak') {
    throw new Error(`Comando rechazado por la loteadora: ${describeStatus(C_STATUS_MESSAGES, result.status)}`);
  }
  if (result.status === 0x01) throw new Error('La loteadora no aceptó el archivo del mensaje (demasiado grande o formato no admitido)');
  if (result.status !== 0x00 && result.status !== 0x12) {
    throw new Error(`No se pudo crear el mensaje: ${describeStatus(P_STATUS_MESSAGES, result.status)}`);
  }
}

// Carga una plantilla existente en la impresora y la aplica (comandos 1E + 01).
// No exige la impresión iniciada: el 12 ("print not started") es el estado de
// la impresora, no un rechazo del comando (el manual lo dice así en 22/23/26/33:
// "Succeeded but print not started"), así que se sigue y se devuelve un aviso
// para que el operario lo confirme en la pantalla. Ver docs/loteadora.md §11.
export async function loadPrintMessage(config: LoteadoraConfig, messageName: string): Promise<{ warning: string | null }> {
  const loadFrame = buildLoadMessageFrame(config.slaveAddress, messageName);
  const loadResult = await sendCommand(config, loadFrame, 5000);

  if (loadResult.kind === 'nak') {
    throw new Error(`Comando rechazado por la loteadora: ${describeStatus(C_STATUS_MESSAGES, loadResult.status)}`);
  }
  if (loadResult.status !== 0x00 && loadResult.status !== 0x12) {
    throw new Error(`No se pudo cargar la plantilla "${messageName}": ${describeStatus(P_STATUS_MESSAGES, loadResult.status)}`);
  }

  // El ACK de 1E solo confirma que el mensaje existe ("00: Message name exist"),
  // no que la máquina haya terminado de leerlo. Si el 01 llega antes, aplica el
  // mensaje anterior: por eso a veces había que cargar dos veces.
  // ponytail: espera fija; si sigue fallando, subir LOAD_APPLY_DELAY_MS.
  await new Promise((r) => setTimeout(r, LOAD_APPLY_DELAY_MS));

  const updateFrame = buildNoDataFrame(config.slaveAddress, CMD_UPDATE_PRINT_CONTENTS);
  const updateResult = await sendCommand(config, updateFrame, 5000);

  if (updateResult.kind === 'nak') {
    throw new Error(`Comando rechazado por la loteadora al aplicar la plantilla: ${describeStatus(C_STATUS_MESSAGES, updateResult.status)}`);
  }
  if (updateResult.status !== 0x00 && updateResult.status !== 0x12) {
    throw new Error(`La plantilla se cargó pero no se pudo aplicar: ${describeStatus(P_STATUS_MESSAGES, updateResult.status)}`);
  }

  // Traza de cada carga (respuestas en crudo) para diagnosticar en planta.
  const hex = (b: Buffer) => Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join(' ');
  console.log(`[loteadora ${config.ip}] carga ${JSON.stringify(messageName)} → 1E: ${hex(loadResult.data)} | 01: ${hex(updateResult.data)}`);

  const parada = loadResult.status === 0x12 || updateResult.status === 0x12;
  return {
    warning: parada
      ? `Plantilla "${messageName}" enviada con la impresión parada: comprueba en la pantalla de la máquina que es la cargada antes de iniciar.`
      : null,
  };
}
