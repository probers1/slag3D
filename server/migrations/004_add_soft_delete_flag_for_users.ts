// Migration v4: Add is_deleted column to users table
// This migration addresses the broken soft‑delete logic present in the
// admin routes.  The previous migration (v3_add_soft_delete) was added by
// accident to the model table and added the column to the wrong database
// schema, causing the API to write to a column that does not exist.  This
// new migration (v4) correctly adds the column to the `users` table and
// ensures that the column is `INTEGER NOT NULL` with a default of `0`.
// In addition a timestamp for the deletion action is also added.
//
// 1.  Add is_deleted column – default 0.
// 2.  Add deleted_at column – nullable TIMESTAMP.
// 3.  Ensure foreign‑key constraints are not affected.
// 4.  Use a transaction to keep the DB consistent.

import type Database from 'better-sqlite3';

export function v4_add_soft_delete_column_to_users(db: Database.Database): { version: number; timestamp: string } {
  const tx = db.transaction(() => {
    // Ensure users table exists before attempting to alter it
    const tableInfo = db
      .prepare(`PRAGMA table_info(users)`)
      .all() as Array<{ name: string } | undefined>;
    const tableExists = tableInfo.length > 0;

    if (!tableExists) {
      // If for some reason the table wasn’t created (edge‑case during init), stop.  This will surface
      // as an error rather than silently succeeding.
      throw new Error('[DATABASE] users table does not exist when attempting to apply soft‑delete migration');
    }

    const columns = tableInfo.map((row) => row?.name ?? '');
    if (!columns.includes('is_deleted')) {
      db.exec(`ALTER TABLE users ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0;`);
    }
    if (!columns.includes('deleted_at')) {
      db.exec(`ALTER TABLE users ADD COLUMN deleted_at TEXT;`); // ISO timestamp
    }
  });

  try {
    tx();
    console.log('[MIGRATION v4] Users table updated with soft‑delete columns');
  } catch (err) {
    console.error('[MIGRATION v4] Failed to apply migration:', err);
    throw err;
  }

  return { version: 4, timestamp: new Date().toISOString() };
}

export default { v4_add_soft_delete_column_to_users };
