/**
 * Regression test: first-page PDF thumbnails.
 *
 * PDF-only uploads get a 512x512 PNG rendered from page 1 by pdf.js inside
 * Puppeteer (lib/thumbnail.ts). This test generates a small text PDF, renders
 * it through the real thumbnail code, and verifies the output is a non-blank
 * 512x512 PNG.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error('FAIL:', message);
    process.exit(1);
  }
}

async function main() {
  console.log('Testing PDF first-page thumbnails...');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'slag3d-pdf-thumb-'));
  const previousUploadsDir = process.env.UPLOADS_DIR;
  // lib/thumbnail.ts reads UPLOADS_DIR at import time, so set it before loading.
  process.env.UPLOADS_DIR = tmp;

  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
  try {
    const { renderModelThumbnail } = await import('../lib/thumbnail.ts');

    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    // Generate a real PDF with visible page-one content.
    const genPage = await browser.newPage();
    await genPage.setContent(
      '<html><body style="font-family:sans-serif"><h1>SLAG3D PDF thumbnail test</h1><p>Page one content.</p></body></html>'
    );
    const pdfPath = path.join(tmp, 'sample.pdf');
    fs.writeFileSync(pdfPath, await genPage.pdf({ format: 'A4' }));
    await genPage.close();

    const modelId = 'pdf-thumb-test';
    const publicPath = await renderModelThumbnail({ modelId, filePath: pdfPath, fileType: 'pdf' });
    assert(
      publicPath === `/uploads/thumbnails/${modelId}.png`,
      `Unexpected thumbnail path: ${publicPath}`
    );

    const pngPath = path.join(tmp, 'thumbnails', `${modelId}.png`);
    assert(fs.existsSync(pngPath), 'Thumbnail PNG was not written');
    const png = fs.readFileSync(pngPath);
    assert(
      png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
      'Thumbnail is not a PNG'
    );
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    assert(width === 512 && height === 512, `Expected 512x512, got ${width}x${height}`);

    // Decode in the browser to confirm page content was actually painted.
    const imgPage = await browser.newPage();
    await imgPage.goto(`file://${pngPath}`);
    const darkPixels = await imgPage.evaluate(() => {
      const img = document.querySelector('img')!;
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let dark = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] < 200 || data[i + 1] < 200 || data[i + 2] < 200) dark++;
      }
      return dark;
    });
    await imgPage.close();
    assert(darkPixels > 200, `Expected rendered page content, found ${darkPixels} non-white pixels`);

    console.log(`512x512 PNG with ${darkPixels} non-white pixels`);
    console.log('All PDF thumbnail tests passed.');
  } finally {
    if (browser) {
      try { await browser.close(); } catch {}
    }
    if (previousUploadsDir === undefined) delete process.env.UPLOADS_DIR;
    else process.env.UPLOADS_DIR = previousUploadsDir;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
