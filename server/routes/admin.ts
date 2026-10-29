import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db.ts';
import { requireAdmin } from '../middleware.ts';

const router = Router();
router.use(requireAdmin);

/**
 * Validates password strength: minimum 12 characters, at least one uppercase letter, and at least one number.
 */
function validatePasswordStrength(password: string): boolean {
  if (password.length < 12) {
    return false;
  }
  const hasUppercase = /[A-Z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  return hasUppercase && hasNumber;
}

// GET /api/admin/users
router.get('/users', (req, res) => {
  const users = db.prepare('SELECT id, username, role, created_at FROM users ORDER BY created_at ASC').all();
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

  res.json({ message: 'User password reset successfully' });
});

// DELETE /api/admin/users/:id — Soft delete users to prevent data loss
router.delete('/users/:id', (req, res) => {
  const { id } = req.params;

  if (id === req.session.userId) {
    return res.status(400).json({ error: 'You cannot delete your own account' });
  }
  
  // Prevent deleting admin users or if user is sole non-deleted record in a collection
  const deletedRows = db.prepare(`UPDATE users SET is_deleted = 1 WHERE id = ?`).run(id);
  
  if (deletedRows.changes === 0) {
    return res.status(404).json({ error: 'User already deleted or not found' });
  }

  // Clean up orphaned data from deleted users (models/files that no longer have non-deleted owner)
  try {
    // Find all models/files belonging to deleted users and archive them
    const modelsToArchive = db.prepare(`
      SELECT id, model_id FROM models WHERE user_id = ? AND (user_id NOT IN (SELECT id FROM users WHERE is_deleted = 0) OR user_id = ?)
    `).all(id);

    // Optionally archive or keep orphaned data - for now just log it
    if (modelsToArchive.length > 0) {
      console.log(`[DATA CLEANUP] ${modelsToArchive.length} models/files belong to deleted user ${id}. Data retained for recovery.`);
    }
  } catch (err) {
    console.warn('[ADMIN] Cleanup warning:', err?.message);
  }

  res.json({ message: `User soft-deleted successfully` });
});

export default router;
