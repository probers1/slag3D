import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';

if (typeof window !== 'undefined') {
  window.THREE = THREE;
  window.THREE.STLLoader = STLLoader;
  window.THREE.OBJLoader = OBJLoader;
}
