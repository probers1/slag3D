import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'node:zlib';
import {
  extractZipArchive,
  modelExtensionOf,
  safeStoredFilename,
} from '../server/lib/uploadSecurity.ts';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error('FAIL:', message);
    process.exit(1);
  }
}

/**
 * Build a minimal ZIP archive (stored / uncompressed entries) so the test
 * does not depend on an external `zip` binary being installed.
 */
function buildZip(entries: Array<{ name: string; content: string }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const dataBuf = Buffer.from(entry.content, 'utf8');
    const crc = zlib.crc32(dataBuf) >>> 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4); // version needed to extract
    local.writeUInt16LE(0, 6); // general purpose flags
    local.writeUInt16LE(0, 8); // compression method: store
    local.writeUInt16LE(0, 10); // last mod time
    local.writeUInt16LE(0, 12); // last mod date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(dataBuf.length, 18); // compressed size
    local.writeUInt32LE(dataBuf.length, 22); // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra field length
    locals.push(local, nameBuf, dataBuf);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // central directory header signature
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed to extract
    central.writeUInt16LE(0, 8); // general purpose flags
    central.writeUInt16LE(0, 10); // compression method: store
    central.writeUInt16LE(0, 12); // last mod time
    central.writeUInt16LE(0, 14); // last mod date
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(dataBuf.length, 20); // compressed size
    central.writeUInt32LE(dataBuf.length, 24); // uncompressed size
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30); // extra field length
    central.writeUInt16LE(0, 32); // file comment length
    central.writeUInt16LE(0, 34); // disk number start
    central.writeUInt16LE(0, 36); // internal file attributes
    central.writeUInt32LE(0, 38); // external file attributes
    central.writeUInt32LE(offset, 42); // relative offset of local header
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + dataBuf.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // end of central directory signature
  end.writeUInt16LE(0, 4); // number of this disk
  end.writeUInt16LE(0, 6); // disk with the start of the central directory
  end.writeUInt16LE(entries.length, 8); // entries in the central dir on this disk
  end.writeUInt16LE(entries.length, 10); // total entries
  end.writeUInt32LE(centralBuf.length, 12); // size of the central directory
  end.writeUInt32LE(offset, 16); // offset of the central directory
  end.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...locals, centralBuf, end]);
}

console.log('Testing upload security (stored XSS via archive upload)...');

// ---------------------------------------------------------------------------
// 1. Only 3D model payloads may be written into the (browser served) uploads
//    directory. Everything else has to be rejected.
// ---------------------------------------------------------------------------
for (const bad of [
  'evil.html',
  'evil.htm',
  'evil.svg',
  'evil.xhtml',
  'payload.js',
  'run.exe',
  'notes.txt',
  'data.xml',
  'archive.zip',
  'noextension',
]) {
  assert(modelExtensionOf(bad) === null, `"${bad}" must not be allowed into the uploads directory`);
}

for (const good of ['cube.stl', 'cube.STL', 'part.3mf', 'part.obj']) {
  assert(modelExtensionOf(good) !== null, `"${good}" must be allowed into the uploads directory`);
}

// ---------------------------------------------------------------------------
// 2. The client controlled filename must never escape the uploads directory.
// ---------------------------------------------------------------------------
const traversalName = safeStoredFilename('../../../etc/passwd', '.stl');
assert(!traversalName.includes('/'), 'Stored filename must not contain path separators');
assert(!traversalName.includes('\\'), 'Stored filename must not contain Windows separators');
assert(!traversalName.includes('..'), 'Stored filename must not contain traversal sequences');
assert(traversalName.endsWith('.stl'), 'Stored filename must keep the validated extension');

const windowsName = safeStoredFilename('..\\..\\evil.html', '.html');
assert(!windowsName.includes('\\'), 'Windows separators must be stripped from the stored filename');
assert(!windowsName.includes('/'), 'Path separators must be stripped from the stored filename');

const nestedName = safeStoredFilename('a/../../b.stl', '.stl');
assert(!nestedName.includes('/'), 'Nested paths must be stripped from the stored filename');
assert(nestedName.endsWith('.stl'), 'Stored filename must keep the validated extension');

// ---------------------------------------------------------------------------
// 3. End-to-end: a ZIP containing active content must not plant that content
//    in the uploads directory (this was the stored XSS vector).
// ---------------------------------------------------------------------------
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'slag3d-upload-security-'));
const modelDir = path.join(tmpRoot, 'model');
fs.mkdirSync(modelDir, { recursive: true });

try {
  const zipPath = path.join(tmpRoot, 'payload.zip');
  fs.writeFileSync(
    zipPath,
    buildZip([
      { name: 'evil.html', content: '<html><script>alert(document.domain)</script></html>' },
      { name: 'payload.js', content: 'alert(document.cookie)' },
      { name: 'notes.txt', content: 'just a note' },
      { name: 'nested/evil2.svg', content: '<svg onload="alert(1)"></svg>' },
      { name: '__MACOSX/._cube.stl', content: 'resource fork' },
      { name: 'cube.stl', content: 'solid cube\nendsolid cube\n' },
    ])
  );

  const extracted = await extractZipArchive(zipPath, 'model-id', modelDir);

  assert(extracted.length === 1, `Only the .stl entry may be extracted (got ${extracted.length})`);
  assert(extracted[0].original_name === 'cube.stl', 'The .stl entry must be the extracted one');
  assert(extracted[0].mime_type === 'model/stl', 'Extracted file must carry the model/stl mime type');
  assert(extracted[0].file_path.startsWith('/uploads/models/model-id/'), 'Extracted file must live under /uploads/models/<id>/');

  const onDisk = fs.readdirSync(modelDir);
  assert(onDisk.length === 1, `Exactly one file may be written to the uploads directory (got ${onDisk.length})`);
  assert(onDisk[0].endsWith('.stl'), 'The written file must have an allowlisted extension');
  assert(
    !onDisk.some((f) => /\.(html?|svg|js|txt|xml|xhtml)$/i.test(f)),
    'No active content may be written into the uploads directory'
  );
  assert(!fs.existsSync(zipPath), 'The temporary archive must be removed after extraction');

  // -------------------------------------------------------------------------
  // 4. An archive without any 3D model file yields nothing (the route turns
  //    this into a 400 instead of creating an empty model).
  // -------------------------------------------------------------------------
  const htmlOnlyZip = path.join(tmpRoot, 'html-only.zip');
  fs.writeFileSync(
    htmlOnlyZip,
    buildZip([{ name: 'evil.html', content: '<script>alert(1)</script>' }])
  );

  const htmlOnly = await extractZipArchive(htmlOnlyZip, 'model-id-2', modelDir);
  assert(htmlOnly.length === 0, 'An archive without model files must yield no extracted files');
  assert(fs.readdirSync(modelDir).length === 1, 'No additional file may be written for an archive without models');
} finally {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}

console.log('All upload security tests passed.');
