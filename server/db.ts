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
 * Initialize database for first-time setup in dev/seed mode only
 */
export async function initDatabase(): Promise<void> {
  if (hasMigrationTable()) {
    // Already initialized
    return;
  }

  console.log('[MIGRATIONS] Initializing database for first-time setup...');

  // Create schema_versions table with VERSION tracking
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_versions (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      version INTEGER NOT NULL UNIQUE,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  try {
    // Import and run migrations via single unified entrypoint
    const migrationsModule = await import('./migrations/index');
    if (migrationsModule?.runMigrations) {
      console.log('[MIGRATIONS] Running migration system (v1/v2)...');
      const result = migrationsModule.runMigrations(db);
      
      // Fail fast if any migrations encountered errors
      if (Object.keys(result.errors).length > 0) {
        console.error('[MIGRATIONS] Migration errors detected - aborting setup:', result.errors);
        throw new Error('Migration errors: ' + JSON.stringify(result.errors));
      }
      
      console.log('[MIGRATIONS] Completed successfully\n');
    } else {
      // Migration entrypoint not found - use fallback for recovery
      console.error('[MIGRATIONS] WARNING: migrations/index.js entry point missing, using fallback');
      applyFallbackTables();
    }
  } catch (err: any) {
    if (err.message?.includes('Migration errors')) {
      // Already logged in the try block above
      throw err; // Re-throw to fail setup
    }
    console.error('[MIGRATIONS] Unexpected error during migration:', err?.message);
    
    // Fall back to basic table creation if migrations failed unexpectedly
    applyFallbackTables();
  }

  // Try v2 upgrade path if current version is < 2
  const currentVersion = getCurrentVersion();
  if (currentVersion >= 0 && currentVersion < 2) {
    try {
      const m2 = await import('./migrations/002_add_metadata_columns.js');
      if (m2?.v2_add_metadata_columns) {
        m2.v2_add_metadata_columns(db);
        console.log('[MIGRATIONS] Applied v2 upgrade\n');
      }
    } catch (err: any) {
      console.warn('[MIGRATIONS] v2 upgrade skipped:', err?.message);
    }
  }

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

  // Create all base tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user', 'admin')),
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
  `);

  // Seed admin user if GOOSE_SEED_DB and no users exist
  const countRow = db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number };
  if (countRow?.count === 0 && process.env.GOOSE_SEED_DB === 'true') {
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync('admin123', salt);
    const insert = db.prepare(`INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, 'admin')`);
    insert.run(uuidv4(), 'admin', hash);
    console.log('[MIGRATIONS] Created default admin user');
  }

  // Record version
  const currentVersionRow = db.prepare(`SELECT version FROM schema_versions WHERE id = 1`).get() as { version?: number } | null;
  if (!currentVersionRow) {
    db.prepare(`INSERT INTO schema_versions (id, version, applied_at) VALUES (1, ?, ?)`).run(1, new Date().toISOString());
  }

  console.log('[MIGRATIONS] Tables created\n');
}

// Validate session secret for session cookie signing
// Default is handled by dotenv import - use only if explicitly set but weak
const defaultSessionSecret = process.env.SESSION_SECRET || 'default_session_secret_placeholder';
if (process.env.SESSION_SECRET?.length && process.env.SESSION_SECRET.length < 32) {
  console.warn('[SLAG3D WARNING] SESSION_SECRET is set but less than 32 characters. Consider using a stronger secret.');
}

