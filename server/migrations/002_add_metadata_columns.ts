import Database from 'better-sqlite3';

/**
 * Migration v2 - Add Metadata Columns
 *
 * Enhances existing schema with additional metadata:
 * - adds width/height to model table
 * - improves file metadata tracking
 * - adds timestamps to collections
 */

export function v2_add_metadata_columns(db: Database.Database): { version: number; timestamp: string } {
  console.log('[MIGRATION v2] Adding metadata columns...\n');

  // SQLite does NOT support `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`,
  // so we check column existence via PRAGMA table_info before adding.
  const addColumnIfMissing = (table: string, column: string, definition: string): void => {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    const exists = columns.some((c) => c.name === column);
    if (!exists) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
      console.log(`[MIGRATION v2] Added ${column} to ${table}`);
    } else {
      console.log(`[MIGRATION v2] ${column} already exists on ${table}, skipping`);
    }
  };

  addColumnIfMissing('models', 'width', 'INTEGER DEFAULT 800');
  addColumnIfMissing('models', 'height', 'INTEGER DEFAULT 600');
  addColumnIfMissing('files', 'width', 'INTEGER DEFAULT 800');
  addColumnIfMissing('files', 'height', 'INTEGER DEFAULT 600');
  addColumnIfMissing('files', 'created_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP');
  addColumnIfMissing('collections', 'created_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP');
  addColumnIfMissing('collections', 'updated_at', 'DATETIME DEFAULT CURRENT_TIMESTAMP');

  // Record the migration as applied
  // Note: id must be specified explicitly (CHECK(id = 1) constraint)
  db.prepare(`INSERT OR IGNORE INTO schema_versions (id, version, applied_at) VALUES (1, ?, ?)`).run(2, new Date().toISOString());

  console.log('[MIGRATION v2] Completed - Metadata columns added\n');

  return { version: 2, timestamp: new Date().toISOString() };
}
