import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import {
  X,
  Camera,
  Heart,
  Download,
  FolderPlus,
  RefreshCw,
  Box,
  Scale,
  Check,
  FileCode,
  Edit2,
  Trash2,
  Eye,
  Star,
} from 'lucide-react';
import { ModelFile, CollectionItem } from '../types';
import { apiFetch } from '../utils/api';

interface ModelDetail {
  id: string;
  user_id: string;
  title: string;
  description: string;
  thumbnail_path: string | null;
  thumbnail_status: 'pending' | 'processing' | 'completed' | 'failed';
  created_at: string;
  updated_at: string;
  owner_username: string;
  is_favorited: boolean;
  tags: string[];
  files: ModelFile[];
  collections: { id: string; name: string }[];
}

interface ModelViewerModalProps {
  modelId: string;
  collections: CollectionItem[];
  currentUserId?: string;
  isAdmin?: boolean;
  onClose: () => void;
  onModelUpdated: () => void;
}

export const ModelViewerModal: React.FC<ModelViewerModalProps> = ({
  modelId,
  collections,
  currentUserId,
  isAdmin,
  onClose,
  onModelUpdated,
}) => {
  const mountRef = useRef<HTMLDivElement>(null);

  // Model data state
  const [model, setModel] = useState<ModelDetail | null>(null);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMesh, setLoadingMesh] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveToast, setSaveToast] = useState<string | null>(null);

  // 3D Canvas states
  const [wireframe, setWireframe] = useState(false);
  const [isCapturingThumb, setIsCapturingThumb] = useState(false);
  const [meshStats, setMeshStats] = useState<{
    widthMm: number;
    depthMm: number;
    heightMm: number;
    volumeCm3: number;
    weightGrams: number;
    costUsd: number;
  }>({
    widthMm: 0,
    depthMm: 0,
    heightMm: 0,
    volumeCm3: 0,
    weightGrams: 0,
    costUsd: 0,
  });

  const [filamentPriceKg, setFilamentPriceKg] = useState<number>(20.0); // $20/kg default

  // Editing states
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editTags, setEditTags] = useState('');
  const [selectedCollectionToAdd, setSelectedCollectionToAdd] = useState('');

  // Three.js internal references
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const activeMeshRef = useRef<THREE.Object3D | null>(null);

  // Fetch model details
  const fetchModel = async () => {
    try {
      setLoading(true);
      const res = await apiFetch(`/api/models/${modelId}`);
      if (!res.ok) throw new Error('Failed to load model details');
      const data = await res.json();
      setModel(data.model);
      setEditTitle(data.model.title);
      setEditDesc(data.model.description || '');
      setEditTags(data.model.tags ? data.model.tags.join(', ') : '');

      // Select primary file or first file if not yet selected
      if (data.model.files && data.model.files.length > 0) {
        setSelectedFileId((prev) => {
          if (prev && data.model.files.some((f: ModelFile) => f.id === prev)) {
            return prev;
          }
          const primary = data.model.files.find((f: ModelFile) => f.is_primary_3d === 1) || data.model.files[0];
          return primary ? primary.id : null;
        });
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchModel();
  }, [modelId]);

  // Recalculate cost when filament price or weight changes
  useEffect(() => {
    if (meshStats.weightGrams > 0) {
      const cost = (meshStats.weightGrams / 1000) * filamentPriceKg;
      setMeshStats((prev) => ({ ...prev, costUsd: Number(cost.toFixed(2)) }));
    }
  }, [filamentPriceKg, meshStats.weightGrams]);

  // Initialize Three.js scene once on mount
  useEffect(() => {
    if (!mountRef.current) return;

    const width = mountRef.current.clientWidth || 600;
    const height = mountRef.current.clientHeight || 450;

    // 1. Scene & Renderer setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x121214);
    sceneRef.current = scene;

    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    rendererRef.current = renderer;

    mountRef.current.innerHTML = '';
    mountRef.current.appendChild(renderer.domElement);

    // 2. Camera setup (fov: 45)
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 5000);
    cameraRef.current = camera;

    // 3. OrbitControls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controlsRef.current = controls;

    // 4. Lighting Rig
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.1);
    keyLight.position.set(1, 2, 1.5).normalize();
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0x8899bb, 0.4);
    fillLight.position.set(-1, -0.5, -1).normalize();
    scene.add(fillLight);

    // Grid Floor
    const grid = new THREE.GridHelper(200, 20, 0x333344, 0x1c1c24);
    grid.position.y = -0.01;
    scene.add(grid);

    // Animation Loop
    let animId: number;
    const animate = () => {
      animId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      if (!mountRef.current || !cameraRef.current || !rendererRef.current) return;
      const newW = mountRef.current.clientWidth;
      const newH = mountRef.current.clientHeight;
      cameraRef.current.aspect = newW / newH;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(newW, newH);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
      if (mountRef.current) {
        mountRef.current.innerHTML = '';
      }
    };
  }, []);

  // Helper: calculate signed watertight volume of a buffer geometry
  const calculateMeshVolume = (geometry: THREE.BufferGeometry): number => {
    let position: THREE.BufferAttribute;
    if (geometry.index) {
      const nonIndexed = geometry.toNonIndexed();
      position = nonIndexed.attributes.position as THREE.BufferAttribute;
    } else {
      position = geometry.attributes.position as THREE.BufferAttribute;
    }

    if (!position) return 0;

    let totalVolume = 0;
    const p1 = new THREE.Vector3();
    const p2 = new THREE.Vector3();
    const p3 = new THREE.Vector3();

    for (let i = 0; i < position.count; i += 3) {
      p1.fromBufferAttribute(position, i);
      p2.fromBufferAttribute(position, i + 1);
      p3.fromBufferAttribute(position, i + 2);
      totalVolume += p1.dot(p2.clone().cross(p3)) / 6.0;
    }

    return Math.abs(totalVolume); // in mm³
  };

  // Load active 3D file into the Three.js scene
  const loadActiveMesh = useCallback((activeFile: ModelFile) => {
    if (!sceneRef.current || !cameraRef.current || !controlsRef.current) return;

    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;

    setLoadingMesh(true);

    // Clean up existing mesh
    if (activeMeshRef.current) {
      scene.remove(activeMeshRef.current);
      activeMeshRef.current.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          (child as THREE.Mesh).geometry?.dispose();
        }
      });
      activeMeshRef.current = null;
    }

    const material = new THREE.MeshStandardMaterial({
      color: 0x3b82f6,
      roughness: 0.35,
      metalness: 0.25,
      wireframe,
    });

    const attachAndPosition = (object: THREE.Object3D, geom?: THREE.BufferGeometry) => {
      scene.add(object);
      activeMeshRef.current = object;

      const box = new THREE.Box3().setFromObject(object);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());

      object.position.x += -center.x;
      object.position.y += -center.y + size.y / 2; // Sit flush on grid
      object.position.z += -center.z;

      const maxDim = Math.max(size.x, size.y, size.z) || 50;
      const fov = 45 * (Math.PI / 180);
      const cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2)) * 1.5;

      camera.position.set(cameraZ * 0.7, cameraZ * 0.5, cameraZ * 0.7);
      camera.lookAt(0, size.y / 4, 0);
      controls.target.set(0, size.y / 4, 0);
      controls.update();

      // Compute slicing analytics
      let volumeMm3 = 0;
      if (geom) {
        volumeMm3 = calculateMeshVolume(geom);
      } else {
        object.traverse((child) => {
          if ((child as THREE.Mesh).isMesh && (child as THREE.Mesh).geometry) {
            volumeMm3 += calculateMeshVolume((child as THREE.Mesh).geometry);
          }
        });
      }

      const volumeCm3 = volumeMm3 / 1000.0;
      // Standard PLA density = 1.24 g/cm3; assuming effective infill/walls (~45% of solid volume)
      const weightGrams = volumeCm3 * 1.24 * 0.45;
      const costUsd = (weightGrams / 1000) * filamentPriceKg;

      setMeshStats({
        widthMm: Number(size.x.toFixed(1)),
        depthMm: Number(size.z.toFixed(1)),
        heightMm: Number(size.y.toFixed(1)),
        volumeCm3: Number(volumeCm3.toFixed(2)),
        weightGrams: Number(weightGrams.toFixed(1)),
        costUsd: Number(costUsd.toFixed(2)),
      });

      setLoadingMesh(false);
    };

    const ext = activeFile.original_name.split('.').pop()?.toLowerCase();

    if (ext === 'stl') {
      const loader = new STLLoader();
      loader.load(
        activeFile.file_path,
        (geometry) => {
          geometry.computeVertexNormals();
          const mesh = new THREE.Mesh(geometry, material);
          attachAndPosition(mesh, geometry);
        },
        undefined,
        (err) => {
          console.error('STL loading error:', err);
          setLoadingMesh(false);
        }
      );
    } else if (ext === 'obj') {
      const loader = new OBJLoader();
      loader.load(
        activeFile.file_path,
        (obj) => {
          obj.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) {
              (child as THREE.Mesh).material = material;
            }
          });
          attachAndPosition(obj);
        },
        undefined,
        (err) => {
          console.error('OBJ loading error:', err);
          setLoadingMesh(false);
        }
      );
    } else {
      // 3MF or placeholder geometry
      const geom = new THREE.DodecahedronGeometry(25, 0);
      const mesh = new THREE.Mesh(geom, material);
      attachAndPosition(mesh, geom);
    }
  }, [filamentPriceKg, wireframe]);

  // When model or selectedFileId changes, load that file into the Three.js scene
  useEffect(() => {
    if (!model || !model.files || model.files.length === 0) return;
    const activeFile = model.files.find((f) => f.id === selectedFileId) || model.files[0];
    if (activeFile) {
      loadActiveMesh(activeFile);
    }
  }, [model, selectedFileId, loadActiveMesh]);

  // Toggle wireframe mode
  const toggleWireframe = () => {
    setWireframe((prev) => {
      const next = !prev;
      if (activeMeshRef.current) {
        activeMeshRef.current.traverse((child) => {
          if ((child as THREE.Mesh).isMesh && (child as THREE.Mesh).material) {
            const mat = (child as THREE.Mesh).material as THREE.MeshStandardMaterial;
            mat.wireframe = next;
          }
        });
      }
      return next;
    });
  };

  // Reset Camera View
  const resetCamera = () => {
    if (!controlsRef.current || !activeMeshRef.current || !cameraRef.current) return;
    const box = new THREE.Box3().setFromObject(activeMeshRef.current);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 50;
    const fov = 45 * (Math.PI / 180);
    const cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2)) * 1.5;

    cameraRef.current.position.set(cameraZ * 0.7, cameraZ * 0.5, cameraZ * 0.7);
    cameraRef.current.lookAt(0, size.y / 4, 0);
    controlsRef.current.target.set(0, size.y / 4, 0);
    controlsRef.current.update();
  };

  // "Save as Thumbnail" custom angle snapshot capture
  const handleSaveThumbnail = async () => {
    if (!rendererRef.current || !sceneRef.current || !cameraRef.current || !model) return;

    setIsCapturingThumb(true);
    setSaveToast(null);

    try {
      // Render clean frame right before capturing canvas
      rendererRef.current.render(sceneRef.current, cameraRef.current);
      const dataUrl = rendererRef.current.domElement.toDataURL('image/png');

      const res = await apiFetch(`/api/models/${model.id}/thumbnail-client`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: dataUrl }),
      });

      if (!res.ok) throw new Error('Failed to save thumbnail');

      setSaveToast('Custom thumbnail angle saved successfully!');
      onModelUpdated();
      setTimeout(() => setSaveToast(null), 3000);
    } catch (err: any) {
      alert(err.message || 'Error saving thumbnail snapshot');
    } finally {
      setIsCapturingThumb(false);
    }
  };

  // Favorite toggle
  const handleToggleFavorite = async () => {
    if (!model) return;
    try {
      const res = await apiFetch(`/api/models/${model.id}/favorite`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setModel((prev) => (prev ? { ...prev, is_favorited: data.is_favorited } : null));
        onModelUpdated();
      }
    } catch (err) {
      console.error('Favorite error:', err);
    }
  };

  // Add to Collection
  const handleAddToCollection = async () => {
    if (!model || !selectedCollectionToAdd) return;
    try {
      const res = await apiFetch(`/api/collections/${selectedCollectionToAdd}/models`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model_id: model.id }),
      });

      if (res.ok) {
        setSaveToast('Model added to collection');
        fetchModel();
        onModelUpdated();
        setTimeout(() => setSaveToast(null), 2500);
      }
    } catch (err: any) {
      alert(err.message);
    }
  };

  // Set as primary 3D file
  const handleSetPrimaryFile = async (fileId: string) => {
    if (!model) return;
    try {
      const res = await apiFetch(`/api/models/${model.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ primary_file_id: fileId }),
      });

      if (res.ok) {
        fetchModel();
        onModelUpdated();
      }
    } catch (err: any) {
      alert(err.message);
    }
  };

  // Save metadata edit
  const handleSaveMetadata = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!model) return;
    try {
      const res = await apiFetch(`/api/models/${model.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: editTitle,
          description: editDesc,
          tags: editTags,
        }),
      });

      if (res.ok) {
        setIsEditing(false);
        setSaveToast('Model details updated');
        fetchModel();
        onModelUpdated();
        setTimeout(() => setSaveToast(null), 2500);
      }
    } catch (err: any) {
      alert(err.message);
    }
  };

  // Delete model
  const handleDeleteModel = async () => {
    if (!model) return;
    if (!confirm(`Permanently delete "${model.title}" and all its 3D files from disk?`)) return;

    try {
      const res = await apiFetch(`/api/models/${model.id}`, { method: 'DELETE' });
      if (res.ok) {
        onModelUpdated();
        onClose();
      }
    } catch (err: any) {
      alert(err.message);
    }
  };

  const isOwnerOrAdmin = model && (model.user_id === currentUserId || isAdmin);
  const currentActiveFile = model?.files.find((f) => f.id === selectedFileId) || model?.files[0];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/85 backdrop-blur-md">
      <div className="bg-[#16161b] border border-[#2b2b36] rounded-2xl w-full max-w-6xl max-h-[95vh] overflow-hidden flex flex-col shadow-2xl">
        {/* Modal Top Header */}
        <div className="flex items-center justify-between px-6 py-3.5 border-b border-[#252530] bg-[#1a1a22]">
          <div className="flex items-center gap-3 truncate">
            <div className="w-8 h-8 rounded-lg bg-blue-600/20 text-blue-400 flex items-center justify-center shrink-0">
              <Box className="w-4 h-4" />
            </div>
            <div className="truncate">
              <h2 className="text-base font-bold text-white truncate font-['Plus_Jakarta_Sans',sans-serif]">
                {model?.title || 'Loading Model...'}
              </h2>
              <div className="flex items-center gap-2 text-xs text-neutral-400">
                <span>by {model?.owner_username}</span>
                <span aria-hidden="true">·</span>
                <span>
                  {model?.files.length} {model?.files.length === 1 ? 'file' : 'files'}
                </span>
                {currentActiveFile && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="text-blue-400 font-mono truncate">
                      Viewing: {currentActiveFile.original_name}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {model && (
              <button
                onClick={handleToggleFavorite}
                className={`p-2 rounded-lg border transition-all ${
                  model.is_favorited
                    ? 'bg-red-500/20 text-red-400 border-red-500/40 hover:bg-red-500/30'
                    : 'bg-[#22222a] text-neutral-400 border-[#30303c] hover:text-white'
                }`}
                title={model.is_favorited ? 'Favorited' : 'Favorite'}
              >
                <Heart className={`w-4 h-4 ${model.is_favorited ? 'fill-current text-red-500' : ''}`} />
              </button>
            )}

            <button
              onClick={onClose}
              className="p-2 text-neutral-400 hover:text-white rounded-lg hover:bg-white/5 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Body: 2 Columns (3D Viewport on Left, Specs & Files on Right) */}
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 overflow-y-auto">
          {/* Left Column: 3D Viewport Stage */}
          <div className="lg:col-span-7 bg-[#121214] flex flex-col relative border-b lg:border-b-0 lg:border-r border-[#252530] min-h-[400px] lg:min-h-[560px]">
            {/* Viewport Canvas Container */}
            <div ref={mountRef} className="w-full h-full flex-1 cursor-grab active:cursor-grabbing" />

            {/* Active File Switcher Overlay (Top-Left of 3D Viewport) */}
            {model && model.files.length > 1 && (
              <div className="absolute top-4 left-4 z-20 flex items-center gap-2 px-3 py-1.5 bg-[#181822]/90 backdrop-blur-md border border-[#2e2e40] rounded-xl text-xs shadow-xl">
                <span className="text-[11px] font-semibold text-neutral-400 flex items-center gap-1.5 shrink-0">
                  <Box className="w-3.5 h-3.5 text-blue-400" />
                  Viewing:
                </span>
                <select
                  value={currentActiveFile?.id || ''}
                  onChange={(e) => setSelectedFileId(e.target.value)}
                  className="bg-[#121216] border border-[#35354a] rounded-lg px-2.5 py-1 text-white text-xs outline-none focus:border-blue-500 font-medium max-w-[210px] truncate"
                >
                  {model.files.map((file, idx) => (
                    <option key={file.id} value={file.id}>
                      {idx + 1}. {file.original_name} {file.is_primary_3d === 1 ? '★ [Primary]' : ''}
                    </option>
                  ))}
                </select>
                <span className="text-[10px] text-neutral-500 font-mono shrink-0">
                  {(model.files.findIndex((f) => f.id === currentActiveFile?.id) + 1)}/{model.files.length}
                </span>
              </div>
            )}

            {/* Loading Indicator for mesh swap */}
            {loadingMesh && (
              <div className="absolute top-4 right-4 z-20 px-3 py-1.5 bg-[#181822]/90 backdrop-blur-md border border-[#2e2e40] rounded-xl text-xs text-blue-400 flex items-center gap-2 shadow-lg">
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Loading 3D asset...</span>
              </div>
            )}

            {/* Viewport Control Overlay (Bottom Dock) */}
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 px-3 py-2 bg-[#1b1b24]/90 backdrop-blur-md border border-[#2e2e3d] rounded-xl shadow-xl text-xs z-10">
              <button
                onClick={toggleWireframe}
                className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
                  wireframe ? 'bg-blue-600 text-white' : 'text-neutral-300 hover:bg-[#282834]'
                }`}
              >
                {wireframe ? 'Wireframe: ON' : 'Solid Mesh'}
              </button>

              <button
                onClick={resetCamera}
                className="px-3 py-1.5 text-neutral-300 hover:bg-[#282834] rounded-lg font-medium transition-colors"
              >
                Reset Camera
              </button>

              <div className="h-4 w-px bg-[#303040]" />

              <button
                onClick={handleSaveThumbnail}
                disabled={isCapturingThumb}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-lg shadow-sm transition-all"
                title="Capture this camera angle as the model's 512x512 thumbnail"
              >
                <Camera className="w-3.5 h-3.5" />
                <span>{isCapturingThumb ? 'Saving Angle...' : 'Save as Thumbnail'}</span>
              </button>
            </div>

            {saveToast && (
              <div className="absolute top-16 left-1/2 -translate-x-1/2 px-4 py-2 bg-emerald-950/90 border border-emerald-700/60 text-emerald-200 rounded-xl text-xs font-semibold shadow-xl flex items-center gap-2 z-30">
                <Check className="w-4 h-4 text-emerald-400" />
                <span>{saveToast}</span>
              </div>
            )}
          </div>

          {/* Right Column: Slicing Mesh Analytics & Asset Management */}
          <div className="lg:col-span-5 p-6 flex flex-col gap-6 overflow-y-auto bg-[#18181f]">
            {/* Slicing Mesh Analytics Panel for Currently Displayed File */}
            <div className="bg-[#1f1f28] border border-[#2e2e3c] rounded-xl p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-white flex items-center gap-2">
                  <Scale className="w-4 h-4 text-blue-400" />
                  Slicing & Mesh Analytics
                </h3>
                <span className="text-[10px] text-neutral-400 font-mono">PLA @ 1.24 g/cm³</span>
              </div>

              {currentActiveFile && (
                <div className="text-[11px] text-blue-300 bg-blue-950/40 border border-blue-900/50 rounded-lg px-2.5 py-1 flex items-center gap-1.5 truncate">
                  <Box className="w-3 h-3 text-blue-400 shrink-0" />
                  <span className="truncate">Analyzing: <strong>{currentActiveFile.original_name}</strong></span>
                </div>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                {/* Bounding Box Dimensions */}
                <div className="p-2.5 bg-[#141418] rounded-lg border border-[#2a2a35] flex flex-col">
                  <span className="text-[10px] text-neutral-400">Dimensions (XYZ)</span>
                  <span className="font-mono font-bold text-white mt-1 tabular-nums">
                    {meshStats.widthMm} × {meshStats.depthMm} × {meshStats.heightMm}{' '}
                    <span className="text-[10px] font-normal text-neutral-400">mm</span>
                  </span>
                </div>

                {/* Mesh Volume */}
                <div className="p-2.5 bg-[#141418] rounded-lg border border-[#2a2a35] flex flex-col">
                  <span className="text-[10px] text-neutral-400">Watertight Volume</span>
                  <span className="font-mono font-bold text-white mt-1 tabular-nums">
                    {meshStats.volumeCm3}{' '}
                    <span className="text-[10px] font-normal text-neutral-400">cm³</span>
                  </span>
                </div>

                {/* Estimated Weight */}
                <div className="p-2.5 bg-[#141418] rounded-lg border border-[#2a2a35] flex flex-col">
                  <span className="text-[10px] text-neutral-400">Est. PLA Weight</span>
                  <span className="font-mono font-bold text-emerald-400 mt-1 tabular-nums">
                    ~{meshStats.weightGrams}{' '}
                    <span className="text-[10px] font-normal text-neutral-400">g</span>
                  </span>
                </div>

                {/* Filament Cost Estimate */}
                <div className="col-span-2 sm:col-span-3 p-2.5 bg-[#141418] rounded-lg border border-[#2a2a35] flex items-center justify-between">
                  <div>
                    <span className="text-[10px] text-neutral-400 block">Estimated Filament Cost</span>
                    <span className="font-mono font-bold text-amber-400 text-sm mt-0.5 tabular-nums">
                      ${meshStats.costUsd.toFixed(2)}{' '}
                      <span className="text-[10px] font-normal text-neutral-400">USD</span>
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 text-xs">
                    <span className="text-[10px] text-neutral-500">Rate:</span>
                    <div className="flex items-center bg-[#202028] border border-[#353545] rounded px-1.5 py-0.5">
                      <span className="text-neutral-400 text-xs">$</span>
                      <input
                        type="number"
                        min="1"
                        max="200"
                        step="1"
                        value={filamentPriceKg}
                        onChange={(e) => setFilamentPriceKg(Number(e.target.value))}
                        className="w-10 bg-transparent text-white text-xs font-mono outline-none text-right pl-0.5"
                      />
                      <span className="text-neutral-400 text-[10px]">/kg</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Extracted Files List with Instant Switcher & Primary Toggles */}
            <div className="bg-[#1f1f28] border border-[#2e2e3c] rounded-xl p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-white flex items-center gap-2">
                  <FileCode className="w-4 h-4 text-blue-400" />
                  Model Files ({model?.files.length || 0})
                </h3>
                <span className="text-[11px] text-neutral-400">Click any file to view in 3D</span>
              </div>

              <div className="flex flex-col gap-2 max-h-56 overflow-y-auto pr-1">
                {model?.files.map((file) => {
                  const isCurrent = file.id === currentActiveFile?.id;
                  return (
                    <div
                      key={file.id}
                      onClick={() => setSelectedFileId(file.id)}
                      className={`flex items-center justify-between p-2.5 rounded-lg text-xs cursor-pointer transition-all border ${
                        isCurrent
                          ? 'bg-blue-950/30 border-blue-500/60 shadow-sm shadow-blue-950/30'
                          : 'bg-[#141418] hover:bg-[#1a1a22] border-[#2a2a35] hover:border-[#38384a]'
                      }`}
                    >
                      <div className="truncate mr-2">
                        <div className="flex items-center gap-1.5 truncate">
                          <span
                            className={`font-semibold truncate ${
                              isCurrent ? 'text-blue-300' : 'text-neutral-200'
                            }`}
                          >
                            {file.original_name}
                          </span>

                          {file.is_primary_3d === 1 && (
                            <span className="flex items-center gap-1 px-1.5 py-0.2 bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded text-[9px] font-mono shrink-0">
                              <Star className="w-2.5 h-2.5 fill-current" />
                              PRIMARY
                            </span>
                          )}

                          {isCurrent && (
                            <span className="flex items-center gap-1 px-1.5 py-0.2 bg-blue-600/30 text-blue-400 border border-blue-500/40 rounded text-[9px] font-mono shrink-0">
                              <Eye className="w-2.5 h-2.5" />
                              VIEWING
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-neutral-500 font-mono">
                          {(file.file_size / 1024 / 1024).toFixed(2)} MB · {file.mime_type}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                        {!isCurrent && (
                          <button
                            onClick={() => setSelectedFileId(file.id)}
                            className="flex items-center gap-1 px-2 py-1 text-[10px] text-blue-400 hover:text-white bg-blue-950/50 hover:bg-blue-600 border border-blue-800/50 rounded transition-colors"
                            title="Load this file into the 3D viewport"
                          >
                            <Eye className="w-3 h-3" />
                            <span>View</span>
                          </button>
                        )}

                        {isOwnerOrAdmin && file.is_primary_3d !== 1 && (
                          <button
                            onClick={() => handleSetPrimaryFile(file.id)}
                            className="px-2 py-1 text-[10px] text-neutral-400 hover:text-white bg-[#22222c] hover:bg-[#2c2c38] rounded transition-colors"
                            title="Set as primary 3D file for thumbnail and default view"
                          >
                            Make Primary
                          </button>
                        )}

                        <a
                          href={file.file_path}
                          download={file.original_name}
                          className="p-1.5 text-neutral-400 hover:text-white hover:bg-white/10 rounded transition-colors"
                          title="Download file"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </a>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Collection Assignment */}
            <div className="bg-[#1f1f28] border border-[#2e2e3c] rounded-xl p-4 flex flex-col gap-2.5">
              <h3 className="text-xs font-bold text-white flex items-center gap-2">
                <FolderPlus className="w-4 h-4 text-blue-400" />
                Add to Folder / Collection
              </h3>

              {model?.collections && model.collections.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-1">
                  <span className="text-[11px] text-neutral-400 self-center">Assigned to:</span>
                  {model.collections.map((c) => (
                    <span
                      key={c.id}
                      className="px-2 py-0.5 bg-blue-950/60 border border-blue-800/60 text-blue-300 rounded text-[11px]"
                    >
                      {c.name}
                    </span>
                  ))}
                </div>
              )}

              <div className="flex items-center gap-2">
                <select
                  value={selectedCollectionToAdd}
                  onChange={(e) => setSelectedCollectionToAdd(e.target.value)}
                  className="flex-1 bg-[#141418] border border-[#30303e] rounded-lg px-2.5 py-1.5 text-xs text-white outline-none"
                >
                  <option value="">Select Folder...</option>
                  {collections.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.parent_folder_id ? `└── ${c.name}` : c.name}
                    </option>
                  ))}
                </select>
                <button
                  onClick={handleAddToCollection}
                  disabled={!selectedCollectionToAdd}
                  className="px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap"
                >
                  Assign
                </button>
              </div>
            </div>

            {/* Description & Tags */}
            <div className="bg-[#1f1f28] border border-[#2e2e3c] rounded-xl p-4 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-neutral-200">Description & Tags</span>
                {isOwnerOrAdmin && !isEditing && (
                  <button
                    onClick={() => setIsEditing(true)}
                    className="flex items-center gap-1 text-[11px] text-blue-400 hover:underline"
                  >
                    <Edit2 className="w-3 h-3" />
                    Edit
                  </button>
                )}
              </div>

              {isEditing ? (
                <form onSubmit={handleSaveMetadata} className="flex flex-col gap-2 mt-1">
                  <input
                    type="text"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    required
                    className="bg-[#121214] border border-[#353545] rounded px-2.5 py-1.5 text-xs text-white"
                  />
                  <textarea
                    rows={2}
                    value={editDesc}
                    onChange={(e) => setEditDesc(e.target.value)}
                    placeholder="Description"
                    className="bg-[#121214] border border-[#353545] rounded px-2.5 py-1.5 text-xs text-white"
                  />
                  <input
                    type="text"
                    value={editTags}
                    onChange={(e) => setEditTags(e.target.value)}
                    placeholder="Tags (comma separated)"
                    className="bg-[#121214] border border-[#353545] rounded px-2.5 py-1.5 text-xs text-white"
                  />
                  <div className="flex items-center justify-end gap-2 mt-1">
                    <button
                      type="button"
                      onClick={() => setIsEditing(false)}
                      className="px-2.5 py-1 text-xs text-neutral-400"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-semibold"
                    >
                      Save Changes
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <p className="text-xs text-neutral-300 leading-relaxed">
                    {model?.description || 'No description provided.'}
                  </p>
                  {model?.tags && model.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {model.tags.map((t) => (
                        <span
                          key={t}
                          className="px-2 py-0.5 bg-[#252530] text-neutral-300 text-[10px] rounded font-medium"
                        >
                          #{t}
                        </span>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Danger Zone: Delete Model */}
            {isOwnerOrAdmin && (
              <div className="pt-2 flex justify-end">
                <button
                  onClick={handleDeleteModel}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-400 hover:text-red-300 bg-red-950/30 hover:bg-red-950/60 border border-red-900/50 rounded-lg transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete Model Asset
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
