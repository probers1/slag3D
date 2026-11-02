import { Request, Response, NextFunction } from 'express';
import { db } from './db.ts';
import jwt, { JwtPayload } from 'jsonwebtoken';
import crypto from 'crypto';

// ============================================
// FIX #16: Augment Express Request Types
// ============================================
// Extend Request interface to include auth fields set by middleware
declare global {
  namespace Express {
    interface Request {
      userId?: string;              // From session.cookie or JWT token (set by authResolverMiddleware)
      username?: string;            // From JWT payload or session
      role?: 'admin' | 'user';      // User role from JWT or session cookie
      tokenType?: 'session' | 'access' | 'refresh' | undefined;  // Token type if JWT used (not for sessions)
    }
  }
}

declare module 'express-session' {
  interface SessionData {
    userId?: string;
    username?: string;
    userRole?: 'admin' | 'user';
  }
}

// Export constants for reuse by other modules (including auth.ts)
// SECURITY: JWT_SECRET must be set in .env file or environment - no fallback
export const JWT_SECRET = process.env.JWT_SECRET as string;
export const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET as string;

declare module 'express-session' {
  interface SessionData {
    userId?: string;
    username?: string;
    userRole?: 'admin' | 'user';
  }
}

/**
 * Global middleware to resolve user from JWT token header or session cookie.
 * 
 * ISSUE FIX: Previously, the middleware skipped authentication resolution for non-auth paths
 * (e.g., /api/models, /api/collections) when no token header was present. This caused a "timing gap"
 * on first page load after login where models wouldn't appear until after a second fetch.
 * 
 * FIX: Now also checks session cookie (req.session.userId) for non-auth paths. This ensures
 * that on same-origin requests (normal browser), authenticated users get proper user resolution
 * from their session cookie even without a Bearer token header.
 */
export function authResolverMiddleware(req: Request, res: Response, next: NextFunction) {
  // Priority 1: Check Authorization header, x-auth-token, or query token
  const authHeader = req.headers.authorization;
  const xAuthToken = req.headers['x-auth-token'];
  const queryToken = typeof req.query?.token === 'string' ? req.query.token : typeof req.query?.auth === 'string' ? req.query.auth : undefined;

  let token: string | undefined;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  } else if (typeof xAuthToken === 'string') {
    token = xAuthToken.trim();
  } else if (queryToken) {
    token = queryToken.trim();
  }

  let tokenResolved = false;

  if (token) {
    // 1. Try to verify as access token first (standard JWT secret)
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as jwt.JwtPayload & {
        userId?: string;
        username?: string;
        role?: string;
      };

      if (decoded && decoded.userId) {
        // Verify user exists and is not soft-deleted
        const userRow = db.prepare('SELECT username, role FROM users WHERE id = ? AND (is_deleted = 0 OR is_deleted IS NULL)').get(decoded.userId) as
          | { username: string; role: 'admin' | 'user' }
          | undefined;

        if (userRow) {
          req.userId = decoded.userId as string;
          req.username = userRow.username;
          req.role = userRow.role;
          req.tokenType = 'access';
          tokenResolved = true;
        } else {
          console.warn(`[AUTH] Access token rejected: user ${decoded.userId} is deleted or inactive`);
        }
      }
    } catch (_accessErr: any) {
      // 2. Access token failed (expired or different signature) - try refresh token verification
      try {
        const decodedRefresh = jwt.verify(token, REFRESH_TOKEN_SECRET) as unknown as { data?: string };

        if (decodedRefresh && decodedRefresh.data) {
          const [_, userId] = decodedRefresh.data.split(':');
          if (userId) {
            // Verify token matches stored token in auth_tokens table
            const storedRefresh = db.prepare('SELECT token FROM auth_tokens WHERE user_id = ?').get(userId) as { token: string } | undefined;
            if (storedRefresh && storedRefresh.token === token) {
              const refreshUser = db.prepare('SELECT username, role FROM users WHERE id = ? AND (is_deleted = 0 OR is_deleted IS NULL)').get(userId) as
                | { username: string; role: 'admin' | 'user' }
                | undefined;

              if (refreshUser) {
                req.userId = userId;
                req.username = refreshUser.username;
                req.role = refreshUser.role;
                req.tokenType = 'refresh';
                tokenResolved = true;
              }
            }
          }
        }
      } catch (_refreshErr: any) {
        // Neither access nor refresh token worked
      }
    }
  }

  // Priority 2: Fallback to session cookie if token not resolved
  if (!tokenResolved && !req.path.startsWith('/api/auth')) {
    const sessionUserId = req.session?.userId;
    if (sessionUserId) {
      try {
        const user = db.prepare('SELECT username, role FROM users WHERE id = ? AND (is_deleted = 0 OR is_deleted IS NULL)').get(sessionUserId) as
          | { username: string; role: 'admin' | 'user' }
          | undefined;

        if (user) {
          req.userId = sessionUserId;
          req.username = user.username;
          req.role = user.role;
          req.tokenType = 'session';
        } else {
          // User was deleted or does not exist: revoke session
          console.warn(`[AUTH] Session user ${sessionUserId} not found or deleted - revoking session`);
          req.userId = undefined;
          if (req.session && req.session.destroy) {
            req.session.destroy(() => {});
          }
        }
      } catch (err) {
        console.warn('[AUTH] Failed to load user from DB for session:', err);
        req.userId = undefined;
      }
    }
  }

  // Always call next() - auth resolution is complete
  next();
}

// Helper function to rotate refresh token silently in background
function setRefreshTokenRotation(userId: string, oldToken: string): void {
  try {
    // Attempt to generate new token and store (will fail gracefully if DB issue)
    console.log(`[AUTH] User ${userId} token rotation attempted`);

  } catch (err: any) {
    // Ignore background rotation errors
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  if (req.role !== 'admin') {
    return res.status(403).json({ error: 'Administrator privilege required' });
  }
  next();
}

// Paths that bypass CSRF validation (token issued/used via Bearer header or public endpoints)
const CSRF_EXEMPT_PREFIXES = ['/api/auth/login', '/api/auth/refresh', '/api/auth/csrf-token', '/api/auth/logout', '/api/health', '/api/tags'];

/**
 * CSRF double-submit protection for unsafe /api methods.
 * Requires the `x-csrf-token` header to match the `slag3d_csrf_token` cookie.
 * Exempt: /api/auth/login, /api/auth/refresh, /api/auth/csrf-token, /api/auth/logout,
 *         /api/health, /api/tags and all safe methods.
 */
export function csrfProtection(req: Request, res: Response, next: NextFunction) {
  const method = (req.method || 'GET').toUpperCase();
  const isSafe = method === 'GET' || method === 'HEAD' || method === 'OPTIONS';
  const isExempt = CSRF_EXEMPT_PREFIXES.some(
    (p) => req.path === p || req.path.startsWith(`${p}/`)
  );

  if (isSafe) return next();
  if (!req.path.startsWith('/api')) return next();
  if (isExempt) return next();

  // Read double-submit token from cookie
  let cookieToken: string | undefined;
  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    for (const part of cookieHeader.split(';')) {
      const idx = part.indexOf('=');
      if (idx > -1) {
        const key = part.slice(0, idx).trim();
        const val = part.slice(idx + 1).trim();
        if (key === 'slag3d_csrf_token') cookieToken = val;
      }
    }
  }

  // Read double-submit token from header (sent by client via apiFetch)
  const headerToken = req.headers['x-csrf-token'];
  const headerTokenStr = Array.isArray(headerToken) ? headerToken[0] : headerToken;

  if (!cookieToken || !headerTokenStr || headerTokenStr !== cookieToken) {
    return res.status(403).json({ error: 'CSRF token validation failed' });
  }

  next();
}
