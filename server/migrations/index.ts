/**
 * Migration System Index - Entry point for database migrations
 */

import Database from 'better-sqlite3';
import { v1_initial_schema } from './001_initial_schema';
import { v2_add_metadata_columns } from './002_add_metadata_columns';
import { v4_add_soft_delete_column_to_users } from './004_add_soft_delete_flag_for_users';

// Helper types
type MigrationFunc = (db: Database.Database) => { version: number; timestamp: string };

/**
 * Get current schema version from database
 */
function getCurrentVersion(db: Database.Database): number {
  try {
    if (!hasSchemaTable(db)) return 0;
    const row = db.prepare(`SELECT version FROM schema_versions WHERE id = 1`)
      .get() as { version: number } | null;
    return row?.version || 0;
  } catch (error) {
    return 0;
  }
}

/**
 * Check if schema_versions table exists
 */
function hasSchemaTable(db: Database.Database): boolean {
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
function ensureMigrationTable(db: Database.Database): void {
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
export function runMigrations(db: Database.Database): { applied: number[]; skipped: number[]; errors: Record<number, Error> } {
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

  // Define migrations to apply, in ascending version order.
  // NOTE: v3 was abandoned (it targeted the wrong table); the real soft-delete
  // migration for users is v4 (server/migrations/004_add_soft_delete_flag_for_users.ts).
  const migrations = [
    { version: 1, func: v1_initial_schema },
    { version: 2, func: v2_add_metadata_columns },
    { version: 4, func: v4_add_soft_delete_column_to_users },
  ];

  for (const { version, func } of migrations) {
    // Check if already applied (current database schema version >= this migration version)
    const currentVer = getCurrentVersion(db);
    if (currentVer >= version) {
      console.log(`[MIGRATIONS] Skipping migration v${version} (already applied, current version: ${currentVer})`);
      skipped.push(version);
      continue;
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
      console.error(`[Migration v${version}] Error:`, err?.message || err);
      errors[version] = err;
      break;
    }
  }

  console.log(`\n[MIGRATIONS] Applied: [${applied.join(', ')}], Skipped: [${skipped.join(', ')}]`);

  return { applied, skipped, errors };
}

// =============================================================================
// Migration system exports (NO FALLBACK CODE)
// =============================================================================

// Re-export for convenience (handled by tsx runtime compilation)
export { v1_initial_schema, v2_add_metadata_columns, v4_add_soft_delete_column_to_users };
