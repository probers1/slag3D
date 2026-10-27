import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { apiFetch } from './api';

// Cache of model IDs currently being processed client-side to prevent duplicates
const renderingQueue = new Set<string>();

export async function renderThumbnailInBrowser(
  modelId: string,
  filePath: string,
  onComplete?: (thumbnailPath: string) => void
): Promise<boolean> {
  if (renderingQueue.has(modelId)) return false;
  renderingQueue.add(modelId);

  try {
    const ext = filePath.split('.').pop()?.toLowerCase() || 'stl';

    // Create offscreen canvas (512x512)
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;

    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });
    renderer.setSize(512, 512);
    renderer.setPixelRatio(1);
    renderer.setClearColor(0x121214, 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x121214);

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 4000);

    // Studio 3-point lighting
    scene.add(new THREE.AmbientLight(0xffffff, 0.65));
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.1);
    keyLight.position.set(1, 2, 1.5).normalize();
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0x8899bb, 0.35);
    fillLight.position.set(-1, -0.5, -1).normalize();
    scene.add(fillLight);

    const material = new THREE.MeshStandardMaterial({
      color: 0x3b82f6,
      roughness: 0.35,
      metalness: 0.25,
    });

    const fitAndRender = async (object: THREE.Object3D) => {
      scene.add(object);

      const box = new THREE.Box3().setFromObject(object);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());

      object.position.x += -center.x;
      object.position.y += -center.y;
      object.position.z += -center.z;

      const maxDim = Math.max(size.x, size.y, size.z) || 10;
      const fov = 45 * (Math.PI / 180);
      const cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2)) * 1.35;

      camera.position.set(cameraZ * 0.75, cameraZ * 0.55, cameraZ * 0.85);
      camera.lookAt(0, 0, 0);

      renderer.render(scene, camera);

      const dataUrl = canvas.toDataURL('image/png');

      // Upload rendered thumbnail to server
      const res = await apiFetch(`/api/models/${modelId}/thumbnail-client`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: dataUrl }),
      });

      if (res.ok) {
        const data = await res.json();
        if (onComplete && data.thumbnail_path) {
          onComplete(data.thumbnail_path);
        }
      }

      // Cleanup
      renderer.dispose();
      material.dispose();
    };

    if (ext === 'stl') {
      const loader = new STLLoader();
      const geometry = await loader.loadAsync(filePath);
      geometry.computeVertexNormals();
      const mesh = new THREE.Mesh(geometry, material);
      await fitAndRender(mesh);
      geometry.dispose();
    } else if (ext === 'obj') {
      const loader = new OBJLoader();
      const obj = await loader.loadAsync(filePath);
      obj.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          (child as THREE.Mesh).material = material;
        }
      });
      await fitAndRender(obj);
    } else {
      const geom = new THREE.DodecahedronGeometry(20, 0);
      const mesh = new THREE.Mesh(geom, material);
      await fitAndRender(mesh);
      geom.dispose();
    }

    return true;
  } catch (err) {
    console.warn(`[SLAG3D Fallback] Client render error for model ${modelId}:`, err);
    return false;
  } finally {
    renderingQueue.delete(modelId);
  }
}
