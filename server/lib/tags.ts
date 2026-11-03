import { db } from '../db.ts';

export function getTagsWithCounts() {
  return db.prepare(`
    SELECT t.id, t.name, COUNT(mt.model_id) as count
    FROM tags t
    JOIN model_tags mt ON t.id = mt.tag_id
    GROUP BY t.id
    HAVING count > 0
    ORDER BY count DESC, t.name ASC
  `).all();
}
