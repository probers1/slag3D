import { v4 as uuidv4 } from 'uuid';
import { db } from '../db.ts';

export const TAG_NAME_MAX_LENGTH = 40;
export const TAG_DESCRIPTION_MAX_LENGTH = 200;
export const MAX_TAGS_PER_ITEM = 20;
export const DEFAULT_TAG_COLOR = '#60a5fa';

export interface TagRow {
  id: string;
  name: string;
  color: string;
  description: string;
  count: number;
}

export class TagValidationError extends Error {
  status = 400;
}

export class TagConflictError extends Error {
  status = 409;
}

const TAG_SELECT = `
  SELECT t.id, t.name, t.color, t.description,
         COUNT(DISTINCT mt.model_id) AS count
  FROM tags t
  LEFT JOIN model_tags mt ON mt.tag_id = t.id
`;

/**
 * All tags, including unused ones, with global usage counts.
 * The Tags manager needs unused tags to stay visible after their last item is deleted.
 */
export function getTagsWithCounts(): TagRow[] {
  return db.prepare(`
    ${TAG_SELECT}
    GROUP BY t.id
    ORDER BY count DESC, t.name ASC
  `).all() as TagRow[];
}

export function getTagById(id: string): TagRow | undefined {
  return db.prepare(`${TAG_SELECT} WHERE t.id = ? GROUP BY t.id`).get(id) as TagRow | undefined;
}

export function getTagByName(name: string): TagRow | undefined {
  return db.prepare(`${TAG_SELECT} WHERE t.name = ? COLLATE NOCASE GROUP BY t.id`).get(name) as TagRow | undefined;
}

/**
 * Normalize a tag name. Strict mode is used by the manager endpoints; lenient
 * mode is used when syncing tags from item uploads/edits so a long or weird
 * value cannot break an otherwise valid upload.
 */
export function normalizeTagName(value: unknown, strict = true): string | null {
  if (typeof value !== 'string') {
    if (strict) throw new TagValidationError('Tag name must be a string');
    return null;
  }

  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/,/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  if (!cleaned) {
    if (strict) throw new TagValidationError('Tag name cannot be empty');
    return null;
  }

  if (cleaned.length > TAG_NAME_MAX_LENGTH) {
    if (strict) {
      throw new TagValidationError(`Tag name must be ${TAG_NAME_MAX_LENGTH} characters or fewer`);
    }
    return cleaned.slice(0, TAG_NAME_MAX_LENGTH).replace(/-$/, '');
  }

  return cleaned;
}

export function normalizeTagColor(value: unknown, strict = true): string {
  if (value === undefined || value === null || value === '') return DEFAULT_TAG_COLOR;
  if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value.trim())) {
    if (strict) throw new TagValidationError('Tag color must be a 6-digit hex value like #60a5fa');
    return DEFAULT_TAG_COLOR;
  }
  return value.trim().toLowerCase();
}

export function normalizeTagDescription(value: unknown, strict = true): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') {
    if (strict) throw new TagValidationError('Tag description must be a string');
    return '';
  }
  const cleaned = value.trim();
  if (cleaned.length > TAG_DESCRIPTION_MAX_LENGTH) {
    if (strict) {
      throw new TagValidationError(
        `Tag description must be ${TAG_DESCRIPTION_MAX_LENGTH} characters or fewer`
      );
    }
    return cleaned.slice(0, TAG_DESCRIPTION_MAX_LENGTH);
  }
  return cleaned;
}

export function createTag(input: {
  name: unknown;
  color?: unknown;
  description?: unknown;
}): TagRow {
  const name = normalizeTagName(input.name)!;
  const color = normalizeTagColor(input.color);
  const description = normalizeTagDescription(input.description);

  db.prepare(`
    INSERT OR IGNORE INTO tags (id, name, color, description)
    VALUES (?, ?, ?, ?)
  `).run(uuidv4(), name, color, description);

  return getTagByName(name)!;
}

export function updateTag(
  id: string,
  input: { name: unknown; color?: unknown; description?: unknown }
): TagRow | null {
  const existing = getTagById(id);
  if (!existing) return null;

  const name = normalizeTagName(input.name)!;
  const conflict = db.prepare(`
    SELECT id FROM tags WHERE name = ? COLLATE NOCASE AND id <> ?
  `).get(name, id) as { id: string } | undefined;
  if (conflict) throw new TagConflictError('Another tag already uses that name');

  const color = normalizeTagColor(input.color);
  const description = normalizeTagDescription(input.description);

  db.prepare(`
    UPDATE tags SET name = ?, color = ?, description = ? WHERE id = ?
  `).run(name, color, description, id);

  return getTagById(id)!;
}

/** Deleting a tag cascades to model_tags, detaching it from every item. */
export function deleteTag(id: string): boolean {
  return db.prepare('DELETE FROM tags WHERE id = ?').run(id).changes > 0;
}

function parseTagNames(input: string | string[] | undefined | null): string[] {
  let raw: unknown[] = [];

  if (Array.isArray(input)) {
    raw = input;
  } else if (typeof input === 'string') {
    if (!input.trim()) return [];
    try {
      const parsed = JSON.parse(input);
      raw = Array.isArray(parsed) ? parsed : input.split(',');
    } catch {
      raw = input.split(',');
    }
  }

  const seen = new Set<string>();
  const names: string[] = [];
  for (const value of raw) {
    const name = normalizeTagName(value, false);
    if (name && !seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
    if (names.length >= MAX_TAGS_PER_ITEM) break;
  }
  return names;
}

/**
 * Replace the set of tags attached to an item. Kept here (and re-exported by
 * models.ts) so uploads, metadata edits and tests share one implementation.
 */
export function syncModelTags(modelId: string, tagsInput: string | string[] | undefined | null): void {
  const names = parseTagNames(tagsInput);

  const replace = db.transaction(() => {
    db.prepare('DELETE FROM model_tags WHERE model_id = ?').run(modelId);

    const insertTag = db.prepare(`
      INSERT OR IGNORE INTO tags (id, name, color, description)
      VALUES (?, ?, ?, ?)
    `);
    const findTag = db.prepare('SELECT id FROM tags WHERE name = ? COLLATE NOCASE');
    const linkTag = db.prepare(`
      INSERT OR IGNORE INTO model_tags (model_id, tag_id) VALUES (?, ?)
    `);

    for (const name of names) {
      insertTag.run(uuidv4(), name, DEFAULT_TAG_COLOR, '');
      const tag = findTag.get(name) as { id: string } | undefined;
      if (tag) linkTag.run(modelId, tag.id);
    }
  });

  replace();
}
