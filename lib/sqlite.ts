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
    -- (F4111.ILDCT='IC', tipo 12). El panel SIEMPRE lee de aquí, nunca de Oracle en
    -- directo — evita repetir en cada carga una consulta que en rangos amplios es
    -- lenta o inestable en este JDE (ver docs/muestras.md §"Caché y sincronización").
    -- fecha_jde = F4111.ILTRDJ (fecha de negocio, puede ir "hacia atrás").
    CREATE TABLE IF NOT EXISTS sample_candidates (
      articulo TEXT NOT NULL,
      lote TEXT NOT NULL,
      descripcion TEXT NOT NULL DEFAULT '',
      marca TEXT NOT NULL DEFAULT '',
      fecha_jde INTEGER,
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (articulo, lote)
    );

    -- Estado de la sincronización de sample_candidates. Fila única (id=1).
    -- last_synced_jde usa F4111.ILTRDJ, no ILCRDJ — probado contra Oracle real que
    -- filtrar por ILCRDJ es sistemáticamente lento (60-70s incluso para 1 día y 0
    -- filas), aunque en teoría fuera la marca de agua "correcta" (nunca retrocede).
    -- Con ILTRDJ + margen de solape en cada sync (ver lib/muestras.ts) se cubre el
    -- caso real sin ese coste. Detalle completo en docs/muestras.md.
    -- last_synced_jde: marca de agua del repaso INCREMENTAL (cada 30 min, ver
    -- lib/muestras.ts). backfill_cursor_jde: progreso del backfill HISTÓRICO — campo
    -- separado a propósito: si compartieran uno, el repaso incremental (que solo mira
    -- los últimos días) podría avanzar la marca y hacer que un backfill interrumpido
    -- "se salte" todo el histórico pendiente al reanudarlo.
    CREATE TABLE IF NOT EXISTS sample_sync_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      last_synced_jde INTEGER NOT NULL DEFAULT 0,
      backfill_cursor_jde INTEGER NOT NULL DEFAULT 0,
      backfill_status TEXT NOT NULL DEFAULT 'pending',
      backfill_started_at TEXT,
      backfill_completed_at TEXT,
      backfill_progress TEXT,
      backfill_error TEXT,
      candidatos_sincronizados INTEGER NOT NULL DEFAULT 0
    );
    INSERT OR IGNORE INTO sample_sync_state (id) VALUES (1);
  `);

  // Migración: añadir backfill_cursor_jde si no existe (BDs creadas antes de este campo)
  const syncStateColumns = _db.prepare("PRAGMA table_info(sample_sync_state)").all() as { name: string }[];
  if (!syncStateColumns.some(c => c.name === 'backfill_cursor_jde')) {
    _db.exec("ALTER TABLE sample_sync_state ADD COLUMN backfill_cursor_jde INTEGER NOT NULL DEFAULT 0");
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
