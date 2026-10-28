import multer from 'multer';
import path from 'path';
import fs from 'fs';
import StreamZip from 'node-stream-zip';
import { v4 as uuidv4 } from 'uuid';
import { db } from './db.ts';
import { enqueueThumbnailRender } from '../lib/queue.ts';

// Allowed file extensions (3D models and safe archives)
const ALLOWED_EXTENSIONS = ['.stl', '.3mf', '.obj', '.zip', '.7z'];

// Dangerous indicators in filenames to block
const SUSPICIOUS_PATTERNS = [
  'script', 'exe', 'bat', 'cmd', 'ps1',
  'html', 'htm', 'js', 'vbs', 'sh',
  'bash', 'bin', 'py', 'pl'
];

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
    return { valid: false, error: new Error(`File ${originalName.split('.')[0] || originalName}: File has no extension. Use only .stl, .3mf, .obj (models) or .zip, .7z (archives).`) };
  }

  // Reject image files
  if (IMAGE_EXTENSIONS.includes(ext)) {
    console.error(`[UPLOAD SECURITY] Image file rejected: ${originalName}`);
    return { valid: false, error: new Error(`Image file (.${ext}) is not allowed for 3D models. Supported formats: .stl, .3mf, .obj (models) or .zip, .7z (archives).`) };
  }

  // Check extension against allowlist
  if (!ALLOWED_EXTENSIONS.includes('.' + ext)) {
    console.error(`[UPLOAD SECURITY] Unsupported extension: ${ext} in ${originalName}`);
    return { valid: false, error: new Error(`Unsupported format (.${ext}). Only .stl, .3mf, .obj (3D models) or .zip, .7z (archives) are allowed.`) };
  }

  // Additional checks for ZIP archives with suspicious names
  if (ext === '.zip') {
    const lowerName = originalName.toLowerCase();
    if (SUSPICIOUS_PATTERNS.some(pattern => lowerName.includes(pattern))) {
      console.error(`[UPLOAD SECURITY] Blocked suspicious archive: ${originalName}`);
      return { valid: false, error: new Error(`File ${originalName}: Suspicious archive name contains security-related keywords. Only clean 3D model archives are allowed.`) };
    }
    
    // Check for embedded executables in ZIP
    if (['executable', 'script', 'bat', 'cmd'].some(pattern => lowerName.includes(pattern))) {
      console.error(`[UPLOAD SECURITY] Rejected executable-like archive: ${originalName}`);
      return { valid: false, error: new Error(`File ${originalName}: Archives containing executables or scripts are not allowed.`) };
    }
  }

  return { valid: true };
}

/**
 * Create multer storage configuration with validation
 */
const uploadStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const tmpDir = path.resolve(process.cwd(), 'uploads', 'tmp');
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
    cb(null, tmpDir);
  },
  
  filename: (req, file, cb) => {
    // Validate before accepting
    const validation = validateFile(file);
    
    if (!validation.valid) {
      // Throw error to multer for proper HTTP response handling
      throw new Error(validation.error?.message || `Invalid file type for upload: ${file.originalname}`);
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

interface ExtractedFileInfo {
  id: string;
  filename: string;
  original_name: string;
  mime_type: string;
  file_size: number;
  file_path: string;
  is_primary_3d: number;
}

export async function processModelFiles(modelId: string, uploadedFiles: Express.Multer.File[]): Promise<ExtractedFileInfo[]> {
  const modelDir = path.resolve(process.cwd(), 'uploads', 'models', modelId);
  if (!fs.existsSync(modelDir)) {
    fs.mkdirSync(modelDir, { recursive: true });
  }

  const processedFiles: ExtractedFileInfo[] = [];

  for (const file of uploadedFiles) {
    const ext = path.extname(file.originalname).toLowerCase();

    if (ext === '.zip') {
      // Extract ZIP archive using node-stream-zip
      try {
        const zip = new StreamZip.async({ file: file.path });
        const entries = await zip.entries();

        for (const entry of Object.values(entries)) {
          if (entry.isDirectory) continue;
          
          // Clean base filename without nested directory traversal risk
          const baseName = path.basename(entry.name);
          // Skip hidden / macOS metadata files
          if (baseName.startsWith('.') || entry.name.includes('__MACOSX')) continue;

          // Security: Check for dangerous file types in extracted contents
          const lowerEntry = entry.name.toLowerCase();
          const dangerousEntryPatterns = ['.exe', '.bat', '.cmd', '.ps1', '.sh', '.py', '.pl', 'executable', 'script'];
          
          if (dangerousEntryPatterns.some(pattern => lowerEntry.includes(pattern))) {
            console.warn(`[UPLOAD SECURITY] Skipping dangerous archive entry: ${entry.name}`);
            continue;
          }

          const destPath = path.join(modelDir, `${uuidv4()}_${baseName}`);
          await zip.extract(entry.name, destPath);

          const stat = fs.statSync(destPath);
          const entryExt = path.extname(baseName).toLowerCase();
          const mimeType = entryExt === '.stl' ? 'model/stl' : entryExt === '.3mf' ? 'model/3mf' : entryExt === '.obj' ? 'model/obj' : 'application/octet-stream';

          processedFiles.push({
            id: uuidv4(),
            filename: path.basename(destPath),
            original_name: baseName,
            mime_type: mimeType,
            file_size: stat.size,
            file_path: `/uploads/models/${modelId}/${path.basename(destPath)}`,
            is_primary_3d: 0,
          });
        }
        await zip.close();
      } catch (err) {
        console.error(`Error unzipping file ${file.originalname}:`, err);
      } finally {
        // Clean up temporary uploaded zip
        try { fs.unlinkSync(file.path); } catch {}
      }
    } else {
      // Direct 3D model file (.stl, .obj, .3mf) or other
      const destFilename = `${uuidv4()}_${file.originalname}`;
      const destPath = path.join(modelDir, destFilename);
      fs.renameSync(file.path, destPath);

      const mimeType = ext === '.stl' ? 'model/stl' : ext === '.3mf' ? 'model/3mf' : ext === '.obj' ? 'model/obj' : 'application/octet-stream';

      processedFiles.push({
        id: uuidv4(),
        filename: destFilename,
        original_name: file.originalname,
        mime_type: mimeType,
        file_size: file.size,
        file_path: `/uploads/models/${modelId}/${destFilename}`,
        is_primary_3d: 0,
      });
    }
  }

  // Identify 3D files (.stl, .3mf, .obj) and designate largest as primary
  const model3dFiles = processedFiles.filter((f) => {
    const ext = path.extname(f.original_name).toLowerCase();
    return ['.stl', '.3mf', '.obj'].includes(ext);
  });

  if (model3dFiles.length > 0) {
    // Sort descending by file_size
    model3dFiles.sort((a, b) => b.file_size - a.file_size);
    model3dFiles[0].is_primary_3d = 1;
  }

  // Insert all file records into database
  const insertStmt = db.prepare(`
    INSERT INTO files (id, model_id, filename, original_name, mime_type, file_size, file_path, is_primary_3d)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const pf of processedFiles) {
    insertStmt.run(pf.id, modelId, pf.filename, pf.original_name, pf.mime_type, pf.file_size, pf.file_path, pf.is_primary_3d);
  }

  // Queue thumbnail render for primary 3D file
  const primary = processedFiles.find((f) => f.is_primary_3d === 1);
  if (primary) {
    const primaryExt = path.extname(primary.original_name).toLowerCase().replace('.', '') as 'stl' | 'obj' | '3mf';
    const relativeOrAbs = path.resolve(process.cwd(), primary.file_path.replace(/^\//, ''));
    enqueueThumbnailRender({
      modelId,
      filePath: relativeOrAbs,
      fileType: ['stl', 'obj', '3mf'].includes(primaryExt) ? primaryExt : 'stl',
    });
  }

  return processedFiles;
}
