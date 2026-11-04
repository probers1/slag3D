// Load environment variables from .env file
import 'dotenv/config';

import express from 'express';
import session from 'express-session';
import rateLimit from 'express-rate-limit';
import SqliteStoreInit from 'express-session-better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

// Import database and types after other code (to avoid circular deps)
import { initDatabase, db } from './server/db.ts';
import { UPLOADS_DIR, ensureUploadsDirs, migrateLegacyUploads } from './server/paths.ts';

// Import Middleware & Routers
import { authResolverMiddleware, csrfProtection } from './server/middleware.ts';
import authRouter from './server/routes/auth.ts';
import adminRouter from './server/routes/admin.ts';
import collectionsRouter from './server/routes/collections.ts';
import modelsRouter from './server/routes/models.ts';
import { getTagsWithCounts } from './server/lib/tags.ts';

// =============================================================================
// GLOBAL RATE LIMITING MIDDLEWARE
// =============================================================================

// 1. Authentication/Login endpoints (Most likely targets for brute force)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 login attempts per windowMs
  message: { error: 'Too many login attempts from this IP, please try again after 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// 2. General API Endpoints (Models, Collections, etc.) - Moderate limiting
const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 200, // Limit to 200 requests per minute per IP
  message: { error: 'Too many requests to this API endpoint from a single IP, please wait a minute.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// =============================================================================
// CRITICAL SECURITY FIXES
// =============================================================================

// SESSION_SECRET Validation
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  console.error(
    '[SLAG3D CRITICAL ERROR] SESSION_SECRET must be configured.\n' +
    'Generate a secure random string (min 32 chars): openssl rand -base64 48\n' +
    'Then set SESSION_SECRET value in your .env file before starting the server.'
  );
  process.exit(1);
}

const isPlaceholder = (s: string) =>
  s.includes('<') || s.includes('>') || /example|placeholder/i.test(s) || s === 'slag3d-vault-super-secure-key-2026';

if (isPlaceholder(process.env.SESSION_SECRET)) {
  console.error('[SLAG3D SECURITY ERROR] SESSION_SECRET contains placeholder text.');
  process.exit(1);
}

// JWT_SECRET Validation
const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || jwtSecret.length < 32) {
  console.error('[SLAG3D CRITICAL SECURITY ERROR] JWT_SECRET is missing or too short.', {
    requiredMinLength: 32,
    providedLength: jwtSecret ? jwtSecret.length : 'NOT SET'
  });
  process.exit(1);
}

if (isPlaceholder(jwtSecret)) {
  console.error('[SLAG3D CRITICAL ERROR] JWT_SECRET contains example/placeholder text.');
  process.exit(1);
}

// REFRESH_TOKEN_SECRET Validation
const refreshTokenSecret = process.env.REFRESH_TOKEN_SECRET;
if (!refreshTokenSecret || refreshTokenSecret.length < 32) {
  console.error('[SLAG3D CRITICAL SECURITY ERROR] REFRESH_TOKEN_SECRET is missing or too short.', {
    requiredMinLength: 32,
    providedLength: refreshTokenSecret ? refreshTokenSecret.length : 'NOT SET'
  });
  process.exit(1);
}

if (isPlaceholder(refreshTokenSecret)) {
  console.error('[SLAG3D CRITICAL ERROR] REFRESH_TOKEN_SECRET contains example/placeholder text.');
  process.exit(1);
}

console.log('[SLAG3D SECURITY] Security validation passed - JWT_SECRET, REFRESH_TOKEN_SECRET & SESSION_SECRET properly configured');

// Initialize DB schema & run pending migrations before accepting connections
try {
  await initDatabase();
} catch (err) {
  console.error('[SLAG3D] Database initialization failed:', err);
  process.exit(1);
}

const app = express();
const PORT = Number.parseInt(process.env.PORT || '3000', 10);

// Set realistic limits to protect memory footprint (use multer on upload routes for large 3D files)
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// Ensure upload directories exist (uploads/models, uploads/thumbnails, uploads/tmp)
ensureUploadsDirs();
// Pick up files written to the legacy location before switching UPLOADS_DIR
migrateLegacyUploads();

app.set('trust proxy', 1);

// Persistent SQLite-backed session store.
// This reuses the existing better-sqlite3 connection and implements the full
// express-session Store contract (get(sid), set(sid, sess, cb), destroy(sid, cb)).
const SqliteSessionStore = SqliteStoreInit(session, db);
const sessionStore = new SqliteSessionStore();

app.use(
  session({
    store: sessionStore,
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: parseInt(process.env.SESSION_EXPIRY_MINUTES || '1440', 10) * 60 * 1000,
      httpOnly: true,
      // 'auto' sets the Secure flag only for HTTPS requests. Hard-coding this
      // to NODE_ENV breaks session auth when production runs over plain HTTP
      // (for example on a local network or a TLS-terminating proxy).
      secure: 'auto',
      sameSite: 'strict',
      path: '/',
    },
  })
);

app.use(authResolverMiddleware);
app.use(csrfProtection);

// Content types for the 3D payloads we store. `send` resolves `.stl` to the
// unrelated `application/vnd.ms-pki.stl`, so the type is set explicitly to
// match the mime_type recorded in the database.
const MODEL_CONTENT_TYPES: Record<string, string> = {
  '.stl': 'model/stl',
  '.3mf': 'model/3mf',
  '.obj': 'model/obj',
};

// Serve uploaded files statically
// - /uploads/thumbnails are rendered previews accessible for img tags
// - /uploads/models (user 3D assets) require authentication via session, Bearer token, or ?token= query param
//
// Hardening: the uploads directory is served from the application's own
// origin. `nosniff` stops the browser from guessing a content type, and model
// payloads are always delivered as downloads (`Content-Disposition:
// attachment`) so a stray .html/.svg can never be rendered inline - which
// would be a stored XSS vector.
app.use('/uploads', (req, res, next) => {
  if (req.userId || req.path.startsWith('/thumbnails/')) {
    return next();
  }
  return res.status(401).json({ error: 'Authentication required' });
}, express.static(UPLOADS_DIR, {
  setHeaders(res, filePath) {
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // Thumbnails stay inline so <img> tags keep working; model files are
    // downloads only (Three.js loads them via XHR, which is unaffected).
    if (filePath.includes(`${path.sep}models${path.sep}`)) {
      res.setHeader('Content-Disposition', 'attachment');

      const ext = path.extname(filePath).toLowerCase();
      const contentType = MODEL_CONTENT_TYPES[ext];
      if (contentType) {
        // `send` only sets a content type when none is present yet, so this
        // explicit value wins.
        res.setHeader('Content-Type', contentType);
      }
    }
  },
}));

// A missing upload must never fall through to the SPA fallback: the client
// would receive index.html instead of the binary model file and fail with
// confusing parser errors (e.g. "Invalid typed array length" for STL).
app.use('/uploads', (req, res) => {
  res.status(404).json({ error: 'File not found' });
});

// =============================================================================
// API ROUTES & RATE LIMITING
// =============================================================================

app.use('/api/auth', authRouter); 
app.use('/api/admin', apiLimiter, adminRouter);
app.use('/api/collections', apiLimiter, collectionsRouter);
app.use('/api/models', apiLimiter, modelsRouter);

// Healthcheck endpoint (Unthrottled public endpoint)
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'SLAG3D Vault Server' });
});

// Tags endpoint with rate limiting applied
app.get('/api/tags', apiLimiter, (req, res) => {
  const tags = getTagsWithCounts();
  res.json({ tags });
});

// Unmatched API routes must return JSON, not the SPA's index.html.
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'API endpoint not found' });
});

// =============================================================================
// VITE / STATIC SERVING
// =============================================================================

const isProduction = process.env.NODE_ENV === 'production';
if (!isProduction) {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    server: { middlewareMode: true, hmr: process.env.DISABLE_HMR !== 'true' },
    appType: 'spa',
  });
  app.use(vite.middlewares);
} else {
  // If running from bundled dist/server.js, __dirname is already /opt/slag3D/dist
  const distDir = __dirname.endsWith('dist')
    ? __dirname
    : path.resolve(__dirname, 'dist');

  app.use(express.static(distDir));
  app.get('*', (req, res) => {
    res.sendFile(path.resolve(distDir, 'index.html'));
  });
}

// Global Express error handler - ensures JSON error responses instead of HTML stack traces
app.use((err: any, req: any, res: any, next: any) => {
  console.error('[SLAG3D] Unhandled error:', err?.message || err);
  if (res.headersSent) {
    return next(err);
  }

  // Multer validation errors (bad file type, oversized upload, too many files)
  // are client errors, not server errors.
  let status = err?.status || err?.statusCode || 500;
  if (err?.name === 'MulterError') {
    status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
  }

  res.status(status).json({ error: err?.message || 'Internal server error' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[SLAG3D] Server running at http://0.0.0.0:${PORT}`);
});