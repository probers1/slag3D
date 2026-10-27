# SLAG3D 🖨️
> **S**torage, **L**ibrary, & **A**sset **G**rid

**SLAG3D** is a self-hosted, multi-user 3D printer model tracking dashboard and mesh repository (resembling Thangs and Thingiverse) built for makers, print farm operators, and workshop teams.

---

## 🌟 Key Features

- **Automated Headless 512×512 Thumbnail Engine (`lib/thumbnail.js` & `lib/queue.js`)**:
  - Background task queue powered by `p-queue` with a concurrency limit of 2.
  - Exponential backoff retry mechanism (1s, 3s, 9s delays; max 3 retries) on browser crash or WebGL initialization failure.
  - Dark `#121214` solid background with a calibrated 3-point studio lighting preset.
  - Camera auto-centering using `THREE.Box3` and dynamic distance calculations based on bounding sphere radius with a 35% margin.
  - Seamless client-side Three.js capture fallback ensuring reliable thumbnail generation across all environments.
- **Interactive Three.js 3D Model Viewer (`src/components/ModelViewerModal.tsx`)**:
  - Embedded 3D viewport supporting `.stl`, `.3mf`, and `.obj` models.
  - OrbitControls (smooth damping, rotate, zoom, pan), wireframe/solid toggle, and camera reset.
  - **"Save as Thumbnail"**: Capture custom viewing angles from the 3D viewport and immediately promote them to the model's 512×512 grid thumbnail.
  - **Slicing & Mesh Analytics**:
    - Real-time bounding box dimensions ($X \times Y \times Z$ in mm).
    - Watertight mesh volume calculation ($cm^3$).
    - Estimated PLA weight ($g$ assuming 1.24 g/cm³ density and effective infill/shell ratio).
    - Customizable filament cost estimate ($ based on editable $/kg rate).
- **Archive Extraction & Multi-File Processing (`server/upload.ts`)**:
  - Multi-file uploads via `multer` supporting `.stl`, `.3mf`, `.obj`, `.zip`, `.7z` up to 300MB.
  - Automated `.zip` unpacking with directory traversal protection.
  - Automated detection of the largest 3D mesh as primary (`is_primary_3d = 1`), with user override support in the UI.
- **Hierarchical Collections & Nested Folders (`src/components/CollectionsDrawer.tsx`)**:
  - Self-referential folder hierarchy (`parent_folder_id`) supporting multi-tier subfolders.
  - Drag-free tree navigation, folder creation, inline rename, model count badges, and deletion.
- **Dual-Layer Authentication & RBAC (`server/routes/auth.ts`)**:
  - Session authentication with `express-session` + `connect-sqlite3` and `bcryptjs`.
  - Secondary Bearer token authentication header preventing iframe cookie drops in sandboxed environments.
  - Auto-seeded administrator account (`admin` / `admin123`) on initial startup.
  - Admin management panel for provisioning accounts, resetting user passwords, and deleting users.

---

## 🛠️ System Architecture & Tech Stack

| Layer | Technology |
|---|---|
| **Backend Runtime** | Node.js v20 LTS / Express 4 |
| **Database** | SQLite via `better-sqlite3` (`/data/vault.db` with WAL mode) |
| **Session & Auth** | `express-session`, `connect-sqlite3`, `bcryptjs`, Bearer token fallback |
| **File Extraction** | `multer`, `node-stream-zip`, `node-7z` |
| **Thumbnail Queue** | `p-queue` (concurrency: 2, exponential retry: 1s, 3s, 9s), Puppeteer headless Chromium |
| **Frontend Framework** | React 19, TypeScript, Tailwind CSS, Lucide React |
| **3D Engine** | Three.js (STLLoader, OBJLoader, OrbitControls) |

---

## 🗄️ Database Schema (`/data/vault.db`)

```sql
users (id, username UNIQUE, password_hash, role, created_at)
models (id, user_id FK, title, description, thumbnail_path, thumbnail_status, created_at, updated_at)
files (id, model_id FK, filename, original_name, mime_type, file_size, file_path, is_primary_3d)
tags (id, name UNIQUE)
model_tags (model_id FK, tag_id FK)
favorites (user_id FK, model_id FK, created_at)
collections (id, user_id FK, name, description, parent_folder_id FK, created_at)
collection_models (collection_id FK, model_id FK, added_at)
auth_tokens (token, user_id FK, created_at)
```

---

## 🚀 Deployment Options

### Option 1: Proxmox Debian LXC Automated Setup (Recommended)

1. Create a Debian 12 (Bookworm) unprivileged or privileged LXC in Proxmox.
2. Run the automated installer:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/slag3d/slag3d/main/scripts/install-lxc.sh | bash
   ```
   Or execute directly from the cloned repo:
   ```bash
   sudo ./scripts/install-lxc.sh
   ```
3. The script installs Node.js v20 LTS, Chromium headless shared libraries (`libnss3`, `libasound2`, `libxss1`), sets up persistent directories at `/data` and `/uploads`, builds the frontend, and enables `slag3d.service` via systemd.

To manage the service:
```bash
systemctl status slag3d.service
journalctl -u slag3d.service -f
```

### Option 2: Docker & Docker Compose

Launch the containerized stack with persistent volumes:
```bash
docker compose up -d
```
Access the dashboard at `http://localhost:3000`.

### Option 3: Local Development Workflow

```bash
# 1. Install dependencies
npm install

# 2. Run full-stack dev server
npm run dev

# 3. Build for production
npm run build
npm start
```

---

## 🔐 Default Credentials

| Username | Password | Role |
|---|---|---|
| `admin` | `admin123` | Administrator |

*(Administrators can create users or change credentials from the top navigation bar).*

---

## 📡 REST API Reference

### Authentication
- `POST /api/auth/login` — Authenticates user and returns session cookie + Bearer token.
- `POST /api/auth/logout` — Destroys session and invalidates token.
- `GET /api/auth/me` — Returns current profile.
- `PUT /api/auth/change-password` — Updates account password.

### Admin Management (`requireAdmin`)
- `GET /api/admin/users` — Lists all registered accounts.
- `POST /api/admin/users` — Provisions new user account.
- `PUT /api/admin/users/:id/reset-password` — Forcibly resets user password.
- `DELETE /api/admin/users/:id` — Deletes user account.

### Models & Tags (`requireAuth`)
- `GET /api/models?page=1&limit=12&search=...&tag=...&filter=all|mine|favorites&collection_id=...` — Paginated search.
- `POST /api/models` — Multi-file / archive upload.
- `GET /api/models/:id` — Full model metadata, files list, tags, collections.
- `PUT /api/models/:id` — Update title, description, tags, or primary 3D file.
- `DELETE /api/models/:id` — Purges model and associated files/thumbnails from disk.
- `POST /api/models/:id/favorite` — Toggles favorite status.
- `POST /api/models/:id/regenerate-thumbnail` — Re-queues background thumbnail render.
- `POST /api/models/:id/thumbnail-client` — Uploads custom viewing angle snapshot.
- `GET /api/tags` — Lists active tag cloud with counts.

### Collections & Folders (`requireAuth`)
- `GET /api/collections` — Lists user collections and nested subfolders.
- `POST /api/collections` — Creates collection / subfolder.
- `PUT /api/collections/:id` — Renames or moves folder.
- `DELETE /api/collections/:id` — Deletes folder.
- `POST /api/collections/:id/models` — Adds model to folder.
- `DELETE /api/collections/:id/models/:model_id` — Removes model from folder.
