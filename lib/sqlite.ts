import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { hashSync } from 'bcryptjs';

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
  `);

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

  // Seed pantallas (idempotente)
  _db.exec(`
    INSERT OR IGNORE INTO screens (key, label, path, is_public) VALUES ('produccion',  'Producción',       '/produccion',          1);
    INSERT OR IGNORE INTO screens (key, label, path, is_public) VALUES ('pedidos',     'Pedidos',          '/preparacion-pedidos', 1);
    INSERT OR IGNORE INTO screens (key, label, path, is_public) VALUES ('caducados',   'Caducados',        '/caducados',           1);
    INSERT OR IGNORE INTO screens (key, label, path, is_public) VALUES ('comparativa', 'Comparativa SERES','/comparativa-seres',   1);
    INSERT OR IGNORE INTO screens (key, label, path, is_public) VALUES ('consulta_stock_pda', 'Consulta stock PDA', '/consulta-stock-pda', 1);
    INSERT OR IGNORE INTO screens (key, label, path, is_public) VALUES ('compras',     'Compras',          '/compras',             1);
    INSERT OR IGNORE INTO screens (key, label, path, is_public) VALUES ('admin',       'Administración',   '/admin',               0);
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
