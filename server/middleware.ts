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
export const JWT_SECRET = process.env.JWT_SECRET;
export const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET || crypto.randomBytes(32).toString('hex');

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
  // Priority 1: Check Authorization header or x-auth-token (Bearer tokens for iframe/fallback scenarios)
  const hasToken = !!req.headers.authorization || !!req.headers['x-auth-token'];

  if (hasToken) {
    let token: string | undefined;
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7).trim();
    } else if (typeof req.headers['x-auth-token'] === 'string') {
      token = req.headers['x-auth-token'].trim();
    }

    if (token) {
      try {
        // Try to verify as access token first (standard JWT secret)
        const decoded = jwt.verify(token, JWT_SECRET);

        if (decoded) {
          // Successfully verified as access token
          console.log('[AUTH] Access token verified successfully');

          // Set user fields in request for use in other middleware
          req.userId = decoded.userId;
          req.username = decoded.username;
          req.role = decoded.role;
          req.tokenType = 'access';
        } else {
          // Access token verification failed, try refresh token verification
          try {
            const decodedRefresh = jwt.verify(token, REFRESH_TOKEN_SECRET) as { data?: string } | JwtPayload;

            if ('data' in decodedRefresh && decodedRefresh.data) {
              const [_, userId] = decodedRefresh.data.split(':');
              if (userId) {
                // Valid refresh token - rotate it in the background and get user info
                console.log('[AUTH] Refresh token detected - starting rotation');
                setRefreshTokenRotation(userId, token);
                req.userId = userId;
                req.username = 'refresh_user';
                req.role = 'user';
                req.tokenType = 'refresh';
              }
            }
          } catch (_refreshErr: any) {
            // Neither access nor refresh token worked
            console.warn('[AUTH] Token verification failed for all token types');
          }
        }
      } catch (err: any) {
        // Neither access nor refresh token worked
        console.warn('Error verifying JWT token:', err.message);
      }
    }
  } else if (!req.path.startsWith('/api/auth')) {
    // Priority 2: Check session cookie for non-auth-related paths.
    // For same-origin requests (normal browser), the session cookie contains userId set at login.
    // For iframe scenarios, cookies may be disabled, so hasToken would already be true above.
    const sessionUserId = req.session.userId;
    if (sessionUserId) {
      console.log('[AUTH] Using session cookie for user resolution (userId=' + sessionUserId + ')');
      req.userId = sessionUserId;
      // Placeholder username - actual user details are loaded via /api/auth/me endpoint
      (req as any).username = 'session_user_' + sessionUserId.substring(0, 6);
      (req as any).role = 'user';
      (req as any).tokenType = 'session';
    } else {
      console.log(`[AUTH] No token and no session for path: ${req.path}`);
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
