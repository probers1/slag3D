# SLAG3D — Agent Notes

## Commands

- `npm run dev` — one process: Express + Vite middleware on `:3000`. Needs `.env`
  (copy `.env.example`; `JWT_SECRET`, `REFRESH_TOKEN_SECRET`, `SESSION_SECRET` ≥32 chars with
  placeholder values rejected at startup; low Shannon entropy only logs a warning).
  `GOOSE_SEED_DB=true` or `ADMIN_PASSWORD` seeds the first admin (dev default: `admin` / `admin123`).
- `npm run build` → Vite client + esbuild server (`dist/server.js`, target Node 22); `npm start`
  runs the bundle. `NODE_ENV=production` is required for the bundle to serve `dist/` (otherwise Vite
  middleware).
- `npm run typecheck` (`tsc --noEmit`, no output). There is **no** lint or format script.
- Tests: `npm test` (password smoke), `npm run test:upload-security`, `npm run test:prod-paths`,
  `npm run test:pdf-thumbnail`, `npm run test:tag-management`.
  - `test:prod-paths` needs `dist/index.html` from `npm run build:client`; it rebuilds the server
    bundle itself and boots it in a temp directory.
  - `test:pdf-thumbnail` renders a generated PDF and asserts a non-blank 512×512 PNG.
  - `test:tag-management` migrates a temp DB and checks normalization, CRUD validation, unused-tag
    visibility, and cascade detachment.
  - `tests/priority{1,2,3}_fixes.test.ts` have no npm script: `npx tsx tests/priority1_fixes.test.ts`.
- Full check: `npm run typecheck && npm run build && npm run test:upload-security && npm run test:prod-paths && npm run test:pdf-thumbnail && npm run test:tag-management && npm test`.
- `npm run set-admin -- 'NewPassword'` creates/resets the account named by `ADMIN_USER` (default
  `admin`) in the existing SQLite DB, restores it if soft-deleted, and works while the server is
  running. `npm run update` runs `scripts/update.sh`, which fetches origin, checks out the remote
  default branch (`main` unless `SLAG3D_UPDATE_BRANCH` overrides), fast-forwards to its HEAD, then
  reinstalls/builds/restarts and waits for the healthcheck; there are no version tags in the repo.

## Layout & wiring

- `server.ts` is the only entrypoint: `initDatabase()` → JSON body limits → upload dirs + legacy
  migration → SQLite session store → auth/CSRF → `/uploads` static (with JSON 404) → `/api/*` routers
  → Vite (dev) or `dist/` (prod).
- `server/` = Express backend/routes/migrations; `src/` = React; `lib/` = server-only thumbnail
  engine (`thumbnail.ts`) + render queue (`queue.ts`, concurrency 2).
- Relative imports in `server/` and `lib/` generally use explicit `.ts` extensions, except migration
  imports in `server/migrations/index.ts`. Avoid `@/`: configured inconsistently (tsconfig → repo
  root, Vite → `src`) and unused.
- Upload/thumbnail paths come from `server/paths.ts`; DB path resolution lives in `server/db.ts` and
  the production static dir in `server.ts`. Never use `process.cwd()`/`__dirname` to resolve upload
  storage — the bundled server would write to one place and serve from another, producing 404s or
  `Invalid typed array length` in the viewer. `UPLOADS_DIR` overrides the default; Docker `/uploads`,
  LXC `/opt/slag3D/uploads`. `npm run test:prod-paths` guards this regression.
- `server/lib/uploadSecurity.ts` is the canonical source for storable extensions and archive entry
  filtering; top-level validation still duplicates the allowlist in `server/upload.ts`, and served
  MIME types are also set in `server.ts`. Keep `modelExtensionOf()` 3D-only; PDFs use
  `documentExtensionOf()` / `uploadableExtensionOf()`. Active content (html/js/svg) stays blocked in
  archives. Caps: 300MB/file (`server/upload.ts`), 20 files for a new model upload and 10 per
  "Add Files" request (`server/routes/models.ts`).

## Database & migrations

- Dev `./data/vault.db`, prod `/data/vault.db`; `DB_PATH` overrides. Current schema version **6**.
- A migration is `server/migrations/NNN_*.ts` returning `{version, timestamp}`. Register it in the
  array in `server/migrations/index.ts` **and** mirror new columns in `applyFallbackTables()` in
  `server/db.ts`. v3 was abandoned; v4 = user soft-delete; v5 = `models.item_type`;
  v6 = `tags.color`, `tags.description`, and `idx_model_tags_tag_id`.
- The runner skips migrations where `schemaVersion >= migrationVersion`. Real DBs may report a
  higher version from another build (e.g. one with `page_count`), so `models.item_type` and the tag
  metadata columns are also repaired by idempotent `ensureItemTypeColumn()` / `ensureTagMetadata()`
  called unconditionally from `initDatabase()` — do not remove them or rely on the version check
  alone. Follow this repair pattern for any new column code queries immediately.
- Admin seeding only runs when `users` is empty; an existing DB keeps its old password even if
  `.env` changes. Reset with `npm run set-admin`, not by deleting `data/`.

## Auth & API

- Auth resolves from the session cookie or a JWT supplied as `Authorization: Bearer`, `x-auth-token`,
  or query `token` (`refresh` tokens are also accepted as bearer); access 1h, refresh 7d.
- Unsafe `/api` methods require `x-csrf-token` to match the `slag3d_csrf_token` cookie, except the
  exempt auth/health paths in `server/middleware.ts`; the frontend's `apiFetch()`
  (`src/utils/api.ts`) adds Bearer + CSRF. Media anchors can append `?token=`.
- `GET /api/models` searches title, description **and attachment filenames**. `item_type` is
  `model | document`; collections/favorites are unchanged by PDFs.

## Tags

- `server/lib/tags.ts` is canonical: lowercase/whitespace-to-dash normalization, case-insensitive
  dedupe, 40-char names, 200-char descriptions, and transactional `syncModelTags()` for item edits.
- `server/routes/tags.ts` serves `GET /api/tags` (public, includes unused tags), `GET /api/tags/:id`,
  logged-in `POST /api/tags` (idempotent create), and admin-only `PUT`/`DELETE`. Tag deletion cascades
  to `model_tags`, detaching it from every item; no items are deleted.
- The dedicated Tags view is `src/components/TagsPanel.tsx` (`activeTab === 'tags'`). `TagInput.tsx`
  supplies colored suggestions in the upload modal and item detail editor. Managers can pick a color
  and add a note; non-admins cannot change global metadata.

## PDF documents

- `.pdf` uploads directly, inside `.zip`/`.7z`, or via "Add Files". PDF-only upload →
  `item_type='document'`; PDFs added to a model stay attachments and never become primary 3D.
- Page-1 thumbnails render with pdf.js inside Puppeteer (`lib/thumbnail.ts`) into the normal
  512×512 PNG. Client reader `src/components/PdfViewer.tsx` is lazy-loaded and fetches bytes via
  `apiFetch` so `Content-Disposition: attachment` is irrelevant.

## Operational gotchas

- Edit `server/routes/*.ts` → restart; in `npm run dev`, `src/` edits use HMR (`DISABLE_HMR=true`
  disables HMR and file watching); in production, rebuild with `npm run build`.
- Thumbnail failures are logged by the queue, not returned in the upload response; a restart clears
  the in-memory queue, so jobs already marked `processing`/`failed` are not re-queued server-side.
  3D models get an automatic in-browser WebGL fallback that persists a thumbnail on next page load
  (`ModelCard.tsx`); `POST /api/models/:id/regenerate-thumbnail` remains the way to request a fresh
  server-side headless render (including for PDFs).
- `pkill -9 node` kills every Node process on the machine — use a targeted kill if other projects
  run here.
- Deployment: the LXC installer expects the repo cloned to `/opt/slag3D`; `docker compose up -d`
  needs the three secrets in `.env` and creates volumes `slag3d_vault_data` / `slag3d_vault_uploads`.
  `scripts/install-lxc.sh --update` delegates to `npm run update`'s script, so both paths use the
  same fast-forward check. More detail in `README.md`, `MIGRATION_GUIDE.md`, and `SECURITY_GUIDE.md`.
