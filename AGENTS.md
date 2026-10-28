# SLAG3D Agent Guide

## Commands & Entry Points

**Start dev server:** `npm run dev` (sets `GOOSE_SEED_DB=true`)  
**Start production:** `npm run build && npm start`  
**Type-check:** `npm run lint`  
**Clean build artifacts:** `npm run clean`

**Database paths:**
- Production: `/data/vault.db`
- Development: `./data/vault.db`
- Sessions: same directory as DB

## Architecture Overview

```
slag3D/
├── server/           # Express backend + API routes
│   ├── db.ts         # Database connection & migration orchestration (entry)
│   ├── migrations/   # Versioned migration files
│   └── routes/       # API route modules
├── src/              # React frontend components
│   ├── components/   # Reusable UI components (ModelViewerModal, etc.)
│   └── utils/        # Client-side utilities
├── lib/              # Headless thumbnail engine (puppeteer + Three.js)
│   ├── thumbnail.js  # 512x512 render generation
│   └── queue.js      # Background task queue
├── uploads/          # Uploaded files & thumbnails
└── server.ts         # Main Express app entrypoint
```

## Migration Status: ✅ COMPLETED

**Database migrations are now working correctly!**

- **Version tracking:** `schema_versions` table tracks applied versions with `CHECK(id = 1)` constraint
- **Auto-migrate on startup:** Runs when `GOOSE_SEED_DB=true` (dev) or production seeding mode
- **Admin seed:** Created automatically as `admin/admin123` when first run in dev/seed mode
- **Upgrade path:** v1 → v2 adds metadata columns to models, files, and collections tables

**Migrations applied:** v1 (base tables) + v2 (metadata enhancements - already included in v1 schema)

## How it works

### Database Migrations
- **Files:** `server/migrations/{001,002}*.ts` export `{ version: number; timestamp: string }` from migration functions
- **Auto-run:** Migrate on server startup if `GOOSE_SEED_DB` or dev mode
- **Version tracking:** `schema_versions` table with `CHECK(id = 1)` constraint
- **First-time setup:** `server/db.ts` ensures `schema_versions` exists before querying version
- **Seed admin:** Admin account created when `GOOSE_SEED_DB=true` (default in `npm run dev`)

### Environment Variables
- `SESSION_SECRET`: Session cookie secret (default: `'slag3d-vault-super-secure-key-2026'`)
- `SESSION_EXPIRY_MINUTES`: Cookie max age in minutes (default: 3360 = 7 days)
- `GEMINI_API_KEY`: For Gemini AI API calls (configured via UI secrets panel)
- `APP_URL`: App's host URL for self-referential links
- `GOOSE_SEED_DB=true`: Set this environment variable to auto-create admin account on first run

### Session Store
SQLite session store at `/data/sessions.db` or `./data/sessions.db`. Uses better-sqlite3 with WAL mode.

## Common Pitfalls

**Never modify in-flight migrations.** Each migration file exports an upgrade function that's versioned and tracked. If a migration fails, check logs for the specific error—the system has fallback logic but won't corrupt data if you handle exceptions properly.

**Don't forget the thumbnail queue.** Uploaded 3D models spawn background jobs in `lib/queue.js` to generate thumbnails. Check queue status via API or `node lib/queue.js` to monitor.

**Watch upload directories.** `/uploads/thumbnails` is auto-created, but ensure `/uploads` exists when handling file uploads. Server.ts ensures it, but cleanup scripts may remove it.

**Use `tsx` for server files.** Entry points like `server/db.ts` and route modules use ESM imports with tsx as the TypeScript runtime. Don't build these—run them directly.

## File Ownership & Boundaries

- `server/`: Backend logic only. Database connections, migrations, routes.
- `src/`: React frontend components consumed by Vite dev server.
- `lib/`: Headless thumbnail generation pipeline (external to Express).
- `uploads/`: Static file storage served at `/uploads`.

## Troubleshooting Admin Login

**Login fails with "invalid credentials"?** The admin account only exists on first DB initialization. To reset:
```bash
rm -f /home/probers1/Dev/slag3D/data/vault.db*    # Clear old database
pkill -9 node                                           # Kill all Node processes  
npm run dev                                             # Fresh start (auto-seeds admin/admin123)
```

**Port 3000 in use:** Stop the server first with `pkill -9 node`, then restart.

## File Upload Error Messages

**Supported file formats:** `.stl`, `.3mf`, `.obj` (3D model files), `.zip`, `.7z` (archives)

**When uploading unsupported file types, you'll see messages like:**
- `.bin`, `.sh` → "Binary executable - not a 3D model"
- `.jpg`, `.png` → "Image files are not allowed for 3D models"  
- `.exe`, `.bat`, `.ps1` → "not a 3D model / potential security risk"
- Scripts (`.html`, `.js`) → "potential security risk"
- Unknown extensions → "not supported for SLAG3D uploads"

**ZIP archives:** Archives containing script/executable filenames are blocked for security (e.g., `script.zip`, `malware.bat.zip`).
