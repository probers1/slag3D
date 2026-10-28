import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db.ts';
import { requireAuth } from '../middleware.ts';
import jwt from 'jsonwebtoken';

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

  // Generate JWT token for API access (Bypassing session for now to resolve inconsistency)
  const token = jwt.sign(
    { userId: user.id, username: user.username, role: user.role },
    process.env.JWT_SECRET || 'default_secret',
    { expiresIn: '24h' }
  );

  res.json({
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
    },
    token,
  });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  let token: string | undefined;
  
  // Extract token from headers
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  } else if (typeof req.headers['x-auth-token'] === 'string') {
    token = req.headers['x-auth-token'].trim();
  }

  // 1. Invalidate token on the backend
  if (token) {
    try {
      db.prepare('DELETE FROM auth_tokens WHERE token = ?').run(token);
      console.log('Auth token successfully invalidated.');
    } catch (e) {
      console.warn('Could not delete auth token:', e);
    }
  }

  // 2. Destroy session
  req.session.destroy((err) => {
    if (err) {
      console.error('Failed to destroy session:', err);
    }

    // 3. Clear the cookie (Crucial step)
    res.clearCookie('connect.sid');
    
    // Always return success to the client, regardless of session destruction error
    res.status(200).json({ message: 'Successfully logged out' });
  });
});

// GET /api/auth/me - Check session first, then JWT token as fallback
router.get('/me', (req, res) => {
  // Try to get from session store first
  let userId = req.session.userId;
  
  // If session doesn't have userId, fall back to resolved JWT token from middleware
  if (!userId) {
    console.log('[SLAG3D GET /api/auth/me] No session userId, checking resolved JWT token...');
    const resolvedUserId = (req as any)?.userId || null;
    if (resolvedUserId) {
      userId = resolvedUserId;
    }
  }

  if (!userId) {
    console.warn('[SLAG3D GET /api/auth/me] No valid session or JWT token found');
    return res.json({ user: null });
  }

  const user = db.prepare('SELECT id, username, role, created_at FROM users WHERE id = ?').get(userId) as
    | { id: string; username: string; role: 'admin' | 'user'; created_at: string }
    | undefined;

  if (!user) {
    if (req.session && req.session.destroy) {
      req.session.destroy(() => {});
    }
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