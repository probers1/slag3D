import multer from 'multer';
import path from 'path';
import fs from 'fs';
import StreamZip from 'node-stream-zip';
import { v4 as uuidv4 } from 'uuid';
import { db } from './db.ts';
import { enqueueThumbnailRender } from '../lib/queue.ts';

const uploadStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const tmpDir = path.resolve(process.cwd(), 'uploads', 'tmp');
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
    cb(null, tmpDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  },
});

export const uploadMiddleware = multer({
  storage: uploadStorage,
  limits: { fileSize: 300 * 1024 * 1024 }, // 300MB
  fileFilter: (req, file, cb) => {
    const allowedExts = ['.stl', '.3mf', '.obj', '.zip', '.7z'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedExts.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file format ${ext}. Allowed formats: .stl, .3mf, .obj, .zip, .7z`));
    }
  },
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
