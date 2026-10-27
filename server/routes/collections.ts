import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db.ts';
import { requireAuth } from '../middleware.ts';

const router = Router();
router.use(requireAuth);

// GET /api/collections
router.get('/', (req, res) => {
  const userId = req.session.userId;

  // Retrieve user collections and model counts
  const collections = db.prepare(`
    SELECT 
      c.id, 
      c.name, 
      c.description, 
      c.parent_folder_id, 
      c.created_at,
      COUNT(cm.model_id) as model_count
    FROM collections c
    LEFT JOIN collection_models cm ON c.id = cm.collection_id
    WHERE c.user_id = ?
    GROUP BY c.id
    ORDER BY c.created_at ASC
  `).all(userId);

  res.json({ collections });
});

// POST /api/collections
router.post('/', (req, res) => {
  const userId = req.session.userId;
  const { name, description = '', parent_folder_id = null } = req.body;

  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'Collection or folder name is required' });
  }

  // If parent_folder_id provided, ensure it exists and belongs to the user
  if (parent_folder_id) {
    const parent = db.prepare('SELECT id FROM collections WHERE id = ? AND user_id = ?').get(parent_folder_id, userId);
    if (!parent) {
      return res.status(400).json({ error: 'Parent folder not found or unauthorized' });
    }
  }

  const id = uuidv4();
  db.prepare(`
    INSERT INTO collections (id, user_id, name, description, parent_folder_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, userId, String(name).trim(), String(description).trim(), parent_folder_id || null);

  const created = db.prepare(`
    SELECT id, name, description, parent_folder_id, created_at, 0 as model_count
    FROM collections WHERE id = ?
  `).get(id);

  res.status(201).json({ collection: created });
});

// PUT /api/collections/:id
router.put('/:id', (req, res) => {
  const userId = req.session.userId;
  const { id } = req.params;
  const { name, description, parent_folder_id } = req.body;

  const existing = db.prepare('SELECT id, parent_folder_id FROM collections WHERE id = ? AND user_id = ?').get(id, userId) as
    | { id: string; parent_folder_id: string | null }
    | undefined;

  if (!existing) {
    return res.status(404).json({ error: 'Collection not found' });
  }

  // Prevent cyclical parent assignment
  if (parent_folder_id === id) {
    return res.status(400).json({ error: 'A folder cannot be its own parent' });
  }

  if (parent_folder_id) {
    const parent = db.prepare('SELECT id FROM collections WHERE id = ? AND user_id = ?').get(parent_folder_id, userId);
    if (!parent) {
      return res.status(400).json({ error: 'Parent folder not found' });
    }
  }

  const updatedName = name !== undefined ? String(name).trim() : null;
  const updatedDesc = description !== undefined ? String(description).trim() : null;
  const targetParent = parent_folder_id !== undefined ? parent_folder_id : existing.parent_folder_id;

  db.prepare(`
    UPDATE collections 
    SET 
      name = COALESCE(?, name),
      description = COALESCE(?, description),
      parent_folder_id = ?
    WHERE id = ? AND user_id = ?
  `).run(updatedName, updatedDesc, targetParent, id, userId);

  const updated = db.prepare(`
    SELECT c.id, c.name, c.description, c.parent_folder_id, c.created_at, COUNT(cm.model_id) as model_count
    FROM collections c
    LEFT JOIN collection_models cm ON c.id = cm.collection_id
    WHERE c.id = ?
    GROUP BY c.id
  `).get(id);

  res.json({ collection: updated });
});

// DELETE /api/collections/:id
router.delete('/:id', (req, res) => {
  const userId = req.session.userId;
  const { id } = req.params;

  const existing = db.prepare('SELECT id FROM collections WHERE id = ? AND user_id = ?').get(id, userId);
  if (!existing) {
    return res.status(404).json({ error: 'Collection not found' });
  }

  db.prepare('DELETE FROM collections WHERE id = ? AND user_id = ?').run(id, userId);
  res.json({ message: 'Collection deleted successfully' });
});

// POST /api/collections/:id/models
router.post('/:id/models', (req, res) => {
  const userId = req.session.userId;
  const { id } = req.params;
  const { model_id } = req.body;

  if (!model_id) {
    return res.status(400).json({ error: 'model_id is required' });
  }

  const collection = db.prepare('SELECT id FROM collections WHERE id = ? AND user_id = ?').get(id, userId);
  if (!collection) {
    return res.status(404).json({ error: 'Collection not found' });
  }

  const model = db.prepare('SELECT id FROM models WHERE id = ?').get(model_id);
  if (!model) {
    return res.status(404).json({ error: 'Model not found' });
  }

  db.prepare(`
    INSERT OR IGNORE INTO collection_models (collection_id, model_id)
    VALUES (?, ?)
  `).run(id, model_id);

  res.json({ message: 'Model added to collection successfully' });
});

// DELETE /api/collections/:id/models/:model_id
router.delete('/:id/models/:model_id', (req, res) => {
  const userId = req.session.userId;
  const { id, model_id } = req.params;

  const collection = db.prepare('SELECT id FROM collections WHERE id = ? AND user_id = ?').get(id, userId);
  if (!collection) {
    return res.status(404).json({ error: 'Collection not found' });
  }

  db.prepare('DELETE FROM collection_models WHERE collection_id = ? AND model_id = ?').run(id, model_id);
  res.json({ message: 'Model removed from collection' });
});

export default router;
