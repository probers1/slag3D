# SLAG3D 🖨️ — Multi-User 3D Model Repository

A self-hosted mesh repository and dashboard for 3D printer models, print farms, and workshop teams.

---

## Features

| Feature | Description |
|---------|-------------|
| **Headless Thumbnail Engine** | Puppeteer + Three.js → 512×512 PNGs (concurrency: 2, exponential retry) |
| **3D Model Viewer** | Embedded Three.js viewer (.stl, .3mf, .obj with OrbitControls, wireframe toggle) |
| **Mesh Analytics** | Bounding box, volume ($cm^3$), weight estimate, filament cost calculator |
| **Archive Extraction** | Multi-file uploads (.zip, .7z → auto-extract, detect primary 3D file) |
| **Collections & Folders** | Nested folder hierarchy with model organization |
| **Dual Authentication** | Session cookies + JWT Bearer tokens (iframe-safe) |
| **Admin Panel** | User management, provisioning, password resets |

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Runtime | Node.js 20 / Express 4 |
| Database | SQLite (`better-sqlite3`, WAL mode) |
| Frontend | React 19, TypeScript, Tailwind CSS |
| 3D Engine | Three.js with STLLoader, OBJLoader |

---

## Quick Start

### Development
```bash
npm install && npm run dev
# Auto-seeds: admin / admin123 (change after first login)
```

### Production
```bash
cp .env.example .env  # Set JWT_SECRET, GOOSE_SEED_DB=false
npm run build && npm start
```

---

## Environment Variables

```bash
JWT_SECRET=<min 32 chars>         # Required for production
GOOSE_SEED_DB=true               # Auto-creates admin (dev only)
SESSION_EXPIRY_MINUTES=3360       # Default: 7 days
```

Generate secret: `openssl rand -base64 64`

---

## File Uploads

**Allowed**: `.stl`, `.3mf`, `.obj`, `.zip`, `.7z` (max 300MB)  
**Rate Limit**: 30 requests/hour per IP  

Security checks block executables, scripts, image files.

---

## Database Schema

```sql
users, models, files, tags, model_tags, 
favorites, collections, collection_models, auth_tokens
```

Schema version **4** — see [MIGRATION_GUIDE.md](./MIGRATION_GUIDE.md)

---

## API Quick Reference

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/models` | ✓ | Paginated search (search, tags, filters) |
| POST | `/api/models` | ✓ | Multi-file upload or archive extraction |
| POST | `/api/auth/login` | — | Returns access + refresh tokens |
| POST | `/api/auth/refresh` | ✓ | Token rotation endpoint |

See full API reference in docs folder.

---

## Deployment

### Proxmox LXC (Recommended)
```bash
curl -fsSL https://raw.githubusercontent.com/slag3d/slag3d/main/scripts/install-lxc.sh | bash
systemctl status slag3d.service
```

### Docker Compose
```bash
docker compose up -d
# Volumes: slag3d_data (DB), slag3d_uploads (files)
```

---

## Default Admin Credentials

| Username | Password | Role | Notes |
|----------|----------|------|-------|
| `admin` | `admin123` | Administrator | **Dev mode only** — change after first login |

Change default password via: Settings → Change Password (top navigation)

---

## Security Guidelines

- Always set `JWT_SECRET` in production (min 32 characters)
- Never commit `.env` files to Git
- Rotate secrets every 90 days
- Use HTTPS/HSTS for public access
- See [SECURITY_GUIDE.md](./SECURITY_GUIDE.md) for full implementation

---

## Support

- Issues: Open GitHub issues for bugs/features
- Documentation: See related guides below

---
**Version**: 4 (Soft delete active)  
**Last Updated**: Nov 2026
