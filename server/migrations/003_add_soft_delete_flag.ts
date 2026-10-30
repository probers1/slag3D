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
  // Use pragma_table_info to check if column exists
  const columns = db.prepare(`PRAGMA table_info(users)`).all() as Array<{ name: string; type?: string }> | [];

  if (!columns.find(c => c.name === 'is_deleted')) {
    // Column doesn't exist - add it (SQLite will add if not exists)
    try {
      db.exec(`PRAGMA foreign_keys=OFF; ALTER TABLE users ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0`);
      console.log('[MIGRATION v3] Added is_deleted column to users table');
      
      // Re-enable foreign keys
      db.exec('PRAGMA foreign_keys=ON');
    } catch (err: any) {
      // Column might already exist from partial apply
      if (!err?.message?.includes(`column 'is_deleted' of table 'users' already exists`)) {
        console.error('[MIGRATION v3] Warning:', err?.message);
      }
    }
  } else {
    console.log('[MIGRATION v3] is_deleted column already exists, skipping');
  }

  // Mark existing admin user as not deleted (protect admin account)
  try {
    db.prepare(`UPDATE users SET is_deleted = 0 WHERE COALESCE(is_deleted, 0) = 0 AND role = 'admin'`).run();
    console.log('[MIGRATION v3] Admin accounts marked as active');
  } catch (err: any) {
    // Ignore errors if column or admin check fails
    if (!err?.message?.includes(`column 'is_deleted'`)) {}
  }

  return { version: 3, timestamp: new Date().toISOString() };
}
