import Database from 'better-sqlite3';
import { MOTIVOS, RESPONSABLES } from './servicio';
import path from 'path';
import fs from 'fs';
import { hashSync } from 'bcryptjs';
import { PANELS } from './panels';
import { guardarCampos, type Campo } from './loteadora-plantilla';
import plantillasIniciales from './loteadora-plantillas-iniciales.json';

const DB_PATH = path.join(process.cwd(), 'data', 'app.db');

let _db: Database.Database | null = null;

// Copia de seguridad al arrancar: la primera vez que el proceso abre la BD, ANTES
// de crear tablas o aplicar migraciones, se guarda una copia completa en
// data/backups/ (VACUUM INTO, consistente aunque haya escrituras). Cada despliegue
// reinicia el servidor, así que siempre queda la BD tal como estaba antes de que la
// versión nueva la toque. Se conservan las COPIAS_A_GUARDAR más recientes.
// Nunca impide arrancar: si falla, se registra el error y se sigue.
// ponytail: una copia por arranque, no por versión; subir COPIAS_A_GUARDAR si se reinicia mucho.
const COPIAS_A_GUARDAR = 10;
export function copiaDeSeguridad(db: Database.Database, dir: string, conservar = COPIAS_A_GUARDAR): string | null {
  try {
    fs.mkdirSync(dir, { recursive: true });
    // Hora local en el nombre: es la que se busca al querer "la de antes de desplegar"
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    const cuando = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
    const destino = path.join(dir, `app-${cuando}.db`);
    if (fs.existsSync(destino)) return null; // dos arranques en el mismo segundo
    db.exec(`VACUUM INTO '${destino.replace(/'/g, "''")}'`);
    const copias = fs.readdirSync(dir).filter((f) => /^app-[\d-]+\.db$/.test(f)).sort();
    for (const vieja of copias.slice(0, Math.max(0, copias.length - conservar))) fs.unlinkSync(path.join(dir, vieja));
    console.log(`[sqlite] Copia de seguridad de la BD: ${destino}`);
    return destino;
  } catch (err) {
    console.error('[sqlite] No se pudo hacer la copia de seguridad de la BD al arrancar:', err);
    return null;
  }
}

export function getDb(): Database.Database {
  if (_db) return _db;

  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const existia = fs.existsSync(DB_PATH);
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  // Una sola copia por arranque del proceso: el seguimiento por ping (instrumentation.ts)
  // y la app cargan este módulo por separado y cada uno abre su conexión.
  const g = globalThis as { __copiaAlArrancar?: boolean };
  if (existia && !g.__copiaAlArrancar) {
    g.__copiaAlArrancar = true;
    copiaDeSeguridad(_db, path.join(path.dirname(DB_PATH), 'backups'));
  }

  // Crear tablas si no existen
  _db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      must_change_password INTEGER NOT NULL DEFAULT 0,
      name TEXT NOT NULL DEFAULT '',
      surname TEXT NOT NULL DEFAULT '',
      default_plant TEXT NOT NULL DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS presets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      filters TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, name)
    );

    CREATE TABLE IF NOT EXISTS query_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      username TEXT NOT NULL DEFAULT 'Invitado',
      source TEXT NOT NULL DEFAULT 'produccion',
      filters TEXT NOT NULL,
      result_count INTEGER,
      execution_time_ms INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS screens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      path TEXT NOT NULL,
      is_public INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS screen_permissions (
      screen_id INTEGER NOT NULL REFERENCES screens(id) ON DELETE CASCADE,
      role_id   INTEGER NOT NULL REFERENCES roles(id)   ON DELETE CASCADE,
      PRIMARY KEY (screen_id, role_id)
    );

    -- Permisos de configuración concedidos a un ROL (catálogo en lib/permisos.ts).
    -- Lo que puede hacer un usuario = lo de su rol + sus extras en user_permissions.
    CREATE TABLE IF NOT EXISTS role_permissions (
      role_id    INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      permission TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (role_id, permission)
    );

    -- Descripciones editables para los códigos de estado SYEDSP de JDE.
    -- Se usan en /comparativa-seres (tooltip del badge, columna Descripción,
    -- Excel) y son editables por admin desde /admin.
    CREATE TABLE IF NOT EXISTS jde_status_descriptions (
      code TEXT PRIMARY KEY,
      description TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Impresoras loteadoras (TIJ, protocolo TCP) gestionadas desde /admin.
    -- Los Field Module (lote/cocida/caducidad) ya no se configuran aquí por
    -- máquina: viven por mensaje (loteadora_mensajes), porque cada plantilla
    -- puede tener los campos en IDs distintos. Ver docs/loteadora.md.
    CREATE TABLE IF NOT EXISTS loteadoras (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      ip TEXT NOT NULL,
      port INTEGER NOT NULL,
      slave_address INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      linea TEXT NOT NULL DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Zonas de las loteadoras (Funes 1, Funes 2, Pasteurizado...), gestionadas en
    -- /admin → Zonas. A cada zona se le asignan roles y usuarios: deciden qué
    -- loteadoras ve cada uno. Reglas en lib/loteadora-zonas.ts.
    CREATE TABLE IF NOT EXISTS zonas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL UNIQUE,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS role_zonas (
      role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
      zona_id INTEGER NOT NULL REFERENCES zonas(id) ON DELETE CASCADE,
      PRIMARY KEY (role_id, zona_id)
    );
    -- Zonas propias de un usuario: SUSTITUYEN a las de su rol (no se suman).
    CREATE TABLE IF NOT EXISTS user_zonas (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      zona_id INTEGER NOT NULL REFERENCES zonas(id) ON DELETE CASCADE,
      PRIMARY KEY (user_id, zona_id)
    );

    -- Plantillas/mensajes configurados en las loteadoras (nombre global, debe
    -- coincidir exacto con el mensaje creado en la máquina). Sus campos (Field
    -- Module) y lo que se imprime en cada uno viven en loteadora_mensaje_segmentos.
    CREATE TABLE IF NOT EXISTS loteadora_mensajes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Piezas de cada campo de una plantilla (una fila por pieza, con el ID del
    -- Field Module al que pertenece): el texto de un campo es la concatenación de
    -- sus piezas por la columna orden. Modelo y formatos en lib/loteadora-plantilla.ts.
    CREATE TABLE IF NOT EXISTS loteadora_mensaje_segmentos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mensaje_id INTEGER NOT NULL REFERENCES loteadora_mensajes(id) ON DELETE CASCADE,
      orden INTEGER NOT NULL,
      field_id INTEGER NOT NULL,
      tipo TEXT NOT NULL,
      valor TEXT,
      nombre TEXT,
      formato TEXT
    );

    -- Dónde va cada campo en la etiqueta (línea 1-3 y espaciado): solo sirve para
    -- crear el mensaje en la máquina, ver disponerMensaje() en lib/loteadora-plantilla.ts.
    -- reloj es del antiguo "reloj detrás" (hueco para un reloj puesto a mano): ya no
    -- se usa, ahora el reloj es una pieza del campo (migración 'reloj-pieza').
    CREATE TABLE IF NOT EXISTS loteadora_mensaje_campos (
      mensaje_id INTEGER NOT NULL REFERENCES loteadora_mensajes(id) ON DELETE CASCADE,
      field_id INTEGER NOT NULL,
      linea INTEGER NOT NULL DEFAULT 1,
      reloj INTEGER NOT NULL DEFAULT 0,
      espaciado INTEGER,             -- NULL = el espaciado del mensaje
      tamano INTEGER,                -- NULL = el tamaño del mensaje
      PRIMARY KEY (mensaje_id, field_id)
    );

    -- Registro de todo lo enviado a las loteadoras desde /loteadora (trazabilidad, se
    -- guarda siempre). Copia los nombres de máquina y plantilla y no tiene claves
    -- ajenas: sigue valiendo aunque se borren. Ver lib/loteadora-registro.ts.
    CREATE TABLE IF NOT EXISTS loteadora_envios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      loteadora_id INTEGER NOT NULL,
      loteadora TEXT NOT NULL,
      usuario TEXT,
      plantilla TEXT NOT NULL,
      articulo_id TEXT NOT NULL,
      articulo_desc TEXT,
      campos TEXT NOT NULL,          -- JSON: [{ fieldId, texto }]
      datos TEXT NOT NULL,           -- JSON: lo rellenado (lote, cocida, turno...)
      resultado TEXT NOT NULL,       -- 'ok' | 'aviso' | 'error'
      mensaje TEXT,
      lineas TEXT                    -- JSON: la etiqueta colocada al enviar (trozosEtiqueta); NULL en los primeros envíos
    );
    CREATE INDEX IF NOT EXISTS idx_loteadora_envios_maquina ON loteadora_envios (loteadora_id, id);

    -- Seguimiento de conexión por ping (lib/loteadora-ping.ts): una fila por cambio
    -- (conexion / sin_conexion), una cada 30 min si no cambia y 'inicio' al arrancar
    -- el servidor. Sin claves ajenas: sigue valiendo aunque se borre la máquina.
    CREATE TABLE IF NOT EXISTS loteadora_ping (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fecha TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      loteadora_id INTEGER NOT NULL,
      loteadora TEXT NOT NULL,
      ip TEXT NOT NULL,
      estado TEXT NOT NULL,          -- 'conexion' | 'sin_conexion' | 'inicio'
      ms INTEGER                     -- tiempo de respuesta del ping (si respondió)
    );
    CREATE INDEX IF NOT EXISTS idx_loteadora_ping_maquina ON loteadora_ping (loteadora_id, id);

    -- Bandeja de entrada de la API de integración (lib/integracion.ts):
    -- cada mensaje recibido tal cual, válido o no. Por ahora no se procesa (estado
    -- 'recibido'); qué hace el panel con cada tipo se programará más adelante.
    CREATE TABLE IF NOT EXISTS integracion_mensajes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      tipo TEXT NOT NULL,            -- 'escaneo'
      origen TEXT NOT NULL,          -- 'real' | 'prueba' (con qué clave llegó)
      cuerpo TEXT NOT NULL,          -- el cuerpo tal cual llegó
      valido INTEGER NOT NULL,       -- 1 si cumplía el contrato
      errores TEXT,                  -- JSON: por qué no era válido
      id_externo TEXT,               -- "id" del mensaje (de quien envía), para no duplicar reintentos
      ip TEXT,
      estado TEXT NOT NULL DEFAULT 'recibido',
      clave_id INTEGER,              -- con qué clave llegó (api_claves.id)
      clave_nombre TEXT              -- su nombre, copiado: sigue valiendo si se elimina la clave
    );
    CREATE INDEX IF NOT EXISTS idx_integracion_mensajes_id_externo ON integracion_mensajes (tipo, origen, id_externo);

    -- Claves de API de los sistemas externos (lib/api-claves.ts), gestionadas desde
    -- /admin → Integración › Claves de API. Solo la huella SHA-256, nunca la clave.
    CREATE TABLE IF NOT EXISTS api_claves (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      prefijo TEXT NOT NULL,         -- lo visible de la clave: "enr_live_3f9a"
      hash TEXT NOT NULL UNIQUE,     -- SHA-256 de la clave completa
      entorno TEXT NOT NULL,         -- 'real' | 'prueba'
      ambitos TEXT NOT NULL,         -- JSON: APIs a las que da acceso (AMBITOS)
      notas TEXT,
      caduca_el TEXT,                -- último día en que vale (AAAA-MM-DD, local); NULL = sin caducidad
      creada_por TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      revocada_por TEXT,
      revocada_at TEXT,
      ultimo_uso_at TEXT,
      ultimo_uso_ip TEXT
    );

    -- Último envío hecho desde /loteadora a cada máquina (se sobrescribe en cada
    -- envío correcto): se enseña en "Estado de las loteadoras". Es lo último que
    -- mandó el panel, no lo que tenga la máquina si se cambió a mano en ella.
    CREATE TABLE IF NOT EXISTS loteadora_ultimo_envio (
      loteadora_id INTEGER PRIMARY KEY REFERENCES loteadoras(id) ON DELETE CASCADE,
      plantilla TEXT NOT NULL,
      campos TEXT NOT NULL,          -- JSON: [{ fieldId, texto }]
      usuario TEXT,
      enviado_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- Último valor enviado de cada "dato a introducir" (pieza 'manual') por
    -- plantilla: /loteadora lo propone al elegir un artículo con esa plantilla.
    CREATE TABLE IF NOT EXISTS loteadora_manuales_ultimos (
      mensaje_id INTEGER NOT NULL REFERENCES loteadora_mensajes(id) ON DELETE CASCADE,
      nombre TEXT NOT NULL,
      valor TEXT NOT NULL,
      PRIMARY KEY (mensaje_id, nombre)
    );

    -- Medidas con las que se creó cada mensaje en cada máquina (fuente, tamaño,
    -- espaciado, ancho por carácter, separación entre líneas): se proponen al
    -- volver a crearlo. tres_lineas: para proponer, a un mensaje que aún no se ha
    -- creado en esa máquina, lo último usado allí con el mismo nº de líneas.
    CREATE TABLE IF NOT EXISTS loteadora_medidas_mensaje (
      mensaje_id INTEGER NOT NULL REFERENCES loteadora_mensajes(id) ON DELETE CASCADE,
      loteadora_id INTEGER NOT NULL REFERENCES loteadoras(id) ON DELETE CASCADE,
      tres_lineas INTEGER NOT NULL DEFAULT 0,
      fuente TEXT NOT NULL,
      tamano INTEGER NOT NULL,
      espaciado INTEGER NOT NULL,
      ancho INTEGER NOT NULL,
      interlineado INTEGER NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (mensaje_id, loteadora_id)
    );

    -- Asociación artículo (F4101.IMLITM) -> plantilla. Global: el mismo
    -- artículo usa siempre el mismo mensaje, sea cual sea la loteadora.
    CREATE TABLE IF NOT EXISTS loteadora_articulo_mensajes (
      articulo_id TEXT PRIMARY KEY,
      mensaje_id INTEGER NOT NULL REFERENCES loteadora_mensajes(id) ON DELETE CASCADE,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Registro de aceptación del pop-up de /consulta-stock-pda: qué mensaje se le mostró al
    -- operario al escanear un SSCC y quién/cuándo lo aceptó. Trazabilidad para el caso de que
    -- un producto se meta erróneamente en línea: saber a quién le salió el aviso y cuál era.
    CREATE TABLE IF NOT EXISTS stock_scan_confirmations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      username TEXT NOT NULL DEFAULT 'Invitado',
      sscc TEXT NOT NULL,
      articulo TEXT,
      estado TEXT NOT NULL,
      mensajes TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- (eliminada) coste_a1_coledg_mensual: mapeo mes -> ledger IELEDG de F30026 para el
    -- coste real de /costes. Esos ledgers mensuales no existen en F30026, así que el coste
    -- real salía siempre vacío; ahora sale de las órdenes de fabricación costeadas
    -- (F554105 + F55CR001) y no hay nada que configurar. No se hace DROP a propósito: la
    -- tabla queda huérfana en las instalaciones ya desplegadas, sin uso y sin molestar.

    -- Estado editable de /muestras (pendiente/enviado/completado) + observación libre por
    -- lote. No viene de JDE: es una capa propia sobre el listado de producción real
    -- (F4111/F4101/F4108), igual que jde_status_descriptions es una capa propia sobre datos
    -- de JDE. Clave natural (articulo, lote), no id autoincremental: un solo registro por
    -- combinación, se actualiza con upsert (ON CONFLICT) en vez de buscar-y-editar.
    CREATE TABLE IF NOT EXISTS sample_tracking (
      articulo TEXT NOT NULL,
      lote TEXT NOT NULL,
      estado TEXT NOT NULL DEFAULT 'pendiente',
      observacion TEXT NOT NULL DEFAULT '',
      updated_by TEXT,
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (articulo, lote)
    );

    -- Datos manuales de /servicio (nivel de servicio): lo que JDE no sabe de cada envío
    -- (pedido + albarán SDDELN; albaran 0 = aún sin albarán). Capa propia sobre F4211,
    -- mismo patrón que sample_tracking: clave natural + upsert. ver docs/servicio.md
    CREATE TABLE IF NOT EXISTS order_service_tracking (
      pedido INTEGER NOT NULL,
      albaran INTEGER NOT NULL DEFAULT 0,
      transportista TEXT NOT NULL DEFAULT '',
      fecha_entrega_real TEXT,
      responsable TEXT NOT NULL DEFAULT '',
      motivo TEXT NOT NULL DEFAULT '',
      incidencia TEXT NOT NULL DEFAULT '',
      uds_afectadas INTEGER NOT NULL DEFAULT 0,
      cajas_afectadas REAL NOT NULL DEFAULT 0,
      updated_by TEXT,
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (pedido, albaran)
    );

    -- Desglose por artículo (SDLITM) de las afectadas de un envío de /servicio. Si un envío
    -- tiene filas aquí, uds_afectadas/cajas_afectadas de order_service_tracking son su suma;
    -- si no, son lo anotado antes «sin desglose». Solo filas con algo anotado. ver docs/servicio.md §18
    CREATE TABLE IF NOT EXISTS order_service_incidencia_articulo (
      pedido INTEGER NOT NULL,
      albaran INTEGER NOT NULL,
      articulo TEXT NOT NULL,
      uds INTEGER NOT NULL DEFAULT 0,
      cajas REAL NOT NULL DEFAULT 0,
      PRIMARY KEY (pedido, albaran, articulo)
    );

    -- Lista global de artículos visibles en /muestras (si está vacía, se ven todos —
    -- comportamiento abierto por defecto hasta que admin/responsable la configuran).
    -- NO es por usuario: es una única lista compartida, editable por admin y por
    -- cualquier usuario con el permiso 'muestras.config' (lib/permisos.ts).
    CREATE TABLE IF NOT EXISTS sample_article_filter (
      articulo TEXT PRIMARY KEY,
      descripcion TEXT NOT NULL DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Caché local de /muestras: qué combinaciones artículo+lote ha producido JDE
    -- (F4111.ILDCT='IC', tipo 12) PARA LOS ARTÍCULOS CONFIGURADOS EN
    -- sample_article_filter. El panel SIEMPRE lee de aquí, nunca de Oracle en directo.
    -- fecha_jde = F4111.ILTRDJ, solo informativo (para el filtro de fechas del panel) —
    -- ver docs/muestras.md §"Caché y sincronización" para el porqué de este diseño.
    CREATE TABLE IF NOT EXISTS sample_candidates (
      articulo TEXT NOT NULL,
      lote TEXT NOT NULL,
      descripcion TEXT NOT NULL DEFAULT '',
      marca TEXT NOT NULL DEFAULT '',
      fecha_jde INTEGER,
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (articulo, lote)
    );

    -- Estado de la sincronización de sample_candidates. Fila única (id=1). Sin marca de
    -- agua ni backfill por tramos: la sincronización siempre trae TODO el histórico de
    -- los artículos configurados de una vez (rápido — filtrar por artículo permite a
    -- Oracle usar un índice que sin ese filtro no usaba, ver docs/muestras.md), así que
    -- nunca hace falta llevar la cuenta de "hasta dónde se llegó".
    CREATE TABLE IF NOT EXISTS sample_sync_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      last_synced_at TEXT,
      candidatos_sincronizados INTEGER NOT NULL DEFAULT 0,
      last_error TEXT
    );
    INSERT OR IGNORE INTO sample_sync_state (id) VALUES (1);

    -- Permisos sueltos por usuario (no por rol): acceso a una configuración concreta
    -- para alguien que no es admin. El catálogo de claves vive en lib/permisos.ts;
    -- el admin los tiene todos sin necesidad de fila aquí.
    CREATE TABLE IF NOT EXISTS user_permissions (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      permission TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, permission)
    );
  `);

  // Migración: BDs creadas con el esquema anterior (backfill por tramos) no tienen
  // last_synced_at/last_error todavía.
  // Listas desplegables de /servicio (/admin → Listas de servicio). Se crea aquí y no en el
  // bloque de CREATE de arriba para cargar los motivos y responsables iniciales SOLO la
  // primera vez (si se vaciara la lista a propósito, no debe volver a rellenarse al arrancar).
  if (!_db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'servicio_catalogo'").get()) {
    _db.exec(`
      CREATE TABLE servicio_catalogo (
        tipo TEXT NOT NULL,
        nombre TEXT NOT NULL,
        activo INTEGER NOT NULL DEFAULT 1,
        orden INTEGER NOT NULL DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (tipo, nombre)
      );
    `);
    const alta = _db.prepare('INSERT INTO servicio_catalogo (tipo, nombre, orden) VALUES (?, ?, ?)');
    MOTIVOS.forEach((n, i) => alta.run('motivo', n, i));
    RESPONSABLES.forEach((n, i) => alta.run('responsable', n, i));
  }

  // Migración: los datos manuales de /servicio se indexaban por camión; ahora por albarán.
  // La rama aún no se había publicado, así que no hay filas reales que convertir.
  const servicioCols = _db.prepare("PRAGMA table_info(order_service_tracking)").all() as { name: string }[];
  if (servicioCols.some(c => c.name === 'camion')) {
    _db.exec("ALTER TABLE order_service_tracking RENAME COLUMN camion TO albaran");
  }
  // Las afectadas se pueden anotar en unidades o en cajas: se guardan las dos (ver docs/servicio.md §16)
  if (!servicioCols.some(c => c.name === 'cajas_afectadas')) {
    _db.exec("ALTER TABLE order_service_tracking ADD COLUMN cajas_afectadas REAL NOT NULL DEFAULT 0");
  }

  const syncStateCols = _db.prepare("PRAGMA table_info(sample_sync_state)").all() as { name: string }[];
  if (!syncStateCols.some(c => c.name === 'last_synced_at')) {
    _db.exec("ALTER TABLE sample_sync_state ADD COLUMN last_synced_at TEXT");
  }
  if (!syncStateCols.some(c => c.name === 'last_error')) {
    _db.exec("ALTER TABLE sample_sync_state ADD COLUMN last_error TEXT");
  }

  // Migración: añadir columna must_change_password si no existe (para BDs creadas antes de esta versión)
  const columns = _db.prepare("PRAGMA table_info(users)").all() as { name: string }[];
  if (!columns.some(c => c.name === 'must_change_password')) {
    _db.exec("ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0");
  }
  if (!columns.some(c => c.name === 'name')) {
    _db.exec("ALTER TABLE users ADD COLUMN name TEXT NOT NULL DEFAULT ''");
  }
  if (!columns.some(c => c.name === 'surname')) {
    _db.exec("ALTER TABLE users ADD COLUMN surname TEXT NOT NULL DEFAULT ''");
  }
  if (!columns.some(c => c.name === 'default_plant')) {
    _db.exec("ALTER TABLE users ADD COLUMN default_plant TEXT NOT NULL DEFAULT ''");
  }
  // Migración: la columna suelta can_configure_muestras pasa a ser el permiso
  // 'muestras.config' de user_permissions (quien lo tenía lo conserva) y se quita.
  if (columns.some(c => c.name === 'can_configure_muestras')) {
    _db.transaction(() => {
      _db!.exec(`INSERT OR IGNORE INTO user_permissions (user_id, permission)
                 SELECT id, 'muestras.config' FROM users WHERE can_configure_muestras = 1`);
      _db!.exec("ALTER TABLE users DROP COLUMN can_configure_muestras");
    })();
  }

  // Migración: añadir columna source a query_logs si no existe
  const logColumns = _db.prepare("PRAGMA table_info(query_logs)").all() as { name: string }[];
  if (!logColumns.some(c => c.name === 'source')) {
    _db.exec("ALTER TABLE query_logs ADD COLUMN source TEXT NOT NULL DEFAULT 'produccion'");
  }

  // Migración: con qué clave llegó cada mensaje de integración (BDs de la v1.28.0)
  const integracionColumns = _db.prepare("PRAGMA table_info(integracion_mensajes)").all() as { name: string }[];
  if (!integracionColumns.some(c => c.name === 'clave_id')) {
    _db.exec("ALTER TABLE integracion_mensajes ADD COLUMN clave_id INTEGER");
    _db.exec("ALTER TABLE integracion_mensajes ADD COLUMN clave_nombre TEXT");
  }

  // Un id de mensaje válido solo una vez por tipo y clase de clave (lib/integracion.ts),
  // garantizado también en la BD. Protegido: si una BD tuviera repetidos, se avisa y arranca.
  try {
    _db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS ux_integracion_mensajes_id_valido
      ON integracion_mensajes (tipo, origen, id_externo) WHERE valido = 1 AND id_externo IS NOT NULL`);
  } catch (e) {
    console.error('[integración] no se pudo crear el índice único de mensajes (¿ids repetidos?):', e);
  }

  // Migración: añadir columna screen a presets si no existe
  const presetColumns = _db.prepare("PRAGMA table_info(presets)").all() as { name: string }[];
  if (!presetColumns.some(c => c.name === 'screen')) {
    _db.exec("ALTER TABLE presets ADD COLUMN screen TEXT NOT NULL DEFAULT 'produccion'");
  }
  // Migración: preset predeterminado (el que se aplica al abrir el panel; solo uno por usuario y panel)
  if (!presetColumns.some(c => c.name === 'es_predeterminado')) {
    _db.exec("ALTER TABLE presets ADD COLUMN es_predeterminado INTEGER NOT NULL DEFAULT 0");
  }

  // Migración: quitar columna message_name de loteadoras si existe (BDs creadas
  // antes de que la plantilla pasara a elegirse en vivo desde /loteadora)
  const loteadoraColumns = _db.prepare("PRAGMA table_info(loteadoras)").all() as { name: string }[];
  if (loteadoraColumns.some(c => c.name === 'message_name')) {
    _db.exec("ALTER TABLE loteadoras DROP COLUMN message_name");
  }

  // Migración: quitar lot_field_id/expiry_field_id de loteadoras si existen
  // (BDs creadas antes de que los IDs de campo pasaran a vivir por mensaje,
  // ver loteadora_mensajes)
  if (loteadoraColumns.some(c => c.name === 'lot_field_id')) {
    _db.exec("ALTER TABLE loteadoras DROP COLUMN lot_field_id");
  }
  if (loteadoraColumns.some(c => c.name === 'expiry_field_id')) {
    _db.exec("ALTER TABLE loteadoras DROP COLUMN expiry_field_id");
  }

  // Migración: añadir columna linea a loteadoras si no existe (BDs creadas
  // antes de que la línea de fabricación se asignara por loteadora).
  if (!loteadoraColumns.some(c => c.name === 'linea')) {
    _db.exec("ALTER TABLE loteadoras ADD COLUMN linea TEXT NOT NULL DEFAULT ''");
  }
  // Familias de artículo (F4101.IMSRP2) que ofrece /loteadora para esta máquina,
  // separadas por comas. Vacío = todas.
  if (!loteadoraColumns.some(c => c.name === 'familias')) {
    _db.exec("ALTER TABLE loteadoras ADD COLUMN familias TEXT NOT NULL DEFAULT ''");
  }
  // Caducidad según el turno de cada plantilla (JSON { "3": 1 }; NULL = sin ajuste)
  const mensajesColumns = _db.prepare("PRAGMA table_info(loteadora_mensajes)").all() as { name: string }[];
  if (!mensajesColumns.some(c => c.name === 'ajuste_turno')) {
    _db.exec('ALTER TABLE loteadora_mensajes ADD COLUMN ajuste_turno TEXT');
  }
  // Etiqueta colocada en el registro de envíos (tabla creada en v1.21.0 sin esta columna)
  const enviosColumns = _db.prepare("PRAGMA table_info(loteadora_envios)").all() as { name: string }[];
  if (!enviosColumns.some(c => c.name === 'lineas')) {
    _db.exec('ALTER TABLE loteadora_envios ADD COLUMN lineas TEXT');
  }
  // Espaciado propio de cada campo (tabla creada en v1.11.0 sin esta columna)
  const camposColumns = _db.prepare("PRAGMA table_info(loteadora_mensaje_campos)").all() as { name: string }[];
  if (!camposColumns.some(c => c.name === 'espaciado')) {
    _db.exec('ALTER TABLE loteadora_mensaje_campos ADD COLUMN espaciado INTEGER');
  }
  if (!camposColumns.some((c) => c.name === 'tamano')) {
    _db.exec('ALTER TABLE loteadora_mensaje_campos ADD COLUMN tamano INTEGER');
  }
  // Zona de la loteadora (informativa y para decidir quién la ve). Al borrar la
  // zona, la loteadora se queda sin zona.
  if (!loteadoraColumns.some(c => c.name === 'zona_id')) {
    _db.exec('ALTER TABLE loteadoras ADD COLUMN zona_id INTEGER REFERENCES zonas(id) ON DELETE SET NULL');
  }

  // Migración: las plantillas tenían un ID de campo fijo por dato (columnas
  // lot/cocida/expiry/hora/turno/linea_field_id). Pasan a campos con piezas
  // (loteadora_mensaje_segmentos): cada columna se convierte en un campo con una
  // sola pieza de ese tipo, sin literales, y la caducidad en DD/MM/AAAA (lo que se
  // imprimía hasta ahora). Si dos columnas compartían ID (las que se añadieron
  // después valían 0 por defecto) gana la primera. Antes de tocar nada se guarda
  // una copia completa de la BD junto a app.db, por si hubiera que volver atrás.
  const mensajeColumns = _db.prepare("PRAGMA table_info(loteadora_mensajes)").all() as { name: string }[];
  const COLUMNAS_CAMPO = [
    ['lot_field_id', 'fresco', null],
    ['cocida_field_id', 'cocida', 'AAJJJ'],
    ['expiry_field_id', 'caducidad', 'DD/MM/AAAA'],
    ['hora_field_id', 'hora', null],
    ['turno_field_id', 'turno', null],
    ['linea_field_id', 'linea', null],
  ] as const;
  const columnasViejas = COLUMNAS_CAMPO.filter(([col]) => mensajeColumns.some(c => c.name === col));
  if (columnasViejas.length > 0) {
    const copia = `${DB_PATH}.pre-plantillas-campos-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}`;
    _db.exec(`VACUUM INTO '${copia.replace(/'/g, "''")}'`);

    _db.transaction(() => {
      const mensajes = _db!.prepare(`SELECT id, ${columnasViejas.map(([col]) => col).join(', ')} FROM loteadora_mensajes`).all() as Record<string, number>[];
      const insertar = _db!.prepare(
        'INSERT INTO loteadora_mensaje_segmentos (mensaje_id, orden, field_id, tipo, formato) VALUES (?, ?, ?, ?, ?)'
      );
      for (const m of mensajes) {
        const usados = new Set<number>();
        columnasViejas.forEach(([col, tipo, formato], i) => {
          const fieldId = m[col];
          if (usados.has(fieldId)) return;
          usados.add(fieldId);
          insertar.run(m.id, i * 1000, fieldId, tipo, formato);
        });
      }
      for (const [col] of columnasViejas) _db!.exec(`ALTER TABLE loteadora_mensajes DROP COLUMN ${col}`);
    })();
  }

  // Carga de las plantillas del "nuevo loteado" (N01…N17, mensajes creados en la
  // máquina con el comando 1C, ver docs/loteadora.md §9). Se hace UNA sola vez
  // por BD (marca en `migraciones`): si luego se borra o renombra una plantilla
  // desde /admin, no reaparece en el siguiente arranque. Si ya existe una con el
  // mismo nombre, no se toca.
  _db.exec('CREATE TABLE IF NOT EXISTS migraciones (clave TEXT PRIMARY KEY, aplicada_at TEXT DEFAULT CURRENT_TIMESTAMP)');
  if (!_db.prepare("SELECT 1 FROM migraciones WHERE clave = 'plantillas-nuevo-loteado'").get()) {
    _db.transaction(() => {
      const existe = _db!.prepare('SELECT 1 FROM loteadora_mensajes WHERE name = ?');
      const insertar = _db!.prepare('INSERT INTO loteadora_mensajes (name) VALUES (?)');
      for (const p of plantillasIniciales as { name: string; campos: Campo[] }[]) {
        if (existe.get(p.name)) continue;
        guardarCampos(_db!, Number(insertar.run(p.name).lastInsertRowid), p.campos);
      }
      _db!.prepare("INSERT INTO migraciones (clave) VALUES ('plantillas-nuevo-loteado')").run();
    })();
  }

  // Disposición (línea y hueco del reloj) de los N01…N17 en las BD donde ya se
  // dieron de alta sin ella (v1.10.0). Una sola vez; solo a las plantillas que
  // aún no tengan ninguna disposición guardada, para no pisar lo ajustado a mano.
  if (!_db.prepare("SELECT 1 FROM migraciones WHERE clave = 'disposicion-nuevo-loteado'").get()) {
    _db.transaction(() => {
      const idDe = _db!.prepare('SELECT id FROM loteadora_mensajes WHERE name = ?');
      const tiene = _db!.prepare('SELECT 1 FROM loteadora_mensaje_campos WHERE mensaje_id = ?');
      const insertar = _db!.prepare('INSERT OR IGNORE INTO loteadora_mensaje_campos (mensaje_id, field_id, linea, reloj) VALUES (?, ?, ?, ?)');
      for (const p of plantillasIniciales as { name: string; campos: (Campo & { reloj?: boolean })[] }[]) {
        const m = idDe.get(p.name) as { id: number } | undefined;
        if (!m || tiene.get(m.id)) continue;
        for (const c of p.campos) insertar.run(m.id, c.fieldId, c.linea ?? 1, c.reloj ? 1 : 0);
      }
      _db!.prepare("INSERT INTO migraciones (clave) VALUES ('disposicion-nuevo-loteado')").run();
    })();
  }

  // "Reloj detrás" (hueco para un reloj puesto a mano) pasa a ser un reloj de verdad,
  // ahora que el panel crea el mensaje con reloj: al final del campo, un texto " " y
  // una pieza reloj HHmm (la misma etiqueta que antes). Una sola vez.
  if (!_db.prepare("SELECT 1 FROM migraciones WHERE clave = 'reloj-pieza'").get()) {
    _db.transaction(() => {
      const conReloj = _db!.prepare('SELECT mensaje_id, field_id FROM loteadora_mensaje_campos WHERE reloj = 1').all() as
        { mensaje_id: number; field_id: number }[];
      const ultimo = _db!.prepare('SELECT MAX(orden) AS orden FROM loteadora_mensaje_segmentos WHERE mensaje_id = ? AND field_id = ?');
      const insertar = _db!.prepare('INSERT INTO loteadora_mensaje_segmentos (mensaje_id, orden, field_id, tipo, valor, formato) VALUES (?, ?, ?, ?, ?, ?)');
      for (const c of conReloj) {
        const { orden } = ultimo.get(c.mensaje_id, c.field_id) as { orden: number | null };
        if (orden === null) continue;
        insertar.run(c.mensaje_id, orden + 1, c.field_id, 'texto', ' ', null);
        insertar.run(c.mensaje_id, orden + 2, c.field_id, 'reloj', null, 'HHmm');
      }
      _db!.prepare('UPDATE loteadora_mensaje_campos SET reloj = 0').run();
      _db!.prepare("INSERT INTO migraciones (clave) VALUES ('reloj-pieza')").run();
    })();
  }

  // Permisos de la loteadora: de uno por sección a uno por acción (ver, crear y
  // editar, eliminar...). Cada permiso antiguo se convierte en lo que ya dejaba
  // hacer, sin dar nada nuevo (eliminar seguía siendo del admin). Una sola vez.
  if (!_db.prepare("SELECT 1 FROM migraciones WHERE clave = 'permisos-por-accion'").get()) {
    const equivalentes: Record<string, string[]> = {
      'admin.loteadora.maquinas': ['maquinas.ver', 'maquinas.editar', 'zonas.ver'],
      'admin.loteadora.plantillas': ['plantillas.ver', 'plantillas.editar', 'plantillas.crear-en-maquina'],
      'admin.loteadora.articulos': ['articulos.ver', 'articulos.editar', 'articulos.eliminar'],
      'admin.loteadora.datos-fijos': ['datos-fijos.ver', 'datos-fijos.editar'],
    };
    _db.transaction(() => {
      for (const [tabla, col] of [['user_permissions', 'user_id'], ['role_permissions', 'role_id']]) {
        for (const [antiguo, nuevos] of Object.entries(equivalentes)) {
          for (const nuevo of nuevos) {
            _db!.prepare(`INSERT OR IGNORE INTO ${tabla} (${col}, permission) SELECT ${col}, ? FROM ${tabla} WHERE permission = ?`)
              .run(`admin.loteadora.${nuevo}`, antiguo);
          }
          _db!.prepare(`DELETE FROM ${tabla} WHERE permission = ?`).run(antiguo);
        }
      }
      _db!.prepare("INSERT INTO migraciones (clave) VALUES ('permisos-por-accion')").run();
    })();
  }

  // Arial: el ancho por carácter por defecto pasa de tamaño × 0,6 a tamaño × 33/35 (medido
  // en la máquina con el .msg). Una vez, y solo a las medidas guardadas con el valor por
  // defecto antiguo: las ajustadas a mano se dejan.
  if (!_db.prepare("SELECT 1 FROM migraciones WHERE clave = 'ancho-arial-33'").get()) {
    _db.transaction(() => {
      _db!.prepare(
        `UPDATE loteadora_medidas_mensaje SET ancho = MAX(1, CAST(ROUND(tamano * 33.0 / 35) AS INTEGER) + espaciado)
         WHERE fuente = 'Arial' AND ancho = MAX(1, CAST(ROUND(tamano * 0.6) AS INTEGER) + espaciado)`
      ).run();
      _db!.prepare("INSERT INTO migraciones (clave) VALUES ('ancho-arial-33')").run();
    })();
  }

  // N10_KERETS: el certificado Kosher pasa de dato fijo a dato a introducir (cambia
  // a menudo). Una sola vez, y solo si sigue con el valor inventado K-000000: si
  // ya se puso el real, se deja como está (se cambia a mano en el constructor).
  if (!_db.prepare("SELECT 1 FROM migraciones WHERE clave = 'kosher-a-introducir'").get()) {
    _db.transaction(() => {
      _db!.prepare(
        `UPDATE loteadora_mensaje_segmentos SET tipo = 'manual', valor = NULL, nombre = 'Nº certificado Kosher'
         WHERE tipo = 'fijo' AND nombre = 'Certificado Kosher' AND valor = 'K-000000'
           AND mensaje_id IN (SELECT id FROM loteadora_mensajes WHERE name = 'N10_KERETS')`
      ).run();
      _db!.prepare("INSERT INTO migraciones (clave) VALUES ('kosher-a-introducir')").run();
    })();
  }

  // Zonas iniciales, una sola vez por BD (luego se gestionan en /admin → Zonas;
  // si se borra una no reaparece).
  if (!_db.prepare("SELECT 1 FROM migraciones WHERE clave = 'zonas-iniciales'").get()) {
    _db.transaction(() => {
      const insertar = _db!.prepare('INSERT OR IGNORE INTO zonas (nombre) VALUES (?)');
      for (const nombre of ['Funes 1', 'Funes 2', 'Pasteurizado']) insertar.run(nombre);
      _db!.prepare("INSERT INTO migraciones (clave) VALUES ('zonas-iniciales')").run();
    })();
  }

  // Migración: el panel "Costes" cambió de key/URL — 'coste_a1' → 'costes' (y
  // /coste-a1 → /costes). El seed de más abajo busca la fila por `key` e
  // inserta una nueva con INSERT OR IGNORE si no la encuentra: sin este UPDATE
  // antes, nacería una fila nueva PÚBLICA por defecto y la vieja (con los
  // permisos ya concedidos, referenciados por screen_id en screen_permissions)
  // quedaría huérfana — un panel restringido se abriría a todo el mundo sin
  // que nadie lo pidiera. Actualizar en sitio conserva el id y por tanto los
  // permisos ya concedidos. Idempotente: tras la primera vez ya no hay ninguna
  // fila con key='coste_a1', así que no vuelve a tocar nada.
  _db.exec("UPDATE screens SET key = 'costes', path = '/costes' WHERE key = 'coste_a1'");

  // Seed roles base (idempotente)
  _db.exec(`
    INSERT OR IGNORE INTO roles (name, label) VALUES ('admin', 'Administrador');
    INSERT OR IGNORE INTO roles (name, label) VALUES ('user', 'Usuario');
  `);

  // Seed pantallas (idempotente) — derivado de PANELS (lib/panels.ts), la fuente única
  // de paneles. Públicas por defecto; restringible luego desde /admin sin tocar código.
  // `privado: true` en PANELS (hoy solo /loteadora) nace con is_public = 0. Solo
  // aplica al alta: si ya existe la fila, INSERT OR IGNORE no la toca, así que lo
  // que haya configurado admin desde /admin → Pantallas manda siempre.
  const seedScreen = _db.prepare(
    'INSERT OR IGNORE INTO screens (key, label, path, is_public) VALUES (?, ?, ?, ?)'
  );
  for (const p of PANELS) seedScreen.run(p.key, p.label, p.href, 'privado' in p && p.privado ? 0 : 1);
  // Sincroniza el label si un panel se renombra en PANELS (INSERT OR IGNORE de
  // arriba no toca filas ya existentes) — label no es editable desde /admin, así
  // que PANELS sigue siendo la única fuente de verdad también tras el seed inicial.
  const syncScreenLabel = _db.prepare('UPDATE screens SET label = ? WHERE key = ? AND label != ?');
  for (const p of PANELS) syncScreenLabel.run(p.label, p.key, p.label);
  // 'admin' no es un panel real (no vive en PANELS) y es privado por defecto.
  _db.exec(`
    INSERT OR IGNORE INTO screens (key, label, path, is_public) VALUES ('admin', 'Administración', '/admin', 0);
  `);

  // Seed: rol admin tiene acceso a pantalla admin (idempotente)
  _db.exec(`
    INSERT OR IGNORE INTO screen_permissions (screen_id, role_id)
    SELECT s.id, r.id FROM screens s, roles r WHERE s.key = 'admin' AND r.name = 'admin';
  `);

  // Seed descripciones de estados JDE (idempotente). Si admin las edita en
  // producción, el INSERT OR IGNORE no las sobreescribe en futuros despliegues.
  _db.exec(`
    INSERT OR IGNORE INTO jde_status_descriptions (code, description) VALUES ('Y', 'Procesado y con pedido creado');
    INSERT OR IGNORE INTO jde_status_descriptions (code, description) VALUES ('M', 'Pedido que ha llegado dos veces (M de Modificado)');
    INSERT OR IGNORE INTO jde_status_descriptions (code, description) VALUES ('N', 'Sin procesar, el report de JDE todavía no ha intentado crear el pedido');
    INSERT OR IGNORE INTO jde_status_descriptions (code, description) VALUES ('E', 'Error, no ha podido crear el pedido porque algo falla');
  `);

  // Crear admin por defecto si no existe ningún usuario
  const count = _db.prepare('SELECT COUNT(*) as cnt FROM users').get() as { cnt: number };
  if (count.cnt === 0) {
    const hash = hashSync('admin123', 10);
    _db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run('admin', hash, 'admin');
  }

  return _db;
}
