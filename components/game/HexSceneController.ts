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
import { withBasePath } from '@/lib/base-path';
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
import {
  ROAD_CATALOG,
  type RoadConnectivitySummary,
  type RoadLevel,
  type RoadMap,
} from '@/lib/road-engine';
import type { CityEntity } from '@/lib/city-engine';
import type { SeasonId } from '@/lib/calendar-engine';
import {
  computeAtmosphereTarget,
  type AtmosphereTarget,
  type DayPhaseId,
} from '@/lib/day-night-engine';
import {
  computeFarmCropVisualState,
  computeHexSeasonalVisualProfile,
  type ClimateWeatherId,
} from '@/lib/season-engine';
import {
  getBuildingLevel,
  getBuildingUpgradeTier,
} from '@/lib/building-upgrade-engine';
import {
  getBuildingBaseSurfaceY,
  getBuildingModuleVisualPlacement,
  getInstalledModules,
  isValidBuildingModuleId,
} from '@/lib/building-modules-engine';
import { HEX_ASSETS } from '@/lib/repo-data';

export type GameModeState = 'title' | 'playing' | 'paused';
export type BuilderToolMode = 'expand' | 'build' | 'road' | 'demolish' | 'command';

export interface HexSceneCallbacks {
  onHoverChange: (coord: AxialCoord | null, existingTile: PlacedHex | null) => void;
  onPlaceAt: (q: number, r: number) => void;
  onRoadAt: (q: number, r: number) => void;
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

const CAMERA_MIN_DIST = 8.0;
const CAMERA_MAX_DIST = 72;
const CAMERA_PAN_BOUND_X = 31;
const CAMERA_PAN_BOUND_Z = 35;
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
const _targetColorTmp = new THREE.Color();

const NIGHT_LANTERN_BUILDING_ASSETS = new Set([
  'building-castle',
  'building-house',
  'building-cabin',
  'building-village',
  'unit-mansion',
  'building-market',
  'building-port',
  'building-wizard-tower',
  'building-archery',
  'unit-wall-tower',
  'building-tower',
  'building-smelter',
  'building-mill',
]);

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

const TERRAIN_WIND_UNIFORMS = {
  uWindTime: { value: 0 },
  uWindAmp: { value: 1.0 },
};

function createSeasonalTerrainMaterialVariant(
  mat: THREE.Material | THREE.Material[],
  enableCanopyWind = true
): THREE.Material | THREE.Material[] {
  const cloneOne = (m: THREE.Material): THREE.Material => {
    const cloned = m.clone();
    cloned.customProgramCacheKey = () =>
      enableCanopyWind ? 'hex-seasonal-terrain-v2-wind' : 'hex-seasonal-terrain-v2-static';
    cloned.onBeforeCompile = (shader) => {
      shader.uniforms.uWindTime = TERRAIN_WIND_UNIFORMS.uWindTime;
      shader.uniforms.uWindAmp = TERRAIN_WIND_UNIFORMS.uWindAmp;
      const windSnippet = enableCanopyWind
        ? `          if (position.y > 0.24 && uWindAmp > 0.001) {
            float swayMask = clamp((position.y - 0.24) * 2.2, 0.0, 1.0);
            float phase = position.x * 3.1 + position.z * 2.7;
            #ifdef USE_INSTANCING
              phase += instanceMatrix[3][0] * 0.45 + instanceMatrix[3][2] * 0.45;
            #endif
            float gust = sin(uWindTime * 1.65 + phase) + 0.45 * sin(uWindTime * 3.1 + phase * 1.7);
            transformed.x += gust * 0.015 * swayMask * uWindAmp;
            transformed.z += cos(uWindTime * 1.35 + phase) * 0.01 * swayMask * uWindAmp;
          }\n`
        : '';
      const canopyTintSnippet = enableCanopyWind
        ? `            bool isCanopy = (py > 0.24 && py < 0.72);
            if (isCanopy && sShift > 0.95) {
              float autT = clamp((sShift - 0.95) / 1.05, 0.0, 1.0);
              if (sDecid > 0.5) {
                float hueVar = fract(sin(dot(vLocalSeasonPos.xz, vec2(12.9898, 78.233))) * 43758.5453);
                vec3 autCol = mix(vec3(0.86, 0.56, 0.14), vec3(0.76, 0.25, 0.12), step(0.48, hueVar));
                diffuseColor.rgb = mix(diffuseColor.rgb, autCol, autT * 0.84);
              } else {
                diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.14, 0.34, 0.20), autT * 0.35);
              }
            } else if (isCanopy && sShift > 0.3) {
              float sprT = clamp((sShift - 0.3) * 0.7, 0.0, 1.0);
              diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.32, 0.72, 0.28), sprT * 0.34);
            } else if (isCanopy && sShift < -0.25) {
              float winT = clamp((-sShift - 0.25) / 0.7, 0.0, 1.0);
              if (sDecid > 0.5) {
                diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.47, 0.33, 0.22), winT * 0.76);
              } else {
                diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.13, 0.31, 0.22), winT * 0.42);
              }
            }`
        : '';
      shader.vertexShader =
        `attribute vec4 aSeasonData;\nuniform float uWindTime;\nuniform float uWindAmp;\nvarying vec3 vLocalSeasonPos;\nvarying vec4 vSeasonData;\n` +
        shader.vertexShader.replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vLocalSeasonPos = position;
          vSeasonData = aSeasonData;
${windSnippet}`
        );
      shader.fragmentShader =
        `varying vec3 vLocalSeasonPos;\nvarying vec4 vSeasonData;\n` +
        shader.fragmentShader.replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          {
            float sShift = vSeasonData.x;
            float sSnow = vSeasonData.y;
            float sWetIce = vSeasonData.z;
            float sDecid = vSeasonData.w;
            float py = vLocalSeasonPos.y;
${canopyTintSnippet}
            if (py <= 0.22 && sWetIce > 0.1) {
              diffuseColor.rgb *= mix(1.0, 0.85, clamp(sWetIce, 0.0, 0.8));
            }
            if (sSnow > 0.01) {
              float snowMask = 0.0;
              if (py > 0.40) {
                snowMask = smoothstep(0.38, 0.64, py) * sSnow;
              } else if (py <= 0.22 && sDecid < 0.5) {
                snowMask = sSnow * 0.52;
              }
              diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.96, 1.0), clamp(snowMask, 0.0, 0.92));
            }
          }`
        );
    };
    cloned.needsUpdate = true;
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
      upgradeGroup: THREE.Group | null;
      structureIndex: number;
      orientation: number;
      owner: HexOwner;
      underConstruction: boolean;
      level: number;
      modulesSig: string;
    }
  >();
  private seasonalTerrainMats = new Map<string, THREE.Material | THREE.Material[]>();
  private terrainInstanceEntries: Array<{
    im: THREE.InstancedMesh;
    assetName: string;
    entries: Array<{ tile: PlacedHex; owner: HexOwner }>;
  }> = [];

  // Atmosphere, day/night & seasonal state
  private hemiLight: THREE.HemisphereLight;
  private rimLight: THREE.DirectionalLight;
  private sceneFog: THREE.Fog;
  private waterMat: THREE.MeshStandardMaterial;
  private starsPoints: THREE.Points;
  private starsMat: THREE.PointsMaterial;
  private nightLanternGlowMat: THREE.MeshStandardMaterial;
  private upgradeStoneMat: THREE.MeshStandardMaterial;
  private upgradeTimberMat: THREE.MeshStandardMaterial;
  private upgradeRoofMat: THREE.MeshStandardMaterial;
  private upgradeGoldMat: THREE.MeshStandardMaterial;
  private upgradeDarkMetalMat: THREE.MeshStandardMaterial;
  private upgradeFoliageMat: THREE.MeshStandardMaterial;
  private upgradeCanvasMat: THREE.MeshStandardMaterial;
  private upgradeEmberMat: THREE.MeshStandardMaterial;
  private upgradeGeoCache = new Map<string, THREE.BufferGeometry>();
  private roadLanternsMesh: THREE.InstancedMesh;
  private springFlowersMesh: THREE.InstancedMesh;
  private farmCropStalksMesh: THREE.InstancedMesh;
  private farmCropHeadsMesh: THREE.InstancedMesh;
  private winterIceMesh: THREE.InstancedMesh;
  private lastUnderConstructionKeys = new Set<string>();
  private lastSeasonalDetailsSig = '';
  private currentSeason: SeasonId = 'spring';
  private currentSeasonProgress = 0;
  private currentWeather: ClimateWeatherId = 'clear';
  private currentWorldSeed = 42026;
  private lastTerrainSeasonSig = '';
  private currentAtmosTarget: AtmosphereTarget = computeAtmosphereTarget({
    phase: 'morning',
    season: 'spring',
    weather: 'clear',
  });
  private curSunAzimuth = 0.72;
  private curSunElevation = 0.78;
  private curSunColor = new THREE.Color(0xfff3d8);
  private curSunIntensity = 1.56;
  private curHemiSky = new THREE.Color(0x98d2f7);
  private curHemiGround = new THREE.Color(0x5a6e47);
  private curHemiIntensity = 0.6;
  private curRimColor = new THREE.Color(0xc2e4ff);
  private curRimIntensity = 0.28;
  private curSkyColor = new THREE.Color(0xa6d8f2);
  private curFogColor = new THREE.Color(0xaad9f0);
  private curFogNear = 46;
  private curFogFar = 162;
  private curWaterTint = new THREE.Color(0xffffff);
  private curExposure = 0.93;
  private curEnvIntensity = 0.32;
  private curNightGlow = 0.05;
  private curStarOpacity = 0;
  private atmosDirty = false;

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
  private fertileOverlayMat: THREE.MeshBasicMaterial;
  private underConstructionOverlayMesh: THREE.Mesh;
  private attentionOverlayMesh: THREE.Mesh;
  private lastAttentionSignature = '';
  private selectedRegionOverlayMesh: THREE.Mesh;
  private selectedDistrictOverlayMesh: THREE.Mesh;
  private lastSelectedRegionSig = '';
  private positiveAdjacencyOverlayMesh: THREE.Mesh;
  private penaltyAdjacencyOverlayMesh: THREE.Mesh;
  private lastSelectedAdjacencySig = '';
  private rareMarkersGroup = new THREE.Group();
  private roadsMesh: THREE.Mesh;
  private tradeCorridorsMesh: THREE.Mesh;
  private citiesGroup = new THREE.Group();
  private lastRoadCitySignature = '';
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
  private camDistance = 19.0;
  private camDistanceGoal = 19.0;
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
  private reduceAnimations = false;
  private reduceEffects = false;

  // Living world ambient layers (ultra-lightweight InstancedMeshes)
  private ambientMoteCount = 0;
  private ambientMotesMesh!: THREE.InstancedMesh;
  private ambientMotesMat!: THREE.MeshBasicMaterial;
  private ambientMotes: Array<{
    ox: number;
    oy: number;
    oz: number;
    speed: number;
    phase: number;
    scale: number;
  }> = [];

  private smokeMesh!: THREE.InstancedMesh;
  private smokeAnchors: Array<{ x: number; y: number; z: number; phase: number; isForge: boolean }> = [];

  private forgeLightsMesh!: THREE.InstancedMesh;
  private forgeAnchors: Array<{ x: number; y: number; z: number; phase: number; nightOnly: boolean }> = [];

  private bannersMesh!: THREE.InstancedMesh;
  private bannerAnchors: Array<{ x: number; y: number; z: number; phase: number; colorHex: number }> = [];

  // Smooth unit movement interpolation (replaces teleporting between hexes)
  private unitLastWorldPos = new Map<string, { x: number; z: number }>();
  private unitMoveAnims: Array<{
    group: THREE.Group;
    fromX: number;
    fromZ: number;
    toX: number;
    toZ: number;
    baseY: number;
    progress: number;
  }> = [];

  // Loop management
  private disposed = false;
  private frameId = 0;
  private lastFrameMs = 0;
  private lastRenderMs = 0;
  private hasRenderedInitialFrame = false;
  private isIdleSleeping = false;
  private pendingSoftwareRender = true;
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
    this.scene.background = this.curSkyColor.clone();
    this.sceneFog = new THREE.Fog(this.curFogColor.getHex(), this.curFogNear, this.curFogFar);
    this.scene.fog = this.sceneFog;

    // Studio RoomEnvironment for subtle PBR sheen without washing out pastel colormaps
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const roomEnv = new RoomEnvironment();
    this.envRenderTarget = pmrem.fromScene(roomEnv, 0.04);
    this.scene.environment = this.envRenderTarget.texture;
    this.scene.environmentIntensity = 0.32;
    roomEnv.dispose();
    pmrem.dispose();

    // Camera (close enough for readable hex details while framing regional context)
    const aspect = width / height;
    const defaultDist = this.getDefaultCameraDistance(aspect);
    this.camDistance = defaultDist;
    this.camDistanceGoal = defaultDist;
    this.camera = new THREE.PerspectiveCamera(aspect < 0.8 ? 36 : 32, aspect, 0.1, 360);

    // Warm/Cool 3-Point Outdoor Lighting Rig (1 shadow caster following camTarget)
    this.hemiLight = new THREE.HemisphereLight(0x98d2f7, 0x5a6e47, 0.6);
    this.hemiLight.position.set(0, 30, 0);
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight(0xfff3d8, 1.56);
    this.sunLight.position.set(14, 24, 12);
    if (this.quality.shadowsEnabled) {
      this.sunLight.castShadow = true;
      this.sunLight.shadow.mapSize.set(
        this.quality.shadowMapSize,
        this.quality.shadowMapSize
      );
      const d = 23;
      this.sunLight.shadow.camera.left = -d;
      this.sunLight.shadow.camera.right = d;
      this.sunLight.shadow.camera.top = d;
      this.sunLight.shadow.camera.bottom = -d;
      this.sunLight.shadow.camera.near = 2;
      this.sunLight.shadow.camera.far = 95;
      this.sunLight.shadow.bias = -0.0005;
      this.sunLight.shadow.normalBias = 0.02;
    }
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    this.rimLight = new THREE.DirectionalLight(0xc2e4ff, 0.28);
    this.rimLight.position.set(-14, 10, -14);
    this.scene.add(this.rimLight);

    // Night starfield dome (lightweight single Points draw call, visible only at dusk/night)
    const starPositions: number[] = [];
    let starSeed = 918273;
    const nextRand = () => {
      starSeed = (starSeed * 16807) % 2147483647;
      return (starSeed - 1) / 2147483646;
    };
    const starCount = 210;
    for (let i = 0; i < starCount; i++) {
      const theta = nextRand() * Math.PI * 2;
      const phi = 0.06 + nextRand() * 1.18;
      const radius = 84 + nextRand() * 16;
      starPositions.push(
        Math.cos(theta) * Math.cos(phi) * radius,
        Math.sin(phi) * radius + 6,
        Math.sin(theta) * Math.cos(phi) * radius
      );
    }
    const starsGeo = new THREE.BufferGeometry();
    starsGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3));
    this.starsMat = new THREE.PointsMaterial({
      color: 0xe6f1ff,
      size: 1.35,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: false,
    });
    this.starsPoints = new THREE.Points(starsGeo, this.starsMat);
    this.starsPoints.frustumCulled = false;
    this.starsPoints.visible = false;
    this.scene.add(this.starsPoints);

    // Shared materials for night lanterns & multi-tier architectural upgrades
    this.nightLanternGlowMat = new THREE.MeshStandardMaterial({
      color: 0xffd27d,
      emissive: 0xffa733,
      emissiveIntensity: 0.12,
      roughness: 0.35,
      metalness: 0.08,
    });
    this.upgradeStoneMat = new THREE.MeshStandardMaterial({
      color: 0xd8cfc0,
      roughness: 0.85,
      metalness: 0.06,
      flatShading: true,
    });
    this.upgradeTimberMat = new THREE.MeshStandardMaterial({
      color: 0x7c4d2b,
      roughness: 0.78,
      metalness: 0.04,
      flatShading: true,
    });
    this.upgradeRoofMat = new THREE.MeshStandardMaterial({
      color: 0x913b2e,
      roughness: 0.68,
      metalness: 0.08,
      flatShading: true,
    });
    this.upgradeGoldMat = new THREE.MeshStandardMaterial({
      color: 0xe6b44c,
      roughness: 0.35,
      metalness: 0.6,
      flatShading: true,
    });
    this.upgradeDarkMetalMat = new THREE.MeshStandardMaterial({
      color: 0x3b424c,
      roughness: 0.45,
      metalness: 0.65,
      flatShading: true,
    });
    this.upgradeFoliageMat = new THREE.MeshStandardMaterial({
      color: 0x3f7a38,
      roughness: 0.88,
      metalness: 0.02,
      flatShading: true,
    });
    this.upgradeCanvasMat = new THREE.MeshStandardMaterial({
      color: 0xe9dec6,
      roughness: 0.78,
      metalness: 0.02,
      flatShading: true,
    });
    this.upgradeEmberMat = new THREE.MeshStandardMaterial({
      color: 0xd95326,
      emissive: 0xff5a1f,
      emissiveIntensity: 0.75,
      roughness: 0.4,
      metalness: 0.1,
      flatShading: true,
    });

    this.updateCameraTransform(1);

    // Expansive ocean surface extending to horizon fog
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    this.waterTexture = createWaterCanvasTexture(
      this.quality.waterTextureSize,
      maxAniso
    );
    this.waterTexture.repeat.set(48, 48);
    const waterGeo = new THREE.PlaneGeometry(540, 540);
    waterGeo.rotateX(-Math.PI / 2);
    this.waterMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: this.waterTexture,
      roughness: 0.42,
      metalness: 0.06,
    });
    this.waterMesh = new THREE.Mesh(waterGeo, this.waterMat);
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

    this.fertileOverlayMat = new THREE.MeshBasicMaterial({
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
      this.fertileOverlayMat
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

    // Selected city regional domain & active districts highlight (hidden until a city center is clicked)
    this.selectedRegionOverlayMesh = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({
        color: 0x10b981,
        transparent: true,
        opacity: 0.84,
        side: THREE.DoubleSide,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      })
    );
    this.selectedRegionOverlayMesh.frustumCulled = false;
    this.scene.add(this.selectedRegionOverlayMesh);

    this.selectedDistrictOverlayMesh = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({
        color: 0xfacc15,
        transparent: true,
        opacity: 0.65,
        side: THREE.DoubleSide,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3,
      })
    );
    this.selectedDistrictOverlayMesh.frustumCulled = false;
    this.scene.add(this.selectedDistrictOverlayMesh);

    this.positiveAdjacencyOverlayMesh = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({
        color: 0x22c55e,
        transparent: true,
        opacity: 0.78,
        side: THREE.DoubleSide,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
      })
    );
    this.positiveAdjacencyOverlayMesh.frustumCulled = false;
    this.scene.add(this.positiveAdjacencyOverlayMesh);

    this.penaltyAdjacencyOverlayMesh = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({
        color: 0xef4444,
        transparent: true,
        opacity: 0.82,
        side: THREE.DoubleSide,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
      })
    );
    this.penaltyAdjacencyOverlayMesh.frustumCulled = false;
    this.scene.add(this.penaltyAdjacencyOverlayMesh);
    // Batched seasonal detail InstancedMeshes (spring blossoms, 4-season farm crops, winter northern ice)
    const flowerGeo = new THREE.DodecahedronGeometry(0.026 * HEX_WORLD_SCALE, 0);
    const flowerMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.62,
      metalness: 0.0,
      flatShading: true,
    });
    this.springFlowersMesh = new THREE.InstancedMesh(flowerGeo, flowerMat, 1);
    this.springFlowersMesh.count = 0;
    this.springFlowersMesh.frustumCulled = false;
    this.scene.add(this.springFlowersMesh);

    const cropStalkGeo = new THREE.BoxGeometry(
      0.32 * HEX_WORLD_SCALE,
      0.095 * HEX_WORLD_SCALE,
      0.042 * HEX_WORLD_SCALE
    );
    const cropStalkMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.78,
      metalness: 0.02,
      flatShading: true,
    });
    this.farmCropStalksMesh = new THREE.InstancedMesh(cropStalkGeo, cropStalkMat, 1);
    this.farmCropStalksMesh.count = 0;
    this.farmCropStalksMesh.frustumCulled = false;
    this.scene.add(this.farmCropStalksMesh);

    const cropHeadGeo = new THREE.BoxGeometry(
      0.34 * HEX_WORLD_SCALE,
      0.046 * HEX_WORLD_SCALE,
      0.048 * HEX_WORLD_SCALE
    );
    const cropHeadMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.72,
      metalness: 0.04,
      flatShading: true,
    });
    this.farmCropHeadsMesh = new THREE.InstancedMesh(cropHeadGeo, cropHeadMat, 1);
    this.farmCropHeadsMesh.count = 0;
    this.farmCropHeadsMesh.frustumCulled = false;
    this.scene.add(this.farmCropHeadsMesh);

    const iceGeo = new THREE.CylinderGeometry(
      HEX_OUTER_RADIUS * 0.72,
      HEX_OUTER_RADIUS * 0.78,
      0.015 * HEX_WORLD_SCALE,
      6
    );
    const iceMat = new THREE.MeshStandardMaterial({
      color: 0xdff2ff,
      roughness: 0.25,
      metalness: 0.08,
      transparent: true,
      opacity: 0.76,
      flatShading: true,
    });
    this.winterIceMesh = new THREE.InstancedMesh(iceGeo, iceMat, 1);
    this.winterIceMesh.count = 0;
    this.winterIceMesh.frustumCulled = false;
    this.scene.add(this.winterIceMesh);

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

    const roadsGeo = new THREE.BufferGeometry();
    roadsGeo.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
    roadsGeo.setAttribute('color', new THREE.Float32BufferAttribute([], 3));
    this.roadsMesh = new THREE.Mesh(
      roadsGeo,
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.78,
        metalness: 0.04,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      })
    );
    this.roadsMesh.frustumCulled = false;
    this.roadsMesh.receiveShadow = this.quality.shadowsEnabled;
    this.scene.add(this.roadsMesh);

    const corridorMat = new THREE.MeshBasicMaterial({
      color: 0xfbbf24,
      transparent: true,
      opacity: 0.72,
      side: THREE.DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.tradeCorridorsMesh = new THREE.Mesh(new THREE.BufferGeometry(), corridorMat);
    this.tradeCorridorsMesh.frustumCulled = false;
    this.scene.add(this.tradeCorridorsMesh);

    const roadLampOrbGeo = new THREE.SphereGeometry(0.036 * HEX_WORLD_SCALE, 6, 5);
    this.roadLanternsMesh = new THREE.InstancedMesh(
      roadLampOrbGeo,
      this.nightLanternGlowMat,
      1
    );
    this.roadLanternsMesh.count = 0;
    this.roadLanternsMesh.frustumCulled = false;
    this.scene.add(this.roadLanternsMesh);

    this.scene.add(this.citiesGroup);
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

    // Living world Layer 1: Ambient seasonal wind / rain / snow / firefly motes
    this.ambientMoteCount =
      this.quality.tier === 'desktop-high'
        ? 24
        : this.quality.tier === 'mobile-balanced'
          ? 12
          : 6;
    const moteGeo = new THREE.OctahedronGeometry(0.055 * HEX_WORLD_SCALE, 0);
    this.ambientMotesMat = new THREE.MeshBasicMaterial({
      color: 0xfef3c7,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
    this.ambientMotesMesh = new THREE.InstancedMesh(
      moteGeo,
      this.ambientMotesMat,
      this.ambientMoteCount
    );
    this.ambientMotesMesh.frustumCulled = false;
    for (let i = 0; i < this.ambientMoteCount; i++) {
      this.ambientMotes.push({
        ox: (Math.sin(i * 12.7 + 1.3) * 0.5) * 20,
        oy: 0.7 + ((i * 0.43) % 2.4),
        oz: (Math.cos(i * 9.1 + 0.7) * 0.5) * 20,
        speed: 0.35 + ((i * 0.17) % 0.45),
        phase: i * 1.37,
        scale: 0.65 + ((i * 0.23) % 0.6),
      });
      _dummy.position.set(0, -10, 0);
      _dummy.scale.setScalar(0);
      _dummy.updateMatrix();
      this.ambientMotesMesh.setMatrixAt(i, _dummy.matrix);
    }
    this.ambientMotesMesh.instanceMatrix.needsUpdate = true;
    this.scene.add(this.ambientMotesMesh);

    // Living world Layer 2: Chimney smoke wisps (32 pooled instances)
    const smokeGeo = new THREE.IcosahedronGeometry(0.068 * HEX_WORLD_SCALE, 0);
    const smokeMat = new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      roughness: 0.95,
      metalness: 0,
      transparent: true,
      opacity: 0.48,
      depthWrite: false,
    });
    this.smokeMesh = new THREE.InstancedMesh(smokeGeo, smokeMat, 32);
    this.smokeMesh.frustumCulled = false;
    for (let i = 0; i < 32; i++) {
      _dummy.position.set(0, -10, 0);
      _dummy.scale.setScalar(0);
      _dummy.updateMatrix();
      this.smokeMesh.setMatrixAt(i, _dummy.matrix);
    }
    this.smokeMesh.instanceMatrix.needsUpdate = true;
    this.scene.add(this.smokeMesh);

    // Living world Layer 3: Forge embers & dusk/night warm window lanterns (48 pooled instances)
    const lightOrbGeo = new THREE.BoxGeometry(
      0.075 * HEX_WORLD_SCALE,
      0.075 * HEX_WORLD_SCALE,
      0.075 * HEX_WORLD_SCALE
    );
    const lightOrbMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.88,
      depthWrite: false,
    });
    this.forgeLightsMesh = new THREE.InstancedMesh(lightOrbGeo, lightOrbMat, 48);
    this.forgeLightsMesh.frustumCulled = false;
    for (let i = 0; i < 48; i++) {
      _dummy.position.set(0, -10, 0);
      _dummy.scale.setScalar(0);
      _dummy.updateMatrix();
      this.forgeLightsMesh.setMatrixAt(i, _dummy.matrix);
      this.forgeLightsMesh.setColorAt(i, _colorTmp.setHex(0xfbbf24));
    }
    this.forgeLightsMesh.instanceMatrix.needsUpdate = true;
    this.scene.add(this.forgeLightsMesh);

    // Living world Layer 4: Gently waving banners / pennants on castles, towers & barracks (32 pooled instances)
    const bannerGeo = new THREE.BoxGeometry(
      0.16 * HEX_WORLD_SCALE,
      0.08 * HEX_WORLD_SCALE,
      0.018 * HEX_WORLD_SCALE
    );
    bannerGeo.translate(0.08 * HEX_WORLD_SCALE, 0, 0);
    const bannerMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.65,
      metalness: 0.05,
    });
    this.bannersMesh = new THREE.InstancedMesh(bannerGeo, bannerMat, 32);
    this.bannersMesh.frustumCulled = false;
    for (let i = 0; i < 32; i++) {
      _dummy.position.set(0, -10, 0);
      _dummy.scale.setScalar(0);
      _dummy.updateMatrix();
      this.bannersMesh.setMatrixAt(i, _dummy.matrix);
      this.bannersMesh.setColorAt(i, _colorTmp.setHex(0x059669));
    }
    this.bannersMesh.instanceMatrix.needsUpdate = true;
    this.scene.add(this.bannersMesh);

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
    return aspect < 0.8 ? 26.5 : 19.0;
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
    this.wakeRenderLoop();
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
      this.wakeRenderLoop();
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
      this.zoomBy(-2.5);
    } else if (e.code === 'Minus' || e.code === 'NumpadSubtract') {
      this.zoomBy(2.5);
    }
    this.wakeRenderLoop();
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
      } else if (this.toolMode === 'road') {
        this.callbacks.onRoadAt(this.hoveredCoord.q, this.hoveredCoord.r);
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
    this.wakeRenderLoop();
  };

  private onWheel = (e: WheelEvent) => {
    if (this.gameState !== 'playing') return;
    e.preventDefault();
    if (e.shiftKey) {
      this.callbacks.onCycleStructure(e.deltaY > 0 ? 1 : -1);
    } else {
      const zoomStep = e.ctrlKey || e.metaKey ? 1.8 : 3.0;
      this.zoomBy(e.deltaY > 0 ? zoomStep : -zoomStep);
    }
    this.wakeRenderLoop();
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
      this.wakeRenderLoop();
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
    } else if (this.toolMode === 'road') {
      const targetKey = hexKey(activeCoord.q, activeCoord.r);
      const existing = this.currentWorldState.hexes[targetKey];
      const ownedByPlayer = existing?.owner === 'player';
      const terrainInfo = getHexTerrainAndResource(activeCoord.q, activeCoord.r, existing);
      const assetName = existing ? (HEX_ASSETS[existing.structureIndex]?.name ?? '') : '';
      const isBridge = assetName === 'bridge';
      const passable = terrainInfo.terrainType !== 'water' || isBridge;
      this.selectorRingMat.color.setHex(
        ownedByPlayer && passable ? 0x059669 : 0xdc2626
      );
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
    this.wakeRenderLoop();
  }

  public setAccessibilityOptions(opts: {
    reduceAnimations?: boolean;
    reduceEffects?: boolean;
  }) {
    if (typeof opts.reduceAnimations === 'boolean') {
      this.reduceAnimations = opts.reduceAnimations;
      if (this.reduceAnimations) {
        for (const anim of this.popAnims) {
          anim.mesh.scale.setScalar(HEX_WORLD_SCALE);
        }
        this.popAnims = [];
      }
    }
    if (typeof opts.reduceEffects === 'boolean') {
      this.reduceEffects = opts.reduceEffects;
    }
    this.wakeRenderLoop();
  }

  public triggerEventEffect(
    kind:
      | 'build_complete'
      | 'upgrade'
      | 'module'
      | 'road'
      | 'city'
      | 'discovery'
      | 'conquest'
      | 'event'
      | 'research'
      | 'combat',
    coord: AxialCoord
  ) {
    const pos = axialToWorld(coord.q, coord.r);
    const key = hexKey(coord.q, coord.r);
    const colorByKind: Record<typeof kind, number> = {
      build_complete: 0x34d399,
      upgrade: 0xfbbf24,
      module: 0x38bdf8,
      road: 0xd6d3d1,
      city: 0xf59e0b,
      discovery: 0x22d3ee,
      conquest: 0xfbbf24,
      event: 0xa78bfa,
      research: 0x38bdf8,
      combat: 0xf87171,
    };
    const countByKind: Record<typeof kind, number> = {
      build_complete: 8,
      upgrade: 10,
      module: 6,
      road: 5,
      city: 12,
      discovery: 12,
      conquest: 12,
      event: 8,
      research: 12,
      combat: 10,
    };
    const color = colorByKind[kind];
    this.spawnConquestWave(pos.x, pos.z, color);
    this.spawnParticleBurst(pos.x, TILE_SURFACE_Y + 0.08, pos.z, color, countByKind[kind]);

    const placed = this.placedMeshes.get(key);
    if (placed && !this.reduceAnimations) {
      placed.group.scale.set(
        1.08 * HEX_WORLD_SCALE,
        0.78 * HEX_WORLD_SCALE,
        1.08 * HEX_WORLD_SCALE
      );
      this.popAnims.push({ mesh: placed.group, progress: 0 });
    }
    this.wakeRenderLoop();
  }

  public triggerCombatEffect(
    fromCoord: AxialCoord,
    toCoord: AxialCoord,
    captured: boolean
  ) {
    const fromPos = axialToWorld(fromCoord.q, fromCoord.r);
    const toPos = axialToWorld(toCoord.q, toCoord.r);
    const midX = (fromPos.x + toPos.x) * 0.5;
    const midZ = (fromPos.z + toPos.z) * 0.5;
    this.spawnParticleBurst(midX, TILE_SURFACE_Y + 0.16, midZ, 0xfef08a, 8);
    this.spawnParticleBurst(toPos.x, TILE_SURFACE_Y + 0.14, toPos.z, captured ? 0xfbbf24 : 0xef4444, 10);
    this.spawnConquestWave(toPos.x, toPos.z, captured ? 0xfbbf24 : 0xef4444);
    this.wakeRenderLoop();
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
    this.wakeRenderLoop();
  }

  public setToolMode(mode: BuilderToolMode) {
    this.toolMode = mode;
    this.selectorPreviewGroup.visible = mode === 'build';
    this.frontierOverlayMesh.visible = true;
    this.refreshSelectorAnchor();
    this.wakeRenderLoop();
  }

  public centerCamera() {
    const aspect =
      Math.max(this.container.clientWidth, 1) /
      Math.max(this.container.clientHeight, 1);
    const home = this.getHomeWorldPos();
    this.camTargetGoal.set(home.x, 0, home.z);
    this.camDistanceGoal = this.getDefaultCameraDistance(aspect);
    this.wakeRenderLoop();
  }

  public zoomBy(delta: number) {
    this.camDistanceGoal = THREE.MathUtils.clamp(
      this.camDistanceGoal + delta,
      CAMERA_MIN_DIST,
      CAMERA_MAX_DIST
    );
    this.wakeRenderLoop();
  }

  public rotateCameraBy(radians: number) {
    this.camYawGoal += radians;
    this.wakeRenderLoop();
  }

  public setSelectedPiece(structureIndex: number, rotationDeg: number) {
    this.currentRotationDeg = rotationDeg;
    this.selectorPreviewGroup.rotation.y = THREE.MathUtils.degToRad(rotationDeg);

    if (structureIndex !== this.currentPreviewIndex) {
      this.currentPreviewIndex = structureIndex;
      this.refreshSelectorPreview(structureIndex);
      this.refreshSelectorAnchor();
    }
    this.wakeRenderLoop();
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
      this.wakeRenderLoop();
    } catch {
      // Ignore individual load errors gracefully
    }
  }

  private loadModel(assetName: string): Promise<THREE.Group> {
    const cached = this.modelCache.get(assetName);
    if (cached) return Promise.resolve(cached);

    const existingPromise = this.loadingPromises.get(assetName);
    if (existingPromise) return existingPromise;

    const url = withBasePath(`/godot-assets/models/${assetName}.glb`);
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

  private getSharedUpgradeGeo(
    key: string,
    factory: () => THREE.BufferGeometry
  ): THREE.BufferGeometry {
    let geo = this.upgradeGeoCache.get(key);
    if (!geo) {
      geo = factory();
      this.upgradeGeoCache.set(key, geo);
    }
    return geo;
  }

  private getTileModulesList(tile: PlacedHex | null | undefined): string[] {
    return getInstalledModules(tile);
  }

  private getModulesSig(tile: PlacedHex | null | undefined): string {
    const mods = this.getTileModulesList(tile);
    return mods.length > 0 ? mods.slice().sort().join(',') : '';
  }

  private buildUpgradeAttachmentGroup(
    assetName: string,
    level: number,
    isUnderConstruction: boolean,
    modules: readonly string[] = []
  ): THREE.Group | null {
    if (isUnderConstruction) return null;
    const hasLanternBaseline = NIGHT_LANTERN_BUILDING_ASSETS.has(assetName);
    if (level <= 1 && !hasLanternBaseline && modules.length === 0) return null;

    const group = new THREE.Group();
    const yBase = getBuildingBaseSurfaceY(assetName);
    const plinthY = yBase > 0.2 ? 0.2 : yBase;

    // Subtle courtyard lantern post for completed settlements/civic structures at night
    if (hasLanternBaseline) {
      const postGeo = this.getSharedUpgradeGeo(
        'lantern-post',
        () => new THREE.CylinderGeometry(0.014, 0.02, 0.14, 5)
      );
      const orbGeo = this.getSharedUpgradeGeo(
        'lantern-orb',
        () => new THREE.SphereGeometry(0.028, 6, 5)
      );
      const post = new THREE.Mesh(postGeo, this.upgradeTimberMat);
      post.position.set(-0.28, yBase + 0.07, 0.22);
      const orb = new THREE.Mesh(orbGeo, this.nightLanternGlowMat);
      orb.position.set(-0.28, yBase + 0.15, 0.22);
      group.add(post, orb);
    }

    // Modular building attachments (independent of structural Nv. I-IV)
    if (modules.length > 0) {
      this.appendModuleAttachments(group, assetName, level, modules);
    }

    if (level < 2) {
      return group;
    }

    const tierInfo = getBuildingUpgradeTier(assetName, level);
    const hint = tierInfo?.visualHint ?? 'plinth';

    // Tier 2+: Elevated stone foundation plinth & glowing facade window panes
    const plinthGeo = this.getSharedUpgradeGeo(
      'tier-plinth',
      () => new THREE.CylinderGeometry(0.41, 0.44, 0.048, 6)
    );
    const plinth = new THREE.Mesh(plinthGeo, this.upgradeStoneMat);
    plinth.position.set(0, plinthY + 0.018, 0);
    group.add(plinth);

    const winGeo = this.getSharedUpgradeGeo(
      'tier-window',
      () => new THREE.BoxGeometry(0.045, 0.055, 0.02)
    );
    const w1 = new THREE.Mesh(winGeo, this.nightLanternGlowMat);
    w1.position.set(0.18, yBase + 0.15, 0.24);
    const w2 = new THREE.Mesh(winGeo, this.nightLanternGlowMat);
    w2.position.set(-0.18, yBase + 0.15, 0.24);
    group.add(w1, w2);

    // Side annex / wing / reinforced bastion for Tier 2+
    if (hint === 'wing' || hint === 'plinth' || level >= 2) {
      const annexGeo = this.getSharedUpgradeGeo(
        'tier-annex',
        () => new THREE.BoxGeometry(0.16, 0.14, 0.16)
      );
      const annexRoofGeo = this.getSharedUpgradeGeo(
        'tier-annex-roof',
        () => new THREE.ConeGeometry(0.135, 0.1, 4)
      );
      const annex = new THREE.Mesh(annexGeo, this.upgradeStoneMat);
      annex.position.set(0.26, yBase + 0.09, -0.14);
      const roof = new THREE.Mesh(annexRoofGeo, this.upgradeRoofMat);
      roof.position.set(0.26, yBase + 0.21, -0.14);
      roof.rotation.y = Math.PI / 4;
      group.add(annex, roof);
    }

    // Extra courtyard lantern at Tier 2+
    const orbGeo2 = this.getSharedUpgradeGeo(
      'lantern-orb',
      () => new THREE.SphereGeometry(0.028, 6, 5)
    );
    const postGeo2 = this.getSharedUpgradeGeo(
      'lantern-post',
      () => new THREE.CylinderGeometry(0.014, 0.02, 0.14, 5)
    );
    const post2 = new THREE.Mesh(postGeo2, this.upgradeTimberMat);
    post2.position.set(0.28, yBase + 0.07, 0.22);
    const orb2 = new THREE.Mesh(orbGeo2, this.nightLanternGlowMat);
    orb2.position.set(0.28, yBase + 0.15, 0.22);
    group.add(post2, orb2);

    // Tier 3+: Watchtower / spire turret & gilded trim
    if (level >= 3) {
      const turretGeo = this.getSharedUpgradeGeo(
        'tier3-turret',
        () => new THREE.CylinderGeometry(0.075, 0.09, 0.28, 6)
      );
      const spireGeo = this.getSharedUpgradeGeo(
        'tier3-spire',
        () => new THREE.ConeGeometry(0.105, 0.16, 6)
      );
      const turret = new THREE.Mesh(turretGeo, this.upgradeStoneMat);
      turret.position.set(-0.24, yBase + 0.16, -0.2);
      const spire = new THREE.Mesh(spireGeo, this.upgradeRoofMat);
      spire.position.set(-0.24, yBase + 0.38, -0.2);

      const beacon = new THREE.Mesh(orbGeo2, this.nightLanternGlowMat);
      beacon.position.set(-0.24, yBase + 0.47, -0.2);
      group.add(turret, spire, beacon);

      const crestGeo = this.getSharedUpgradeGeo(
        'tier3-crest',
        () => new THREE.BoxGeometry(0.22, 0.032, 0.05)
      );
      const crest = new THREE.Mesh(crestGeo, this.upgradeGoldMat);
      crest.position.set(0, yBase + 0.34, 0.21);
      group.add(crest);
    }

    // Tier 4 (Castelo Real IV — Bastilha Imperial): Corner bastions + imperial gold crown
    if (level >= 4) {
      const bastionGeo = this.getSharedUpgradeGeo(
        'tier4-bastion',
        () => new THREE.CylinderGeometry(0.055, 0.068, 0.24, 6)
      );
      const finialGeo = this.getSharedUpgradeGeo(
        'tier4-finial',
        () => new THREE.OctahedronGeometry(0.05, 0)
      );
      const corners: Array<[number, number]> = [
        [0.32, 0.0],
        [-0.32, 0.0],
        [0.0, -0.32],
      ];
      for (const [cx, cz] of corners) {
        const bastion = new THREE.Mesh(bastionGeo, this.upgradeStoneMat);
        bastion.position.set(cx, yBase + 0.14, cz);
        const brazier = new THREE.Mesh(orbGeo2, this.nightLanternGlowMat);
        brazier.position.set(cx, yBase + 0.275, cz);
        group.add(bastion, brazier);
      }
      const crown = new THREE.Mesh(finialGeo, this.upgradeGoldMat);
      crown.position.set(0, yBase + 0.66, 0);
      group.add(crown);
    }

    return group;
  }

  private appendModuleAttachments(
    group: THREE.Group,
    assetName: string,
    level: number,
    modules: readonly string[]
  ): void {
    const postSmGeo = this.getSharedUpgradeGeo(
      'mod-post-sm',
      () => new THREE.BoxGeometry(0.016, 0.095, 0.016)
    );
    const orbSmGeo = this.getSharedUpgradeGeo(
      'mod-globe-sm',
      () => new THREE.SphereGeometry(0.022, 6, 5)
    );
    const emberOrbGeo = this.getSharedUpgradeGeo(
      'mod-ember-orb',
      () => new THREE.SphereGeometry(0.032, 6, 5)
    );
    const crateSmGeo = this.getSharedUpgradeGeo(
      'mod-crate-sm',
      () => new THREE.BoxGeometry(0.034, 0.03, 0.034)
    );
    const shopBodyGeo = this.getSharedUpgradeGeo(
      'mod-shop-body',
      () => new THREE.BoxGeometry(0.1, 0.085, 0.095)
    );
    const shopRoofGeo = this.getSharedUpgradeGeo(
      'mod-shop-roof',
      () => new THREE.ConeGeometry(0.085, 0.068, 4)
    );
    const finialSmGeo = this.getSharedUpgradeGeo(
      'mod-finial-sm',
      () => new THREE.OctahedronGeometry(0.024, 0)
    );
    const winSmGeo = this.getSharedUpgradeGeo(
      'mod-win-sm',
      () => new THREE.BoxGeometry(0.048, 0.038, 0.016)
    );
    const logSmGeo = this.getSharedUpgradeGeo(
      'mod-log-sm',
      () => new THREE.CylinderGeometry(0.016, 0.016, 0.1, 6)
    );
    const oreBinGeo = this.getSharedUpgradeGeo(
      'mod-orebin-wall',
      () => new THREE.BoxGeometry(0.13, 0.055, 0.11)
    );
    const oreChunkGeo = this.getSharedUpgradeGeo(
      'mod-ore-chunk',
      () => new THREE.OctahedronGeometry(0.034, 0)
    );
    const whBaseGeo = this.getSharedUpgradeGeo(
      'mod-wh-base',
      () => new THREE.BoxGeometry(0.13, 0.058, 0.11)
    );
    const whLoftGeo = this.getSharedUpgradeGeo(
      'mod-wh-loft',
      () => new THREE.BoxGeometry(0.122, 0.05, 0.102)
    );
    const whRoofGeo = this.getSharedUpgradeGeo(
      'mod-wh-roof',
      () => new THREE.ConeGeometry(0.1, 0.068, 4)
    );
    const lhBaseGeo = this.getSharedUpgradeGeo(
      'mod-lh-base',
      () => new THREE.CylinderGeometry(0.065, 0.072, 0.05, 8)
    );
    const lhGalleryGeo = this.getSharedUpgradeGeo(
      'mod-lh-gal',
      () => new THREE.CylinderGeometry(0.05, 0.044, 0.024, 8)
    );
    const plazaPadGeo = this.getSharedUpgradeGeo(
      'mod-plaza-pad',
      () => new THREE.CylinderGeometry(0.088, 0.094, 0.024, 6)
    );
    const lampPoleGeo = this.getSharedUpgradeGeo(
      'mod-lamp-pole',
      () => new THREE.CylinderGeometry(0.01, 0.01, 0.08, 5)
    );

    const seen = new Set<string>();

    for (const rawId of modules) {
      if (seen.has(rawId) || !isValidBuildingModuleId(rawId)) continue;
      seen.add(rawId);

      const placement = getBuildingModuleVisualPlacement(assetName, rawId, level);
      const sub = new THREE.Group();
      sub.position.set(placement.offsetX, placement.groundY, placement.offsetZ);
      sub.rotation.y = placement.rotationY;

      const kind = placement.visualKind;
      switch (kind) {
        case 'silo': {
          const pad = new THREE.Mesh(
            this.getSharedUpgradeGeo('mod-silo-pad', () => new THREE.CylinderGeometry(0.064, 0.068, 0.02, 8)),
            this.upgradeStoneMat
          );
          pad.position.set(0, 0.004, 0);
          const body = new THREE.Mesh(
            this.getSharedUpgradeGeo('mod-silo-body', () => new THREE.CylinderGeometry(0.054, 0.058, 0.175, 8)),
            this.upgradeStoneMat
          );
          body.position.set(0, 0.095, 0);
          const band = new THREE.Mesh(
            this.getSharedUpgradeGeo('mod-silo-band', () => new THREE.CylinderGeometry(0.058, 0.058, 0.016, 8)),
            this.upgradeDarkMetalMat
          );
          band.position.set(0, 0.145, 0);
          const cap = new THREE.Mesh(
            this.getSharedUpgradeGeo('mod-silo-cap', () => new THREE.ConeGeometry(0.065, 0.065, 8)),
            this.upgradeRoofMat
          );
          cap.position.set(0, 0.215, 0);
          sub.add(pad, body, band, cap);
          break;
        }
        case 'irrigation_canal': {
          const bed = new THREE.Mesh(
            this.getSharedUpgradeGeo('mod-canal-bed', () => new THREE.BoxGeometry(0.062, 0.032, 0.15)),
            this.upgradeStoneMat
          );
          bed.position.set(0, 0.012, 0);
          const flow = new THREE.Mesh(
            this.getSharedUpgradeGeo('mod-canal-water', () => new THREE.BoxGeometry(0.042, 0.02, 0.142)),
            this.waterMat
          );
          flow.position.set(0, 0.024, 0);
          const sluice = new THREE.Mesh(
            this.getSharedUpgradeGeo('mod-canal-gate', () => new THREE.BoxGeometry(0.07, 0.065, 0.018)),
            this.upgradeTimberMat
          );
          sluice.position.set(0, 0.042, -0.055);
          sub.add(bed, flow, sluice);
          break;
        }
        case 'barn': {
          const body = new THREE.Mesh(
            this.getSharedUpgradeGeo('mod-barn-body', () => new THREE.BoxGeometry(0.125, 0.095, 0.105)),
            this.upgradeTimberMat
          );
          body.position.set(0, 0.043, 0);
          const roof = new THREE.Mesh(
            this.getSharedUpgradeGeo('mod-barn-roof', () => new THREE.ConeGeometry(0.096, 0.075, 4)),
            this.upgradeRoofMat
          );
          roof.position.set(0, 0.125, 0);
          roof.rotation.y = Math.PI / 4;
          const door = new THREE.Mesh(
            this.getSharedUpgradeGeo('mod-barn-door', () => new THREE.BoxGeometry(0.045, 0.058, 0.016)),
            this.upgradeDarkMetalMat
          );
          door.position.set(0, 0.03, 0.052);
          const bale = new THREE.Mesh(
            this.getSharedUpgradeGeo('mod-hay-bale', () => new THREE.CylinderGeometry(0.022, 0.022, 0.036, 6)),
            this.upgradeGoldMat
          );
          bale.position.set(0.058, 0.018, 0.052);
          bale.rotation.z = Math.PI / 2;
          sub.add(body, roof, door, bale);
          break;
        }
        case 'seed_vault': {
          const base = new THREE.Mesh(
            this.getSharedUpgradeGeo('mod-vault-base', () => new THREE.BoxGeometry(0.115, 0.075, 0.115)),
            this.upgradeStoneMat
          );
          base.position.set(0, 0.034, 0);
          const turf = new THREE.Mesh(
            this.getSharedUpgradeGeo('mod-vault-turf', () => new THREE.BoxGeometry(0.122, 0.024, 0.122)),
            this.upgradeFoliageMat
          );
          turf.position.set(0, 0.08, 0);
          const portal = new THREE.Mesh(
            this.getSharedUpgradeGeo('mod-vault-door', () => new THREE.CylinderGeometry(0.034, 0.034, 0.02, 6)),
            this.upgradeGoldMat
          );
          portal.position.set(0, 0.035, 0.056);
          portal.rotation.x = Math.PI / 2;
          sub.add(base, turf, portal);
          break;
        }
        case 'drying_yard': {
          const slab = new THREE.Mesh(
            this.getSharedUpgradeGeo('mod-dry-base', () => new THREE.BoxGeometry(0.125, 0.02, 0.1)),
            this.upgradeStoneMat
          );
          slab.position.set(0, 0.008, 0);
          sub.add(slab);
          const corners: Array<[number, number]> = [
            [-0.052, -0.038],
            [0.052, -0.038],
            [-0.052, 0.038],
            [0.052, 0.038],
          ];
          for (const [px, pz] of corners) {
            const post = new THREE.Mesh(postSmGeo, this.upgradeTimberMat);
            post.position.set(px, 0.046, pz);
            sub.add(post);
          }
          const canopy = new THREE.Mesh(
            this.getSharedUpgradeGeo('mod-dry-roof', () => new THREE.BoxGeometry(0.135, 0.016, 0.11)),
            this.upgradeRoofMat
          );
          canopy.position.set(0, 0.098, 0);
          canopy.rotation.x = 0.14;
          const log1 = new THREE.Mesh(logSmGeo, this.upgradeGoldMat);
          log1.position.set(0, 0.032, -0.015);
          log1.rotation.z = Math.PI / 2;
          const log2 = new THREE.Mesh(logSmGeo, this.upgradeTimberMat);
          log2.position.set(0, 0.032, 0.018);
          log2.rotation.z = Math.PI / 2;
          sub.add(canopy, log1, log2);
          break;
        }
        case 'wood_workshop': {
          const cabin = new THREE.Mesh(shopBodyGeo, this.upgradeTimberMat);
          cabin.position.set(0, 0.038, -0.008);
          const roof = new THREE.Mesh(shopRoofGeo, this.upgradeRoofMat);
          roof.position.set(0, 0.112, -0.008);
          roof.rotation.y = Math.PI / 4;
          const bench = new THREE.Mesh(
            this.getSharedUpgradeGeo('mod-bench', () => new THREE.BoxGeometry(0.09, 0.028, 0.04)),
            this.upgradeGoldMat
          );
          bench.position.set(0, 0.025, 0.058);
          const vise = new THREE.Mesh(
            this.getSharedUpgradeGeo('mod-vise', () => new THREE.BoxGeometry(0.025, 0.032, 0.02)),
            this.upgradeDarkMetalMat
          );
          vise.position.set(0.028, 0.05, 0.058);
          sub.add(cabin, roof, bench, vise);
          break;
        }
        case 'timber_carts': {
          const bed = new THREE.Mesh(
            this.getSharedUpgradeGeo('mod-cart-bed', () => new THREE.BoxGeometry(0.072, 0.026, 0.11)),
            this.upgradeTimberMat
          );
          bed.position.set(0, 0.036, 0);
          const wheelGeo = this.getSharedUpgradeGeo(
            'mod-cart-wheel',
            () => new THREE.CylinderGeometry(0.028, 0.028, 0.014, 8)
          );
          const wl = new THREE.Mesh(wheelGeo, this.upgradeDarkMetalMat);
          wl.position.set(-0.044, 0.026, 0);
          wl.rotation.z = Math.PI / 2;
          const wr = new THREE.Mesh(wheelGeo, this.upgradeDarkMetalMat);
          wr.position.set(0.044, 0.026, 0);
          wr.rotation.z = Math.PI / 2;
          const l1 = new THREE.Mesh(logSmGeo, this.upgradeGoldMat);
          l1.position.set(-0.016, 0.058, 0);
          l1.rotation.x = Math.PI / 2;
          const l2 = new THREE.Mesh(logSmGeo, this.upgradeGoldMat);
          l2.position.set(0.016, 0.058, 0);
          l2.rotation.x = Math.PI / 2;
          const l3 = new THREE.Mesh(logSmGeo, this.upgradeTimberMat);
          l3.position.set(0, 0.08, 0);
          l3.rotation.x = Math.PI / 2;
          sub.add(bed, wl, wr, l1, l2, l3);
          break;
        }
        case 'industrial_saw': {
          const trestle = new THREE.Mesh(
            this.getSharedUpgradeGeo('mod-saw-trestle', () => new THREE.BoxGeometry(0.13, 0.036, 0.08)),
            this.upgradeStoneMat
          );
          trestle.position.set(0, 0.014, 0);
          const gantry = new THREE.Mesh(
            this.getSharedUpgradeGeo('mod-saw-frame', () => new THREE.BoxGeometry(0.11, 0.085, 0.035)),
            this.upgradeTimberMat
          );
          gantry.position.set(0, 0.068, 0);
          const blade = new THREE.Mesh(
            this.getSharedUpgradeGeo('mod-saw-blade', () => new THREE.CylinderGeometry(0.048, 0.048, 0.012, 10)),
            this.upgradeDarkMetalMat
          );
          blade.position.set(0, 0.095, 0.026);
          blade.rotation.x = Math.PI / 2;
          const hub = new THREE.Mesh(
            this.getSharedUpgradeGeo('mod-saw-hub', () => new THREE.BoxGeometry(0.032, 0.034, 0.038)),
            this.upgradeGoldMat
          );
          hub.position.set(-0.035, 0.09, -0.01);
          sub.add(trestle, gantry, blade, hub);
          break;
        }
        case 'ore_depot': {
          const bin = new THREE.Mesh(oreBinGeo, this.upgradeStoneMat);
          bin.position.set(0, 0.022, 0);
          const rail = new THREE.Mesh(
            this.getSharedUpgradeGeo('mod-orebin-rail', () => new THREE.BoxGeometry(0.136, 0.016, 0.116)),
            this.upgradeTimberMat
          );
          rail.position.set(0, 0.054, 0);
          const ore1 = new THREE.Mesh(oreChunkGeo, this.upgradeDarkMetalMat);
          ore1.position.set(-0.022, 0.068, -0.005);
          const ore2 = new THREE.Mesh(oreChunkGeo, this.upgradeGoldMat);
          ore2.position.set(0.024, 0.062, 0.015);
          sub.add(bin, rail, ore1, ore2);
          break;
        }
        case 'toolshop': {
          const wall = new THREE.Mesh(
            this.getSharedUpgradeGeo('mod-smith-body', () => new THREE.BoxGeometry(0.105, 0.08, 0.095)),
            this.upgradeStoneMat
          );
          wall.position.set(0, 0.036, -0.006);
          const roof = new THREE.Mesh(shopRoofGeo, this.upgradeRoofMat);
          roof.position.set(0, 0.108, -0.006);
          roof.rotation.y = Math.PI / 4;
          const flue = new THREE.Mesh(
            this.getSharedUpgradeGeo('mod-flue', () => new THREE.CylinderGeometry(0.016, 0.022, 0.11, 6)),
            this.upgradeDarkMetalMat
          );
          flue.position.set(-0.032, 0.13, -0.022);
          const hearth = new THREE.Mesh(
            this.getSharedUpgradeGeo('mod-hearth', () => new THREE.BoxGeometry(0.042, 0.036, 0.018)),
            this.upgradeEmberMat
          );
          hearth.position.set(0.006, 0.024, 0.045);
          const anvil = new THREE.Mesh(
            this.getSharedUpgradeGeo('mod-anvil', () => new THREE.BoxGeometry(0.036, 0.028, 0.022)),
            this.upgradeDarkMetalMat
          );
          anvil.position.set(0.038, 0.018, 0.058);
          sub.add(wall, roof, flue, hearth, anvil);
          break;
        }
        case 'mine_drainage': {
          const basin = new THREE.Mesh(
            this.getSharedUpgradeGeo('mod-drain-basin', () => new THREE.BoxGeometry(0.09, 0.032, 0.135)),
            this.upgradeStoneMat
          );
          basin.position.set(0, 0.012, 0);
          const pool = new THREE.Mesh(
            this.getSharedUpgradeGeo('mod-drain-water', () => new THREE.BoxGeometry(0.06, 0.018, 0.12)),
            this.waterMat
          );
          pool.position.set(0, 0.025, 0);
          const pL = new THREE.Mesh(postSmGeo, this.upgradeTimberMat);
          pL.position.set(-0.026, 0.065, -0.035);
          const pR = new THREE.Mesh(postSmGeo, this.upgradeTimberMat);
          pR.position.set(0.026, 0.065, -0.035);
          const beam = new THREE.Mesh(
            this.getSharedUpgradeGeo('mod-rocker-beam', () => new THREE.BoxGeometry(0.095, 0.018, 0.022)),
            this.upgradeDarkMetalMat
          );
          beam.position.set(0, 0.115, -0.035);
          beam.rotation.z = 0.22;
          sub.add(basin, pool, pL, pR, beam);
          break;
        }
        case 'deep_gallery': {
          const pillarGeo = this.getSharedUpgradeGeo(
            'mod-gal-pillar',
            () => new THREE.BoxGeometry(0.032, 0.11, 0.065)
          );
          const leftP = new THREE.Mesh(pillarGeo, this.upgradeStoneMat);
          leftP.position.set(-0.048, 0.05, -0.01);
          const rightP = new THREE.Mesh(pillarGeo, this.upgradeStoneMat);
          rightP.position.set(0.048, 0.05, -0.01);
          const lintel = new THREE.Mesh(
            this.getSharedUpgradeGeo('mod-gal-lintel', () => new THREE.BoxGeometry(0.13, 0.032, 0.072)),
            this.upgradeStoneMat
          );
          lintel.position.set(0, 0.112, -0.01);
          const recess = new THREE.Mesh(
            this.getSharedUpgradeGeo('mod-gal-tunnel', () => new THREE.BoxGeometry(0.064, 0.085, 0.055)),
            this.upgradeDarkMetalMat
          );
          recess.position.set(0, 0.042, -0.015);
          const shoring = new THREE.Mesh(
            this.getSharedUpgradeGeo('mod-gal-beam', () => new THREE.BoxGeometry(0.095, 0.016, 0.018)),
            this.upgradeTimberMat
          );
          shoring.position.set(0, 0.092, 0.026);
          const track = new THREE.Mesh(
            this.getSharedUpgradeGeo('mod-gal-rail', () => new THREE.BoxGeometry(0.045, 0.012, 0.065)),
            this.upgradeDarkMetalMat
          );
          track.position.set(0, 0.008, 0.045);
          sub.add(leftP, rightP, lintel, recess, shoring, track);
          break;
        }
        case 'market_warehouse': {
          const base = new THREE.Mesh(whBaseGeo, this.upgradeStoneMat);
          base.position.set(0, 0.024, 0);
          const loft = new THREE.Mesh(whLoftGeo, this.upgradeTimberMat);
          loft.position.set(0, 0.078, 0);
          const roof = new THREE.Mesh(whRoofGeo, this.upgradeRoofMat);
          roof.position.set(0, 0.135, 0);
          roof.rotation.y = Math.PI / 4;
          const crate = new THREE.Mesh(crateSmGeo, this.upgradeGoldMat);
          crate.position.set(0.045, 0.016, 0.062);
          sub.add(base, loft, roof, crate);
          break;
        }
        case 'expanded_stalls': {
          const counterGeo = this.getSharedUpgradeGeo(
            'mod-stall-counter',
            () => new THREE.BoxGeometry(0.058, 0.036, 0.044)
          );
          const awningGeo = this.getSharedUpgradeGeo(
            'mod-stall-awning',
            () => new THREE.BoxGeometry(0.068, 0.014, 0.062)
          );
          const c1 = new THREE.Mesh(counterGeo, this.upgradeTimberMat);
          c1.position.set(-0.038, 0.016, 0);
          const c2 = new THREE.Mesh(counterGeo, this.upgradeTimberMat);
          c2.position.set(0.038, 0.016, 0.015);
          const a1 = new THREE.Mesh(awningGeo, this.upgradeRoofMat);
          a1.position.set(-0.038, 0.068, 0);
          a1.rotation.x = 0.25;
          const a2 = new THREE.Mesh(awningGeo, this.upgradeCanvasMat);
          a2.position.set(0.038, 0.068, 0.015);
          a2.rotation.x = 0.25;
          const pole1 = new THREE.Mesh(lampPoleGeo, this.upgradeTimberMat);
          pole1.position.set(-0.056, 0.038, -0.018);
          const pole2 = new THREE.Mesh(lampPoleGeo, this.upgradeTimberMat);
          pole2.position.set(0.056, 0.038, -0.002);
          const goods = new THREE.Mesh(
            this.getSharedUpgradeGeo('mod-basket', () => new THREE.CylinderGeometry(0.016, 0.012, 0.022, 6)),
            this.upgradeGoldMat
          );
          goods.position.set(-0.035, 0.038, 0.026);
          sub.add(c1, c2, a1, a2, pole1, pole2, goods);
          break;
        }
        case 'exchange_hall': {
          const body = new THREE.Mesh(
            this.getSharedUpgradeGeo('mod-exch-body', () => new THREE.BoxGeometry(0.12, 0.1, 0.11)),
            this.upgradeStoneMat
          );
          body.position.set(0, 0.046, 0);
          const dome = new THREE.Mesh(
            this.getSharedUpgradeGeo(
              'mod-exch-dome',
              () => new THREE.SphereGeometry(0.052, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.55)
            ),
            this.upgradeGoldMat
          );
          dome.position.set(0, 0.095, 0);
          const windowPane = new THREE.Mesh(winSmGeo, this.nightLanternGlowMat);
          windowPane.position.set(0, 0.055, 0.054);
          sub.add(body, dome, windowPane);
          break;
        }
        case 'trade_center': {
          const base = new THREE.Mesh(
            this.getSharedUpgradeGeo('mod-tc-base', () => new THREE.BoxGeometry(0.135, 0.09, 0.115)),
            this.upgradeStoneMat
          );
          base.position.set(0, 0.04, 0);
          const roof = new THREE.Mesh(
            this.getSharedUpgradeGeo('mod-tc-roof', () => new THREE.ConeGeometry(0.102, 0.065, 4)),
            this.upgradeRoofMat
          );
          roof.position.set(0, 0.115, 0);
          roof.rotation.y = Math.PI / 4;
          const cupola = new THREE.Mesh(
            this.getSharedUpgradeGeo('mod-tc-spire', () => new THREE.CylinderGeometry(0.026, 0.032, 0.06, 6)),
            this.upgradeCanvasMat
          );
          cupola.position.set(0, 0.155, 0);
          const crown = new THREE.Mesh(finialSmGeo, this.upgradeGoldMat);
          crown.position.set(0, 0.195, 0);
          sub.add(base, roof, cupola, crown);
          break;
        }
        case 'smelter_depot': {
          const wall = new THREE.Mesh(
            this.getSharedUpgradeGeo('mod-hopper-side', () => new THREE.BoxGeometry(0.14, 0.048, 0.105)),
            this.upgradeStoneMat
          );
          wall.position.set(0, 0.02, 0);
          const hopper = new THREE.Mesh(oreBinGeo, this.upgradeDarkMetalMat);
          hopper.position.set(0, 0.046, -0.005);
          const ore = new THREE.Mesh(oreChunkGeo, this.upgradeDarkMetalMat);
          ore.position.set(0.015, 0.072, 0);
          const ramp = new THREE.Mesh(
            this.getSharedUpgradeGeo('mod-ramp', () => new THREE.BoxGeometry(0.05, 0.016, 0.068)),
            this.upgradeTimberMat
          );
          ramp.position.set(-0.04, 0.036, 0.048);
          ramp.rotation.x = -0.35;
          sub.add(wall, hopper, ore, ramp);
          break;
        }
        case 'advanced_furnace': {
          const drum = new THREE.Mesh(
            this.getSharedUpgradeGeo('mod-furn-drum', () => new THREE.CylinderGeometry(0.062, 0.068, 0.125, 8)),
            this.upgradeStoneMat
          );
          drum.position.set(0, 0.058, 0);
          const stackGeo = this.getSharedUpgradeGeo(
            'mod-stack-sm',
            () => new THREE.CylinderGeometry(0.018, 0.022, 0.12, 6)
          );
          const s1 = new THREE.Mesh(stackGeo, this.upgradeDarkMetalMat);
          s1.position.set(-0.026, 0.155, -0.01);
          const s2 = new THREE.Mesh(stackGeo, this.upgradeDarkMetalMat);
          s2.position.set(0.026, 0.145, 0.01);
          const tap = new THREE.Mesh(
            this.getSharedUpgradeGeo('mod-tap-glow', () => new THREE.BoxGeometry(0.036, 0.038, 0.022)),
            this.upgradeEmberMat
          );
          tap.position.set(0, 0.032, 0.058);
          sub.add(drum, s1, s2, tap);
          break;
        }
        case 'cooling_system': {
          const vat = new THREE.Mesh(
            this.getSharedUpgradeGeo('mod-cool-vat', () => new THREE.CylinderGeometry(0.065, 0.072, 0.055, 8)),
            this.upgradeStoneMat
          );
          vat.position.set(0, 0.024, 0);
          const pool = new THREE.Mesh(
            this.getSharedUpgradeGeo('mod-cool-water', () => new THREE.CylinderGeometry(0.054, 0.054, 0.015, 8)),
            this.waterMat
          );
          pool.position.set(0, 0.049, 0);
          const tower = new THREE.Mesh(
            this.getSharedUpgradeGeo('mod-cool-tower', () => new THREE.CylinderGeometry(0.036, 0.048, 0.11, 6)),
            this.upgradeTimberMat
          );
          tower.position.set(0, 0.105, -0.012);
          const copperCoil = new THREE.Mesh(
            this.getSharedUpgradeGeo('mod-silo-band', () => new THREE.CylinderGeometry(0.058, 0.058, 0.016, 8)),
            this.upgradeGoldMat
          );
          copperCoil.position.set(0, 0.06, 0);
          sub.add(vat, pool, tower, copperCoil);
          break;
        }
        case 'high_temp_furnace': {
          const crucible = new THREE.Mesh(
            this.getSharedUpgradeGeo('mod-ht-base', () => new THREE.CylinderGeometry(0.068, 0.075, 0.055, 8)),
            this.upgradeStoneMat
          );
          crucible.position.set(0, 0.024, 0);
          const stack = new THREE.Mesh(
            this.getSharedUpgradeGeo('mod-ht-stack', () => new THREE.CylinderGeometry(0.042, 0.056, 0.17, 8)),
            this.upgradeDarkMetalMat
          );
          stack.position.set(0, 0.13, 0);
          const crown = new THREE.Mesh(emberOrbGeo, this.upgradeEmberMat);
          crown.position.set(0, 0.225, 0);
          const vent = new THREE.Mesh(
            this.getSharedUpgradeGeo('mod-tap-glow', () => new THREE.BoxGeometry(0.036, 0.038, 0.022)),
            this.upgradeEmberMat
          );
          vent.position.set(0, 0.042, 0.062);
          sub.add(crucible, stack, crown, vent);
          break;
        }
        case 'port_warehouse': {
          const base = new THREE.Mesh(whBaseGeo, this.upgradeStoneMat);
          base.position.set(0, 0.024, 0);
          const shed = new THREE.Mesh(whLoftGeo, this.upgradeTimberMat);
          shed.position.set(0, 0.074, 0);
          const roof = new THREE.Mesh(whRoofGeo, this.upgradeCanvasMat);
          roof.position.set(0, 0.13, 0);
          roof.rotation.y = Math.PI / 4;
          const barrelGeo = this.getSharedUpgradeGeo(
            'mod-barrel',
            () => new THREE.CylinderGeometry(0.016, 0.016, 0.034, 6)
          );
          const b1 = new THREE.Mesh(barrelGeo, this.upgradeTimberMat);
          b1.position.set(-0.036, 0.016, 0.062);
          const b2 = new THREE.Mesh(barrelGeo, this.upgradeTimberMat);
          b2.position.set(0.036, 0.016, 0.062);
          sub.add(base, shed, roof, b1, b2);
          break;
        }
        case 'port_crane': {
          const ped = new THREE.Mesh(
            this.getSharedUpgradeGeo('mod-crane-ped', () => new THREE.BoxGeometry(0.065, 0.045, 0.065)),
            this.upgradeStoneMat
          );
          ped.position.set(0, 0.018, 0);
          const mast = new THREE.Mesh(
            this.getSharedUpgradeGeo('mod-crane-mast', () => new THREE.CylinderGeometry(0.016, 0.02, 0.175, 6)),
            this.upgradeTimberMat
          );
          mast.position.set(0, 0.115, 0);
          const boom = new THREE.Mesh(
            this.getSharedUpgradeGeo('mod-crane-boom', () => new THREE.BoxGeometry(0.135, 0.02, 0.022)),
            this.upgradeTimberMat
          );
          boom.position.set(0.036, 0.185, 0);
          boom.rotation.z = 0.35;
          const crate = new THREE.Mesh(crateSmGeo, this.upgradeGoldMat);
          crate.position.set(0.068, 0.145, 0);
          sub.add(ped, mast, boom, crate);
          break;
        }
        case 'port_lighthouse': {
          const base = new THREE.Mesh(lhBaseGeo, this.upgradeStoneMat);
          base.position.set(0, 0.02, 0);
          const shaft = new THREE.Mesh(
            this.getSharedUpgradeGeo('mod-lh-shaft', () => new THREE.CylinderGeometry(0.042, 0.058, 0.175, 8)),
            this.upgradeCanvasMat
          );
          shaft.position.set(0, 0.13, 0);
          const stripe = new THREE.Mesh(
            this.getSharedUpgradeGeo('mod-lh-band', () => new THREE.CylinderGeometry(0.049, 0.052, 0.042, 8)),
            this.upgradeRoofMat
          );
          stripe.position.set(0, 0.12, 0);
          const gallery = new THREE.Mesh(lhGalleryGeo, this.upgradeDarkMetalMat);
          gallery.position.set(0, 0.222, 0);
          const lens = new THREE.Mesh(emberOrbGeo, this.nightLanternGlowMat);
          lens.position.set(0, 0.246, 0);
          const cap = new THREE.Mesh(
            this.getSharedUpgradeGeo('mod-lh-cap', () => new THREE.ConeGeometry(0.048, 0.055, 8)),
            this.upgradeRoofMat
          );
          cap.position.set(0, 0.285, 0);
          sub.add(base, shaft, stripe, gallery, lens, cap);
          break;
        }
        case 'expanded_dock': {
          const deck = new THREE.Mesh(
            this.getSharedUpgradeGeo('mod-pier-deck', () => new THREE.BoxGeometry(0.14, 0.022, 0.15)),
            this.upgradeTimberMat
          );
          deck.position.set(0, 0.095, 0);
          sub.add(deck);
          const pileGeo = this.getSharedUpgradeGeo(
            'mod-pier-pile',
            () => new THREE.CylinderGeometry(0.014, 0.015, 0.15, 6)
          );
          const pileCoords: Array<[number, number]> = [
            [-0.054, -0.056],
            [0.054, -0.056],
            [-0.054, 0.056],
            [0.054, 0.056],
          ];
          for (const [px, pz] of pileCoords) {
            const pile = new THREE.Mesh(pileGeo, this.upgradeTimberMat);
            pile.position.set(px, 0.025, pz);
            sub.add(pile);
          }
          const bollard = new THREE.Mesh(
            this.getSharedUpgradeGeo('mod-anvil', () => new THREE.BoxGeometry(0.036, 0.028, 0.022)),
            this.upgradeDarkMetalMat
          );
          bollard.position.set(-0.044, 0.114, 0.05);
          const quayPost = new THREE.Mesh(lampPoleGeo, this.upgradeTimberMat);
          quayPost.position.set(0.046, 0.145, 0.05);
          const quayGlow = new THREE.Mesh(orbSmGeo, this.nightLanternGlowMat);
          quayGlow.position.set(0.046, 0.188, 0.05);
          sub.add(bollard, quayPost, quayGlow);
          break;
        }
        case 'residential_wing': {
          const base = new THREE.Mesh(
            this.getSharedUpgradeGeo('mod-res-base', () => new THREE.BoxGeometry(0.115, 0.032, 0.1)),
            this.upgradeStoneMat
          );
          base.position.set(0, 0.012, 0);
          const body = new THREE.Mesh(shopBodyGeo, this.upgradeCanvasMat);
          body.position.set(0, 0.062, 0);
          const roof = new THREE.Mesh(shopRoofGeo, this.upgradeRoofMat);
          roof.position.set(0, 0.135, 0);
          roof.rotation.y = Math.PI / 4;
          const windowPane = new THREE.Mesh(winSmGeo, this.nightLanternGlowMat);
          windowPane.position.set(0, 0.068, 0.049);
          sub.add(base, body, roof, windowPane);
          break;
        }
        case 'stone_well': {
          const curb = new THREE.Mesh(
            this.getSharedUpgradeGeo('mod-well', () => new THREE.CylinderGeometry(0.052, 0.058, 0.068, 8)),
            this.upgradeStoneMat
          );
          curb.position.set(0, 0.03, 0);
          const water = new THREE.Mesh(
            this.getSharedUpgradeGeo('mod-well-water', () => new THREE.CylinderGeometry(0.038, 0.038, 0.012, 8)),
            this.waterMat
          );
          water.position.set(0, 0.06, 0);
          const u1 = new THREE.Mesh(lampPoleGeo, this.upgradeTimberMat);
          u1.position.set(-0.042, 0.075, 0);
          const u2 = new THREE.Mesh(lampPoleGeo, this.upgradeTimberMat);
          u2.position.set(0.042, 0.075, 0);
          const roof = new THREE.Mesh(
            this.getSharedUpgradeGeo('mod-well-roof', () => new THREE.ConeGeometry(0.068, 0.058, 6)),
            this.upgradeRoofMat
          );
          roof.position.set(0, 0.132, 0);
          sub.add(curb, water, u1, u2, roof);
          break;
        }
        case 'street_lighting': {
          const ped = new THREE.Mesh(
            this.getSharedUpgradeGeo('mod-lamp-ped', () => new THREE.CylinderGeometry(0.028, 0.036, 0.03, 6)),
            this.upgradeStoneMat
          );
          ped.position.set(0, 0.012, 0);
          const tall = new THREE.Mesh(
            this.getSharedUpgradeGeo('mod-lamp-tall', () => new THREE.CylinderGeometry(0.011, 0.016, 0.155, 6)),
            this.upgradeDarkMetalMat
          );
          tall.position.set(0, 0.095, 0);
          const arm = new THREE.Mesh(
            this.getSharedUpgradeGeo('mod-crossarm', () => new THREE.BoxGeometry(0.082, 0.012, 0.014)),
            this.upgradeDarkMetalMat
          );
          arm.position.set(0, 0.165, 0);
          const gL = new THREE.Mesh(orbSmGeo, this.nightLanternGlowMat);
          gL.position.set(-0.036, 0.184, 0);
          const gR = new THREE.Mesh(orbSmGeo, this.nightLanternGlowMat);
          gR.position.set(0.036, 0.184, 0);
          const finial = new THREE.Mesh(finialSmGeo, this.upgradeGoldMat);
          finial.position.set(0, 0.19, 0);
          sub.add(ped, tall, arm, gL, gR, finial);
          break;
        }
        case 'garden_plaza': {
          const pad = new THREE.Mesh(plazaPadGeo, this.upgradeStoneMat);
          pad.position.set(0, 0.008, 0);
          sub.add(pad);
          const hedgeGeo = this.getSharedUpgradeGeo(
            'mod-hedge',
            () => new THREE.BoxGeometry(0.028, 0.028, 0.028)
          );
          const hedgeOffsets: Array<[number, number]> = [
            [-0.042, -0.042],
            [0.042, -0.042],
            [-0.042, 0.042],
            [0.042, 0.042],
          ];
          for (const [hx, hz] of hedgeOffsets) {
            const hedge = new THREE.Mesh(hedgeGeo, this.upgradeFoliageMat);
            hedge.position.set(hx, 0.032, hz);
            sub.add(hedge);
          }
          const obelisk = new THREE.Mesh(
            this.getSharedUpgradeGeo('mod-obelisk', () => new THREE.ConeGeometry(0.024, 0.105, 4)),
            this.upgradeGoldMat
          );
          obelisk.position.set(0, 0.07, 0);
          sub.add(obelisk);
          break;
        }
        case 'royal_archive': {
          const body = new THREE.Mesh(
            this.getSharedUpgradeGeo('mod-arch-body', () => new THREE.BoxGeometry(0.115, 0.095, 0.105)),
            this.upgradeStoneMat
          );
          body.position.set(0, 0.044, 0);
          const roof = new THREE.Mesh(shopRoofGeo, this.upgradeRoofMat);
          roof.position.set(0, 0.122, 0);
          roof.rotation.y = Math.PI / 4;
          const crest = new THREE.Mesh(finialSmGeo, this.upgradeGoldMat);
          crest.position.set(0, 0.165, 0);
          const windowPane = new THREE.Mesh(winSmGeo, this.nightLanternGlowMat);
          windowPane.position.set(0, 0.052, 0.052);
          sub.add(body, roof, crest, windowPane);
          break;
        }
        case 'library_wing': {
          const body = new THREE.Mesh(
            this.getSharedUpgradeGeo('mod-lib-body', () => new THREE.BoxGeometry(0.125, 0.095, 0.095)),
            this.upgradeStoneMat
          );
          body.position.set(0, 0.044, 0);
          const roof = new THREE.Mesh(
            this.getSharedUpgradeGeo('mod-lib-roof', () => new THREE.ConeGeometry(0.094, 0.072, 4)),
            this.upgradeRoofMat
          );
          roof.position.set(0, 0.125, 0);
          roof.rotation.y = Math.PI / 4;
          const windowPane = new THREE.Mesh(
            this.getSharedUpgradeGeo('mod-win-tall', () => new THREE.BoxGeometry(0.032, 0.056, 0.018)),
            this.nightLanternGlowMat
          );
          windowPane.position.set(0, 0.055, 0.046);
          sub.add(body, roof, windowPane);
          break;
        }
        case 'scriptorium': {
          const body = new THREE.Mesh(shopBodyGeo, this.upgradeCanvasMat);
          body.position.set(0, 0.038, -0.005);
          const roof = new THREE.Mesh(shopRoofGeo, this.upgradeRoofMat);
          roof.position.set(0, 0.112, -0.005);
          roof.rotation.y = Math.PI / 4;
          const skylight = new THREE.Mesh(orbSmGeo, this.nightLanternGlowMat);
          skylight.position.set(0, 0.128, 0.018);
          const lectern = new THREE.Mesh(
            this.getSharedUpgradeGeo('mod-lectern', () => new THREE.CylinderGeometry(0.016, 0.022, 0.048, 6)),
            this.upgradeGoldMat
          );
          lectern.position.set(0.054, 0.02, 0.042);
          sub.add(body, roof, skylight, lectern);
          break;
        }
        case 'observatory': {
          const tower = new THREE.Mesh(
            this.getSharedUpgradeGeo('mod-obs-tower', () => new THREE.CylinderGeometry(0.056, 0.064, 0.145, 8)),
            this.upgradeStoneMat
          );
          tower.position.set(0, 0.068, 0);
          const dome = new THREE.Mesh(
            this.getSharedUpgradeGeo(
              'mod-exch-dome',
              () => new THREE.SphereGeometry(0.052, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.55)
            ),
            this.upgradeGoldMat
          );
          dome.position.set(0, 0.138, 0);
          const telescope = new THREE.Mesh(
            this.getSharedUpgradeGeo('mod-tele-tube', () => new THREE.CylinderGeometry(0.014, 0.018, 0.095, 6)),
            this.upgradeDarkMetalMat
          );
          telescope.position.set(0.035, 0.168, 0.035);
          telescope.rotation.z = -0.75;
          telescope.rotation.y = -Math.PI / 4;
          sub.add(tower, dome, telescope);
          break;
        }
        case 'armory': {
          const bunker = new THREE.Mesh(
            this.getSharedUpgradeGeo('mod-arm-body', () => new THREE.BoxGeometry(0.12, 0.088, 0.105)),
            this.upgradeStoneMat
          );
          bunker.position.set(0, 0.04, 0);
          const parapet = new THREE.Mesh(
            this.getSharedUpgradeGeo('mod-arm-parapet', () => new THREE.BoxGeometry(0.128, 0.022, 0.112)),
            this.upgradeDarkMetalMat
          );
          parapet.position.set(0, 0.094, 0);
          const rack = new THREE.Mesh(crateSmGeo, this.upgradeGoldMat);
          rack.position.set(0, 0.046, 0.054);
          sub.add(bunker, parapet, rack);
          break;
        }
        case 'watch_beacon': {
          const base = new THREE.Mesh(lhBaseGeo, this.upgradeStoneMat);
          base.position.set(0, 0.02, 0);
          const shaft = new THREE.Mesh(
            this.getSharedUpgradeGeo('mod-beacon-shaft', () => new THREE.CylinderGeometry(0.036, 0.048, 0.145, 4)),
            this.upgradeTimberMat
          );
          shaft.position.set(0, 0.115, 0);
          const brazier = new THREE.Mesh(lhGalleryGeo, this.upgradeDarkMetalMat);
          brazier.position.set(0, 0.195, 0);
          const flame = new THREE.Mesh(emberOrbGeo, this.upgradeEmberMat);
          flame.position.set(0, 0.228, 0);
          const crownGlow = new THREE.Mesh(orbSmGeo, this.nightLanternGlowMat);
          crownGlow.position.set(0, 0.242, 0);
          sub.add(base, shaft, brazier, flame, crownGlow);
          break;
        }
        case 'training_yard': {
          const pad = new THREE.Mesh(plazaPadGeo, this.upgradeStoneMat);
          pad.position.set(0, 0.008, 0);
          const rack = new THREE.Mesh(
            this.getSharedUpgradeGeo('mod-yard-rack', () => new THREE.BoxGeometry(0.11, 0.052, 0.018)),
            this.upgradeTimberMat
          );
          rack.position.set(0, 0.038, -0.045);
          const targetGeo = this.getSharedUpgradeGeo(
            'mod-target',
            () => new THREE.CylinderGeometry(0.024, 0.024, 0.016, 8)
          );
          const t1 = new THREE.Mesh(targetGeo, this.upgradeCanvasMat);
          t1.position.set(-0.036, 0.042, 0.025);
          t1.rotation.x = Math.PI / 2;
          const t2 = new THREE.Mesh(targetGeo, this.upgradeRoofMat);
          t2.position.set(0.036, 0.042, 0.025);
          t2.rotation.x = Math.PI / 2;
          const spear = new THREE.Mesh(lampPoleGeo, this.upgradeDarkMetalMat);
          spear.position.set(0.056, 0.055, -0.045);
          sub.add(pad, rack, t1, t2, spear);
          break;
        }
        default: {
          const _exhaustive: never = kind;
          void _exhaustive;
          break;
        }
      }

      if (sub.children.length > 0) {
        group.add(sub);
      }
    }
  }

  public setAtmosphereState(params: {
    phase: DayPhaseId;
    season: SeasonId;
    seasonProgress: number;
    weather: ClimateWeatherId;
    worldSeed?: number;
    snap?: boolean;
  }) {
    const { phase, season, seasonProgress, weather, worldSeed, snap = false } = params;
    this.currentAtmosTarget = computeAtmosphereTarget({ phase, season, weather });

    const seed = worldSeed ?? this.currentWorldSeed;
    const progressBucket = Math.round(seasonProgress * 12);
    const terrainSig = `${season}:${progressBucket}:${weather}:${seed}`;
    const terrainChanged = terrainSig !== this.lastTerrainSeasonSig;

    this.currentSeason = season;
    this.currentSeasonProgress = seasonProgress;
    this.currentWeather = weather;
    this.currentWorldSeed = seed;

    if (terrainChanged) {
      this.lastTerrainSeasonSig = terrainSig;
      this.applySeasonalTerrainColors();
    }

    if (snap) {
      this.applyAtmosphereImmediate(this.currentAtmosTarget);
      this.atmosDirty = false;
      this.wakeRenderLoop();
    } else {
      this.atmosDirty = true;
      this.wakeRenderLoop();
    }
  }

  private applyAtmosphereImmediate(t: AtmosphereTarget) {
    this.curSunAzimuth = t.sunAzimuthRad;
    this.curSunElevation = t.sunElevationRad;
    this.curSunColor.setHex(t.sunColorHex);
    this.curSunIntensity = t.sunIntensity;
    this.curHemiSky.setHex(t.hemiSkyHex);
    this.curHemiGround.setHex(t.hemiGroundHex);
    this.curHemiIntensity = t.hemiIntensity;
    this.curRimColor.setHex(t.rimColorHex);
    this.curRimIntensity = t.rimIntensity;
    this.curSkyColor.setHex(t.skyHex);
    this.curFogColor.setHex(t.fogHex);
    this.curFogNear = t.fogNear;
    this.curFogFar = t.fogFar;
    this.curWaterTint.setHex(t.waterTintHex);
    this.curExposure = t.exposure;
    this.curEnvIntensity = t.environmentIntensity;
    this.curNightGlow = Math.max(t.cityNightGlow, t.roadLampGlow);
    this.curStarOpacity = t.starVisibility;
    this.commitAtmosphereToScene();
  }

  private commitAtmosphereToScene() {
    this.sunLight.color.copy(this.curSunColor);
    this.sunLight.intensity = this.curSunIntensity;
    this.hemiLight.color.copy(this.curHemiSky);
    this.hemiLight.groundColor.copy(this.curHemiGround);
    this.hemiLight.intensity = this.curHemiIntensity;
    this.rimLight.color.copy(this.curRimColor);
    this.rimLight.intensity = this.curRimIntensity;

    if (this.scene.background instanceof THREE.Color) {
      this.scene.background.copy(this.curSkyColor);
    }
    this.sceneFog.color.copy(this.curFogColor);
    this.sceneFog.near = this.curFogNear;
    this.sceneFog.far = this.curFogFar;
    this.waterMat.color.copy(this.curWaterTint);
    this.renderer.toneMappingExposure = this.curExposure;
    this.scene.environmentIntensity = this.curEnvIntensity;

    this.nightLanternGlowMat.emissiveIntensity = 0.08 + this.curNightGlow * 2.6;
    this.starsMat.opacity = this.curStarOpacity;
    this.starsPoints.visible = this.curStarOpacity > 0.02;
    this.updateSunDirection();
  }

  private updateSunDirection() {
    const focusX = this.gameState === 'title' ? this.getHomeWorldPos().x : this.camTarget.x;
    const focusZ = this.gameState === 'title' ? this.getHomeWorldPos().z : this.camTarget.z;
    const dist = 30;
    const horiz = Math.cos(this.curSunElevation) * dist;
    const sy = Math.max(6, Math.sin(this.curSunElevation) * dist);
    this.sunLight.position.set(
      focusX + Math.cos(this.curSunAzimuth) * horiz,
      sy,
      focusZ + Math.sin(this.curSunAzimuth) * horiz
    );
    this.sunLight.target.position.set(focusX, 0, focusZ);
    this.starsPoints.position.set(focusX, 0, focusZ);
  }

  private updateAtmosphereStep(dt: number) {
    if (!this.atmosDirty) return;
    const t = this.currentAtmosTarget;
    const lambda = 5.4;
    const alpha = 1 - Math.exp(-lambda * dt);

    this.curSunAzimuth = THREE.MathUtils.damp(this.curSunAzimuth, t.sunAzimuthRad, lambda, dt);
    this.curSunElevation = THREE.MathUtils.damp(this.curSunElevation, t.sunElevationRad, lambda, dt);
    this.curSunIntensity = THREE.MathUtils.damp(this.curSunIntensity, t.sunIntensity, lambda, dt);
    this.curHemiIntensity = THREE.MathUtils.damp(this.curHemiIntensity, t.hemiIntensity, lambda, dt);
    this.curRimIntensity = THREE.MathUtils.damp(this.curRimIntensity, t.rimIntensity, lambda, dt);
    this.curFogNear = THREE.MathUtils.damp(this.curFogNear, t.fogNear, lambda, dt);
    this.curFogFar = THREE.MathUtils.damp(this.curFogFar, t.fogFar, lambda, dt);
    this.curExposure = THREE.MathUtils.damp(this.curExposure, t.exposure, lambda, dt);
    this.curEnvIntensity = THREE.MathUtils.damp(
      this.curEnvIntensity,
      t.environmentIntensity,
      lambda,
      dt
    );
    const targetGlow = Math.max(t.cityNightGlow, t.roadLampGlow);
    this.curNightGlow = THREE.MathUtils.damp(this.curNightGlow, targetGlow, lambda, dt);
    this.curStarOpacity = THREE.MathUtils.damp(this.curStarOpacity, t.starVisibility, lambda, dt);

    this.curSunColor.lerp(_targetColorTmp.setHex(t.sunColorHex), alpha);
    this.curHemiSky.lerp(_targetColorTmp.setHex(t.hemiSkyHex), alpha);
    this.curHemiGround.lerp(_targetColorTmp.setHex(t.hemiGroundHex), alpha);
    this.curRimColor.lerp(_targetColorTmp.setHex(t.rimColorHex), alpha);
    this.curSkyColor.lerp(_targetColorTmp.setHex(t.skyHex), alpha);
    this.curFogColor.lerp(_targetColorTmp.setHex(t.fogHex), alpha);
    this.curWaterTint.lerp(_targetColorTmp.setHex(t.waterTintHex), alpha);

    this.commitAtmosphereToScene();

    if (
      Math.abs(this.curSunIntensity - t.sunIntensity) < 0.005 &&
      Math.abs(this.curEnvIntensity - t.environmentIntensity) < 0.004 &&
      Math.abs(this.curExposure - t.exposure) < 0.004 &&
      Math.abs(this.curNightGlow - targetGlow) < 0.005 &&
      Math.abs(this.curStarOpacity - t.starVisibility) < 0.005 &&
      Math.abs(this.curSunElevation - t.sunElevationRad) < 0.005
    ) {
      this.applyAtmosphereImmediate(t);
      this.atmosDirty = false;
    }
  }

  private getSeasonalTerrainMaterial(
    assetName: string,
    subIdx: number,
    baseMat: THREE.Material | THREE.Material[]
  ): THREE.Material | THREE.Material[] {
    const cacheKey = `${assetName}:${subIdx}`;
    let cached = this.seasonalTerrainMats.get(cacheKey);
    if (!cached) {
      cached = createSeasonalTerrainMaterialVariant(baseMat, assetName === 'grass-forest');
      this.seasonalTerrainMats.set(cacheKey, cached);
    }
    return cached;
  }

  private getTileSeasonalProfile(
    tile: PlacedHex,
    owner: HexOwner,
    assetName: string
  ) {
    const ownerTintHex =
      owner === 'player'
        ? 0xffffff
        : owner === 'iron_clan'
          ? 0xf2b5b5
          : owner === 'azure_league'
            ? 0xb5d0f2
            : 0x8fa7be;
    return computeHexSeasonalVisualProfile({
      q: tile.q,
      r: tile.r,
      tile,
      assetName,
      ownerTintHex,
      season: this.currentSeason,
      seasonProgress: this.currentSeasonProgress,
      weather: this.currentWeather,
      worldCols: this.currentWorldState.worldCols,
      worldRows: this.currentWorldState.worldRows,
      worldSeed: this.currentWorldSeed,
    });
  }

  private applySeasonalTerrainColors() {
    for (const bucket of this.terrainInstanceEntries) {
      const { im, assetName, entries } = bucket;
      const seasonAttr = im.geometry.getAttribute('aSeasonData') as
        | THREE.InstancedBufferAttribute
        | undefined;
      for (let i = 0; i < entries.length; i++) {
        const { tile, owner } = entries[i];
        const profile = this.getTileSeasonalProfile(tile, owner, assetName);
        im.setColorAt(i, _colorTmp.setHex(profile.instanceTintHex));
        if (seasonAttr) {
          seasonAttr.setXYZW(
            i,
            profile.foliageShift,
            profile.snowAmount,
            profile.wetnessOrIce,
            profile.isDeciduous ? 1.0 : 0.0
          );
        }
      }
      if (im.instanceColor) {
        im.instanceColor.needsUpdate = true;
      }
      if (seasonAttr) {
        seasonAttr.needsUpdate = true;
      }
    }
    this.rebuildSeasonalDetailLayers();
    this.wakeRenderLoop();
  }

  private rebuildSeasonalDetailLayers() {
    const baseCropState = computeFarmCropVisualState({
      season: this.currentSeason,
      seasonProgress: this.currentSeasonProgress,
      farmLevel: 1,
      weather: this.currentWeather,
    });
    this.fertileOverlayMat.color.setHex(baseCropState.furrowColorHex);

    const tileKeysSig = Object.keys(this.currentWorldState.hexes).length;
    const progressBucket = Math.round(this.currentSeasonProgress * 12);
    const farmSig = Object.values(this.currentWorldState.hexes)
      .filter((t) => HEX_ASSETS[t.structureIndex]?.name === 'building-farm')
      .map((t) => `${t.q},${t.r}:${t.level ?? 1}:${this.lastUnderConstructionKeys.has(hexKey(t.q, t.r)) ? 'u' : 'c'}`)
      .join('|');
    const detailSig = `${this.currentSeason}:${progressBucket}:${this.currentWeather}:${tileKeysSig}:${farmSig}`;
    if (detailSig === this.lastSeasonalDetailsSig) return;
    this.lastSeasonalDetailsSig = detailSig;

    const flowerTransforms: Array<{ x: number; z: number; scale: number; rot: number; color: number }> = [];
    const cropRows: Array<{
      x: number;
      z: number;
      rotY: number;
      stalkScale: number;
      headScale: number;
      stalkColor: number;
      headColor: number;
    }> = [];
    const iceHexes: Array<{ x: number; z: number; scale: number }> = [];

    const FLOWER_PALETTE = [0xfef08a, 0xf9a8d4, 0xffffff, 0xbae6fd];
    const FLOWER_OFFSETS: Array<[number, number]> = [
      [-0.22 * HEX_WORLD_SCALE, -0.14 * HEX_WORLD_SCALE],
      [0.19 * HEX_WORLD_SCALE, -0.18 * HEX_WORLD_SCALE],
      [0.06 * HEX_WORLD_SCALE, 0.21 * HEX_WORLD_SCALE],
    ];
    const FARM_ROW_OFFSETS = [
      -0.16 * HEX_WORLD_SCALE,
      0.0,
      0.16 * HEX_WORLD_SCALE,
    ];

    for (const tile of Object.values(this.currentWorldState.hexes)) {
      const key = hexKey(tile.q, tile.r);
      const assetName = HEX_ASSETS[tile.structureIndex]?.name ?? '';
      const center = axialToWorld(tile.q, tile.r);

      if (assetName === 'building-farm' && !this.lastUnderConstructionKeys.has(key)) {
        const crop = computeFarmCropVisualState({
          season: this.currentSeason,
          seasonProgress: this.currentSeasonProgress,
          farmLevel: getBuildingLevel(tile),
          weather: this.currentWeather,
        });
        const rotRad = THREE.MathUtils.degToRad(tile.orientation);
        const cosR = Math.cos(rotRad);
        const sinR = Math.sin(rotRad);
        for (const dz of FARM_ROW_OFFSETS) {
          const ox = 0.08 * HEX_WORLD_SCALE;
          const rx = center.x + ox * cosR + dz * sinR;
          const rz = center.z - ox * sinR + dz * cosR;
          cropRows.push({
            x: rx,
            z: rz,
            rotY: rotRad,
            stalkScale: crop.stalkHeightScale,
            headScale: crop.headScale,
            stalkColor: crop.stalkColorHex,
            headColor: crop.headColorHex,
          });
        }
        continue;
      }

      if (hasHexConstruction(tile, HEX_ASSETS)) continue;

      const profile = this.getTileSeasonalProfile(tile, tile.owner ?? 'neutral', assetName);
      if (profile.flowerDensity > 0.14) {
        const countForTile = profile.flowerDensity > 0.65 ? 3 : 2;
        for (let fi = 0; fi < countForTile; fi++) {
          const [ox, oz] = FLOWER_OFFSETS[fi];
          const color =
            FLOWER_PALETTE[Math.abs(tile.q * 7 + tile.r * 13 + fi) % FLOWER_PALETTE.length];
          flowerTransforms.push({
            x: center.x + ox,
            z: center.z + oz,
            scale: 0.75 + profile.flowerDensity * 0.45,
            rot: ((tile.q + tile.r + fi) * 0.7) % Math.PI,
            color,
          });
        }
      }

      if (profile.iceAmount > 0.16) {
        iceHexes.push({
          x: center.x,
          z: center.z,
          scale: 0.65 + profile.iceAmount * 0.35,
        });
      }
    }

    // Helper to ensure capacity without shrinking needlessly or leaking GPU buffers
    const ensureInstancedCapacity = (
      current: THREE.InstancedMesh,
      needed: number,
      assignMesh: (next: THREE.InstancedMesh) => void
    ): THREE.InstancedMesh => {
      if (needed <= current.instanceMatrix.count) return current;
      const next = new THREE.InstancedMesh(
        current.geometry,
        current.material,
        Math.max(16, Math.ceil(needed * 1.25))
      );
      next.frustumCulled = false;
      this.scene.remove(current);
      current.dispose();
      this.scene.add(next);
      assignMesh(next);
      return next;
    };

    // 1. Spring blossoms
    if (flowerTransforms.length > 0) {
      const fm = ensureInstancedCapacity(
        this.springFlowersMesh,
        flowerTransforms.length,
        (next) => {
          this.springFlowersMesh = next;
        }
      );
      for (let i = 0; i < flowerTransforms.length; i++) {
        const f = flowerTransforms[i];
        _dummy.position.set(f.x, TILE_SURFACE_Y + 0.014 * HEX_WORLD_SCALE, f.z);
        _dummy.rotation.set(0, f.rot, 0);
        _dummy.scale.set(f.scale, f.scale * 0.58, f.scale);
        _dummy.updateMatrix();
        fm.setMatrixAt(i, _dummy.matrix);
        fm.setColorAt(i, _colorTmp.setHex(f.color));
      }
      fm.count = flowerTransforms.length;
      fm.instanceMatrix.needsUpdate = true;
      if (fm.instanceColor) fm.instanceColor.needsUpdate = true;
    } else {
      this.springFlowersMesh.count = 0;
    }

    // 2. 4-Season Farm Crops (stalks + heads)
    if (cropRows.length > 0) {
      const sm = ensureInstancedCapacity(
        this.farmCropStalksMesh,
        cropRows.length,
        (next) => {
          this.farmCropStalksMesh = next;
        }
      );
      const hm = ensureInstancedCapacity(
        this.farmCropHeadsMesh,
        cropRows.length,
        (next) => {
          this.farmCropHeadsMesh = next;
        }
      );
      for (let i = 0; i < cropRows.length; i++) {
        const c = cropRows[i];
        const stalkH = 0.095 * HEX_WORLD_SCALE * c.stalkScale;
        _dummy.position.set(c.x, TILE_SURFACE_Y + 0.02 * HEX_WORLD_SCALE + stalkH * 0.5, c.z);
        _dummy.rotation.set(0, c.rotY, 0);
        _dummy.scale.set(1, c.stalkScale, 1);
        _dummy.updateMatrix();
        sm.setMatrixAt(i, _dummy.matrix);
        sm.setColorAt(i, _colorTmp.setHex(c.stalkColor));

        _dummy.position.set(
          c.x,
          TILE_SURFACE_Y + 0.02 * HEX_WORLD_SCALE + stalkH + 0.015 * HEX_WORLD_SCALE,
          c.z
        );
        _dummy.scale.set(1, c.headScale, c.headScale > 0.5 ? 1.1 : 0.85);
        _dummy.updateMatrix();
        hm.setMatrixAt(i, _dummy.matrix);
        hm.setColorAt(i, _colorTmp.setHex(c.headColor));
      }
      sm.count = cropRows.length;
      hm.count = cropRows.length;
      sm.instanceMatrix.needsUpdate = true;
      hm.instanceMatrix.needsUpdate = true;
      if (sm.instanceColor) sm.instanceColor.needsUpdate = true;
      if (hm.instanceColor) hm.instanceColor.needsUpdate = true;
    } else {
      this.farmCropStalksMesh.count = 0;
      this.farmCropHeadsMesh.count = 0;
    }

    // 3. Northern winter sea ice plates
    if (iceHexes.length > 0) {
      const im = ensureInstancedCapacity(
        this.winterIceMesh,
        iceHexes.length,
        (next) => {
          this.winterIceMesh = next;
        }
      );
      for (let i = 0; i < iceHexes.length; i++) {
        const ice = iceHexes[i];
        _dummy.position.set(ice.x, TILE_SURFACE_Y * 0.64, ice.z);
        _dummy.rotation.set(0, 0, 0);
        _dummy.scale.set(ice.scale, 1, ice.scale);
        _dummy.updateMatrix();
        im.setMatrixAt(i, _dummy.matrix);
      }
      im.count = iceHexes.length;
      im.instanceMatrix.needsUpdate = true;
    } else {
      this.winterIceMesh.count = 0;
    }
  }

  public syncSelectedCityRegion(params: {
    regionKeys: string[];
    districtKeys: string[];
  }) {
    const regArr = [...params.regionKeys].sort();
    const distArr = [...params.districtKeys].sort();
    const sig = `${regArr.join(',')}|${distArr.join(',')}`;
    if (sig === this.lastSelectedRegionSig) return;
    this.lastSelectedRegionSig = sig;

    const oldRegGeo = this.selectedRegionOverlayMesh.geometry;
    const oldDistGeo = this.selectedDistrictOverlayMesh.geometry;

    if (regArr.length === 0) {
      this.selectedRegionOverlayMesh.geometry = new THREE.BufferGeometry();
      this.selectedDistrictOverlayMesh.geometry = new THREE.BufferGeometry();
    } else {
      // Render inset outer boundary of the selected city's regional domain + inner district borders
      const regionSet = new Set(regArr);
      const regPositions: number[] = [];
      const outerR = HEX_OUTER_RADIUS * 0.86;
      const innerR = HEX_OUTER_RADIUS * 0.74;
      for (const k of regArr) {
        const tile = this.currentWorldState.hexes[k];
        if (!tile) continue;
        const center = axialToWorld(tile.q, tile.r);
        for (let edge = 0; edge < 6; edge++) {
          const dir = AXIAL_DIRECTIONS[edge];
          const nKey = hexKey(tile.q + dir.q, tile.r + dir.r);
          if (!regionSet.has(nKey)) {
            appendHexEdgeQuad(
              regPositions,
              center.x,
              center.z,
              TILE_SURFACE_Y + 0.036,
              edge,
              outerR,
              innerR
            );
          }
        }
      }
      const nextRegGeo = new THREE.BufferGeometry();
      nextRegGeo.setAttribute('position', new THREE.Float32BufferAttribute(regPositions, 3));
      this.selectedRegionOverlayMesh.geometry = nextRegGeo;

      this.selectedDistrictOverlayMesh.geometry = buildCoordRingOverlayGeometry(
        this.currentWorldState,
        distArr,
        HEX_OUTER_RADIUS * 0.72,
        HEX_OUTER_RADIUS * 0.62,
        0.038,
        0.05
      );
    }

    oldRegGeo.dispose();
    oldDistGeo.dispose();
    this.wakeRenderLoop();
  }

  public syncSelectedAdjacency(params: {
    positiveKeys: string[];
    penaltyKeys: string[];
  }) {
    const posArr = [...params.positiveKeys].sort();
    const penArr = [...params.penaltyKeys].sort();
    const sig = `${posArr.join(',')}|${penArr.join(',')}`;
    if (sig === this.lastSelectedAdjacencySig) return;
    this.lastSelectedAdjacencySig = sig;

    const oldPosGeo = this.positiveAdjacencyOverlayMesh.geometry;
    const oldPenGeo = this.penaltyAdjacencyOverlayMesh.geometry;

    this.positiveAdjacencyOverlayMesh.geometry =
      posArr.length > 0
        ? buildCoordRingOverlayGeometry(
            this.currentWorldState,
            posArr,
            HEX_OUTER_RADIUS * 0.8,
            HEX_OUTER_RADIUS * 0.69,
            0.042,
            0.05
          )
        : new THREE.BufferGeometry();

    this.penaltyAdjacencyOverlayMesh.geometry =
      penArr.length > 0
        ? buildCoordRingOverlayGeometry(
            this.currentWorldState,
            penArr,
            HEX_OUTER_RADIUS * 0.84,
            HEX_OUTER_RADIUS * 0.72,
            0.044,
            0.05
          )
        : new THREE.BufferGeometry();

    oldPosGeo.dispose();
    oldPenGeo.dispose();
    this.wakeRenderLoop();
  }
  public syncRoadsAndCities(params: {
    roads: RoadMap;
    cities: CityEntity[];
    connectivity?: RoadConnectivitySummary;
    worldState: HexWorldState;
    underConstructionKeys?: Set<string>;
  }) {
    const { roads, cities, connectivity, worldState, underConstructionKeys } = params;

    const roadSig = Object.values(roads)
      .map((r) => `${r.q},${r.r}:${r.level}:${r.owner}`)
      .sort()
      .join('|');
    const citySig = cities
      .map((c) => `${c.id}:${c.level}:${c.connectedCityIds.length}`)
      .sort()
      .join('|');
    const bridgeSig = Object.values(worldState.hexes)
      .filter((t) => HEX_ASSETS[t.structureIndex]?.name === 'bridge')
      .map((t) => `${t.q},${t.r}:${underConstructionKeys?.has(hexKey(t.q, t.r)) ? 'u' : 'c'}`)
      .sort()
      .join('|');
    const sig = `${roadSig}#${citySig}#${bridgeSig}`;
    if (sig === this.lastRoadCitySignature) return;
    this.lastRoadCitySignature = sig;

    const cityByKey = new Map<string, CityEntity>();
    for (const c of cities) {
      cityByKey.set(hexKey(c.center.q, c.center.r), c);
    }

    // Collect road-capable nodes (roads + completed bridges + cities)
    const roadNodes = new Map<
      string,
      { q: number; r: number; level: RoadLevel; isExplicitRoad: boolean; isBridge: boolean }
    >();
    for (const [key, rTile] of Object.entries(roads)) {
      const worldTile = worldState.hexes[key];
      if (!worldTile || worldTile.owner !== rTile.owner) continue;
      roadNodes.set(key, {
        q: rTile.q,
        r: rTile.r,
        level: rTile.level,
        isExplicitRoad: true,
        isBridge: false,
      });
    }
    for (const tile of Object.values(worldState.hexes)) {
      if (tile.owner !== 'player') continue;
      const k = hexKey(tile.q, tile.r);
      const assetName = HEX_ASSETS[tile.structureIndex]?.name ?? '';
      const isCompletedBridge =
        assetName === 'bridge' && !underConstructionKeys?.has(k);
      if (isCompletedBridge && !roadNodes.has(k)) {
        roadNodes.set(k, {
          q: tile.q,
          r: tile.r,
          level: 2,
          isExplicitRoad: false,
          isBridge: true,
        });
      }
      const cityHere = cityByKey.get(k);
      if (cityHere && !roadNodes.has(k)) {
        roadNodes.set(k, {
          q: tile.q,
          r: tile.r,
          level: Math.max(2, Math.min(5, cityHere.level)) as RoadLevel,
          isExplicitRoad: false,
          isBridge: false,
        });
      }
    }

    // Multi-city trade corridor node set
    const corridorKeys = new Set<string>();
    if (connectivity) {
      for (const net of connectivity.networks) {
        if (net.connectedCityIds.length >= 2) {
          for (const k of net.hexKeys) {
            corridorKeys.add(k);
          }
        }
      }
    }

    const roadPositions: number[] = [];
    const roadColors: number[] = [];
    const corridorPositions: number[] = [];

    const pushColorQuad = (
      x0: number,
      z0: number,
      x1: number,
      z1: number,
      x2: number,
      z2: number,
      x3: number,
      z3: number,
      y: number,
      colorHex: string
    ) => {
      _colorTmp.set(colorHex);
      roadPositions.push(
        x0, y, z0,
        x1, y, z1,
        x2, y, z2,
        x0, y, z0,
        x2, y, z2,
        x3, y, z3
      );
      for (let i = 0; i < 6; i++) {
        roadColors.push(_colorTmp.r, _colorTmp.g, _colorTmp.b);
      }
    };

    const yRoad = TILE_SURFACE_Y + 0.016;
    const yCurb = TILE_SURFACE_Y + 0.013;
    const yCorridor = TILE_SURFACE_Y + 0.019;

    for (const [k, node] of roadNodes.entries()) {
      const center = axialToWorld(node.q, node.r);
      const def = ROAD_CATALOG[node.level];
      const halfW = (0.072 + node.level * 0.018) * HEX_WORLD_SCALE;
      const curbW = halfW + 0.018 * HEX_WORLD_SCALE;

      let neighborLinks = 0;
      for (const dir of AXIAL_DIRECTIONS) {
        const nq = node.q + dir.q;
        const nr = node.r + dir.r;
        const nk = hexKey(nq, nr);
        const neighbor = roadNodes.get(nk);
        if (!neighbor) continue;
        // Connect only when at least one endpoint is an explicit road or bridge (avoid linking 2 adjacent non-road cities without road)
        if (!node.isExplicitRoad && !node.isBridge && !neighbor.isExplicitRoad && !neighbor.isBridge) {
          continue;
        }
        neighborLinks += 1;

        const nCenter = axialToWorld(nq, nr);
        const dx = nCenter.x - center.x;
        const dz = nCenter.z - center.z;
        const dist = Math.hypot(dx, dz);
        if (dist <= 0.0001) continue;
        const ux = dx / dist;
        const uz = dz / dist;
        const px = -uz;
        const pz = ux;

        const segLen = dist * 0.52;
        const ex = center.x + ux * segLen;
        const ez = center.z + uz * segLen;

        // Dark backing curb + top road ribbon
        pushColorQuad(
          center.x - px * curbW, center.z - pz * curbW,
          ex - px * curbW, ez - pz * curbW,
          ex + px * curbW, ez + pz * curbW,
          center.x + px * curbW, center.z + pz * curbW,
          yCurb,
          '#3c3426'
        );
        pushColorQuad(
          center.x - px * halfW, center.z - pz * halfW,
          ex - px * halfW, ez - pz * halfW,
          ex + px * halfW, ez + pz * halfW,
          center.x + px * halfW, center.z + pz * halfW,
          yRoad,
          def.colorHex
        );

        // Golden center thread on multi-city trade corridors
        if (corridorKeys.has(k) && corridorKeys.has(nk)) {
          const cw = Math.max(0.025 * HEX_WORLD_SCALE, halfW * 0.32);
          corridorPositions.push(
            center.x - px * cw, yCorridor, center.z - pz * cw,
            ex - px * cw, yCorridor, ez - pz * cw,
            ex + px * cw, yCorridor, ez + pz * cw,
            center.x - px * cw, yCorridor, center.z - pz * cw,
            ex + px * cw, yCorridor, ez + pz * cw,
            center.x + px * cw, yCorridor, center.z + pz * cw
          );
        }
      }

      // Draw central hub medallion for explicit roads so isolated or branching roads are clearly visible
      if (node.isExplicitRoad) {
        const hubR = halfW * (neighborLinks > 0 ? 1.25 : 1.8);
        const hubCurbR = hubR + 0.018 * HEX_WORLD_SCALE;
        pushColorQuad(
          center.x - hubCurbR, center.z - hubCurbR,
          center.x + hubCurbR, center.z - hubCurbR,
          center.x + hubCurbR, center.z + hubCurbR,
          center.x - hubCurbR, center.z + hubCurbR,
          yCurb,
          '#3c3426'
        );
        pushColorQuad(
          center.x - hubR, center.z - hubR,
          center.x + hubR, center.z - hubR,
          center.x + hubR, center.z + hubR,
          center.x - hubR, center.z + hubR,
          yRoad,
          def.colorHex
        );
      }
    }

    const oldRoadsGeo = this.roadsMesh.geometry;
    const nextRoadsGeo = new THREE.BufferGeometry();
    nextRoadsGeo.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(roadPositions, 3)
    );
    nextRoadsGeo.setAttribute(
      'color',
      new THREE.Float32BufferAttribute(roadColors, 3)
    );
    nextRoadsGeo.computeVertexNormals();
    this.roadsMesh.geometry = nextRoadsGeo;
    oldRoadsGeo.dispose();

    const oldCorridorGeo = this.tradeCorridorsMesh.geometry;
    const nextCorridorGeo = new THREE.BufferGeometry();
    nextCorridorGeo.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(corridorPositions, 3)
    );
    this.tradeCorridorsMesh.geometry = nextCorridorGeo;
    oldCorridorGeo.dispose();

    // Rebuild instanced road streetlamps (1 draw call for all road lanterns across the map)
    const roadLampCoords: Array<{ x: number; z: number }> = [];
    for (const node of roadNodes.values()) {
      if (!node.isExplicitRoad && !node.isBridge) continue;
      if (node.level >= 2 || (node.q + node.r) % 2 === 0) {
        const c = axialToWorld(node.q, node.r);
        roadLampCoords.push({
          x: c.x + 0.14 * HEX_WORLD_SCALE,
          z: c.z - 0.14 * HEX_WORLD_SCALE,
        });
      }
    }
    if (roadLampCoords.length > 0) {
      if (this.roadLanternsMesh.instanceMatrix.count < roadLampCoords.length) {
        const oldGeo = this.roadLanternsMesh.geometry;
        this.scene.remove(this.roadLanternsMesh);
        this.roadLanternsMesh.dispose();
        this.roadLanternsMesh = new THREE.InstancedMesh(
          oldGeo,
          this.nightLanternGlowMat,
          Math.max(16, roadLampCoords.length)
        );
        this.roadLanternsMesh.frustumCulled = false;
        this.scene.add(this.roadLanternsMesh);
      }
      for (let i = 0; i < roadLampCoords.length; i++) {
        _dummy.position.set(
          roadLampCoords[i].x,
          TILE_SURFACE_Y + 0.08 * HEX_WORLD_SCALE,
          roadLampCoords[i].z
        );
        _dummy.rotation.set(0, 0, 0);
        _dummy.scale.setScalar(1);
        _dummy.updateMatrix();
        this.roadLanternsMesh.setMatrixAt(i, _dummy.matrix);
      }
      this.roadLanternsMesh.count = roadLampCoords.length;
      this.roadLanternsMesh.instanceMatrix.needsUpdate = true;
    } else {
      this.roadLanternsMesh.count = 0;
    }

    // Rebuild organic city plazas + banner spires + warm night lanterns scaled by city stage (1..5)
    while (this.citiesGroup.children.length > 0) {
      const child = this.citiesGroup.children[0];
      this.citiesGroup.remove(child);
      child.traverse((obj) => {
        const m = obj as THREE.Mesh;
        if (m.geometry && !m.userData?.sharedGeo) m.geometry.dispose();
        if (m.material && !m.userData?.sharedMat) {
          if (Array.isArray(m.material)) m.material.forEach((mm) => mm.dispose());
          else m.material.dispose();
        }
      });
    }

    const cityLampPostGeo = this.getSharedUpgradeGeo(
      'city-lamp-post',
      () =>
        new THREE.CylinderGeometry(
          0.015 * HEX_WORLD_SCALE,
          0.02 * HEX_WORLD_SCALE,
          0.16 * HEX_WORLD_SCALE,
          5
        )
    );
    const cityLampOrbGeo = this.getSharedUpgradeGeo(
      'city-lamp-orb',
      () => new THREE.SphereGeometry(0.036 * HEX_WORLD_SCALE, 6, 5)
    );

    for (const city of cities) {
      const pos = axialToWorld(city.center.q, city.center.r);
      const group = new THREE.Group();
      group.position.set(pos.x, 0, pos.z);

      const outerR = HEX_OUTER_RADIUS * (0.56 + city.level * 0.042);
      const innerR = outerR - HEX_OUTER_RADIUS * 0.11;
      const ringColor =
        city.level >= 5
          ? 0xf59e0b
          : city.level >= 4
            ? 0xfbbf24
            : city.level >= 3
              ? 0xe2e8f0
              : 0xd6c7ad;

      const plazaRing = new THREE.Mesh(
        createHexRingGeometry(outerR, innerR),
        new THREE.MeshBasicMaterial({
          color: ringColor,
          transparent: true,
          opacity: 0.9,
          side: THREE.DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1,
        })
      );
      plazaRing.position.y = TILE_SURFACE_Y + 0.014;
      group.add(plazaRing);

      // Offset heraldic banner spire on edge corner so it frames the central building without clipping
      const poleHeight = (0.28 + city.level * 0.08) * HEX_WORLD_SCALE;
      const poleMat = new THREE.MeshStandardMaterial({
        color: 0x3c3426,
        roughness: 0.6,
        metalness: 0.2,
      });
      const bannerColor = city.connectedCityIds.length > 0 ? 0xf59e0b : 0x059669;
      const bannerMat = new THREE.MeshStandardMaterial({
        color: bannerColor,
        emissive: bannerColor,
        emissiveIntensity: 0.18,
        roughness: 0.45,
        metalness: 0.15,
        flatShading: true,
      });

      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(
          0.018 * HEX_WORLD_SCALE,
          0.024 * HEX_WORLD_SCALE,
          poleHeight,
          6
        ),
        poleMat
      );
      const bx = 0.34 * HEX_WORLD_SCALE;
      const bz = 0.24 * HEX_WORLD_SCALE;
      pole.position.set(bx, TILE_SURFACE_Y + poleHeight * 0.5, bz);
      pole.castShadow = this.quality.shadowsEnabled;

      const pennant = new THREE.Mesh(
        new THREE.ConeGeometry(0.065 * HEX_WORLD_SCALE, 0.14 * HEX_WORLD_SCALE, 4),
        bannerMat
      );
      pennant.position.set(bx, TILE_SURFACE_Y + poleHeight + 0.04 * HEX_WORLD_SCALE, bz);
      group.add(pole, pennant);

      // Warm city plaza night lanterns (shared geometry + shared nightLanternGlowMat)
      const lampOffsets: Array<[number, number]> =
        city.level >= 2
          ? [
              [-0.32 * HEX_WORLD_SCALE, -0.22 * HEX_WORLD_SCALE],
              [0.3 * HEX_WORLD_SCALE, -0.22 * HEX_WORLD_SCALE],
            ]
          : [[-0.32 * HEX_WORLD_SCALE, -0.22 * HEX_WORLD_SCALE]];
      for (const [lx, lz] of lampOffsets) {
        const lPost = new THREE.Mesh(cityLampPostGeo, this.upgradeTimberMat);
        lPost.userData.sharedGeo = true;
        lPost.userData.sharedMat = true;
        lPost.position.set(lx, TILE_SURFACE_Y + 0.08 * HEX_WORLD_SCALE, lz);
        const lOrb = new THREE.Mesh(cityLampOrbGeo, this.nightLanternGlowMat);
        lOrb.userData.sharedGeo = true;
        lOrb.userData.sharedMat = true;
        lOrb.position.set(lx, TILE_SURFACE_Y + 0.17 * HEX_WORLD_SCALE, lz);
        group.add(lPost, lOrb);
      }

      this.citiesGroup.add(group);
    }

    this.wakeRenderLoop();
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

    this.unitMoveAnims = [];
    const seenUnitIds = new Set<string>();

    for (const unit of units) {
      if (unit.hp <= 0) continue;
      seenUnitIds.add(unit.id);
      const unitGroup = new THREE.Group();
      unitGroup.scale.setScalar(HEX_WORLD_SCALE);
      const pos = axialToWorld(unit.q, unit.r);
      const hasTile = Boolean(this.currentWorldState.hexes[hexKey(unit.q, unit.r)]);
      const baseY = hasTile ? TILE_SURFACE_Y + 0.03 * HEX_WORLD_SCALE : 0.045;
      const prevPos = this.unitLastWorldPos.get(unit.id);
      const movedDist = prevPos
        ? Math.hypot(pos.x - prevPos.x, pos.z - prevPos.z)
        : 0;

      if (prevPos && movedDist > 0.05 && !this.reduceAnimations) {
        unitGroup.position.set(prevPos.x, baseY, prevPos.z);
        unitGroup.rotation.y = Math.atan2(pos.x - prevPos.x, pos.z - prevPos.z);
        this.unitMoveAnims.push({
          group: unitGroup,
          fromX: prevPos.x,
          fromZ: prevPos.z,
          toX: pos.x,
          toZ: pos.z,
          baseY,
          progress: 0,
        });
      } else {
        unitGroup.position.set(pos.x, baseY, pos.z);
      }
      this.unitLastWorldPos.set(unit.id, { x: pos.x, z: pos.z });

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

      unitGroup.userData.baseY = baseY;
      unitGroup.userData.phase = (unit.q * 1.3 + unit.r * 0.9);
      unitGroup.userData.unitType = unit.type;
      unitGroup.userData.readyBob = unit.owner === 'player' && !unit.movedThisTurn;
      unitGroup.userData.isMoving = prevPos && movedDist > 0.05 && !this.reduceAnimations;

      this.unitsGroup.add(unitGroup);
    }

    for (const id of Array.from(this.unitLastWorldPos.keys())) {
      if (!seenUnitIds.has(id)) {
        this.unitLastWorldPos.delete(id);
      }
    }
    this.wakeRenderLoop();
  }

  private spawnConquestWave(x: number, z: number, colorHex = 0xfbbf24) {
    if (this.reduceEffects) return;
    const mat = new THREE.MeshBasicMaterial({
      color: colorHex,
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
      child.geometry?.dispose();
      child.dispose();
    }
    this.terrainInstanceEntries = [];

    for (const [assetName, entries] of terrainBuckets.entries()) {
      if (entries.length === 0) continue;
      const subMeshes = this.terrainSubMeshes.get(assetName);
      if (!subMeshes || subMeshes.length === 0) continue;

      subMeshes.forEach((sub, subIdx) => {
        const instGeo = sub.geometry.clone();
        const seasonData = new Float32Array(entries.length * 4);
        const seasonAttr = new THREE.InstancedBufferAttribute(seasonData, 4);
        instGeo.setAttribute('aSeasonData', seasonAttr);

        const seasonalMat = this.getSeasonalTerrainMaterial(assetName, subIdx, sub.material);
        const im = new THREE.InstancedMesh(instGeo, seasonalMat, entries.length);
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

          const profile = this.getTileSeasonalProfile(tile, owner, assetName);
          im.setColorAt(i, _colorTmp.setHex(profile.instanceTintHex));
          seasonAttr.setXYZW(
            i,
            profile.foliageShift,
            profile.snowAmount,
            profile.wetnessOrIce,
            profile.isDeciduous ? 1.0 : 0.0
          );
        }

        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) {
          im.instanceColor.needsUpdate = true;
        }
        seasonAttr.needsUpdate = true;
        im.computeBoundingSphere();
        this.terrainInstancesGroup.add(im);
        this.terrainInstanceEntries.push({ im, assetName, entries });
      });
    }
  }

  public async syncWorldState(
    nextState: HexWorldState,
    animateNewKeys?: string[],
    conqueredKeys?: string[],
    underConstructionKeys?: Set<string>,
    attentionKeys?: string[],
    upgradingKeys?: Set<string>
  ) {
    this.currentWorldState = nextState;
    const animSet = new Set(animateNewKeys ?? []);
    const conquestSet = new Set(conqueredKeys ?? []);
    const underSet = underConstructionKeys ?? new Set<string>();
    this.lastUnderConstructionKeys = new Set(underSet);
    const upgradeSet = upgradingKeys ?? new Set<string>();
    const overlayActiveSet = new Set<string>([...underSet, ...upgradeSet]);

    // Update territory border ribbon, construction/upgrade overlay, and conquerable frontier immediately
    this.rebuildTerritoryOverlays(nextState);
    this.rebuildUnderConstructionOverlay(nextState, overlayActiveSet);
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
        const nextLevel = getBuildingLevel(target);
        const nextModules = this.getTileModulesList(target);
        const nextModulesSig = this.getModulesSig(target);
        const levelChanged = nextLevel !== entry.level;
        const modulesChanged = nextModulesSig !== entry.modulesSig;
        const ownerOrUnderChanged =
          nextOwner !== entry.owner || nextUnder !== entry.underConstruction;

        if (ownerOrUnderChanged || levelChanged || modulesChanged) {
          const justCompleted = entry.underConstruction && !nextUnder;
          const justUpgraded = nextLevel > entry.level;
          const justInstalledModule =
            modulesChanged && nextModulesSig.length > entry.modulesSig.length;
          entry.owner = nextOwner;
          entry.underConstruction = nextUnder;
          entry.level = nextLevel;
          entry.modulesSig = nextModulesSig;

          if (ownerOrUnderChanged) {
            this.applyOwnerMaterials(entry.group, nextOwner, nextUnder);
          }

          if (levelChanged || ownerOrUnderChanged || modulesChanged) {
            if (entry.upgradeGroup) {
              entry.group.remove(entry.upgradeGroup);
              entry.upgradeGroup = null;
            }
            const assetName = HEX_ASSETS[target.structureIndex]?.name ?? '';
            const nextUpgradeGroup = this.buildUpgradeAttachmentGroup(
              assetName,
              nextLevel,
              nextUnder,
              nextModules
            );
            if (nextUpgradeGroup) {
              entry.group.add(nextUpgradeGroup);
              entry.upgradeGroup = nextUpgradeGroup;
            }
          }

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
          } else if (justUpgraded) {
            const pos = entry.group.position;
            entry.group.scale.set(
              1.12 * HEX_WORLD_SCALE,
              0.7 * HEX_WORLD_SCALE,
              1.12 * HEX_WORLD_SCALE
            );
            this.popAnims.push({ mesh: entry.group, progress: 0 });
            this.spawnParticleBurst(
              pos.x,
              TILE_SURFACE_Y + 0.14,
              pos.z,
              0xfbbf24,
              12
            );
          } else if (justInstalledModule) {
            const pos = entry.group.position;
            entry.group.scale.set(
              1.08 * HEX_WORLD_SCALE,
              0.82 * HEX_WORLD_SCALE,
              1.08 * HEX_WORLD_SCALE
            );
            this.popAnims.push({ mesh: entry.group, progress: 0 });
            this.spawnParticleBurst(
              pos.x,
              TILE_SURFACE_Y + 0.12,
              pos.z,
              0x34d399,
              10
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

    // Rebuild batched terrain InstancedMeshes (~10-20 draw calls for 1,000+ hexes!) + seasonal detail layers
    this.rebuildTerrainInstances(terrainBuckets);
    this.lastSeasonalDetailsSig = '';
    this.rebuildSeasonalDetailLayers();

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

      const level = getBuildingLevel(tile);
      const tileModules = this.getTileModulesList(tile);
      const upgradeGroup = this.buildUpgradeAttachmentGroup(
        asset.name,
        level,
        isUnder,
        tileModules
      );
      if (upgradeGroup) {
        group.add(upgradeGroup);
      }

      const pos = axialToWorld(tile.q, tile.r);
      group.position.set(pos.x, 0, pos.z);
      group.rotation.y = THREE.MathUtils.degToRad(tile.orientation);
      group.scale.setScalar(HEX_WORLD_SCALE);
      this.hexesGroup.add(group);

      this.placedMeshes.set(key, {
        group,
        upgradeGroup,
        structureIndex: tile.structureIndex,
        orientation: tile.orientation,
        owner,
        underConstruction: isUnder,
        level,
        modulesSig: this.getModulesSig(tile),
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

    this.rebuildLivingBuildingAnchors(this.currentWorldState, underSet);
    this.wakeRenderLoop();
  }

  private rebuildLivingBuildingAnchors(
    worldState: HexWorldState,
    underSet: Set<string>
  ) {
    this.smokeAnchors = [];
    this.forgeAnchors = [];
    this.bannerAnchors = [];

    const smokeAssets = new Set([
      'building-house',
      'building-village',
      'unit-mansion',
      'building-castle',
      'building-smelter',
      'building-mill',
    ]);
    const forgeAssets = new Set(['building-smelter', 'building-mine']);
    const lanternAssets = new Set([
      'building-house',
      'building-village',
      'unit-mansion',
      'building-castle',
      'building-market',
      'building-wizard-tower',
      'building-port',
      'building-tower',
    ]);
    const bannerAssets = new Set([
      'building-castle',
      'building-tower',
      'building-archery',
      'unit-wall-tower',
      'building-port',
    ]);

    for (const [key, tile] of Object.entries(worldState.hexes)) {
      if (underSet.has(key)) continue;
      const assetName = HEX_ASSETS[tile.structureIndex]?.name ?? '';
      if (!assetName) continue;
      const pos = axialToWorld(tile.q, tile.r);
      const phase = (tile.q * 1.73 + tile.r * 2.11) % 6.28;

      if (smokeAssets.has(assetName) && this.smokeAnchors.length < 32) {
        const yOff = assetName === 'building-castle' ? 0.62 : assetName === 'building-smelter' ? 0.48 : 0.38;
        this.smokeAnchors.push({
          x: pos.x + 0.08 * HEX_WORLD_SCALE,
          y: TILE_SURFACE_Y + yOff * HEX_WORLD_SCALE,
          z: pos.z - 0.06 * HEX_WORLD_SCALE,
          phase,
          isForge: assetName === 'building-smelter',
        });
      }

      if (forgeAssets.has(assetName) && this.forgeAnchors.length < 48) {
        this.forgeAnchors.push({
          x: pos.x - 0.08 * HEX_WORLD_SCALE,
          y: TILE_SURFACE_Y + 0.16 * HEX_WORLD_SCALE,
          z: pos.z + 0.1 * HEX_WORLD_SCALE,
          phase,
          nightOnly: false,
        });
      } else if (lanternAssets.has(assetName) && this.forgeAnchors.length < 48) {
        const yOff = assetName === 'building-castle' || assetName === 'building-wizard-tower' ? 0.34 : 0.18;
        this.forgeAnchors.push({
          x: pos.x + 0.06 * HEX_WORLD_SCALE,
          y: TILE_SURFACE_Y + yOff * HEX_WORLD_SCALE,
          z: pos.z + 0.14 * HEX_WORLD_SCALE,
          phase,
          nightOnly: true,
        });
      }

      if (bannerAssets.has(assetName) && this.bannerAnchors.length < 32) {
        const yOff = assetName === 'building-castle' ? 0.68 : assetName === 'building-tower' || assetName === 'unit-wall-tower' ? 0.56 : 0.44;
        const ownerColor =
          tile.owner === 'player'
            ? 0x10b981
            : tile.owner === 'iron_clan'
              ? 0xdc2626
              : tile.owner === 'azure_league'
                ? 0x2563eb
                : 0xf59e0b;
        this.bannerAnchors.push({
          x: pos.x,
          y: TILE_SURFACE_Y + yOff * HEX_WORLD_SCALE,
          z: pos.z,
          phase,
          colorHex: ownerColor,
        });
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
    if (this.reduceEffects) return;
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
    this.wakeRenderLoop();
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
      const dist = isPortrait ? 25.0 : 18.5;
      const pitch = isPortrait ? 0.62 : 0.56;
      const horiz = Math.cos(pitch) * dist;
      const y = Math.sin(pitch) * dist;
      const home = this.getHomeWorldPos();
      const focusX = home.x + (isPortrait ? 0 : -1.68);
      const focusZ = home.z + (isPortrait ? 1.18 : -0.37);
      this.camera.position.set(
        focusX + Math.sin(this.titleOrbitAngle) * horiz,
        y,
        focusZ + Math.cos(this.titleOrbitAngle) * horiz
      );
      this.camera.lookAt(focusX, 0.45, focusZ);
      this.updateSunDirection();
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
        const panSpeed = Math.max(10, this.camDistance * 0.65) * dt;
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
    this.updateSunDirection();
  }

  private updateEffects(dt: number, atmosDt: number = dt) {
    this.elapsedSec += dt;
    this.updateAtmosphereStep(atmosDt);

    const weatherId = this.currentWeather;
    const seasonId = this.currentSeason;
    const nightFactor = this.currentAtmosTarget.cityNightGlow;
    const isNightish = nightFactor >= 0.35;
    const windSpeedMult =
      weatherId === 'storm' ? 2.4 : weatherId === 'rain' ? 1.55 : 1.0;

    // 1. GPU Foliage wind sway (zero extra draw calls!)
    TERRAIN_WIND_UNIFORMS.uWindTime.value = this.elapsedSec * windSpeedMult;
    TERRAIN_WIND_UNIFORMS.uWindAmp.value = this.reduceAnimations
      ? 0
      : weatherId === 'storm'
        ? 1.7
        : weatherId === 'rain'
          ? 1.25
          : 0.9;

    // 2. Visible ocean wave drift & gentle tidal heave
    if (!this.reduceAnimations) {
      this.waterTexture.offset.x = (this.elapsedSec * 0.032 * windSpeedMult) % 1;
      this.waterTexture.offset.y =
        (this.elapsedSec * 0.02 + Math.sin(this.elapsedSec * 0.65) * 0.015) % 1;
      this.waterMesh.position.y =
        -0.025 * HEX_WORLD_SCALE + Math.sin(this.elapsedSec * 1.15) * 0.018;
    }

    // 3. Living world: Ambient wind/seasonal/weather motes around camera focus
    if (this.reduceAnimations || this.reduceEffects) {
      if (this.ambientMotesMesh.visible) this.ambientMotesMesh.visible = false;
    } else {
      if (!this.ambientMotesMesh.visible) this.ambientMotesMesh.visible = true;
      const isRainOrStorm = weatherId === 'rain' || weatherId === 'storm';
      const isWinter = seasonId === 'winter' || weatherId === 'frost';
      const isNight = isNightish;

      if (isRainOrStorm) {
        this.ambientMotesMat.color.setHex(0xcbe8ff);
        this.ambientMotesMat.opacity = 0.62;
      } else if (isWinter) {
        this.ambientMotesMat.color.setHex(0xf8fafc);
        this.ambientMotesMat.opacity = 0.72;
      } else if (isNight) {
        this.ambientMotesMat.color.setHex(0xfde047); // Warm fireflies
        this.ambientMotesMat.opacity = 0.68;
      } else if (seasonId === 'autumn') {
        this.ambientMotesMat.color.setHex(0xea580c); // Drifting autumn leaves
        this.ambientMotesMat.opacity = 0.65;
      } else {
        this.ambientMotesMat.color.setHex(0xfef3c7); // Gentle sunlit petals/pollen
        this.ambientMotesMat.opacity = 0.5;
      }

      const cx = this.camTarget.x;
      const cz = this.camTarget.z;
      for (let i = 0; i < this.ambientMoteCount; i++) {
        const m = this.ambientMotes[i]!;
        if (isRainOrStorm) {
          const dropY = 3.6 - ((this.elapsedSec * (4.2 * windSpeedMult) + m.phase) % 3.6);
          const wx = cx + m.ox + Math.sin(m.phase) * 1.2 - dropY * 0.25;
          const wz = cz + m.oz + Math.cos(m.phase) * 1.2;
          _dummy.position.set(wx, Math.max(0.1, dropY), wz);
          _dummy.rotation.set(0, 0, 0.22);
          _dummy.scale.set(0.28, 2.2, 0.28);
        } else if (isWinter) {
          const snowY = 3.2 - ((this.elapsedSec * 0.65 + m.phase) % 3.1);
          const wx = cx + m.ox + Math.sin(this.elapsedSec * 0.9 + m.phase) * 1.3;
          const wz = cz + m.oz + Math.cos(this.elapsedSec * 0.7 + m.phase) * 1.3;
          _dummy.position.set(wx, Math.max(0.12, snowY), wz);
          _dummy.rotation.set(this.elapsedSec, this.elapsedSec * 0.8, 0);
          _dummy.scale.setScalar(m.scale * 0.85);
        } else {
          const driftX = ((this.elapsedSec * m.speed * 1.15 + m.ox + 12) % 24) - 12;
          const driftZ = m.oz + Math.sin(this.elapsedSec * 0.65 + m.phase) * 1.8;
          const driftY = m.oy + Math.sin(this.elapsedSec * 1.3 + m.phase) * 0.35;
          _dummy.position.set(cx + driftX, driftY, cz + driftZ);
          _dummy.rotation.set(this.elapsedSec * 0.9, this.elapsedSec * 1.2 + m.phase, 0);
          const pulse = isNight ? 0.55 + 0.45 * Math.sin(this.elapsedSec * 3.4 + m.phase) : 1;
          _dummy.scale.setScalar(m.scale * 0.72 * pulse);
        }
        _dummy.updateMatrix();
        this.ambientMotesMesh.setMatrixAt(i, _dummy.matrix);
      }
      this.ambientMotesMesh.instanceMatrix.needsUpdate = true;
    }

    // 4. Living buildings: Chimney smoke wisps
    if (this.reduceAnimations || this.reduceEffects || this.smokeAnchors.length === 0) {
      if (this.smokeMesh.visible) this.smokeMesh.visible = false;
    } else {
      if (!this.smokeMesh.visible) this.smokeMesh.visible = true;
      for (let i = 0; i < 32; i++) {
        if (i >= this.smokeAnchors.length) {
          _dummy.position.set(0, -10, 0);
          _dummy.scale.setScalar(0);
          _dummy.updateMatrix();
          this.smokeMesh.setMatrixAt(i, _dummy.matrix);
          continue;
        }
        const anc = this.smokeAnchors[i]!;
        const cycle = (this.elapsedSec * (anc.isForge ? 0.48 : 0.34) + anc.phase) % 1;
        const riseY = anc.y + cycle * 0.58 * HEX_WORLD_SCALE;
        const driftX = anc.x + Math.sin(cycle * 4.2 + anc.phase) * 0.08 * HEX_WORLD_SCALE + cycle * 0.14 * windSpeedMult;
        const driftZ = anc.z + Math.cos(cycle * 3.1 + anc.phase) * 0.06 * HEX_WORLD_SCALE;
        const s = Math.sin(cycle * Math.PI) * (anc.isForge ? 1.15 : 0.85);
        _dummy.position.set(driftX, riseY, driftZ);
        _dummy.rotation.set(cycle * 2, anc.phase, 0);
        _dummy.scale.setScalar(Math.max(0.001, s));
        _dummy.updateMatrix();
        this.smokeMesh.setMatrixAt(i, _dummy.matrix);
      }
      this.smokeMesh.instanceMatrix.needsUpdate = true;
    }

    // 5. Living buildings: Forge embers & Dusk/Night warm window lanterns
    if (this.reduceEffects || this.forgeAnchors.length === 0) {
      if (this.forgeLightsMesh.visible) this.forgeLightsMesh.visible = false;
    } else {
      if (!this.forgeLightsMesh.visible) this.forgeLightsMesh.visible = true;
      let anyColorUpdated = false;
      for (let i = 0; i < 48; i++) {
        if (i >= this.forgeAnchors.length) {
          _dummy.position.set(0, -10, 0);
          _dummy.scale.setScalar(0);
          _dummy.updateMatrix();
          this.forgeLightsMesh.setMatrixAt(i, _dummy.matrix);
          continue;
        }
        const anc = this.forgeAnchors[i]!;
        if (anc.nightOnly && !isNightish) {
          _dummy.position.set(0, -10, 0);
          _dummy.scale.setScalar(0);
          _dummy.updateMatrix();
          this.forgeLightsMesh.setMatrixAt(i, _dummy.matrix);
          continue;
        }
        const flicker = this.reduceAnimations
          ? 1.0
          : 0.78 + 0.28 * Math.sin(this.elapsedSec * (anc.nightOnly ? 2.4 : 6.2) + anc.phase);
        const nightScale = anc.nightOnly ? 0.65 + nightFactor * 0.45 : 1.15;
        _dummy.position.set(anc.x, anc.y, anc.z);
        _dummy.rotation.set(0, anc.phase, 0);
        _dummy.scale.setScalar(flicker * nightScale);
        _dummy.updateMatrix();
        this.forgeLightsMesh.setMatrixAt(i, _dummy.matrix);
        this.forgeLightsMesh.setColorAt(
          i,
          _colorTmp.setHex(anc.nightOnly ? 0xfde68a : 0xf97316)
        );
        anyColorUpdated = true;
      }
      this.forgeLightsMesh.instanceMatrix.needsUpdate = true;
      if (anyColorUpdated && this.forgeLightsMesh.instanceColor) {
        this.forgeLightsMesh.instanceColor.needsUpdate = true;
      }
    }

    // 6. Living buildings: Waving banners / pennants
    if (this.bannerAnchors.length === 0) {
      if (this.bannersMesh.visible) this.bannersMesh.visible = false;
    } else {
      if (!this.bannersMesh.visible) this.bannersMesh.visible = true;
      for (let i = 0; i < 32; i++) {
        if (i >= this.bannerAnchors.length) {
          _dummy.position.set(0, -10, 0);
          _dummy.scale.setScalar(0);
          _dummy.updateMatrix();
          this.bannersMesh.setMatrixAt(i, _dummy.matrix);
          continue;
        }
        const anc = this.bannerAnchors[i]!;
        const waveYaw = this.reduceAnimations
          ? 0.25
          : Math.sin(this.elapsedSec * 3.4 * windSpeedMult + anc.phase) * 0.42;
        const waveRoll = this.reduceAnimations
          ? 0
          : Math.cos(this.elapsedSec * 2.6 * windSpeedMult + anc.phase) * 0.12;
        _dummy.position.set(anc.x, anc.y, anc.z);
        _dummy.rotation.set(waveRoll, waveYaw, 0);
        _dummy.scale.setScalar(1);
        _dummy.updateMatrix();
        this.bannersMesh.setMatrixAt(i, _dummy.matrix);
        this.bannersMesh.setColorAt(i, _colorTmp.setHex(anc.colorHex));
      }
      this.bannersMesh.instanceMatrix.needsUpdate = true;
      if (this.bannersMesh.instanceColor) {
        this.bannersMesh.instanceColor.needsUpdate = true;
      }
    }

    // Gentle preview float & frontier pulse
    if (this.selectorGroup.visible && this.selectorPreviewGroup.visible) {
      this.selectorPreviewGroup.position.y = this.reduceAnimations
        ? TILE_SURFACE_Y + 0.04
        : TILE_SURFACE_Y + 0.04 + Math.sin(this.elapsedSec * 4) * 0.035;
    }

    this.expandingOverlayMat.opacity = this.reduceAnimations
      ? 0.62
      : 0.56 + Math.sin(this.elapsedSec * 4.2) * 0.24;

    if (this.toolMode === 'expand') {
      this.frontierOverlayMat.opacity = this.reduceAnimations
        ? 0.4
        : 0.36 + Math.sin(this.elapsedSec * 2.6) * 0.12;
      this.influenceOverlayMat.opacity = 0.24;
    } else {
      this.frontierOverlayMat.opacity = 0.2;
      this.influenceOverlayMat.opacity = 0.12;
    }

    // 7. Smooth unit glide interpolation (hex-to-hex walking/sailing)
    for (let i = this.unitMoveAnims.length - 1; i >= 0; i--) {
      const anim = this.unitMoveAnims[i]!;
      anim.progress += dt * 2.8;
      if (anim.progress >= 1 || this.reduceAnimations) {
        anim.group.position.set(anim.toX, anim.baseY, anim.toZ);
        anim.group.userData.isMoving = false;
        this.unitMoveAnims.splice(i, 1);
      } else {
        const t = anim.progress;
        const ease = 1 - Math.pow(1 - t, 3);
        const hop = Math.sin(t * Math.PI) * 0.14 * HEX_WORLD_SCALE;
        anim.group.position.set(
          THREE.MathUtils.lerp(anim.fromX, anim.toX, ease),
          anim.baseY + hop,
          THREE.MathUtils.lerp(anim.fromZ, anim.toZ, ease)
        );
      }
    }

    if (!this.reduceAnimations) {
      for (const child of this.rareMarkersGroup.children) {
        const baseY =
          (child.userData.baseY as number | undefined) ?? TILE_SURFACE_Y + 0.24;
        const phase = (child.userData.phase as number | undefined) ?? 0;
        child.position.y = baseY + Math.sin(this.elapsedSec * 2.5 + phase) * 0.04;
        child.rotation.y = this.elapsedSec * 1.1 + phase;
      }

      for (const unitGroup of this.unitsGroup.children) {
        if (unitGroup.userData.isMoving) continue;
        const baseY =
          (unitGroup.userData.baseY as number | undefined) ?? TILE_SURFACE_Y + 0.05;
        const phase = (unitGroup.userData.phase as number | undefined) ?? 0;
        const isShip = unitGroup.userData.unitType === 'warship';
        if (isShip) {
          unitGroup.position.y = baseY + Math.sin(this.elapsedSec * 2.1 + phase) * 0.025;
          unitGroup.rotation.z = Math.sin(this.elapsedSec * 1.7 + phase) * 0.06;
        } else if (unitGroup.userData.readyBob) {
          unitGroup.position.y = baseY + Math.sin(this.elapsedSec * 3.1 + phase) * 0.026;
          unitGroup.rotation.y = Math.sin(this.elapsedSec * 1.1 + phase) * 0.12;
        } else {
          // Subtle living idle breathing for all stationed/exhausted units
          unitGroup.position.y = baseY + Math.sin(this.elapsedSec * 1.8 + phase) * 0.01;
          unitGroup.rotation.y = Math.sin(this.elapsedSec * 0.7 + phase) * 0.06;
        }
      }
    }

    // Conquest wave rings
    for (let i = this.conquestWaves.length - 1; i >= 0; i--) {
      const wave = this.conquestWaves[i];
      wave.progress += dt * 2.2;
      if (wave.progress >= 1 || this.reduceEffects) {
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
      if (anim.progress >= 1 || this.reduceAnimations) {
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

  private wakeRenderLoop() {
    if (this.disposed) return;
    this.lastRenderMs = 0;
    this.pendingSoftwareRender = true;
    if (this.isSoftwareGl && this.isIdleSleeping) {
      this.isIdleSleeping = false;
      this.lastFrameMs = performance.now();
      this.frameId = requestAnimationFrame(this.tick);
    }
  }

  private scheduleNextFrame() {
    if (this.disposed) return;
    if (this.isSoftwareGl) {
      if (this.hasRenderedInitialFrame && !this.isSceneActive() && !this.pendingSoftwareRender) {
        this.isIdleSleeping = true;
        return;
      }
      this.afterDraw(this.tick);
    } else {
      this.frameId = requestAnimationFrame(this.tick);
    }
  }

  private isSceneActive(): boolean {
    return (
      this.gameState === 'title' ||
      this.atmosDirty ||
      this.activeTouchPointers.size > 0 ||
      this.keysHeld.size > 0 ||
      this.isOrbitDragging ||
      this.popAnims.length > 0 ||
      this.unitMoveAnims.length > 0 ||
      this.conquestWaves.length > 0 ||
      this.activeParticleCount > 0 ||
      this.isCameraSettling()
    );
  }

  private tick = () => {
    if (this.disposed) return;

    if (document.hidden) {
      if (this.isSoftwareGl) {
        this.isIdleSleeping = true;
        return;
      }
      this.scheduleNextFrame();
      return;
    }

    if (
      this.isSoftwareGl &&
      this.hasRenderedInitialFrame &&
      !this.isSceneActive() &&
      !this.pendingSoftwareRender
    ) {
      this.isIdleSleeping = true;
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

    this.pendingSoftwareRender = false;
    const rawDt = (now - this.lastFrameMs) / 1000;
    this.lastFrameMs = now;
    this.lastRenderMs = now;
    const dt = Math.min(Math.max(rawDt, 0.001), 0.05);
    const camDt = this.isSoftwareGl
      ? Math.min(Math.max(rawDt, 0.001), 0.18)
      : dt;
    const atmosDt = this.isSoftwareGl
      ? Math.min(Math.max(rawDt, 0.001), 0.25)
      : dt;

    this.updateCameraTransform(camDt);
    if (this.gameState !== 'paused') {
      this.updateEffects(dt, atmosDt);
    }
    this.renderer.render(this.scene, this.camera);
    this.hasRenderedInitialFrame = true;
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
    for (const geo of this.upgradeGeoCache.values()) {
      geometries.add(geo);
    }
    for (const sm of this.seasonalTerrainMats.values()) {
      addMat(sm);
    }
    materials.add(this.nightLanternGlowMat);
    materials.add(this.upgradeStoneMat);
    materials.add(this.upgradeTimberMat);
    materials.add(this.upgradeRoofMat);
    materials.add(this.upgradeGoldMat);
    materials.add(this.upgradeDarkMetalMat);
    materials.add(this.upgradeFoliageMat);
    materials.add(this.upgradeCanvasMat);
    materials.add(this.upgradeEmberMat);
    materials.add(this.fertileOverlayMat);

    const textures = new Set<THREE.Texture>();
    const envTex = this.envRenderTarget?.texture;
    const textureKeys = [
      'map',
      'alphaMap',
      'aoMap',
      'bumpMap',
      'displacementMap',
      'emissiveMap',
      'envMap',
      'lightMap',
      'metalnessMap',
      'normalMap',
      'roughnessMap',
      'specularMap',
    ] as const;

    geometries.add(this.conquestRingGeo);
    geometries.forEach((g) => g.dispose());
    materials.forEach((m) => {
      const matRec = m as unknown as Record<string, unknown>;
      for (const key of textureKeys) {
        const val = matRec[key];
        if (val instanceof THREE.Texture && val !== envTex && val !== this.waterTexture) {
          textures.add(val);
        }
      }
      m.dispose();
    });
    textures.forEach((t) => t.dispose());

    while (this.terrainInstancesGroup.children.length > 0) {
      const child = this.terrainInstancesGroup.children[0] as THREE.InstancedMesh;
      this.terrainInstancesGroup.remove(child);
      child.geometry?.dispose();
      child.dispose();
    }
    this.springFlowersMesh.dispose();
    this.farmCropStalksMesh.dispose();
    this.farmCropHeadsMesh.dispose();
    this.winterIceMesh.dispose();
    this.ambientMotesMesh.dispose();
    this.smokeMesh.dispose();
    this.forgeLightsMesh.dispose();
    this.bannersMesh.dispose();
    this.roadLanternsMesh.dispose();
    this.particlesMesh.dispose();

    this.conquestWaves = [];
    this.unitMoveAnims = [];
    this.unitLastWorldPos.clear();
    this.smokeAnchors = [];
    this.forgeAnchors = [];
    this.bannerAnchors = [];
    this.terrainInstanceEntries = [];
    this.seasonalTerrainMats.clear();
    this.upgradeGeoCache.clear();
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
