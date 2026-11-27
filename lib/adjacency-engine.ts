import type { HexAssetEntry } from './godot-docs';
import { getBuildingDefinition } from './buildings-catalog';
import {
  hexKey,
  hasHexConstruction,
  type AxialCoord,
  type HexOwner,
  type HexWorldState,
  type PlacedHex,
} from './hex-engine';
import {
  DEFAULT_FOREST_DEPLETION_THRESHOLD,
  DEFAULT_FOREST_WOOD_STOCK,
  DEPLETED_FOREST_ASSET_NAME,
  TERRAIN_METADATA,
  getHexTerrainAndResource,
  getMountainDepositType,
  type MountainDepositType,
  type TerrainType,
} from './terrain-engine';
import { AXIAL_DIRECTIONS, axialDistance, getAxialNeighbors } from './territory-engine';

export type PoolKind =
  | 'hunting'
  | 'fishing'
  | 'pasture'
  | 'workers'
  | 'grain'
  | 'timber'
  | 'commerce';

export type PoolSharingMode = 'proportional_demand' | 'equal_split';

export interface AdjacencyPoolConfig {
  sharingMode: PoolSharingMode;
  forest: {
    initialWoodStock: number;
    woodDepletionThreshold: number;
    huntingBaseCapacity: number;
    huntingPerNeighborBonus: number;
    huntingMaxNeighborBonus: number;
    depletedHuntingCapacity: number;
  };
  water: {
    fishingBaseCapacity: number;
    fishingPerNeighborBonus: number;
    fishingMaxNeighborBonus: number;
    irrigationPerWaterNeighbor: number;
    irrigationMaxPerFertileHex: number;
  };
  plains: {
    pastureBaseCapacity: number;
    pasturePerNeighborBonus: number;
    pastureMaxNeighborBonus: number;
  };
  village: {
    workersSuppliedPerPopulation: number;
    huntingDemandPerPopulation: number;
    fishingDemandPerPopulation: number;
    pastureDemandPerPopulation: number;
  };
  dock: {
    fishingDemand: number;
  };
  sheep: {
    pastureDemand: number;
    manureFeedBonusFromFarm: number;
    predationPenaltyPerForest: number;
    predationMaxPenalty: number;
  };
  farm: {
    plainsEfficiencyMultiplier: number;
    irrigationBonusPerWaterUnit: number;
    irrigationMaxBonus: number;
    manureBonusFromCurral: number;
    villageMarketEfficiencyPerNeighbor: number;
    villageMarketMaxBonus: number;
  };
  mill: {
    millGrainCapacity: number;
    millFoodMultiplier: number;
    millGoldPerGrain: number;
    watermillGrainCapacity: number;
    watermillFoodMultiplier: number;
    watermillGoldPerGrain: number;
    villageMarketEfficiencyPerNeighbor: number;
    villageMarketMaxBonus: number;
  };
  lumber: {
    timberInputPerTurn: number;
  };
  mine: {
    stoneDepositOutput: { stone: number; ore: number };
    oreDepositOutput: { stone: number; ore: number };
    mixedDepositOutput: { stone: number; ore: number };
    forestShoringBonusPerForest: number;
    forestShoringMaxBonus: number;
  };
  smelter: {
    woodFuelPerTurn: number;
    kingdomWoodFallbackPerTurn: number;
    forestFuelBonus: number;
  };
  penalties: {
    mineDustOnFarmPerNeighbor: number;
    mineDustMax: number;
    smelterSmokeOnFarmPerNeighbor: number;
    smelterSmokeMax: number;
    forestShadeOnFarmPerNeighbor: number;
    forestShadeMax: number;
    smelterSmokeOnCurralPerNeighbor: number;
    smelterSmokeMaxOnCurral: number;
    mineContaminationOnWaterPerNeighbor: number;
    mineContaminationMax: number;
    smelterPollutionOnWaterPerNeighbor: number;
    smelterPollutionMax: number;
    waterPollutionMaxTotal: number;
    smelterPollutionOnVillagePerNeighbor: number;
    smelterPollutionMaxOnVillage: number;
  };
  commerce: {
    baseOperatingGold: number;
    producerTradeValue: number;
    processedProducerMultiplier: number;
    duplicateProductWeight: number;
    varietyBonusPerExtraType: number;
    varietyMaxBonus: number;
    villageDemandWeight: number;
    housingDemandWeight: number;
    maxCommercialGoldBonus: number;
  };
}

export type AdjacencyPoolConfigOverrides = {
  sharingMode?: PoolSharingMode;
  forest?: Partial<AdjacencyPoolConfig['forest']>;
  water?: Partial<AdjacencyPoolConfig['water']>;
  plains?: Partial<AdjacencyPoolConfig['plains']>;
  village?: Partial<AdjacencyPoolConfig['village']>;
  dock?: Partial<AdjacencyPoolConfig['dock']>;
  sheep?: Partial<AdjacencyPoolConfig['sheep']>;
  farm?: Partial<AdjacencyPoolConfig['farm']>;
  mill?: Partial<AdjacencyPoolConfig['mill']>;
  lumber?: Partial<AdjacencyPoolConfig['lumber']>;
  mine?: Partial<AdjacencyPoolConfig['mine']>;
  smelter?: Partial<AdjacencyPoolConfig['smelter']>;
  penalties?: Partial<AdjacencyPoolConfig['penalties']>;
  commerce?: Partial<AdjacencyPoolConfig['commerce']>;
};

export const DEFAULT_ADJACENCY_CONFIG: AdjacencyPoolConfig = {
  sharingMode: 'proportional_demand',
  forest: {
    initialWoodStock: DEFAULT_FOREST_WOOD_STOCK,
    woodDepletionThreshold: DEFAULT_FOREST_DEPLETION_THRESHOLD,
    huntingBaseCapacity: 4,
    huntingPerNeighborBonus: 2,
    huntingMaxNeighborBonus: 6,
    depletedHuntingCapacity: 0,
  },
  water: {
    fishingBaseCapacity: 4,
    fishingPerNeighborBonus: 2,
    fishingMaxNeighborBonus: 6,
    irrigationPerWaterNeighbor: 3,
    irrigationMaxPerFertileHex: 9,
  },
  plains: {
    pastureBaseCapacity: 3,
    pasturePerNeighborBonus: 2,
    pastureMaxNeighborBonus: 6,
  },
  village: {
    workersSuppliedPerPopulation: 1,
    huntingDemandPerPopulation: 1,
    fishingDemandPerPopulation: 1,
    pastureDemandPerPopulation: 1,
  },
  dock: {
    fishingDemand: 6,
  },
  sheep: {
    pastureDemand: 4,
    manureFeedBonusFromFarm: 0.2,
    predationPenaltyPerForest: 0.25,
    predationMaxPenalty: 0.5,
  },
  farm: {
    plainsEfficiencyMultiplier: 0.68,
    irrigationBonusPerWaterUnit: 0.05,
    irrigationMaxBonus: 0.3,
    manureBonusFromCurral: 0.15,
    villageMarketEfficiencyPerNeighbor: 0.1,
    villageMarketMaxBonus: 0.2,
  },
  mill: {
    millGrainCapacity: 6,
    millFoodMultiplier: 1.5,
    millGoldPerGrain: 1.0,
    watermillGrainCapacity: 10,
    watermillFoodMultiplier: 1.65,
    watermillGoldPerGrain: 1.2,
    villageMarketEfficiencyPerNeighbor: 0.12,
    villageMarketMaxBonus: 0.24,
  },
  lumber: {
    timberInputPerTurn: 4,
  },
  mine: {
    stoneDepositOutput: { stone: 8, ore: 0 },
    oreDepositOutput: { stone: 1, ore: 9 },
    mixedDepositOutput: { stone: 4, ore: 7 },
    forestShoringBonusPerForest: 0.15,
    forestShoringMaxBonus: 0.25,
  },
  smelter: {
    woodFuelPerTurn: 2,
    kingdomWoodFallbackPerTurn: 1,
    forestFuelBonus: 0.15,
  },
  penalties: {
    mineDustOnFarmPerNeighbor: 0.1,
    mineDustMax: 0.2,
    smelterSmokeOnFarmPerNeighbor: 0.2,
    smelterSmokeMax: 0.35,
    forestShadeOnFarmPerNeighbor: 0.08,
    forestShadeMax: 0.2,
    smelterSmokeOnCurralPerNeighbor: 0.2,
    smelterSmokeMaxOnCurral: 0.35,
    mineContaminationOnWaterPerNeighbor: 0.25,
    mineContaminationMax: 0.5,
    smelterPollutionOnWaterPerNeighbor: 0.3,
    smelterPollutionMax: 0.6,
    waterPollutionMaxTotal: 0.75,
    smelterPollutionOnVillagePerNeighbor: 0.1,
    smelterPollutionMaxOnVillage: 0.25,
  },
  commerce: {
    baseOperatingGold: 10,
    producerTradeValue: 8,
    processedProducerMultiplier: 1.25,
    duplicateProductWeight: 0.4,
    varietyBonusPerExtraType: 0.25,
    varietyMaxBonus: 0.75,
    villageDemandWeight: 1.0,
    housingDemandWeight: 0.5,
    maxCommercialGoldBonus: 28,
  },
};

export function resolveAdjacencyConfig(
  overrides?: AdjacencyPoolConfigOverrides
): AdjacencyPoolConfig {
  if (!overrides) return DEFAULT_ADJACENCY_CONFIG;
  return {
    sharingMode: overrides.sharingMode ?? DEFAULT_ADJACENCY_CONFIG.sharingMode,
    forest: {
      ...DEFAULT_ADJACENCY_CONFIG.forest,
      ...(overrides.forest ?? {}),
    },
    water: {
      ...DEFAULT_ADJACENCY_CONFIG.water,
      ...(overrides.water ?? {}),
    },
    plains: {
      ...DEFAULT_ADJACENCY_CONFIG.plains,
      ...(overrides.plains ?? {}),
    },
    village: {
      ...DEFAULT_ADJACENCY_CONFIG.village,
      ...(overrides.village ?? {}),
    },
    dock: {
      ...DEFAULT_ADJACENCY_CONFIG.dock,
      ...(overrides.dock ?? {}),
    },
    sheep: {
      ...DEFAULT_ADJACENCY_CONFIG.sheep,
      ...(overrides.sheep ?? {}),
    },
    farm: {
      ...DEFAULT_ADJACENCY_CONFIG.farm,
      ...(overrides.farm ?? {}),
    },
    mill: {
      ...DEFAULT_ADJACENCY_CONFIG.mill,
      ...(overrides.mill ?? {}),
    },
    lumber: {
      ...DEFAULT_ADJACENCY_CONFIG.lumber,
      ...(overrides.lumber ?? {}),
    },
    mine: {
      ...DEFAULT_ADJACENCY_CONFIG.mine,
      ...(overrides.mine ?? {}),
    },
    smelter: {
      ...DEFAULT_ADJACENCY_CONFIG.smelter,
      ...(overrides.smelter ?? {}),
    },
    penalties: {
      ...DEFAULT_ADJACENCY_CONFIG.penalties,
      ...(overrides.penalties ?? {}),
    },
    commerce: {
      ...DEFAULT_ADJACENCY_CONFIG.commerce,
      ...(overrides.commerce ?? {}),
    },
  };
}

export interface HexNeighborSnapshot {
  coord: AxialCoord;
  key: string;
  directionIndex: number;
  exists: boolean;
  tile: PlacedHex | undefined;
  owner: HexOwner;
  terrainType: TerrainType;
  assetName: string;
  hasConstruction: boolean;
  isCompleteBuilding: boolean;
  isForestDepleted: boolean;
}

export interface AdjacencyBonusRule {
  baseValue: number;
  perNeighborBonus: number;
  maxBonus: number;
  maxTotal?: number;
}

export interface AdjacencyBonusResult {
  matchingNeighborCount: number;
  matchingNeighborKeys: string[];
  baseValue: number;
  rawBonus: number;
  cappedBonus: number;
  totalValue: number;
  capReached: boolean;
}

function roundPoolValue(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 10000) / 10000;
}

function resolveTileOwner(tile: PlacedHex | undefined): HexOwner {
  if (typeof tile?.owner === 'string' && tile.owner.trim().length > 0) {
    return tile.owner.trim();
  }
  return 'neutral';
}

export function isForestDepleted(
  tile: Pick<PlacedHex, 'q' | 'r' | 'terrainType' | 'resourceType' | 'resourceAmount' | 'woodStock' | 'forestDepleted'> | null | undefined,
  config: AdjacencyPoolConfig = DEFAULT_ADJACENCY_CONFIG
): boolean {
  if (!tile) return false;
  const terrain = getHexTerrainAndResource(tile.q, tile.r, tile).terrainType;
  if (terrain !== 'forest') return false;
  if (tile.forestDepleted === true) return true;
  if (typeof tile.woodStock === 'number' && Number.isFinite(tile.woodStock)) {
    return tile.woodStock <= config.forest.woodDepletionThreshold;
  }
  return false;
}

export function getForestWoodStock(
  tile: Pick<PlacedHex, 'q' | 'r' | 'terrainType' | 'resourceType' | 'resourceAmount' | 'woodStock' | 'forestDepleted'> | null | undefined,
  config: AdjacencyPoolConfig = DEFAULT_ADJACENCY_CONFIG
): number {
  if (!tile) return 0;
  const terrain = getHexTerrainAndResource(tile.q, tile.r, tile).terrainType;
  if (terrain !== 'forest') return 0;
  if (tile.forestDepleted === true) {
    return typeof tile.woodStock === 'number' && Number.isFinite(tile.woodStock)
      ? Math.max(0, Math.min(config.forest.woodDepletionThreshold, Math.round(tile.woodStock)))
      : 0;
  }
  if (typeof tile.woodStock === 'number' && Number.isFinite(tile.woodStock)) {
    return Math.max(0, Math.round(tile.woodStock));
  }
  return config.forest.initialWoodStock;
}

/**
 * Central reusable neighbor lookup using the 6 real axial hexagonal directions.
 */
export function getHexNeighbors(
  worldState: HexWorldState,
  q: number,
  r: number,
  assets: HexAssetEntry[] = [],
  underConstructionKeys?: Set<string>,
  config: AdjacencyPoolConfig = DEFAULT_ADJACENCY_CONFIG
): HexNeighborSnapshot[] {
  const neighborCoords = getAxialNeighbors(q, r);
  const snapshots: HexNeighborSnapshot[] = [];

  for (let i = 0; i < AXIAL_DIRECTIONS.length; i++) {
    const coord = neighborCoords[i];
    const key = hexKey(coord.q, coord.r);
    const nTile = worldState.hexes[key];
    const exists = Boolean(nTile);
    const terrainType = getHexTerrainAndResource(coord.q, coord.r, nTile).terrainType;
    const depleted = isForestDepleted(nTile, config);
    const assetName = nTile
      ? (assets[nTile.structureIndex]?.name ??
          (depleted && terrainType === 'forest'
            ? DEPLETED_FOREST_ASSET_NAME
            : TERRAIN_METADATA[terrainType].defaultAssetName))
      : TERRAIN_METADATA[terrainType].defaultAssetName;
    const hasConstr =
      Boolean(nTile) && assets.length > 0 ? hasHexConstruction(nTile, assets) : false;
    const isCompleteBuilding = Boolean(nTile) && !underConstructionKeys?.has(key);

    snapshots.push({
      coord,
      key,
      directionIndex: i,
      exists,
      tile: nTile,
      owner: resolveTileOwner(nTile),
      terrainType,
      assetName,
      hasConstruction: hasConstr,
      isCompleteBuilding,
      isForestDepleted: depleted,
    });
  }

  return snapshots;
}

/**
 * Central reusable adjacency effect calculator with per-neighbor scaling and configurable cap.
 */
export function computeAdjacencyScaledEffect(
  neighbors: HexNeighborSnapshot[],
  predicate: (neighbor: HexNeighborSnapshot) => boolean,
  rule: AdjacencyBonusRule
): AdjacencyBonusResult {
  const matchingNeighborKeys: string[] = [];
  for (const neighbor of neighbors) {
    if (predicate(neighbor)) {
      matchingNeighborKeys.push(neighbor.key);
    }
  }

  const matchingNeighborCount = matchingNeighborKeys.length;
  const rawBonus = matchingNeighborCount * rule.perNeighborBonus;
  const cappedBonus = Math.min(rule.maxBonus, rawBonus);
  const rawTotal = rule.baseValue + cappedBonus;
  const totalValue =
    typeof rule.maxTotal === 'number'
      ? Math.min(rule.maxTotal, rawTotal)
      : rawTotal;
  const capReached =
    rawBonus >= rule.maxBonus ||
    (typeof rule.maxTotal === 'number' && rawTotal >= rule.maxTotal);

  return {
    matchingNeighborCount,
    matchingNeighborKeys,
    baseValue: rule.baseValue,
    rawBonus: roundPoolValue(rawBonus),
    cappedBonus: roundPoolValue(cappedBonus),
    totalValue: roundPoolValue(totalValue),
    capReached,
  };
}

export interface ForestTileStateReport {
  key: string;
  q: number;
  r: number;
  woodStock: number;
  maxWoodStock: number;
  depletionThreshold: number;
  isDepleted: boolean;
  assetName: string;
  huntingBaseCapacity: number;
  huntingAdjacencyBonus: number;
  huntingCapacity: number;
  activeForestNeighbors: number;
  huntingCapReached: boolean;
}

export function computeForestHuntingCapacity(
  worldState: HexWorldState,
  q: number,
  r: number,
  assets: HexAssetEntry[] = [],
  overrides?: AdjacencyPoolConfigOverrides
): ForestTileStateReport {
  const config = resolveAdjacencyConfig(overrides);
  const key = hexKey(q, r);
  const tile = worldState.hexes[key];
  const terrain = getHexTerrainAndResource(q, r, tile).terrainType;
  const woodStock = getForestWoodStock(tile, config);
  const depleted = isForestDepleted(tile, config);
  const hasConstr =
    Boolean(tile) && assets.length > 0 ? hasHexConstruction(tile, assets) : false;

  const assetName = tile
    ? (assets[tile.structureIndex]?.name ??
        (depleted ? DEPLETED_FOREST_ASSET_NAME : TERRAIN_METADATA.forest.defaultAssetName))
    : TERRAIN_METADATA.forest.defaultAssetName;

  if (!tile || terrain !== 'forest' || hasConstr) {
    return {
      key,
      q,
      r,
      woodStock: terrain === 'forest' ? woodStock : 0,
      maxWoodStock: config.forest.initialWoodStock,
      depletionThreshold: config.forest.woodDepletionThreshold,
      isDepleted: depleted,
      assetName,
      huntingBaseCapacity: 0,
      huntingAdjacencyBonus: 0,
      huntingCapacity: 0,
      activeForestNeighbors: 0,
      huntingCapReached: false,
    };
  }

  if (depleted) {
    return {
      key,
      q,
      r,
      woodStock,
      maxWoodStock: config.forest.initialWoodStock,
      depletionThreshold: config.forest.woodDepletionThreshold,
      isDepleted: true,
      assetName,
      huntingBaseCapacity: config.forest.depletedHuntingCapacity,
      huntingAdjacencyBonus: 0,
      huntingCapacity: config.forest.depletedHuntingCapacity,
      activeForestNeighbors: 0,
      huntingCapReached: false,
    };
  }

  const neighbors = getHexNeighbors(worldState, q, r, assets, undefined, config);
  const scaled = computeAdjacencyScaledEffect(
    neighbors,
    (n) =>
      n.exists &&
      n.terrainType === 'forest' &&
      !n.isForestDepleted &&
      !n.hasConstruction,
    {
      baseValue: config.forest.huntingBaseCapacity,
      perNeighborBonus: config.forest.huntingPerNeighborBonus,
      maxBonus: config.forest.huntingMaxNeighborBonus,
    }
  );

  return {
    key,
    q,
    r,
    woodStock,
    maxWoodStock: config.forest.initialWoodStock,
    depletionThreshold: config.forest.woodDepletionThreshold,
    isDepleted: false,
    assetName,
    huntingBaseCapacity: scaled.baseValue,
    huntingAdjacencyBonus: scaled.cappedBonus,
    huntingCapacity: scaled.totalValue,
    activeForestNeighbors: scaled.matchingNeighborCount,
    huntingCapReached: scaled.capReached,
  };
}

export function consumeForestWood(
  worldState: HexWorldState,
  q: number,
  r: number,
  amount: number,
  assets: HexAssetEntry[],
  overrides?: AdjacencyPoolConfigOverrides
): {
  nextState: HexWorldState;
  consumed: number;
  remainingStock: number;
  depletedNow: boolean;
  isDepleted: boolean;
  transitionedToAsset: string | null;
} {
  const config = resolveAdjacencyConfig(overrides);
  const key = hexKey(q, r);
  const tile = worldState.hexes[key];
  if (!tile) {
    return {
      nextState: worldState,
      consumed: 0,
      remainingStock: 0,
      depletedNow: false,
      isDepleted: false,
      transitionedToAsset: null,
    };
  }

  const terrain = getHexTerrainAndResource(q, r, tile).terrainType;
  if (terrain !== 'forest') {
    return {
      nextState: worldState,
      consumed: 0,
      remainingStock: 0,
      depletedNow: false,
      isDepleted: false,
      transitionedToAsset: null,
    };
  }

  const wasDepleted = isForestDepleted(tile, config);
  const currentStock = getForestWoodStock(tile, config);
  const safeAmount = Number.isFinite(amount) ? Math.max(0, Math.round(amount)) : 0;
  const consumed = wasDepleted ? 0 : Math.min(currentStock, safeAmount);
  const remainingStock = Math.max(0, currentStock - consumed);
  const nowDepleted = remainingStock <= config.forest.woodDepletionThreshold;

  const depletedAssetIndex = assets.findIndex(
    (a) => a.name === DEPLETED_FOREST_ASSET_NAME
  );
  const hadConstruction = hasHexConstruction(tile, assets);
  const shouldSwapVisual = nowDepleted && !hadConstruction && depletedAssetIndex >= 0;

  const nextTile: PlacedHex = {
    ...tile,
    woodStock: remainingStock,
    ...(nowDepleted && !hadConstruction ? { forestDepleted: true } : {}),
    ...(shouldSwapVisual ? { structureIndex: depletedAssetIndex } : {}),
  };

  return {
    nextState: {
      ...worldState,
      hexes: {
        ...worldState.hexes,
        [key]: nextTile,
      },
    },
    consumed,
    remainingStock,
    depletedNow: !wasDepleted && nowDepleted,
    isDepleted: nowDepleted,
    transitionedToAsset: shouldSwapVisual ? DEPLETED_FOREST_ASSET_NAME : null,
  };
}

export function syncForestDepletionState(
  worldState: HexWorldState,
  assets: HexAssetEntry[],
  overrides?: AdjacencyPoolConfigOverrides
): {
  nextState: HexWorldState;
  depletedKeys: string[];
} {
  const config = resolveAdjacencyConfig(overrides);
  const depletedAssetIndex = assets.findIndex(
    (a) => a.name === DEPLETED_FOREST_ASSET_NAME
  );
  const depletedKeys: string[] = [];
  let nextHexes: Record<string, PlacedHex> | null = null;

  for (const [key, tile] of Object.entries(worldState.hexes)) {
    const terrain = getHexTerrainAndResource(tile.q, tile.r, tile).terrainType;
    if (terrain !== 'forest') continue;

    const shouldBeDepleted = isForestDepleted(tile, config);
    if (!shouldBeDepleted) continue;

    const hasConstr = hasHexConstruction(tile, assets);
    const needsFlag = !hasConstr && tile.forestDepleted !== true;
    const needsVisual =
      !hasConstr && depletedAssetIndex >= 0 && tile.structureIndex !== depletedAssetIndex;
    const stock = getForestWoodStock(tile, config);
    const needsStockSync = tile.woodStock !== stock;

    if (needsFlag || needsVisual || needsStockSync) {
      if (!nextHexes) nextHexes = { ...worldState.hexes };
      nextHexes[key] = {
        ...tile,
        woodStock: stock,
        ...(!hasConstr ? { forestDepleted: true } : {}),
        ...(needsVisual ? { structureIndex: depletedAssetIndex } : {}),
      };
      if (needsFlag || needsVisual) {
        depletedKeys.push(key);
      }
    }
  }

  return {
    nextState: nextHexes ? { ...worldState, hexes: nextHexes } : worldState,
    depletedKeys,
  };
}

export interface WaterFishingCapacityReport {
  key: string;
  q: number;
  r: number;
  baseCapacity: number;
  adjacencyBonus: number;
  rawCapacity: number;
  pollutionPenaltyPct: number;
  totalCapacity: number;
  waterNeighbors: number;
  capReached: boolean;
}

export function computeWaterFishingCapacity(
  worldState: HexWorldState,
  q: number,
  r: number,
  assets: HexAssetEntry[] = [],
  overrides?: AdjacencyPoolConfigOverrides,
  underConstructionKeys?: Set<string>
): WaterFishingCapacityReport {
  const config = resolveAdjacencyConfig(overrides);
  const key = hexKey(q, r);
  const tile = worldState.hexes[key];
  const terrain = getHexTerrainAndResource(q, r, tile).terrainType;

  if (!tile || terrain !== 'water') {
    return {
      key,
      q,
      r,
      baseCapacity: 0,
      adjacencyBonus: 0,
      rawCapacity: 0,
      pollutionPenaltyPct: 0,
      totalCapacity: 0,
      waterNeighbors: 0,
      capReached: false,
    };
  }

  const neighbors = getHexNeighbors(
    worldState,
    q,
    r,
    assets,
    underConstructionKeys,
    config
  );
  const scaled = computeAdjacencyScaledEffect(
    neighbors,
    (n) => n.exists && n.terrainType === 'water',
    {
      baseValue: config.water.fishingBaseCapacity,
      perNeighborBonus: config.water.fishingPerNeighborBonus,
      maxBonus: config.water.fishingMaxNeighborBonus,
    }
  );

  const mineContam = computeAdjacencyScaledEffect(
    neighbors,
    (n) => n.exists && n.isCompleteBuilding && n.assetName === 'building-mine',
    {
      baseValue: 0,
      perNeighborBonus: config.penalties.mineContaminationOnWaterPerNeighbor,
      maxBonus: config.penalties.mineContaminationMax,
    }
  ).cappedBonus;

  const smelterPoll = computeAdjacencyScaledEffect(
    neighbors,
    (n) => n.exists && n.isCompleteBuilding && n.assetName === 'building-smelter',
    {
      baseValue: 0,
      perNeighborBonus: config.penalties.smelterPollutionOnWaterPerNeighbor,
      maxBonus: config.penalties.smelterPollutionMax,
    }
  ).cappedBonus;

  const totalPollution = Math.min(
    config.penalties.waterPollutionMaxTotal,
    mineContam + smelterPoll
  );
  const effectiveCapacity = roundPoolValue(
    scaled.totalValue * Math.max(0, 1 - totalPollution)
  );

  return {
    key,
    q,
    r,
    baseCapacity: scaled.baseValue,
    adjacencyBonus: scaled.cappedBonus,
    rawCapacity: scaled.totalValue,
    pollutionPenaltyPct: Math.round(totalPollution * 100),
    totalCapacity: effectiveCapacity,
    waterNeighbors: scaled.matchingNeighborCount,
    capReached: scaled.capReached,
  };
}

export interface FertileIrrigationReport {
  key: string;
  q: number;
  r: number;
  isFertile: boolean;
  isIrrigated: boolean;
  waterNeighborCount: number;
  waterNeighborKeys: string[];
  irrigationCapacity: number;
  maxCap: number;
  capReached: boolean;
}

export function computeFertileIrrigation(
  worldState: HexWorldState,
  q: number,
  r: number,
  assets: HexAssetEntry[] = [],
  overrides?: AdjacencyPoolConfigOverrides
): FertileIrrigationReport {
  const config = resolveAdjacencyConfig(overrides);
  const key = hexKey(q, r);
  const tile = worldState.hexes[key];
  const terrain = getHexTerrainAndResource(q, r, tile).terrainType;

  if (!tile || terrain !== 'fertile') {
    return {
      key,
      q,
      r,
      isFertile: false,
      isIrrigated: false,
      waterNeighborCount: 0,
      waterNeighborKeys: [],
      irrigationCapacity: 0,
      maxCap: config.water.irrigationMaxPerFertileHex,
      capReached: false,
    };
  }

  const neighbors = getHexNeighbors(worldState, q, r, assets, undefined, config);
  const scaled = computeAdjacencyScaledEffect(
    neighbors,
    (n) => n.exists && n.terrainType === 'water',
    {
      baseValue: 0,
      perNeighborBonus: config.water.irrigationPerWaterNeighbor,
      maxBonus: config.water.irrigationMaxPerFertileHex,
      maxTotal: config.water.irrigationMaxPerFertileHex,
    }
  );

  return {
    key,
    q,
    r,
    isFertile: true,
    isIrrigated: scaled.totalValue > 0,
    waterNeighborCount: scaled.matchingNeighborCount,
    waterNeighborKeys: scaled.matchingNeighborKeys,
    irrigationCapacity: scaled.totalValue,
    maxCap: config.water.irrigationMaxPerFertileHex,
    capReached: scaled.capReached,
  };
}

export interface PlainsPastureCapacityReport {
  key: string;
  q: number;
  r: number;
  baseCapacity: number;
  adjacencyBonus: number;
  totalCapacity: number;
  plainsNeighbors: number;
  capReached: boolean;
}

export function computePlainsPastureCapacity(
  worldState: HexWorldState,
  q: number,
  r: number,
  assets: HexAssetEntry[] = [],
  overrides?: AdjacencyPoolConfigOverrides
): PlainsPastureCapacityReport {
  const config = resolveAdjacencyConfig(overrides);
  const key = hexKey(q, r);
  const tile = worldState.hexes[key];
  const terrain = getHexTerrainAndResource(q, r, tile).terrainType;
  const hasConstr =
    Boolean(tile) && assets.length > 0 ? hasHexConstruction(tile, assets) : false;

  if (!tile || terrain !== 'plains' || hasConstr) {
    return {
      key,
      q,
      r,
      baseCapacity: 0,
      adjacencyBonus: 0,
      totalCapacity: 0,
      plainsNeighbors: 0,
      capReached: false,
    };
  }

  const neighbors = getHexNeighbors(worldState, q, r, assets, undefined, config);
  const scaled = computeAdjacencyScaledEffect(
    neighbors,
    (n) => n.exists && n.terrainType === 'plains' && !n.hasConstruction,
    {
      baseValue: config.plains.pastureBaseCapacity,
      perNeighborBonus: config.plains.pasturePerNeighborBonus,
      maxBonus: config.plains.pastureMaxNeighborBonus,
    }
  );

  return {
    key,
    q,
    r,
    baseCapacity: scaled.baseValue,
    adjacencyBonus: scaled.cappedBonus,
    totalCapacity: scaled.totalValue,
    plainsNeighbors: scaled.matchingNeighborCount,
    capReached: scaled.capReached,
  };
}

export interface PoolProviderNode {
  key: string;
  baseCapacity: number;
  adjacencyBonus: number;
  totalCapacity: number;
}

export interface PoolConsumerNode {
  key: string;
  assetName: string;
  demand: number;
}

export interface PoolEdge {
  providerKey: string;
  consumerKey: string;
}

export interface PoolConsumerAllocation {
  consumerKey: string;
  assetName: string;
  demand: number;
  availableCapacity: number;
  allocated: number;
  fulfillmentRatio: number;
  providerKeys: string[];
  allocationsByProviderKey: Record<string, number>;
  sharedWithConsumerKeys: string[];
}

export interface PoolProviderAllocation {
  providerKey: string;
  baseCapacity: number;
  adjacencyBonus: number;
  totalCapacity: number;
  allocated: number;
  remaining: number;
  consumerKeys: string[];
  allocationsByConsumerKey: Record<string, number>;
}

export interface PoolCategorySummary {
  kind: PoolKind;
  totalCapacity: number;
  totalDemand: number;
  totalAllocated: number;
  providersByKey: Record<string, PoolProviderAllocation>;
  consumersByKey: Record<string, PoolConsumerAllocation>;
}

/**
 * Shared bipartite pool allocator supporting proportional-to-demand sharing and equal-split sharing.
 * Strictly conserves finite pool capacity across contested providers without ever inventing capacity.
 */
export function solveSharedPoolAllocations(params: {
  kind: PoolKind;
  providers: PoolProviderNode[];
  consumers: PoolConsumerNode[];
  edges: PoolEdge[];
  sharingMode?: PoolSharingMode;
}): PoolCategorySummary {
  const {
    kind,
    providers,
    consumers,
    edges,
    sharingMode = 'proportional_demand',
  } = params;

  const providerMap = new Map<string, PoolProviderNode>();
  for (const p of providers) {
    providerMap.set(p.key, {
      ...p,
      totalCapacity: Math.max(0, p.totalCapacity),
    });
  }

  const consumerMap = new Map<string, PoolConsumerNode>();
  for (const c of consumers) {
    consumerMap.set(c.key, {
      ...c,
      demand: Math.max(0, c.demand),
    });
  }

  const providersOfConsumer = new Map<string, string[]>();
  const consumersOfProvider = new Map<string, string[]>();
  const edgeSeen = new Set<string>();

  for (const e of edges) {
    if (!providerMap.has(e.providerKey) || !consumerMap.has(e.consumerKey)) continue;
    const ek = `${e.providerKey}->${e.consumerKey}`;
    if (edgeSeen.has(ek)) continue;
    edgeSeen.add(ek);

    const pList = providersOfConsumer.get(e.consumerKey) ?? [];
    pList.push(e.providerKey);
    providersOfConsumer.set(e.consumerKey, pList);

    const cList = consumersOfProvider.get(e.providerKey) ?? [];
    cList.push(e.consumerKey);
    consumersOfProvider.set(e.providerKey, cList);
  }

  const remainingCap = new Map<string, number>();
  for (const [k, p] of providerMap) {
    remainingCap.set(k, p.totalCapacity);
  }

  const remainingDemand = new Map<string, number>();
  for (const [k, c] of consumerMap) {
    remainingDemand.set(k, c.demand);
  }

  const edgeAlloc = new Map<string, number>();

  // Multi-pass proportional water-filling
  for (let pass = 0; pass < 8; pass++) {
    let progressed = false;

    // 1. Each consumer expresses weighted claims across connected providers with remaining capacity
    const claimsByProvider = new Map<string, Array<{ consumerKey: string; claim: number }>>();

    for (const [cKey, remDem] of remainingDemand) {
      if (remDem <= 1e-9) continue;
      const pKeys = providersOfConsumer.get(cKey) ?? [];
      let visibleCap = 0;
      for (const pKey of pKeys) {
        visibleCap += remainingCap.get(pKey) ?? 0;
      }
      if (visibleCap <= 1e-9) continue;

      for (const pKey of pKeys) {
        const pRem = remainingCap.get(pKey) ?? 0;
        if (pRem <= 1e-9) continue;
        const shareWeight = pRem / visibleCap;
        const claim =
          sharingMode === 'equal_split'
            ? Math.min(remDem, pRem)
            : remDem * shareWeight;
        const list = claimsByProvider.get(pKey) ?? [];
        list.push({ consumerKey: cKey, claim });
        claimsByProvider.set(pKey, list);
      }
    }

    // 2. Each provider allocates up to its remaining capacity proportionally to claims (or equally)
    for (const [pKey, claims] of claimsByProvider) {
      const pRem = remainingCap.get(pKey) ?? 0;
      if (pRem <= 1e-9 || claims.length === 0) continue;

      if (sharingMode === 'equal_split') {
        const equalTarget = pRem / claims.length;
        for (const { consumerKey } of claims) {
          const cRem = remainingDemand.get(consumerKey) ?? 0;
          const grant = Math.min(cRem, equalTarget, remainingCap.get(pKey) ?? 0);
          if (grant > 1e-9) {
            const ek = `${pKey}->${consumerKey}`;
            edgeAlloc.set(ek, (edgeAlloc.get(ek) ?? 0) + grant);
            remainingCap.set(pKey, (remainingCap.get(pKey) ?? 0) - grant);
            remainingDemand.set(consumerKey, cRem - grant);
            progressed = true;
          }
        }
      } else {
        let totalClaim = 0;
        for (const entry of claims) totalClaim += entry.claim;
        if (totalClaim <= 1e-9) continue;

        const scale = totalClaim > pRem ? pRem / totalClaim : 1;
        for (const { consumerKey, claim } of claims) {
          const cRem = remainingDemand.get(consumerKey) ?? 0;
          const grant = Math.min(cRem, claim * scale, remainingCap.get(pKey) ?? 0);
          if (grant > 1e-9) {
            const ek = `${pKey}->${consumerKey}`;
            edgeAlloc.set(ek, (edgeAlloc.get(ek) ?? 0) + grant);
            remainingCap.set(pKey, (remainingCap.get(pKey) ?? 0) - grant);
            remainingDemand.set(consumerKey, cRem - grant);
            progressed = true;
          }
        }
      }
    }

    if (!progressed) break;
  }

  const providersByKey: Record<string, PoolProviderAllocation> = {};
  let totalCapacity = 0;
  let totalAllocated = 0;

  for (const [pKey, p] of providerMap) {
    const cKeys = consumersOfProvider.get(pKey) ?? [];
    const allocationsByConsumerKey: Record<string, number> = {};
    let pAllocated = 0;
    for (const cKey of cKeys) {
      const val = roundPoolValue(edgeAlloc.get(`${pKey}->${cKey}`) ?? 0);
      allocationsByConsumerKey[cKey] = val;
      pAllocated += val;
    }
    pAllocated = roundPoolValue(Math.min(p.totalCapacity, pAllocated));
    totalCapacity += p.totalCapacity;
    totalAllocated += pAllocated;

    providersByKey[pKey] = {
      providerKey: pKey,
      baseCapacity: roundPoolValue(p.baseCapacity),
      adjacencyBonus: roundPoolValue(p.adjacencyBonus),
      totalCapacity: roundPoolValue(p.totalCapacity),
      allocated: pAllocated,
      remaining: roundPoolValue(Math.max(0, p.totalCapacity - pAllocated)),
      consumerKeys: [...cKeys],
      allocationsByConsumerKey,
    };
  }

  const consumersByKey: Record<string, PoolConsumerAllocation> = {};
  let totalDemand = 0;

  for (const [cKey, c] of consumerMap) {
    totalDemand += c.demand;
    const pKeys = providersOfConsumer.get(cKey) ?? [];
    const allocationsByProviderKey: Record<string, number> = {};
    const sharedWith = new Set<string>();
    let availableCapacity = 0;
    let allocated = 0;

    for (const pKey of pKeys) {
      const pNode = providerMap.get(pKey);
      if (pNode) availableCapacity += pNode.totalCapacity;
      const val = roundPoolValue(edgeAlloc.get(`${pKey}->${cKey}`) ?? 0);
      allocationsByProviderKey[pKey] = val;
      allocated += val;
      for (const peerKey of consumersOfProvider.get(pKey) ?? []) {
        if (peerKey !== cKey) sharedWith.add(peerKey);
      }
    }

    allocated = roundPoolValue(allocated);
    const fulfillmentRatio =
      c.demand > 0 ? roundPoolValue(Math.min(1, allocated / c.demand)) : 1;

    consumersByKey[cKey] = {
      consumerKey: cKey,
      assetName: c.assetName,
      demand: roundPoolValue(c.demand),
      availableCapacity: roundPoolValue(availableCapacity),
      allocated,
      fulfillmentRatio,
      providerKeys: [...pKeys],
      allocationsByProviderKey,
      sharedWithConsumerKeys: Array.from(sharedWith).sort(),
    };
  }

  return {
    kind,
    totalCapacity: roundPoolValue(totalCapacity),
    totalDemand: roundPoolValue(totalDemand),
    totalAllocated: roundPoolValue(totalAllocated),
    providersByKey,
    consumersByKey,
  };
}

export interface VillagePoolReport {
  key: string;
  q: number;
  r: number;
  population: number;
  pollutionPenaltyPct: number;
  workerSupply: number;
  workersSuppliedTotal: number;
  workerConsumersByKey: Record<string, number>;
  hunting: PoolConsumerAllocation | null;
  fishing: PoolConsumerAllocation | null;
  pasture: PoolConsumerAllocation | null;
}

export interface WorldAdjacencySummary {
  config: AdjacencyPoolConfig;
  hunting: PoolCategorySummary;
  fishing: PoolCategorySummary;
  pasture: PoolCategorySummary;
  workers: PoolCategorySummary;
  irrigationByKey: Record<string, FertileIrrigationReport>;
  forestsByKey: Record<string, ForestTileStateReport>;
  waterByKey: Record<string, WaterFishingCapacityReport>;
  villagesByKey: Record<string, VillagePoolReport>;
}

function getDefaultVillagePopulation(tile: PlacedHex): number {
  if (
    typeof tile.meta?.localPopulation === 'number' &&
    Number.isFinite(tile.meta.localPopulation)
  ) {
    return Math.max(1, tile.meta.localPopulation);
  }
  const baseHousing = getBuildingDefinition('building-village').housingCapacity; // 10
  const lv = typeof tile.level === 'number' && tile.level >= 2 ? Math.round(tile.level) : 1;
  const levelExtra = lv === 2 ? 6 : lv >= 3 ? 12 : 0;
  return baseHousing + levelExtra;
}

function isProviderAccessibleToConsumer(
  providerOwner: HexOwner,
  consumerOwner: HexOwner,
  ownerFilter?: HexOwner
): boolean {
  const effectiveOwner = ownerFilter ?? consumerOwner;
  return providerOwner === effectiveOwner || providerOwner === 'neutral';
}

/**
 * Evaluates the entire world's adjacency capacities, shared resource pools (hunting, fishing, pasture),
 * village worker supply pools, forest depletion states, and fertile irrigation in one unified pass.
 */
export function evaluateWorldAdjacencyPools(params: {
  worldState: HexWorldState;
  assets: HexAssetEntry[];
  owner?: HexOwner;
  underConstructionKeys?: Set<string>;
  villagePopulationsByKey?: Record<string, number>;
  structureWorkerDemandsByKey?: Record<string, number>;
  configOverrides?: AdjacencyPoolConfigOverrides;
}): WorldAdjacencySummary {
  const {
    worldState,
    assets,
    owner,
    underConstructionKeys,
    villagePopulationsByKey,
    structureWorkerDemandsByKey,
    configOverrides,
  } = params;

  const config = resolveAdjacencyConfig(configOverrides);

  const forestsByKey: Record<string, ForestTileStateReport> = {};
  const irrigationByKey: Record<string, FertileIrrigationReport> = {};
  const waterByKey: Record<string, WaterFishingCapacityReport> = {};

  const huntingProviders: PoolProviderNode[] = [];
  const fishingProviders: PoolProviderNode[] = [];
  const pastureProviders: PoolProviderNode[] = [];
  const workerProviders: PoolProviderNode[] = [];

  const huntingConsumers: PoolConsumerNode[] = [];
  const fishingConsumers: PoolConsumerNode[] = [];
  const pastureConsumers: PoolConsumerNode[] = [];
  const workerConsumers: PoolConsumerNode[] = [];

  const villageTiles: Array<{
    key: string;
    tile: PlacedHex;
    pop: number;
    pollutionPenalty: number;
    tileOwner: HexOwner;
  }> = [];
  const terrainProviderOwnerByKey = new Map<string, HexOwner>();

  let tiles: PlacedHex[];
  if (owner) {
    const relevantSet = new Set<string>();
    for (const tile of Object.values(worldState.hexes)) {
      if (tile.owner !== owner) continue;
      relevantSet.add(hexKey(tile.q, tile.r));
      for (const n of getAxialNeighbors(tile.q, tile.r)) {
        const nk = hexKey(n.q, n.r);
        if (worldState.hexes[nk]) {
          relevantSet.add(nk);
        }
      }
    }
    tiles = Array.from(relevantSet)
      .map((k) => worldState.hexes[k])
      .filter((t): t is PlacedHex => Boolean(t))
      .sort((a, b) => a.q - b.q || a.r - b.r);
  } else {
    tiles = Object.values(worldState.hexes).sort(
      (a, b) => a.q - b.q || a.r - b.r
    );
  }

  for (const tile of tiles) {
    const key = hexKey(tile.q, tile.r);
    const tileOwner = resolveTileOwner(tile);
    const terrain = getHexTerrainAndResource(tile.q, tile.r, tile).terrainType;
    const hasConstr = assets.length > 0 ? hasHexConstruction(tile, assets) : false;
    const isUnderConstr = Boolean(underConstructionKeys?.has(key));
    const assetName = assets[tile.structureIndex]?.name ?? '';

    if (terrain === 'forest') {
      const forestReport = computeForestHuntingCapacity(
        worldState,
        tile.q,
        tile.r,
        assets,
        configOverrides
      );
      forestsByKey[key] = forestReport;
      if (!hasConstr) {
        huntingProviders.push({
          key,
          baseCapacity: forestReport.huntingBaseCapacity,
          adjacencyBonus: forestReport.huntingAdjacencyBonus,
          totalCapacity: forestReport.huntingCapacity,
        });
        terrainProviderOwnerByKey.set(key, tileOwner);
      }
    } else if (terrain === 'water') {
      const waterReport = computeWaterFishingCapacity(
        worldState,
        tile.q,
        tile.r,
        assets,
        configOverrides,
        underConstructionKeys
      );
      waterByKey[key] = waterReport;
      fishingProviders.push({
        key,
        baseCapacity: waterReport.baseCapacity,
        adjacencyBonus: waterReport.adjacencyBonus,
        totalCapacity: waterReport.totalCapacity,
      });
      terrainProviderOwnerByKey.set(key, tileOwner);
    } else if (terrain === 'plains' && !hasConstr) {
      const pastureReport = computePlainsPastureCapacity(
        worldState,
        tile.q,
        tile.r,
        assets,
        configOverrides
      );
      pastureProviders.push({
        key,
        baseCapacity: pastureReport.baseCapacity,
        adjacencyBonus: pastureReport.adjacencyBonus,
        totalCapacity: pastureReport.totalCapacity,
      });
      terrainProviderOwnerByKey.set(key, tileOwner);
    } else if (terrain === 'fertile') {
      irrigationByKey[key] = computeFertileIrrigation(
        worldState,
        tile.q,
        tile.r,
        assets,
        configOverrides
      );
    }

    if (isUnderConstr) continue;
    if (owner && tileOwner !== owner) continue;

    if (assetName === 'building-village') {
      const pop = Math.max(
        0,
        villagePopulationsByKey?.[key] ?? getDefaultVillagePopulation(tile)
      );
      const vNeighbors = getHexNeighbors(
        worldState,
        tile.q,
        tile.r,
        assets,
        underConstructionKeys,
        config
      );
      const pollutionPenalty = computeAdjacencyScaledEffect(
        vNeighbors,
        (n) => n.exists && n.isCompleteBuilding && n.assetName === 'building-smelter',
        {
          baseValue: 0,
          perNeighborBonus: config.penalties.smelterPollutionOnVillagePerNeighbor,
          maxBonus: config.penalties.smelterPollutionMaxOnVillage,
        }
      ).cappedBonus;

      villageTiles.push({ key, tile, pop, pollutionPenalty, tileOwner });

      huntingConsumers.push({
        key,
        assetName,
        demand: pop * config.village.huntingDemandPerPopulation,
      });
      fishingConsumers.push({
        key,
        assetName,
        demand: pop * config.village.fishingDemandPerPopulation,
      });
      pastureConsumers.push({
        key,
        assetName,
        demand: pop * config.village.pastureDemandPerPopulation,
      });
      const workerSupply = roundPoolValue(
        pop * config.village.workersSuppliedPerPopulation * Math.max(0, 1 - pollutionPenalty)
      );
      workerProviders.push({
        key,
        baseCapacity: pop * config.village.workersSuppliedPerPopulation,
        adjacencyBonus: 0,
        totalCapacity: workerSupply,
      });
    } else if (assetName === 'building-dock') {
      fishingConsumers.push({
        key,
        assetName,
        demand: config.dock.fishingDemand,
      });
    } else if (assetName === 'building-sheep') {
      pastureConsumers.push({
        key,
        assetName,
        demand: config.sheep.pastureDemand,
      });
    }

    if (hasConstr && !(tile.forestDepleted && assetName === DEPLETED_FOREST_ASSET_NAME)) {
      const reqWorkers =
        structureWorkerDemandsByKey?.[key] ??
        getBuildingDefinition(assetName).workersRequired;
      if (reqWorkers > 0) {
        workerConsumers.push({
          key,
          assetName,
          demand: reqWorkers,
        });
      }
    }
  }

  const huntingEdges: PoolEdge[] = [];
  const fishingEdges: PoolEdge[] = [];
  const pastureEdges: PoolEdge[] = [];
  const workerEdges: PoolEdge[] = [];

  const huntingProvSet = new Set(huntingProviders.map((p) => p.key));
  const fishingProvSet = new Set(fishingProviders.map((p) => p.key));
  const pastureProvSet = new Set(pastureProviders.map((p) => p.key));

  for (const v of villageTiles) {
    const neighbors = getHexNeighbors(
      worldState,
      v.tile.q,
      v.tile.r,
      assets,
      underConstructionKeys,
      config
    );
    for (const n of neighbors) {
      if (!n.exists) continue;
      const pOwner = terrainProviderOwnerByKey.get(n.key);
      if (pOwner && isProviderAccessibleToConsumer(pOwner, v.tileOwner, owner)) {
        if (huntingProvSet.has(n.key)) {
          huntingEdges.push({ providerKey: n.key, consumerKey: v.key });
        }
        if (fishingProvSet.has(n.key)) {
          fishingEdges.push({ providerKey: n.key, consumerKey: v.key });
        }
        if (pastureProvSet.has(n.key)) {
          pastureEdges.push({ providerKey: n.key, consumerKey: v.key });
        }
      }
      if (n.owner === v.tileOwner && !underConstructionKeys?.has(n.key)) {
        workerEdges.push({ providerKey: v.key, consumerKey: n.key });
      }
    }
  }

  // Dock-to-water edges (supports own water hex + adjacent water hexes)
  for (const c of fishingConsumers) {
    if (c.assetName !== 'building-dock') continue;
    const dockTile = worldState.hexes[c.key];
    if (!dockTile) continue;
    const dockOwner = resolveTileOwner(dockTile);
    if (fishingProvSet.has(c.key)) {
      fishingEdges.push({ providerKey: c.key, consumerKey: c.key });
    }
    const neighbors = getHexNeighbors(
      worldState,
      dockTile.q,
      dockTile.r,
      assets,
      underConstructionKeys,
      config
    );
    for (const n of neighbors) {
      if (!n.exists || !fishingProvSet.has(n.key)) continue;
      const pOwner = terrainProviderOwnerByKey.get(n.key) ?? 'neutral';
      if (isProviderAccessibleToConsumer(pOwner, dockOwner, owner)) {
        fishingEdges.push({ providerKey: n.key, consumerKey: c.key });
      }
    }
  }

  // Curral-to-plains pasture edges (adjacent open plains)
  for (const c of pastureConsumers) {
    if (c.assetName !== 'building-sheep') continue;
    const sheepTile = worldState.hexes[c.key];
    if (!sheepTile) continue;
    const sheepOwner = resolveTileOwner(sheepTile);
    const neighbors = getHexNeighbors(
      worldState,
      sheepTile.q,
      sheepTile.r,
      assets,
      underConstructionKeys,
      config
    );
    for (const n of neighbors) {
      if (!n.exists || !pastureProvSet.has(n.key)) continue;
      const pOwner = terrainProviderOwnerByKey.get(n.key) ?? 'neutral';
      if (isProviderAccessibleToConsumer(pOwner, sheepOwner, owner)) {
        pastureEdges.push({ providerKey: n.key, consumerKey: c.key });
      }
    }
  }

  const hunting = solveSharedPoolAllocations({
    kind: 'hunting',
    providers: huntingProviders,
    consumers: huntingConsumers,
    edges: huntingEdges,
    sharingMode: config.sharingMode,
  });
  const fishing = solveSharedPoolAllocations({
    kind: 'fishing',
    providers: fishingProviders,
    consumers: fishingConsumers,
    edges: fishingEdges,
    sharingMode: config.sharingMode,
  });
  const pasture = solveSharedPoolAllocations({
    kind: 'pasture',
    providers: pastureProviders,
    consumers: pastureConsumers,
    edges: pastureEdges,
    sharingMode: config.sharingMode,
  });
  const workers = solveSharedPoolAllocations({
    kind: 'workers',
    providers: workerProviders,
    consumers: workerConsumers,
    edges: workerEdges,
    sharingMode: config.sharingMode,
  });

  const villagesByKey: Record<string, VillagePoolReport> = {};
  for (const v of villageTiles) {
    const workerProv = workers.providersByKey[v.key];
    villagesByKey[v.key] = {
      key: v.key,
      q: v.tile.q,
      r: v.tile.r,
      population: v.pop,
      pollutionPenaltyPct: Math.round(v.pollutionPenalty * 100),
      workerSupply: workerProv?.totalCapacity ?? 0,
      workersSuppliedTotal: workerProv?.allocated ?? 0,
      workerConsumersByKey: workerProv?.allocationsByConsumerKey ?? {},
      hunting: hunting.consumersByKey[v.key] ?? null,
      fishing: fishing.consumersByKey[v.key] ?? null,
      pasture: pasture.consumersByKey[v.key] ?? null,
    };
  }

  return {
    config,
    hunting,
    fishing,
    pasture,
    workers,
    irrigationByKey,
    forestsByKey,
    waterByKey,
    villagesByKey,
  };
}

export interface ChainAdjacencyEffectReport {
  terrainMultiplier: number;
  bonusMultiplier: number;
  penaltyFactor: number;
  netMultiplier: number;
  notesPt: string[];
  bonusNotesPt: string[];
  penaltyNotesPt: string[];
  positiveNeighborKeys: string[];
  penaltyNeighborKeys: string[];
  isIrrigated: boolean;
  irrigationCapacity: number;
  hasWaterAccess: boolean;
  predationMitigated: boolean;
  predationPenaltyPct: number;
  pollutionPenaltyPct: number;
  mountainDeposit: MountainDepositType;
  activeForestNeighborKeys: string[];
}

/**
 * Computes Stage 2 chain bonuses and penalties for a placed building using the central
 * 6-neighbor query and capped scaling rules.
 */
export function computeBuildingChainAdjacency(params: {
  worldState: HexWorldState;
  tile: PlacedHex;
  assetName: string;
  assets: HexAssetEntry[];
  underConstructionKeys?: Set<string>;
  configOverrides?: AdjacencyPoolConfigOverrides;
}): ChainAdjacencyEffectReport {
  const {
    worldState,
    tile,
    assetName,
    assets,
    underConstructionKeys,
    configOverrides,
  } = params;
  const config = resolveAdjacencyConfig(configOverrides);
  const neighbors = getHexNeighbors(
    worldState,
    tile.q,
    tile.r,
    assets,
    underConstructionKeys,
    config
  );
  const terrain = getHexTerrainAndResource(tile.q, tile.r, tile).terrainType;
  const mountainDeposit = getMountainDepositType(tile.q, tile.r, tile, assets);

  let terrainMultiplier = 1.0;
  let bonus = 0;
  let penalty = 0;
  const notesPt: string[] = [];
  const bonusNotesPt: string[] = [];
  const penaltyNotesPt: string[] = [];
  const positiveSet = new Set<string>();
  const penaltySet = new Set<string>();

  const irrigation = computeFertileIrrigation(
    worldState,
    tile.q,
    tile.r,
    assets,
    configOverrides
  );
  const hasWaterNeighbor = neighbors.some((n) => n.exists && n.terrainType === 'water');
  const hasWaterAccess = terrain === 'water' || hasWaterNeighbor;

  const activeForestNeighborKeys = neighbors
    .filter((n) => n.exists && n.terrainType === 'forest' && !n.isForestDepleted)
    .map((n) => n.key);

  let predationMitigated = false;
  let predationPenaltyPct = 0;
  let pollutionPenaltyPct = 0;

  const addBonusNote = (text: string) => {
    notesPt.push(text);
    bonusNotesPt.push(text);
  };
  const addPenaltyNote = (text: string) => {
    notesPt.push(text);
    penaltyNotesPt.push(text);
  };

  switch (assetName) {
    case 'building-farm': {
      if (terrain === 'plains') {
        terrainMultiplier = config.farm.plainsEfficiencyMultiplier;
        addPenaltyNote('Planície: rendimento reduzido (-32%)');
      }
      if (irrigation.isIrrigated && irrigation.irrigationCapacity > 0) {
        const irrBonus = Math.min(
          config.farm.irrigationMaxBonus,
          irrigation.irrigationCapacity * config.farm.irrigationBonusPerWaterUnit
        );
        bonus += irrBonus;
        addBonusNote(`Irrigação (+${Math.round(irrBonus * 100)}%)`);
        for (const n of neighbors) {
          if (n.exists && n.terrainType === 'water') positiveSet.add(n.key);
        }
      } else if (
        hasWaterNeighbor ||
        neighbors.some((n) => n.exists && n.isCompleteBuilding && n.assetName === 'building-watermill')
      ) {
        bonus += 0.15;
        addBonusNote('Água próxima (+15%)');
        for (const n of neighbors) {
          if (
            n.exists &&
            (n.terrainType === 'water' ||
              (n.isCompleteBuilding && n.assetName === 'building-watermill'))
          ) {
            positiveSet.add(n.key);
          }
        }
      }
      for (const n of neighbors) {
        if (n.exists && n.isCompleteBuilding && n.assetName === 'building-mill') {
          positiveSet.add(n.key);
        }
      }
      if (neighbors.some((n) => n.exists && n.isCompleteBuilding && n.assetName === 'building-sheep')) {
        bonus += config.farm.manureBonusFromCurral;
        addBonusNote(`Esterco do Curral (+${Math.round(config.farm.manureBonusFromCurral * 100)}%)`);
        for (const n of neighbors) {
          if (n.exists && n.isCompleteBuilding && n.assetName === 'building-sheep') {
            positiveSet.add(n.key);
          }
        }
      }
      const vmBonus = computeAdjacencyScaledEffect(
        neighbors,
        (n) =>
          n.exists &&
          n.isCompleteBuilding &&
          (n.assetName === 'building-village' || n.assetName === 'building-market'),
        {
          baseValue: 0,
          perNeighborBonus: config.farm.villageMarketEfficiencyPerNeighbor,
          maxBonus: config.farm.villageMarketMaxBonus,
        }
      ).cappedBonus;
      if (vmBonus > 0) {
        bonus += vmBonus;
        addBonusNote(`Demanda Vila/Mercado (+${Math.round(vmBonus * 100)}%)`);
        for (const n of neighbors) {
          if (
            n.exists &&
            n.isCompleteBuilding &&
            (n.assetName === 'building-village' || n.assetName === 'building-market')
          ) {
            positiveSet.add(n.key);
          }
        }
      }

      const mineDust = computeAdjacencyScaledEffect(
        neighbors,
        (n) => n.exists && n.isCompleteBuilding && n.assetName === 'building-mine',
        {
          baseValue: 0,
          perNeighborBonus: config.penalties.mineDustOnFarmPerNeighbor,
          maxBonus: config.penalties.mineDustMax,
        }
      ).cappedBonus;
      if (mineDust > 0) {
        penalty += mineDust;
        addPenaltyNote(`Poeira da Mina (-${Math.round(mineDust * 100)}%)`);
        for (const n of neighbors) {
          if (n.exists && n.isCompleteBuilding && n.assetName === 'building-mine') {
            penaltySet.add(n.key);
          }
        }
      }

      const smelterSmoke = computeAdjacencyScaledEffect(
        neighbors,
        (n) => n.exists && n.isCompleteBuilding && n.assetName === 'building-smelter',
        {
          baseValue: 0,
          perNeighborBonus: config.penalties.smelterSmokeOnFarmPerNeighbor,
          maxBonus: config.penalties.smelterSmokeMax,
        }
      ).cappedBonus;
      if (smelterSmoke > 0) {
        penalty += smelterSmoke;
        addPenaltyNote(`Fumaça da Fundição (-${Math.round(smelterSmoke * 100)}%)`);
        for (const n of neighbors) {
          if (n.exists && n.isCompleteBuilding && n.assetName === 'building-smelter') {
            penaltySet.add(n.key);
          }
        }
      }

      const forestShade = computeAdjacencyScaledEffect(
        neighbors,
        (n) => n.exists && n.terrainType === 'forest' && !n.isForestDepleted,
        {
          baseValue: 0,
          perNeighborBonus: config.penalties.forestShadeOnFarmPerNeighbor,
          maxBonus: config.penalties.forestShadeMax,
        }
      ).cappedBonus;
      if (forestShade > 0) {
        penalty += forestShade;
        addPenaltyNote(`Pragas/sombra da Floresta (-${Math.round(forestShade * 100)}%)`);
        for (const k of activeForestNeighborKeys) {
          penaltySet.add(k);
        }
      }

      pollutionPenaltyPct = Math.round((mineDust + smelterSmoke) * 100);
      break;
    }

    case 'building-mill':
    case 'building-watermill': {
      for (const n of neighbors) {
        if (n.exists && n.isCompleteBuilding && n.assetName === 'building-farm') {
          positiveSet.add(n.key);
        }
        if (assetName === 'building-watermill' && n.exists && n.terrainType === 'water') {
          positiveSet.add(n.key);
        }
      }
      const vmBonus = computeAdjacencyScaledEffect(
        neighbors,
        (n) =>
          n.exists &&
          n.isCompleteBuilding &&
          (n.assetName === 'building-village' || n.assetName === 'building-market'),
        {
          baseValue: 0,
          perNeighborBonus: config.mill.villageMarketEfficiencyPerNeighbor,
          maxBonus: config.mill.villageMarketMaxBonus,
        }
      ).cappedBonus;
      if (vmBonus > 0) {
        bonus += vmBonus;
        addBonusNote(`Escoamento Vila/Mercado (+${Math.round(vmBonus * 100)}%)`);
        for (const n of neighbors) {
          if (
            n.exists &&
            n.isCompleteBuilding &&
            (n.assetName === 'building-village' || n.assetName === 'building-market')
          ) {
            positiveSet.add(n.key);
          }
        }
      }
      break;
    }

    case 'building-sheep': {
      for (const n of neighbors) {
        if (n.exists && n.terrainType === 'plains' && !n.hasConstruction) {
          positiveSet.add(n.key);
        }
      }
      if (neighbors.some((n) => n.exists && n.isCompleteBuilding && n.assetName === 'building-farm')) {
        bonus += config.sheep.manureFeedBonusFromFarm;
        addBonusNote(
          `Ração/Esterco da Fazenda (+${Math.round(config.sheep.manureFeedBonusFromFarm * 100)}%)`
        );
        for (const n of neighbors) {
          if (n.exists && n.isCompleteBuilding && n.assetName === 'building-farm') {
            positiveSet.add(n.key);
          }
        }
      }
      const rawPredation = computeAdjacencyScaledEffect(
        neighbors,
        (n) => n.exists && n.terrainType === 'forest' && !n.isForestDepleted,
        {
          baseValue: 0,
          perNeighborBonus: config.sheep.predationPenaltyPerForest,
          maxBonus: config.sheep.predationMaxPenalty,
        }
      ).cappedBonus;
      const guardNeighbors = neighbors.filter(
        (n) =>
          n.exists &&
          n.isCompleteBuilding &&
          (n.assetName === 'building-archery' ||
            n.assetName === 'building-tower' ||
            n.assetName === 'unit-wall-tower')
      );
      if (rawPredation > 0) {
        if (guardNeighbors.length > 0) {
          predationMitigated = true;
          addBonusNote('Predação neutralizada por Arquearia/Torre');
          for (const g of guardNeighbors) positiveSet.add(g.key);
        } else {
          penalty += rawPredation;
          predationPenaltyPct = Math.round(rawPredation * 100);
          addPenaltyNote(`Predação da Floresta (-${predationPenaltyPct}%)`);
          for (const k of activeForestNeighborKeys) penaltySet.add(k);
        }
      }
      const smelterSmoke = computeAdjacencyScaledEffect(
        neighbors,
        (n) => n.exists && n.isCompleteBuilding && n.assetName === 'building-smelter',
        {
          baseValue: 0,
          perNeighborBonus: config.penalties.smelterSmokeOnCurralPerNeighbor,
          maxBonus: config.penalties.smelterSmokeMaxOnCurral,
        }
      ).cappedBonus;
      if (smelterSmoke > 0) {
        penalty += smelterSmoke;
        pollutionPenaltyPct = Math.round(smelterSmoke * 100);
        addPenaltyNote(`Fumaça da Fundição (-${pollutionPenaltyPct}%)`);
        for (const n of neighbors) {
          if (n.exists && n.isCompleteBuilding && n.assetName === 'building-smelter') {
            penaltySet.add(n.key);
          }
        }
      }
      break;
    }

    case 'dirt-lumber': {
      for (const k of activeForestNeighborKeys) {
        positiveSet.add(k);
      }
      break;
    }

    case 'building-mine': {
      const shoring = computeAdjacencyScaledEffect(
        neighbors,
        (n) => n.exists && n.terrainType === 'forest' && !n.isForestDepleted,
        {
          baseValue: 0,
          perNeighborBonus: config.mine.forestShoringBonusPerForest,
          maxBonus: config.mine.forestShoringMaxBonus,
        }
      ).cappedBonus;
      if (shoring > 0) {
        bonus += shoring;
        addBonusNote(`Escoramento florestal (+${Math.round(shoring * 100)}%)`);
        for (const k of activeForestNeighborKeys) positiveSet.add(k);
      }
      for (const n of neighbors) {
        if (n.exists && n.isCompleteBuilding && n.assetName === 'building-smelter') {
          positiveSet.add(n.key);
        }
      }
      break;
    }

    case 'building-smelter': {
      for (const n of neighbors) {
        if (n.exists && n.isCompleteBuilding && n.assetName === 'building-mine') {
          positiveSet.add(n.key);
        }
      }
      for (const k of activeForestNeighborKeys) {
        positiveSet.add(k);
      }
      if (activeForestNeighborKeys.length > 0) {
        addBonusNote(`Combustível florestal (+${Math.round(config.smelter.forestFuelBonus * 100)}%)`);
      }
      break;
    }

    case 'building-dock': {
      for (const n of neighbors) {
        if (n.exists && n.terrainType === 'water') {
          positiveSet.add(n.key);
          const waterNeighbors = getHexNeighbors(
            worldState,
            n.coord.q,
            n.coord.r,
            assets,
            underConstructionKeys,
            config
          );
          for (const wn of waterNeighbors) {
            if (
              wn.exists &&
              wn.isCompleteBuilding &&
              (wn.assetName === 'building-mine' || wn.assetName === 'building-smelter')
            ) {
              penaltySet.add(wn.key);
            }
          }
        }
        if (
          n.exists &&
          n.isCompleteBuilding &&
          (n.assetName === 'building-mine' || n.assetName === 'building-smelter')
        ) {
          penaltySet.add(n.key);
        }
      }
      break;
    }

    case 'building-village': {
      for (const n of neighbors) {
        if (
          n.exists &&
          ((n.terrainType === 'forest' && !n.isForestDepleted) ||
            n.terrainType === 'water' ||
            (n.terrainType === 'plains' && !n.hasConstruction))
        ) {
          positiveSet.add(n.key);
        }
        if (n.exists && n.isCompleteBuilding && n.assetName === 'building-smelter') {
          penaltySet.add(n.key);
        }
      }
      break;
    }

    default:
      break;
  }

  // Common defensive aura & Village worker contribution markers on complete player structures
  for (const n of neighbors) {
    if (!n.exists || !n.isCompleteBuilding) continue;
    if (
      n.assetName === 'building-village' &&
      assetName !== 'building-village'
    ) {
      positiveSet.add(n.key);
    }
    if (
      (n.assetName === 'building-tower' ||
        n.assetName === 'unit-wall-tower' ||
        n.assetName === 'building-archery') &&
      assetName !== 'building-sheep'
    ) {
      positiveSet.add(n.key);
    }
  }

  const netMultiplier = Math.max(0.25, Number((1 + bonus - penalty).toFixed(4)));

  return {
    terrainMultiplier,
    bonusMultiplier: Number((1 + bonus).toFixed(4)),
    penaltyFactor: Number(Math.max(0, 1 - penalty).toFixed(4)),
    netMultiplier,
    notesPt,
    bonusNotesPt,
    penaltyNotesPt,
    positiveNeighborKeys: Array.from(positiveSet).sort(),
    penaltyNeighborKeys: Array.from(penaltySet).sort(),
    isIrrigated: irrigation.isIrrigated,
    irrigationCapacity: irrigation.irrigationCapacity,
    hasWaterAccess,
    predationMitigated,
    predationPenaltyPct,
    pollutionPenaltyPct,
    mountainDeposit,
    activeForestNeighborKeys,
  };
}

export interface GrainProcessingChainResult {
  grainSummary: PoolCategorySummary;
  grainConsumedByFarmKey: Record<string, number>;
  excessGrainByFarmKey: Record<string, number>;
  grainProcessedByMillKey: Record<string, number>;
  processedFoodByMillKey: Record<string, number>;
  processedGoldByMillKey: Record<string, number>;
}

export function solveGrainProcessingChain(params: {
  worldState: HexWorldState;
  farms: Array<{ key: string; q: number; r: number; rawGrainProduced: number }>;
  mills: Array<{
    key: string;
    q: number;
    r: number;
    assetName: 'building-mill' | 'building-watermill';
    processingCapacity: number;
    efficiencyMultiplier: number;
  }>;
  configOverrides?: AdjacencyPoolConfigOverrides;
}): GrainProcessingChainResult {
  const { farms, mills, configOverrides } = params;
  const config = resolveAdjacencyConfig(configOverrides);

  const providers: PoolProviderNode[] = farms.map((f) => ({
    key: f.key,
    baseCapacity: f.rawGrainProduced,
    adjacencyBonus: 0,
    totalCapacity: f.rawGrainProduced,
  }));

  const consumers: PoolConsumerNode[] = mills.map((m) => ({
    key: m.key,
    assetName: m.assetName,
    demand: m.processingCapacity,
  }));

  const edges: PoolEdge[] = [];
  for (const f of farms) {
    for (const m of mills) {
      if (axialDistance({ q: f.q, r: f.r }, { q: m.q, r: m.r }) === 1) {
        edges.push({ providerKey: f.key, consumerKey: m.key });
      }
    }
  }

  const grainSummary = solveSharedPoolAllocations({
    kind: 'grain',
    providers,
    consumers,
    edges,
    sharingMode: config.sharingMode,
  });

  const grainConsumedByFarmKey: Record<string, number> = {};
  const excessGrainByFarmKey: Record<string, number> = {};
  for (const f of farms) {
    const alloc = grainSummary.providersByKey[f.key];
    const used = alloc?.allocated ?? 0;
    grainConsumedByFarmKey[f.key] = roundPoolValue(used);
    excessGrainByFarmKey[f.key] = roundPoolValue(Math.max(0, f.rawGrainProduced - used));
  }

  const grainProcessedByMillKey: Record<string, number> = {};
  const processedFoodByMillKey: Record<string, number> = {};
  const processedGoldByMillKey: Record<string, number> = {};

  for (const m of mills) {
    const alloc = grainSummary.consumersByKey[m.key];
    const processed = alloc?.allocated ?? 0;
    const foodMult =
      m.assetName === 'building-watermill'
        ? config.mill.watermillFoodMultiplier
        : config.mill.millFoodMultiplier;
    const goldRate =
      m.assetName === 'building-watermill'
        ? config.mill.watermillGoldPerGrain
        : config.mill.millGoldPerGrain;

    grainProcessedByMillKey[m.key] = roundPoolValue(processed);
    processedFoodByMillKey[m.key] = Math.round(
      processed * foodMult * m.efficiencyMultiplier
    );
    processedGoldByMillKey[m.key] = Math.round(
      processed * goldRate * m.efficiencyMultiplier
    );
  }

  return {
    grainSummary,
    grainConsumedByFarmKey,
    excessGrainByFarmKey,
    grainProcessedByMillKey,
    processedFoodByMillKey,
    processedGoldByMillKey,
  };
}

export interface ForestTimberExtractionResult {
  timberSummary: PoolCategorySummary;
  forestWoodConsumedByKey: Record<string, number>;
  timberSuppliedByConsumerKey: Record<string, number>;
}

/**
 * Shared finite-wood extraction solver for Serrarias (dirt-lumber) and Fundições (building-smelter).
 * Respects forest finite woodStock, ignores depleted forests (dirt-lumber), and prefers adjacent active forests.
 */
export function resolveForestTimberChain(params: {
  worldState: HexWorldState;
  assets: HexAssetEntry[];
  consumers: Array<{
    key: string;
    q: number;
    r: number;
    assetName: 'dirt-lumber' | 'building-smelter';
    woodDemand: number;
    allowOwnTile: boolean;
  }>;
  owner?: HexOwner;
  configOverrides?: AdjacencyPoolConfigOverrides;
}): ForestTimberExtractionResult {
  const { worldState, assets, consumers, owner, configOverrides } = params;
  const config = resolveAdjacencyConfig(configOverrides);

  const forestProviders: PoolProviderNode[] = [];
  const forestSeen = new Set<string>();
  const edges: PoolEdge[] = [];

  for (const c of consumers) {
    if (c.woodDemand <= 0) continue;
    const cTile = worldState.hexes[c.key];
    const cOwner = resolveTileOwner(cTile);

    const neighbors = getHexNeighbors(worldState, c.q, c.r, assets, undefined, config);
    const adjacentForestKeys: string[] = [];

    for (const n of neighbors) {
      if (!n.exists || n.terrainType !== 'forest' || n.isForestDepleted) continue;
      if (!isProviderAccessibleToConsumer(n.owner, cOwner, owner)) continue;
      const stock = getForestWoodStock(n.tile, config);
      if (stock <= config.forest.woodDepletionThreshold) continue;
      adjacentForestKeys.push(n.key);
      if (!forestSeen.has(n.key)) {
        forestSeen.add(n.key);
        forestProviders.push({
          key: n.key,
          baseCapacity: stock,
          adjacencyBonus: 0,
          totalCapacity: stock,
        });
      }
      edges.push({ providerKey: n.key, consumerKey: c.key });
    }

    // Serraria sits on a forest tile: if no adjacent forest can supply it (or own tile also has timber),
    // allow drawing from own non-depleted forest tile when no adjacent forest exists or own tile is active.
    if (c.allowOwnTile && cTile && adjacentForestKeys.length === 0) {
      const ownTerrain = getHexTerrainAndResource(c.q, c.r, cTile).terrainType;
      if (ownTerrain === 'forest' && !isForestDepleted(cTile, config)) {
        const ownStock = getForestWoodStock(cTile, config);
        if (ownStock > config.forest.woodDepletionThreshold) {
          if (!forestSeen.has(c.key)) {
            forestSeen.add(c.key);
            forestProviders.push({
              key: c.key,
              baseCapacity: ownStock,
              adjacencyBonus: 0,
              totalCapacity: ownStock,
            });
          }
          edges.push({ providerKey: c.key, consumerKey: c.key });
        }
      }
    }
  }

  const timberSummary = solveSharedPoolAllocations({
    kind: 'timber',
    providers: forestProviders,
    consumers: consumers.map((c) => ({
      key: c.key,
      assetName: c.assetName,
      demand: c.woodDemand,
    })),
    edges,
    sharingMode: config.sharingMode,
  });

  const forestWoodConsumedByKey: Record<string, number> = {};
  for (const [fKey, prov] of Object.entries(timberSummary.providersByKey)) {
    if (prov.allocated > 0) {
      forestWoodConsumedByKey[fKey] = Math.round(prov.allocated);
    }
  }

  const timberSuppliedByConsumerKey: Record<string, number> = {};
  for (const [cKey, cons] of Object.entries(timberSummary.consumersByKey)) {
    timberSuppliedByConsumerKey[cKey] = cons.allocated;
  }

  return {
    timberSummary,
    forestWoodConsumedByKey,
    timberSuppliedByConsumerKey,
  };
}

export type LocalCommerceProductCategory =
  | 'grain'
  | 'flour'
  | 'livestock'
  | 'lumber'
  | 'minerals'
  | 'metal'
  | 'fish'
  | 'maritime';

export const PRODUCER_COMMERCE_CATEGORY: Record<string, LocalCommerceProductCategory> = {
  'building-farm': 'grain',
  'building-mill': 'flour',
  'building-watermill': 'flour',
  'building-sheep': 'livestock',
  'dirt-lumber': 'lumber',
  'building-mine': 'minerals',
  'building-smelter': 'metal',
  'building-dock': 'fish',
  'building-port': 'maritime',
};

const PROCESSED_COMMERCE_CATEGORIES = new Set<LocalCommerceProductCategory>([
  'flour',
  'lumber',
  'metal',
  'maritime',
]);

export interface MarketCommerceReport {
  marketKey: string;
  allocatedSupplyUnits: number;
  allocatedDemandUnits: number;
  distinctProductTypes: LocalCommerceProductCategory[];
  varietyMultiplier: number;
  commercialGold: number;
  sharedWithMarketKeys: string[];
  suppliedProducerKeys: string[];
  demandProviderKeys: string[];
}

export interface LocalCommerceChainResult {
  supplyPool: PoolCategorySummary;
  demandPool: PoolCategorySummary;
  marketsByKey: Record<string, MarketCommerceReport>;
  averageVarietyCount: number;
}

/**
 * Integrates Mercado with adjacent producers and Villages/housing demand.
 * - Distinct product types earn higher efficiency than identical duplicates.
 * - Neighboring Markets share adjacent producer supply & Village demand proportionally.
 * - Produces zero physical resources; returns pure commercial gold.
 */
export function solveLocalCommerceChain(params: {
  worldState: HexWorldState;
  markets: Array<{
    key: string;
    q: number;
    r: number;
    capacityWeight: number;
    workerRatio: number;
  }>;
  activeProducersByKey: Record<string, { assetName: string; q: number; r: number; isActive: boolean }>;
  housingDemandByKey: Record<string, { assetName: string; q: number; r: number; weight: number }>;
  configOverrides?: AdjacencyPoolConfigOverrides;
}): LocalCommerceChainResult {
  const {
    markets,
    activeProducersByKey,
    housingDemandByKey,
    configOverrides,
  } = params;
  const config = resolveAdjacencyConfig(configOverrides);

  const supplyProviders: PoolProviderNode[] = [];
  const supplyEdges: PoolEdge[] = [];
  for (const [pKey, prod] of Object.entries(activeProducersByKey)) {
    const category = PRODUCER_COMMERCE_CATEGORY[prod.assetName];
    if (!category || !prod.isActive) continue;
    const unitCap = PROCESSED_COMMERCE_CATEGORIES.has(category)
      ? config.commerce.processedProducerMultiplier
      : 1.0;
    supplyProviders.push({
      key: pKey,
      baseCapacity: unitCap,
      adjacencyBonus: 0,
      totalCapacity: unitCap,
    });
    for (const m of markets) {
      if (m.workerRatio <= 0) continue;
      if (axialDistance({ q: prod.q, r: prod.r }, { q: m.q, r: m.r }) === 1) {
        supplyEdges.push({ providerKey: pKey, consumerKey: m.key });
      }
    }
  }

  const demandProviders: PoolProviderNode[] = [];
  const demandEdges: PoolEdge[] = [];
  for (const [hKey, house] of Object.entries(housingDemandByKey)) {
    if (house.weight <= 0) continue;
    demandProviders.push({
      key: hKey,
      baseCapacity: house.weight,
      adjacencyBonus: 0,
      totalCapacity: house.weight,
    });
    for (const m of markets) {
      if (m.workerRatio <= 0) continue;
      if (axialDistance({ q: house.q, r: house.r }, { q: m.q, r: m.r }) === 1) {
        demandEdges.push({ providerKey: hKey, consumerKey: m.key });
      }
    }
  }

  const marketConsumers: PoolConsumerNode[] = markets.map((m) => ({
    key: m.key,
    assetName: 'building-market',
    demand: m.workerRatio > 0 ? Math.max(1, m.capacityWeight * 10 * m.workerRatio) : 0,
  }));

  const supplyPool = solveSharedPoolAllocations({
    kind: 'commerce',
    providers: supplyProviders,
    consumers: marketConsumers,
    edges: supplyEdges,
    sharingMode: config.sharingMode,
  });

  const demandPool = solveSharedPoolAllocations({
    kind: 'commerce',
    providers: demandProviders,
    consumers: marketConsumers,
    edges: demandEdges,
    sharingMode: config.sharingMode,
  });

  const marketsByKey: Record<string, MarketCommerceReport> = {};
  let varietyTotal = 0;

  for (const m of markets) {
    const sAlloc = supplyPool.consumersByKey[m.key];
    const dAlloc = demandPool.consumersByKey[m.key];
    const allocatedSupplyUnits = sAlloc?.allocated ?? 0;
    const allocatedDemandUnits = dAlloc?.allocated ?? 0;

    // Count distinct product categories among allocated providers and apply diminishing returns to duplicates
    const seenByCat = new Map<LocalCommerceProductCategory, number>();
    const suppliedProducerKeys: string[] = [];
    let effectiveVolume = 0;

    for (const [pKey, amount] of Object.entries(sAlloc?.allocationsByProviderKey ?? {})) {
      if (amount <= 0) continue;
      const prod = activeProducersByKey[pKey];
      if (!prod) continue;
      const cat = PRODUCER_COMMERCE_CATEGORY[prod.assetName];
      if (!cat) continue;
      suppliedProducerKeys.push(pKey);
      const countSoFar = seenByCat.get(cat) ?? 0;
      const weight = countSoFar === 0 ? 1.0 : config.commerce.duplicateProductWeight;
      effectiveVolume += amount * weight;
      seenByCat.set(cat, countSoFar + 1);
    }

    const demandProviderKeys = Object.entries(dAlloc?.allocationsByProviderKey ?? {})
      .filter(([, amount]) => amount > 0)
      .map(([k]) => k)
      .sort();

    const distinctProductTypes = Array.from(seenByCat.keys()).sort();
    varietyTotal += distinctProductTypes.length;

    const varietyMultiplier =
      distinctProductTypes.length > 1
        ? 1 +
          Math.min(
            config.commerce.varietyMaxBonus,
            (distinctProductTypes.length - 1) * config.commerce.varietyBonusPerExtraType
          )
        : 1.0;

    // Demand factor ensures Villages/housing drive commerce, while still valuing supply even if small
    const demandMultiplier =
      allocatedDemandUnits > 0
        ? Math.min(1.5, 0.75 + allocatedDemandUnits * 0.35)
        : 0.65;

    const rawCommercialBonus =
      effectiveVolume * config.commerce.producerTradeValue * varietyMultiplier * demandMultiplier;
    const cappedBonus = Math.min(config.commerce.maxCommercialGoldBonus, rawCommercialBonus);

    const commercialGold =
      m.workerRatio > 0
        ? Math.round((config.commerce.baseOperatingGold + cappedBonus) * m.workerRatio)
        : 0;

    const peers = new Set<string>([
      ...(sAlloc?.sharedWithConsumerKeys ?? []),
      ...(dAlloc?.sharedWithConsumerKeys ?? []),
    ]);

    marketsByKey[m.key] = {
      marketKey: m.key,
      allocatedSupplyUnits: roundPoolValue(allocatedSupplyUnits),
      allocatedDemandUnits: roundPoolValue(allocatedDemandUnits),
      distinctProductTypes,
      varietyMultiplier: roundPoolValue(varietyMultiplier),
      commercialGold,
      sharedWithMarketKeys: Array.from(peers).sort(),
      suppliedProducerKeys: suppliedProducerKeys.sort(),
      demandProviderKeys,
    };
  }

  return {
    supplyPool,
    demandPool,
    marketsByKey,
    averageVarietyCount:
      markets.length > 0 ? roundPoolValue(varietyTotal / markets.length) : 0,
  };
}

