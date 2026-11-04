import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { v4 as uuidv4 } from 'uuid';
import { db } from './db.ts';
import { MODELS_DIR, TMP_UPLOADS_DIR, resolveUploadsPath } from './paths.ts';
import { enqueueThumbnailRender } from '../lib/queue.ts';
import {
  MODEL_EXTENSIONS,
  UploadValidationError,
  extractZipArchive,
  mimeTypeForModelExtension,
  modelExtensionOf,
  safeStoredFilename,
  type ExtractedFileInfo,
} from './lib/uploadSecurity.ts';

// Re-export the upload security primitives so existing import sites keep working.
export {
  MODEL_EXTENSIONS,
  UploadValidationError,
  extractZipArchive,
  mimeTypeForModelExtension,
  modelExtensionOf,
  safeStoredFilename,
  type ExtractedFileInfo,
} from './lib/uploadSecurity.ts';

const execAsync = promisify(exec);

// Allowed file extensions (3D models and safe archives)
const ALLOWED_EXTENSIONS = ['.stl', '.3mf', '.obj', '.zip', '.7z'];

// 2D image extensions (for rejection)
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'];

/**
 * Validate an uploaded file with security checks and descriptive errors
 */
function validateFile(file: Express.Multer.File): { valid: boolean; error?: Error } {
  const originalName = file.originalname;
  const ext = path.extname(originalName).toLowerCase().replace(/^\.+/, '');

  // Handle files without extension
  if (ext === '') {
    console.error(`[UPLOAD SECURITY] Rejected file without extension: ${originalName}`);
    return { valid: false, error: new UploadValidationError(`File ${originalName.split('.')[0] || originalName}: File has no extension. Use only .stl, .3mf, .obj (models) or .zip, .7z (archives).`) };
  }

  // Reject image files
  if (IMAGE_EXTENSIONS.includes(ext)) {
    console.error(`[UPLOAD SECURITY] Image file rejected: ${originalName}`);
    return { valid: false, error: new UploadValidationError(`Image file (.${ext}) is not allowed for 3D models. Supported formats: .stl, .3mf, .obj (models) or .zip, .7z (archives).`) };
  }

  // Check extension against allowlist
  if (!ALLOWED_EXTENSIONS.includes('.' + ext)) {
    console.error(`[UPLOAD SECURITY] Unsupported extension: ${ext} in ${originalName}`);
    return { valid: false, error: new UploadValidationError(`Unsupported format (.${ext}). Only .stl, .3mf, .obj (3D models) or .zip, .7z (archives) are allowed.`) };
  }

  // NOTE: the archive *file name* is deliberately not inspected. The archive
  // itself is never served (it is deleted right after extraction and its
  // content type is `application/zip`, which is never rendered inline). The
  // real security control is the strict entry allowlist applied during
  // extraction (see lib/uploadSecurity.ts), which inspects every file inside
  // the archive. Name based heuristics only produced false rejections
  // (e.g. an archive named "combining.zip" contains "bin").

  return { valid: true };
}

/**
 * Create multer storage configuration with validation
 */
const uploadStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (!fs.existsSync(TMP_UPLOADS_DIR)) {
      fs.mkdirSync(TMP_UPLOADS_DIR, { recursive: true });
    }
    cb(null, TMP_UPLOADS_DIR);
  },
  
  filename: (req, file, cb) => {
    // Validate before accepting
    const validation = validateFile(file);
    
    if (!validation.valid) {
      // Return error via callback for proper HTTP response handling.
      // `UploadValidationError` carries a status of 400 so the global error
      // handler answers with 400 instead of 500.
      return cb(new UploadValidationError(validation.error?.message || `Invalid file type for upload: ${file.originalname}`), null as any);
    }
    
    // Generate unique filename with extension
    const finalExt = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuidv4()}${finalExt}`);
  },
});

/**
 * Multer middleware for file uploads
 */
export const uploadMiddleware = multer({
  storage: uploadStorage,
  limits: { fileSize: 300 * 1024 * 1024 }, // 300MB
  
  // File filter is optional - we handle validation in filename callback
});

/**
 * Extract a 7z archive into the model directory using the system 7z binary.
 * Mirrors the .zip flow and applies the same strict extension allowlist.
 */
export async function extract7zArchive(
  archivePath: string,
  modelId: string,
  modelDir: string
): Promise<ExtractedFileInfo[]> {
  const extracted: ExtractedFileInfo[] = [];
  const tempDir = fs.mkdtempSync(path.join(TMP_UPLOADS_DIR, '7z-XXXXXX'));
  const archiveCopy = path.join(tempDir, 'archive.7z');
  fs.copyFileSync(archivePath, archiveCopy);

  try {
    await execAsync(`7z x -y "${archiveCopy}" -o"${tempDir}"`);

    const extractedEntries = (fs.readdirSync(tempDir, { recursive: true }) as string[])
      .map((f) => path.join(tempDir, f))
      .filter((p: string) => {
        try {
          return fs.statSync(p).isFile() && modelExtensionOf(p) !== null;
        } catch {
          return false;
        }
      });

    for (const p of extractedEntries) {
      const entryExt = modelExtensionOf(p)!;
      const destName = safeStoredFilename(path.basename(p), entryExt);
      const destPath = path.join(modelDir, destName);
      fs.copyFileSync(p, destPath);
      const stat = fs.statSync(destPath);

      extracted.push({
        id: uuidv4(),
        filename: destName,
        original_name: path.basename(p),
        mime_type: mimeTypeForModelExtension(entryExt),
        file_size: stat.size,
        file_path: `/uploads/models/${modelId}/${destName}`,
        is_primary_3d: 0,
      });
    }
  } finally {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    try { fs.unlinkSync(archivePath); } catch {}
  }

  return extracted;
}

export async function processModelFiles(
  modelId: string,
  uploadedFiles: Express.Multer.File[],
  options: { isSupplementary?: boolean } = {}
): Promise<ExtractedFileInfo[]> {
  const modelDir = path.join(MODELS_DIR, modelId);
  if (!fs.existsSync(modelDir)) {
    fs.mkdirSync(modelDir, { recursive: true });
  }

  const processedFiles: ExtractedFileInfo[] = [];

  for (const file of uploadedFiles) {
    const ext = path.extname(file.originalname).toLowerCase();

    if (ext === '.zip') {
      // Extract ZIP archive using node-stream-zip
      const extracted = await extractZipArchive(file.path, modelId, modelDir);
      processedFiles.push(...extracted);
    } else if (ext === '.7z') {
      // Extract 7z archive using system 7z binary (p7zip) — mirrors the .zip extraction flow
      const extracted = await extract7zArchive(file.path, modelId, modelDir);
      processedFiles.push(...extracted);
    } else {
      // Direct 3D model file (.stl, .obj, .3mf).
      // The extension is re-validated here: the payload is written into the
      // browser-served uploads directory, so only allowlisted model formats
      // may be stored.
      const modelExt = modelExtensionOf(file.originalname);
      if (!modelExt) {
        console.warn(`[UPLOAD SECURITY] Rejected file with unsupported type: ${file.originalname}`);
        try { fs.unlinkSync(file.path); } catch {}
        continue;
      }

      const destFilename = safeStoredFilename(file.originalname, modelExt);
      const destPath = path.join(modelDir, destFilename);
      fs.renameSync(file.path, destPath);

      processedFiles.push({
        id: uuidv4(),
        filename: destFilename,
        original_name: file.originalname,
        mime_type: mimeTypeForModelExtension(modelExt),
        file_size: file.size,
        file_path: `/uploads/models/${modelId}/${destFilename}`,
        is_primary_3d: 0,
      });
    }
  }

  if (processedFiles.length === 0) {
    throw new UploadValidationError(
      'No valid 3D model files (.stl, .3mf, .obj) were found in the upload.'
    );
  }

  // Identify 3D files (.stl, .3mf, .obj) and designate largest as primary (initial upload only)
  if (!options.isSupplementary) {
    const model3dFiles = processedFiles.filter(
      (f) => modelExtensionOf(f.original_name) !== null
    );

    if (model3dFiles.length > 0) {
      // Sort descending by file_size
      model3dFiles.sort((a, b) => b.file_size - a.file_size);
      model3dFiles[0].is_primary_3d = 1;
    }
  }

  // Insert all file records into database
  const insertStmt = db.prepare(`
    INSERT INTO files (id, model_id, filename, original_name, mime_type, file_size, file_path, is_primary_3d)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const pf of processedFiles) {
    insertStmt.run(pf.id, modelId, pf.filename, pf.original_name, pf.mime_type, pf.file_size, pf.file_path, pf.is_primary_3d);
  }

  // Queue thumbnail render for primary 3D file (initial upload only)
  if (!options.isSupplementary) {
    const primary = processedFiles.find((f) => f.is_primary_3d === 1);
    if (primary) {
      const primaryExt = path.extname(primary.original_name).toLowerCase().replace('.', '') as 'stl' | 'obj' | '3mf';
      const relativeOrAbs = resolveUploadsPath(primary.file_path);
      enqueueThumbnailRender({
        modelId,
        filePath: relativeOrAbs,
        fileType: ['stl', 'obj', '3mf'].includes(primaryExt) ? primaryExt : 'stl',
      });
    }
  }

  return processedFiles;
}
