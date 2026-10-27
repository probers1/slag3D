import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

// Determine db path: check /data/vault.db first (for Docker/LXC mounts) or fallback to local ./data/vault.db
const resolveDbPath = (): string => {
  const rootDataDir = '/data';
  try {
    if (fs.existsSync(rootDataDir) && fs.statSync(rootDataDir).isDirectory()) {
      return path.join(rootDataDir, 'vault.db');
    }
  } catch {
    // fallback if no access to root /data
  }
  const localDataDir = path.resolve(process.cwd(), 'data');
  if (!fs.existsSync(localDataDir)) {
    fs.mkdirSync(localDataDir, { recursive: true });
  }
  return path.join(localDataDir, 'vault.db');
};

export const dbPath = resolveDbPath();
console.log(`[SLAG3D DB] Initializing SQLite database at: ${dbPath}`);

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'user')) DEFAULT 'user',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS models (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      thumbnail_path TEXT,
      thumbnail_status TEXT NOT NULL CHECK(thumbnail_status IN ('pending', 'processing', 'completed', 'failed')) DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      model_id TEXT NOT NULL REFERENCES models(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      file_path TEXT NOT NULL,
      is_primary_3d INTEGER NOT NULL DEFAULT 0 CHECK(is_primary_3d IN (0, 1))
    );

    CREATE TABLE IF NOT EXISTS tags (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL COLLATE NOCASE
    );

    CREATE TABLE IF NOT EXISTS model_tags (
      model_id TEXT NOT NULL REFERENCES models(id) ON DELETE CASCADE,
      tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (model_id, tag_id)
    );

    CREATE TABLE IF NOT EXISTS favorites (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      model_id TEXT NOT NULL REFERENCES models(id) ON DELETE CASCADE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, model_id)
    );

    CREATE TABLE IF NOT EXISTS collections (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      parent_folder_id TEXT REFERENCES collections(id) ON DELETE CASCADE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS collection_models (
      collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
      model_id TEXT NOT NULL REFERENCES models(id) ON DELETE CASCADE,
      added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (collection_id, model_id)
    );

    CREATE TABLE IF NOT EXISTS auth_tokens (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Indices for query performance
    CREATE INDEX IF NOT EXISTS idx_models_user_id ON models(user_id);
    CREATE INDEX IF NOT EXISTS idx_models_created_at ON models(created_at);
    CREATE INDEX IF NOT EXISTS idx_files_model_id ON files(model_id);
    CREATE INDEX IF NOT EXISTS idx_collections_user_id ON collections(user_id);
    CREATE INDEX IF NOT EXISTS idx_collections_parent ON collections(parent_folder_id);
    CREATE INDEX IF NOT EXISTS idx_auth_tokens_user ON auth_tokens(user_id);
  `);

  // Seed default admin account if no users exist
  const countRow = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
  if (countRow.count === 0) {
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync('admin123', salt);
    const adminId = uuidv4();
    db.prepare(`
      INSERT INTO users (id, username, password_hash, role)
      VALUES (?, ?, ?, 'admin')
    `).run(adminId, 'admin', hash);
    console.log('[SLAG3D DB] Default administrator account seeded (username: admin / role: admin)');
  }
}
