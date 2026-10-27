import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db.ts';
import { requireAdmin } from '../middleware.ts';

const router = Router();
router.use(requireAdmin);

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

  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters long' });
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

  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters long' });
  }

  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, id);

  res.json({ message: 'User password reset successfully' });
});

// DELETE /api/admin/users/:id
router.delete('/users/:id', (req, res) => {
  const { id } = req.params;

  if (id === req.session.userId) {
    return res.status(400).json({ error: 'You cannot delete your own administrator account' });
  }

  const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(id) as { id: string; username: string } | undefined;
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json({ message: `User ${user.username} deleted successfully` });
});

export default router;
