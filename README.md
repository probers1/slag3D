# SLAG3D 🖨️ — Multi-User 3D Model Repository

A self-hosted mesh repository and dashboard for 3D printer models, print farms, and workshop teams.

---

## Features

| Feature | Description |
|---------|-------------|
| **Headless Thumbnail Engine** | Puppeteer + Three.js → 512×512 PNGs (concurrency: 2, exponential retry) |
| **3D Model Viewer** | Embedded Three.js viewer (.stl, .3mf, .obj with OrbitControls, wireframe toggle) |
| **Mesh Analytics** | Bounding box, volume ($cm^3$), weight estimate, filament cost calculator |
| **Archive Extraction** | Multi-file uploads (.zip, .7z → auto-extract, detect primary 3D file; PDFs kept alongside models) |
| **PDF Documents** | Standalone PDF items and model attachments with an in-app pdf.js reader (page navigation, zoom, rotate, text search for text-based PDFs) and first-page previews |
| **Collections & Folders** | Nested folder hierarchy with model organization |
| **Dual Authentication** | Session cookies + JWT Bearer tokens (Bearer fallback supports embedded/non-cookie contexts) |
| **Admin Panel** | User management, provisioning, password resets |

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Runtime | Node.js 20 in Docker images; LXC installer installs/requires Node 22 (v22 verified); server bundle targets Node 22; Express 4 |
| Database | SQLite (`better-sqlite3`, WAL mode) |
| Frontend | React 19, TypeScript, Tailwind CSS |
| 3D Engine | Three.js with STLLoader, OBJLoader, ThreeMFLoader |

---

## Quick Start

### Development
```bash
cp .env.example .env   # Fill in the three secrets, set GOOSE_SEED_DB=true
npm install && npm run dev
# First run seeds: admin / admin123 (change immediately)
```

### Production
```bash
cp .env.example .env   # Fill in all secrets; set ADMIN_PASSWORD for first-run seeding
npm run build && npm start
# On an existing database, .env changes do not reset the password — use npm run set-admin
```

---

## Environment Variables

```bash
JWT_SECRET=<min 32 chars>          # Required
REFRESH_TOKEN_SECRET=<min 32>      # Required
SESSION_SECRET=<min 32 chars>      # Required
GOOSE_SEED_DB=true                # Seed first admin (dev / first deploy)
ADMIN_USER=admin                  # Optional, defaults to admin
ADMIN_PASSWORD=<strong password>  # Seeds this password on first run
SESSION_EXPIRY_MINUTES=1440       # Default: 24 hours
```

Generate secret: `openssl rand -base64 52`

---

## File Uploads

**Allowed**: `.stl`, `.3mf`, `.obj`, `.pdf`, `.zip`, `.7z` (max 300MB per file; 20 files for a new upload, 10 per "Add Files" request)  
**Rate limits**: general API 200 requests/minute per IP; uploads 30/hour per IP; auth endpoints 10 logins/15 min, 10 refreshes/hour, 20 logouts/hour per IP

PDFs may be uploaded directly, added to an existing model, or included in `.zip`/`.7z` archives
alongside 3D files. A PDF-only upload becomes a standalone document item; PDFs attached to a
model stay attachments and never replace its primary 3D file. Security checks block executables,
scripts, and image files, including inside archives.

---

## Database Schema

```sql
users, models (item_type: model | document), files, tags, model_tags,
favorites, collections, collection_models, auth_tokens, schema_versions
```

Schema version **5** — see [MIGRATION_GUIDE.md](./MIGRATION_GUIDE.md)

---

## API Quick Reference

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/models` | ✓ | Paginated search over title, description and attachment filenames (tags, filters) |
| POST | `/api/models` | ✓ | Multi-file upload or archive extraction |
| POST | `/api/auth/login` | — | Returns access + refresh tokens |
| POST | `/api/auth/refresh` | Bearer refresh token | Rotates refresh token and returns a new access token |

No separate API reference is checked in; see `server/routes/*.ts` and the root
[MIGRATION_GUIDE.md](./MIGRATION_GUIDE.md) / [SECURITY_GUIDE.md](./SECURITY_GUIDE.md).

---

## Deployment

### Proxmox LXC (Recommended)
Prerequisite: clone this repo to `/opt/slag3D` inside a Debian 12/Ubuntu 22.04+ LXC as root
(the installer also checks for ~2.5 GB free disk and outbound network access).

```bash
curl -fsSL https://raw.githubusercontent.com/probers1/slag3D/main/scripts/install-lxc.sh | bash
systemctl status slag3D.service
```

On first install the script generates a random admin password, stores it in `/opt/slag3D/.env`,
prints it, verifies login via `/api/auth/login`, and re-syncs the account with
`set-admin-password.js` if the database still has an older password. Existing `.env` values are
preserved.

### Docker Compose
```bash
# Set JWT_SECRET, REFRESH_TOKEN_SECRET and SESSION_SECRET in .env first
docker compose up -d
# Volumes: slag3d_data → slag3d_vault_data (DB), slag3d_uploads → slag3d_vault_uploads (files)
```

---

## Default Admin Credentials

| Username | Password | Role | Notes |
|----------|----------|------|-------|
| `admin` | `admin123` | Administrator | **Dev mode only** — change after first login |
| `admin` (or `ADMIN_USER`) | `ADMIN_PASSWORD` | Administrator | First run when `users` is empty |
| `admin` (or `ADMIN_USER` from `.env`) | random | Administrator | LXC installer — see `/opt/slag3D/.env` (`ADMIN_PASSWORD`) |

Change your password with the lock icon (tooltip "Change Password") in the top navigation bar.

### Resetting the admin password (server console)

```bash
cd /opt/slag3D
npm run set-admin -- 'YourNewStrongPassword'   # one-off password
npm run set-admin                               # uses ADMIN_USER / ADMIN_PASSWORD from .env
```

The command creates or resets the account named by `ADMIN_USER` (default `admin`) in the existing
SQLite database, restores it if soft-deleted, and works while the server is running. It does not
itself enforce the UI's 12-character password policy.

---

## Security Guidelines

- Always set `JWT_SECRET`, `REFRESH_TOKEN_SECRET`, and `SESSION_SECRET` in production (≥32 chars; avoid placeholder/weak values)
- Never commit `.env` files to Git
- Rotate secrets every 90 days
- Use HTTPS/HSTS for public access
- See [SECURITY_GUIDE.md](./SECURITY_GUIDE.md) for full implementation

---

## Support

- Issues: Open GitHub issues for bugs/features
- Documentation: See related guides below

---
**Schema version**: 5 (PDF documents active)  
**Last Updated**: Nov 2026
