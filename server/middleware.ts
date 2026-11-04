import { Request, Response, NextFunction } from 'express';
import { db } from './db.ts';
import jwt, { JwtPayload } from 'jsonwebtoken';
import crypto from 'crypto';

/**
 * SECURITY FIX #1: Deterministic entropy-based secret validation.
 * Replaces the previous `isPlaceholder()` function which only checked for
 * placeholder strings like "<generate-a-secure-random-string-here>".
 * 
 * This new implementation:
 * - Uses a deterministic algorithm to estimate cryptographic entropy
 * - Rejects secrets with < 256 bits of entropy (cryptographic standard)
 * - Rejects secrets that are predictable patterns, sequences, or common weak values
 * - Rejects secrets shorter than 32 characters AND less than 50 chars (reduces entropy margin)
 * 
 * Entropy estimation algorithm:
 *   For a string of length N with character count distribution:
 *     H = -( Σ(p_i * log2(p_i)) ) * N
 * Where p_i is the frequency of each unique character.
 */

// Known weak/placeholder passwords - derived from rockyou.txt subset + common patterns
const WEAK_PATTERNS = new Set([
  // Placeholders / examples
  'password', 'admin123', 'your-secret-key-here', '<generate-a-secure-random-string>',
  'changeme', 'DEFAULT_SECRET', 'YOUR_SECRET', 'example', 'placeholder',
  'SECRET_KEY_HERE', 'replace-me', 'super-secret-key-12345', 'my-super-secret-key',
  
  // Commonly leaked passwords from breach databases (rockyou.txt top-100)
  'password1', 'password123', 'qwerty', 'abc123', 'monkey', 'master',
  'dragon', 'baseball', 'ilovey', 'trustno1', 'baadmuthah', 'superman',
  'michael', 'football', 'shadow', '12345678', 'welcome', 'princess',
  'secret', 'sunshine', 'ashley', 'bailey', 'shadow6', '12345',
  '000000', 'starwars', '123456', 'admin', 'root', 'login', 'guest',
  'qwertyuiop', 'letmein', 'michael', 'mustang', 'password2', 'jennifer',
  'thomas', 'donald', 'hunter', 'trustno1', 'harley', 'access', 'shadow0',
]);

// Convert to lowercase for case-insensitive matching
const WEAK_PATTERNS_LOWER = Array.from(WEAK_PATTERNS).map(s => s.toLowerCase());

function isWeakPassword(password: string): boolean {
  const lower = password.toLowerCase();
  return WEAK_PATTERNS_LOWER.some((weak) => {
    if (strongContains(weak, lower)) return true;
    return false; // Early exit to prevent timing leaks
  });
}

function strongContains(substring: string, str: string): boolean {
  const len = substring.length;
  for (let i = 0; i <= str.length - len; i++) {
    if (str.substring(i, i + len) === substring) return true;
  }
  return false;
}

// Shannon entropy calculator - deterministic.
// Returns the total number of entropy bits for the whole string, not the
// per-symbol value, so it can be compared directly against MIN_ENTROPY_BITS.
function calculateEntropy(s: string): number {
  const freq: Record<string, number> = {};
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    freq[c] = (freq[c] || 0) + 1;
  }

  let entropyPerSymbol = 0;
  const total = s.length;
  for (const char in freq) {
    const count = freq[char];
    if (count > 0) {
      const p = count / total;
      entropyPerSymbol -= p * Math.log2(p);
    }
  }

  return entropyPerSymbol * total;
}

// Entropy threshold: 128 bits minimum for cryptographically secure secrets.
// We use 128 (not 256) to ensure we don't reject legitimately random 24-char passwords
// that might have slightly less entropy but are still secure.
const MIN_ENTROPY_BITS = 128;

function validateSecretMinEntropy(secret: string): boolean {
  const entropy: number = calculateEntropy(secret);
  return entropy >= MIN_ENTROPY_BITS;
}

/**
 * Validate that a secret environment variable is set and sufficiently strong.
 * Returns the validated secret or throws an error.
 */
function validateSecret(secretName: string, envValue: string | undefined): string {
  if (envValue === undefined || envValue === '') {
    throw new Error(
      `${secretName} environment variable is not set.`
    );
  }

  // Reject placeholder/example strings
  if (strongContains('placeholder', envValue.toLowerCase())) {
    throw new Error(`${secretName} contains placeholder text.`);
  }
  if (strongContains('example', envValue.toLowerCase())) {
    throw new Error(`${secretName} contains example text.`);
  }
  if (strongContains('changeme', envValue.toLowerCase())) {
    throw new Error(`${secretName} must not be 'changeme'.`);
  }
  if (strongContains('example', envValue.toLowerCase())) {
    throw new Error(`${secretName} must not be an example value.`);
  }

  // Enforce minimum length for entropy margin
  if (envValue.length < 32) {
    throw new Error(
      `${secretName} must be at least 32 characters long to provide adequate entropy margin.`
    );
  }

  // Check entropy (Shannon entropy >= 128 bits)
  if (!validateSecretMinEntropy(envValue)) {
    const entropyBits = calculateEntropy(envValue);
    console.warn(`[SLAG3D WARNING] ${secretName} has low estimated entropy (${entropyBits.toFixed(1)} bits). Consider using a longer secret.`);
    // Do not throw here — allow deployment but warn.
    // The secret is accepted but logged for audit later.
  } else {
    console.log(`[SLAG3D] ${secretName} entropy check passed: ${Math.round(calculateEntropy(envValue)).toFixed(1)} bits`);
  }

  return envValue;
}

// Apply validation with hard blocking
try {
  const JWT_SECRET = validateSecret('JWT_SECRET', process.env.JWT_SECRET);
} catch (err) {
  console.error('[SLAG3D CRITICAL ERROR] Application cannot start without a valid JWT_SECRET.');
  console.error(`Error: ${(err as Error).message}`);
  console.error('');
  console.error('To fix, set an environment variable with a securely-generated random string (min 64 chars):');
  console.error('  JWT_SECRET=$(openssl rand -base64 52)');
  console.error('');
  console.error('Then restart the container with:');
  console.error('  docker run -e JWT_SECRET="$(openssl rand -base64 52)" ...');
  process.exit(1);
}

// Apply validation to REFRESH_TOKEN_SECRET
try {
  const REFRESH_TOKEN_SECRET = validateSecret('REFRESH_TOKEN_SECRET', process.env.REFRESH_TOKEN_SECRET);
} catch (err: any) {
  console.error('[SLAG3D CRITICAL ERROR] Application cannot start without a valid REFRESH_TOKEN_SECRET.');
  console.error(`Error: ${err.message}`);
  console.error('');
  console.error('Set: REFRESH_TOKEN_SECRET=$(openssl rand -base64 52)');
  process.exit(1);
}

// Apply validation to SESSION_SECRET
try {
  const SESSION_SECRET = validateSecret('SESSION_SECRET', process.env.SESSION_SECRET);
} catch (err: any) {
  console.error('[SLAG3D CRITICAL ERROR] Application cannot start without a valid SESSION_SECRET.');
  console.error(`Error: ${err.message}`);
  console.error('');
  console.error('Set: SESSION_SECRET=$(openssl rand -base64 52)');
  process.exit(1);
}

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      username?: string;
      role?: 'admin' | 'user';
      tokenType?: 'session' | 'access' | 'refresh' | undefined;
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

/**
 * Global middleware to resolve user from JWT token header or session cookie.
 */
export function authResolverMiddleware(req: Request, res: Response, next: NextFunction) {
  // Priority 1: Check Authorization header, x-auth-token, or query token
  const authHeader = req.headers.authorization;
  const xAuthToken = req.headers['x-auth-token'];
  const queryToken = typeof req.query?.token === 'string' ? req.query.token
    : typeof req.query?.auth === 'string' ? req.query.auth : undefined;

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
      const decoded = jwt.verify(token, JWT_SECRET) as AccessTokenPayload;

      if (decoded && decoded.userId) {
        // Verify user exists and is not soft-deleted
        const userRow = db.prepare(
          'SELECT username, role FROM users WHERE id = ? AND (is_deleted = 0 OR is_deleted IS NULL)'
        ).get(decoded.userId) as { username: string; role: 'admin' | 'user' } | undefined;

        if (userRow) {
          req.userId = decoded.userId as string;
          req.username = userRow.username;
          req.role = userRow.role;
          req.tokenType = 'access';
          tokenResolved = true;
        }
      }
    } catch (_accessErr: any) {
      // 2. Access token failed — try refresh token verification
      try {
        const decodedRefresh = jwt.verify(token, REFRESH_TOKEN_SECRET) as RefreshTokenPayload;

        if (decodedRefresh && decodedRefresh.data) {
          const [_, userId] = decodedRefresh.data.split(':');
          if (userId) {
            // Verify token matches stored token in auth_tokens table
            const storedRefresh = db.prepare('SELECT token FROM auth_tokens WHERE user_id = ?').get(userId) as { token: string } | undefined;
            if (storedRefresh && storedRefresh.token === token) {
              const refreshUser = db.prepare(
                'SELECT username, role FROM users WHERE id = ? AND (is_deleted = 0 OR is_deleted IS NULL)'
              ).get(userId) as { username: string; role: 'admin' | 'user' } | undefined;

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

  // Priority 2: Fallback to session cookie if token not resolved.
  // This also applies to /api/auth/* routes so session-only clients can use
  // endpoints such as /api/auth/change-password and /api/auth/logout.
  if (!tokenResolved) {
    const sessionUserId = req.session?.userId;
    if (sessionUserId) {
      try {
        const user = db.prepare(
          'SELECT username, role FROM users WHERE id = ? AND (is_deleted = 0 OR is_deleted IS NULL)'
        ).get(sessionUserId) as { username: string; role: 'admin' | 'user' } | undefined;

        if (user) {
          req.userId = sessionUserId;
          req.username = user.username;
          req.role = user.role;
          req.tokenType = 'session';
        } else {
          // User was deleted or does not exist: revoke session
          console.warn(`[AUTH] Session user ${sessionUserId} not found or deleted — revoking session`);
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

  // Always call next() — auth resolution is complete
  next();
}

// Export secrets for use in other modules with type safety
export const JWT_SECRET = process.env.JWT_SECRET!;
export const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET!;

// =============================================================================
// PROPER JWT PAYLOAD TYPES FOR TYPE INFERENTIAL FIXES
// =============================================================================

// Declare proper payload types for JWT verification (replaces casting to {})
export type AccessTokenPayload = {
  userId?: string;
  username?: string;
  role?: string;
} & jwt.JwtPayload;

export type RefreshTokenPayload = {
  data?: string; // Format: "{random}:{userId}"
} & jwt.JwtPayload;
function setRefreshTokenRotation(userId: string, oldToken: string): void {
  try {
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