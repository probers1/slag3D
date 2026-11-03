# SLAG3D Developer Guide

## Quick Reference

### Commands
```bash
npm run dev         # Dev server (auto-seeds admin)
npm run build && npm start  # Production mode
pkill -9 node       # Kill processes
rm -f data/*.db*    # Reset database
```

### Default Admin (Dev Only)
- **Username**: `admin`
- **Password**: `admin123`
- ⚠️ Change immediately for production

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
│   └── middleware.ts# Auth helpers
├── src/             # React frontend only
├── lib/             # Thumbnail engine (Puppeteer + Three.js)
├── uploads/         # Static files (/uploads route)
│   ├── models/     # Uploaded 3D files per model ID
│   ├── thumbnails/ # Generated previews
│   └── tmp/        # Multer temp uploads
└── vite.config.ts   # Vite SPA middleware
```

---

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `JWT_SECRET` | (required) | JWT signing — **min 32 chars** |
| `SESSION_SECRET` | auto-gen | Session cookie signing |
| `GOOSE_SEED_DB` | false | Auto-seed admin account (dev only) |
| `SESSION_EXPIRY_MINUTES` | 3360 | Cookie max age (7 days default) |

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
