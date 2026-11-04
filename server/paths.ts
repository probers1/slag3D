import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Resolve the project root.
 *
 * In development the sources run straight from the repository root, in
 * production they are bundled into `dist/server.js`. Resolving the upload
 * directory relative to the bundle location would store the files in
 * `dist/uploads` while every other code path (and the installer) expects
 * `<project root>/uploads` - the result is a 404 (or worse: the SPA fallback
 * answering with index.html) for every model file and thumbnail.
 */
export function resolveAppRoot(): string {
  const configured = process.env.APP_DIR?.trim();
  if (configured) return path.resolve(configured);

  const cwd = process.cwd();
  if (fs.existsSync(path.join(cwd, 'package.json')) || fs.existsSync(path.join(cwd, 'lib'))) {
    return cwd;
  }

  // Bundled layout: <root>/dist/server.js -> <root>
  const parent = path.resolve(__dirname, '..');
  if (fs.existsSync(path.join(parent, 'package.json')) || fs.existsSync(path.join(parent, 'lib'))) {
    return parent;
  }

  return cwd;
}

export const APP_ROOT = resolveAppRoot();

/**
 * Resolve the uploads directory.
 *
 * `UPLOADS_DIR` always wins so deployments can point at a mounted volume
 * (Docker: `/uploads`, LXC: `/opt/slag3D/uploads`).
 */
export function resolveUploadsDir(): string {
  const configured = process.env.UPLOADS_DIR?.trim();
  if (configured) return path.resolve(configured);
  return path.join(APP_ROOT, 'uploads');
}

export const UPLOADS_DIR = resolveUploadsDir();
export const THUMBNAILS_DIR = path.join(UPLOADS_DIR, 'thumbnails');
export const MODELS_DIR = path.join(UPLOADS_DIR, 'models');
export const TMP_UPLOADS_DIR = path.join(UPLOADS_DIR, 'tmp');

/** Browser bundle used by the server side thumbnail renderer. */
export const THREE_BUNDLE_PATH = path.join(APP_ROOT, 'lib', 'three-bundle.js');

/**
 * Convert a public path (`/uploads/models/<id>/<file>`) into an absolute
 * filesystem path inside the uploads directory.
 */
export function resolveUploadsPath(publicPath: string): string {
  const relative = publicPath.replace(/^\/+/, '');
  const prefix = 'uploads/';
  if (relative.startsWith(prefix)) {
    return path.join(UPLOADS_DIR, relative.slice(prefix.length));
  }
  return path.resolve(APP_ROOT, relative);
}

/** Create the uploads directory tree if it does not exist yet. */
export function ensureUploadsDirs(): void {
  for (const dir of [UPLOADS_DIR, THUMBNAILS_DIR, MODELS_DIR, TMP_UPLOADS_DIR]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Copy uploads that were written to the legacy location (`<cwd>/uploads`) into
 * the configured uploads directory. Keeps existing models reachable after an
 * update that changes `UPLOADS_DIR` (e.g. Docker switching to a volume).
 */
export function migrateLegacyUploads(): void {
  const legacyDir = path.resolve(process.cwd(), 'uploads');
  if (path.resolve(legacyDir) === path.resolve(UPLOADS_DIR)) return;
  if (!fs.existsSync(legacyDir)) return;

  let hasContent = false;
  try {
    hasContent = fs
      .readdirSync(legacyDir)
      .some((entry) => entry !== '.gitignore' && entry !== '.gitkeep');
  } catch {
    return;
  }
  if (!hasContent) return;

  ensureUploadsDirs();
  console.log(`[SLAG3D] Migrating uploads from ${legacyDir} to ${UPLOADS_DIR}...`);
  try {
    fs.cpSync(legacyDir, UPLOADS_DIR, { recursive: true, force: false, errorOnExist: false });
    console.log('[SLAG3D] Upload migration finished.');
  } catch (err: any) {
    console.warn('[SLAG3D] Upload migration failed:', err?.message || err);
  }
}
