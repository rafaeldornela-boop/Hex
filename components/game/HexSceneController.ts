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
import {
  detectDeviceQualityProfile,
  type RenderQualityProfile,
} from '@/lib/device-profile';
import {
  TOUCH_TAP_MAX_MOVEMENT_PX,
  computeTwoFingerGestureDelta,
  isCleanTap,
  pointDistance,
  screenPanToWorldDelta,
  type ScreenPoint,
} from '@/lib/touch-gestures';
import {
  AXIAL_DIRECTIONS,
  evaluateConquest,
  getConquerableFrontierCoords,
  type HexOwner,
} from '@/lib/territory-engine';
import { HEX_ASSETS } from '@/lib/repo-data';

export type GameModeState = 'title' | 'playing' | 'paused';
export type BuilderToolMode = 'expand' | 'build' | 'demolish';

export interface HexSceneCallbacks {
  onHoverChange: (coord: AxialCoord | null, existingTile: PlacedHex | null) => void;
  onPlaceAt: (q: number, r: number) => void;
  onDemolishAt: (q: number, r: number) => void;
  onTouchTapAt: (q: number, r: number) => void;
  onSelectHexAt: (q: number, r: number) => void;
  onRotate: () => void;
  onCycleStructure: (delta: number) => void;
  onLoadProgress: (loaded: number, total: number) => void;
}

interface PopAnimEntry {
  mesh: THREE.Object3D;
  progress: number;
}

interface ConquestWaveEntry {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
  progress: number;
  baseY: number;
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

const CAMERA_MIN_DIST = 5.5;
const CAMERA_MAX_DIST = 22;
const CAMERA_PAN_BOUND = 15;

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

function createWaterCanvasTexture(
  size: number,
  maxAnisotropy: number
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#3f96be';
    ctx.fillRect(0, 0, size, size);

    // Soft organic ocean dappling (deterministic pseudo-random distribution)
    let seed = 1337;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };

    const scale = size / 512;
    const dappleCount = Math.round(140 * Math.max(0.55, scale));
    for (let i = 0; i < dappleCount; i++) {
      const x = rand() * size;
      const y = rand() * size;
      const r = (18 + rand() * 44) * scale;
      const isHighlight = i % 2 === 0;
      const grad = ctx.createRadialGradient(x, y, Math.max(1, 2 * scale), x, y, r);
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

    const waveCount = Math.round(36 * Math.max(0.6, scale));
    for (let i = 0; i < waveCount; i++) {
      const x = rand() * size;
      const y = rand() * size;
      const w = (14 + rand() * 22) * scale;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.lineWidth = Math.max(1, 1.5 * scale);
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
  tex.anisotropy = Math.min(maxAnisotropy, 4);
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

function appendHexEdgeQuad(
  positions: number[],
  cx: number,
  cz: number,
  y: number,
  edgeIndex: number,
  outerR: number,
  innerR: number
) {
  const a0 = (Math.PI / 3) * edgeIndex;
  const a1 = (Math.PI / 3) * ((edgeIndex + 1) % 6);
  const c0 = Math.cos(a0);
  const s0 = Math.sin(a0);
  const c1 = Math.cos(a1);
  const s1 = Math.sin(a1);

  const ox0 = cx + c0 * outerR;
  const oz0 = cz + s0 * outerR;
  const ox1 = cx + c1 * outerR;
  const oz1 = cz + s1 * outerR;
  const ix0 = cx + c0 * innerR;
  const iz0 = cz + s0 * innerR;
  const ix1 = cx + c1 * innerR;
  const iz1 = cz + s1 * innerR;

  positions.push(
    ox0, y, oz0,
    ox1, y, oz1,
    ix1, y, iz1,
    ox0, y, oz0,
    ix1, y, iz1,
    ix0, y, iz0
  );
}

function buildTerritoryPerimeterGeometry(
  state: HexWorldState,
  outerR: number,
  innerR: number,
  y: number
): THREE.BufferGeometry {
  const positions: number[] = [];

  for (const tile of Object.values(state.hexes)) {
    if (tile.owner !== 'player') continue;
    const center = axialToWorld(tile.q, tile.r);
    for (let edge = 0; edge < 6; edge++) {
      const dir = AXIAL_DIRECTIONS[edge];
      const nKey = hexKey(tile.q + dir.q, tile.r + dir.r);
      if (state.hexes[nKey]?.owner !== 'player') {
        appendHexEdgeQuad(positions, center.x, center.z, y, edge, outerR, innerR);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return geo;
}

function buildConquerableFrontierGeometry(state: HexWorldState): THREE.BufferGeometry {
  const positions: number[] = [];
  const frontier = getConquerableFrontierCoords(state);
  const outerR = HEX_OUTER_RADIUS * 0.965;
  const innerR = HEX_OUTER_RADIUS * 0.885;

  for (const coord of frontier) {
    const center = axialToWorld(coord.q, coord.r);
    const hasTile = Boolean(state.hexes[hexKey(coord.q, coord.r)]);
    const y = hasTile ? 0.209 : 0.032;
    for (let edge = 0; edge < 6; edge++) {
      appendHexEdgeQuad(positions, center.x, center.z, y, edge, outerR, innerR);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return geo;
}

function createNeutralMaterialVariant(
  mat: THREE.Material | THREE.Material[]
): THREE.Material | THREE.Material[] {
  const tint = new THREE.Color(0x8fa7be);
  const cloneOne = (m: THREE.Material): THREE.Material => {
    const cloned = m.clone();
    if ('color' in cloned && cloned.color instanceof THREE.Color) {
      cloned.color.multiply(tint);
    }
    if ('roughness' in cloned && typeof (cloned as THREE.MeshStandardMaterial).roughness === 'number') {
      (cloned as THREE.MeshStandardMaterial).roughness = Math.min(
        1,
        (cloned as THREE.MeshStandardMaterial).roughness + 0.1
      );
    }
    return cloned;
  };
  return Array.isArray(mat) ? mat.map(cloneOne) : cloneOne(mat);
}

export class HexSceneController {
  private container: HTMLElement;
  private callbacks: HexSceneCallbacks;
  private isSoftwareGl: boolean;
  private quality: RenderQualityProfile;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private envRenderTarget: THREE.WebGLRenderTarget | null = null;
  private camera: THREE.PerspectiveCamera;
  private gltfLoader: GLTFLoader;
  private waterTexture: THREE.CanvasTexture;
  private waterMesh: THREE.Mesh;

  private modelCache = new Map<string, THREE.Group>();
  private ownerMaterialPairs = new Map<
    string,
    { owned: THREE.Material | THREE.Material[]; neutral: THREE.Material | THREE.Material[] }
  >();
  private loadingPromises = new Map<string, Promise<THREE.Group>>();
  private hexesGroup = new THREE.Group();
  private placedMeshes = new Map<
    string,
    { group: THREE.Group; structureIndex: number; orientation: number; owner: HexOwner }
  >();

  // Territorial borders & conquerable frontier overlays
  private territoryTrimMesh: THREE.Mesh;
  private territoryBorderMesh: THREE.Mesh;
  private frontierOverlayMesh: THREE.Mesh;
  private frontierOverlayMat: THREE.MeshBasicMaterial;
  private conquestRingGeo: THREE.BufferGeometry;
  private conquestWaves: ConquestWaveEntry[] = [];

  // Selector cursor (supports both desktop hover and explicit touch selection)
  private selectorGroup = new THREE.Group();
  private selectorRingMesh: THREE.Mesh;
  private selectorRingMat: THREE.MeshBasicMaterial;
  private selectorPreviewGroup = new THREE.Group();
  private currentPreviewIndex = -1;
  private currentRotationDeg = DEFAULT_ROTATION_DEG;
  private toolMode: BuilderToolMode = 'expand';
  private hoveredCoord: AxialCoord | null = null;
  private selectedCoord: AxialCoord | null = null;
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

  // Desktop pointer + keyboard input state
  private keysHeld = new Set<string>();
  private isOrbitDragging = false;
  private lastDragX = 0;
  private pointerInside = false;
  private pointerClientX = 0;
  private pointerClientY = 0;
  private lastHoverRaycastTime = 0;

  // Touch multi-pointer gesture state (unified Pointer Events, zero duplicate touchstart/mousedown)
  private activeTouchPointers = new Map<number, ScreenPoint>();
  private touchStartPoint: ScreenPoint | null = null;
  private touchStartTime = 0;
  private touchHadMultiTouch = false;
  private touchIsPanning = false;
  private lastTouchActivityMs = 0;

  // Pop animations & pooled particles
  private popAnims: PopAnimEntry[] = [];
  private particlePoolSize: number;
  private particlesMesh: THREE.InstancedMesh;
  private particles: ParticleState[] = [];
  private particleCursor = 0;
  private activeParticleCount = 0;

  // Loop management
  private disposed = false;
  private frameId = 0;
  private lastFrameMs = 0;
  private lastRenderMs = 0;
  private resizeObserver: ResizeObserver;
  private elapsedSec = 0;

  constructor(container: HTMLElement, callbacks: HexSceneCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
    this.isSoftwareGl = detectSoftwareWebGL();
    this.quality = detectDeviceQualityProfile(this.isSoftwareGl);
    this.particlePoolSize = this.quality.particlePoolSize;

    // Renderer (progressive quality per device tier, full crisp quality on desktop)
    this.renderer = new THREE.WebGLRenderer({
      antialias: this.quality.antialias,
      powerPreference:
        this.quality.tier === 'desktop-high' ? 'high-performance' : 'default',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.92;
    this.renderer.setPixelRatio(this.quality.pixelRatio);
    this.renderer.shadowMap.enabled = this.quality.shadowsEnabled;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const width = Math.max(container.clientWidth, 1);
    const height = Math.max(container.clientHeight, 1);
    this.renderer.setSize(width, height);
    const canvas = this.renderer.domElement;
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.touchAction = 'none';
    canvas.style.userSelect = 'none';
    container.appendChild(canvas);

    // Scene & Atmosphere (linear horizon fog keeps foreground island crisp and vivid)
    this.scene = new THREE.Scene();
    const skyColor = new THREE.Color(0x9bd2ee);
    this.scene.background = skyColor;
    this.scene.fog = new THREE.Fog(0x9bd2ee, 18, 66);

    // Studio RoomEnvironment for subtle PBR sheen without washing out pastel colormaps
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envRenderTarget = pmrem.fromScene(new RoomEnvironment(), 0.04);
    this.scene.environment = this.envRenderTarget.texture;
    this.scene.environmentIntensity = 0.32;
    pmrem.dispose();

    // Camera (portrait-aware starting distance so vertical phone frames the whole island cleanly)
    const aspect = width / height;
    const defaultDist = this.getDefaultCameraDistance(aspect);
    this.camDistance = defaultDist;
    this.camDistanceGoal = defaultDist;
    this.camera = new THREE.PerspectiveCamera(aspect < 0.8 ? 36 : 32, aspect, 0.1, 180);
    this.updateCameraTransform(1);

    // Warm/Cool 3-Point Outdoor Lighting Rig (1 shadow caster)
    const hemiLight = new THREE.HemisphereLight(0x8ecbf5, 0x566842, 0.58);
    hemiLight.position.set(0, 30, 0);
    this.scene.add(hemiLight);

    const sunLight = new THREE.DirectionalLight(0xfff1d0, 1.65);
    sunLight.position.set(14, 22, 12);
    if (this.quality.shadowsEnabled) {
      sunLight.castShadow = true;
      sunLight.shadow.mapSize.set(
        this.quality.shadowMapSize,
        this.quality.shadowMapSize
      );
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
    this.waterTexture = createWaterCanvasTexture(
      this.quality.waterTextureSize,
      maxAniso
    );
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
    this.waterMesh.receiveShadow = this.quality.shadowsEnabled;
    this.scene.add(this.waterMesh);

    // Subtle hex grid guide lines near island
    this.scene.add(buildSubtleHexGridLines(this.quality.gridGuideRings));

    // Placed hexes container
    this.scene.add(this.hexesGroup);

    // Territorial overlays: crisp royal-gold kingdom perimeter with dark backing + adjacent frontier highlight
    const trimMat = new THREE.MeshBasicMaterial({
      color: 0x1e2d24,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    this.territoryTrimMesh = new THREE.Mesh(new THREE.BufferGeometry(), trimMat);
    this.territoryTrimMesh.frustumCulled = false;
    this.scene.add(this.territoryTrimMesh);

    const borderMat = new THREE.MeshBasicMaterial({
      color: 0xfbbf24,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.territoryBorderMesh = new THREE.Mesh(new THREE.BufferGeometry(), borderMat);
    this.territoryBorderMesh.frustumCulled = false;
    this.scene.add(this.territoryBorderMesh);

    this.frontierOverlayMat = new THREE.MeshBasicMaterial({
      color: 0xf59e0b,
      transparent: true,
      opacity: 0.44,
      side: THREE.DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    this.frontierOverlayMesh = new THREE.Mesh(
      new THREE.BufferGeometry(),
      this.frontierOverlayMat
    );
    this.frontierOverlayMesh.frustumCulled = false;
    this.scene.add(this.frontierOverlayMesh);

    this.conquestRingGeo = createHexRingGeometry(
      HEX_OUTER_RADIUS * 1.03,
      HEX_OUTER_RADIUS * 0.8
    );

    // Selector cursor (hex ring elevated cleanly above the 0.20 tile surface + preview container)
    const ringGeo = createHexRingGeometry(
      HEX_OUTER_RADIUS * 1.03,
      HEX_OUTER_RADIUS * 0.83
    );
    this.selectorRingMat = new THREE.MeshBasicMaterial({
      color: 0xf59e0b,
      transparent: true,
      opacity: 0.96,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
    this.selectorRingMesh = new THREE.Mesh(ringGeo, this.selectorRingMat);
    this.selectorRingMesh.position.y = 0.22;
    this.selectorGroup.add(this.selectorRingMesh);
    this.selectorPreviewGroup.position.y = 0.26;
    this.selectorPreviewGroup.visible = false;
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
      this.particlePoolSize
    );
    this.particlesMesh.frustumCulled = false;
    for (let i = 0; i < this.particlePoolSize; i++) {
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

    // Asset loader (shared cache across all placed tiles)
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
    this.lastRenderMs = this.lastFrameMs;
    this.scheduleNextFrame();
  }

  private getDefaultCameraDistance(aspect: number): number {
    return aspect < 0.8 ? 15.6 : 11.2;
  }

  public getQualityProfile(): RenderQualityProfile {
    return this.quality;
  }

  private bindEvents() {
    const el = this.renderer.domElement;
    el.addEventListener('pointermove', this.onPointerMove);
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointerleave', this.onPointerLeave);
    el.addEventListener('pointercancel', this.onPointerCancel);
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
    el.removeEventListener('pointercancel', this.onPointerCancel);
    el.removeEventListener('wheel', this.onWheel);
    el.removeEventListener('contextmenu', this.onContextMenu);
    el.removeEventListener('webglcontextlost', this.onContextLost);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onWindowBlur);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
  }

  private resetTransientInput() {
    this.keysHeld.clear();
    this.isOrbitDragging = false;
    this.activeTouchPointers.clear();
    this.touchStartPoint = null;
    this.touchIsPanning = false;
    this.touchHadMultiTouch = false;
  }

  private onContextLost = (e: Event) => {
    e.preventDefault();
  };

  private onContextMenu = (e: MouseEvent) => {
    e.preventDefault();
  };

  private onWindowBlur = () => {
    this.resetTransientInput();
  };

  private onVisibilityChange = () => {
    if (document.hidden) {
      this.resetTransientInput();
    } else {
      this.lastFrameMs = performance.now();
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

  private raycastGroundCoord(clientX: number, clientY: number): AxialCoord | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    _ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    _ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;

    _raycaster.setFromCamera(_ndc, this.camera);
    const hit = _raycaster.ray.intersectPlane(_groundPlane, _hitPoint);
    if (!hit) return null;

    return worldToAxial(_hitPoint.x, _hitPoint.z);
  }

  private applyPanScreenDelta(screenDx: number, screenDy: number) {
    const height = Math.max(this.container.clientHeight, 320);
    const { dx, dz } = screenPanToWorldDelta(
      screenDx,
      screenDy,
      height,
      this.camDistance,
      this.camYaw
    );
    this.camTargetGoal.x = THREE.MathUtils.clamp(
      this.camTargetGoal.x + dx,
      -CAMERA_PAN_BOUND,
      CAMERA_PAN_BOUND
    );
    this.camTargetGoal.z = THREE.MathUtils.clamp(
      this.camTargetGoal.z + dz,
      -CAMERA_PAN_BOUND,
      CAMERA_PAN_BOUND
    );
  }

  private onPointerDown = (e: PointerEvent) => {
    if (this.gameState !== 'playing') return;

    // Touch path: 1-finger pan / clean tap, 2-finger pinch + twist + midpoint pan
    if (e.pointerType === 'touch') {
      e.preventDefault();
      this.lastTouchActivityMs = performance.now();
      try {
        this.renderer.domElement.setPointerCapture(e.pointerId);
      } catch {
        // Ignore if pointer capture is unsupported in synthetic browser tests
      }

      const pt: ScreenPoint = { x: e.clientX, y: e.clientY };
      this.activeTouchPointers.set(e.pointerId, pt);

      if (this.activeTouchPointers.size === 1) {
        this.touchStartPoint = pt;
        this.touchStartTime = performance.now();
        this.touchHadMultiTouch = false;
        this.touchIsPanning = false;
      } else {
        this.touchHadMultiTouch = true;
        this.touchIsPanning = false;
      }
      return;
    }

    // Desktop mouse / pen path (100% preserved)
    if (e.button === 1 || (e.button === 0 && (e.shiftKey || e.altKey))) {
      e.preventDefault();
      this.isOrbitDragging = true;
      this.lastDragX = e.clientX;
      return;
    }

    if (e.button === 2) {
      e.preventDefault();
      this.callbacks.onRotate();
      return;
    }

    if (e.button === 0) {
      this.updateHoverFromPointer(e.clientX, e.clientY);
      if (!this.hoveredCoord) return;
      if (this.toolMode === 'expand') {
        this.callbacks.onSelectHexAt(this.hoveredCoord.q, this.hoveredCoord.r);
      } else if (this.toolMode === 'demolish') {
        this.callbacks.onDemolishAt(this.hoveredCoord.q, this.hoveredCoord.r);
      } else {
        this.callbacks.onPlaceAt(this.hoveredCoord.q, this.hoveredCoord.r);
      }
    }
  };

  private onPointerMove = (e: PointerEvent) => {
    if (e.pointerType === 'touch') {
      if (this.gameState !== 'playing') return;
      const prevPt = this.activeTouchPointers.get(e.pointerId);
      if (!prevPt) return;

      e.preventDefault();
      this.lastTouchActivityMs = performance.now();
      const currPt: ScreenPoint = { x: e.clientX, y: e.clientY };

      if (this.activeTouchPointers.size === 1) {
        if (!this.touchIsPanning && this.touchStartPoint) {
          if (pointDistance(this.touchStartPoint, currPt) > TOUCH_TAP_MAX_MOVEMENT_PX) {
            this.touchIsPanning = true;
          }
        }
        if (this.touchIsPanning) {
          this.applyPanScreenDelta(currPt.x - prevPt.x, currPt.y - prevPt.y);
        }
        this.activeTouchPointers.set(e.pointerId, currPt);
        return;
      }

      if (this.activeTouchPointers.size >= 2) {
        const entries = Array.from(this.activeTouchPointers.entries());
        const [idA, oldA] = entries[0];
        const [idB, oldB] = entries[1];

        const nextA = idA === e.pointerId ? currPt : oldA;
        const nextB = idB === e.pointerId ? currPt : oldB;

        const gesture = computeTwoFingerGestureDelta(
          oldA,
          oldB,
          nextA,
          nextB,
          this.camDistanceGoal
        );

        this.zoomBy(gesture.zoomDelta);
        if (gesture.yawDeltaRad !== 0) {
          this.camYawGoal += gesture.yawDeltaRad;
        }
        if (gesture.panScreenDx !== 0 || gesture.panScreenDy !== 0) {
          this.applyPanScreenDelta(gesture.panScreenDx, gesture.panScreenDy);
        }

        this.activeTouchPointers.set(e.pointerId, currPt);
      }
      return;
    }

    // Desktop mouse hover / orbit drag
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

  private onPointerUp = (e: PointerEvent) => {
    if (e.pointerType === 'touch') {
      if (!this.activeTouchPointers.has(e.pointerId)) return;
      this.lastTouchActivityMs = performance.now();

      const wasLastFinger = this.activeTouchPointers.size === 1;
      const endPt: ScreenPoint = { x: e.clientX, y: e.clientY };

      if (
        wasLastFinger &&
        this.gameState === 'playing' &&
        this.touchStartPoint &&
        isCleanTap(
          this.touchStartPoint,
          endPt,
          performance.now() - this.touchStartTime,
          this.touchHadMultiTouch
        )
      ) {
        const coord = this.raycastGroundCoord(e.clientX, e.clientY);
        if (coord) {
          this.callbacks.onTouchTapAt(coord.q, coord.r);
        }
      }

      this.activeTouchPointers.delete(e.pointerId);
      if (this.activeTouchPointers.size === 0) {
        this.touchStartPoint = null;
        this.touchIsPanning = false;
        this.touchHadMultiTouch = false;
      }
      return;
    }

    this.isOrbitDragging = false;
  };

  private onPointerCancel = (e: PointerEvent) => {
    if (e.pointerType === 'touch') {
      this.activeTouchPointers.delete(e.pointerId);
      if (this.activeTouchPointers.size === 0) {
        this.touchStartPoint = null;
        this.touchIsPanning = false;
        this.touchHadMultiTouch = false;
      }
    }
  };

  private onPointerLeave = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return;
    this.pointerInside = false;
    this.hoveredCoord = null;
    this.refreshSelectorAnchor();
    this.callbacks.onHoverChange(null, null);
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
    const coord = this.raycastGroundCoord(clientX, clientY);
    if (!coord) {
      this.hoveredCoord = null;
      this.refreshSelectorAnchor();
      this.callbacks.onHoverChange(null, null);
      return;
    }

    const changed =
      !this.hoveredCoord ||
      this.hoveredCoord.q !== coord.q ||
      this.hoveredCoord.r !== coord.r;

    this.hoveredCoord = coord;
    this.refreshSelectorAnchor();
    if (changed) {
      const existing =
        this.currentWorldState.hexes[hexKey(coord.q, coord.r)] ?? null;
      this.callbacks.onHoverChange(coord, existing);
    }
  }

  private refreshSelectorAnchor() {
    if (this.gameState !== 'playing') {
      this.selectorGroup.visible = false;
      return;
    }

    const activeCoord = this.selectedCoord ?? this.hoveredCoord;
    if (!activeCoord) {
      this.selectorGroup.visible = false;
      return;
    }

    const worldPos = axialToWorld(activeCoord.q, activeCoord.r);
    const hasTile = Boolean(
      this.currentWorldState.hexes[hexKey(activeCoord.q, activeCoord.r)]
    );
    this.selectorGroup.position.set(worldPos.x, 0, worldPos.z);
    this.selectorRingMesh.position.y = hasTile ? 0.222 : 0.042;
    this.selectorGroup.visible = true;

    if (this.toolMode === 'expand') {
      const check = evaluateConquest(
        this.currentWorldState,
        activeCoord.q,
        activeCoord.r
      );
      if (check.owner === 'player') {
        this.selectorRingMat.color.setHex(0x10b981); // emerald: already owned
      } else if (check.canConquer) {
        this.selectorRingMat.color.setHex(0xf59e0b); // bright gold: conquerable!
      } else if (check.reason === 'insufficient_funds') {
        this.selectorRingMat.color.setHex(0xea580c); // warm orange: adjacent but lacks cash
      } else {
        this.selectorRingMat.color.setHex(0x64748b); // muted slate: distant neutral
      }
    } else if (this.toolMode === 'demolish') {
      this.selectorRingMat.color.setHex(0xdc2626);
    } else {
      this.selectorRingMat.color.setHex(0x059669);
    }
  }

  public setSelectedHex(coord: AxialCoord | null) {
    this.selectedCoord = coord;
    this.refreshSelectorAnchor();
  }

  public getHoveredCoord(): AxialCoord | null {
    return this.selectedCoord ?? this.hoveredCoord;
  }

  public setGameState(next: GameModeState) {
    const prev = this.gameState;
    this.gameState = next;
    this.resetTransientInput();

    if (next === 'playing' && prev === 'title') {
      const aspect =
        Math.max(this.container.clientWidth, 1) /
        Math.max(this.container.clientHeight, 1);
      this.camTargetGoal.set(0, 0, 0);
      this.camYawGoal = Math.PI / 4;
      this.camDistanceGoal = this.getDefaultCameraDistance(aspect);
      if (this.pointerInside) {
        this.updateHoverFromPointer(this.pointerClientX, this.pointerClientY);
      }
    }

    this.refreshSelectorAnchor();
  }

  public setToolMode(mode: BuilderToolMode) {
    this.toolMode = mode;
    this.selectorPreviewGroup.visible = mode === 'build';
    this.frontierOverlayMesh.visible = true;
    this.refreshSelectorAnchor();
  }

  public centerCamera() {
    const aspect =
      Math.max(this.container.clientWidth, 1) /
      Math.max(this.container.clientHeight, 1);
    this.camTargetGoal.set(0, 0, 0);
    this.camDistanceGoal = this.getDefaultCameraDistance(aspect);
  }

  public zoomBy(delta: number) {
    this.camDistanceGoal = THREE.MathUtils.clamp(
      this.camDistanceGoal + delta,
      CAMERA_MIN_DIST,
      CAMERA_MAX_DIST
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
          let meshOrdinal = 0;
          root.traverse((obj) => {
            if ((obj as THREE.Mesh).isMesh) {
              const mesh = obj as THREE.Mesh;
              mesh.castShadow = this.quality.shadowsEnabled;
              mesh.receiveShadow = this.quality.shadowsEnabled;
              const mat = mesh.material;
              if (mat && 'envMapIntensity' in mat) {
                (mat as THREE.MeshStandardMaterial).envMapIntensity = 0.28;
              }
              // Store only a plain string key in userData so Object3D.clone()
              // (which JSON-clones userData) never corrupts THREE.Material instances.
              const matKey = `${assetName}:${meshOrdinal++}`;
              mesh.userData.ownerMatKey = matKey;
              this.ownerMaterialPairs.set(matKey, {
                owned: mat,
                neutral: createNeutralMaterialVariant(mat),
              });
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

  private applyOwnerMaterials(group: THREE.Object3D, owner: HexOwner) {
    group.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh;
        const matKey = mesh.userData?.ownerMatKey as string | undefined;
        if (!matKey) return;
        const pair = this.ownerMaterialPairs.get(matKey);
        if (!pair) return;
        mesh.material = owner === 'player' ? pair.owned : pair.neutral;
      }
    });
  }

  private rebuildTerritoryOverlays(state: HexWorldState) {
    const oldTrim = this.territoryTrimMesh.geometry;
    const oldBorder = this.territoryBorderMesh.geometry;
    const oldFrontier = this.frontierOverlayMesh.geometry;

    this.territoryTrimMesh.geometry = buildTerritoryPerimeterGeometry(
      state,
      HEX_OUTER_RADIUS * 1.03,
      HEX_OUTER_RADIUS * 0.875,
      0.212
    );
    this.territoryBorderMesh.geometry = buildTerritoryPerimeterGeometry(
      state,
      HEX_OUTER_RADIUS * 1.005,
      HEX_OUTER_RADIUS * 0.9,
      0.216
    );
    this.frontierOverlayMesh.geometry = buildConquerableFrontierGeometry(state);

    oldTrim.dispose();
    oldBorder.dispose();
    oldFrontier.dispose();
  }

  private spawnConquestWave(x: number, z: number) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xfbbf24,
      transparent: true,
      opacity: 0.95,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(this.conquestRingGeo, mat);
    mesh.position.set(x, 0.23, z);
    mesh.scale.setScalar(0.95);
    this.scene.add(mesh);
    this.conquestWaves.push({ mesh, material: mat, progress: 0, baseY: 0.23 });
  }

  public async syncWorldState(
    nextState: HexWorldState,
    animateNewKeys?: string[],
    conqueredKeys?: string[]
  ) {
    this.currentWorldState = nextState;
    const animSet = new Set(animateNewKeys ?? []);
    const conquestSet = new Set(conqueredKeys ?? []);

    // Update territory border ribbon and conquerable frontier immediately
    this.rebuildTerritoryOverlays(nextState);
    this.refreshSelectorAnchor();

    // Update or remove existing meshes
    for (const [key, entry] of this.placedMeshes.entries()) {
      const target = nextState.hexes[key];
      if (!target || target.structureIndex !== entry.structureIndex) {
        this.hexesGroup.remove(entry.group);
        this.placedMeshes.delete(key);
        if (!target && animSet.has(key)) {
          const pos = entry.group.position;
          this.spawnParticleBurst(pos.x, 0.25, pos.z, 0xdc2626, 8);
        }
      } else {
        if (target.orientation !== entry.orientation) {
          entry.group.rotation.y = THREE.MathUtils.degToRad(target.orientation);
          entry.orientation = target.orientation;
          if (animSet.has(key)) {
            this.popAnims.push({ mesh: entry.group, progress: 0 });
          }
        }
        const nextOwner: HexOwner = target.owner === 'player' ? 'player' : 'neutral';
        if (nextOwner !== entry.owner) {
          entry.owner = nextOwner;
          this.applyOwnerMaterials(entry.group, nextOwner);
          if (conquestSet.has(key)) {
            const pos = entry.group.position;
            entry.group.scale.set(1.12, 0.65, 1.12);
            this.popAnims.push({ mesh: entry.group, progress: 0 });
            this.spawnConquestWave(pos.x, pos.z);
            this.spawnParticleBurst(pos.x, 0.26, pos.z, 0xfbbf24, 12);
          }
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
      const liveTile = this.currentWorldState.hexes[key];
      if (!liveTile || liveTile.structureIndex !== tile.structureIndex) continue;
      if (this.placedMeshes.has(key)) continue;

      const asset = HEX_ASSETS[tile.structureIndex];
      if (!asset) continue;
      const template = this.modelCache.get(asset.name);
      if (!template) continue;

      const owner: HexOwner = liveTile.owner === 'player' ? 'player' : 'neutral';
      const group = new THREE.Group();
      const clone = template.clone(true);
      this.applyOwnerMaterials(clone, owner);
      group.add(clone);

      const pos = axialToWorld(tile.q, tile.r);
      group.position.set(pos.x, 0, pos.z);
      group.rotation.y = THREE.MathUtils.degToRad(tile.orientation);
      this.hexesGroup.add(group);

      this.placedMeshes.set(key, {
        group,
        structureIndex: tile.structureIndex,
        orientation: tile.orientation,
        owner,
      });

      if (conquestSet.has(key)) {
        group.scale.set(1.12, 0.55, 1.12);
        this.popAnims.push({ mesh: group, progress: 0 });
        this.spawnConquestWave(pos.x, pos.z);
        this.spawnParticleBurst(pos.x, 0.24, pos.z, 0xfbbf24, 12);
      } else if (animSet.has(key)) {
        group.scale.set(1.12, 0.55, 1.12);
        this.popAnims.push({ mesh: group, progress: 0 });
        this.spawnParticleBurst(pos.x, 0.18, pos.z, 0xfef3c7, 10);
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
    const cappedCount = Math.min(count, this.particlePoolSize);
    for (let i = 0; i < cappedCount; i++) {
      const idx = this.particleCursor;
      const p = this.particles[idx];
      this.particleCursor = (this.particleCursor + 1) % this.particlePoolSize;
      if (!p.active) this.activeParticleCount++;
      const angle = (Math.PI * 2 * i) / cappedCount + (Math.random() - 0.5) * 0.4;
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
      this.particlesMesh.setColorAt(idx, _colorTmp.setHex(hexColor));
    }
    if (this.particlesMesh.instanceColor) {
      this.particlesMesh.instanceColor.needsUpdate = true;
    }
  }

  private handleResize() {
    if (this.disposed) return;
    const width = Math.max(this.container.clientWidth, 1);
    const height = Math.max(this.container.clientHeight, 1);
    const aspect = width / height;
    this.camera.aspect = aspect;
    this.camera.fov = aspect < 0.8 ? 36 : 32;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  private isCameraSettling(): boolean {
    return (
      Math.abs(this.camTarget.x - this.camTargetGoal.x) > 0.003 ||
      Math.abs(this.camTarget.z - this.camTargetGoal.z) > 0.003 ||
      Math.abs(this.camYaw - this.camYawGoal) > 0.002 ||
      Math.abs(this.camDistance - this.camDistanceGoal) > 0.008
    );
  }

  private updateCameraTransform(dt: number) {
    const aspect =
      Math.max(this.container.clientWidth, 1) /
      Math.max(this.container.clientHeight, 1);

    if (this.gameState === 'title') {
      this.titleOrbitAngle += dt * 0.16;
      const isPortrait = aspect < 0.85;
      const dist = isPortrait ? 15.2 : 10.6;
      const pitch = isPortrait ? 0.62 : 0.56;
      const horiz = Math.cos(pitch) * dist;
      const y = Math.sin(pitch) * dist;
      // On desktop, offset left so the castle sits in right 2/3; on mobile portrait, center castle in upper frame
      const focusX = isPortrait ? 0 : -0.9;
      const focusZ = isPortrait ? 0.65 : -0.2;
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
          -CAMERA_PAN_BOUND,
          CAMERA_PAN_BOUND
        );
        this.camTargetGoal.z = THREE.MathUtils.clamp(
          this.camTargetGoal.z + worldDz * panSpeed,
          -CAMERA_PAN_BOUND,
          CAMERA_PAN_BOUND
        );
      }
    }

    // Tighter damping during active/recent touch gestures so camera never feels slippery
    const touchRecent = performance.now() - this.lastTouchActivityMs < 450;
    const targetDamp = touchRecent ? 18 : 10;
    const rotDamp = touchRecent ? 16 : 9;

    this.camTarget.x = THREE.MathUtils.damp(
      this.camTarget.x,
      this.camTargetGoal.x,
      targetDamp,
      dt
    );
    this.camTarget.z = THREE.MathUtils.damp(
      this.camTarget.z,
      this.camTargetGoal.z,
      targetDamp,
      dt
    );
    this.camYaw = THREE.MathUtils.damp(this.camYaw, this.camYawGoal, rotDamp, dt);
    this.camDistance = THREE.MathUtils.damp(
      this.camDistance,
      this.camDistanceGoal,
      rotDamp,
      dt
    );

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

    // Gentle preview float & frontier pulse
    if (this.selectorGroup.visible && this.selectorPreviewGroup.visible) {
      this.selectorPreviewGroup.position.y =
        0.22 + Math.sin(this.elapsedSec * 4) * 0.03;
    }

    if (this.toolMode === 'expand') {
      this.frontierOverlayMat.opacity = 0.36 + Math.sin(this.elapsedSec * 2.6) * 0.12;
    } else {
      this.frontierOverlayMat.opacity = 0.2;
    }

    // Conquest wave rings
    for (let i = this.conquestWaves.length - 1; i >= 0; i--) {
      const wave = this.conquestWaves[i];
      wave.progress += dt * 2.2;
      if (wave.progress >= 1) {
        this.scene.remove(wave.mesh);
        wave.material.dispose();
        this.conquestWaves.splice(i, 1);
      } else {
        const t = wave.progress;
        const easeOut = 1 - Math.pow(1 - t, 3);
        wave.mesh.scale.setScalar(0.95 + easeOut * 0.62);
        wave.mesh.position.y = wave.baseY + easeOut * 0.42;
        wave.material.opacity = (1 - t) * 0.92;
      }
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

    // Pooled particles (early-out when pool is completely idle)
    if (this.activeParticleCount <= 0) return;

    let anyParticleUpdated = false;
    for (let i = 0; i < this.particlePoolSize; i++) {
      const p = this.particles[i];
      if (!p.active) continue;
      anyParticleUpdated = true;
      p.age += dt;
      if (p.age >= p.life) {
        p.active = false;
        this.activeParticleCount = Math.max(0, this.activeParticleCount - 1);
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
        const status = sync
          ? gl.getSyncParameter(sync, gl.SYNC_STATUS)
          : gl.SIGNALED;
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

  private isSceneActive(): boolean {
    return (
      this.gameState === 'title' ||
      this.activeTouchPointers.size > 0 ||
      this.keysHeld.size > 0 ||
      this.isOrbitDragging ||
      this.popAnims.length > 0 ||
      this.conquestWaves.length > 0 ||
      this.activeParticleCount > 0 ||
      this.isCameraSettling()
    );
  }

  private tick = () => {
    if (this.disposed) return;

    if (document.hidden) {
      this.scheduleNextFrame();
      return;
    }

    const now = performance.now();

    // Battery-friendly idle frame throttling on real mobile devices (zero impact when interacting or on desktop)
    if (
      !this.isSoftwareGl &&
      this.quality.idleFrameIntervalMs > 0 &&
      !this.isSceneActive() &&
      now - this.lastRenderMs < this.quality.idleFrameIntervalMs
    ) {
      this.scheduleNextFrame();
      return;
    }

    const rawDt = (now - this.lastFrameMs) / 1000;
    this.lastFrameMs = now;
    this.lastRenderMs = now;
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

    // Deduplicate shared geometries/materials before disposal (safe with cloned GLB templates)
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();

    const addMat = (mat: THREE.Material | THREE.Material[] | undefined) => {
      if (!mat) return;
      if (Array.isArray(mat)) mat.forEach((m) => materials.add(m));
      else materials.add(mat);
    };

    const collectResources = (root: THREE.Object3D) => {
      root.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) {
          geometries.add(mesh.geometry);
        }
        addMat(mesh.material as THREE.Material | THREE.Material[] | undefined);
      });
    };

    collectResources(this.scene);
    for (const template of this.modelCache.values()) {
      collectResources(template);
    }
    for (const pair of this.ownerMaterialPairs.values()) {
      addMat(pair.owned);
      addMat(pair.neutral);
    }

    geometries.add(this.conquestRingGeo);
    geometries.forEach((g) => g.dispose());
    materials.forEach((m) => m.dispose());

    this.conquestWaves = [];
    this.ownerMaterialPairs.clear();
    this.modelCache.clear();
    this.placedMeshes.clear();
    this.envRenderTarget?.dispose();
    this.waterTexture.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
