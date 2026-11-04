/**
 * Regression test: production file serving paths.
 *
 * In production the server is bundled to `dist/server.js`. The uploads were
 * written to `<cwd>/uploads` but served from `<bundle dir>/uploads`, so every
 * model file and thumbnail 404'd and the SPA fallback answered with
 * index.html. The browser then parsed HTML as a binary STL and failed with
 * "RangeError: Invalid typed array length".
 *
 * This test boots the bundled production server from a separate working
 * directory and verifies that uploads and thumbnails are written to, and
 * served from, the same location.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync, spawn } from 'child_process';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const PORT = 3197;
const BASE = `http://127.0.0.1:${PORT}`;

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error('FAIL:', message);
    process.exit(1);
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Minimal valid binary STL (one triangle)
function buildTestStl(): Buffer {
  const header = Buffer.alloc(80, 0);
  const count = Buffer.alloc(4);
  count.writeUInt32LE(1, 0);

  const triangle = Buffer.alloc(50);
  // facet normal
  triangle.writeFloatLE(0, 0);
  triangle.writeFloatLE(0, 4);
  triangle.writeFloatLE(1, 8);
  // vertices
  const verts = [0, 0, 0, 1, 0, 0, 0, 1, 0];
  verts.forEach((v, i) => triangle.writeFloatLE(v, 12 + i * 4));
  // attribute byte count
  triangle.writeUInt16LE(0, 48);

  return Buffer.concat([header, count, triangle]);
}

async function main() {
  console.log('Testing production upload/thumbnail paths...');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'slag3d-prodpaths-'));
  const distDir = path.join(tmp, 'dist');
  fs.mkdirSync(distDir, { recursive: true });
  fs.mkdirSync(path.join(tmp, 'data'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'uploads', 'models'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'uploads', 'thumbnails'), { recursive: true });

  // The bundle keeps dependencies external, so node_modules must be resolvable
  fs.symlinkSync(path.join(REPO_ROOT, 'node_modules'), path.join(tmp, 'node_modules'));

  // Build the production server bundle exactly like `npm run build:server`
  execFileSync(
    'npx',
    ['esbuild', 'server.ts', '--bundle', '--platform=node', '--target=node22', '--format=esm', '--packages=external', `--outfile=${path.join(distDir, 'server.js')}`],
    { cwd: REPO_ROOT, stdio: 'ignore' }
  );

  // The SPA shell is required to prove that missing uploads are no longer
  // answered with index.html.
  fs.copyFileSync(path.join(REPO_ROOT, 'dist', 'index.html'), path.join(distDir, 'index.html'));

  fs.writeFileSync(
    path.join(tmp, '.env'),
    [
      'JWT_SECRET=012345678901234567890123456789012345678901234567890123456789',
      'SESSION_SECRET=012345678901234567890123456789012345678901234567890123456789',
      'REFRESH_TOKEN_SECRET=012345678901234567890123456789012345678901234567890123456789',
      'ADMIN_USER=admin',
      'ADMIN_PASSWORD=TestAdminPass123',
      'GOOSE_SEED_DB=true',
      `DB_PATH=${path.join(tmp, 'data', 'vault.db')}`,
      `UPLOADS_DIR=${path.join(tmp, 'uploads')}`,
      ''
    ].join('\n')
  );

  const server = spawn('node', ['dist/server.js'], {
    cwd: tmp,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(PORT),
      DB_PATH: path.join(tmp, 'data', 'vault.db'),
      UPLOADS_DIR: path.join(tmp, 'uploads')
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let serverLog = '';
  server.stdout.on('data', (d) => (serverLog += d.toString()));
  server.stderr.on('data', (d) => (serverLog += d.toString()));

  const cleanup = () => {
    try { server.kill('SIGKILL'); } catch {}
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  };
  process.on('exit', cleanup);

  try {
    // Wait for the API
    let ready = false;
    for (let i = 0; i < 60; i++) {
      try {
        const res = await fetch(`${BASE}/api/health`);
        if (res.ok) { ready = true; break; }
      } catch {}
      await sleep(500);
    }
    assert(ready, `Server did not start:\n${serverLog}`);

    // Login
    const loginRes = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'TestAdminPass123' })
    });
    assert(loginRes.status === 200, `Login failed with ${loginRes.status}`);
    const login = (await loginRes.json()) as any;
    assert(Boolean(login.accessToken), 'Login did not return an access token');
    assert(Boolean(login.csrfToken), 'Login did not return a CSRF token');

    const authHeaders: Record<string, string> = {
      Authorization: `Bearer ${login.accessToken}`,
      'x-csrf-token': login.csrfToken,
      Cookie: `slag3d_csrf_token=${login.csrfToken}`
    };

    // Upload a model
    const stl = buildTestStl();
    const form = new FormData();
    form.append('title', 'Production Path Test');
    form.append('files', new Blob([new Uint8Array(stl)]), 'cube.stl');

    const uploadRes = await fetch(`${BASE}/api/models`, {
      method: 'POST',
      headers: authHeaders,
      body: form
    });
    const uploadBody = await uploadRes.text();
    assert(uploadRes.status === 201, `Upload failed with ${uploadRes.status}: ${uploadBody}`);
    const uploaded = JSON.parse(uploadBody) as any;
    const modelId = uploaded.model.id;
    const file = uploaded.files.find((f: any) => f.is_primary_3d === 1) || uploaded.files[0];
    assert(Boolean(modelId && file?.file_path), 'Upload response did not contain a model id and file path');

    // The file must live in the configured uploads directory
    const onDisk = path.join(tmp, 'uploads', file.file_path.replace(/^\/uploads\//, ''));
    assert(fs.existsSync(onDisk), `Uploaded file not found at ${onDisk}`);
    console.log('  ✓ Upload written to the configured uploads directory');

    // ...and it must be served as the uploaded binary, not as the SPA shell
    const fileRes = await fetch(`${BASE}${file.file_path}`, {
      headers: { Authorization: `Bearer ${login.accessToken}` }
    });
    assert(fileRes.status === 200, `GET ${file.file_path} returned ${fileRes.status}`);
    const contentType = fileRes.headers.get('content-type') || '';
    assert(!contentType.includes('text/html'), `Model file served as HTML (${contentType})`);
    const served = Buffer.from(await fileRes.arrayBuffer());
    assert(served.equals(stl), 'Served model file does not match the uploaded bytes');
    console.log('  ✓ Model file served with the original binary content');

    // Thumbnails must be written to and served from the same directory
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    );
    const thumbRes = await fetch(`${BASE}/api/models/${modelId}/thumbnail-client`, {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64: `data:image/png;base64,${png.toString('base64')}` })
    });
    assert(thumbRes.status === 200, `Client thumbnail upload failed with ${thumbRes.status}`);

    const thumbOnDisk = path.join(tmp, 'uploads', 'thumbnails', `${modelId}.png`);
    assert(fs.existsSync(thumbOnDisk), `Thumbnail not found at ${thumbOnDisk}`);
    console.log('  ✓ Thumbnail written to the configured thumbnails directory');

    const thumbGet = await fetch(`${BASE}/uploads/thumbnails/${modelId}.png`);
    assert(thumbGet.status === 200, `GET thumbnail returned ${thumbGet.status}`);
    const thumbType = thumbGet.headers.get('content-type') || '';
    assert(thumbType.includes('image/png'), `Thumbnail served as ${thumbType}`);
    const servedThumb = Buffer.from(await thumbGet.arrayBuffer());
    assert(servedThumb.equals(png), 'Served thumbnail does not match the uploaded bytes');
    console.log('  ✓ Thumbnail served as PNG');

    // A missing upload must return JSON 404, never the SPA shell
    const missing = await fetch(`${BASE}/uploads/thumbnails/does-not-exist.png`);
    assert(missing.status === 404, `Missing upload returned ${missing.status}, expected 404`);
    const missingType = missing.headers.get('content-type') || '';
    assert(!missingType.includes('text/html'), `Missing upload answered with HTML (${missingType})`);
    console.log('  ✓ Missing uploads return a JSON 404 instead of index.html');

    console.log('All production path tests passed successfully!');
    cleanup();
    process.exit(0);
  } catch (err: any) {
    console.error('FAIL:', err?.message || err);
    console.error('--- server log ---');
    console.error(serverLog);
    cleanup();
    process.exit(1);
  }
}

main();
