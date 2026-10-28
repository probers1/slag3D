import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db.ts';
import { requireAuth } from '../middleware.ts';
import jwt, { JwtPayload } from 'jsonwebtoken';
import crypto from 'crypto';

// Export constants for reuse by other modules
export const JWT_SECRET = process.env.JWT_SECRET || 'default-secret';
export const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET || crypto.randomBytes(32).toString('hex');

const router = Router();

/**
 * Token lifetime configuration (in seconds)
 */
const TOKEN_CONFIG = {
  ACCESS_EXPIRES_IN: '1h',     // Short-lived access token
  REFRESH_EXPIRES_IN: '7d',    // Long-lived refresh token
};

/**
 * Generate access token with user payload
 */
function generateAccessToken(payload: { userId: string; username: string; role: string }): string {
  const secret = process.env.JWT_SECRET || 'default-secret';
  return jwt.sign(payload, secret, { expiresIn: TOKEN_CONFIG.ACCESS_EXPIRES_IN });
}

/**
 * Generate refresh token and store in database for revocation
 */
function generateRefreshToken(userId: string): string {
  const random = crypto.randomBytes(32).toString('hex');
  const token = jwt.sign({ data: `${random}:${userId}` }, REFRESH_TOKEN_SECRET, { expiresIn: TOKEN_CONFIG.REFRESH_EXPIRES_IN });
  
  try {
    db.prepare('INSERT OR REPLACE INTO auth_tokens (token, user_id) VALUES (?, ?)').run(token, userId);
    return token;
  } catch (err) {
    console.error('[AUTH] Failed to store refresh token:', err);
    return '';
  }
}

/**
 * Verify access token with standard secret
 */
function verifyAccessToken(token: string): any | null {
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'default-secret');
    return decoded;
  } catch {
    return null;
  }
}

/**
 * Verify refresh token with separate secret
 */
function verifyRefreshToken(token: string): any | null {
  try {
    const decoded = jwt.verify(token, REFRESH_TOKEN_SECRET) as { data?: string } | JwtPayload;
    
    // If decoded token has 'data' property (our refresh token format), extract user ID from it
    if ('data' in decoded && decoded.data) {
      const [_, userId] = decoded.data.split(':');
      
      // Verify this token is still valid in the DB
      const stored = db.prepare('SELECT token FROM auth_tokens WHERE user_id = ?').get(userId);
      if (stored && typeof stored === 'object' && 'token' in stored && safeCompare((stored as any).token, token)) {
        return decoded;
      }
    }
    
    return null;
  } catch {
    return null;
  }
}

/**
 * Safe string comparison to prevent timing attacks
 */
function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

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

  // Generate both access and refresh tokens
  const accessToken = generateAccessToken({ userId: user.id, username: user.username, role: user.role });
  const refreshToken = generateRefreshToken(user.id);
  
  try {
    db.prepare('INSERT OR REPLACE INTO auth_tokens (token, user_id) VALUES (?, ?)').run(refreshToken, user.id);
    console.log(`[AUTH] Access token issued for ${user.username} (expires in 1h), refresh token stored (7d lifetime)`);
  } catch (err) {
    console.error('[AUTH] Failed to store refresh token:', err);
  }

  res.json({
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
    },
    accessToken,
    refreshToken,
    expiresIn: TOKEN_CONFIG.ACCESS_EXPIRES_IN,
  });
});

// POST /api/auth/refresh - Exchange refresh token for new access+refresh pair
router.post('/refresh', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }
  
  const refreshToken = authHeader.substring(7).trim();
  
  let userId: string | null;
  try {
    // Verify the refresh token and get user ID from it
    const decoded = jwt.verify(refreshToken, REFRESH_TOKEN_SECRET) as { data: string };
    const [_, storedUserId] = decoded.data.split(':');
    userId = storedUserId || null;
    
    if (!userId) {
      return res.status(401).json({ error: 'Invalid refresh token' });
    }
    
    // Check if this user still has a valid refresh token in DB (rotation check)
    const storedRefresh = db.prepare('SELECT token FROM auth_tokens WHERE user_id = ?').get(userId);
    if (!storedRefresh) {
      console.log(`[AUTH] No refresh token found for user ${userId}`);
      return res.status(401).json({ error: 'Refresh token not found or expired' });
    }
    
  } catch (err: any) {
    console.error('[AUTH] Token verification failed:', err.message);
    return res.status(401).json({ error: 'Invalid refresh token' });
  }
  
  // Generate new access and refresh tokens (rotation)
  const newAccessToken = generateAccessToken({ userId, username: '', role: 'user' });
  const newRefreshToken = generateRefreshToken(userId);
  
  // Store new refresh token (rotation - removes old one silently)
  try {
    db.prepare('INSERT OR REPLACE INTO auth_tokens (token, user_id) VALUES (?, ?)').run(newRefreshToken, userId);
    console.log(`[AUTH] New refresh token issued for user ${userId} (rotation)`);
  } catch (err) {
    console.error('[AUTH] Failed to store new refresh token:', err);
  }
  
  res.json({
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
    expiresIn: TOKEN_CONFIG.ACCESS_EXPIRES_IN,
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

  // 1. Invalidate refresh token on the backend (delete from DB)
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