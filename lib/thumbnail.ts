import path from "path";
import fs from "fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createRequire } from "node:module";
import puppeteer from "puppeteer";
import { THUMBNAILS_DIR, THREE_BUNDLE_PATH, resolveUploadsPath } from "../server/paths.ts";

export interface RenderJobData { modelId: string; filePath: string; fileType: "stl" | "obj" | "3mf" | "pdf"; }

function getThreeBundle() {
  const candidates = [THREE_BUNDLE_PATH, path.resolve(process.cwd(), "lib", "three-bundle.js")];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return fs.readFileSync(candidate, "utf-8");
  }
  return "";
}

const DEFAULT_TIMEOUT = 60000;

// Avoid building enormous HTML documents for very large models. Anything
// larger falls back to the placeholder mesh instead of failing the render.
const MAX_INLINE_MODEL_BYTES = 25 * 1024 * 1024;

function buildModelScript(filePath: string): string {
  try {
    const ext = path.extname(filePath).toLowerCase();
    const stat = fs.statSync(filePath);
    if (stat.size > MAX_INLINE_MODEL_BYTES) {
      console.warn(`[Thumbnail] Model is too large to inline (${stat.size} bytes); using placeholder`);
      return "";
    }

    if (ext === '.stl') {
      const base64 = fs.readFileSync(filePath).toString('base64');
      return `
        const binary = atob(${JSON.stringify(base64)});
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const geometry = new THREE.STLLoader().parse(bytes.buffer);
        geometry.computeVertexNormals();
        model = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x3b82f6, roughness: 0.55, metalness: 0.1 }));
      `;
    }

    if (ext === '.obj') {
      const text = fs.readFileSync(filePath, 'utf8');
      return `
        model = new THREE.OBJLoader().parse(${JSON.stringify(text)});
        model.traverse((child) => {
          if (child.isMesh) {
            child.material = new THREE.MeshStandardMaterial({ color: 0x3b82f6, roughness: 0.55, metalness: 0.1 });
          }
        });
      `;
    }

    if (ext === '.3mf') {
      const base64 = fs.readFileSync(filePath).toString('base64');
      return `
        try {
          const binary = atob(${JSON.stringify(base64)});
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          model = new THREE.ThreeMFLoader().parse(bytes.buffer);
          model.traverse((child) => {
            if (child.isMesh) {
              child.material = new THREE.MeshStandardMaterial({ color: 0x3b82f6, roughness: 0.55, metalness: 0.1 });
            }
          });
        } catch (err) {
          console.warn('[Thumbnail] Could not parse 3MF:', err);
          model = null;
        }
      `;
    }
  } catch (err: any) {
    console.warn(`[Thumbnail] Could not inline model geometry: ${err?.message || err}`);
  }

  return "";
}

const nodeRequire = createRequire(import.meta.url);
const PDFJS_MODULE_PATH = nodeRequire.resolve('pdfjs-dist/legacy/build/pdf.mjs');
const PDFJS_WORKER_PATH = nodeRequire.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs');

/**
 * Render the first page of a PDF into the standard 512x512 card thumbnail.
 *
 * pdf.js runs inside Puppeteer against a short-lived loopback server. Serving
 * the module, worker and document over HTTP (instead of injecting megabytes
 * through CDP) keeps memory bounded and gives the worker a normal same-origin
 * environment.
 */
async function renderPdfThumbnail(modelId: string, filePath: string): Promise<string> {
    const pdfBytes = fs.readFileSync(filePath);
    if (pdfBytes.length > 150 * 1024 * 1024) {
        throw new Error(`PDF too large for thumbnail rendering (${pdfBytes.length} bytes)`);
    }

    const pdfjsSource = fs.readFileSync(PDFJS_MODULE_PATH);
    const workerSource = fs.readFileSync(PDFJS_WORKER_PATH);
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      html,body{margin:0;padding:0;width:512px;height:512px;background:#ffffff;overflow:hidden}
      canvas{display:block}
    </style></head><body></body></html>`;

    const server = http.createServer((req, res) => {
        const url = (req.url || '').split('?')[0];
        if (url === '/pdf.mjs') {
            res.writeHead(200, { 'Content-Type': 'text/javascript' });
            return res.end(pdfjsSource);
        }
        if (url === '/pdf.worker.mjs') {
            res.writeHead(200, { 'Content-Type': 'text/javascript' });
            return res.end(workerSource);
        }
        if (url === '/document.pdf') {
            const range = req.headers.range;
            const match = range?.match(/bytes=(\d+)-(\d*)/);
            if (match) {
                const start = Number(match[1]);
                const end = match[2] ? Number(match[2]) : pdfBytes.length - 1;
                res.writeHead(206, {
                    'Content-Type': 'application/pdf',
                    'Accept-Ranges': 'bytes',
                    'Content-Range': `bytes ${start}-${end}/${pdfBytes.length}`,
                    'Content-Length': end - start + 1,
                });
                return res.end(pdfBytes.subarray(start, end + 1));
            }
            res.writeHead(200, {
                'Content-Type': 'application/pdf',
                'Accept-Ranges': 'bytes',
                'Content-Length': pdfBytes.length,
            });
            return res.end(pdfBytes);
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;

    let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
    try {
        browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--no-first-run',
            ],
        });
        const page = await browser.newPage();
        page.on('pageerror', (err) => {
            console.warn(`[Thumbnail] PDF page error: ${err instanceof Error ? err.message : String(err)}`);
        });
        await page.setViewport({ width: 512, height: 512, deviceScaleFactor: 1 });
        await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load', timeout: DEFAULT_TIMEOUT });

        await page.evaluate(async () => {
            const moduleUrl = '/pdf.mjs';
            const pdfjs = await import(moduleUrl);
            pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.mjs';
            const doc = await pdfjs.getDocument({ url: '/document.pdf', useSystemFonts: true }).promise;
            const pdfPage = await doc.getPage(1);
            const base = pdfPage.getViewport({ scale: 1 });
            const scale = Math.min(512 / base.width, 512 / base.height);
            const viewport = pdfPage.getViewport({ scale });
            const canvas = document.createElement('canvas');
            canvas.width = 512;
            canvas.height = 512;
            const ctx = canvas.getContext('2d')!;
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, 512, 512);
            ctx.save();
            ctx.translate((512 - viewport.width) / 2, (512 - viewport.height) / 2);
            await pdfPage.render({ canvasContext: ctx, viewport, background: '#ffffff' }).promise;
            ctx.restore();
            document.body.appendChild(canvas);
        });

        const outputDir = THUMBNAILS_DIR;
        if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
        const outputPath = path.resolve(outputDir, `${modelId}.png`);
        await page.screenshot({ path: outputPath + '.tmp', type: 'png' });
        fs.renameSync(outputPath + '.tmp', outputPath);
        return `/uploads/thumbnails/${modelId}.png`;
    } finally {
        if (browser) { try { await browser.close(); } catch {} }
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
}

export async function renderModelThumbnail({ modelId, filePath, fileType }: RenderJobData): Promise<string> {
    if (fileType === 'pdf') return renderPdfThumbnail(modelId, filePath);

    const outputDir = THUMBNAILS_DIR;
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const outputPath = path.resolve(outputDir, `${modelId}.png`);
    const publicPath = `/uploads/thumbnails/${modelId}.png`;
    const fullPath = path.isAbsolute(filePath) ? filePath : resolveUploadsPath(filePath);

    if (!fs.existsSync(fullPath)) throw new Error(`File not found at ${fullPath}`);

    const modelScript = buildModelScript(fullPath);
    const threeScript = getThreeBundle();

    let lastError: any;
    const attempts = [{ attempt: 1, timeoutMs: 15000 }, { attempt: 2, timeoutMs: 30000 }, { attempt: 3, timeoutMs: DEFAULT_TIMEOUT }];

    for (const cfg of attempts) {
        if (cfg.attempt > 1) console.log(`[Thumbnail] Retry ${cfg.attempt}`);

        try {
            const browser = await puppeteer.launch({
                headless: true,
                args: [
                    "--no-sandbox",
                    "--disable-setuid-sandbox",
                    "--disable-dev-shm-usage",
                    "--use-gl=angle",
                    "--use-angle=swiftshader",
                    "--enable-unsafe-swiftshader",
                    "--enable-webgl",
                    "--single-process",
                ],
            });

            try {
                const page = await browser.newPage();
                page.on('pageerror', (err) => {
                    const message = err instanceof Error ? err.message : String(err);
                    console.warn(`[Thumbnail] Page error: ${message}`);
                });
                page.on('console', (msg) => {
                    if (msg.type() === 'error') console.warn(`[Thumbnail] Page console error: ${msg.text()}`);
                });
                await page.setViewport({ width: 512, height: 512 });

                if (!threeScript) throw new Error("Three.js bundle not found");

                const html = `<!DOCTYPE html><html>
<head><style>html,body{margin:0;padding:0;background:#0a0a0c;overflow:hidden}</style>
<script>${threeScript}</script></head>
<body>
<script>
  const THREE = window.THREE;
  const scene = new THREE.Scene();
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(512, 512);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  document.body.appendChild(renderer.domElement);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 3000);

  scene.add(new THREE.AmbientLight(0xffffff, 0.75));
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.0);
  keyLight.position.set(1, 1.5, 1);
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight(0xffffff, 0.8);
  fillLight.position.set(-1, -0.5, -1);
  scene.add(fillLight);

  let model = null;
  ${modelScript}
  if (!model) {
    const boxGeo = new THREE.BoxGeometry(32, 48, 24);
    boxGeo.center();
    model = new THREE.Mesh(boxGeo, new THREE.MeshStandardMaterial({ color: 0x3b82f6 }));
  }
  scene.add(model);

  // Frame the model automatically, regardless of its scale or position.
  const box = new THREE.Box3().setFromObject(model);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const fitHeightDistance = maxDim / (2 * Math.tan((Math.PI * camera.fov) / 360));
  const distance = 1.5 * Math.max(fitHeightDistance, fitHeightDistance / camera.aspect);

  camera.near = Math.max(maxDim / 1000, 0.01);
  camera.far = maxDim * 1000;
  camera.position.set(center.x + distance * 0.8, center.y + distance * 0.7, center.z + distance);
  camera.lookAt(center);
  camera.updateProjectionMatrix();

  renderer.render(scene, camera);
</script>
</body></html>`;

                await page.setContent(html, { timeout: cfg.timeoutMs });
                // Wait for at least one painted frame before capturing.
                await page.evaluate(() => new Promise<void>((resolve) => {
                  requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
                }));

                await page.screenshot({ path: outputPath + ".tmp", type: "png" });

                if (fs.existsSync(outputPath + ".tmp")) {
                    fs.renameSync(outputPath + ".tmp", outputPath);
                    return publicPath;
                }
            } catch (e) { lastError = e; } finally { try { await browser.close(); } catch {} }
        } catch (e) { lastError = e as Error; if (!/(timeout|memory)/i.test((e as Error).message)) throw e; }
    }

    throw lastError || new Error(`All ${attempts.length} attempts failed for model ${modelId}`);
}
