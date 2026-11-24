import { Router } from 'express';
import { requireAdmin, requireAuth } from '../middleware.ts';
import {
  TagConflictError,
  TagValidationError,
  createTag,
  deleteTag,
  getTagById,
  getTagByName,
  getTagsWithCounts,
  normalizeTagName,
  updateTag,
} from '../lib/tags.ts';

const router = Router();

function sendTagError(res: any, err: unknown) {
  const status =
    err instanceof TagValidationError ? 400 :
    err instanceof TagConflictError ? 409 :
    500;

  if (status === 500) {
    console.error('[TAGS] Unexpected error:', err);
  }

  res.status(status).json({
    error: err instanceof Error ? err.message : 'Unexpected tag error',
  });
}

// GET /api/tags — public tag index, including unused tags.
router.get('/', (_req, res) => {
  res.json({ tags: getTagsWithCounts() });
});

// GET /api/tags/:id — public single-tag read.
router.get('/:id', (req, res) => {
  const tag = getTagById(req.params.id);
  if (!tag) return res.status(404).json({ error: 'Tag not found' });
  res.json({ tag });
});

// POST /api/tags — any logged-in user can create a global tag, typically while
// tagging one of their own items. Reusing an existing name is idempotent.
router.post('/', requireAuth, (req, res) => {
  try {
    const name = normalizeTagName(req.body?.name)!;
    const existing = getTagByName(name);
    const tag = createTag(req.body || {});
    res.status(existing ? 200 : 201).json({ tag });
  } catch (err) {
    sendTagError(res, err);
  }
});

// PUT /api/tags/:id — global metadata belongs to admins.
router.put('/:id', requireAdmin, (req, res) => {
  try {
    const tag = updateTag(req.params.id, req.body || {});
    if (!tag) return res.status(404).json({ error: 'Tag not found' });
    res.json({ tag });
  } catch (err) {
    sendTagError(res, err);
  }
});

// DELETE /api/tags/:id — detaches the tag from all items via ON DELETE CASCADE.
router.delete('/:id', requireAdmin, (req, res) => {
  try {
    if (!deleteTag(req.params.id)) {
      return res.status(404).json({ error: 'Tag not found' });
    }
    res.json({ message: 'Tag deleted' });
  } catch (err) {
    sendTagError(res, err);
  }
});

export default router;
