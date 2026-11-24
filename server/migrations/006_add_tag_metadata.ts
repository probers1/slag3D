// Migration v6: tag metadata for the dedicated tag manager.
//
// Tags are global and name-based. This adds presentation/metadata columns and
// an index for reverse lookups from a tag to its items. The ensure function is
// deliberately idempotent and is also called unconditionally from
// initDatabase(), because databases from other builds can report a higher
// schema version and skip version-based migrations.

import type Database from 'better-sqlite3';

function addColumnIfMissing(
  db: Database.Database,
  table: string,
  column: string,
  definition: string
): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (columns.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  console.log(`[SCHEMA REPAIR] Added ${table}.${column}`);
}

/**
 * Idempotently ensure tag metadata columns and the reverse lookup index exist.
 */
export function ensureTagMetadata(db: Database.Database): void {
  addColumnIfMissing(
    db,
    'tags',
    'color',
    `TEXT NOT NULL DEFAULT '#60a5fa'`
  );
  addColumnIfMissing(
    db,
    'tags',
    'description',
    `TEXT NOT NULL DEFAULT ''`
  );
  db.exec(`CREATE INDEX IF NOT EXISTS idx_model_tags_tag_id ON model_tags(tag_id)`);
}

export function v6_add_tag_metadata(db: Database.Database): { version: number; timestamp: string } {
  ensureTagMetadata(db);
  console.log('[MIGRATION v6] tag metadata columns ready');
  return { version: 6, timestamp: new Date().toISOString() };
}

export default { v6_add_tag_metadata, ensureTagMetadata };
