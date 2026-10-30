// Load environment variables from .env file
import 'dotenv/config';

import express from 'express';
import session from 'express-session';
import rateLimit from 'express-rate-limit';
import connectSqlite3 from 'connect-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { initDatabase, db } from './server/db.ts';

// Import Middleware & Routers
import { authResolverMiddleware } from './server/middleware.ts';
import authRouter from './server/routes/auth.ts';
import adminRouter from './server/routes/admin.ts';
import collectionsRouter from './server/routes/collections.ts';
import modelsRouter from './server/routes/models.ts';

// =============================================================================
// GLOBAL RATE LIMITING MIDDLEWARE
// =============================================================================

// 1. Authentication/Login endpoints (Most likely targets for brute force)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 login attempts per windowMs
  message: 'Too many login attempts from this IP, please try again after 15 minutes.',
  standardHeaders: true,
  legacyHeaders: false,
});

// 2. General API Endpoints (Models, Collections, etc.) - Moderate limiting
const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 200, // Limit to 200 requests per minute per IP
  message: 'Too many requests to this API endpoint from a single IP, please wait a minute.',
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

if (
  process.env.SESSION_SECRET.includes('SECRET') || 
  process.env.SESSION_SECRET.includes('random') || 
  process.env.SESSION_SECRET.includes('<')
) {
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

if (
  jwtSecret.includes('EXAMPLE') || 
  jwtSecret.includes('<generate') || 
  jwtSecret.includes('default')
) {
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

if (
  refreshTokenSecret.includes('EXAMPLE') || 
  refreshTokenSecret.includes('<generate') || 
  refreshTokenSecret.includes('default')
) {
  console.error('[SLAG3D CRITICAL ERROR] REFRESH_TOKEN_SECRET contains example/placeholder text.');
  process.exit(1);
}

console.log('[SLAG3D SECURITY] Security validation passed - JWT_SECRET, REFRESH_TOKEN_SECRET & SESSION_SECRET properly configured');

// Initialize DB schema & seed admin
initDatabase();

const app = express();
const PORT = 3000;

// Set realistic limits to protect memory footprint (use multer on upload routes for large 3D files)
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// Ensure upload directories exist
const uploadDir = path.resolve(__dirname, 'uploads');
const thumbDir = path.resolve(uploadDir, 'thumbnails');
if (!fs.existsSync(thumbDir)) {
  fs.mkdirSync(thumbDir, { recursive: true });
}

// Serve uploaded files statically
app.use('/uploads', express.static(uploadDir));

// Configure SQLite Session Store
const SQLiteStore = connectSqlite3(session);
const sessionDir = fs.existsSync('/data') ? '/data' : path.resolve(__dirname, 'data');
const sessionStore = new SQLiteStore({
  db: 'sessions.db',
  dir: sessionDir,
});

app.set('trust proxy', 1);

app.use(
  session({
    store: sessionStore,
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: parseInt(process.env.SESSION_EXPIRY_MINUTES || '1440', 10) * 60 * 1000,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
    },
  })
);

app.use(authResolverMiddleware);

// =============================================================================
// API ROUTES & RATE LIMITING
// =============================================================================

app.use('/api/auth', authLimiter, authRouter); 
app.use('/api/admin', apiLimiter, adminRouter);
app.use('/api/collections', apiLimiter, collectionsRouter);
app.use('/api/models', apiLimiter, modelsRouter);

// Healthcheck endpoint (Unthrottled public endpoint)
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'SLAG3D Vault Server' });
});

// Tags endpoint with rate limiting applied
app.get('/api/tags', apiLimiter, (req, res) => {
  const tags = db.prepare(`
    SELECT t.id, t.name, COUNT(mt.model_id) as count
    FROM tags t
    JOIN model_tags mt ON t.id = mt.tag_id
    GROUP BY t.id
    HAVING count > 0
    ORDER BY count DESC, t.name ASC
  `).all();
  res.json({ tags });
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
  const distDir = path.resolve(__dirname, 'dist');
  app.use(express.static(distDir));
  app.get('*', (req, res) => {
    res.sendFile(path.resolve(distDir, 'index.html'));
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[SLAG3D] Server running at http://0.0.0.0:${PORT}`);
});