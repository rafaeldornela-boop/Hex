import type { HexAssetEntry } from './godot-docs';
import { hexKey, type HexWorldState, type PlacedHex } from './hex-engine';

export type TerrainType = 'plains' | 'forest' | 'mountain' | 'water' | 'fertile';

export type ResourceType = 'none' | 'wood' | 'ore' | 'food' | 'water';

export interface TerrainResourceInfo {
  resourceType: ResourceType;
  resourceAmount: number;
}

export interface TerrainDescriptor {
  type: TerrainType;
  labelPt: string;
  resourceType: ResourceType;
  resourceLabelPt: string;
  resourceAmount: number;
  defaultAssetName: string;
}

export interface PlayerResourceSummary {
  wood: number;
  ore: number;
  food: number;
  water: number;
}

export const INCOMPATIBLE_TERRAIN_MESSAGE =
  'Este edifício não pode ser construído neste terreno.';

export const TERRAIN_METADATA: Record<
  TerrainType,
  Omit<TerrainDescriptor, 'type'>
> = {
  plains: {
    labelPt: 'Planície',
    resourceType: 'none',
    resourceLabelPt: 'Nenhum',
    resourceAmount: 0,
    defaultAssetName: 'grass',
  },
  forest: {
    labelPt: 'Floresta',
    resourceType: 'wood',
    resourceLabelPt: 'Madeira',
    resourceAmount: 10,
    defaultAssetName: 'grass-forest',
  },
  mountain: {
    labelPt: 'Montanha',
    resourceType: 'ore',
    resourceLabelPt: 'Minério',
    resourceAmount: 10,
    defaultAssetName: 'stone-mountain',
  },
  fertile: {
    labelPt: 'Terra fértil',
    resourceType: 'food',
    resourceLabelPt: 'Alimento',
    resourceAmount: 10,
    defaultAssetName: 'dirt',
  },
  water: {
    labelPt: 'Água',
    resourceType: 'water',
    resourceLabelPt: 'Água / Pesca',
    resourceAmount: 10,
    defaultAssetName: 'water',
  },
};

/**
 * Deterministic terrain assignment for the handcrafted starter island so that
 * visual 3D models, initial structures (castle, farm, mine, lumber), and all
 * 5 terrain types align cleanly around the starting border.
 */
const STARTER_TERRAIN_OVERRIDES: Record<string, TerrainType> = {
  // Player core (7 hexes)
  '0,0': 'plains',
  '1,0': 'plains',
  '-1,0': 'plains',
  '0,1': 'plains',
  '0,-1': 'plains',
  '1,-1': 'fertile',
  '-1,1': 'fertile',

  // Ring 2 & Ring 3 starter island
  '0,2': 'mountain',
  '-1,2': 'mountain',
  '-2,2': 'mountain',
  '2,1': 'mountain',

  '1,1': 'forest',
  '2,0': 'forest',
  '-2,0': 'forest',
  '-2,1': 'forest',

  '2,-2': 'fertile',
  '-2,-1': 'fertile',

  '2,-1': 'plains',
  '1,-2': 'plains',
  '-1,-1': 'plains',
  '3,-1': 'plains',

  '0,-2': 'water',
  '-1,-2': 'water',
  '0,-3': 'water',
  '1,-3': 'water',
  '-3,1': 'water',
  '-1,-3': 'water',
};

const VALID_TERRAINS = new Set<TerrainType>([
  'plains',
  'forest',
  'mountain',
  'water',
  'fertile',
]);

const VALID_RESOURCES = new Set<ResourceType>([
  'none',
  'wood',
  'ore',
  'food',
  'water',
]);

export function isValidTerrainType(value: unknown): value is TerrainType {
  return typeof value === 'string' && VALID_TERRAINS.has(value as TerrainType);
}

export function isValidResourceType(value: unknown): value is ResourceType {
  return typeof value === 'string' && VALID_RESOURCES.has(value as ResourceType);
}

/**
 * Fast deterministic integer hash for axial (q, r) coordinates.
 * Guarantees the exact same terrain every time for a given hex without Math.random().
 */
function hashAxial(q: number, r: number): number {
  let h = Math.imul(q, 374761393) + Math.imul(r, 668265263);
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177);
  h = h ^ (h >>> 16);
  return h >>> 0;
}

/**
 * Deterministic axial terrain lookup.
 * Produces natural-looking biome clusters beyond the starter island while
 * preserving exact coherence on the handcrafted starter island.
 */
export function getTerrainForHex(q: number, r: number): TerrainType {
  const key = hexKey(q, r);
  const starter = STARTER_TERRAIN_OVERRIDES[key];
  if (starter) {
    return starter;
  }

  // Smooth pseudo-biome signal using coarse 2x2 axial cells + per-hex hash variation
  const cq = Math.floor(q / 2);
  const cr = Math.floor(r / 2);
  const regionRoll = (hashAxial(cq + 19, cr - 23) % 100) / 100;
  const localRoll = (hashAxial(q, r) % 100) / 100;
  const blended = regionRoll * 0.55 + localRoll * 0.45;

  if (blended < 0.24) return 'water';
  if (blended < 0.44) return 'plains';
  if (blended < 0.65) return 'forest';
  if (blended < 0.84) return 'fertile';
  return 'mountain';
}

export function getResourceForTerrain(
  terrainType: TerrainType
): TerrainResourceInfo {
  const meta = TERRAIN_METADATA[terrainType];
  return {
    resourceType: meta.resourceType,
    resourceAmount: meta.resourceAmount,
  };
}

export function describeTerrain(terrainType: TerrainType): TerrainDescriptor {
  return {
    type: terrainType,
    ...TERRAIN_METADATA[terrainType],
  };
}

/**
 * Resolves the persistent terrain and resource data for any PlacedHex or coordinate.
 */
export function getHexTerrainAndResource(
  q: number,
  r: number,
  tile?: Pick<PlacedHex, 'terrainType' | 'resourceType' | 'resourceAmount'> | null
): {
  terrainType: TerrainType;
  resourceType: ResourceType;
  resourceAmount: number;
} {
  const terrainType = isValidTerrainType(tile?.terrainType)
    ? tile.terrainType
    : getTerrainForHex(q, r);
  const fallbackRes = getResourceForTerrain(terrainType);
  const resourceType = isValidResourceType(tile?.resourceType)
    ? tile.resourceType
    : fallbackRes.resourceType;
  const resourceAmount =
    typeof tile?.resourceAmount === 'number' && Number.isFinite(tile.resourceAmount)
      ? Math.max(0, Math.round(tile.resourceAmount))
      : fallbackRes.resourceAmount;

  return {
    terrainType,
    resourceType,
    resourceAmount,
  };
}

/**
 * Returns the required terrain type for structures with terrain restrictions,
 * or null if the structure can be placed on any terrain.
 *
 * Current validated restrictions:
 * - Fazenda (`building-farm`)   -> somente Terra fértil (`fertile`)
 * - Mina (`building-mine`)      -> somente Montanha (`mountain`)
 * - Serraria (`dirt-lumber`)    -> somente Floresta (`forest`)
 */
export function getStructureRequiredTerrain(
  structure: Pick<HexAssetEntry, 'name'> | string
): TerrainType | null {
  const name = typeof structure === 'string' ? structure : structure.name;
  switch (name) {
    case 'building-farm':
      return 'fertile';
    case 'building-mine':
      return 'mountain';
    case 'dirt-lumber':
      return 'forest';
    default:
      return null;
  }
}

export function canBuildStructureOnTerrain(
  structure: Pick<HexAssetEntry, 'name'> | string,
  terrainType: TerrainType
): boolean {
  const required = getStructureRequiredTerrain(structure);
  if (!required) return true;
  return required === terrainType;
}

export function getStructureDisplayInfo(assetName: string): {
  labelPt: string;
  requiredTerrain: TerrainType | null;
} {
  switch (assetName) {
    case 'building-farm':
      return { labelPt: 'Fazenda', requiredTerrain: 'fertile' };
    case 'building-mine':
      return { labelPt: 'Mina', requiredTerrain: 'mountain' };
    case 'dirt-lumber':
      return { labelPt: 'Serraria', requiredTerrain: 'forest' };
    default:
      return { labelPt: '', requiredTerrain: null };
  }
}

/**
 * Aggregates resources strictly across hexes owned by the player.
 * Neutral hexes never contribute to player resources.
 */
export function calculatePlayerResources(
  state: HexWorldState
): PlayerResourceSummary {
  const summary: PlayerResourceSummary = {
    wood: 0,
    ore: 0,
    food: 0,
    water: 0,
  };

  for (const tile of Object.values(state.hexes)) {
    if (tile.owner !== 'player') continue;
    const info = getHexTerrainAndResource(tile.q, tile.r, tile);
    if (info.resourceType === 'wood') summary.wood += info.resourceAmount;
    else if (info.resourceType === 'ore') summary.ore += info.resourceAmount;
    else if (info.resourceType === 'food') summary.food += info.resourceAmount;
    else if (info.resourceType === 'water') summary.water += info.resourceAmount;
  }

  return summary;
}
