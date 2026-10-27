import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db.ts';
import { requireAuth } from '../middleware.ts';

const router = Router();

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  const user = db.prepare('SELECT id, username, password_hash, role FROM users WHERE username = ? COLLATE NOCASE').get(username) as
    | { id: string; username: string; password_hash: string; role: 'admin' | 'user' }
    | undefined;

  if (!user) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const isMatch = bcrypt.compareSync(password, user.password_hash);
  if (!isMatch) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  req.session.userId = user.id;
  req.session.username = user.username;
  req.session.userRole = user.role;

  // Generate auth token for iframe & Bearer authentication
  const token = uuidv4();
  try {
    db.prepare('INSERT INTO auth_tokens (token, user_id) VALUES (?, ?)').run(token, user.id);
  } catch (err) {
    console.error('Failed to store auth token:', err);
  }

  req.session.save((err) => {
    if (err) {
      console.error('Session save warning:', err);
    }
    res.json({
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
      },
      token,
    });
  });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  const authHeader = req.headers.authorization;
  let token: string | undefined;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  } else if (typeof req.headers['x-auth-token'] === 'string') {
    token = req.headers['x-auth-token'].trim();
  }

  if (token) {
    try {
      db.prepare('DELETE FROM auth_tokens WHERE token = ?').run(token);
    } catch {}
  }

  req.session.destroy((err) => {
    if (err) {
      console.error('Session destroy warning:', err);
    }
    res.clearCookie('connect.sid');
    res.json({ message: 'Successfully logged out' });
  });
});

// GET /api/auth/me
router.get('/me', (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.json({ user: null });
  }

  const user = db.prepare('SELECT id, username, role, created_at FROM users WHERE id = ?').get(req.session.userId) as
    | { id: string; username: string; role: 'admin' | 'user'; created_at: string }
    | undefined;

  if (!user) {
    if (req.session.destroy) req.session.destroy(() => {});
    return res.json({ user: null });
  }

  res.json({ user });
});

// PUT /api/auth/change-password
router.put('/change-password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current password and new password are required' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters long' });
  }

  const user = db.prepare('SELECT id, password_hash FROM users WHERE id = ?').get(req.session.userId) as
    | { id: string; password_hash: string }
    | undefined;

  if (!user || !bcrypt.compareSync(currentPassword, user.password_hash)) {
    return res.status(400).json({ error: 'Current password is incorrect' });
  }

  const newHash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, req.session.userId);

  res.json({ message: 'Password updated successfully' });
});

export default router;
