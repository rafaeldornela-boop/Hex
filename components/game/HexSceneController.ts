import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  DEFAULT_ROTATION_DEG,
  HEX_OUTER_RADIUS,
  axialToWorld,
  hexKey,
  worldToAxial,
  type AxialCoord,
  type HexWorldState,
  type PlacedHex,
} from '@/lib/hex-engine';
import { HEX_ASSETS } from '@/lib/repo-data';

export type GameModeState = 'title' | 'playing' | 'paused';
export type BuilderToolMode = 'build' | 'demolish';

export interface HexSceneCallbacks {
  onHoverChange: (coord: AxialCoord | null, existingTile: PlacedHex | null) => void;
  onPlaceAt: (q: number, r: number) => void;
  onDemolishAt: (q: number, r: number) => void;
  onRotate: () => void;
  onCycleStructure: (delta: number) => void;
  onLoadProgress: (loaded: number, total: number) => void;
}

interface PopAnimEntry {
  mesh: THREE.Object3D;
  progress: number;
}

interface ParticleState {
  active: boolean;
  age: number;
  life: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  scale: number;
}

const PARTICLE_POOL_SIZE = 48;

// Pre-allocated scratch helpers (zero GC inside animation loop)
const _raycaster = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
const _groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _hitPoint = new THREE.Vector3();
const _moveVec = new THREE.Vector3();
const _dummy = new THREE.Object3D();
const _colorTmp = new THREE.Color();

function detectSoftwareWebGL(): boolean {
  if (typeof document === 'undefined') return true;
  const probeCanvas = document.createElement('canvas');
  const gl = probeCanvas.getContext('webgl2');
  if (!gl) return true;
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
  const gpu = String(gl.getParameter(param) ?? '');
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
}

function createWaterCanvasTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#3f96be';
    ctx.fillRect(0, 0, size, size);

    // Soft organic ocean dappling (non-repeating pseudo-random distribution)
    let seed = 1337;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };

    for (let i = 0; i < 140; i++) {
      const x = rand() * size;
      const y = rand() * size;
      const r = 18 + rand() * 44;
      const isHighlight = i % 2 === 0;
      const grad = ctx.createRadialGradient(x, y, 2, x, y, r);
      grad.addColorStop(
        0,
        isHighlight ? 'rgba(130, 212, 240, 0.14)' : 'rgba(28, 96, 134, 0.14)'
      );
      grad.addColorStop(1, 'rgba(63, 150, 190, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    for (let i = 0; i < 36; i++) {
      const x = rand() * size;
      const y = rand() * size;
      const w = 14 + rand() * 22;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, w, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(22, 22);
  tex.anisotropy = maxAnisotropy;
  return tex;
}

function createHexRingGeometry(outerR: number, innerR: number): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i;
    const x = Math.cos(angle) * outerR;
    const y = Math.sin(angle) * outerR;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();

  const hole = new THREE.Path();
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i;
    const x = Math.cos(angle) * innerR;
    const y = Math.sin(angle) * innerR;
    if (i === 0) hole.moveTo(x, y);
    else hole.lineTo(x, y);
  }
  hole.closePath();
  shape.holes.push(hole);

  const geo = new THREE.ShapeGeometry(shape);
  geo.rotateX(-Math.PI / 2);
  return geo;
}

function buildSubtleHexGridLines(radiusRings: number): THREE.LineSegments {
  const positions: number[] = [];
  const r = HEX_OUTER_RADIUS;

  for (let q = -radiusRings; q <= radiusRings; q++) {
    const r1 = Math.max(-radiusRings, -q - radiusRings);
    const r2 = Math.min(radiusRings, -q + radiusRings);
    for (let row = r1; row <= r2; row++) {
      const center = axialToWorld(q, row);
      for (let side = 0; side < 6; side++) {
        const a0 = (Math.PI / 3) * side;
        const a1 = (Math.PI / 3) * ((side + 1) % 6);
        positions.push(
          center.x + Math.cos(a0) * r,
          0.015,
          center.z + Math.sin(a0) * r,
          center.x + Math.cos(a1) * r,
          0.015,
          center.z + Math.sin(a1) * r
        );
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const mat = new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.2,
    depthWrite: false,
  });
  return new THREE.LineSegments(geo, mat);
}

export class HexSceneController {
  private container: HTMLElement;
  private callbacks: HexSceneCallbacks;
  private isSoftwareGl: boolean;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private gltfLoader: GLTFLoader;
  private waterTexture: THREE.CanvasTexture;
  private waterMesh: THREE.Mesh;

  private modelCache = new Map<string, THREE.Group>();
  private loadingPromises = new Map<string, Promise<THREE.Group>>();
  private hexesGroup = new THREE.Group();
  private placedMeshes = new Map<string, { group: THREE.Group; structureIndex: number; orientation: number }>();

  // Selector cursor
  private selectorGroup = new THREE.Group();
  private selectorRingMat: THREE.MeshBasicMaterial;
  private selectorPreviewGroup = new THREE.Group();
  private currentPreviewIndex = -1;
  private currentRotationDeg = DEFAULT_ROTATION_DEG;
  private toolMode: BuilderToolMode = 'build';
  private hoveredCoord: AxialCoord | null = null;
  private currentWorldState: HexWorldState = { cash: 10000, hexes: {} };

  // Camera state
  private gameState: GameModeState = 'title';
  private titleOrbitAngle = 0.65;
  private camTarget = new THREE.Vector3(0, 0, 0);
  private camTargetGoal = new THREE.Vector3(0, 0, 0);
  private camYaw = Math.PI / 4; // 45° isometric view
  private camYawGoal = Math.PI / 4;
  private camDistance = 11.5;
  private camDistanceGoal = 11.5;
  private camPitch = 0.66; // ~38° down-angle

  // Input state
  private keysHeld = new Set<string>();
  private isOrbitDragging = false;
  private lastDragX = 0;
  private pointerInside = false;
  private pointerClientX = 0;
  private pointerClientY = 0;
  private lastHoverRaycastTime = 0;

  // Pop animations & pooled particles
  private popAnims: PopAnimEntry[] = [];
  private particlesMesh: THREE.InstancedMesh;
  private particles: ParticleState[] = [];
  private particleCursor = 0;

  // Loop management
  private disposed = false;
  private frameId = 0;
  private lastFrameMs = 0;
  private resizeObserver: ResizeObserver;
  private elapsedSec = 0;

  constructor(container: HTMLElement, callbacks: HexSceneCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
    this.isSoftwareGl = detectSoftwareWebGL();

    // Renderer
    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.92;
    this.renderer.setPixelRatio(
      this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2)
    );
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const width = Math.max(container.clientWidth, 1);
    const height = Math.max(container.clientHeight, 1);
    this.renderer.setSize(width, height);
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    container.appendChild(this.renderer.domElement);

    // Scene & Atmosphere (linear horizon fog keeps foreground island crisp and vivid)
    this.scene = new THREE.Scene();
    const skyColor = new THREE.Color(0x9bd2ee);
    this.scene.background = skyColor;
    this.scene.fog = new THREE.Fog(0x9bd2ee, 18, 66);

    // Studio RoomEnvironment for subtle PBR sheen without washing out pastel colormaps
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.32;
    pmrem.dispose();

    // Camera
    this.camera = new THREE.PerspectiveCamera(32, width / height, 0.1, 180);
    this.updateCameraTransform(1);

    // Warm/Cool 3-Point Outdoor Lighting Rig (1 shadow caster)
    const hemiLight = new THREE.HemisphereLight(0x8ecbf5, 0x566842, 0.58);
    hemiLight.position.set(0, 30, 0);
    this.scene.add(hemiLight);

    const sunLight = new THREE.DirectionalLight(0xfff1d0, 1.65);
    sunLight.position.set(14, 22, 12);
    if (!this.isSoftwareGl) {
      sunLight.castShadow = true;
      sunLight.shadow.mapSize.set(1024, 1024);
      const d = 11;
      sunLight.shadow.camera.left = -d;
      sunLight.shadow.camera.right = d;
      sunLight.shadow.camera.top = d;
      sunLight.shadow.camera.bottom = -d;
      sunLight.shadow.camera.near = 2;
      sunLight.shadow.camera.far = 55;
      sunLight.shadow.bias = -0.0005;
      sunLight.shadow.normalBias = 0.02;
    }
    this.scene.add(sunLight);

    const rimLight = new THREE.DirectionalLight(0xbbe0ff, 0.28);
    rimLight.position.set(-14, 10, -14);
    this.scene.add(rimLight);

    // Expansive ocean surface extending to horizon fog (no floating slab in void)
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    this.waterTexture = createWaterCanvasTexture(maxAniso);
    const waterGeo = new THREE.PlaneGeometry(240, 240);
    waterGeo.rotateX(-Math.PI / 2);
    const waterMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: this.waterTexture,
      roughness: 0.42,
      metalness: 0.06,
    });
    this.waterMesh = new THREE.Mesh(waterGeo, waterMat);
    this.waterMesh.position.y = -0.025;
    this.waterMesh.receiveShadow = !this.isSoftwareGl;
    this.scene.add(this.waterMesh);

    // Subtle hex grid guide lines near island
    this.scene.add(buildSubtleHexGridLines(7));

    // Placed hexes container
    this.scene.add(this.hexesGroup);

    // Selector cursor (hex ring elevated cleanly above the 0.20 tile surface + preview container)
    const ringGeo = createHexRingGeometry(HEX_OUTER_RADIUS * 1.02, HEX_OUTER_RADIUS * 0.84);
    this.selectorRingMat = new THREE.MeshBasicMaterial({
      color: 0x10b981,
      transparent: true,
      opacity: 0.95,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const ringMesh = new THREE.Mesh(ringGeo, this.selectorRingMat);
    ringMesh.position.y = 0.215;
    this.selectorGroup.add(ringMesh);
    this.selectorPreviewGroup.position.y = 0.26;
    this.selectorGroup.add(this.selectorPreviewGroup);
    this.selectorGroup.visible = false;
    this.scene.add(this.selectorGroup);

    // Pooled instanced particles
    const particleGeo = new THREE.BoxGeometry(0.08, 0.08, 0.08);
    const particleMat = new THREE.MeshStandardMaterial({
      color: 0xfff5d6,
      roughness: 0.65,
      metalness: 0.05,
    });
    this.particlesMesh = new THREE.InstancedMesh(
      particleGeo,
      particleMat,
      PARTICLE_POOL_SIZE
    );
    this.particlesMesh.frustumCulled = false;
    for (let i = 0; i < PARTICLE_POOL_SIZE; i++) {
      this.particles.push({
        active: false,
        age: 0,
        life: 0.5,
        x: 0,
        y: -10,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        scale: 0,
      });
      _dummy.position.set(0, -10, 0);
      _dummy.scale.setScalar(0);
      _dummy.updateMatrix();
      this.particlesMesh.setMatrixAt(i, _dummy.matrix);
      this.particlesMesh.setColorAt(i, _colorTmp.setHex(0xfff5d6));
    }
    this.particlesMesh.instanceMatrix.needsUpdate = true;
    this.scene.add(this.particlesMesh);

    // Asset loader
    THREE.Cache.enabled = true;
    this.gltfLoader = new GLTFLoader();

    // Events & ResizeObserver
    this.bindEvents();
    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(container);

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    this.lastFrameMs = performance.now();
    this.scheduleNextFrame();
  }

  private bindEvents() {
    const el = this.renderer.domElement;
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointerleave', this.onPointerLeave);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('contextmenu', this.onContextMenu);
    el.addEventListener('webglcontextlost', this.onContextLost);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onWindowBlur);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  private unbindEvents() {
    const el = this.renderer.domElement;
    el.removeEventListener('pointermove', this.onPointerMove);
    el.removeEventListener('pointerdown', this.onPointerDown);
    el.removeEventListener('pointerleave', this.onPointerLeave);
    el.removeEventListener('wheel', this.onWheel);
    el.removeEventListener('contextmenu', this.onContextMenu);
    el.removeEventListener('webglcontextlost', this.onContextLost);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onWindowBlur);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
  }

  private onContextLost = (e: Event) => {
    e.preventDefault();
  };

  private onContextMenu = (e: MouseEvent) => {
    e.preventDefault();
  };

  private onWindowBlur = () => {
    this.keysHeld.clear();
    this.isOrbitDragging = false;
  };

  private onVisibilityChange = () => {
    if (document.hidden) {
      this.keysHeld.clear();
      this.isOrbitDragging = false;
    }
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (this.gameState !== 'playing') return;
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    this.keysHeld.add(e.code);

    if (e.code === 'KeyF') {
      this.camTargetGoal.set(0, 0, 0);
    } else if (e.code === 'Equal' || e.code === 'NumpadAdd') {
      this.zoomBy(-1.4);
    } else if (e.code === 'Minus' || e.code === 'NumpadSubtract') {
      this.zoomBy(1.4);
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keysHeld.delete(e.code);
  };

  private onPointerMove = (e: PointerEvent) => {
    this.pointerInside = true;
    this.pointerClientX = e.clientX;
    this.pointerClientY = e.clientY;

    if (this.isOrbitDragging && this.gameState === 'playing') {
      const dx = e.clientX - this.lastDragX;
      this.lastDragX = e.clientX;
      this.camYawGoal -= dx * 0.008;
      return;
    }

    if (this.gameState === 'playing') {
      const now = performance.now();
      if (now - this.lastHoverRaycastTime >= 16) {
        this.lastHoverRaycastTime = now;
        this.updateHoverFromPointer(e.clientX, e.clientY);
      }
    }
  };

  private onPointerLeave = () => {
    this.pointerInside = false;
    this.hoveredCoord = null;
    this.selectorGroup.visible = false;
    this.callbacks.onHoverChange(null, null);
  };

  private onPointerDown = (e: PointerEvent) => {
    if (this.gameState !== 'playing') return;

    // Middle mouse button OR Shift/Alt + Left button -> orbit rotate camera
    if (e.button === 1 || (e.button === 0 && (e.shiftKey || e.altKey))) {
      e.preventDefault();
      this.isOrbitDragging = true;
      this.lastDragX = e.clientX;
      return;
    }

    // Right click -> rotate piece 60° (matching Godot's rotate action)
    if (e.button === 2) {
      e.preventDefault();
      this.callbacks.onRotate();
      return;
    }

    // Left click -> build or demolish at raycasted hex
    if (e.button === 0) {
      this.updateHoverFromPointer(e.clientX, e.clientY);
      if (!this.hoveredCoord) return;
      if (this.toolMode === 'demolish') {
        this.callbacks.onDemolishAt(this.hoveredCoord.q, this.hoveredCoord.r);
      } else {
        this.callbacks.onPlaceAt(this.hoveredCoord.q, this.hoveredCoord.r);
      }
    }
  };

  private onPointerUp = () => {
    this.isOrbitDragging = false;
  };

  private onWheel = (e: WheelEvent) => {
    if (this.gameState !== 'playing') return;
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      this.zoomBy(e.deltaY > 0 ? 1.1 : -1.1);
    } else {
      // Matches Godot project.godot where mouse wheel cycles structure_next / structure_previous
      this.callbacks.onCycleStructure(e.deltaY > 0 ? 1 : -1);
    }
  };

  private updateHoverFromPointer(clientX: number, clientY: number) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    _ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    _ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;

    _raycaster.setFromCamera(_ndc, this.camera);
    const hit = _raycaster.ray.intersectPlane(_groundPlane, _hitPoint);
    if (!hit) {
      this.hoveredCoord = null;
      this.selectorGroup.visible = false;
      this.callbacks.onHoverChange(null, null);
      return;
    }

    const coord = worldToAxial(_hitPoint.x, _hitPoint.z);
    const worldPos = axialToWorld(coord.q, coord.r);
    this.selectorGroup.position.set(worldPos.x, 0, worldPos.z);
    this.selectorGroup.visible = true;

    const changed =
      !this.hoveredCoord ||
      this.hoveredCoord.q !== coord.q ||
      this.hoveredCoord.r !== coord.r;

    this.hoveredCoord = coord;
    if (changed) {
      const existing = this.currentWorldState.hexes[hexKey(coord.q, coord.r)] ?? null;
      this.callbacks.onHoverChange(coord, existing);
    }
  }

  public getHoveredCoord(): AxialCoord | null {
    return this.hoveredCoord;
  }

  public setGameState(next: GameModeState) {
    const prev = this.gameState;
    this.gameState = next;
    this.keysHeld.clear();
    this.isOrbitDragging = false;

    if (next === 'playing' && prev === 'title') {
      // Smooth handoff from live title tour to gameplay framing
      this.camTargetGoal.set(0, 0, 0);
      this.camYawGoal = Math.PI / 4;
      this.camDistanceGoal = 11.2;
      if (this.pointerInside) {
        this.updateHoverFromPointer(this.pointerClientX, this.pointerClientY);
      }
    }

    if (next !== 'playing') {
      this.selectorGroup.visible = false;
    }
  }

  public setToolMode(mode: BuilderToolMode) {
    this.toolMode = mode;
    this.selectorRingMat.color.setHex(mode === 'demolish' ? 0xdc2626 : 0x059669);
    this.selectorPreviewGroup.visible = mode === 'build';
  }

  public centerCamera() {
    this.camTargetGoal.set(0, 0, 0);
  }

  public zoomBy(delta: number) {
    this.camDistanceGoal = THREE.MathUtils.clamp(
      this.camDistanceGoal + delta,
      5.5,
      20
    );
  }

  public rotateCameraBy(radians: number) {
    this.camYawGoal += radians;
  }

  public setSelectedPiece(structureIndex: number, rotationDeg: number) {
    this.currentRotationDeg = rotationDeg;
    this.selectorPreviewGroup.rotation.y = THREE.MathUtils.degToRad(rotationDeg);

    if (structureIndex !== this.currentPreviewIndex) {
      this.currentPreviewIndex = structureIndex;
      this.refreshSelectorPreview(structureIndex);
    }
  }

  private async refreshSelectorPreview(structureIndex: number) {
    const asset = HEX_ASSETS[structureIndex];
    if (!asset) return;

    try {
      const template = await this.loadModel(asset.name);
      if (this.disposed || this.currentPreviewIndex !== structureIndex) return;

      while (this.selectorPreviewGroup.children.length > 0) {
        this.selectorPreviewGroup.remove(this.selectorPreviewGroup.children[0]);
      }

      const clone = template.clone(true);
      clone.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) {
          const mesh = obj as THREE.Mesh;
          mesh.castShadow = false;
          mesh.receiveShadow = false;
        }
      });
      this.selectorPreviewGroup.add(clone);
    } catch {
      // Ignore individual load errors gracefully
    }
  }

  private loadModel(assetName: string): Promise<THREE.Group> {
    const cached = this.modelCache.get(assetName);
    if (cached) return Promise.resolve(cached);

    const existingPromise = this.loadingPromises.get(assetName);
    if (existingPromise) return existingPromise;

    const url = `/godot-assets/models/${assetName}.glb`;
    const promise = new Promise<THREE.Group>((resolve, reject) => {
      this.gltfLoader.load(
        url,
        (gltf) => {
          const root = gltf.scene;
          root.traverse((obj) => {
            if ((obj as THREE.Mesh).isMesh) {
              const mesh = obj as THREE.Mesh;
              mesh.castShadow = !this.isSoftwareGl;
              mesh.receiveShadow = !this.isSoftwareGl;
              const mat = mesh.material;
              if (mat && 'envMapIntensity' in mat) {
                (mat as THREE.MeshStandardMaterial).envMapIntensity = 0.28;
              }
            }
          });
          this.modelCache.set(assetName, root);
          this.loadingPromises.delete(assetName);
          resolve(root);
        },
        undefined,
        (err) => {
          this.loadingPromises.delete(assetName);
          reject(err);
        }
      );
    });

    this.loadingPromises.set(assetName, promise);
    return promise;
  }

  public async syncWorldState(nextState: HexWorldState, animateNewKeys?: string[]) {
    this.currentWorldState = nextState;
    const animSet = new Set(animateNewKeys ?? []);

    // Remove meshes that no longer exist or changed structure
    for (const [key, entry] of this.placedMeshes.entries()) {
      const target = nextState.hexes[key];
      if (!target || target.structureIndex !== entry.structureIndex) {
        this.hexesGroup.remove(entry.group);
        this.placedMeshes.delete(key);
        if (!target && animSet.has(key)) {
          const pos = entry.group.position;
          this.spawnParticleBurst(pos.x, 0.25, pos.z, 0xdc2626, 10);
        }
      } else if (target.orientation !== entry.orientation) {
        entry.group.rotation.y = THREE.MathUtils.degToRad(target.orientation);
        entry.orientation = target.orientation;
        if (animSet.has(key)) {
          this.popAnims.push({ mesh: entry.group, progress: 0 });
        }
      }
    }

    // Collect unique asset names needed for missing tiles
    const missingEntries: [string, PlacedHex][] = [];
    const uniqueNames = new Set<string>();
    for (const [key, tile] of Object.entries(nextState.hexes)) {
      if (!this.placedMeshes.has(key)) {
        missingEntries.push([key, tile]);
        const asset = HEX_ASSETS[tile.structureIndex];
        if (asset) uniqueNames.add(asset.name);
      }
    }

    if (missingEntries.length === 0) return;

    const namesList = Array.from(uniqueNames);
    let loadedCount = 0;
    const totalCount = namesList.length;

    await Promise.all(
      namesList.map(async (name) => {
        try {
          await this.loadModel(name);
        } finally {
          loadedCount++;
          this.callbacks.onLoadProgress(loadedCount, totalCount);
        }
      })
    );

    if (this.disposed) return;

    for (const [key, tile] of missingEntries) {
      // Ensure state still has this tile after async load
      const liveTile = this.currentWorldState.hexes[key];
      if (!liveTile || liveTile.structureIndex !== tile.structureIndex) continue;
      if (this.placedMeshes.has(key)) continue;

      const asset = HEX_ASSETS[tile.structureIndex];
      if (!asset) continue;
      const template = this.modelCache.get(asset.name);
      if (!template) continue;

      const group = new THREE.Group();
      const clone = template.clone(true);
      group.add(clone);

      const pos = axialToWorld(tile.q, tile.r);
      group.position.set(pos.x, 0, pos.z);
      group.rotation.y = THREE.MathUtils.degToRad(tile.orientation);
      this.hexesGroup.add(group);

      this.placedMeshes.set(key, {
        group,
        structureIndex: tile.structureIndex,
        orientation: tile.orientation,
      });

      if (animSet.has(key)) {
        group.scale.set(1.12, 0.55, 1.12);
        this.popAnims.push({ mesh: group, progress: 0 });
        this.spawnParticleBurst(pos.x, 0.18, pos.z, 0xfef3c7, 12);
      }
    }
  }

  private spawnParticleBurst(
    x: number,
    y: number,
    z: number,
    hexColor: number,
    count: number
  ) {
    for (let i = 0; i < count; i++) {
      const p = this.particles[this.particleCursor];
      this.particleCursor = (this.particleCursor + 1) % PARTICLE_POOL_SIZE;
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.4;
      const speed = 1.1 + Math.random() * 1.4;
      p.active = true;
      p.age = 0;
      p.life = 0.32 + Math.random() * 0.18;
      p.x = x + Math.cos(angle) * 0.25;
      p.y = y;
      p.z = z + Math.sin(angle) * 0.25;
      p.vx = Math.cos(angle) * speed;
      p.vy = 1.6 + Math.random() * 1.2;
      p.vz = Math.sin(angle) * speed;
      p.scale = 0.7 + Math.random() * 0.6;
      this.particlesMesh.setColorAt(
        (this.particleCursor - 1 + PARTICLE_POOL_SIZE) % PARTICLE_POOL_SIZE,
        _colorTmp.setHex(hexColor)
      );
    }
    if (this.particlesMesh.instanceColor) {
      this.particlesMesh.instanceColor.needsUpdate = true;
    }
  }

  private handleResize() {
    if (this.disposed) return;
    const width = Math.max(this.container.clientWidth, 1);
    const height = Math.max(this.container.clientHeight, 1);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  private updateCameraTransform(dt: number) {
    if (this.gameState === 'title') {
      this.titleOrbitAngle += dt * 0.16;
      const dist = 10.6;
      const pitch = 0.56;
      const horiz = Math.cos(pitch) * dist;
      const y = Math.sin(pitch) * dist;
      // Offset lookAt slightly left so the focal castle sits nicely in right 2/3 while left third has calm sky/water
      const focusX = -0.9;
      const focusZ = -0.2;
      this.camera.position.set(
        focusX + Math.sin(this.titleOrbitAngle) * horiz,
        y,
        focusZ + Math.cos(this.titleOrbitAngle) * horiz
      );
      this.camera.lookAt(focusX, 0.35, focusZ);
      return;
    }

    // Gameplay WASD / Arrow camera pan relative to camera yaw
    if (this.gameState === 'playing') {
      const moveX =
        (this.keysHeld.has('KeyD') || this.keysHeld.has('ArrowRight') ? 1 : 0) -
        (this.keysHeld.has('KeyA') || this.keysHeld.has('ArrowLeft') ? 1 : 0);
      const moveZ =
        (this.keysHeld.has('KeyS') || this.keysHeld.has('ArrowDown') ? 1 : 0) -
        (this.keysHeld.has('KeyW') || this.keysHeld.has('ArrowUp') ? 1 : 0);

      if (moveX !== 0 || moveZ !== 0) {
        _moveVec.set(moveX, 0, moveZ).normalize();
        const cosY = Math.cos(this.camYaw);
        const sinY = Math.sin(this.camYaw);
        const worldDx = _moveVec.x * cosY + _moveVec.z * sinY;
        const worldDz = -_moveVec.x * sinY + _moveVec.z * cosY;
        const panSpeed = 6.5 * dt;
        this.camTargetGoal.x = THREE.MathUtils.clamp(
          this.camTargetGoal.x + worldDx * panSpeed,
          -14,
          14
        );
        this.camTargetGoal.z = THREE.MathUtils.clamp(
          this.camTargetGoal.z + worldDz * panSpeed,
          -14,
          14
        );
      }
    }

    const dampFactor = 9;
    this.camTarget.x = THREE.MathUtils.damp(this.camTarget.x, this.camTargetGoal.x, dampFactor, dt);
    this.camTarget.z = THREE.MathUtils.damp(this.camTarget.z, this.camTargetGoal.z, dampFactor, dt);
    this.camYaw = THREE.MathUtils.damp(this.camYaw, this.camYawGoal, 8, dt);
    this.camDistance = THREE.MathUtils.damp(this.camDistance, this.camDistanceGoal, 8, dt);

    const horiz = Math.cos(this.camPitch) * this.camDistance;
    const height = Math.sin(this.camPitch) * this.camDistance;

    this.camera.position.set(
      this.camTarget.x + Math.sin(this.camYaw) * horiz,
      height,
      this.camTarget.z + Math.cos(this.camYaw) * horiz
    );
    this.camera.lookAt(this.camTarget.x, 0.15, this.camTarget.z);
  }

  private updateEffects(dt: number) {
    this.elapsedSec += dt;

    // Gentle ocean drift
    this.waterTexture.offset.x = (this.elapsedSec * 0.015) % 1;
    this.waterTexture.offset.y = (this.elapsedSec * 0.01) % 1;

    // Gentle preview float
    if (this.selectorGroup.visible && this.selectorPreviewGroup.visible) {
      this.selectorPreviewGroup.position.y = 0.22 + Math.sin(this.elapsedSec * 4) * 0.03;
    }

    // Pop-in spring animations
    for (let i = this.popAnims.length - 1; i >= 0; i--) {
      const anim = this.popAnims[i];
      anim.progress += dt * 5.8;
      if (anim.progress >= 1) {
        anim.mesh.scale.set(1, 1, 1);
        this.popAnims.splice(i, 1);
      } else {
        const t = anim.progress;
        const overshoot = Math.sin(t * Math.PI) * 0.14 * (1 - t);
        const sy = THREE.MathUtils.lerp(0.6, 1.0, Math.min(1, t * 1.4)) + overshoot;
        const sxz = 1 + (1 - sy) * 0.25;
        anim.mesh.scale.set(sxz, sy, sxz);
      }
    }

    // Pooled particles
    let anyParticleUpdated = false;
    for (let i = 0; i < PARTICLE_POOL_SIZE; i++) {
      const p = this.particles[i];
      if (!p.active) continue;
      anyParticleUpdated = true;
      p.age += dt;
      if (p.age >= p.life) {
        p.active = false;
        _dummy.position.set(0, -10, 0);
        _dummy.scale.setScalar(0);
        _dummy.updateMatrix();
        this.particlesMesh.setMatrixAt(i, _dummy.matrix);
      } else {
        p.vy -= 5.8 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        const lifeFrac = 1 - p.age / p.life;
        _dummy.position.set(p.x, Math.max(0.02, p.y), p.z);
        _dummy.rotation.set(p.age * 4, p.age * 3, 0);
        _dummy.scale.setScalar(p.scale * lifeFrac);
        _dummy.updateMatrix();
        this.particlesMesh.setMatrixAt(i, _dummy.matrix);
      }
    }
    if (anyParticleUpdated) {
      this.particlesMesh.instanceMatrix.needsUpdate = true;
    }
  }

  private afterDraw(cb: () => void) {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    if (gl && typeof gl.fenceSync === 'function') {
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (this.disposed) {
          if (sync) gl.deleteSync(sync);
          return;
        }
        const status = sync ? gl.getSyncParameter(sync, gl.SYNC_STATUS) : gl.SIGNALED;
        if (status === gl.UNSIGNALED) {
          this.frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          this.frameId = window.setTimeout(cb, 80);
        }
      };
      this.frameId = window.setTimeout(poll, 5);
    } else {
      this.frameId = window.setTimeout(cb, 80);
    }
  }

  private scheduleNextFrame() {
    if (this.disposed) return;
    if (this.isSoftwareGl) {
      this.afterDraw(this.tick);
    } else {
      this.frameId = requestAnimationFrame(this.tick);
    }
  }

  private tick = () => {
    if (this.disposed) return;
    const now = performance.now();
    const rawDt = (now - this.lastFrameMs) / 1000;
    this.lastFrameMs = now;
    const dt = Math.min(Math.max(rawDt, 0.001), 0.05);

    this.updateCameraTransform(dt);
    if (this.gameState !== 'paused') {
      this.updateEffects(dt);
    }
    this.renderer.render(this.scene, this.camera);
    this.scheduleNextFrame();
  };

  public dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);
    this.resizeObserver.disconnect();
    this.unbindEvents();

    this.scene.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh;
        mesh.geometry?.dispose();
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((m) => m.dispose());
        } else {
          mesh.material?.dispose();
        }
      }
    });
    this.waterTexture.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
