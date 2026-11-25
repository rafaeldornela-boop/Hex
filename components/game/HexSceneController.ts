import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  DEFAULT_ROTATION_DEG,
  HEX_OUTER_RADIUS,
  HEX_WORLD_SCALE,
  axialToWorld,
  hasHexConstruction,
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
  type HexOwner,
} from '@/lib/territory-engine';
import {
  getHexTerrainAndResource,
  getStrategicRegionInfo,
} from '@/lib/terrain-engine';
import { isBuildingAllowedOnTerrain } from '@/lib/build-rules';
import type { UnitEntity } from '@/lib/military-engine';
import { HEX_ASSETS } from '@/lib/repo-data';

export type GameModeState = 'title' | 'playing' | 'paused';
export type BuilderToolMode = 'expand' | 'build' | 'demolish' | 'command';

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

interface CachedSubMesh {
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
  localMatrix: THREE.Matrix4;
}

const CAMERA_MIN_DIST = 6.5;
const CAMERA_MAX_DIST = 54;
const CAMERA_PAN_BOUND_X = 24;
const CAMERA_PAN_BOUND_Z = 27;
const TILE_SURFACE_Y = 0.2 * HEX_WORLD_SCALE;

// Pre-allocated scratch helpers (zero GC inside animation loop)
const _raycaster = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
const _groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _hitPoint = new THREE.Vector3();
const _moveVec = new THREE.Vector3();
const _dummy = new THREE.Object3D();
const _tileMatrix = new THREE.Matrix4();
const _finalMatrix = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _yAxis = new THREE.Vector3(0, 1, 0);
const _posVec = new THREE.Vector3();
const _scaleVec = new THREE.Vector3(HEX_WORLD_SCALE, HEX_WORLD_SCALE, HEX_WORLD_SCALE);
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

function buildHexGridGeometryFromState(
  state: HexWorldState,
  fallbackRings: number
): THREE.BufferGeometry {
  const positions: number[] = [];
  const r = HEX_OUTER_RADIUS;
  const tiles = Object.values(state.hexes);

  if (tiles.length > 0) {
    for (const tile of tiles) {
      const center = axialToWorld(tile.q, tile.r);
      for (let side = 0; side < 6; side++) {
        const a0 = (Math.PI / 3) * side;
        const a1 = (Math.PI / 3) * ((side + 1) % 6);
        positions.push(
          center.x + Math.cos(a0) * r,
          0.02,
          center.z + Math.sin(a0) * r,
          center.x + Math.cos(a1) * r,
          0.02,
          center.z + Math.sin(a1) * r
        );
      }
    }
  } else {
    for (let q = -fallbackRings; q <= fallbackRings; q++) {
      const r1 = Math.max(-fallbackRings, -q - fallbackRings);
      const r2 = Math.min(fallbackRings, -q + fallbackRings);
      for (let row = r1; row <= r2; row++) {
        const center = axialToWorld(q, row);
        for (let side = 0; side < 6; side++) {
          const a0 = (Math.PI / 3) * side;
          const a1 = (Math.PI / 3) * ((side + 1) % 6);
          positions.push(
            center.x + Math.cos(a0) * r,
            0.02,
            center.z + Math.sin(a0) * r,
            center.x + Math.cos(a1) * r,
            0.02,
            center.z + Math.sin(a1) * r
          );
        }
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return geo;
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
  y: number,
  targetOwner: HexOwner = 'player'
): THREE.BufferGeometry {
  const positions: number[] = [];

  for (const tile of Object.values(state.hexes)) {
    if (tile.owner !== targetOwner) continue;
    const center = axialToWorld(tile.q, tile.r);
    for (let edge = 0; edge < 6; edge++) {
      const dir = AXIAL_DIRECTIONS[edge];
      const nKey = hexKey(tile.q + dir.q, tile.r + dir.r);
      if (state.hexes[nKey]?.owner !== targetOwner) {
        appendHexEdgeQuad(positions, center.x, center.z, y, edge, outerR, innerR);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return geo;
}

function buildCoordRingOverlayGeometry(
  state: HexWorldState,
  keys: Iterable<string>,
  outerR: number,
  innerR: number,
  tileYOffset: number,
  emptyY: number
): THREE.BufferGeometry {
  const positions: number[] = [];

  for (const key of keys) {
    const parts = key.split(',');
    if (parts.length !== 2) continue;
    const q = Number(parts[0]);
    const r = Number(parts[1]);
    if (!Number.isFinite(q) || !Number.isFinite(r)) continue;

    const center = axialToWorld(q, r);
    const hasTile = Boolean(state.hexes[key]);
    const y = hasTile ? TILE_SURFACE_Y + tileYOffset : emptyY;
    for (let edge = 0; edge < 6; edge++) {
      appendHexEdgeQuad(positions, center.x, center.z, y, edge, outerR, innerR);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return geo;
}

const BASE_FERTILE_VISUAL_ASSETS = new Set(['dirt', 'grass', 'grass-hill']);

/**
 * Single batched geometry drawing cultivated crop-furrow strips across
 * unbuilt Terra fértil hexes so players immediately distinguish fertile soil
 * from open plains or desert sand without extra draw calls.
 */
function buildFertileFurrowsGeometry(state: HexWorldState): THREE.BufferGeometry {
  const positions: number[] = [];
  const y = TILE_SURFACE_Y + 0.01;
  const halfLen = 0.28 * HEX_WORLD_SCALE;
  const halfWidth = 0.028 * HEX_WORLD_SCALE;
  const offsets = [
    -0.21 * HEX_WORLD_SCALE,
    -0.07 * HEX_WORLD_SCALE,
    0.07 * HEX_WORLD_SCALE,
    0.21 * HEX_WORLD_SCALE,
  ];

  for (const tile of Object.values(state.hexes)) {
    const terrainInfo = getHexTerrainAndResource(tile.q, tile.r, tile);
    if (terrainInfo.terrainType !== 'fertile') continue;
    const assetName = HEX_ASSETS[tile.structureIndex]?.name ?? '';
    if (!BASE_FERTILE_VISUAL_ASSETS.has(assetName)) continue;

    const center = axialToWorld(tile.q, tile.r);
    for (const dz of offsets) {
      const lenScale = Math.abs(dz) > 0.15 * HEX_WORLD_SCALE ? 0.72 : 1.0;
      const hx = halfLen * lenScale;
      const x0 = center.x - hx;
      const x1 = center.x + hx;
      const z0 = center.z + dz - halfWidth;
      const z1 = center.z + dz + halfWidth;

      positions.push(
        x0, y, z0,
        x1, y, z0,
        x1, y, z1,
        x0, y, z0,
        x1, y, z1,
        x0, y, z1
      );
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return geo;
}

function createTintedMaterialVariant(
  mat: THREE.Material | THREE.Material[],
  tintHex: number,
  extraRoughness = 0.04,
  opacity?: number
): THREE.Material | THREE.Material[] {
  const tint = new THREE.Color(tintHex);
  const cloneOne = (m: THREE.Material): THREE.Material => {
    const cloned = m.clone();
    if ('color' in cloned && cloned.color instanceof THREE.Color) {
      cloned.color.multiply(tint);
    }
    if (
      extraRoughness !== 0 &&
      'roughness' in cloned &&
      typeof (cloned as THREE.MeshStandardMaterial).roughness === 'number'
    ) {
      (cloned as THREE.MeshStandardMaterial).roughness = Math.min(
        1,
        (cloned as THREE.MeshStandardMaterial).roughness + extraRoughness
      );
    }
    if (typeof opacity === 'number' && opacity < 1) {
      cloned.transparent = true;
      cloned.opacity = opacity;
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
  private terrainSubMeshes = new Map<string, CachedSubMesh[]>();
  private ownerMaterialPairs = new Map<
    string,
    {
      owned: THREE.Material | THREE.Material[];
      neutral: THREE.Material | THREE.Material[];
      ironClan: THREE.Material | THREE.Material[];
      azureLeague: THREE.Material | THREE.Material[];
      underConstruction: THREE.Material | THREE.Material[];
    }
  >();
  private loadingPromises = new Map<string, Promise<THREE.Group>>();
  private terrainInstancesGroup = new THREE.Group();
  private hexesGroup = new THREE.Group();
  private gridLinesMesh: THREE.LineSegments;
  private lastGridTileCount = -1;
  private placedMeshes = new Map<
    string,
    {
      group: THREE.Group;
      structureIndex: number;
      orientation: number;
      owner: HexOwner;
      underConstruction: boolean;
    }
  >();

  // Territorial borders, influence aura & active/expandable frontier overlays
  private territoryTrimMesh: THREE.Mesh;
  private territoryBorderMesh: THREE.Mesh;
  private ironClanBorderMesh: THREE.Mesh;
  private azureLeagueBorderMesh: THREE.Mesh;
  private frontierOverlayMesh: THREE.Mesh;
  private frontierOverlayMat: THREE.MeshBasicMaterial;
  private expandingOverlayMesh: THREE.Mesh;
  private expandingOverlayMat: THREE.MeshBasicMaterial;
  private influenceOverlayMesh: THREE.Mesh;
  private influenceOverlayMat: THREE.MeshBasicMaterial;
  private expandableKeys = new Set<string>();
  private expandingKeys = new Set<string>();
  private influenceKeys = new Set<string>();
  private lastExpansionSignature = '';
  private fertileOverlayMesh: THREE.Mesh;
  private underConstructionOverlayMesh: THREE.Mesh;
  private attentionOverlayMesh: THREE.Mesh;
  private lastAttentionSignature = '';
  private rareMarkersGroup = new THREE.Group();
  private unitsGroup = new THREE.Group();
  private unitTargetOverlayMesh: THREE.Mesh;
  private conquestRingGeo: THREE.BufferGeometry;
  private conquestWaves: ConquestWaveEntry[] = [];
  private commandValidTargets = new Set<string>();

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
  private homeCoord: AxialCoord = { q: 0, r: 0 };

  // Camera state
  private sunLight: THREE.DirectionalLight;
  private gameState: GameModeState = 'title';
  private titleOrbitAngle = 0.65;
  private camTarget = new THREE.Vector3(0, 0, 0);
  private camTargetGoal = new THREE.Vector3(0, 0, 0);
  private camYaw = Math.PI / 4; // 45° isometric view
  private camYawGoal = Math.PI / 4;
  private camDistance = 15.5;
  private camDistanceGoal = 15.5;
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

    // Scene & Atmosphere (wide horizon fog supports regional zoom-out across 32x32 world)
    this.scene = new THREE.Scene();
    const skyColor = new THREE.Color(0x9bd2ee);
    this.scene.background = skyColor;
    this.scene.fog = new THREE.Fog(0x9bd2ee, 36, 130);

    // Studio RoomEnvironment for subtle PBR sheen without washing out pastel colormaps
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envRenderTarget = pmrem.fromScene(new RoomEnvironment(), 0.04);
    this.scene.environment = this.envRenderTarget.texture;
    this.scene.environmentIntensity = 0.32;
    pmrem.dispose();

    // Camera (close enough for readable hex details while framing regional context)
    const aspect = width / height;
    const defaultDist = this.getDefaultCameraDistance(aspect);
    this.camDistance = defaultDist;
    this.camDistanceGoal = defaultDist;
    this.camera = new THREE.PerspectiveCamera(aspect < 0.8 ? 36 : 32, aspect, 0.1, 260);

    // Warm/Cool 3-Point Outdoor Lighting Rig (1 shadow caster following camTarget)
    const hemiLight = new THREE.HemisphereLight(0x8ecbf5, 0x566842, 0.58);
    hemiLight.position.set(0, 30, 0);
    this.scene.add(hemiLight);

    this.sunLight = new THREE.DirectionalLight(0xfff1d0, 1.65);
    this.sunLight.position.set(14, 24, 12);
    if (this.quality.shadowsEnabled) {
      this.sunLight.castShadow = true;
      this.sunLight.shadow.mapSize.set(
        this.quality.shadowMapSize,
        this.quality.shadowMapSize
      );
      const d = 18;
      this.sunLight.shadow.camera.left = -d;
      this.sunLight.shadow.camera.right = d;
      this.sunLight.shadow.camera.top = d;
      this.sunLight.shadow.camera.bottom = -d;
      this.sunLight.shadow.camera.near = 2;
      this.sunLight.shadow.camera.far = 75;
      this.sunLight.shadow.bias = -0.0005;
      this.sunLight.shadow.normalBias = 0.02;
    }
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);
    this.updateCameraTransform(1);

    const rimLight = new THREE.DirectionalLight(0xbbe0ff, 0.28);
    rimLight.position.set(-14, 10, -14);
    this.scene.add(rimLight);

    // Expansive ocean surface extending to horizon fog
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    this.waterTexture = createWaterCanvasTexture(
      this.quality.waterTextureSize,
      maxAniso
    );
    this.waterTexture.repeat.set(38, 38);
    const waterGeo = new THREE.PlaneGeometry(420, 420);
    waterGeo.rotateX(-Math.PI / 2);
    const waterMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: this.waterTexture,
      roughness: 0.42,
      metalness: 0.06,
    });
    this.waterMesh = new THREE.Mesh(waterGeo, waterMat);
    this.waterMesh.position.y = -0.025 * HEX_WORLD_SCALE;
    this.waterMesh.receiveShadow = this.quality.shadowsEnabled;
    this.scene.add(this.waterMesh);

    // Subtle hex grid guide lines aligned to generated world tiles
    this.gridLinesMesh = new THREE.LineSegments(
      buildHexGridGeometryFromState(this.currentWorldState, this.quality.gridGuideRings),
      new THREE.LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.16,
        depthWrite: false,
      })
    );
    this.scene.add(this.gridLinesMesh);

    // Batched terrain instances & placed building meshes
    this.scene.add(this.terrainInstancesGroup);
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

    const ironBorderMat = new THREE.MeshBasicMaterial({
      color: 0xdc2626,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.ironClanBorderMesh = new THREE.Mesh(new THREE.BufferGeometry(), ironBorderMat);
    this.ironClanBorderMesh.frustumCulled = false;
    this.scene.add(this.ironClanBorderMesh);

    const azureBorderMat = new THREE.MeshBasicMaterial({
      color: 0x2563eb,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.azureLeagueBorderMesh = new THREE.Mesh(new THREE.BufferGeometry(), azureBorderMat);
    this.azureLeagueBorderMesh.frustumCulled = false;
    this.scene.add(this.azureLeagueBorderMesh);

    this.influenceOverlayMat = new THREE.MeshBasicMaterial({
      color: 0x2dd4bf,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    this.influenceOverlayMesh = new THREE.Mesh(
      new THREE.BufferGeometry(),
      this.influenceOverlayMat
    );
    this.influenceOverlayMesh.frustumCulled = false;
    this.scene.add(this.influenceOverlayMesh);

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

    this.expandingOverlayMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.72,
      side: THREE.DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.expandingOverlayMesh = new THREE.Mesh(
      new THREE.BufferGeometry(),
      this.expandingOverlayMat
    );
    this.expandingOverlayMesh.frustumCulled = false;
    this.scene.add(this.expandingOverlayMesh);

    const fertileMat = new THREE.MeshBasicMaterial({
      color: 0x4d7c0f,
      transparent: true,
      opacity: 0.76,
      side: THREE.DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    this.fertileOverlayMesh = new THREE.Mesh(
      new THREE.BufferGeometry(),
      fertileMat
    );
    this.fertileOverlayMesh.frustumCulled = false;
    this.scene.add(this.fertileOverlayMesh);

    const underConstructionMat = new THREE.MeshBasicMaterial({
      color: 0xd97706,
      transparent: true,
      opacity: 0.78,
      side: THREE.DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.underConstructionOverlayMesh = new THREE.Mesh(
      new THREE.BufferGeometry(),
      underConstructionMat
    );
    this.underConstructionOverlayMesh.frustumCulled = false;
    this.scene.add(this.underConstructionOverlayMesh);

    const attentionMat = new THREE.MeshBasicMaterial({
      color: 0xe11d48,
      transparent: true,
      opacity: 0.72,
      side: THREE.DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.attentionOverlayMesh = new THREE.Mesh(
      new THREE.BufferGeometry(),
      attentionMat
    );
    this.attentionOverlayMesh.frustumCulled = false;
    this.scene.add(this.attentionOverlayMesh);

    const unitTargetMat = new THREE.MeshBasicMaterial({
      color: 0x10b981,
      transparent: true,
      opacity: 0.65,
      side: THREE.DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.unitTargetOverlayMesh = new THREE.Mesh(
      new THREE.BufferGeometry(),
      unitTargetMat
    );
    this.unitTargetOverlayMesh.frustumCulled = false;
    this.scene.add(this.unitTargetOverlayMesh);

    this.scene.add(this.rareMarkersGroup);
    this.scene.add(this.unitsGroup);

    this.conquestRingGeo = createHexRingGeometry(
      HEX_OUTER_RADIUS * 1.03,
      HEX_OUTER_RADIUS * 0.8
    );

    // Selector cursor (hex ring elevated cleanly above scaled tile surface + preview container)
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
    this.selectorRingMesh.position.y = TILE_SURFACE_Y + 0.025;
    this.selectorGroup.add(this.selectorRingMesh);
    this.selectorPreviewGroup.position.y = TILE_SURFACE_Y + 0.06;
    this.selectorPreviewGroup.scale.setScalar(HEX_WORLD_SCALE);
    this.selectorPreviewGroup.visible = false;
    this.selectorGroup.add(this.selectorPreviewGroup);
    this.selectorGroup.visible = false;
    this.scene.add(this.selectorGroup);

    // Pooled instanced particles
    const particleGeo = new THREE.BoxGeometry(
      0.08 * HEX_WORLD_SCALE,
      0.08 * HEX_WORLD_SCALE,
      0.08 * HEX_WORLD_SCALE
    );
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
    return aspect < 0.8 ? 21.5 : 15.5;
  }

  private getHomeWorldPos(): { x: number; z: number } {
    return axialToWorld(this.homeCoord.q, this.homeCoord.r);
  }

  public setHomeCoord(coord: AxialCoord, snap = false) {
    this.homeCoord = { q: coord.q, r: coord.r };
    if (snap || this.gameState === 'title') {
      const home = this.getHomeWorldPos();
      this.camTarget.set(home.x, 0, home.z);
      this.camTargetGoal.set(home.x, 0, home.z);
      if (snap) {
        this.updateCameraTransform(1);
      }
    }
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
      const home = this.getHomeWorldPos();
      this.camTargetGoal.set(home.x, 0, home.z);
    } else if (e.code === 'Equal' || e.code === 'NumpadAdd') {
      this.zoomBy(-2.0);
    } else if (e.code === 'Minus' || e.code === 'NumpadSubtract') {
      this.zoomBy(2.0);
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
      -CAMERA_PAN_BOUND_X,
      CAMERA_PAN_BOUND_X
    );
    this.camTargetGoal.z = THREE.MathUtils.clamp(
      this.camTargetGoal.z + dz,
      -CAMERA_PAN_BOUND_Z,
      CAMERA_PAN_BOUND_Z
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
      if (this.toolMode === 'expand' || this.toolMode === 'command') {
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
    if (e.shiftKey) {
      this.callbacks.onCycleStructure(e.deltaY > 0 ? 1 : -1);
    } else {
      const zoomStep = e.ctrlKey || e.metaKey ? 1.4 : 2.4;
      this.zoomBy(e.deltaY > 0 ? zoomStep : -zoomStep);
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
    this.selectorRingMesh.position.y = hasTile ? TILE_SURFACE_Y + 0.025 : 0.045;
    this.selectorGroup.visible = true;

    if (this.toolMode === 'command') {
      const targetKey = hexKey(activeCoord.q, activeCoord.r);
      const existing = this.currentWorldState.hexes[targetKey];
      if (this.commandValidTargets.has(targetKey)) {
        const isEnemy =
          existing?.owner && existing.owner !== 'player' && existing.owner !== 'neutral';
        this.selectorRingMat.color.setHex(isEnemy ? 0xdc2626 : 0x10b981);
      } else {
        this.selectorRingMat.color.setHex(0x64748b);
      }
    } else if (this.toolMode === 'expand') {
      const targetKey = hexKey(activeCoord.q, activeCoord.r);
      const existing = this.currentWorldState.hexes[targetKey];
      const owner: HexOwner =
        typeof existing?.owner === 'string' && existing.owner.trim().length > 0
          ? existing.owner.trim()
          : 'neutral';
      if (owner === 'player') {
        this.selectorRingMat.color.setHex(0x10b981); // emerald: already owned
      } else if (owner !== 'neutral') {
        this.selectorRingMat.color.setHex(0xdc2626); // rival faction tile
      } else if (this.expandingKeys.has(targetKey)) {
        this.selectorRingMat.color.setHex(0x38bdf8); // sky blue: incorporation in progress
      } else if (this.expandableKeys.has(targetKey)) {
        this.selectorRingMat.color.setHex(0xf59e0b); // bright gold: ready to incorporate
      } else if (this.influenceKeys.has(targetKey)) {
        this.selectorRingMat.color.setHex(0xea580c); // warm amber: in influence sphere, needs requirement
      } else {
        this.selectorRingMat.color.setHex(0x64748b); // muted slate: outside frontier/reach
      }
    } else if (this.toolMode === 'demolish') {
      const existing = this.currentWorldState.hexes[hexKey(activeCoord.q, activeCoord.r)];
      const canDemolish =
        existing?.owner === 'player' && hasHexConstruction(existing, HEX_ASSETS);
      this.selectorRingMat.color.setHex(canDemolish ? 0xdc2626 : 0x64748b);
    } else {
      const existing = this.currentWorldState.hexes[hexKey(activeCoord.q, activeCoord.r)];
      const ownedByPlayer = existing?.owner === 'player';
      const occupied = hasHexConstruction(existing, HEX_ASSETS);
      const terrainInfo = getHexTerrainAndResource(activeCoord.q, activeCoord.r, existing);
      const activeAsset = HEX_ASSETS[this.currentPreviewIndex];
      const terrainAllowed =
        Boolean(activeAsset) &&
        isBuildingAllowedOnTerrain(activeAsset.name, terrainInfo.terrainType);
      this.selectorRingMat.color.setHex(
        ownedByPlayer && !occupied && terrainAllowed ? 0x059669 : 0xdc2626
      );
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
      const home = this.getHomeWorldPos();
      this.camTargetGoal.set(home.x, 0, home.z);
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
    const home = this.getHomeWorldPos();
    this.camTargetGoal.set(home.x, 0, home.z);
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
      this.refreshSelectorAnchor();
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
          root.updateMatrixWorld(true);
          const rootInv = root.matrixWorld.clone().invert();
          const subMeshes: CachedSubMesh[] = [];
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
              const localMatrix = rootInv.clone().multiply(mesh.matrixWorld);
              subMeshes.push({
                geometry: mesh.geometry,
                material: mat,
                localMatrix,
              });
              // Store only a plain string key in userData so Object3D.clone()
              // (which JSON-clones userData) never corrupts THREE.Material instances.
              const matKey = `${assetName}:${meshOrdinal++}`;
              mesh.userData.ownerMatKey = matKey;
              this.ownerMaterialPairs.set(matKey, {
                owned: mat,
                neutral: createTintedMaterialVariant(mat, 0x8fa7be, 0.1),
                ironClan: createTintedMaterialVariant(mat, 0xf2b5b5, 0.02),
                azureLeague: createTintedMaterialVariant(mat, 0xb5d0f2, 0.02),
                underConstruction: createTintedMaterialVariant(mat, 0xfcd34d, 0.2, 0.58),
              });
            }
          });
          this.terrainSubMeshes.set(assetName, subMeshes);
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

  private applyOwnerMaterials(
    group: THREE.Object3D,
    owner: HexOwner,
    underConstruction = false
  ) {
    group.traverse((obj) => {
      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh;
        const matKey = mesh.userData?.ownerMatKey as string | undefined;
        if (!matKey) return;
        const pair = this.ownerMaterialPairs.get(matKey);
        if (!pair) return;
        if (underConstruction) mesh.material = pair.underConstruction;
        else if (owner === 'player') mesh.material = pair.owned;
        else if (owner === 'iron_clan') mesh.material = pair.ironClan;
        else if (owner === 'azure_league') mesh.material = pair.azureLeague;
        else mesh.material = pair.neutral;
      }
    });
  }

  private rebuildUnderConstructionOverlay(
    state: HexWorldState,
    underConstructionKeys: Set<string>
  ) {
    const oldGeo = this.underConstructionOverlayMesh.geometry;
    const positions: number[] = [];
    const outerR = HEX_OUTER_RADIUS * 0.78;
    const innerR = HEX_OUTER_RADIUS * 0.67;

    for (const key of underConstructionKeys) {
      const tile = state.hexes[key];
      if (!tile) continue;
      const center = axialToWorld(tile.q, tile.r);
      for (let edge = 0; edge < 6; edge++) {
        appendHexEdgeQuad(
          positions,
          center.x,
          center.z,
          TILE_SURFACE_Y + 0.024,
          edge,
          outerR,
          innerR
        );
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    this.underConstructionOverlayMesh.geometry = geo;
    oldGeo.dispose();
  }

  public setAttentionKeys(keys: string[]) {
    const sig = keys.join('|');
    if (sig === this.lastAttentionSignature) return;
    this.lastAttentionSignature = sig;
    this.rebuildAttentionOverlay(this.currentWorldState, new Set(keys));
    if (!this.disposed) {
      this.renderer.render(this.scene, this.camera);
    }
  }

  private rebuildAttentionOverlay(
    state: HexWorldState,
    attentionKeys: Set<string>
  ) {
    const oldGeo = this.attentionOverlayMesh.geometry;
    const positions: number[] = [];
    const outerR = HEX_OUTER_RADIUS * 0.76;
    const innerR = HEX_OUTER_RADIUS * 0.66;

    for (const key of attentionKeys) {
      const tile = state.hexes[key];
      if (!tile) continue;
      const center = axialToWorld(tile.q, tile.r);
      for (let edge = 0; edge < 6; edge++) {
        appendHexEdgeQuad(
          positions,
          center.x,
          center.z,
          TILE_SURFACE_Y + 0.023,
          edge,
          outerR,
          innerR
        );
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    this.attentionOverlayMesh.geometry = geo;
    oldGeo.dispose();
  }

  public syncExpansionOverlay(params: {
    expandableKeys: Set<string>;
    expandingKeys: Set<string>;
    influenceKeys: Set<string>;
  }) {
    const expArr = Array.from(params.expandableKeys).sort();
    const actArr = Array.from(params.expandingKeys).sort();
    const infArr = Array.from(params.influenceKeys).sort();
    const sig = `${expArr.join(',')}|${actArr.join(',')}|${infArr.join(',')}`;
    if (sig === this.lastExpansionSignature) return;
    this.lastExpansionSignature = sig;

    this.expandableKeys = new Set(params.expandableKeys);
    this.expandingKeys = new Set(params.expandingKeys);
    this.influenceKeys = new Set(params.influenceKeys);
    this.rebuildExpansionOverlays(this.currentWorldState);
    this.refreshSelectorAnchor();
    if (!this.disposed) {
      this.renderer.render(this.scene, this.camera);
    }
  }

  private rebuildExpansionOverlays(state: HexWorldState) {
    const oldFrontier = this.frontierOverlayMesh.geometry;
    const oldExpanding = this.expandingOverlayMesh.geometry;
    const oldInfluence = this.influenceOverlayMesh.geometry;

    this.influenceOverlayMesh.geometry = buildCoordRingOverlayGeometry(
      state,
      this.influenceKeys,
      HEX_OUTER_RADIUS * 0.92,
      HEX_OUTER_RADIUS * 0.87,
      0.009,
      0.032
    );
    this.frontierOverlayMesh.geometry = buildCoordRingOverlayGeometry(
      state,
      this.expandableKeys,
      HEX_OUTER_RADIUS * 0.965,
      HEX_OUTER_RADIUS * 0.885,
      0.012,
      0.036
    );
    this.expandingOverlayMesh.geometry = buildCoordRingOverlayGeometry(
      state,
      this.expandingKeys,
      HEX_OUTER_RADIUS * 0.98,
      HEX_OUTER_RADIUS * 0.84,
      0.019,
      0.042
    );

    oldFrontier.dispose();
    oldExpanding.dispose();
    oldInfluence.dispose();
  }

  private rebuildTerritoryOverlays(state: HexWorldState) {
    const oldTrim = this.territoryTrimMesh.geometry;
    const oldBorder = this.territoryBorderMesh.geometry;
    const oldIronBorder = this.ironClanBorderMesh.geometry;
    const oldAzureBorder = this.azureLeagueBorderMesh.geometry;
    const oldFertile = this.fertileOverlayMesh.geometry;

    this.territoryTrimMesh.geometry = buildTerritoryPerimeterGeometry(
      state,
      HEX_OUTER_RADIUS * 1.03,
      HEX_OUTER_RADIUS * 0.875,
      TILE_SURFACE_Y + 0.015,
      'player'
    );
    this.territoryBorderMesh.geometry = buildTerritoryPerimeterGeometry(
      state,
      HEX_OUTER_RADIUS * 1.005,
      HEX_OUTER_RADIUS * 0.9,
      TILE_SURFACE_Y + 0.02,
      'player'
    );
    this.ironClanBorderMesh.geometry = buildTerritoryPerimeterGeometry(
      state,
      HEX_OUTER_RADIUS * 1.005,
      HEX_OUTER_RADIUS * 0.89,
      TILE_SURFACE_Y + 0.018,
      'iron_clan'
    );
    this.azureLeagueBorderMesh.geometry = buildTerritoryPerimeterGeometry(
      state,
      HEX_OUTER_RADIUS * 1.005,
      HEX_OUTER_RADIUS * 0.89,
      TILE_SURFACE_Y + 0.018,
      'azure_league'
    );
    this.rebuildExpansionOverlays(state);
    this.fertileOverlayMesh.geometry = buildFertileFurrowsGeometry(state);

    oldTrim.dispose();
    oldBorder.dispose();
    oldIronBorder.dispose();
    oldAzureBorder.dispose();
    oldFertile.dispose();
    this.rebuildRareMarkers(state);

    const tileCount = Object.keys(state.hexes).length;
    if (tileCount !== this.lastGridTileCount) {
      this.lastGridTileCount = tileCount;
      const oldGrid = this.gridLinesMesh.geometry;
      this.gridLinesMesh.geometry = buildHexGridGeometryFromState(
        state,
        this.quality.gridGuideRings
      );
      oldGrid.dispose();
    }
  }

  private rebuildRareMarkers(state: HexWorldState) {
    while (this.rareMarkersGroup.children.length > 0) {
      const child = this.rareMarkersGroup.children[0] as THREE.Mesh;
      this.rareMarkersGroup.remove(child);
      child.geometry?.dispose();
      if (child.material && !Array.isArray(child.material)) {
        child.material.dispose();
      }
    }

    const gemGeo = new THREE.OctahedronGeometry(0.068 * HEX_WORLD_SCALE, 0);
    for (const tile of Object.values(state.hexes)) {
      const strategic = getStrategicRegionInfo(tile.q, tile.r, tile);
      if (strategic.rareFeature === 'none') continue;

      const colorHex =
        strategic.rareFeature === 'gold_vein'
          ? 0xfbbf24
          : strategic.rareFeature === 'pure_iron'
            ? 0x94a3b8
            : strategic.rareFeature === 'arcane_crystal'
              ? 0x38bdf8
              : strategic.rareFeature === 'rich_soil'
                ? 0x84cc16
                : 0x22d3ee;

      const mat = new THREE.MeshStandardMaterial({
        color: colorHex,
        emissive: colorHex,
        emissiveIntensity: 0.25,
        roughness: 0.35,
        metalness: 0.2,
        flatShading: true,
      });
      const marker = new THREE.Mesh(gemGeo.clone(), mat);
      const pos = axialToWorld(tile.q, tile.r);
      const baseY = TILE_SURFACE_Y + 0.16 * HEX_WORLD_SCALE;
      marker.position.set(
        pos.x + 0.28 * HEX_WORLD_SCALE,
        baseY,
        pos.z - 0.16 * HEX_WORLD_SCALE
      );
      marker.userData.baseY = baseY;
      marker.userData.phase = (tile.q * 3 + tile.r * 5) * 0.7;
      this.rareMarkersGroup.add(marker);
    }
    gemGeo.dispose();
  }

  public syncUnits(
    units: UnitEntity[],
    commandSource: AxialCoord | null = null,
    validTargets: AxialCoord[] = []
  ) {
    // Update command target rings
    this.commandValidTargets = new Set(validTargets.map((c) => hexKey(c.q, c.r)));
    const oldTargetGeo = this.unitTargetOverlayMesh.geometry;
    const targetPositions: number[] = [];
    const outerR = HEX_OUTER_RADIUS * 0.96;
    const innerR = HEX_OUTER_RADIUS * 0.84;
    for (const coord of validTargets) {
      const center = axialToWorld(coord.q, coord.r);
      const hasTile = Boolean(this.currentWorldState.hexes[hexKey(coord.q, coord.r)]);
      const y = hasTile ? TILE_SURFACE_Y + 0.028 : 0.048;
      for (let edge = 0; edge < 6; edge++) {
        appendHexEdgeQuad(targetPositions, center.x, center.z, y, edge, outerR, innerR);
      }
    }
    const nextTargetGeo = new THREE.BufferGeometry();
    nextTargetGeo.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(targetPositions, 3)
    );
    this.unitTargetOverlayMesh.geometry = nextTargetGeo;
    oldTargetGeo.dispose();
    this.refreshSelectorAnchor();

    // Clear previous unit meshes safely
    while (this.unitsGroup.children.length > 0) {
      const child = this.unitsGroup.children[0];
      this.unitsGroup.remove(child);
      child.traverse((obj) => {
        const m = obj as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        if (m.material) {
          if (Array.isArray(m.material)) m.material.forEach((mm) => mm.dispose());
          else m.material.dispose();
        }
      });
    }

    for (const unit of units) {
      if (unit.hp <= 0) continue;
      const unitGroup = new THREE.Group();
      unitGroup.scale.setScalar(HEX_WORLD_SCALE);
      const pos = axialToWorld(unit.q, unit.r);
      const hasTile = Boolean(this.currentWorldState.hexes[hexKey(unit.q, unit.r)]);
      const baseY = hasTile ? TILE_SURFACE_Y + 0.03 * HEX_WORLD_SCALE : 0.045;
      unitGroup.position.set(pos.x, baseY, pos.z);

      const primaryColor =
        unit.owner === 'player'
          ? 0x059669
          : unit.owner === 'iron_clan'
            ? 0xdc2626
            : 0x2563eb;
      const trimColor =
        unit.owner === 'player'
          ? 0xfbbf24
          : unit.owner === 'iron_clan'
            ? 0x334155
            : 0xe2e8f0;

      const baseMat = new THREE.MeshStandardMaterial({
        color: primaryColor,
        roughness: 0.55,
        metalness: 0.1,
        flatShading: true,
      });
      const trimMat = new THREE.MeshStandardMaterial({
        color: trimColor,
        roughness: 0.45,
        metalness: 0.25,
        flatShading: true,
      });

      const pedestal = new THREE.Mesh(
        new THREE.CylinderGeometry(0.145, 0.165, 0.05, 6),
        baseMat
      );
      pedestal.position.y = 0.025;
      pedestal.castShadow = this.quality.shadowsEnabled;
      unitGroup.add(pedestal);

      if (commandSource && commandSource.q === unit.q && commandSource.r === unit.r) {
        const ring = new THREE.Mesh(
          createHexRingGeometry(0.24, 0.19),
          new THREE.MeshBasicMaterial({
            color: 0xfbbf24,
            side: THREE.DoubleSide,
          })
        );
        ring.position.y = 0.01;
        unitGroup.add(ring);
      }

      if (unit.type === 'warship') {
        const hull = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.08, 0.24), trimMat);
        hull.position.y = 0.09;
        const sail = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.22, 4), baseMat);
        sail.position.y = 0.21;
        unitGroup.add(hull, sail);
      } else if (unit.type === 'knight') {
        const steed = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.2), trimMat);
        steed.position.y = 0.1;
        const rider = new THREE.Mesh(new THREE.ConeGeometry(0.085, 0.22, 6), baseMat);
        rider.position.y = 0.24;
        const lance = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.28, 5), trimMat);
        lance.position.set(0.08, 0.22, 0.02);
        lance.rotation.x = 0.35;
        unitGroup.add(steed, rider, lance);
      } else if (unit.type === 'archer') {
        const body = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.22, 6), baseMat);
        body.position.y = 0.16;
        const hood = new THREE.Mesh(new THREE.SphereGeometry(0.052, 6, 5), trimMat);
        hood.position.y = 0.27;
        const bow = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.012, 4, 8, Math.PI), trimMat);
        bow.position.set(0.08, 0.17, 0);
        bow.rotation.z = -Math.PI / 2;
        unitGroup.add(body, hood, bow);
      } else {
        // Infantry
        const body = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.09, 0.18, 6), baseMat);
        body.position.y = 0.14;
        const helm = new THREE.Mesh(new THREE.SphereGeometry(0.052, 6, 5), trimMat);
        helm.position.y = 0.25;
        const shield = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.13, 0.1), trimMat);
        shield.position.set(0.08, 0.15, 0);
        unitGroup.add(body, helm, shield);
      }

      if (unit.owner === 'player' && !unit.movedThisTurn) {
        unitGroup.userData.readyBob = true;
        unitGroup.userData.baseY = baseY;
        unitGroup.userData.phase = (unit.q + unit.r) * 0.9;
      }

      this.unitsGroup.add(unitGroup);
    }
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
    mesh.position.set(x, TILE_SURFACE_Y + 0.03, z);
    mesh.scale.setScalar(0.95);
    this.scene.add(mesh);
    this.conquestWaves.push({
      mesh,
      material: mat,
      progress: 0,
      baseY: TILE_SURFACE_Y + 0.03,
    });
  }

  private rebuildTerrainInstances(
    terrainBuckets: Map<string, Array<{ tile: PlacedHex; owner: HexOwner }>>
  ) {
    while (this.terrainInstancesGroup.children.length > 0) {
      const child = this.terrainInstancesGroup.children[0] as THREE.InstancedMesh;
      this.terrainInstancesGroup.remove(child);
      child.dispose();
    }

    for (const [assetName, entries] of terrainBuckets.entries()) {
      if (entries.length === 0) continue;
      const subMeshes = this.terrainSubMeshes.get(assetName);
      if (!subMeshes || subMeshes.length === 0) continue;

      for (const sub of subMeshes) {
        const im = new THREE.InstancedMesh(
          sub.geometry,
          sub.material,
          entries.length
        );
        im.castShadow = false;
        im.receiveShadow = this.quality.shadowsEnabled;

        for (let i = 0; i < entries.length; i++) {
          const { tile, owner } = entries[i];
          const pos = axialToWorld(tile.q, tile.r);
          _posVec.set(pos.x, 0, pos.z);
          _quat.setFromAxisAngle(_yAxis, THREE.MathUtils.degToRad(tile.orientation));
          _tileMatrix.compose(_posVec, _quat, _scaleVec);
          _finalMatrix.multiplyMatrices(_tileMatrix, sub.localMatrix);
          im.setMatrixAt(i, _finalMatrix);

          const tintHex =
            owner === 'player'
              ? 0xffffff
              : owner === 'iron_clan'
                ? 0xf2b5b5
                : owner === 'azure_league'
                  ? 0xb5d0f2
                  : 0x8fa7be;
          im.setColorAt(i, _colorTmp.setHex(tintHex));
        }

        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) {
          im.instanceColor.needsUpdate = true;
        }
        im.computeBoundingSphere();
        this.terrainInstancesGroup.add(im);
      }
    }
  }

  public async syncWorldState(
    nextState: HexWorldState,
    animateNewKeys?: string[],
    conqueredKeys?: string[],
    underConstructionKeys?: Set<string>,
    attentionKeys?: string[]
  ) {
    this.currentWorldState = nextState;
    const animSet = new Set(animateNewKeys ?? []);
    const conquestSet = new Set(conqueredKeys ?? []);
    const underSet = underConstructionKeys ?? new Set<string>();

    // Update territory border ribbon, construction overlay, and conquerable frontier immediately
    this.rebuildTerritoryOverlays(nextState);
    this.rebuildUnderConstructionOverlay(nextState, underSet);
    if (attentionKeys) {
      this.lastAttentionSignature = attentionKeys.join('|');
      this.rebuildAttentionOverlay(nextState, new Set(attentionKeys));
    }
    this.refreshSelectorAnchor();

    // Classify tiles into batched natural terrain vs. individual construction meshes
    const uniqueNames = new Set<string>();
    const terrainBuckets = new Map<
      string,
      Array<{ tile: PlacedHex; owner: HexOwner }>
    >();
    const individualTiles: Array<[string, PlacedHex, HexOwner, boolean]> = [];

    for (const [key, tile] of Object.entries(nextState.hexes)) {
      const asset = HEX_ASSETS[tile.structureIndex];
      if (!asset) continue;
      uniqueNames.add(asset.name);

      const owner: HexOwner =
        typeof tile.owner === 'string' && tile.owner.trim().length > 0
          ? tile.owner.trim()
          : 'neutral';
      const isUnder = underSet.has(key);
      const needsIndividualMesh = hasHexConstruction(tile, HEX_ASSETS) || isUnder;

      if (needsIndividualMesh) {
        individualTiles.push([key, tile, owner, isUnder]);
      } else {
        let bucket = terrainBuckets.get(asset.name);
        if (!bucket) {
          bucket = [];
          terrainBuckets.set(asset.name, bucket);
        }
        bucket.push({ tile, owner });
      }
    }

    const individualKeys = new Set(individualTiles.map(([k]) => k));

    // Remove individual building meshes that were demolished or replaced by natural terrain
    for (const [key, entry] of this.placedMeshes.entries()) {
      const target = nextState.hexes[key];
      if (
        !target ||
        !individualKeys.has(key) ||
        target.structureIndex !== entry.structureIndex
      ) {
        const hadConstruction = hasHexConstruction(
          { structureIndex: entry.structureIndex },
          HEX_ASSETS
        );
        const nowRestoredTerrain =
          Boolean(target) && !hasHexConstruction(target, HEX_ASSETS);
        this.hexesGroup.remove(entry.group);
        this.placedMeshes.delete(key);
        if (animSet.has(key) && (!target || (hadConstruction && nowRestoredTerrain))) {
          const pos = entry.group.position;
          this.spawnParticleBurst(
            pos.x,
            TILE_SURFACE_Y + 0.08,
            pos.z,
            0xdc2626,
            8
          );
        }
      } else {
        if (target.orientation !== entry.orientation) {
          entry.group.rotation.y = THREE.MathUtils.degToRad(target.orientation);
          entry.orientation = target.orientation;
          if (animSet.has(key)) {
            this.popAnims.push({ mesh: entry.group, progress: 0 });
          }
        }
        const nextOwner: HexOwner =
          typeof target.owner === 'string' && target.owner.trim().length > 0
            ? target.owner.trim()
            : 'neutral';
        const nextUnder = underSet.has(key);
        if (nextOwner !== entry.owner || nextUnder !== entry.underConstruction) {
          const justCompleted = entry.underConstruction && !nextUnder;
          entry.owner = nextOwner;
          entry.underConstruction = nextUnder;
          this.applyOwnerMaterials(entry.group, nextOwner, nextUnder);
          if (conquestSet.has(key)) {
            const pos = entry.group.position;
            entry.group.scale.set(
              1.12 * HEX_WORLD_SCALE,
              0.65 * HEX_WORLD_SCALE,
              1.12 * HEX_WORLD_SCALE
            );
            this.popAnims.push({ mesh: entry.group, progress: 0 });
            this.spawnConquestWave(pos.x, pos.z);
            this.spawnParticleBurst(
              pos.x,
              TILE_SURFACE_Y + 0.08,
              pos.z,
              0xfbbf24,
              12
            );
          } else if (justCompleted) {
            const pos = entry.group.position;
            entry.group.scale.set(
              1.1 * HEX_WORLD_SCALE,
              0.72 * HEX_WORLD_SCALE,
              1.1 * HEX_WORLD_SCALE
            );
            this.popAnims.push({ mesh: entry.group, progress: 0 });
            this.spawnParticleBurst(
              pos.x,
              TILE_SURFACE_Y + 0.1,
              pos.z,
              0x34d399,
              10
            );
          }
        }
      }
    }

    // Load any uncached .glb assets required by this world
    const uncachedNames = Array.from(uniqueNames).filter(
      (name) => !this.modelCache.has(name)
    );
    if (uncachedNames.length > 0) {
      let loadedCount = 0;
      const totalCount = uncachedNames.length;
      await Promise.all(
        uncachedNames.map(async (name) => {
          try {
            await this.loadModel(name);
          } finally {
            loadedCount++;
            this.callbacks.onLoadProgress(loadedCount, totalCount);
          }
        })
      );
    }

    if (this.disposed) return;

    // Rebuild batched terrain InstancedMeshes (~10-20 draw calls for 1,000+ hexes!)
    this.rebuildTerrainInstances(terrainBuckets);

    // Spawn burst feedback on newly conquered natural terrain tiles
    for (const key of conquestSet) {
      if (individualKeys.has(key)) continue;
      const tile = nextState.hexes[key];
      if (!tile) continue;
      const pos = axialToWorld(tile.q, tile.r);
      this.spawnConquestWave(pos.x, pos.z);
      this.spawnParticleBurst(pos.x, TILE_SURFACE_Y + 0.08, pos.z, 0xfbbf24, 12);
    }

    // Add missing individual building meshes
    for (const [key, tile, owner, isUnder] of individualTiles) {
      const liveTile = this.currentWorldState.hexes[key];
      if (!liveTile || liveTile.structureIndex !== tile.structureIndex) continue;
      if (this.placedMeshes.has(key)) continue;

      const asset = HEX_ASSETS[tile.structureIndex];
      if (!asset) continue;
      const template = this.modelCache.get(asset.name);
      if (!template) continue;

      const group = new THREE.Group();
      const clone = template.clone(true);
      this.applyOwnerMaterials(clone, owner, isUnder);
      group.add(clone);

      const pos = axialToWorld(tile.q, tile.r);
      group.position.set(pos.x, 0, pos.z);
      group.rotation.y = THREE.MathUtils.degToRad(tile.orientation);
      group.scale.setScalar(HEX_WORLD_SCALE);
      this.hexesGroup.add(group);

      this.placedMeshes.set(key, {
        group,
        structureIndex: tile.structureIndex,
        orientation: tile.orientation,
        owner,
        underConstruction: isUnder,
      });

      if (conquestSet.has(key)) {
        group.scale.set(
          1.12 * HEX_WORLD_SCALE,
          0.55 * HEX_WORLD_SCALE,
          1.12 * HEX_WORLD_SCALE
        );
        this.popAnims.push({ mesh: group, progress: 0 });
        this.spawnConquestWave(pos.x, pos.z);
        this.spawnParticleBurst(pos.x, TILE_SURFACE_Y + 0.08, pos.z, 0xfbbf24, 12);
      } else if (animSet.has(key)) {
        group.scale.set(
          1.12 * HEX_WORLD_SCALE,
          0.55 * HEX_WORLD_SCALE,
          1.12 * HEX_WORLD_SCALE
        );
        this.popAnims.push({ mesh: group, progress: 0 });
        this.spawnParticleBurst(pos.x, TILE_SURFACE_Y + 0.04, pos.z, 0xfef3c7, 10);
      }
    }

    if (!this.disposed) {
      this.renderer.render(this.scene, this.camera);
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
    this.renderer.render(this.scene, this.camera);
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
      const dist = isPortrait ? 20.5 : 15.0;
      const pitch = isPortrait ? 0.62 : 0.56;
      const horiz = Math.cos(pitch) * dist;
      const y = Math.sin(pitch) * dist;
      const home = this.getHomeWorldPos();
      const focusX = home.x + (isPortrait ? 0 : -1.35);
      const focusZ = home.z + (isPortrait ? 0.95 : -0.3);
      this.camera.position.set(
        focusX + Math.sin(this.titleOrbitAngle) * horiz,
        y,
        focusZ + Math.cos(this.titleOrbitAngle) * horiz
      );
      this.camera.lookAt(focusX, 0.45, focusZ);
      if (this.sunLight) {
        this.sunLight.position.set(focusX + 14, 24, focusZ + 12);
        this.sunLight.target.position.set(focusX, 0, focusZ);
      }
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
        const panSpeed = Math.max(8, this.camDistance * 0.65) * dt;
        this.camTargetGoal.x = THREE.MathUtils.clamp(
          this.camTargetGoal.x + worldDx * panSpeed,
          -CAMERA_PAN_BOUND_X,
          CAMERA_PAN_BOUND_X
        );
        this.camTargetGoal.z = THREE.MathUtils.clamp(
          this.camTargetGoal.z + worldDz * panSpeed,
          -CAMERA_PAN_BOUND_Z,
          CAMERA_PAN_BOUND_Z
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
    this.camera.lookAt(this.camTarget.x, 0.22, this.camTarget.z);
    if (this.sunLight) {
      this.sunLight.position.set(this.camTarget.x + 14, 24, this.camTarget.z + 12);
      this.sunLight.target.position.set(this.camTarget.x, 0, this.camTarget.z);
    }
  }

  private updateEffects(dt: number) {
    this.elapsedSec += dt;

    // Gentle ocean drift
    this.waterTexture.offset.x = (this.elapsedSec * 0.015) % 1;
    this.waterTexture.offset.y = (this.elapsedSec * 0.01) % 1;

    // Gentle preview float & frontier pulse
    if (this.selectorGroup.visible && this.selectorPreviewGroup.visible) {
      this.selectorPreviewGroup.position.y =
        TILE_SURFACE_Y + 0.04 + Math.sin(this.elapsedSec * 4) * 0.035;
    }

    this.expandingOverlayMat.opacity = 0.56 + Math.sin(this.elapsedSec * 4.2) * 0.24;

    if (this.toolMode === 'expand') {
      this.frontierOverlayMat.opacity = 0.36 + Math.sin(this.elapsedSec * 2.6) * 0.12;
      this.influenceOverlayMat.opacity = 0.24;
    } else {
      this.frontierOverlayMat.opacity = 0.2;
      this.influenceOverlayMat.opacity = 0.12;
    }

    for (const child of this.rareMarkersGroup.children) {
      const baseY =
        (child.userData.baseY as number | undefined) ?? TILE_SURFACE_Y + 0.24;
      const phase = (child.userData.phase as number | undefined) ?? 0;
      child.position.y = baseY + Math.sin(this.elapsedSec * 2.5 + phase) * 0.04;
      child.rotation.y = this.elapsedSec * 1.1 + phase;
    }

    for (const unitGroup of this.unitsGroup.children) {
      if (unitGroup.userData.readyBob) {
        const baseY =
          (unitGroup.userData.baseY as number | undefined) ?? TILE_SURFACE_Y + 0.05;
        const phase = (unitGroup.userData.phase as number | undefined) ?? 0;
        unitGroup.position.y = baseY + Math.sin(this.elapsedSec * 3.2 + phase) * 0.02;
      }
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
        wave.mesh.position.y = wave.baseY + easeOut * 0.55;
        wave.material.opacity = (1 - t) * 0.92;
      }
    }

    // Pop-in spring animations (preserving HEX_WORLD_SCALE)
    for (let i = this.popAnims.length - 1; i >= 0; i--) {
      const anim = this.popAnims[i];
      anim.progress += dt * 5.8;
      if (anim.progress >= 1) {
        anim.mesh.scale.setScalar(HEX_WORLD_SCALE);
        this.popAnims.splice(i, 1);
      } else {
        const t = anim.progress;
        const overshoot = Math.sin(t * Math.PI) * 0.14 * (1 - t);
        const sy = THREE.MathUtils.lerp(0.6, 1.0, Math.min(1, t * 1.4)) + overshoot;
        const sxz = 1 + (1 - sy) * 0.25;
        anim.mesh.scale.set(
          sxz * HEX_WORLD_SCALE,
          sy * HEX_WORLD_SCALE,
          sxz * HEX_WORLD_SCALE
        );
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
      addMat(pair.ironClan);
      addMat(pair.azureLeague);
      addMat(pair.underConstruction);
    }

    geometries.add(this.conquestRingGeo);
    geometries.forEach((g) => g.dispose());
    materials.forEach((m) => m.dispose());

    while (this.terrainInstancesGroup.children.length > 0) {
      const child = this.terrainInstancesGroup.children[0] as THREE.InstancedMesh;
      this.terrainInstancesGroup.remove(child);
      child.dispose();
    }

    this.conquestWaves = [];
    this.ownerMaterialPairs.clear();
    this.terrainSubMeshes.clear();
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
