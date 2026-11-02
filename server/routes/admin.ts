import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db.ts';
import { requireAdmin } from '../middleware.ts';
import { validatePasswordStrength } from '../lib/passwordValidation.ts';

const router = Router();
router.use(requireAdmin);

// GET /api/admin/users
router.get('/users', (req, res) => {
  const users = db.prepare('SELECT id, username, role, created_at, is_deleted FROM users WHERE is_deleted = 0 ORDER BY created_at ASC').all();
  res.json({ users });
});

// POST /api/admin/users
router.post('/users', (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  const cleanUsername = String(username).trim();
  if (cleanUsername.length < 3) {
    return res.status(400).json({ error: 'Username must be at least 3 characters long' });
  }

  if (!validatePasswordStrength(password)) {
    return res.status(400).json({ error: 'Password must be at least 12 characters, include one uppercase letter and one number' });
  }

  const userRole = role === 'admin' ? 'admin' : 'user';

  // Check unique username
  const existing = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(cleanUsername);
  if (existing) {
    return res.status(409).json({ error: 'Username is already taken' });
  }

  const id = uuidv4();
  const passwordHash = bcrypt.hashSync(password, 10);

  db.prepare(`
    INSERT INTO users (id, username, password_hash, role)
    VALUES (?, ?, ?, ?)
  `).run(id, cleanUsername, passwordHash, userRole);

  const newUser = db.prepare('SELECT id, username, role, created_at FROM users WHERE id = ?').get(id);
  res.status(201).json({ user: newUser });
});

// PUT /api/admin/users/:id/reset-password
router.put('/users/:id/reset-password', (req, res) => {
  const { id } = req.params;
  const { newPassword } = req.body;

  if (!validatePasswordStrength(newPassword)) {
    return res.status(400).json({ error: 'New password must be at least 12 characters, include one uppercase letter and one number' });
  }

  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, id);

  // Invalidate all refresh tokens issued to this user after a password reset
  db.prepare('DELETE FROM auth_tokens WHERE user_id = ?').run(id);

  res.json({ message: 'User password reset successfully' });
});

// DELETE /api/admin/users/:id — Soft delete users to prevent data loss
router.delete('/users/:id', (req, res) => {
  const { id } = req.params;
  const currentAdminId = req.userId || req.session?.userId;

  if (id === currentAdminId) {
    return res.status(400).json({ error: 'You cannot delete your own account' });
  }

  const targetUser = db.prepare('SELECT id, role FROM users WHERE id = ?').get(id) as { id: string; role: string } | undefined;
  if (!targetUser) {
    return res.status(404).json({ error: 'User not found' });
  }

  // Prevent deleting the last remaining active administrator
  if (targetUser.role === 'admin') {
    const adminCountRow = db.prepare(`SELECT COUNT(*) as count FROM users WHERE role = 'admin' AND (is_deleted = 0 OR is_deleted IS NULL)`).get() as { count: number };
    if (adminCountRow.count <= 1) {
      return res.status(400).json({ error: 'Cannot delete the last remaining administrator account' });
    }
  }
  
  // Update soft-delete flag and timestamp if available
  const userColumns = (db.prepare(`PRAGMA table_info(users)`).all() as Array<{ name: string }>).map((c) => c.name);
  const updateSql = userColumns.includes('deleted_at')
    ? `UPDATE users SET is_deleted = 1, deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND is_deleted = 0`
    : `UPDATE users SET is_deleted = 1 WHERE id = ? AND is_deleted = 0`;

  const deletedRows = db.prepare(updateSql).run(id);
  
  if (deletedRows.changes === 0) {
    return res.status(404).json({ error: 'User already deleted or not found' });
  }

  // Invalidate any active refresh tokens for the soft-deleted user
  try {
    db.prepare('DELETE FROM auth_tokens WHERE user_id = ?').run(id);
  } catch (tokenErr: any) {
    console.warn('[ADMIN] Failed to clear auth tokens for soft-deleted user:', tokenErr?.message);
  }

  // Check orphaned models belonging to deleted user
  try {
    const modelsToArchive = db.prepare(`
      SELECT id, title FROM models WHERE user_id = ?
    `).all(id);

    if (modelsToArchive.length > 0) {
      console.log(`[DATA CLEANUP] ${modelsToArchive.length} models belong to deleted user ${id}. Data retained for recovery.`);
    }
  } catch (err: any) {
    console.warn('[ADMIN] Cleanup warning:', err?.message);
  }

  res.json({ message: `User soft-deleted successfully` });
});

export default router;
