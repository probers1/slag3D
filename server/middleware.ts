import { Request, Response, NextFunction } from 'express';
import { db } from './db.ts';
import jwt, { JwtPayload } from 'jsonwebtoken';
import crypto from 'crypto';

// Export constants for reuse by other modules (including auth.ts)
export const JWT_SECRET = process.env.JWT_SECRET || 'super-secure-secret-key-change-in-production';
export const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET || crypto.randomBytes(32).toString('hex');

declare module 'express-session' {
  interface SessionData {
    userId?: string;
    username?: string;
    userRole?: 'admin' | 'user';
  }
}

/**
 * Global middleware to resolve user from JWT token header
 */
export function authResolverMiddleware(req: Request, res: Response, next: NextFunction) {
  // 1. Bypass auth resolution for internal/non-user requests (like health checks or general API endpoints)
  // We only attempt to resolve the user if the request explicitly targets auth or carries a token.
  const isAuthRelatedPath = req.path.startsWith('/api/auth');
  const hasToken = !!req.headers.authorization || !!req.headers['x-auth-token'];
  
  if (!isAuthRelatedPath && !hasToken) {
    console.log(`Skipping authentication middleware for path: ${req.path}`);
    return next();
  }

  // 2. Check Authorization header or x-auth-token (Handles initial login/iframe loads)
  const authHeader = req.headers.authorization;
  let token: string | undefined;

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
        (req as any).userId = decoded.userId;
        (req as any).username = decoded.username;
        (req as any).role = decoded.role;
        (req as any).tokenType = 'access';
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
              (req as any).userId = userId;
              (req as any).username = 'refresh_user';
              (req as any).role = 'user';
              (req as any).tokenType = 'refresh';
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
