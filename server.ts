// Load environment variables from .env file
import 'dotenv/config';

import express from 'express';
import session from 'express-session';
import connectSqlite3 from 'connect-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { initDatabase, db } from './server/db.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// =============================================================================
// CRITICAL SECURITY FIXES
// =============================================================================

// 1.2 SESSION_SECRET: Must be set - no default fallback
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  const errMsg = '[SLAG3D CRITICAL ERROR] SESSION_SECRET must be configured.\n' +
    'Generate a secure random string (min 32 chars): openssl rand -base64 48\n' +
    'Then set SESSION_SECRET value in your .env file before starting the server.\n' +
    'Production deployments will fail without this security setting.';
  console.error(errMsg);
  process.exit(1);
}

// Validate SESSION_SECRET strength
if (process.env.SESSION_SECRET.includes('SECRET') || 
    process.env.SESSION_SECRET.includes('random') || 
    process.env.SESSION_SECRET.includes('<')) {
  console.error('[SLAG3D SECURITY ERROR] SESSION_SECRET contains placeholder text. Generate a new strong secret.');
  console.error('Example: openssl rand -base64 48 and output to .env');
  process.exit(1);
}

// 1.1 JWT_SECRET: Enhanced validation with pre-flight check
const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || jwtSecret.length < 32) {
  console.error('[SLAG3D CRITICAL SECURITY ERROR] JWT_SECRET is missing or too short.\n' +
    'This creates a severe security vulnerability - all authentication is compromised.\n' +
    '\nTo generate a secure secret: openssl rand -base64 48\n' +
    'Or use a password manager to generate a random string of 32+ characters.\n' +
    '\nExample strong secret: 7Kj9#mPqR2$xYvN8@wLdF5nTcZ1bQeG4hUaS');
  console.error('Please set JWT_SECRET in your .env file and restart.\n', {
    requiredMinLength: 32,
    providedLength: jwtSecret ? jwtSecret.length : 'NOT SET'
  });
  process.exit(1);
}

// Additional placeholder detection (if someone copy-pasted example)
if (jwtSecret.includes('EXAMPLE') || 
    jwtSecret.includes('<generate') || 
    jwtSecret.includes('default')) {
  console.error('[SLAG3D CRITICAL ERROR] JWT_SECRET contains example/placeholder text.\n' +
    'This indicates improper environment setup. All user data may be accessible by attackers.');
  process.exit(1);
}

console.log('[SLAG3D SECURITY] Security validation passed - JWT_SECRET & SESSION_SECRET properly configured');

// Initialize DB schema & seed admin
initDatabase();

const app = express();
const PORT = 3000;

// Parse JSON and urlencoded payloads with rate limiting
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// Ensure upload directories exist
const uploadDir = path.resolve(__dirname, 'uploads');
const thumbDir = path.resolve(uploadDir, 'thumbnails');
if (!fs.existsSync(thumbDir)) {
  fs.mkdirSync(thumbDir, { recursive: true });
}

// Serve uploaded files and thumbnails statically
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
      maxAge: parseInt(process.env.SESSION_EXPIRY_MINUTES || '1440', 10) * 60 * 1000, // 24 hours default (more secure than 7 days)
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production', // Only in production for https
      sameSite: 'strict', // CSRF protection: reject requests without valid cookie
      path: '/',
    },
  })
);

console.log(`[SLAG3D session] Cookie config: maxAge=${(parseInt(process.env.SESSION_EXPIRY_MINUTES || '1440', 10) * 60 / 3600)}h, sameSite=strict, secure=${process.env.NODE_ENV === 'production'}`);

// Import auth resolver to extract token from headers if cookies are blocked in iframes
import { authResolverMiddleware } from './server/middleware.ts';
app.use(authResolverMiddleware);

// Healthcheck endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'SLAG3D Vault Server' });
});

// Import and mount core API routes
import authRouter from './server/routes/auth.ts';
import adminRouter from './server/routes/admin.ts';
import collectionsRouter from './server/routes/collections.ts';
import modelsRouter from './server/routes/models.ts';

app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api/collections', collectionsRouter);
app.use('/api/models', modelsRouter);

// GET /api/tags shortcut
app.get('/api/tags', (req, res) => {
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

// Vite Middleware integration for dev / static for prod
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
