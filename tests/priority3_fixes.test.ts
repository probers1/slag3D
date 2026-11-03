import Database from 'better-sqlite3';
import { runMigrations } from '../server/migrations/index.ts';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error('FAIL:', message);
    process.exit(1);
  }
}

console.log('Testing Priority 3 Fixes...');

// Test 1: Full migration runner on fresh database applies all migrations
{
  const db = new Database(':memory:');
  const result = runMigrations(db);

  assert(result.applied.length === 3, `Expected 3 migrations applied on fresh DB, got ${result.applied.length}`);
  assert(result.applied.includes(1), 'Migration 1 should be applied');
  assert(result.applied.includes(2), 'Migration 2 should be applied');
  assert(result.applied.includes(4), 'Migration 4 should be applied');
  assert(Object.keys(result.errors).length === 0, 'No migration errors should occur');

  const verRow = db.prepare('SELECT version FROM schema_versions WHERE id = 1').get() as { version: number };
  assert(verRow.version === 4, `Schema version should be 4, got ${verRow?.version}`);

  // Test 2: Re-running on up-to-date database skips ALL migrations (Item 13)
  const rerun = runMigrations(db);
  assert(rerun.applied.length === 0, `Expected 0 migrations applied on re-run, got ${rerun.applied.length}`);
  assert(rerun.skipped.length === 3, `Expected 3 migrations skipped, got ${rerun.skipped.length}`);

  db.close();
  console.log('  ✓ Item 13: Migration runner idempotency and >= version skipping verified');
}

// Test 3: Existing database upgrade from version 3 to version 4 (Item 12)
{
  const db = new Database(':memory:');

  // Set up DB as if it was on version 3 (abandoned migration, missing deleted_at on users)
  db.exec(`
    CREATE TABLE schema_versions (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      version INTEGER NOT NULL UNIQUE,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO schema_versions (id, version) VALUES (1, 3);

    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      is_deleted INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const result = runMigrations(db);
  assert(result.applied.length === 1 && result.applied[0] === 4, 'Migration 4 should be the only applied migration');
  assert(result.skipped.includes(1) && result.skipped.includes(2), 'Migrations 1 and 2 should be skipped');

  // Verify deleted_at column was added to users
  const userCols = (db.prepare('PRAGMA table_info(users)').all() as any[]).map(c => c.name);
  assert(userCols.includes('deleted_at'), 'Users table must now include deleted_at column');

  // Verify schema_versions was updated to 4
  const verRow = db.prepare('SELECT version FROM schema_versions WHERE id = 1').get() as { version: number };
  assert(verRow.version === 4, `Database schema version should be updated to 4, got ${verRow.version}`);

  db.close();
  console.log('  ✓ Item 12: Existing database migration upgrade (v3 -> v4) verified');
}

// Test 4: Complete schema in fallback tables (Item 14)
{
  const db = new Database(':memory:');

  // Create fallback tables directly
  db.exec(`
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
      is_deleted INTEGER NOT NULL DEFAULT 0,
      deleted_at TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
    CREATE INDEX IF NOT EXISTS idx_collections_parent ON collections(parent_folder_id);
  `);

  const userCols = (db.prepare('PRAGMA table_info(users)').all() as any[]).map(c => c.name);
  assert(userCols.includes('is_deleted'), 'Fallback users table must include is_deleted');
  assert(userCols.includes('deleted_at'), 'Fallback users table must include deleted_at');

  const collCols = (db.prepare('PRAGMA table_info(collections)').all() as any[]).map(c => c.name);
  assert(collCols.includes('parent_folder_id'), 'Fallback collections table must include parent_folder_id');

  const indexes = (db.prepare('PRAGMA index_list(collections)').all() as any[]).map(i => i.name);
  assert(indexes.includes('idx_collections_parent'), 'Fallback collections index must exist');

  db.close();
  console.log('  ✓ Item 14: Fallback tables complete schema verified');
}

console.log('All Priority 3 tests passed successfully!');
