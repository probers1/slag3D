import express from 'express';
import session from 'express-session';
import connectSqlite3 from 'connect-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { initDatabase, db } from './server/db.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize DB schema & seed admin
initDatabase();

const app = express();
const PORT = 3000;

// Parse JSON and urlencoded payloads
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
    secret: process.env.SESSION_SECRET || 'slag3d-vault-super-secure-key-2026',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: parseInt(process.env.SESSION_EXPIRY_MINUTES || '3360', 10) * 60 * 1000, // 7 days (defaults to 3360 minutes = 7 days), configurable via SESSION_EXPIRY_MINUTES env var
      httpOnly: true,
      secure: 'auto',
      sameSite: 'lax',
    },
  })
);

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
