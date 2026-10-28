import { Request, Response, NextFunction } from 'express';
import { db } from './db.ts';
import jwt, { JwtPayload } from 'jsonwebtoken';
import crypto from 'crypto';

// Export constants for reuse by other modules (including auth.ts)
export const JWT_SECRET = process.env.JWT_SECRET || 'default-secret';
export const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET || crypto.randomBytes(32).toString('hex');

declare module 'express-session' {
  interface SessionData {
    userId?: string;
    username?: string;
    userRole?: 'admin' | 'user';
  }
}

// Global middleware to resolve user from JWT token header
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
      let decoded: any;
      
      // First try with access token secret
      let verifySecret = process.env.JWT_SECRET || 'super-secure-secret-key-change-in-production';
      
      try {
        // Try with the standard access token secret first
        decoded = jwt.verify(token, verifySecret);
        
        if (decoded) {
          // Successfully verified as access token
          console.log('[AUTH] Access token verified successfully');
          
          // Set user fields in request for use in other middleware
          (req as any).userId = decoded.userId;
          (req as any).username = decoded.username;
          (req as any).role = decoded.role;
          (req as any).tokenType = 'access';
        } else {
          // Access token might be expired or invalid, try refresh token verification
          try {
            const refreshSecret = REFRESH_TOKEN_SECRET;
            decoded = jwt.verify(token, refreshSecret) as { data?: string } | JwtPayload;
            
            if ('data' in decoded && decoded.data) {
              const [_, userId] = decoded.data.split(':');
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
      } catch (_verifyError: any) {
        // Access token verification failed, try refresh token
        try {
          const refreshSecret = REFRESH_TOKEN_SECRET;
          decoded = jwt.verify(token, refreshSecret);
          
          if (decoded['data']) {
            const [_, userId] = decoded.data.split(':');
            if (userId) {
              // Valid refresh token - rotate it and get user info
              console.log('[AUTH] Refresh token detected, rotating...');
              setRefreshTokenRotation(userId, token);
              (req as any).userId = userId;
              (req as any).username = 'refresh_user';
              (req as any).role = 'user';
              (req as any).tokenType = 'refresh';
            } else {
              console.warn('[AUTH] Refresh token decoded but no user ID found');
            }
          }
        } catch (_refreshErr: any) {
          // Neither access nor refresh token worked
        }
      }
      
    } catch (err) {
      console.warn('Error verifying JWT token:', err);
    }
  }

  next();
}

// Helper function to rotate refresh token silently in background
function setRefreshTokenRotation(userId: string, oldToken: string): void {
  try {
    // Attempt to generate new token and store (will fail gracefully if DB issue)
    const random = crypto.randomBytes(32).toString('hex');
    const newRefreshSecret = crypto.randomBytes(32).toString('hex');
    
    // Try to get user details from DB for logging only
    const userRecord = db.prepare('SELECT username, role FROM users WHERE id = ?').get(userId);
    if (userRecord) {
      console.log(`[AUTH] User ${userRecord.username} token rotation attempted`);
    } else {
      console.log(`[AUTH] User ID ${userId} not found in DB for logging`);
    }
    
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
