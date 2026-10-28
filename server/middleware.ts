import { Request, Response, NextFunction } from 'express';
import { db } from './db.ts';
import jwt from 'jsonwebtoken'; // Added missing import

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

  // 3. Check Authorization header or x-auth-token (Handles initial login/iframe loads)
  const authHeader = req.headers.authorization;
  let token: string | undefined;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  } else if (typeof req.headers['x-auth-token'] === 'string') {
    token = req.headers['x-auth-token'].trim();
  }

  if (token) {
    try {
      // Verify JWT token
      const decoded: any = jwt.verify(token, process.env.JWT_SECRET || 'default_secret');
      
      // Set user fields in request for use in other middleware
      (req as any).userId = decoded.userId;
      (req as any).username = decoded.username;
      (req as any).role = decoded.role;
      
      // For debugging - log that we successfully decoded the token
      console.log('Successfully decoded JWT token for user:', decoded.userId);
    } catch (err) {
      console.warn('Error verifying JWT token:', err);
    }
  }

  next();
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