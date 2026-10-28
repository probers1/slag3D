# SLAG3D Agent Guide

## Commands & Entry Points

### Starting the Server
- **Dev (recommended)**: `npm run dev` — Auto-seeds DB with admin, sets `GOOSE_SEED_DB=true`
- **Production**: `npm run build && npm start` — Builds frontend + runs Express
- **Clean slate**: `rm -f data/vault.db* pkill -9 node; npm run dev`

### Testing & Quality
- **Type-check only**: `npm run lint` (alias for `tsc --noEmit`)
- **Full verification**: `npm run dev` (includes type checking during dev)

> No test scripts exist. All validation is runtime + type-based.

### Database Locations
- Production: `/data/vault.db` (SQLite with WAL mode)
- Development: `./data/vault.db`
- Sessions: Same directory as DB (`/data/sessions.db` or `./data/sessions.db`)

### Cleanup
```bash
npm run clean           # Removes dist/ and server.js
pkill -9 node          # Hard restart if needed
rm -f data/vault.db*   # Reset database (causes migration re-run)
```

---

## Architecture Boundaries

```
slag3D/
├── server/              # Express backend (DO NOT BUILD – use tsx)
│   ├── db.ts            # DB connection + migrations entrypoint
│   ├── migrations/      # Versioned schema upgrades (001*, 002*)
│   ├── routes/          # API route modules (auth, admin, models, collections)
│   └── middleware.ts    # Auth resolvers, requireAuth, requireAdmin
├── src/                 # React frontend components only
│   └── components/      # ModelViewerModal, UploadModal, etc.
├── lib/                 # Headless thumbnail engine (external to Express)
│   ├── thumbnail.ts     # Puppeteer + Three.js render logic
│   └── queue.ts         # p-queue background job scheduler
├── uploads/             # Static file storage (served at /uploads)
│   ├── models/         # User-uploaded 3D files per model ID
│   ├── thumbnails/     # Generated 512×512 PNG previews
│   └── tmp/            # Multer temporary uploads (cleaned post-process)
├── server.ts            # Main Express app entrypoint
└── vite.config.ts       # Vite SPA middleware for dev builds
```

---

## Database Migration System

### Purpose
Tracks schema evolution in `schema_versions` table to enable safe upgrades across environments.

### Files
- `server/migrations/001_initial_schema.ts` — Base tables (users, models, files, etc.)
- `server/migrations/002_add_metadata_columns.ts` — Width/height columns (may be redundant)
- `server/migrations/index.ts` — Migration runner

### Auto-run Behavior
Migrations execute automatically on server startup if:
- `GOOSE_SEED_DB=true` (dev mode), or
- `NODE_ENV=production` with seeding flag

### File Contract
Each migration must export: `{ version: number; timestamp: string }`

```typescript
export function v3_feature(db): { version, timestamp } {
  // Apply schema changes here
  return { version: 3, timestamp: new Date().toISOString() }
}
```

### Pitfalls
- **NEVER** edit migration files after they've been applied — version constraints are enforced.
- If a migration fails, check logs for specific errors; system has fallback logic but avoid manual SQL.
- First-time setup: `server/db.ts` ensures `schema_versions` exists before querying.

---

## Environment Variables

| Variable | Use Case | Default | Notes |
|----------|----------|---------|-------|
| `SESSION_SECRET` | Session cookie signing | `'slag3d-vault-super-secure-key-2026'` | Override for production |
| `SESSION_EXPIRY_MINUTES` | Cookie max age | `3360` (7 days) | Recommended: ≤1440 |
| `GEMINI_API_KEY` | Gemini AI calls | (none) | Configured via UI secrets panel |
| `APP_URL` | Self-referential links | (none) | Set for OAuth/callbacks |
| `GOOSE_SEED_DB=true` | Auto-create admin seed | — | Only in dev/seed mode |
| `JWT_SECRET` | JWT token signing | `'default_secret'` | **SECURITY: Set in production** |

> **Important**: `SESSION_SECRET` is also mounted as Docker secret `session_env` in docker-compose.yml. Ensure file exists before container starts.

---

## Thumbnail Engine

### Flow
1. User uploads `.stl/.3mf/.obj/.zip` → Multer stores to `/uploads/tmp/`
2. `lib/upload.ts`: Validate + extract → Save to `/uploads/models/<model-id>/`
3. `lib/queue.ts`: Queue render job with backoff retries
4. `lib/thumbnail.ts`: Puppeteer launches headless Chromium
5. Generates 512×512 PNG → Saves to `/uploads/thumbnails/<model-id>.png`

### Job Limits
- Concurrency: 2 parallel renders (`renderQueue`)
- Retry delays: 1s, 3s, 9s (max 3 retries)
- Timeout: Currently unlimited — **agent should verify if rendering hangs**

### Puppeteer Launch Flags
```bash
--no-sandbox --disable-setuid-sandbox --use-gl=angle --enable-webgl
--single-process                 # Limitation: no GPU acceleration
--disable-dev-shm-usage          # Docker compatibility
```

---

## Authentication Flow

### Layer 1: Session Cookies (express-session)
- Stored in SQLite at `/data/sessions.db`
- Destroyed on logout via `req.session.destroy()` + `res.clearCookie('connect.sid')`

### Layer 2: JWT Bearer Token
- Returned on login (`POST /api/auth/login`)
- 24h lifetime (no refresh token currently)
- Used as fallback when cookies are blocked (iframes)

### Middleware
```typescript
import { authResolverMiddleware } from './server/middleware.ts'
app.use(authResolverMiddleware) // Extracts token from headers, sets req.userId

// Protected routes
router.post('/:id/favorite', requireAuth, ...)
router.put('/:id', requireAuth, ...) // Checks user ownership
```

---

## File Upload Security

### Allowed Extensions
- **3D models**: `.stl`, `.3mf`, `.obj`
- **Archives**: `.zip`, `.7z` (with security scanning)

### Blocked Files
- Image files: `.jpg`, `.png`, `.gif`, `.bmp`, `.webp`
- Executables/Scripts: `.exe`, `.bat`, `.cmd`, `.ps1`, `.sh`
- Suspicious archives: Names containing `script`, `executable`, malware indicators

### Multer Storage
- Dest: `/uploads/tmp/` (temporary)
- Final: `/uploads/models/<model-id>/`
- Size limit: 300MB

> **Tip**: Check `server/upload.ts:12–30` for validation logic. Archives are extracted in-memory; ensure sufficient RAM.

---

## Troubleshooting

### Admin Login Fails
**Symptom**: "invalid credentials" after fresh install  
**Fix**: Reset database and re-seed admin account
```bash
rm -f /home/probers1/Dev/slag3D/data/vault.db*
pkill -9 node
npm run dev  # Auto-creates admin/admin123
```

### Port 3000 in Use
**Symptom**: `ERR_EADDRINUSE` on startup  
**Fix**: Kill existing Node processes
```bash
pkill -9 node
# Restart
npm run dev
```

### Thumbnail Rendering Hangs
**Symptom**: App logs show render stuck; health check passes  
**Diagnosis**: Puppeteer process exceeded 15000ms render timeout  
**Agent Action**: 
- Check queue: `node lib/queue.js` (or API `/api/models?page=...`)
- Manual cleanup if job >10min: `rm /uploads/thumbnails/<model-id>.png; UPDATE models SET thumbnail_status='pending' WHERE id='<model-id>'`
- Restart queue process

### Large Database
**Symptom**: Slow startup or queries  
**Check**: WAL journal growth  
**Fix**: Run SQLite checkpoint via API or restart server (WAL auto-checkpoints)

---

## Deployment Patterns

### Docker Compose
```yaml
docker compose up -d
# Volumes persist: slag3d_data:/data, slag3d_uploads:/uploads
# Secrets: secrets/session_secret.txt → SESSION_SECRET env var
```

### Proxmox LXC (Recommended)
```bash
curl -fsSL https://raw.githubusercontent.com/slag3d/slag3d/main/scripts/install-lxc.sh | bash
systemctl status slag3d.service  # Manage via systemd
```

---

## API Endpoints Quick Reference

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/models` | ✅ | Paginated search with filters |
| POST | `/api/models` | ✅ | Upload 3D files (.stl/.obj/.zip) |
| GET | `/api/models/:id` | ✅ | Full model + files + tags |
| PUT | `/api/models/:id` | ✅ | Update metadata |
| DELETE | `/api/models/:id` | ✅ | Purge files + DB record |
| POST | `/api/models/:id/favorite` | ✅ | Toggle favorite |
| GET | `/api/collections` | ✅ | User-folders with model counts |
| POST | `/api/collections/:id/models` | ✅ | Add model to folder |

---

## TypeScript Usage
- ESM module format (`import ... from '...'`)
- Uses `tsx` runtime for `.ts` files — **do NOT run `tsc` without `--noEmit`**
- Paths: `@/*` → `src/`
- JSX: Babel-react via Vite plugin

---

## OpenCode Session Notes

### When editing routes
1. Update `server/routes/*.ts` (no build step)
2. Restart server: `npm run dev`
3. Frontend changes in `src/` auto-HMR unless `DISABLE_HMR=true`

### When adding models/folders
1. Add to `src/components/ModelCard.tsx` or parent drawer component
2. Import from `../types.ts` for consistent interfaces
3. Keep Three.js bundling in `lib/three-bundle.js` if extending rendering

### When debugging thumbnails
```bash
node lib/queue.js          # Run background queue directly
# Or check logs in real-time: tail -f server/data/vault.db-journal
```

---

**Last updated**: Wed Oct 28 2026  
**Repo**: `/home/probers1/Dev/slag3D`
