import { Request, Response, NextFunction } from 'express';
import { db } from './db.ts';

declare module 'express-session' {
  interface SessionData {
    userId?: string;
    username?: string;
    userRole?: 'admin' | 'user';
  }
}

// Global middleware to resolve user from either session or Authorization / x-auth-token header
export function authResolverMiddleware(req: Request, res: Response, next: NextFunction) {
  if (req.session && req.session.userId) {
    return next();
  }

  // Check Authorization header or x-auth-token
  const authHeader = req.headers.authorization;
  let token: string | undefined;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  } else if (typeof req.headers['x-auth-token'] === 'string') {
    token = req.headers['x-auth-token'].trim();
  }

  if (token) {
    try {
      const user = db.prepare(`
        SELECT u.id, u.username, u.role
        FROM auth_tokens t
        JOIN users u ON u.id = t.user_id
        WHERE t.token = ?
      `).get(token) as { id: string; username: string; role: 'admin' | 'user' } | undefined;

      if (user) {
        if (!req.session) {
          (req as any).session = {};
        }
        req.session.userId = user.id;
        req.session.username = user.username;
        req.session.userRole = user.role;
      }
    } catch (err) {
      console.warn('Error resolving auth token:', err);
    }
  }

  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  if (req.session.userRole !== 'admin') {
    return res.status(403).json({ error: 'Administrator privilege required' });
  }
  next();
}
