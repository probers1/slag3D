import path from 'path';
import fs from 'fs';
import puppeteer from 'puppeteer';
import { db } from '../server/db.ts';

export interface RenderJobData {
  modelId: string;
  filePath: string;
  fileType: 'stl' | 'obj' | '3mf';
}

// Load local bundled Three.js library (Three + STLLoader + OBJLoader)
function getThreeBundle(): string {
  const bundlePath = path.resolve(process.cwd(), 'lib', 'three-bundle.js');
  if (fs.existsSync(bundlePath)) {
    return fs.readFileSync(bundlePath, 'utf-8');
  }
  return '';
}

export async function renderModelThumbnail(job: RenderJobData): Promise<string> {
  const { modelId, filePath, fileType } = job;
  const outputDir = path.resolve(process.cwd(), 'uploads', 'thumbnails');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const outputPath = path.resolve(outputDir, `${modelId}.png`);
  const publicThumbnailPath = `/uploads/thumbnails/${modelId}.png`;

  // Determine full absolute path to the 3D file
  const fullFilePath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(fullFilePath)) {
    throw new Error(`3D file does not exist at ${fullFilePath}`);
  }

  // Read file as base64 data URI so browser can load it without network delays
  const fileBuffer = fs.readFileSync(fullFilePath);
  const base64Data = fileBuffer.toString('base64');
  const threeScript = getThreeBundle();

  // Launch Puppeteer headless browser with tested ANGLE SwiftShader WebGL flags
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 512, height: 512, deviceScaleFactor: 1 });

    // HTML template implementing Three.js rendering specs with offline bundle
    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    body { margin: 0; padding: 0; overflow: hidden; background: #121214; }
    canvas { width: 512px; height: 512px; display: block; }
  </style>
  <script>${threeScript}</script>
</head>
<body>
  <div id="container"></div>
  <script>
    window.renderReady = false;
    window.renderError = null;

    try {
      const width = 512;
      const height = 512;

      // 1. Scene & Renderer setup
      const scene = new THREE.Scene();
      const renderer = new THREE.WebGLRenderer({
        antialias: true,
        preserveDrawingBuffer: true,
        failIfMajorPerformanceCaveat: false,
        powerPreference: 'high-performance'
      });
      renderer.setSize(width, height);
      renderer.setPixelRatio(1);
      renderer.setClearColor(0x121214, 1);
      document.getElementById('container').appendChild(renderer.domElement);

      // 2. Camera setup (fov: 45)
      const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 3000);

      // 3. Lighting Preset
      // Ambient light (intensity ~0.6)
      const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
      scene.add(ambientLight);

      // Key directional light at (1, 2, 1.5) (intensity ~1.0)
      const keyLight = new THREE.DirectionalLight(0xffffff, 1.05);
      keyLight.position.set(1, 2, 1.5).normalize();
      scene.add(keyLight);

      // Fill directional light at (-1, -0.5, -1) (intensity ~0.3)
      const fillLight = new THREE.DirectionalLight(0x8899bb, 0.35);
      fillLight.position.set(-1, -0.5, -1).normalize();
      scene.add(fillLight);

      // 4. File Data decode
      const b64 = "${base64Data}";
      const byteCharacters = atob(b64);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const arrayBuffer = byteArray.buffer;

      // Material for 3D model
      const material = new THREE.MeshStandardMaterial({
        color: 0x3b82f6,
        roughness: 0.35,
        metalness: 0.25,
      });

      function fitAndRender(object) {
        scene.add(object);

        // Bounding box calculation & center at (0, 0, 0)
        const box = new THREE.Box3().setFromObject(object);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        
        object.position.x += -center.x;
        object.position.y += -center.y;
        object.position.z += -center.z;

        const maxDim = Math.max(size.x, size.y, size.z) || 10;
        const fov = 45 * (Math.PI / 180);
        
        // Dynamic camera placement with 35% margin padding
        const cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2)) * 1.35;
        camera.position.set(cameraZ * 0.75, cameraZ * 0.55, cameraZ * 0.85);
        camera.lookAt(0, 0, 0);

        renderer.render(scene, camera);
        window.renderReady = true;
      }

      const fileType = "${fileType}";
      if (fileType === 'stl') {
        const loader = new THREE.STLLoader();
        const geometry = loader.parse(arrayBuffer);
        geometry.computeVertexNormals();
        const mesh = new THREE.Mesh(geometry, material);
        fitAndRender(mesh);
      } else if (fileType === 'obj') {
        const textDecoder = new TextDecoder();
        const text = textDecoder.decode(arrayBuffer);
        const loader = new THREE.OBJLoader();
        const obj = loader.parse(text);
        obj.traverse((child) => {
          if (child.isMesh) {
            child.material = material;
          }
        });
        fitAndRender(obj);
      } else {
        const geometry = new THREE.DodecahedronGeometry(20, 0);
        const mesh = new THREE.Mesh(geometry, material);
        fitAndRender(mesh);
      }
    } catch (e) {
      window.renderError = String(e);
      window.renderReady = true;
    }
  </script>
</body>
</html>
    `;

    await page.setContent(html, { waitUntil: 'load', timeout: 15000 });

    // Wait for window.renderReady === true
    await page.waitForFunction('window.renderReady === true', { timeout: 12000 });

    const renderError = await page.evaluate('window.renderError');
    if (renderError) {
      throw new Error(`Renderer inside page failed: ${renderError}`);
    }

    // Take 512x512 PNG screenshot
    await page.screenshot({ path: outputPath, type: 'png' });

    // Update database record
    db.prepare(`
      UPDATE models 
      SET thumbnail_path = ?, thumbnail_status = 'completed', updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `).run(publicThumbnailPath, modelId);

    console.log(`[SLAG3D Thumbnail] Successfully generated thumbnail for model ${modelId}`);
    return publicThumbnailPath;
  } finally {
    await browser.close();
  }
}
