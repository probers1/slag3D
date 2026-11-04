import PQueue from 'p-queue';
import { db } from '../server/db.ts';
import { renderModelThumbnail, RenderJobData } from './thumbnail.ts';

// Concurrency: 2 parallel render tasks
export const renderQueue = new PQueue({ concurrency: 2 });

const BACKOFF_DELAYS = [1000, 3000, 9000]; // 1s, 3s, 9s exponential delays
const MAX_RETRIES = 3;

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function enqueueThumbnailRender(job: RenderJobData) {
  // Update status to pending
  db.prepare(`
    UPDATE models 
    SET thumbnail_status = 'pending', updated_at = CURRENT_TIMESTAMP 
    WHERE id = ?
  `).run(job.modelId);

  renderQueue.add(async () => {
    let attempt = 0;
    let lastError: Error | null = null;

    // Update status to processing
    db.prepare(`
      UPDATE models 
      SET thumbnail_status = 'processing', updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `).run(job.modelId);

    while (attempt < MAX_RETRIES) {
      attempt++;
      try {
        console.log(`[SLAG3D Queue] Processing thumbnail for model ${job.modelId} (attempt ${attempt}/${MAX_RETRIES})...`);
        const thumbnailPath = await renderModelThumbnail(job);

        // The renderer only writes the PNG; persist the result so the UI stops
        // showing the "rendering" spinner and starts using the generated image.
        db.prepare(`
          UPDATE models
          SET thumbnail_path = ?, thumbnail_status = 'completed', updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(thumbnailPath, job.modelId);

        return;
      } catch (err: any) {
        lastError = err;
        console.warn(`[SLAG3D Queue] Attempt ${attempt} failed for model ${job.modelId}:`, err?.message || err);

        if (attempt < MAX_RETRIES) {
          const delay = BACKOFF_DELAYS[attempt - 1] || 9000;
          console.log(`[SLAG3D Queue] Backing off for ${delay}ms before retry...`);
          await sleep(delay);
        }
      }
    }

    // If all retries exhausted, mark status as failed
    console.error(`[SLAG3D Queue] All ${MAX_RETRIES} render attempts failed for model ${job.modelId}:`, lastError?.message);
    db.prepare(`
      UPDATE models 
      SET thumbnail_status = 'failed', updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `).run(job.modelId);
  });
}
