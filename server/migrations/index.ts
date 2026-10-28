/**
 * Migration System Index - Entry point for database migrations
 */

import Database from 'better-sqlite3';
import { v1_initial_schema } from './001_initial_schema';
import { v2_add_metadata_columns } from './002_add_metadata_columns';

// Helper types
type MigrationFunc = (db: Database) => { version: number; timestamp: string };

/**
 * Get current schema version from database
 */
function getCurrentVersion(db: Database): number {
  try {
    const row = db.prepare(`SELECT version FROM schema_versions WHERE id = 1`)
      .get() as { version: number } | null;
    return row?.version || 0;
  } catch (error) {
    console.error('[MIGRATIONS] Error getting current version:', error);
    return 0;
  }
}

/**
 * Check if schema_versions table exists
 */
function hasSchemaTable(db: Database): boolean {
  try {
    const rows = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='schema_versions'`).all();
    return rows.length > 0;
  } catch (error) {
    console.error('[MIGRATIONS] Error checking schema_versions table:', error);
    return false;
  }
}

/**
 * Create schema_versions table if it doesn't exist (first-time setup)
 */
function ensureMigrationTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_versions (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      version INTEGER NOT NULL UNIQUE,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

/**
 * Run all pending migrations
 */
export function runMigrations(db: Database): { applied: number[]; skipped: number[]; errors: Record<number, Error> } {
  let applied: number[] = [];
  const skipped: number[] = [];
  const errors: Record<number, Error> = {};

  console.log(`[Migration System] Current version: ${getCurrentVersion(db)}`);
  console.log('[MIGRATIONS] Starting migration check...');

  // First-time setup: ensure schema_versions table exists
  if (!hasSchemaTable(db)) {
    console.log('[MIGRATIONS] Creating schema_versions table for first-time setup...');
    ensureMigrationTable(db);
  }

  // Define migrations to apply
  const migrations = [
    { version: 1, func: v1_initial_schema as MigrationFunc },
    { version: 2, func: typeof v2_add_metadata_columns === 'function' ? v2_add_metadata_columns : null }
  ] as const;

  for (const { version, func } of migrations) {
    // Check if already applied by looking up this specific version
    try {
      const existing = db.prepare(`SELECT version FROM schema_versions WHERE version = ?`).get() as 
        { version?: number } | null;
      
      if (existing && existing.version === version) {
        console.log(`[MIGRATIONS] Skipping migration v${version} (already applied)`);
        skipped.push(version);
        continue;
      }
    } catch (err: any) {
      // If no row found, .get() returns null, not an exception - that's fine
      if (!err.message || !err.message.includes('no such table')) {}
      else {
        errors[version] = err;
      }
    }

    try {
      console.log(`[Migration v${version}] Executing...`);
      
      const result = func(db);
      
      // Handle INSERT for single-row schema_versions table 
      // Must specify id because CHECK(id = 1) is enforced
      const insertVersionStmt = db.prepare(`
        INSERT INTO schema_versions (id, version, applied_at) VALUES (1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET 
          version = excluded.version,
          applied_at = excluded.applied_at
      `);
      
      insertVersionStmt.run(version, new Date().toISOString());
      
      console.log(`[Migration v${version}] Applied successfully`);
      applied.push(version);
    } catch (err: any) {
      console.error(`[Migration v${version}] Error: ${err.message}`);
      errors[version] = err;
    }
  }

  console.log(`\n[MIGRATIONS] Applied: [${applied.join(', ')}], Skipped: [${skipped.join(', ')}]`);

  return { applied, skipped, errors };
}

/**
 * Initialize database for first-time setup
 */
export async function initializeDatabase(db: Database): Promise<void> {
  console.log('[MIGRATIONS] Initializing database...');
  
  // Ensure migrations table exists
  if (!hasSchemaTable(db)) {
    ensureMigrationTable(db);
  }
  
  // Apply v1 first-time migration (this creates all required tables)
  try {
    await import('./001_initial_schema.js', { assert: { type: 'json' }, with: { type: 'json' } });
    
    // Manually run the migration
    const fs = await import('fs');
    const migrationModule = await import('./001_initial_schema.js');
    if (migrationModule.v1_initial_schema) {
      const { version, timestamp } = migrationModule.v1_initial_schema(db);
      
      db.prepare(`
        INSERT INTO schema_versions (version, applied_at) VALUES (?, ?)
      `).run(version, timestamp);
      
      console.log('[MIGRATIONS] v1 applied successfully\n');
    } else {
      // Fallback: create tables manually
      console.log('[MIGRATIONS] Running manual table creation for v1...');
      const migrations = `
        CREATE TABLE IF NOT EXISTS schema_versions (
          id INTEGER PRIMARY KEY CHECK(id = 1),
          version INTEGER NOT NULL UNIQUE,
          applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        
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
      `;
      
      db.exec(migrations);
      
      // Create indexes
      const indexes = `
        CREATE INDEX IF NOT EXISTS idx_models_user_id ON models(user_id);
        CREATE INDEX IF NOT EXISTS idx_models_title ON models(title);
        CREATE INDEX IF NOT EXISTS idx_models_created_at ON models(created_at);
        CREATE INDEX IF NOT EXISTS idx_files_model_id ON files(model_id);
        CREATE INDEX IF NOT EXISTS idx_files_is_primary ON files(is_primary_3d);
        CREATE INDEX IF NOT EXISTS idx_collections_user_id ON collections(user_id);
        CREATE INDEX IF NOT EXISTS idx_collections_name ON collections(name);
        CREATE INDEX IF NOT EXISTS idx_collections_parent ON collections(parent_folder_id);
        CREATE INDEX IF NOT EXISTS idx_auth_tokens_user ON auth_tokens(user_id);
      `;
      
      db.exec(indexes);
      
      console.log('[MIGRATIONS] All tables created successfully\n');
    }
    
  } catch (err: any) {
    console.error('[MIGRATIONS] Error during initialization:', err.message);
  }
  
  // Try v2 if v1 succeeded
  try {
    const currentVersion = getCurrentVersion(db);
    const v2Func = typeof v2_add_metadata_columns === 'function' ? v2_add_metadata_columns : null;
    
    if (currentVersion < 2 && v2Func) {
      const { version, timestamp } = v2Func(db);
      db.prepare(`INSERT INTO schema_versions (version, applied_at) VALUES (?, ?)`).run(version, timestamp);
      console.log('[MIGRATIONS] v2 applied successfully\n');
    }
  } catch (err: any) {
    // Ignore errors during upgrade path
  }
}

// Re-export for convenience
export { v1_initial_schema, v2_add_metadata_columns };
