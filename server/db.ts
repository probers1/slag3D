import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

/**
 * SLAG3D Database Module - Migration-enabled SQLite database
 */

export function resolveDbPath(): string {
  const rootDataDir = '/data';
  if (fs.existsSync(rootDataDir) && fs.statSync(rootDataDir).isDirectory()) {
    return path.join(rootDataDir, 'vault.db');
  }
  const localDataDir = path.resolve(process.cwd(), 'data');
  if (!fs.existsSync(localDataDir)) {
    fs.mkdirSync(localDataDir, { recursive: true });
  }
  return path.join(localDataDir, 'vault.db');
}

export const dbPath = resolveDbPath();

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Export the database instance
export { db };

/**
 * Current schema version stored in DB
 */
export function getCurrentVersion(): number {
  try {
    const row = db.prepare(`SELECT version FROM schema_versions WHERE id = 1`).get() as { version: number } | null;
    return row?.version || 0;
  } catch {
    return -1; // Indicates uninitialized DB state
  }
}

/**
 * Check if migrations have been applied
 */
export function hasMigrationTable(): boolean {
  try {
    const rows = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='schema_versions'`).all() as Array<{ name: string }>;
    return rows.length > 0;
  } catch {
    return false;
  }
}

/**
 * Seed default administrator user if requested and no users exist
 */
export function seedAdminIfRequested(): void {
  try {
    const countRow = db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number } | undefined;
    if (countRow?.count === 0 && process.env.GOOSE_SEED_DB === 'true') {
      const salt = bcrypt.genSaltSync(10);
      const hash = bcrypt.hashSync('admin123', salt);
      const insert = db.prepare(`INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, 'admin')`);
      insert.run(uuidv4(), 'admin', hash);
      console.log('[SLAG3D] Created default admin user (admin / admin123)');
    }
  } catch (seedErr: any) {
    console.warn('[SLAG3D] Admin seeding check error:', seedErr?.message);
  }
}

/**
 * Initialize database and execute any pending migrations
 */
export async function initDatabase(): Promise<void> {
  const currentVersion = getCurrentVersion();
  console.log(`[DATABASE] Checking database schema (current version: ${currentVersion >= 0 ? currentVersion : 'uninitialized'})...`);

  // Ensure schema_versions table exists with version tracking
  if (!hasMigrationTable()) {
    console.log('[MIGRATIONS] Creating schema_versions table for setup...');
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_versions (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        version INTEGER NOT NULL UNIQUE,
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }

  try {
    // Import and run migrations via unified entrypoint
    const migrationsModule = await import('./migrations/index.ts');
    if (migrationsModule?.runMigrations) {
      console.log('[MIGRATIONS] Checking and executing pending migrations...');
      const result = migrationsModule.runMigrations(db);
      
      // Fail fast if any migrations encountered errors
      if (Object.keys(result.errors).length > 0) {
        console.error('[MIGRATIONS] Migration errors detected - aborting setup:', result.errors);
        throw new Error('Migration errors: ' + JSON.stringify(result.errors));
      }
      
      console.log('[MIGRATIONS] Completed migration check successfully\n');
    } else {
      console.error('[MIGRATIONS] WARNING: migrations/index entry point missing, using fallback');
      applyFallbackTables();
    }
  } catch (err: any) {
    if (err.message?.includes('Migration errors')) {
      throw err;
    }
    console.error('[MIGRATIONS] Unexpected error during migration:', err?.message);
    applyFallbackTables();
  }

  // Seed default admin user if GOOSE_SEED_DB=true and no users exist
  seedAdminIfRequested();
}

/**
 * Apply base tables if migrations fail - only called when migration system genuinely fails
 */
function applyFallbackTables(): void {
  // First-time initialization
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_versions (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      version INTEGER NOT NULL UNIQUE,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Create all base tables with complete schema
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user', 'admin')),
      is_deleted INTEGER NOT NULL DEFAULT 0,
      deleted_at TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS models (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      thumbnail_path TEXT,
      thumbnail_status TEXT NOT NULL CHECK(thumbnail_status IN ('pending', 'processing', 'completed', 'failed')) DEFAULT 'pending',
      width INTEGER NOT NULL DEFAULT 800,
      height INTEGER NOT NULL DEFAULT 600,
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
      width INTEGER NOT NULL DEFAULT 800,
      height INTEGER NOT NULL DEFAULT 600,
      is_primary_3d INTEGER NOT NULL DEFAULT 0 CHECK(is_primary_3d IN (0, 1)),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS tags (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL COLLATE NOCASE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS model_tags (
      model_id TEXT NOT NULL REFERENCES models(id) ON DELETE CASCADE,
      tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
  `);

  // Create indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_models_user_id ON models(user_id);
    CREATE INDEX IF NOT EXISTS idx_models_title ON models(title);
    CREATE INDEX IF NOT EXISTS idx_files_model_id ON files(model_id);
    CREATE INDEX IF NOT EXISTS idx_collections_user_id ON collections(user_id);
    CREATE INDEX IF NOT EXISTS idx_collections_parent ON collections(parent_folder_id);
  `);

  // Record latest schema version
  const currentVersionRow = db.prepare(`SELECT version FROM schema_versions WHERE id = 1`).get() as { version?: number } | null;
  if (!currentVersionRow) {
    db.prepare(`INSERT INTO schema_versions (id, version, applied_at) VALUES (1, ?, ?)`).run(4, new Date().toISOString());
  } else {
    db.prepare(`UPDATE schema_versions SET version = 4, applied_at = ? WHERE id = 1`).run(new Date().toISOString());
  }

  console.log('[MIGRATIONS] Fallback tables created with full schema (v4)\n');
}

// Validate session secret for session cookie signing
// Default is handled by dotenv import - use only if explicitly set but weak
const defaultSessionSecret = process.env.SESSION_SECRET || 'default_session_secret_placeholder';
if (process.env.SESSION_SECRET?.length && process.env.SESSION_SECRET.length < 32) {
  console.warn('[SLAG3D WARNING] SESSION_SECRET is set but less than 32 characters. Consider using a stronger secret.');
}

