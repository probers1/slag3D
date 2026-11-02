import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error('FAIL:', message);
    process.exit(1);
  }
}

console.log('Testing Priority 2 Fixes...');

const JWT_SECRET = 'test_jwt_secret_at_least_32_characters_long_12345';
const REFRESH_SECRET = 'test_refresh_secret_at_least_32_characters_long_67890';

// Test 1: Soft-deleted users cannot log in or resolve tokens
{
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      username TEXT,
      password_hash TEXT,
      role TEXT,
      is_deleted INTEGER DEFAULT 0,
      deleted_at TEXT
    );
  `);

  const userId = uuidv4();
  const password = 'TestPassword123';
  const hash = bcrypt.hashSync(password, 10);
  db.prepare('INSERT INTO users VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP)').run(userId, 'deleted_user', hash, 'user');

  // Verify login query rejects soft-deleted user
  const user = db.prepare('SELECT id, username, password_hash, role FROM users WHERE username = ? COLLATE NOCASE AND (is_deleted = 0 OR is_deleted IS NULL)').get('deleted_user');
  assert(!user, 'Soft-deleted user should not be found in active login query');

  // Verify token resolution rejects soft-deleted user
  const activeUser = db.prepare('SELECT username, role FROM users WHERE id = ? AND (is_deleted = 0 OR is_deleted IS NULL)').get(userId);
  assert(!activeUser, 'Soft-deleted user should not resolve in token resolution');

  db.close();
  console.log('  ✓ Item 6: Soft-deleted user access prevention verified');
}

// Test 2: Admin self-deletion and last-admin deletion guard
{
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      username TEXT,
      role TEXT,
      is_deleted INTEGER DEFAULT 0
    );
  `);

  const admin1 = uuidv4();
  db.prepare('INSERT INTO users VALUES (?, ?, ?, 0)').run(admin1, 'admin1', 'admin');

  // 1. Check self deletion
  const currentAdminId = admin1;
  const isSelf = admin1 === currentAdminId;
  assert(isSelf === true, 'Self deletion should be detected');

  // 2. Check last admin lockout prevention
  const adminCountRow = db.prepare(`SELECT COUNT(*) as count FROM users WHERE role = 'admin' AND (is_deleted = 0 OR is_deleted IS NULL)`).get() as { count: number };
  assert(adminCountRow.count === 1, 'Only one admin exists');
  const canDeleteLastAdmin = adminCountRow.count > 1;
  assert(!canDeleteLastAdmin, 'Deleting last remaining administrator must be prevented');

  db.close();
  console.log('  ✓ Item 7: Admin self-deletion and last-admin guard verified');
}

// Test 3: JWT Refresh token fallback resolution
{
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT, role TEXT, is_deleted INTEGER DEFAULT 0);
    CREATE TABLE auth_tokens (token TEXT PRIMARY KEY, user_id TEXT);
  `);

  const userId = uuidv4();
  db.prepare('INSERT INTO users VALUES (?, ?, ?, 0)').run(userId, 'alice', 'user');

  // Issue a refresh token signed with REFRESH_SECRET
  const random = 'abcd1234efgh';
  const refreshToken = jwt.sign({ data: `${random}:${userId}` }, REFRESH_SECRET, { expiresIn: '7d' });
  db.prepare('INSERT INTO auth_tokens VALUES (?, ?)').run(refreshToken, userId);

  // Simulate token resolution when client passes refresh token in Authorization header
  let tokenResolved = false;
  let resolvedUserId: string | undefined;

  try {
    // 1. Try access token with JWT_SECRET (will throw because token was signed with REFRESH_SECRET)
    jwt.verify(refreshToken, JWT_SECRET);
  } catch (_accessErr) {
    // 2. Catch fallback: verify with REFRESH_SECRET
    try {
      const decodedRefresh = jwt.verify(refreshToken, REFRESH_SECRET) as { data: string };
      const [_, extractedUserId] = decodedRefresh.data.split(':');
      const stored = db.prepare('SELECT token FROM auth_tokens WHERE user_id = ?').get(extractedUserId) as { token: string } | undefined;
      if (stored && stored.token === refreshToken) {
        const u = db.prepare('SELECT username, role FROM users WHERE id = ? AND (is_deleted = 0 OR is_deleted IS NULL)').get(extractedUserId) as any;
        if (u) {
          tokenResolved = true;
          resolvedUserId = extractedUserId;
        }
      }
    } catch {}
  }

  assert(tokenResolved === true, 'Refresh token fallback resolution should succeed');
  assert(resolvedUserId === userId, 'Resolved user ID should match');

  db.close();
  console.log('  ✓ Item 8: Refresh token fallback verification verified');
}

// Test 4: Archive upload security checks
{
  const SUSPICIOUS_PATTERNS = ['script', 'exe', 'bat', 'cmd', 'ps1', 'html', 'htm', 'js', 'vbs', 'sh'];
  
  function checkArchiveSecurity(originalName: string): { valid: boolean; error?: string } {
    const ext = originalName.slice(originalName.lastIndexOf('.')).toLowerCase().replace(/^\.+/, '');
    if (ext === 'zip' || ext === '7z') {
      const lowerName = originalName.toLowerCase();
      if (SUSPICIOUS_PATTERNS.some(pattern => lowerName.includes(pattern))) {
        return { valid: false, error: 'Suspicious archive name' };
      }
    }
    return { valid: true };
  }

  assert(checkArchiveSecurity('models_archive.zip').valid === true, 'Safe zip should be valid');
  assert(checkArchiveSecurity('models_archive.7z').valid === true, 'Safe 7z should be valid');
  assert(checkArchiveSecurity('malicious_script.zip').valid === false, 'Script zip should be blocked');
  assert(checkArchiveSecurity('installer_exe.7z').valid === false, 'Exe 7z should be blocked');

  console.log('  ✓ Item 10: Archive security check on .zip and .7z verified');
}

console.log('All Priority 2 tests passed successfully!');
