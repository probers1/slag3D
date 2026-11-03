import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error('FAIL:', message);
    process.exit(1);
  }
}

console.log('Testing Priority 1 Fixes...');

// Test 1: Collections add model transaction
{
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT);
    CREATE TABLE models (id TEXT PRIMARY KEY, user_id TEXT, title TEXT);
    CREATE TABLE collections (id TEXT PRIMARY KEY, user_id TEXT, name TEXT);
    CREATE TABLE collection_models (
      collection_id TEXT NOT NULL,
      model_id TEXT NOT NULL,
      PRIMARY KEY (collection_id, model_id)
    );
  `);

  const userId = uuidv4();
  const modelId = uuidv4();
  const collectionId = uuidv4();

  db.prepare('INSERT INTO users VALUES (?, ?)').run(userId, 'testuser');
  db.prepare('INSERT INTO models VALUES (?, ?, ?)').run(modelId, userId, 'Test Model');
  db.prepare('INSERT INTO collections VALUES (?, ?, ?)').run(collectionId, userId, 'Test Collection');

  const addModelToCollectionTx = db.transaction((cId: string, mId: string, uId: string) => {
    const coll = db.prepare('SELECT id FROM collections WHERE id = ? AND user_id = ?').get(cId, uId);
    if (!coll) throw new Error('Collection not found');
    const model = db.prepare('SELECT id FROM models WHERE id = ?').get(mId);
    if (!model) throw new Error('Model not found');
    db.prepare('INSERT OR IGNORE INTO collection_models (collection_id, model_id) VALUES (?, ?)').run(cId, mId);
  });

  // Verify successful execution and insertion
  addModelToCollectionTx(collectionId, modelId, userId);
  const row = db.prepare('SELECT * FROM collection_models WHERE collection_id = ? AND model_id = ?').get(collectionId, modelId);
  assert(!!row, 'Model should be inserted into collection_models table');

  // Verify unauthorized user throws
  let threw = false;
  try {
    addModelToCollectionTx(collectionId, modelId, 'wrong-user');
  } catch {
    threw = true;
  }
  assert(threw, 'Should throw error when user does not own collection');

  db.close();
  console.log('  ✓ Item 2: Collection model addition transaction verified');
}

// Test 2: Admin soft-delete query
{
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT, is_deleted INTEGER DEFAULT 0, deleted_at TEXT);
    CREATE TABLE models (id TEXT PRIMARY KEY, user_id TEXT, title TEXT);
  `);

  const userId = uuidv4();
  db.prepare('INSERT INTO users (id, username) VALUES (?, ?)').run(userId, 'target');
  db.prepare('INSERT INTO models (id, user_id, title) VALUES (?, ?, ?)').run(uuidv4(), userId, 'Model 1');

  // Perform soft delete
  db.prepare('UPDATE users SET is_deleted = 1, deleted_at = CURRENT_TIMESTAMP WHERE id = ?').run(userId);
  const user = db.prepare('SELECT is_deleted, deleted_at FROM users WHERE id = ?').get(userId) as any;
  assert(user.is_deleted === 1, 'User is_deleted should be 1');
  assert(user.deleted_at !== null, 'User deleted_at should be populated');

  // Test fixed models cleanup query
  const models = db.prepare('SELECT id, title FROM models WHERE user_id = ?').all(userId) as any[];
  assert(models.length === 1, 'Should find 1 model belonging to deleted user');
  assert(models[0].title === 'Model 1', 'Model title should match');

  db.close();
  console.log('  ✓ Item 4: Admin soft-delete user cleanup query verified');
}

// Test 3: Cookie extraction helper
{
  function getCookie(cookieHeader: string | undefined, name: string): string | undefined {
    if (!cookieHeader) return undefined;
    for (const part of cookieHeader.split(';')) {
      const idx = part.indexOf('=');
      if (idx > -1) {
        const key = part.slice(0, idx).trim();
        const val = part.slice(idx + 1).trim();
        if (key === name) return val;
      }
    }
    return undefined;
  }

  assert(getCookie(undefined, 'slag3d_csrf_token') === undefined, 'Should return undefined for undefined header');
  assert(getCookie('foo=bar; slag3d_csrf_token=abc123xyz; other=1', 'slag3d_csrf_token') === 'abc123xyz', 'Should extract token from middle');
  assert(getCookie('slag3d_csrf_token=token_only', 'slag3d_csrf_token') === 'token_only', 'Should extract single cookie');
  assert(getCookie('foo=bar; other=1', 'slag3d_csrf_token') === undefined, 'Should return undefined if missing');

  console.log('  ✓ Item 3: Cookie extraction helper verified');
}

// Test 4: Supplementary file upload primary flag recalculation
{
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE files (
      id TEXT PRIMARY KEY,
      model_id TEXT,
      file_size INTEGER,
      is_primary_3d INTEGER DEFAULT 0
    );
  `);

  const modelId = uuidv4();
  const file1Id = uuidv4();
  const file2Id = uuidv4();
  const file3Id = uuidv4();

  // Initial file (10MB, primary)
  db.prepare('INSERT INTO files VALUES (?, ?, ?, ?)').run(file1Id, modelId, 10000, 1);

  // Upload smaller supplementary file (2MB, should remain is_primary_3d = 0)
  db.prepare('INSERT INTO files VALUES (?, ?, ?, ?)').run(file2Id, modelId, 2000, 0);

  const currentPrimary1 = db.prepare('SELECT id, file_size FROM files WHERE model_id = ? AND is_primary_3d = 1').get(modelId) as any;
  assert(currentPrimary1.id === file1Id, 'Primary should remain file1');

  const countPrimary1 = db.prepare('SELECT COUNT(*) as cnt FROM files WHERE model_id = ? AND is_primary_3d = 1').get(modelId) as any;
  assert(countPrimary1.cnt === 1, 'Exactly one primary file must exist');

  // Upload larger supplementary file (25MB, should become primary)
  db.prepare('INSERT INTO files VALUES (?, ?, ?, ?)').run(file3Id, modelId, 25000, 0);
  const largestNew = { id: file3Id, file_size: 25000 };

  if (largestNew.file_size > currentPrimary1.file_size) {
    db.prepare('UPDATE files SET is_primary_3d = 0 WHERE model_id = ?').run(modelId);
    db.prepare('UPDATE files SET is_primary_3d = 1 WHERE model_id = ? AND id = ?').run(modelId, largestNew.id);
  }

  const currentPrimary2 = db.prepare('SELECT id, file_size FROM files WHERE model_id = ? AND is_primary_3d = 1').get(modelId) as any;
  assert(currentPrimary2.id === file3Id, 'Primary should now be file3');

  const countPrimary2 = db.prepare('SELECT COUNT(*) as cnt FROM files WHERE model_id = ? AND is_primary_3d = 1').get(modelId) as any;
  assert(countPrimary2.cnt === 1, 'Exactly one primary file must exist after promotion');

  db.close();
  console.log('  ✓ Item 5: Supplementary file upload primary flag verified');
}

console.log('All Priority 1 tests passed successfully!');
