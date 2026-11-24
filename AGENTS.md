# SLAG3D — Agent Notes

## Commands

- `npm run dev` — one process: Express + Vite middleware on `:3000`. Needs `.env`
  (copy `.env.example`; `JWT_SECRET`, `REFRESH_TOKEN_SECRET`, `SESSION_SECRET` ≥32 chars,
  entropy-checked at startup). `GOOSE_SEED_DB=true` or `ADMIN_PASSWORD` seeds the first admin
  (dev default: `admin` / `admin123`).
- `npm run build` → Vite client + esbuild server (`dist/server.js`); `npm start` runs the bundle.
  `NODE_ENV=production` is required for the bundle to serve `dist/` (otherwise Vite middleware).
- `npm run typecheck` (`tsc --noEmit`, no output). There is **no** lint or format script.
- Tests: `npm test` (password smoke), `npm run test:upload-security`, `npm run test:prod-paths`.
  - `test:prod-paths` copies `dist/index.html` — run `npm run build:client` first.
  - `tests/priority{1,2,3}_fixes.test.ts` have no npm script: `npx tsx tests/priority1_fixes.test.ts`.
- Full check: `npm run typecheck && npm run build && npm run test:upload-security && npm test`.
- `npm run set-admin -- 'NewPassword'` creates/resets the admin in SQLite; works while the
  server is running. `npm run update` runs `scripts/update.sh`.

## Layout & wiring

- `server.ts` is the only entrypoint: `initDatabase()` → upload dirs → auth/CSRF → `/api/*` routers
  → `/uploads` static → Vite (dev) or `dist/` (prod).
- `server/` = Express backend/routes/migrations; `src/` = React; `lib/` = server-only thumbnail
  engine (`thumbnail.ts`) + render queue (`queue.ts`, concurrency 2).
- Relative imports in `server/` and `lib/` use explicit `.ts` extensions
  (`allowImportingTsExtensions: true`). Avoid `@/`: configured inconsistently (tsconfig → repo
  root, Vite → `src`) and unused.
- All filesystem paths come from `server/paths.ts`. Never use `process.cwd()`/`__dirname` for
  uploads — the bundled server would write to one place and serve from another, producing 404s or
  `Invalid typed array length` in the viewer. `UPLOADS_DIR` overrides the default; Docker `/uploads`,
  LXC `/opt/slag3D/uploads`. `npm run test:prod-paths` guards this regression.
- `server/lib/uploadSecurity.ts` is the single source for allowed extensions, MIME types, and
  archive filtering. Keep `modelExtensionOf()` 3D-only; PDFs use `documentExtensionOf()` /
  `uploadableExtensionOf()`. Active content (html/js/svg) stays blocked in archives.
  Caps: 300MB/file (`server/upload.ts`), 20 files/request (`server/routes/models.ts`).

## Database & migrations

- Dev `./data/vault.db`, prod `/data/vault.db`; `DB_PATH` overrides. Current schema version **5**.
- A migration is `server/migrations/NNN_*.ts` returning `{version, timestamp}`. Register it in the
  array in `server/migrations/index.ts` **and** mirror new columns in `applyFallbackTables()` in
  `server/db.ts`. v3 was abandoned; v4 = user soft-delete; v5 = `models.item_type`.
- The runner skips migrations where `schemaVersion >= migrationVersion`. Real DBs may report a
  higher version from another build (e.g. one with `page_count`), so `models.item_type` is also
  added by idempotent `ensureItemTypeColumn()` called unconditionally from `initDatabase()` —
  do not remove it or rely on the version check alone. Follow this repair pattern for any new
  column code queries immediately.
- Admin seeding only runs when `users` is empty; an existing DB keeps its old password even if
  `.env` changes. Reset with `npm run set-admin`, not by deleting `data/`.

## Auth & API

- Two layers: session cookie (`connect.sid`) + JWT bearer (access 1h, refresh 7d).
- Unsafe `/api` methods need an `x-csrf-token` header matching the cookie; the frontend's
  `apiFetch()` (`src/utils/api.ts`) adds Bearer + CSRF. Media anchors can append `?token=`.
- `GET /api/models` searches title, description **and attachment filenames**. `item_type` is
  `model | document`; collections/favorites are unchanged by PDFs.

## PDF documents

- `.pdf` uploads directly, inside `.zip`/`.7z`, or via "Add Files". PDF-only upload →
  `item_type='document'`; PDFs added to a model stay attachments and never become primary 3D.
- Page-1 thumbnails render with pdf.js inside Puppeteer (`lib/thumbnail.ts`) into the normal
  512×512 PNG. Client reader `src/components/PdfViewer.tsx` is lazy-loaded and fetches bytes via
  `apiFetch` so `Content-Disposition: attachment` is irrelevant.

## Operational gotchas

- Edit `server/routes/*.ts` → restart the server; edit `src/` → HMR. `DISABLE_HMR=true` disables
  HMR **and** file watching.
- Thumbnail failures are logged by the queue, not returned in the upload response; stuck renders
  usually clear on restart.
- `pkill -9 node` kills every Node process on the machine — use a targeted kill if other projects
  run here.
- Deployment details: `scripts/install-lxc.sh` (verifies admin credentials) or `docker compose up -d`
  (volumes `slag3d_data`, `slag3d_uploads`). More detail in `README.md`, `MIGRATION_GUIDE.md`,
  and `SECURITY_GUIDE.md`.
