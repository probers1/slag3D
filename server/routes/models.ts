import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import { db } from '../db.ts';
import { requireAuth } from '../middleware.ts';
import { uploadMiddleware, processModelFiles } from '../upload.ts';
import { enqueueThumbnailRender } from '../../lib/queue.ts';

const router = Router();
router.use(requireAuth);

// Helper to associate tags with a model
export function syncModelTags(modelId: string, tagsInput: string | string[]) {
  let tagList: string[] = [];
  if (Array.isArray(tagsInput)) {
    tagList = tagsInput;
  } else if (typeof tagsInput === 'string') {
    try {
      const parsed = JSON.parse(tagsInput);
      if (Array.isArray(parsed)) tagList = parsed;
      else tagList = tagsInput.split(',').map((t) => t.trim()).filter(Boolean);
    } catch {
      tagList = tagsInput.split(',').map((t) => t.trim()).filter(Boolean);
    }
  }

  // Remove current tags
  db.prepare('DELETE FROM model_tags WHERE model_id = ?').run(modelId);

  const insertTagStmt = db.prepare('INSERT OR IGNORE INTO tags (id, name) VALUES (?, ?)');
  const getTagStmt = db.prepare('SELECT id FROM tags WHERE name = ? COLLATE NOCASE');
  const linkStmt = db.prepare('INSERT OR IGNORE INTO model_tags (model_id, tag_id) VALUES (?, ?)');

  for (const tag of tagList) {
    const cleanTag = tag.trim().toLowerCase();
    if (!cleanTag) continue;
    const tagId = uuidv4();
    insertTagStmt.run(tagId, cleanTag);
    const existingTag = getTagStmt.get(cleanTag) as { id: string } | undefined;
    if (existingTag) {
      linkStmt.run(modelId, existingTag.id);
    }
  }
}

// GET /api/tags — Returns active tag list with usage counts
router.get('/tags', (req, res) => {
  const tags = db.prepare(`
    SELECT t.id, t.name, COUNT(mt.model_id) as count
    FROM tags t
    JOIN model_tags mt ON t.id = mt.tag_id
    GROUP BY t.id
    HAVING count > 0
    ORDER BY count DESC, t.name ASC
  `).all();
  res.json({ tags });
});

// GET /api/models — Paginated search & filter
router.get('/', (req, res) => {
  const userId = req.session.userId!;
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 12));
  const offset = (page - 1) * limit;

  const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
  const tag = typeof req.query.tag === 'string' ? req.query.tag.trim() : '';
  const filter = (req.query.filter as string) || 'all'; // 'all', 'mine', 'favorites'
  const collectionId = typeof req.query.collection_id === 'string' ? req.query.collection_id.trim() : '';

  const whereClauses: string[] = [];
  const params: any[] = [];
  const joins: string[] = [];

  // User filter
  if (filter === 'mine') {
    whereClauses.push('m.user_id = ?');
    params.push(userId);
  } else if (filter === 'favorites') {
    joins.push('JOIN favorites f ON f.model_id = m.id AND f.user_id = ?');
    params.push(userId);
  }

  // Collection filter
  if (collectionId) {
    joins.push('JOIN collection_models cm ON cm.model_id = m.id AND cm.collection_id = ?');
    params.push(collectionId);
  }

  // Tag filter
  if (tag) {
    joins.push('JOIN model_tags mt ON mt.model_id = m.id JOIN tags t ON t.id = mt.tag_id AND t.name = ? COLLATE NOCASE');
    params.push(tag);
  }

  // Text search in title or description
  if (search) {
    whereClauses.push('(m.title LIKE ? OR m.description LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
  const joinsSql = joins.join(' ');

  // Count total matching items
  const countSql = `
    SELECT COUNT(DISTINCT m.id) as total
    FROM models m
    ${joinsSql}
    ${whereSql}
  `;
  const countRow = db.prepare(countSql).get(...params) as { total: number };
  const total = countRow ? countRow.total : 0;
  const totalPages = Math.ceil(total / limit) || 1;

  // Retrieve paginated model records
  const querySql = `
    SELECT 
      m.id, 
      m.user_id, 
      m.title, 
      m.description, 
      m.thumbnail_path, 
      m.thumbnail_status, 
      m.created_at, 
      m.updated_at,
      u.username as owner_username,
      (SELECT COUNT(*) FROM favorites WHERE model_id = m.id AND user_id = ?) as is_favorited,
      (SELECT COUNT(*) FROM files WHERE model_id = m.id) as files_count
    FROM models m
    JOIN users u ON m.user_id = u.id
    ${joinsSql}
    ${whereSql}
    GROUP BY m.id
    ORDER BY m.created_at DESC
    LIMIT ? OFFSET ?
  `;

  const rows = db.prepare(querySql).all(userId, ...params, limit, offset) as any[];

  // Attach tags and primary file path to each model card
  const tagStmt = db.prepare(`
    SELECT t.name FROM tags t
    JOIN model_tags mt ON t.id = mt.tag_id
    WHERE mt.model_id = ?
    ORDER BY t.name ASC
  `);

  const primaryFileStmt = db.prepare(`
    SELECT id, filename, original_name, mime_type, file_size, file_path, is_primary_3d 
    FROM files 
    WHERE model_id = ? AND is_primary_3d = 1
    LIMIT 1
  `);

  const models = rows.map((m) => {
    const tags = tagStmt.all(m.id).map((t: any) => t.name);
    const primaryFile = primaryFileStmt.get(m.id);
    return {
      ...m,
      is_favorited: Boolean(m.is_favorited),
      tags,
      primary_file: primaryFile || null,
    };
  });

  res.json({
    models,
    pagination: {
      total,
      page,
      limit,
      totalPages,
    },
  });
});

// POST /api/models — Multi-file upload (.stl, .3mf, .obj, .zip, .7z)
router.post('/', uploadMiddleware.array('files', 20), async (req, res) => {
  // Make sure userId exists even if session doesn't match request object
  const userId = req.session.userId || (req as any).userId;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized: Missing user session or token' });
  }
  const { title, description = '', tags = '', collection_id } = req.body;

  const files = (req.files as Express.Multer.File[]) || [];
  if (!files || files.length === 0) {
    return res.status(400).json({ error: 'At least one 3D file or archive (.stl, .3mf, .obj, .zip, .7z) is required' });
  }

  const modelTitle = title && String(title).trim() ? String(title).trim() : path.parse(files[0].originalname).name;
  const modelId = uuidv4();

  db.prepare(`
    INSERT INTO models (id, user_id, title, description, thumbnail_status)
    VALUES (?, ?, ?, ?, 'pending')
  `).run(modelId, userId, modelTitle, String(description).trim());

  // Extract and process files
  const processedFiles = await processModelFiles(modelId, files);

  // Sync tags
  if (tags) {
    syncModelTags(modelId, tags);
  }

  // Link to collection if specified
  if (collection_id) {
    const coll = db.prepare('SELECT id FROM collections WHERE id = ? AND user_id = ?').get(collection_id, userId);
    if (coll) {
      db.prepare('INSERT OR IGNORE INTO collection_models (collection_id, model_id) VALUES (?, ?)').run(collection_id, modelId);
    }
  }

  // Retrieve complete created model info
  const createdModel = db.prepare(`
    SELECT m.*, u.username as owner_username,
      (SELECT COUNT(*) FROM favorites WHERE model_id = m.id AND user_id = ?) as is_favorited
    FROM models m
    JOIN users u ON m.user_id = u.id
    WHERE m.id = ?
  `).get(userId, modelId);

  res.status(201).json({
    model: createdModel,
    files: processedFiles,
  });
});

// GET /api/models/:id — Full details, file paths, tags, collections
router.get('/:id', (req, res) => {
  const { id } = req.params;
  const userId = req.session.userId || (req as any).userId;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized: Missing user session or token' });
  }

  const model = db.prepare(`
    SELECT 
      m.*, 
      u.username as owner_username,
      (SELECT COUNT(*) FROM favorites WHERE model_id = m.id AND user_id = ?) as is_favorited
    FROM models m
    JOIN users u ON m.user_id = u.id
    WHERE m.id = ?
  `).get(userId, id) as any;

  if (!model) {
    return res.status(404).json({ error: 'Model not found' });
  }

  // Fetch files
  const files = db.prepare(`
    SELECT id, filename, original_name, mime_type, file_size, file_path, is_primary_3d
    FROM files
    WHERE model_id = ?
    ORDER BY is_primary_3d DESC, file_size DESC
  `).all(id);

  // Fetch tags
  const tags = db.prepare(`
    SELECT t.name FROM tags t
    JOIN model_tags mt ON t.id = mt.tag_id
    WHERE mt.model_id = ?
    ORDER BY t.name ASC
  `).all(id).map((t: any) => t.name);

  // Fetch collections
  const collections = db.prepare(`
    SELECT c.id, c.name FROM collections c
    JOIN collection_models cm ON c.id = cm.collection_id
    WHERE cm.model_id = ? AND c.user_id = ?
  `).all(id, userId);

  res.json({
    model: {
      ...model,
      is_favorited: Boolean(model.is_favorited),
      tags,
      files,
      collections,
    },
  });
});

// PUT /api/models/:id — Updates title, description, tags, primary 3D file
router.put('/:id', (req, res) => {
  const { id } = req.params;
  const userId = req.session.userId || (req as any).userId;
  const userRole = req.session.userRole || (req as any).role;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized: Missing user session or token' });
  }
  const { title, description, tags, primary_file_id } = req.body;

  const model = db.prepare('SELECT id, user_id FROM models WHERE id = ?').get(id) as { id: string; user_id: string } | undefined;
  if (!model) {
    return res.status(404).json({ error: 'Model not found' });
  }

  if (model.user_id !== userId && userRole !== 'admin') {
    return res.status(403).json({ error: 'Permission denied' });
  }

  const updatedTitle = title !== undefined ? String(title).trim() : null;
  const updatedDesc = description !== undefined ? String(description).trim() : null;

  db.prepare(`
    UPDATE models 
    SET 
      title = COALESCE(?, title),
      description = COALESCE(?, description),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(updatedTitle, updatedDesc, id);

  if (tags !== undefined) {
    syncModelTags(id, tags);
  }

  // Override primary 3D file if requested
  if (primary_file_id) {
    db.prepare('UPDATE files SET is_primary_3d = 0 WHERE model_id = ?').run(id);
    db.prepare('UPDATE files SET is_primary_3d = 1 WHERE model_id = ? AND id = ?').run(id, primary_file_id);
  }

  res.json({ message: 'Model updated successfully' });
});

// DELETE /api/models/:id — Purges model record, files, and thumbnail from disk
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  const userId = req.session.userId || (req as any).userId;
  const userRole = req.session.userRole || (req as any).role;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized: Missing user session or token' });
  }

  const model = db.prepare('SELECT id, user_id, title FROM models WHERE id = ?').get(id) as { id: string; user_id: string; title: string } | undefined;
  if (!model) {
    return res.status(404).json({ error: 'Model not found' });
  }

  if (model.user_id !== userId && userRole !== 'admin') {
    return res.status(403).json({ error: 'Permission denied' });
  }

  // 1. Purge model files directory
  const modelDir = path.resolve(process.cwd(), 'uploads', 'models', id);
  try {
    if (fs.existsSync(modelDir)) {
      fs.rmSync(modelDir, { recursive: true, force: true });
    }
  } catch (err) {
    console.warn(`Failed to delete model directory ${modelDir}:`, err);
  }

  // 2. Purge cached thumbnail
  const thumbPath = path.resolve(process.cwd(), 'uploads', 'thumbnails', `${id}.png`);
  try {
    if (fs.existsSync(thumbPath)) {
      fs.unlinkSync(thumbPath);
    }
  } catch (err) {
    console.warn(`Failed to delete thumbnail ${thumbPath}:`, err);
  }

  // 3. Delete database record (cascading deletes files, model_tags, favorites, collection_models)
  db.prepare('DELETE FROM models WHERE id = ?').run(id);

  res.json({ message: `Model "${model.title}" and all associated files purged successfully` });
});

// POST /api/models/:id/favorite — Toggles favorite status
router.post('/:id/favorite', (req, res) => {
  const { id } = req.params;
  const userId = req.session.userId || (req as any).userId;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized: Missing user session or token' });
  }

  const model = db.prepare('SELECT id FROM models WHERE id = ?').get(id);
  if (!model) {
    return res.status(404).json({ error: 'Model not found' });
  }

  const existing = db.prepare('SELECT created_at FROM favorites WHERE user_id = ? AND model_id = ?').get(userId, id);

  if (existing) {
    db.prepare('DELETE FROM favorites WHERE user_id = ? AND model_id = ?').run(userId, id);
    res.json({ is_favorited: false });
  } else {
    db.prepare('INSERT INTO favorites (user_id, model_id) VALUES (?, ?)').run(userId, id);
    res.json({ is_favorited: true });
  }
});

// POST /api/models/:id/regenerate-thumbnail — Manually re-queues render job
router.post('/:id/regenerate-thumbnail', (req, res) => {
  const { id } = req.params;
  const userId = req.session.userId || (req as any).userId;
  const userRole = req.session.userRole || (req as any).role;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized: Missing user session or token' });
  }

  const model = db.prepare('SELECT id, user_id FROM models WHERE id = ?').get(id) as { id: string; user_id: string } | undefined;
  if (!model) {
    return res.status(404).json({ error: 'Model not found' });
  }

  if (model.user_id !== userId && userRole !== 'admin') {
    return res.status(403).json({ error: 'Permission denied' });
  }

  // Find primary 3D file
  const primary = db.prepare(`
    SELECT * FROM files WHERE model_id = ? AND is_primary_3d = 1
  `).get(id) as { file_path: string; original_name: string } | undefined;

  if (!primary) {
    return res.status(400).json({ error: 'No 3D file found for thumbnail generation' });
  }

  const primaryExt = path.extname(primary.original_name).toLowerCase().replace('.', '') as 'stl' | 'obj' | '3mf';
  const relativeOrAbs = path.resolve(process.cwd(), primary.file_path.replace(/^\//, ''));

  enqueueThumbnailRender({
    modelId: id,
    filePath: relativeOrAbs,
    fileType: ['stl', 'obj', '3mf'].includes(primaryExt) ? primaryExt : 'stl',
  });

  res.json({ message: 'Thumbnail regeneration queued', thumbnail_status: 'pending' });
});

// POST /api/models/:id/thumbnail-client — Client Three.js snapshot capture fallback
router.post('/:id/thumbnail-client', (req, res) => {
  const { id } = req.params;
  const userId = req.session.userId || (req as any).userId;
  const userRole = req.session.userRole || (req as any).role;
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized: Missing user session or token' });
  }
  const { imageBase64 } = req.body;

  if (!imageBase64 || !imageBase64.includes('base64,')) {
    return res.status(400).json({ error: 'Valid base64 image data is required' });
  }

  const model = db.prepare('SELECT id, user_id FROM models WHERE id = ?').get(id) as { id: string; user_id: string } | undefined;
  if (!model) {
    return res.status(404).json({ error: 'Model not found' });
  }

  if (model.user_id !== userId && userRole !== 'admin') {
    return res.status(403).json({ error: 'Permission denied' });
  }

  try {
    const base64Data = imageBase64.split(';base64,').pop();
    const buffer = Buffer.from(base64Data, 'base64');

    const thumbDir = path.resolve(process.cwd(), 'uploads', 'thumbnails');
    if (!fs.existsSync(thumbDir)) {
      fs.mkdirSync(thumbDir, { recursive: true });
    }

    const outputPath = path.resolve(thumbDir, `${id}.png`);
    fs.writeFileSync(outputPath, buffer);

    const publicThumbPath = `/uploads/thumbnails/${id}.png`;
    db.prepare(`
      UPDATE models 
      SET thumbnail_path = ?, thumbnail_status = 'completed', updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(publicThumbPath, id);

    res.json({
      message: 'Thumbnail updated from client capture',
      thumbnail_path: publicThumbPath,
      thumbnail_status: 'completed',
    });
  } catch (err: any) {
    console.error('Failed to save client thumbnail:', err);
    res.status(500).json({ error: 'Failed to process client thumbnail image' });
  }
});

export default router;
