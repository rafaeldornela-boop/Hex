import type { HexAssetEntry } from './godot-docs';
import {
  TERRAIN_METADATA,
  canBuildStructureOnTerrain,
  getHexTerrainAndResource,
  isNaturalTerrainAssetName,
  type ResourceType,
  type TerrainType,
} from './terrain-engine';
import type { FutureEconomySnapshot, TileDomainMetadata } from './world-domain';

/**
 * Exact flat-topped hexagonal tessellation matching the Kenney Hexagons .glb
 * geometry (flat-to-flat width = 1.0, point-to-point = 2/sqrt(3) when rotated 90°).
 */
export const HEX_FLAT_TO_FLAT = 1.0;
export const HEX_OUTER_RADIUS = 1.0 / Math.sqrt(3); // ~0.57735027
export const HEX_COL_STEP = Math.sqrt(3) / 2; // ~0.8660254
export const HEX_ROW_STEP = 1.0;
export const INITIAL_CASH = 10000;
export const DEFAULT_ROTATION_DEG = 90;

export interface AxialCoord {
  q: number;
  r: number;
}

export type HexOwner = 'player' | 'neutral' | (string & {});

export interface PlacedHex {
  q: number;
  r: number;
  orientation: number; // degrees: 90, 150, 210, 270, 330, 30
  structureIndex: number;
  /** Territorial ownership ('player', 'neutral', or future faction ID) */
  owner?: HexOwner;
  /** Persistent terrain biome & basic resource data */
  terrainType?: TerrainType;
  resourceType?: ResourceType;
  resourceAmount?: number;
  /** Optional seam for upcoming territory, level, and worker mechanics */
  meta?: TileDomainMetadata;
}

export interface HexWorldState {
  cash: number;
  hexes: Record<string, PlacedHex>;
  /** Reserved seam for future economy/territory state (unused in current build) */
  futureEconomy?: Partial<FutureEconomySnapshot>;
}

export function hexKey(q: number, r: number): string {
  const safeQ = Object.is(q, -0) ? 0 : q;
  const safeR = Object.is(r, -0) ? 0 : r;
  return `${safeQ},${safeR}`;
}

/**
 * Convert axial coordinates (q, r) to 3D world position (x, z) on the Y=0 plane.
 * Matches godot-gdhexgrid convention: +q => NE, +r => N (-Z in Three.js/Godot).
 */
export function axialToWorld(q: number, r: number): { x: number; z: number } {
  const x = q * HEX_COL_STEP;
  const z = -(r + q * 0.5) * HEX_ROW_STEP;
  return {
    x: Object.is(x, -0) ? 0 : x,
    z: Object.is(z, -0) ? 0 : z,
  };
}

/**
 * Convert 3D world position (x, z) on Y=0 plane to nearest integer axial hex coordinate.
 */
export function worldToAxial(x: number, z: number): AxialCoord {
  const fq = x / HEX_COL_STEP;
  const fr = -z / HEX_ROW_STEP - fq * 0.5;
  return cubeRound(fq, fr, -fq - fr);
}

/**
 * Standard cube coordinate rounding ensuring q + r + s = 0.
 */
export function cubeRound(fq: number, fr: number, fs: number): AxialCoord {
  let rq = Math.round(fq);
  let rr = Math.round(fr);
  const rs = Math.round(fs);

  const qDiff = Math.abs(rq - fq);
  const rDiff = Math.abs(rr - fr);
  const sDiff = Math.abs(rs - fs);

  if (qDiff > rDiff && qDiff > sDiff) {
    rq = -rr - rs;
  } else if (rDiff > sDiff) {
    rr = -rq - rs;
  }

  return {
    q: Object.is(rq, -0) ? 0 : rq,
    r: Object.is(rr, -0) ? 0 : rr,
  };
}

export function rotateHexStep(currentDeg: number, deltaSteps = 1): number {
  const raw = (currentDeg + deltaSteps * 60) % 360;
  return raw < 0 ? raw + 360 : raw;
}

export function cycleStructureIndex(
  currentIndex: number,
  delta: number,
  totalCount: number
): number {
  if (totalCount <= 0) return 0;
  const mod = (currentIndex + delta) % totalCount;
  return mod < 0 ? mod + totalCount : mod;
}

export function hasHexConstruction(
  tile: Pick<PlacedHex, 'structureIndex'> | null | undefined,
  assets: HexAssetEntry[]
): boolean {
  if (!tile) return false;
  const asset = assets[tile.structureIndex];
  if (!asset) return false;
  return !isNaturalTerrainAssetName(asset.name);
}

export function placeHexInState(
  state: HexWorldState,
  q: number,
  r: number,
  structureIndex: number,
  orientation: number,
  assets: HexAssetEntry[],
  actorId: HexOwner = 'player'
): {
  nextState: HexWorldState;
  changed: boolean;
  spent: number;
  blockedReason?: 'not_owned' | 'already_occupied' | 'incompatible_terrain';
} {
  const key = hexKey(q, r);
  const previous = state.hexes[key];
  const asset = assets[structureIndex];
  if (!asset) {
    return { nextState: state, changed: false, spent: 0 };
  }

  const currentOwner: HexOwner =
    typeof previous?.owner === 'string' && previous.owner.trim().length > 0
      ? previous.owner.trim()
      : 'neutral';

  // Enforce territorial ownership inside pure game logic before terrain or cash checks
  if (currentOwner !== actorId) {
    return {
      nextState: state,
      changed: false,
      spent: 0,
      blockedReason: 'not_owned',
    };
  }

  // Enforce single construction per hex: cannot build over an existing construction
  if (hasHexConstruction(previous, assets)) {
    return {
      nextState: state,
      changed: false,
      spent: 0,
      blockedReason: 'already_occupied',
    };
  }

  const terrainInfo = getHexTerrainAndResource(q, r, previous);

  // Enforce terrain compatibility only when placing a construction on free terrain
  if (!canBuildStructureOnTerrain(asset, terrainInfo.terrainType)) {
    return {
      nextState: state,
      changed: false,
      spent: 0,
      blockedReason: 'incompatible_terrain',
    };
  }

  const isSameTile =
    previous !== undefined &&
    previous.structureIndex === structureIndex &&
    previous.orientation === orientation;

  if (isSameTile) {
    return { nextState: state, changed: false, spent: 0 };
  }

  const cost =
    !previous || previous.structureIndex !== structureIndex ? asset.price : 0;

  const nextHexes: Record<string, PlacedHex> = {
    ...state.hexes,
    [key]: {
      q,
      r,
      orientation,
      structureIndex,
      owner: currentOwner,
      terrainType: terrainInfo.terrainType,
      resourceType: terrainInfo.resourceType,
      resourceAmount: terrainInfo.resourceAmount,
      ...(previous?.meta ? { meta: previous.meta } : {}),
    },
  };

  return {
    nextState: {
      cash: state.cash - cost,
      hexes: nextHexes,
    },
    changed: true,
    spent: cost,
  };
}

export function demolishHexInState(
  state: HexWorldState,
  q: number,
  r: number,
  assets: HexAssetEntry[],
  actorId: HexOwner = 'player'
): {
  nextState: HexWorldState;
  removed: boolean;
  blockedReason?: 'not_owned' | 'no_building';
} {
  const key = hexKey(q, r);
  const existing = state.hexes[key];
  if (!existing) {
    return { nextState: state, removed: false, blockedReason: 'no_building' };
  }

  const currentOwner: HexOwner =
    typeof existing.owner === 'string' && existing.owner.trim().length > 0
      ? existing.owner.trim()
      : 'neutral';

  if (currentOwner !== actorId) {
    return { nextState: state, removed: false, blockedReason: 'not_owned' };
  }

  if (!hasHexConstruction(existing, assets)) {
    return { nextState: state, removed: false, blockedReason: 'no_building' };
  }

  const terrainInfo = getHexTerrainAndResource(q, r, existing);
  const baseAssetName = TERRAIN_METADATA[terrainInfo.terrainType].defaultAssetName;
  const baseAssetIndex = assets.findIndex((a) => a.name === baseAssetName);
  const nextStructureIndex =
    baseAssetIndex >= 0 ? baseAssetIndex : existing.structureIndex;

  return {
    nextState: {
      ...state,
      hexes: {
        ...state.hexes,
        [key]: {
          ...existing,
          owner: currentOwner,
          orientation: DEFAULT_ROTATION_DEG,
          structureIndex: nextStructureIndex,
          terrainType: terrainInfo.terrainType,
          resourceType: terrainInfo.resourceType,
          resourceAmount: terrainInfo.resourceAmount,
        },
      },
    },
    removed: true,
  };
}

export function serializeWorldState(state: HexWorldState): string {
  return JSON.stringify({
    version: 1,
    cash: state.cash,
    structures: Object.values(state.hexes),
  });
}

export function deserializeWorldState(
  raw: string,
  totalAssets: number
): HexWorldState | null {
  try {
    const parsed = JSON.parse(raw) as {
      cash?: unknown;
      structures?: unknown;
    };
    if (typeof parsed.cash !== 'number' || !Array.isArray(parsed.structures)) {
      return null;
    }
    const hexes: Record<string, PlacedHex> = {};
    for (const item of parsed.structures) {
      if (
        item &&
        typeof item === 'object' &&
        typeof (item as PlacedHex).q === 'number' &&
        typeof (item as PlacedHex).r === 'number' &&
        typeof (item as PlacedHex).orientation === 'number' &&
        typeof (item as PlacedHex).structureIndex === 'number'
      ) {
        const idx = (item as PlacedHex).structureIndex;
        if (idx >= 0 && idx < totalAssets) {
          const q = Math.round((item as PlacedHex).q);
          const r = Math.round((item as PlacedHex).r);
          const rawOwner = (item as PlacedHex).owner;
          const owner: HexOwner =
            typeof rawOwner === 'string' && rawOwner.trim().length > 0
              ? rawOwner.trim()
              : 'neutral';
          const rawMeta = (item as PlacedHex).meta;
          const terrainInfo = getHexTerrainAndResource(q, r, item as PlacedHex);
          const tile: PlacedHex = {
            q,
            r,
            orientation: ((item as PlacedHex).orientation % 360 + 360) % 360,
            structureIndex: idx,
            owner,
            terrainType: terrainInfo.terrainType,
            resourceType: terrainInfo.resourceType,
            resourceAmount: terrainInfo.resourceAmount,
          };
          if (rawMeta && typeof rawMeta === 'object') {
            tile.meta = rawMeta;
          }
          hexes[hexKey(q, r)] = tile;
        }
      }
    }
    return {
      cash: Math.round(parsed.cash),
      hexes,
    };
  } catch {
    return null;
  }
}

/**
 * Handcrafted starter island diorama built purely from the real Starter-Kit-Hexagon-World
 * assets so the player immediately enters a lush, grounded world with a tall castle landmark.
 */
interface StarterTileBlueprint {
  q: number;
  r: number;
  name: string;
  orientation?: number;
}

const STARTER_ISLAND_BLUEPRINT: StarterTileBlueprint[] = [
  // Center landmark & town square
  { q: 0, r: 0, name: 'building-castle', orientation: 90 },
  { q: 1, r: 0, name: 'building-market', orientation: 150 },
  { q: -1, r: 0, name: 'building-house', orientation: 90 },
  { q: 0, r: 1, name: 'building-village', orientation: 210 },
  { q: 0, r: -1, name: 'path-straight', orientation: 90 },
  { q: 1, r: -1, name: 'building-mill', orientation: 90 },
  { q: -1, r: 1, name: 'building-farm', orientation: 90 },

  // Ring 2: Forests, hills, mountain, wizard tower, sheep, water coast
  { q: 0, r: 2, name: 'stone-mountain', orientation: 90 },
  { q: -1, r: 2, name: 'building-mine', orientation: 150 },
  { q: 1, r: 1, name: 'grass-forest', orientation: 90 },
  { q: 2, r: 0, name: 'grass-forest', orientation: 150 },
  { q: 2, r: -1, name: 'building-wizard-tower', orientation: 90 },
  { q: 2, r: -2, name: 'dirt', orientation: 90 },
  { q: 1, r: -2, name: 'building-sheep', orientation: 90 },
  { q: 0, r: -2, name: 'bridge', orientation: 90 },
  { q: -1, r: -1, name: 'grass', orientation: 90 },
  { q: -2, r: 0, name: 'grass-forest', orientation: 210 },
  { q: -2, r: 1, name: 'dirt-lumber', orientation: 90 },
  { q: -2, r: 2, name: 'stone-hill', orientation: 90 },

  // Coastline & harbor
  { q: -1, r: -2, name: 'water', orientation: 90 },
  { q: 0, r: -3, name: 'building-port', orientation: 90 },
  { q: 1, r: -3, name: 'water-island', orientation: 90 },
  { q: -2, r: -1, name: 'dirt', orientation: 90 },
  { q: 2, r: 1, name: 'stone-rocks', orientation: 90 },
  { q: 3, r: -1, name: 'sand-rocks', orientation: 90 },
  { q: -3, r: 1, name: 'water-rocks', orientation: 90 },
  { q: -1, r: -3, name: 'unit-ship', orientation: 150 },
];

const STARTER_PLAYER_KEYS = new Set([
  '0,0',
  '1,0',
  '-1,0',
  '0,1',
  '0,-1',
  '1,-1',
  '-1,1',
]);

export function createStarterWorldState(assets: HexAssetEntry[]): HexWorldState {
  const indexByName = new Map<string, number>();
  assets.forEach((asset, idx) => indexByName.set(asset.name, idx));

  const hexes: Record<string, PlacedHex> = {};
  for (const tile of STARTER_ISLAND_BLUEPRINT) {
    const idx = indexByName.get(tile.name);
    if (idx !== undefined) {
      const key = hexKey(tile.q, tile.r);
      const terrainInfo = getHexTerrainAndResource(tile.q, tile.r);
      hexes[key] = {
        q: tile.q,
        r: tile.r,
        orientation: tile.orientation ?? DEFAULT_ROTATION_DEG,
        structureIndex: idx,
        owner: STARTER_PLAYER_KEYS.has(key) ? 'player' : 'neutral',
        terrainType: terrainInfo.terrainType,
        resourceType: terrainInfo.resourceType,
        resourceAmount: terrainInfo.resourceAmount,
      };
    }
  }

  return {
    cash: INITIAL_CASH,
    hexes,
  };
}

export function createEmptyWorldState(): HexWorldState {
  return {
    cash: INITIAL_CASH,
    hexes: {},
  };
}
