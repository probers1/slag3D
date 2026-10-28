import Database from 'better-sqlite3';

/**
 * Migration v2 - Add Metadata Columns
 * 
 * Enhances existing schema with additional metadata:
 * - adds width/height to model table
 * - improves file metadata tracking  
 * - adds timestamps to collections
 */

export function v2_add_metadata_columns(db: Database): { version: number; timestamp: string } {
  console.log('[MIGRATION v2] Adding metadata columns...\n');

  // Add width and height columns to models table if not exists
  try {
    db.exec(`
      ALTER TABLE models 
      ADD COLUMN IF NOT EXISTS width INTEGER DEFAULT 800,
      ADD COLUMN IF NOT EXISTS height INTEGER DEFAULT 600;
    `);
    console.log('[MIGRATION v2] Added width/height columns to models table');
  } catch (e) {
    console.log('[MIGRATION v2] Models columns already exist, skipping...');
  }

  // Add metadata columns to files table if not exists
  try {
    db.exec(`
      ALTER TABLE files 
      ADD COLUMN IF NOT EXISTS width INTEGER DEFAULT 800,
      ADD COLUMN IF NOT EXISTS height INTEGER DEFAULT 600,
      ADD COLUMN IF NOT EXISTS created_at DATETIME DEFAULT CURRENT_TIMESTAMP;
    `);
    console.log('[MIGRATION v2] Added metadata columns to files table');
  } catch (e) {
    console.log('[MIGRATION v2] Files columns already exist, skipping...');
  }

  // Add timestamps to collections if not exists
  try {
    db.exec(`
      ALTER TABLE collections
      ADD COLUMN IF NOT EXISTS created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      ADD COLUMN IF NOT EXISTS updated_at DATETIME DEFAULT CURRENT_TIMESTAMP;
    `);
    console.log('[MIGRATION v2] Added timestamp columns to collections table');
  } catch (e) {
    console.log('[MIGRATION v2] Collections timestamps already exist, skipping...');
  }

  // Record the migration as applied
  db.prepare(`
    INSERT OR IGNORE INTO schema_versions (version, applied_at)
    VALUES (?, CURRENT_TIMESTAMP)
  `).run(2);
  
  console.log('[MIGRATION v2] Completed - Metadata columns added\n');
  
  return { version: 2, timestamp: new Date().toISOString() };
}
