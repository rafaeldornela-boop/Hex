import type { HexAssetEntry } from './godot-docs';
import { hexKey, type HexWorldState, type PlacedHex } from './hex-engine';

export type TerrainType = 'plains' | 'forest' | 'mountain' | 'water' | 'fertile';

export type ResourceType = 'none' | 'wood' | 'ore' | 'food' | 'water';

export type MountainDepositType = 'ore' | 'stone' | 'mixed';

export interface TerrainResourceInfo {
  resourceType: ResourceType;
  resourceAmount: number;
}

export interface TerrainDescriptor {
  type: TerrainType;
  labelPt: string;
  potentialPt: string;
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

export const DEFAULT_FOREST_WOOD_STOCK = 120;
export const DEFAULT_FOREST_DEPLETION_THRESHOLD = 0;
export const DEPLETED_FOREST_ASSET_NAME = 'dirt-lumber';

export function resolveTerrainTypeFromAssetName(assetName: string): TerrainType | null {
  if (assetName === 'dirt') return 'fertile';
  if (assetName === 'grass' || assetName === 'grass-hill') return 'plains';
  if (assetName === 'grass-forest' || assetName === 'dirt-lumber') return 'forest';
  if (assetName.startsWith('stone-') || assetName === 'stone') return 'mountain';
  if (assetName.startsWith('water-') || assetName === 'water') return 'water';
  return null;
}

export const TERRAIN_METADATA: Record<
  TerrainType,
  Omit<TerrainDescriptor, 'type'>
> = {
  plains: {
    labelPt: 'Planície',
    potentialPt: 'Moradia, Comércio e Apoio',
    resourceType: 'none',
    resourceLabelPt: 'Nenhum',
    resourceAmount: 0,
    defaultAssetName: 'grass',
  },
  forest: {
    labelPt: 'Floresta',
    potentialPt: 'Madeira (Serraria)',
    resourceType: 'wood',
    resourceLabelPt: 'Madeira',
    resourceAmount: 10,
    defaultAssetName: 'grass-forest',
  },
  mountain: {
    labelPt: 'Montanha',
    potentialPt: 'Minério e Pedra (Mina / Fundição)',
    resourceType: 'ore',
    resourceLabelPt: 'Minério',
    resourceAmount: 10,
    defaultAssetName: 'stone-mountain',
  },
  fertile: {
    labelPt: 'Terra fértil',
    potentialPt: 'Alimento (Fazenda / Moinho)',
    resourceType: 'food',
    resourceLabelPt: 'Alimento',
    resourceAmount: 10,
    defaultAssetName: 'dirt',
  },
  water: {
    labelPt: 'Água',
    potentialPt: 'Pesca e Comércio (Doca / Porto)',
    resourceType: 'water',
    resourceLabelPt: 'Água / Pesca',
    resourceAmount: 10,
    defaultAssetName: 'water',
  },
};

export const NATURAL_TERRAIN_ASSET_NAMES = new Set<string>([
  'grass',
  'grass-forest',
  'grass-hill',
  'dirt',
  'stone',
  'stone-hill',
  'stone-mountain',
  'stone-rocks',
  'sand',
  'sand-desert',
  'sand-rocks',
  'water',
  'water-island',
  'water-rocks',
]);

export function isNaturalTerrainAssetName(assetName: string): boolean {
  return NATURAL_TERRAIN_ASSET_NAMES.has(assetName);
}

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
    case 'building-port':
    case 'building-dock':
    case 'building-watermill':
      return 'water';
    default:
      return null;
  }
}

export function canBuildStructureOnTerrain(
  structure: Pick<HexAssetEntry, 'name'> | string,
  terrainType: TerrainType
): boolean {
  const name = typeof structure === 'string' ? structure : structure.name;
  if (isNaturalTerrainAssetName(name)) return false;
  if (name === 'building-farm') {
    return terrainType === 'fertile' || terrainType === 'plains';
  }
  if (name === 'building-dock' || name === 'building-watermill') {
    return terrainType === 'water' || terrainType === 'plains' || terrainType === 'fertile';
  }
  const required = getStructureRequiredTerrain(name);
  if (!required) return true;
  return required === terrainType;
}

const VALID_MOUNTAIN_DEPOSITS = new Set<MountainDepositType>(['ore', 'stone', 'mixed']);

export function isValidMountainDepositType(value: unknown): value is MountainDepositType {
  return typeof value === 'string' && VALID_MOUNTAIN_DEPOSITS.has(value as MountainDepositType);
}

/**
 * Differentiates Stone vs Ore vs Mixed deposits on mountain hexes without creating
 * additional economic TerrainType categories.
 */
export function getMountainDepositType(
  q: number,
  r: number,
  tile?: Pick<PlacedHex, 'terrainType' | 'resourceType' | 'resourceAmount' | 'rareFeature' | 'mountainDeposit' | 'structureIndex'> | null,
  assets?: HexAssetEntry[]
): MountainDepositType {
  const terrain = isValidTerrainType(tile?.terrainType)
    ? tile.terrainType
    : getTerrainForHex(q, r);
  if (terrain !== 'mountain') return 'mixed';

  if (isValidMountainDepositType(tile?.mountainDeposit)) {
    return tile.mountainDeposit;
  }

  if (tile?.rareFeature === 'pure_iron' || tile?.rareFeature === 'gold_vein') {
    return 'ore';
  }

  const assetName =
    tile && assets && typeof tile.structureIndex === 'number'
      ? assets[tile.structureIndex]?.name ?? ''
      : '';
  if (assetName === 'stone-rocks' || assetName === 'stone-hill' || assetName === 'stone') {
    return 'stone';
  }
  if (assetName === 'stone-mountain') {
    return 'ore';
  }

  return 'mixed';
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
    case 'building-port':
      return { labelPt: 'Porto', requiredTerrain: 'water' };
    case 'building-dock':
      return { labelPt: 'Doca de Pesca', requiredTerrain: 'water' };
    case 'building-watermill':
      return { labelPt: 'Moinho Fluvial', requiredTerrain: 'water' };
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
    if (info.resourceType === 'wood') {
      if (!tile.forestDepleted) summary.wood += info.resourceAmount;
    }
    else if (info.resourceType === 'ore') summary.ore += info.resourceAmount;
    else if (info.resourceType === 'food') summary.food += info.resourceAmount;
    else if (info.resourceType === 'water') summary.water += info.resourceAmount;
  }

  return summary;
}

export type RareFeatureType =
  | 'none'
  | 'gold_vein'
  | 'pure_iron'
  | 'arcane_crystal'
  | 'rich_soil'
  | 'natural_harbor';

const VALID_RARE_FEATURES = new Set<RareFeatureType>([
  'none',
  'gold_vein',
  'pure_iron',
  'arcane_crystal',
  'rich_soil',
  'natural_harbor',
]);

export function isValidRareFeatureType(value: unknown): value is RareFeatureType {
  return typeof value === 'string' && VALID_RARE_FEATURES.has(value as RareFeatureType);
}

export interface StrategicRegionInfo {
  rareFeature: RareFeatureType;
  labelPt: string | null;
  bonusGoldPerTurn: number;
  bonusSciencePerTurn: number;
  bonusOrePerTurn: number;
  bonusFoodPerTurn: number;
  defenseBonus: number;
  expansionInfluenceMod: number;
  expansionExtraTurns: number;
}

export function getTerrainDefenseBonus(terrainType: TerrainType): number {
  switch (terrainType) {
    case 'mountain':
      return 4;
    case 'forest':
      return 2;
    case 'water':
      return 1;
    case 'fertile':
    case 'plains':
    default:
      return 0;
  }
}

/**
 * Resolves strategic region / rare resource info.
 * Uses persisted `tile.rareFeature` when present (for procedural worlds), or
 * falls back to deterministic axial lookup for legacy starter tiles.
 */
export function getStrategicRegionInfo(
  q: number,
  r: number,
  tile?: Pick<PlacedHex, 'terrainType' | 'resourceType' | 'resourceAmount' | 'rareFeature'> | null
): StrategicRegionInfo {
  const terrain = isValidTerrainType(tile?.terrainType)
    ? tile.terrainType
    : getTerrainForHex(q, r);
  const baseDefense = getTerrainDefenseBonus(terrain);

  let feature: RareFeatureType = 'none';
  if (tile !== undefined && tile !== null) {
    if (isValidRareFeatureType(tile.rareFeature)) {
      feature = tile.rareFeature;
    }
  } else {
    const dist = Math.max(Math.abs(q), Math.abs(r), Math.abs(-q - r));
    if (dist <= 1) {
      return {
        rareFeature: 'none',
        labelPt: null,
        bonusGoldPerTurn: 0,
        bonusSciencePerTurn: 0,
        bonusOrePerTurn: 0,
        bonusFoodPerTurn: 0,
        defenseBonus: baseDefense,
        expansionInfluenceMod: 0,
        expansionExtraTurns: 0,
      };
    }

    const key = hexKey(q, r);
    if (key === '0,2' || key === '-2,2') feature = 'pure_iron';
    else if (key === '2,-2') feature = 'rich_soil';
    else if (key === '2,-1' || key === '-1,2') feature = 'arcane_crystal';
    else if (key === '0,-3') feature = 'natural_harbor';
    else if (key === '3,-1' || key === '-3,2') feature = 'gold_vein';
    else {
      const roll = hashAxial(q + 71, r - 43) % 24;
      if (terrain === 'mountain' && roll <= 3) feature = 'pure_iron';
      else if (terrain === 'mountain' && roll === 4) feature = 'gold_vein';
      else if (terrain === 'fertile' && roll <= 2) feature = 'rich_soil';
      else if (terrain === 'water' && roll <= 1) feature = 'natural_harbor';
      else if ((terrain === 'forest' || terrain === 'plains') && roll === 5) {
        feature = 'arcane_crystal';
      }
    }
  }

  switch (feature) {
    case 'gold_vein':
      return {
        rareFeature: 'gold_vein',
        labelPt: 'Veio de Ouro',
        bonusGoldPerTurn: 18,
        bonusSciencePerTurn: 0,
        bonusOrePerTurn: 0,
        bonusFoodPerTurn: 0,
        defenseBonus: baseDefense,
        expansionInfluenceMod: 3,
        expansionExtraTurns: 1,
      };
    case 'pure_iron':
      return {
        rareFeature: 'pure_iron',
        labelPt: 'Ferro Puro',
        bonusGoldPerTurn: 0,
        bonusSciencePerTurn: 0,
        bonusOrePerTurn: 4,
        bonusFoodPerTurn: 0,
        defenseBonus: baseDefense + 1,
        expansionInfluenceMod: 3,
        expansionExtraTurns: 1,
      };
    case 'arcane_crystal':
      return {
        rareFeature: 'arcane_crystal',
        labelPt: 'Cristal Arcano',
        bonusGoldPerTurn: 0,
        bonusSciencePerTurn: 4,
        bonusOrePerTurn: 0,
        bonusFoodPerTurn: 0,
        defenseBonus: baseDefense,
        expansionInfluenceMod: 3,
        expansionExtraTurns: 1,
      };
    case 'rich_soil':
      return {
        rareFeature: 'rich_soil',
        labelPt: 'Solo Abundante',
        bonusGoldPerTurn: 0,
        bonusSciencePerTurn: 0,
        bonusOrePerTurn: 0,
        bonusFoodPerTurn: 4,
        defenseBonus: baseDefense,
        expansionInfluenceMod: 2,
        expansionExtraTurns: 1,
      };
    case 'natural_harbor':
      return {
        rareFeature: 'natural_harbor',
        labelPt: 'Baía Estratégica',
        bonusGoldPerTurn: 12,
        bonusSciencePerTurn: 0,
        bonusOrePerTurn: 0,
        bonusFoodPerTurn: 2,
        defenseBonus: baseDefense,
        expansionInfluenceMod: 2,
        expansionExtraTurns: 1,
      };
    default:
      return {
        rareFeature: 'none',
        labelPt: null,
        bonusGoldPerTurn: 0,
        bonusSciencePerTurn: 0,
        bonusOrePerTurn: 0,
        bonusFoodPerTurn: 0,
        defenseBonus: baseDefense,
        expansionInfluenceMod: 0,
        expansionExtraTurns: 0,
      };
  }
}

