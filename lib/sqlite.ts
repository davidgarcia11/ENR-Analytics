import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { hashSync } from 'bcryptjs';
import { PANELS } from './panels';

const DB_PATH = path.join(process.cwd(), 'data', 'app.db');

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');

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
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Plantillas/mensajes configurados en las loteadoras (nombre global, debe
    -- coincidir exacto con el mensaje creado en la máquina) y los IDs de los
    -- tres Field Module que trae: lote, fecha de cocida y caducidad.
    CREATE TABLE IF NOT EXISTS loteadora_mensajes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      lot_field_id INTEGER NOT NULL,
      cocida_field_id INTEGER NOT NULL,
      expiry_field_id INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
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

    -- Mapeo mes -> código de ledger IELEDG de F30026 (coste real mensual, JDE). No hay
    -- fórmula fiable para deducir el código de cada mes (mismo problema que COLEDG_VIGENTE
    -- en api/compras/route.ts, pero mensual en vez de anual) — admin lo va añadiendo
    -- a mano cada mes desde /admin. Usado por /api/costes para el coste real
    -- ponderado por producción. Ver docs/costes.md.
    CREATE TABLE IF NOT EXISTS coste_a1_coledg_mensual (
      mes TEXT PRIMARY KEY,
      coledg TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );

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

    -- Lista global de artículos visibles en /muestras (si está vacía, se ven todos —
    -- comportamiento abierto por defecto hasta que admin/responsable la configuran).
    -- NO es por usuario: es una única lista compartida, editable por admin y por
    -- cualquier usuario con users.can_configure_muestras = 1 (ver más abajo).
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
  `);

  // Migración: BDs creadas con el esquema anterior (backfill por tramos) no tienen
  // last_synced_at/last_error todavía.
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
  // Permiso suelto (no un rol): quién puede editar sample_article_filter además de
  // admin. Se marca por usuario individual desde /admin, no por rol — petición
  // explícita del usuario ("si quiero que un usuario concreto tenga eso").
  if (!columns.some(c => c.name === 'can_configure_muestras')) {
    _db.exec("ALTER TABLE users ADD COLUMN can_configure_muestras INTEGER NOT NULL DEFAULT 0");
  }

  // Migración: añadir columna source a query_logs si no existe
  const logColumns = _db.prepare("PRAGMA table_info(query_logs)").all() as { name: string }[];
  if (!logColumns.some(c => c.name === 'source')) {
    _db.exec("ALTER TABLE query_logs ADD COLUMN source TEXT NOT NULL DEFAULT 'produccion'");
  }

  // Migración: añadir columna screen a presets si no existe
  const presetColumns = _db.prepare("PRAGMA table_info(presets)").all() as { name: string }[];
  if (!presetColumns.some(c => c.name === 'screen')) {
    _db.exec("ALTER TABLE presets ADD COLUMN screen TEXT NOT NULL DEFAULT 'produccion'");
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
  const seedScreen = _db.prepare(
    'INSERT OR IGNORE INTO screens (key, label, path, is_public) VALUES (?, ?, ?, 1)'
  );
  for (const p of PANELS) seedScreen.run(p.key, p.label, p.href);
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
