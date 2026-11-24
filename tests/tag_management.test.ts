/**
 * Regression test for global tag management.
 *
 * Exercises the real DB/migration path plus the shared tag helpers used by
 * uploads, metadata edits and the /api/tags router.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error('FAIL:', message);
    process.exit(1);
  }
}

async function main() {
  console.log('Testing tag management...');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'slag3d-tags-'));
  const previousDbPath = process.env.DB_PATH;
  process.env.DB_PATH = path.join(tmp, 'vault.db');

  try {
    const { initDatabase, db } = await import('../server/db.ts');
    const {
      TagConflictError,
      TagValidationError,
      createTag,
      deleteTag,
      getTagsWithCounts,
      normalizeTagName,
      syncModelTags,
      updateTag,
    } = await import('../server/lib/tags.ts');

    await initDatabase();

    // v6 columns must exist even on this freshly migrated database.
    const tagColumns = db.prepare('PRAGMA table_info(tags)').all() as Array<{ name: string }>;
    const columnNames = tagColumns.map((column) => column.name);
    assert(columnNames.includes('color'), 'tags.color column is missing');
    assert(columnNames.includes('description'), 'tags.description column is missing');

    db.prepare(`
      INSERT INTO users (id, username, password_hash, role)
      VALUES (?, ?, ?, 'user')
    `).run('user-1', 'owner', 'not-a-real-hash');
    db.prepare(`
      INSERT INTO models (id, user_id, title) VALUES (?, ?, ?)
    `).run('model-1', 'user-1', 'Tag test model');

    // Lenient sync: case-fold, whitespace→dash, dedupe, ignore empty values.
    syncModelTags('model-1', 'Voron, VORON, tool head, , ');
    let attached = db.prepare(`
      SELECT t.name FROM tags t
      JOIN model_tags mt ON mt.tag_id = t.id
      WHERE mt.model_id = ? ORDER BY t.name
    `).all('model-1') as Array<{ name: string }>;
    assert(
      attached.map((row) => row.name).join(',') === 'tool-head,voron',
      `Unexpected attached tags: ${attached.map((row) => row.name).join(',')}`
    );

    // Explicit CRUD normalizes metadata and keeps unused tags visible.
    const benchy = createTag({
      name: '  Benchy ',
      color: '#FF0000',
      description: '  calibration fixture  ',
    });
    assert(benchy.name === 'benchy', `Expected normalized name, got ${benchy.name}`);
    assert(benchy.color === '#ff0000', `Expected normalized color, got ${benchy.color}`);
    assert(benchy.description === 'calibration fixture', 'Description was not trimmed');
    assert(
      getTagsWithCounts().some((tag) => tag.name === 'benchy' && tag.count === 0),
      'Unused tags must remain visible in the registry'
    );

    const renamed = updateTag(benchy.id, {
      name: 'Benchy V2',
      color: '#00ff00',
      description: 'updated note',
    })!;
    assert(renamed.name === 'benchy-v2', `Update did not normalize name: ${renamed.name}`);
    assert(renamed.color === '#00ff00', 'Update did not persist color');
    assert(renamed.description === 'updated note', 'Update did not persist description');

    let conflicted = false;
    try {
      updateTag(benchy.id, { name: 'VORON', color: benchy.color, description: '' });
    } catch (err) {
      conflicted = err instanceof TagConflictError;
    }
    assert(conflicted, 'Case-insensitive duplicate rename should be rejected');

    let invalidName = false;
    try {
      normalizeTagName('   ');
    } catch (err) {
      invalidName = err instanceof TagValidationError;
    }
    assert(invalidName, 'Empty tag name should be rejected in strict mode');

    // Deleting a tag cascades to every item that used it.
    const voron = getTagsWithCounts().find((tag) => tag.name === 'voron')!;
    assert(deleteTag(voron.id), 'deleteTag reported no deletion');
    attached = db.prepare(`
      SELECT t.name FROM tags t
      JOIN model_tags mt ON mt.tag_id = t.id
      WHERE mt.model_id = ? ORDER BY t.name
    `).all('model-1') as Array<{ name: string }>;
    assert(
      attached.map((row) => row.name).join(',') === 'tool-head',
      'Deleting a tag did not detach it from its items'
    );
    assert(
      !getTagsWithCounts().some((tag) => tag.name === 'voron'),
      'Deleted tag still appears in the registry'
    );

    db.close();
    console.log('All tag management tests passed.');
  } finally {
    if (previousDbPath === undefined) delete process.env.DB_PATH;
    else process.env.DB_PATH = previousDbPath;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
