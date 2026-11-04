import path from 'path';
import fs from 'fs';
import StreamZip from 'node-stream-zip';
import { v4 as uuidv4 } from 'uuid';

/**
 * Upload security primitives.
 *
 * This module is intentionally free of database / browser dependencies so it
 * can be unit tested in isolation.
 *
 * Core invariant: only 3D model payloads may ever be written into the
 * uploads directory. The uploads directory is served back to browsers from
 * the application's own origin (`/uploads/...`), so storing anything the
 * browser can render inline (.html, .svg, .js, ...) would turn a routine
 * upload into a stored-XSS vector.
 */

/**
 * Extensions that may be written into the uploads directory.
 */
export const MODEL_EXTENSIONS = ['.stl', '.3mf', '.obj'];

export interface ExtractedFileInfo {
  id: string;
  filename: string;
  original_name: string;
  mime_type: string;
  file_size: number;
  file_path: string;
  is_primary_3d: number;
}

/**
 * Resolve the normalised 3D model extension of a filename.
 *
 * Returns `null` when the filename is not an allowlisted 3D model payload.
 * This is the single source of truth for "may this file be written into the
 * uploads directory?".
 */
export function modelExtensionOf(filename: string): string | null {
  if (!filename) return null;
  const ext = path.extname(String(filename)).toLowerCase();
  return MODEL_EXTENSIONS.includes(ext) ? ext : null;
}

/**
 * Build a safe on-disk filename for an uploaded payload.
 *
 * The client fully controls `originalname`, so the stored name is reduced to
 * a sanitised stem plus a validated extension. This keeps path separators,
 * traversal sequences and unexpected characters out of the uploads directory.
 */
export function safeStoredFilename(originalName: string, extension: string): string {
  // Normalise Windows separators first so `path.basename` strips both kinds.
  const base = path.basename(String(originalName ?? '').replace(/\\/g, '/'));
  const baseExt = path.extname(base);
  const stem = (baseExt ? base.slice(0, base.length - baseExt.length) : base)
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^[._]+/, '')
    .slice(0, 100);
  return `${uuidv4()}_${stem || 'model'}${extension}`;
}

/**
 * Error raised for client-side upload problems (bad/empty archive contents).
 * Carries an HTTP status so the route can answer with 400 instead of 500.
 */
export class UploadValidationError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = 'UploadValidationError';
  }
}

export function mimeTypeForModelExtension(ext: string): string {
  if (ext === '.stl') return 'model/stl';
  if (ext === '.3mf') return 'model/3mf';
  if (ext === '.obj') return 'model/obj';
  return 'application/octet-stream';
}

/**
 * Extract a ZIP archive into the model directory.
 *
 * SECURITY: a strict extension allowlist is applied to every entry. Entries
 * that are not 3D model payloads are skipped instead of being written to
 * disk, so an archive can never smuggle active content (HTML/SVG/JS/...)
 * into the browser-served uploads directory.
 */
export async function extractZipArchive(
  zipPath: string,
  modelId: string,
  modelDir: string
): Promise<ExtractedFileInfo[]> {
  const extracted: ExtractedFileInfo[] = [];

  try {
    const zip = new StreamZip.async({ file: zipPath });
    const entries = await zip.entries();

    for (const entry of Object.values(entries)) {
      if (entry.isDirectory) continue;

      // Clean base filename without nested directory traversal risk
      const baseName = path.basename(entry.name);
      // Skip hidden / macOS metadata files
      if (baseName.startsWith('.') || entry.name.includes('__MACOSX')) continue;

      // Security: only allowlisted 3D model payloads may be written to disk.
      const entryExt = modelExtensionOf(baseName);
      if (!entryExt) {
        console.warn(`[UPLOAD SECURITY] Skipping archive entry with unsupported type: ${entry.name}`);
        continue;
      }

      const destName = safeStoredFilename(baseName, entryExt);
      const destPath = path.join(modelDir, destName);
      await zip.extract(entry.name, destPath);

      const stat = fs.statSync(destPath);

      extracted.push({
        id: uuidv4(),
        filename: destName,
        original_name: baseName,
        mime_type: mimeTypeForModelExtension(entryExt),
        file_size: stat.size,
        file_path: `/uploads/models/${modelId}/${destName}`,
        is_primary_3d: 0,
      });
    }
    await zip.close();
  } finally {
    // Clean up temporary uploaded zip
    try { fs.unlinkSync(zipPath); } catch {}
  }

  return extracted;
}
