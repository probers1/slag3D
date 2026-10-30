/**
 * Migration v3: Add soft delete flag to users table
 *
 * Issue 2.3: Foreign Key Cascading on User Delete (MEDIUM)
 * Previously: All tables referenced users(id) with ON DELETE CASCADE
 * Impact: Deleting any user deletes ALL their models/thumbnails from disk
 * Solution: Add is_deleted flag for soft delete protection
 */

import Database from 'better-sqlite3';

export function v3_add_soft_delete(db: Database.Database): { version: number; timestamp: string } {
  // Use pragma_table_info to check if column exists before attempting to add it
  const columns = db.prepare(`PRAGMA table_info(users)`).all() as Array<{ name: string; type?: string }> | [];
  const hasColumn = (name: string) => columns.some((c) => c.name === name);

  if (!hasColumn('is_deleted')) {
    db.exec(`ALTER TABLE users ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0`);
    console.log('[MIGRATION v3] Added is_deleted column to users table');
  } else {
    console.log('[MIGRATION v3] is_deleted column already exists, skipping');
  }

  if (!hasColumn('deleted_at')) {
    db.exec(`ALTER TABLE users ADD COLUMN deleted_at TEXT`); // ISO timestamp
    console.log('[MIGRATION v3] Added deleted_at column to users table');
  }

  // Mark existing admin user as not deleted (protect admin account)
  try {
    db.prepare(`UPDATE users SET is_deleted = 0 WHERE role = 'admin'`).run();
    console.log('[MIGRATION v3] Admin accounts marked as active');
  } catch (err: any) {
    console.error('[MIGRATION v3] Failed to mark admin accounts active:', err?.message);
  }

  return { version: 3, timestamp: new Date().toISOString() };
}
