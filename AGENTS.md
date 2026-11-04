# SLAG3D Developer Guide

## Quick Reference

### Commands
```bash
npm run dev         # Dev server (auto-seeds admin)
npm run build && npm start  # Production mode
npm run set-admin -- 'NewPassword'  # Create/reset the admin account in the DB
pkill -9 node       # Kill processes
rm -f data/*.db*    # Reset database
```

### Default Admin (Dev Only)
- **Username**: `admin`
- **Password**: `admin123`
- ⚠️ Change immediately for production

### Admin Credential Recovery
- First-run seeding only happens when the `users` table is empty — an existing
  database keeps its old admin password even if `.env` changes.
- `npm run set-admin -- 'NewPassword'` (or `npm run set-admin` to use
  `ADMIN_USER` / `ADMIN_PASSWORD` from `.env`) creates or resets the admin
  account directly in SQLite. It works while the server is running (WAL).
- `scripts/install-lxc.sh` runs this automatically when the printed credentials
  fail to authenticate.

---

## Database

### Locations
| Environment | Path |
|-------------|------|
| Development | `./data/vault.db` |
| Production | `/data/vault.db` |

### Schema Version: 4

```sql
users, models, files, tags, model_tags, 
favorites, collections, collection_models, auth_tokens
```

### Migrations
- Auto-run on startup if pending migrations exist
- Track versions in `schema_versions` table
- See [MIGRATION_GUIDE.md](./MIGRATION_GUIDE.md) for details

---

## File System Structure

```
slag3D/
├── server/          # Express backend (use tsx, not tsc)
│   ├── routes/      # API endpoints
│   ├── migrations/  # Database schema changes
│   ├── paths.ts     # Single source of truth for storage paths
│   └── middleware.ts# Auth helpers
├── src/             # React frontend only
├── lib/             # Thumbnail engine (Puppeteer + Three.js)
├── uploads/         # Static files (/uploads route)
│   ├── models/     # Uploaded 3D files per model ID
│   ├── thumbnails/ # Generated previews
│   └── tmp/        # Multer temp uploads
└── vite.config.ts   # Vite SPA middleware
```

### Storage Paths
- **Never** resolve upload paths with `process.cwd()` or `__dirname` directly —
  in production the bundle lives in `dist/`, which made the server write to
  `<cwd>/uploads` but serve from `<bundle>/uploads` (the SPA fallback then
  answered with `index.html`, breaking the 3D viewer with
  `Invalid typed array length`).
- Use `server/paths.ts`: `UPLOADS_DIR`, `THUMBNAILS_DIR`, `MODELS_DIR`,
  `TMP_UPLOADS_DIR`, `resolveUploadsPath()`, `ensureUploadsDirs()`.
- `UPLOADS_DIR` env var overrides the default (`<project root>/uploads`);
  Docker uses `/uploads`, the LXC installer `/opt/slag3D/uploads`.
- `npm run test:prod-paths` boots the bundled production server and verifies
  that uploads and thumbnails are written to and served from the same place.

---

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `JWT_SECRET` | (required) | JWT signing — **min 32 chars** |
| `REFRESH_TOKEN_SECRET` | (required) | Refresh token signing — **min 32 chars** |
| `SESSION_SECRET` | (required) | Session cookie signing — **min 32 chars** |
| `DB_PATH` | auto | SQLite database path (overrides `/data` / `./data`) |
| `UPLOADS_DIR` | `<project root>/uploads` | Uploaded models + rendered thumbnails |
| `GOOSE_SEED_DB` | false | Seed first admin (dev / initial deploy) |
| `ADMIN_USER` | `admin` | Username created by first-run seeding |
| `ADMIN_PASSWORD` | `admin123` | Password created by first-run seeding; setting it also enables seeding |
| `SESSION_EXPIRY_MINUTES` | 1440 | Cookie max age (24 hours default) |

---

## Thumbnail Engine

### Flow
1. Upload → `/uploads/tmp/` (Multer)
2. Extract → `/uploads/models/<id>/` (upload.ts)
3. Queue job → `lib/queue.ts` (p-queue, concurrency=2)
4. Render → Puppeteer + Three.js → 512×512 PNG

### Puppeteer Flags
```bash
--no-sandbox --disable-setuid-sandbox --use-gl=angle \
--single-process --disable-dev-shm-usage
```

---

## Authentication Flow

**Layer 1**: Session cookies (`connect.sid`) — SQLite-backed  
**Layer 2**: JWT Bearer tokens (access: 1h, refresh: 7d)  

### Endpoints
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/login` | Returns access + refresh tokens |
| POST | `/api/auth/refresh` | Rotates token pair |
| POST | `/api/auth/logout` | Invalidates all sessions |

See [SECURITY_GUIDE.md](./SECURITY_GUIDE.md) for security implementation details.

---

## API Endpoints Quick Reference

**Models**: `GET /api/models?page=?&search=...&tag=...`  
**Upload**: `POST /api/models` — Accepts .stl, .3mf, .obj, .zip, .7z (max 300MB)  
**Collections**: Nested folder system with model assignments  
**Tags**: Cloud tagging system

---

## Deployment

### Proxmox LXC (Recommended)
```bash
curl -fsSL https://raw.githubusercontent.com/slag3d/slag3d/main/scripts/install-lxc.sh | bash
systemctl status slag3d.service
```

### Docker Compose
```bash
docker compose up -d  # Volumes: slag3d_data, slag3d_uploads
```

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Port 3000 in use | `pkill -9 node` |
| Admin login fails | Reset: `rm data/*.db* && npm run dev` |
| Thumbnail rendering slow/hanging | Check queue: `node lib/queue.js` or restart server |
| Large WAL journal | Restart triggers auto-checkpoint, or use API checkpoint endpoint |

---

## Notes for Working with OpenCode

- **Routes**: Edit `server/routes/*.ts` → restart server (no build needed)
- **Frontend**: Auto-HMR enabled (disable via `DISABLE_HMR=true`)
- **Typescript**: Use `@/*` path aliases pointing to `src/`
- **Three.js bundling**: Check `lib/three-bundle.js` if extending rendering

---
**Last Updated**: Nov 2026 — Version 4 (soft delete active)
