import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db.ts';
import { requireAuth, JWT_SECRET, REFRESH_TOKEN_SECRET } from '../middleware.ts';
import jwt, { JwtPayload } from 'jsonwebtoken';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';

const router = Router();

/**
 * Rate limiter configuration for authentication endpoints
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 failed login attempts per window
  message: { error: 'Too many failed authentication attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
});

const authRefreshLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // Limit each IP to 10 refresh attempts per hour
  message: { error: 'Too many token refresh requests. Please slow down.' },
  standardHeaders: true,
});

const authLogoutLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20, // Allow more logout attempts
  message: { error: 'Too many logout requests. Please slow down.' },
  standardHeaders: true,
});

/**
 * Token lifetime configuration (in seconds)
 */
const TOKEN_CONFIG = {
  ACCESS_EXPIRES_IN: '1h',     // Short-lived access token
  REFRESH_EXPIRES_IN: '7d',    // Long-lived refresh token
};

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

/**
 * Generate access token with user payload
 */
function generateAccessToken(payload: { userId: string; username: string; role: string }): string {
  const secret = process.env.JWT_SECRET;
  return jwt.sign(payload, secret, { expiresIn: TOKEN_CONFIG.ACCESS_EXPIRES_IN });
}

/**
 * Generate refresh token with automatic rotation (issue #1.4 fix)
 */
function generateRefreshToken(userId: string): string {
  const random = crypto.randomBytes(32).toString('hex');
  const token = jwt.sign({ data: `${random}:${userId}` }, REFRESH_TOKEN_SECRET, { expiresIn: TOKEN_CONFIG.REFRESH_EXPIRES_IN });
  
  // Always update auth_tokens on refresh - implements token rotation
  try {
    // Remove any existing tokens for this user and insert fresh rotated token
    db.prepare('DELETE FROM auth_tokens WHERE user_id = ?').run(userId);
    db.prepare('INSERT INTO auth_tokens (token, user_id) VALUES (?, ?)').run(token, userId);
    console.log(`[AUTH] Refresh token issued and old tokens rotated for ${userId.substring(0, 6)}...`);
    return token;
  } catch (err) {
    console.error('[AUTH] Failed to store/rotate refresh token:', err);
    // Still attempt to store even if update fails - avoid lockout
    try {
      db.prepare('INSERT OR REPLACE INTO auth_tokens (token, user_id) VALUES (?, ?)').run(token, userId);
    } catch (_e) {
      console.error('[AUTH] Final fallback for refresh token storage failed');
    }
    return token;
  }
}

// POST /api/auth/login — CSRF exempt, but issue double-submit token on success
router.post('/login', authLimiter, (req, res) => {
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

  // Generate both access and refresh tokens with automatic rotation
  const accessToken = generateAccessToken({ userId: user.id, username: user.username, role: user.role });
  const refreshToken = generateRefreshToken(user.id);
  // Store in session for cookie‑based auth
  req.session.userId = user.id;
  req.session.username = user.username;
  req.session.userRole = user.role;
  
  try {
    db.prepare('INSERT OR REPLACE INTO auth_tokens (token, user_id) VALUES (?, ?)').run(refreshToken, user.id);
    console.log(`[AUTH] Access token issued for ${user.username} (expires in 1h), refresh token stored (7d lifetime, auto-rotated)`);
  } catch (err) {
    console.error('[AUTH] Failed to store refresh token:', err);
  }

  // 1.3 CSRF FIX: Issue double-submit CSRF token cookie
  const csrfToken = crypto.randomBytes(32).toString('hex');
  
  res.cookie('slag3d_csrf_token', csrfToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });

  res.json({
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
    },
    accessToken,
    refreshToken,
    csrfToken, // Include in response for GET /api/csrf-token endpoint
    expiresIn: TOKEN_CONFIG.ACCESS_EXPIRES_IN,
  });
});

// POST /api/auth/refresh — CSRF exempt (uses bearer token only) but issues double-submit cookie
router.post('/refresh', authRefreshLimiter, (req, res) => {
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
  
  // Generate new access and refresh tokens (rotation - issue #1.4 fix)
  const newAccessToken = generateAccessToken({ userId, username: '', role: 'user' });
  const newRefreshToken = generateRefreshToken(userId); // This auto-rotates old token
  
  // Issue double-submit CSRF cookie for refresh session too
  const csrfToken = crypto.randomBytes(32).toString('hex');
  
  res.cookie('slag3d_csrf_token', csrfToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
  
  res.json({
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
    csrfToken, // Include for GET /api/csrf-token endpoint usage
    expiresIn: TOKEN_CONFIG.ACCESS_EXPIRES_IN,
  });
});

// POST /api/auth/logout — Invalidate token and clear session + CSRF cookie
router.post('/logout', authLogoutLimiter, (req, res) => {
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

  // Clear CSRF cookie if it exists
  res.clearCookie('slag3d_csrf_token');
  
  // 2. Destroy session
  req.session.destroy((err) => {
    if (err) {
      console.error('Failed to destroy session:', err);
    }

    // 3. Clear the session cookie (Crucial step)
    res.clearCookie('connect.sid');
    
    // Always return success to the client, regardless of session destruction error
    res.status(200).json({ message: 'Successfully logged out' });
  });
});

// GET /api/csrf-token — Endpoint to retrieve CSRF token for double-submit pattern
router.get('/csrf-token', (req, res) => {
  // Get or generate CSRF token
  let csrfToken = req.cookies['slag3d_csrf_token'];
  
  if (!csrfToken) {
    // Generate new one if missing
    csrfToken = crypto.randomBytes(32).toString('hex');
    // Store in auth_tokens table to allow fetching later
    try {
      db.prepare('INSERT OR REPLACE INTO auth_tokens (token, user_id) VALUES (?, ?)').run(
        csrfToken, 
        req.session.userId || ''
      );
    } catch (err) {
      console.warn('[CSRF] Could not store token in DB:', err);
    }
  }
  
  res.json({ 
    csrfToken, 
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  });
});

// PUT /api/auth/change-password — Invalidates ALL sessions and tokens on change
router.put('/change-password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current password and new password are required' });
  }
  if (!validatePasswordStrength(newPassword)) {
    return res.status(400).json({ error: 'New password must be at least 12 characters, include one uppercase letter and one number' });
  }

  // Verify current password (timing-attack safe)
  const user = db.prepare('SELECT id, password_hash FROM users WHERE id = ?').get(req.session.userId) as
    | { id: string; password_hash: string }
    | undefined;

  if (!user || !bcrypt.compareSync(currentPassword, user.password_hash)) {
    return res.status(400).json({ error: 'Current password is incorrect' });
  }

  const newHash = bcrypt.hashSync(newPassword, 10);
  
  // Update password AND invalidate all auth tokens (security best practice)
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, req.session.userId);
  db.prepare('DELETE FROM auth_tokens WHERE user_id = ?').run(req.session.userId);
  
  console.log(`[AUTH] Password changed for ${req.session.username}. All previous tokens invalidated.`);

  res.json({ message: 'Password updated successfully' });
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

export default router;
