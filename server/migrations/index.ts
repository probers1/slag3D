/**
 * Migration System Index - Entry point for database migrations
 */

import Database from 'better-sqlite3';
import { v1_initial_schema } from './001_initial_schema';
import { v2_add_metadata_columns } from './002_add_metadata_columns';
import { v3_add_soft_delete } from './003_add_soft_delete_flag';

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

  // Define migrations to apply (v1, v2, v3+)
  const migrations = [
    { version: 1, func: v1_initial_schema as MigrationFunc },
    { version: 2, func: typeof v2_add_metadata_columns === 'function' ? v2_add_metadata_columns : null },
    { version: 3, func: typeof v3_add_soft_delete === 'function' ? v3_add_soft_delete : null }
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

// =============================================================================
// Migration system exports (NO FALLBACK CODE)
// =============================================================================

// Re-export for convenience (handled by tsx runtime compilation)
export { v1_initial_schema, v2_add_metadata_columns };
