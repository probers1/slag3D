// Migration v5: distinguish 3D model items from standalone PDF documents.
// Both kinds live in `models` so they share tags, search, favorites,
// collections and the existing file/thumbnail plumbing.
//
// Existing rows are treated as 3D models via the column default.

import type Database from 'better-sqlite3';

/**
 * Idempotently add `models.item_type`.
 *
 * This is deliberately separate from the version bookkeeping in the migration
 * runner. Databases created by other builds can be at a schema version higher
 * than 5 (e.g. one that added `page_count`) and would otherwise have migration
 * v5 skipped by the `currentVersion >= version` check, leaving queries that
 * select `m.item_type` broken. Calling this unconditionally at startup repairs
 * that skew without changing the stored schema version.
 */
export function ensureItemTypeColumn(db: Database.Database): void {
  const columns = db.prepare(`PRAGMA table_info(models)`).all() as Array<{ name: string }>;

  if (columns.some((column) => column.name === 'item_type')) {
    return;
  }

  db.exec(`
    ALTER TABLE models
    ADD COLUMN item_type TEXT NOT NULL DEFAULT 'model'
    CHECK (item_type IN ('model', 'document'));
  `);
  console.log('[SCHEMA REPAIR] Added item_type to models');
}

export function v5_add_item_type(db: Database.Database): { version: number; timestamp: string } {
  ensureItemTypeColumn(db);
  console.log('[MIGRATION v5] item_type column ready');
  return { version: 5, timestamp: new Date().toISOString() };
}

export default { v5_add_item_type, ensureItemTypeColumn };
