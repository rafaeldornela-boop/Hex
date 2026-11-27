import type { HexAssetEntry } from './godot-docs';
import {
  getBuildingDefinition,
  type BuildingProduction,
  type InputResourceKey,
  type ResourceCost,
} from './buildings-catalog';
import { hexKey, type AxialCoord, type HexOwner, type HexWorldState, type PlacedHex } from './hex-engine';
import {
  BASE_HOUSING_CAPACITY,
  allocateWorkersToBuildings,
  computeWorkerProductionScale,
  evaluatePopulationDynamics,
  type BuildingWorkOrder,
} from './population-engine';
import {
  DEPLETED_FOREST_ASSET_NAME,
  getHexTerrainAndResource,
  getStrategicRegionInfo,
} from './terrain-engine';
import {
  DEFAULT_ADJACENCY_CONFIG,
  PRODUCER_COMMERCE_CATEGORY,
  computeAdjacencyScaledEffect,
  computeBuildingChainAdjacency,
  evaluateWorldAdjacencyPools,
  getForestWoodStock,
  getHexNeighbors,
  resolveForestTimberChain,
  solveGrainProcessingChain,
  solveLocalCommerceChain,
  type ChainAdjacencyEffectReport,
  type GrainProcessingChainResult,
  type LocalCommerceChainResult,
  type LocalCommerceProductCategory,
  type WorldAdjacencySummary,
} from './adjacency-engine';
import { getTechModifiers, type TechId } from './tech-engine';
import { computeFactionMilitaryPower, type UnitEntity } from './military-engine';
import type { ActiveWorldEffect } from './events-engine';
import {
  computeRoadConnectivity,
  type RoadConnectivitySummary,
  type RoadMap,
} from './road-engine';
import { computeBuildingLogistics } from './logistics-engine';
import {
  evaluateRegionalWorld,
  SPECIALIZATION_STAGE_META,
  type RegionalHexBonus,
  type RegionalSpecializationId,
  type RegionalWorldSummary,
} from './regional-engine';
import { ensureStarterCapitalCity, type CityEntity } from './city-engine';
import type { SeasonId } from './calendar-engine';
import {
  getBuildingLevel,
  getEffectiveBuildingStats,
  type EffectiveBuildingStats,
} from './building-upgrade-engine';
import {
  BUILDING_MODULES,
  aggregateTileModuleEffects,
  getInstalledModules,
  type AggregatedTileModuleEffects,
  type BuildingModuleId,
} from './building-modules-engine';
import {
  createInitialClimateWeather,
  getSeasonEconomicProfile,
  type ActiveClimateWeather,
} from './season-engine';

export interface KingdomResources {
  wood: number;
  stone: number;
  food: number;
  ore: number;
  metal: number;
  science: number;
}

export interface ResourceStorageCaps {
  wood: number;
  stone: number;
  food: number;
  ore: number;
  metal: number;
}

export type BuildingOperationStatus =
  | 'operating'
  | 'partial'
  | 'idle'
  | 'under_construction';

export interface MarketInspectionDetails {
  producers: Array<{
    key: string;
    labelPt: string;
    categoryPt: string;
  }>;
  distinctProductsPt: string[];
  varietyMultiplierPct: number;
  varietyBonusPt: string;
  sharedWithMarketsCount: number;
  sharedDemandNotePt: string | null;
}

export interface BuildingOperationReport {
  key: string;
  assetName: string;
  labelPt: string;
  level: number;
  maxLevel: number;
  status: BuildingOperationStatus;
  statusLabelPt: string;
  reasonPt: string | null;
  seasonalNotePt: string | null;
  upgradeInProgress: {
    targetLevel: number;
    turnsRemaining: number;
    totalTurns: number;
  } | null;
  installedModules: BuildingModuleId[];
  moduleConstructionInProgress: {
    moduleId: BuildingModuleId;
    labelPt: string;
    turnsRemaining: number;
    totalTurns: number;
  } | null;
  workersAssigned: number;
  workersRequired: number;
  localWorkersFromVillages?: number;
  locationEfficiencyPct: number;
  effectiveEfficiencyPct: number;
  locationBonusNotesPt: string[];
  logisticsEfficiencyPct: number;
  logisticsStatusPt: string;
  districtLabelPt: string | null;
  hasRoad: boolean;
  roadLevel: number;
  roadBonusNotesPt: string[];
  potentialProduction: BuildingProduction;
  actualProduction: BuildingProduction;
  effectiveHousingCapacity: number;
  effectiveStorageGeneral: number;
  effectiveStorageFood: number;
  effectiveDefenseBonus: number;
  effectiveMaintenanceGold: number;
  inputConsumed: Partial<Record<InputResourceKey, number>>;
  positiveNeighborKeys: string[];
  penaltyNeighborKeys: string[];
  capacitySummaryPt: string | null;
  resourceOriginPt: string | null;
  workerOriginPt: string | null;
  bonusSummaryPt: string[];
  penaltySummaryPt: string[];
  marketDetails?: MarketInspectionDetails;
}

export interface PopulationSummary {
  current: number;
  capacity: number;
  usedWorkers: number;
  buildingWorkersAssigned: number;
  buildingWorkersRequired: number;
  unitWorkersUsed: number;
  expansionWorkersUsed: number;
  availableWorkers: number;
  foodConsumption: number;
  hasFoodDeficit: boolean;
  nextFoodDeficitTurns: number;
  projectedGrowth: number;
  efficiency: number; // 0.25..1.0
  efficiencyReasonPt: string | null;
}

export interface TurnProductionBreakdown {
  goldGross: number;
  goldMaintenance: number;
  goldTradePactBonus: number;
  roadMaintenanceGold: number;
  networkTradeGold: number;
  corridorTradeGold: number;
  regionalBonusGold: number;
  regionalBonusScience: number;
  regionalStorageBonus: number;
  regionalFoodStorageBonus: number;
  regionalHousingBonus: number;
  regionalRoadUpkeepSaved: number;
  goldNet: number;
  woodNet: number;
  stoneNet: number;
  foodProduced: number;
  foodConsumed: number;
  foodNet: number;
  oreProduced: number;
  oreConsumed: number;
  oreNet: number;
  metalProduced: number;
  metalNet: number;
  scienceNet: number;
  foodDeficitTurnsNext: number;
  storageCaps: ResourceStorageCaps;
  population: PopulationSummary;
  underConstructionCount: number;
  citySummaryCount: number;
  roadConnectivity: RoadConnectivitySummary;
  regionalSummary: RegionalWorldSummary;
  adjacencyPools: WorldAdjacencySummary;
  grainChain: GrainProcessingChainResult;
  commerceChain: LocalCommerceChainResult;
  forestWoodConsumptionsByKey: Record<string, number>;
  kingdomWoodFuelConsumed: number;
  buildingsByKey: Record<string, BuildingOperationReport>;
  attentionHexKeys: string[];
  season: SeasonId | null;
  weather: ActiveClimateWeather;
  foodDemandMult: number;
  seasonalSummaryPt: string | null;
  operationCounts: {
    operating: number;
    partial: number;
    idle: number;
    underConstruction: number;
  };
}

export interface KingdomStageInfo {
  stageIndex: 1 | 2 | 3 | 4 | 5;
  labelPt: string;
  nextMilestonePt: string;
}

const ZERO_PROD: BuildingProduction = {
  gold: 0,
  wood: 0,
  stone: 0,
  food: 0,
  ore: 0,
  metal: 0,
  science: 0,
};

export function createInitialResources(): KingdomResources {
  return {
    wood: 60,
    stone: 45,
    food: 65,
    ore: 25,
    metal: 10,
    science: 0,
  };
}

export function computeEffectiveBuildCost(
  assetName: string,
  unlockedTechs: TechId[]
): ResourceCost {
  const def = getBuildingDefinition(assetName);
  const mods = getTechModifiers(unlockedTechs);
  const mult = mods.buildCostMultiplier;
  return {
    gold: Math.round(def.buildCost.gold * mult),
    wood: Math.round(def.buildCost.wood * mult),
    stone: Math.round(def.buildCost.stone * mult),
    food: Math.round(def.buildCost.food * mult),
    ore: Math.round(def.buildCost.ore * mult),
    metal: Math.round(def.buildCost.metal * mult),
  };
}

export function canAffordCost(
  gold: number,
  resources: KingdomResources,
  cost: ResourceCost
): { affordable: boolean; missingLabelPt: string | null } {
  if (gold < cost.gold) {
    return { affordable: false, missingLabelPt: `Ouro insuficiente ($${cost.gold})` };
  }
  if (resources.wood < cost.wood) {
    return { affordable: false, missingLabelPt: `Madeira insuficiente (${cost.wood})` };
  }
  if (resources.stone < cost.stone) {
    return { affordable: false, missingLabelPt: `Pedra insuficiente (${cost.stone})` };
  }
  if (resources.food < cost.food) {
    return { affordable: false, missingLabelPt: `Alimento insuficiente (${cost.food})` };
  }
  if (resources.ore < cost.ore) {
    return { affordable: false, missingLabelPt: `Minério insuficiente (${cost.ore})` };
  }
  if (resources.metal < cost.metal) {
    return { affordable: false, missingLabelPt: `Metal insuficiente (${cost.metal})` };
  }
  return { affordable: true, missingLabelPt: null };
}

export function computeBuildingLocationEfficiency(
  worldState: HexWorldState,
  tile: PlacedHex,
  assetName: string,
  assets: HexAssetEntry[],
  underConstructionKeys?: Set<string>,
  roads?: RoadMap,
  roadConnectivity?: RoadConnectivitySummary,
  cityCenters?: AxialCoord[],
  regionalBonuses?: Record<string, RegionalHexBonus>
): { factor: number; notesPt: string[] } {
  let factor = 1.0;
  const notesPt: string[] = [];

  const neighborTiles = getHexNeighbors(
    worldState,
    tile.q,
    tile.r,
    assets,
    underConstructionKeys
  );

  const countTerrain = (t: string) =>
    neighborTiles.filter((n) => n.exists && n.terrainType === t).length;
  const hasCompleteNeighborAsset = (names: string[]) =>
    neighborTiles.some(
      (n) => n.exists && n.isCompleteBuilding && names.includes(n.assetName)
    );

  const strategic = getStrategicRegionInfo(tile.q, tile.r, tile);

  switch (assetName) {
    case 'building-farm': {
      if (countTerrain('water') > 0 || hasCompleteNeighborAsset(['building-watermill'])) {
        factor += 0.15;
        notesPt.push('Água próxima (+15%)');
      }
      if (hasCompleteNeighborAsset(['building-mill'])) {
        factor += 0.15;
        notesPt.push('Moinho vizinho (+15%)');
      }
      if (strategic.rareFeature === 'rich_soil') {
        factor += 0.1;
        notesPt.push('Solo fértil raro (+10%)');
      }
      break;
    }
    case 'building-mill':
    case 'building-sheep': {
      if (hasCompleteNeighborAsset(['building-farm']) || countTerrain('fertile') > 0) {
        factor += 0.2;
        notesPt.push('Campos férteis vizinhos (+20%)');
      }
      break;
    }
    case 'building-watermill':
    case 'building-dock': {
      const landCount = neighborTiles.filter(
        (n) => n.exists && n.terrainType !== 'water'
      ).length;
      if (landCount > 0) {
        factor += 0.15;
        notesPt.push('Margem acessível (+15%)');
      }
      if (assetName === 'building-dock' && strategic.rareFeature === 'natural_harbor') {
        factor += 0.15;
        notesPt.push('Porto natural (+15%)');
      }
      break;
    }
    case 'dirt-lumber': {
      const forestScaled = computeAdjacencyScaledEffect(
        neighborTiles,
        (n) => n.exists && n.terrainType === 'forest' && !n.isForestDepleted,
        { baseValue: 0, perNeighborBonus: 1, maxBonus: 6 }
      );
      const forestNeighbors = forestScaled.matchingNeighborCount;
      if (forestNeighbors >= 3) {
        factor += 0.25;
        notesPt.push('Mata densa vizinha (+25%)');
      } else if (forestNeighbors >= 1) {
        factor += 0.15;
        notesPt.push('Bosque adjacente (+15%)');
      } else {
        factor -= 0.1;
        notesPt.push('Floresta isolada (-10%)');
      }
      break;
    }
    case 'building-mine': {
      const mountainScaled = computeAdjacencyScaledEffect(
        neighborTiles,
        (n) => n.exists && n.terrainType === 'mountain',
        { baseValue: 0, perNeighborBonus: 1, maxBonus: 6 }
      );
      const mountainNeighbors = mountainScaled.matchingNeighborCount;
      if (mountainNeighbors >= 2) {
        factor += 0.25;
        notesPt.push('Cordilheira vizinha (+25%)');
      } else if (mountainNeighbors >= 1) {
        factor += 0.15;
        notesPt.push('Encosta rochosa (+15%)');
      }
      if (hasCompleteNeighborAsset(['building-smelter'])) {
        factor += 0.15;
        notesPt.push('Fundição vizinha (+15%)');
      }
      if (strategic.rareFeature === 'pure_iron' || strategic.rareFeature === 'gold_vein') {
        factor += 0.15;
        notesPt.push('Veio mineral (+15%)');
      }
      break;
    }
    case 'building-smelter': {
      if (hasCompleteNeighborAsset(['building-mine'])) {
        factor += 0.25;
        notesPt.push('Mina adjacente (+25%)');
      } else if (countTerrain('mountain') > 0) {
        factor += 0.1;
        notesPt.push('Próxima à montanha (+10%)');
      }
      break;
    }
    case 'building-market':
    case 'building-port': {
      const housingAssets = new Set([
        'building-house',
        'building-cabin',
        'building-village',
        'unit-mansion',
        'building-castle',
      ]);
      const housingScaled = computeAdjacencyScaledEffect(
        neighborTiles,
        (n) => n.exists && n.isCompleteBuilding && housingAssets.has(n.assetName),
        { baseValue: 0, perNeighborBonus: 0.1, maxBonus: 0.25 }
      );
      if (housingScaled.cappedBonus > 0) {
        factor += housingScaled.cappedBonus;
        notesPt.push(`Moradias próximas (+${Math.round(housingScaled.cappedBonus * 100)}%)`);
      }
      if (
        assetName === 'building-market' &&
        (countTerrain('water') > 0 || hasCompleteNeighborAsset(['building-port']))
      ) {
        factor += 0.15;
        notesPt.push('Rota fluvial/portuária (+15%)');
      }
      if (assetName === 'building-port' && hasCompleteNeighborAsset(['building-market'])) {
        factor += 0.15;
        notesPt.push('Mercado ligado (+15%)');
      }
      break;
    }
    case 'building-wizard-tower': {
      if (hasCompleteNeighborAsset(['building-castle', 'unit-mansion'])) {
        factor += 0.15;
        notesPt.push('Patrocínio nobre (+15%)');
      }
      const crystalNear =
        strategic.rareFeature === 'arcane_crystal' ||
        neighborTiles.some(
          (n) =>
            n.exists &&
            n.tile &&
            getStrategicRegionInfo(n.tile.q, n.tile.r, n.tile).rareFeature === 'arcane_crystal'
        );
      if (crystalNear) {
        factor += 0.2;
        notesPt.push('Cristal arcano (+20%)');
      }
      break;
    }
    default:
      break;
  }

  // Adjacency 2.0: Road & city-network synergy
  const tileKey = hexKey(tile.q, tile.r);
  const road = roads?.[tileKey];
  if (road && road.owner === (tile.owner ?? 'player')) {
    const roadMetric = roadConnectivity?.tileMetricsByKey[tileKey];
    const roadSynergy =
      assetName === 'building-market' ||
      assetName === 'building-port' ||
      assetName === 'building-mine' ||
      assetName === 'building-smelter' ||
      assetName === 'dirt-lumber'
        ? Math.min(0.12, road.level * 0.03)
        : Math.min(0.08, road.level * 0.02);
    factor += roadSynergy;
    notesPt.push(
      roadMetric?.connectedToCity
        ? `Acesso viário à cidade (+${Math.round(roadSynergy * 100)}%)`
        : `Estrada local (+${Math.round(roadSynergy * 100)}%)`
    );
  }

  if (cityCenters && cityCenters.length > 0) {
    const nearCity = cityCenters.some(
      (c) => Math.max(Math.abs(tile.q - c.q), Math.abs(tile.r - c.r), Math.abs(tile.q + tile.r - c.q - c.r)) <= 1
    );
    if (
      nearCity &&
      (assetName === 'building-market' ||
        assetName === 'building-house' ||
        assetName === 'building-village' ||
        assetName === 'building-wizard-tower')
    ) {
      factor += 0.05;
      notesPt.push('Núcleo urbano (+5%)');
    }
  }

  const regBonus = regionalBonuses?.[tileKey];
  if (regBonus) {
    notesPt.push(
      `${regBonus.districtLabelPt} (+${Math.round((regBonus.multiplier - 1) * 100)}%)`
    );
  }

  return {
    factor: Math.max(0.75, Math.min(1.55, Number(factor.toFixed(2)))),
    notesPt,
  };
}

function hasAnyPositiveOutput(prod: BuildingProduction): boolean {
  return (
    prod.gold > 0 ||
    prod.wood > 0 ||
    prod.stone > 0 ||
    prod.food > 0 ||
    prod.ore > 0 ||
    prod.metal > 0 ||
    prod.science > 0
  );
}

export function computeTurnEconomyBreakdown(params: {
  worldState: HexWorldState;
  resources: KingdomResources;
  population: number;
  unlockedTechs: TechId[];
  units: UnitEntity[];
  assets: HexAssetEntry[];
  owner?: HexOwner;
  underConstructionKeys?: Set<string>;
  expansionWorkersUsed?: number;
  activeEffects?: ActiveWorldEffect[];
  tradePactGoldBonus?: number;
  eventGoldMultiplier?: number;
  eventFoodMultiplier?: number;
  foodDeficitTurns?: number;
  roads?: RoadMap;
  cities?: CityEntity[];
  playerCapital?: AxialCoord;
  worldSeed?: number;
  season?: SeasonId;
  weather?: ActiveClimateWeather;
  upgradingConstructionsByKey?: Record<
    string,
    { targetLevel: number; turnsRemaining: number; totalTurns: number }
  >;
  moduleConstructionsByKey?: Record<
    string,
    { moduleId: BuildingModuleId; turnsRemaining: number; totalTurns: number }
  >;
}): TurnProductionBreakdown {
  const {
    worldState,
    resources,
    population,
    unlockedTechs,
    units,
    assets,
    owner = 'player',
    underConstructionKeys,
    expansionWorkersUsed = 0,
    activeEffects = [],
    tradePactGoldBonus = 0,
    eventGoldMultiplier = 1,
    eventFoodMultiplier = 1,
    foodDeficitTurns = 0,
    roads = {},
    cities,
    playerCapital,
    worldSeed,
    season,
    weather = createInitialClimateWeather(),
    upgradingConstructionsByKey = {},
    moduleConstructionsByKey = {},
  } = params;

  const mods = getTechModifiers(unlockedTechs);
  const seasonProfile = season ? getSeasonEconomicProfile(season) : null;
  const seasonFoodMult = seasonProfile ? seasonProfile.foodProductionMult : 1;
  const seasonWoodMult = seasonProfile ? seasonProfile.woodProductionMult : 1;
  const seasonTradeMult = seasonProfile ? seasonProfile.tradeBonusMod : 1;
  const seasonUpkeepMult = seasonProfile ? seasonProfile.upkeepMult : 1;
  const seasonFoodDemandMult = seasonProfile ? seasonProfile.foodDemandMult : 1;
  const seasonPopGrowthMod = seasonProfile ? seasonProfile.popGrowthBonusMod : 0;

  const weatherFoodMult = weather?.foodProductionMult ?? 1;
  const weatherWoodMult = weather?.woodProductionMult ?? 1;
  const weatherGoldMult = weather?.goldProductionMult ?? 1;

  const activeCities =
    owner === 'player'
      ? cities && cities.length > 0
        ? cities
        : ensureStarterCapitalCity({
            playerCapital,
            worldState,
            worldSeed,
            existingCities: [],
          })
      : [];

  const cityCenters = activeCities.map((c) => c.center);

  const roadConnectivity = computeRoadConnectivity({
    worldState,
    roads,
    cityCenters: activeCities.map((c) => ({
      id: c.id,
      center: c.center,
      level: c.level,
    })),
    assets,
    owner,
    underConstructionKeys,
  });

  const previousPrimaryByCityId: Record<string, RegionalSpecializationId> = {};
  for (const c of activeCities) {
    const prevId = c.primarySpecialization?.id ?? c.specializations?.[0]?.id;
    if (prevId) {
      previousPrimaryByCityId[c.id] = prevId;
    }
  }

  const regionalSummary = evaluateRegionalWorld({
    worldState,
    cities: activeCities.map((c) => ({
      id: c.id,
      name: c.name,
      center: c.center,
      owner: c.owner,
      level: c.level,
    })),
    roads,
    connectivity: roadConnectivity,
    assets,
    underConstructionKeys,
    previousPrimaryByCityId,
    owner,
  });

  // City-level regional specialization flat & capacity bonuses (computed once per city, never duplicated in tile efficiency)
  let regionalBonusGold = 0;
  let regionalBonusScience = 0;
  let regionalStorageBonus = 0;
  let regionalFoodStorageBonus = 0;
  let regionalHousingBonus = 0;
  let regionalRoadUpkeepSaved = 0;

  if (owner === 'player') {
    for (const profile of Object.values(regionalSummary.cityProfilesById)) {
      const spec = profile.primarySpecialization;
      const tier = SPECIALIZATION_STAGE_META[spec.stage].tier;
      if (spec.id === 'agricultural') {
        regionalFoodStorageBonus += tier === 3 ? 40 : tier === 2 ? 24 : 12;
      } else if (spec.id === 'port') {
        regionalStorageBonus += tier === 3 ? 40 : tier === 2 ? 25 : 12;
        regionalBonusGold += tier === 3 ? 15 : tier === 2 ? 9 : 4;
      } else if (spec.id === 'commercial') {
        regionalBonusGold += tier === 3 ? 15 : tier === 2 ? 9 : 4;
      } else if (spec.id === 'urban') {
        regionalHousingBonus += tier === 3 ? 4 : tier === 2 ? 2 : 0;
        regionalBonusGold += tier === 3 ? 12 : tier === 2 ? 6 : 2;
      } else if (spec.id === 'academic') {
        regionalBonusScience += tier === 3 ? 6 : tier === 2 ? 3 : 1;
      } else if (spec.id === 'forestry') {
        regionalRoadUpkeepSaved += tier === 3 ? 3 : tier === 2 ? 2 : 1;
      }
    }
  }

  let effectGoldMult = eventGoldMultiplier;
  let effectFoodMult = eventFoodMultiplier;
  let effectScienceBonus = 0;
  let effectEffPenalty = 0;
  for (const eff of activeEffects) {
    if (typeof eff.goldMultiplierMod === 'number') {
      effectGoldMult *= eff.goldMultiplierMod;
    }
    if (typeof eff.foodMultiplierMod === 'number') {
      effectFoodMult *= eff.foodMultiplierMod;
    }
    if (typeof eff.scienceBonusPerTurn === 'number') {
      effectScienceBonus += eff.scienceBonusPerTurn;
    }
    if (typeof eff.efficiencyPenalty === 'number') {
      effectEffPenalty += eff.efficiencyPenalty;
    }
  }
  const effectFactor = Math.max(0.5, 1 - effectEffPenalty);

  let capacity = BASE_HOUSING_CAPACITY + regionalHousingBonus + mods.housingBonus;
  let storageBonus = mods.bonusStorage + regionalStorageBonus;
  let moduleFoodStorageBonus = 0;
  let urbanQualityScore = mods.urbanQualityBonus;

  let baseGoldGross = 8; // royal base tax
  let buildingMaint = 0;
  let baseWoodProd = 2; // basic gathering
  let baseStoneProd = 1;
  let baseFoodProd = 4;
  let baseOreProd = 0;
  let baseScienceProd = 1;
  let underConstructionCount = 0;

  const workOrders: BuildingWorkOrder[] = [];
  const completedBuildings: Array<{
    key: string;
    tile: PlacedHex;
    assetName: string;
    level: number;
    maxLevel: number;
    stats: EffectiveBuildingStats;
    installedModules: BuildingModuleId[];
    modEff: AggregatedTileModuleEffects;
    moduleConstructionInProgress: {
      moduleId: BuildingModuleId;
      labelPt: string;
      turnsRemaining: number;
      totalTurns: number;
    } | null;
    bDef: ReturnType<typeof getBuildingDefinition>;
    hasWaterNeighbor: boolean;
    upgradeInProgress: {
      targetLevel: number;
      turnsRemaining: number;
      totalTurns: number;
    } | null;
    locationFactor: number;
    locationNotesPt: string[];
    chainAdj: ChainAdjacencyEffectReport;
    logisticsFactor: number;
    logisticsEfficiencyPct: number;
    logisticsStatusPt: string;
    districtLabelPt: string | null;
    districtMultiplier: number;
    districtGoldFlat: number;
    hasRoad: boolean;
    roadLevel: number;
    roadBonusNotesPt: string[];
  }> = [];
  const buildingsByKey: Record<string, BuildingOperationReport> = {};

  const villagePopulationsByKey: Record<string, number> = {};
  const structureWorkerDemandsByKey: Record<string, number> = {};

  for (const tile of Object.values(worldState.hexes)) {
    if (tile.owner !== owner) continue;
    const key = hexKey(tile.q, tile.r);
    const assetName = assets[tile.structureIndex]?.name ?? '';
    const isDepletedNaturalForest = Boolean(
      tile.forestDepleted && assetName === DEPLETED_FOREST_ASSET_NAME
    );
    const isUnderConstruction = Boolean(underConstructionKeys?.has(key));
    const level = getBuildingLevel(tile);
    const stats = getEffectiveBuildingStats(assetName, level);
    const installedModules = getInstalledModules(tile);
    const modEff = aggregateTileModuleEffects(assetName, installedModules);
    const upgradeInfo = upgradingConstructionsByKey[key] ?? null;
    const rawModProgress = moduleConstructionsByKey[key] ?? null;
    const moduleConstructionInProgress = rawModProgress
      ? {
          moduleId: rawModProgress.moduleId,
          labelPt: BUILDING_MODULES[rawModProgress.moduleId]?.labelPt ?? rawModProgress.moduleId,
          turnsRemaining: rawModProgress.turnsRemaining,
          totalTurns: rawModProgress.totalTurns,
        }
      : null;

    const terrainInfo = getHexTerrainAndResource(tile.q, tile.r, tile);
    const strategic = getStrategicRegionInfo(tile.q, tile.r, tile);

    // Natural tile baseline yield + strategic rare node bonus
    if (terrainInfo.resourceType === 'wood' && !tile.forestDepleted) baseWoodProd += 1;
    if (terrainInfo.resourceType === 'food') baseFoodProd += 1;
    if (terrainInfo.resourceType === 'water') baseFoodProd += 1;
    if (terrainInfo.resourceType === 'ore') baseStoneProd += 2;

    baseGoldGross += strategic.bonusGoldPerTurn;
    baseFoodProd += strategic.bonusFoodPerTurn;
    baseOreProd += strategic.bonusOrePerTurn;
    baseScienceProd += strategic.bonusSciencePerTurn;

    const roadHere = roads[key];
    const hasRoadHere = Boolean(roadHere && roadHere.owner === owner);
    const roadLevelHere = hasRoadHere && roadHere ? roadHere.level : 0;

    if (isUnderConstruction) {
      underConstructionCount += 1;
      buildingsByKey[key] = {
        key,
        assetName,
        labelPt: stats.labelPt,
        level,
        maxLevel: stats.maxLevel,
        status: 'under_construction',
        statusLabelPt: 'Em construção',
        reasonPt: 'Aguardando conclusão da obra',
        seasonalNotePt: null,
        upgradeInProgress: upgradeInfo,
        installedModules,
        moduleConstructionInProgress,
        workersAssigned: 0,
        workersRequired: stats.workersRequired,
        localWorkersFromVillages: 0,
        locationEfficiencyPct: 100,
        effectiveEfficiencyPct: 0,
        locationBonusNotesPt: [],
        logisticsEfficiencyPct: 100,
        logisticsStatusPt: 'Em construção',
        districtLabelPt: null,
        hasRoad: hasRoadHere,
        roadLevel: roadLevelHere,
        roadBonusNotesPt: [],
        potentialProduction: { ...stats.production },
        actualProduction: { ...ZERO_PROD },
        effectiveHousingCapacity: 0,
        effectiveStorageGeneral: 0,
        effectiveStorageFood: 0,
        effectiveDefenseBonus: 0,
        effectiveMaintenanceGold: 0,
        inputConsumed: {},
      };
      continue;
    }

    const bDef = stats.baseDef;
    const isConstructedAsset =
      !isDepletedNaturalForest &&
      (stats.housingCapacity > 0 ||
        stats.workersRequired > 0 ||
        stats.storageBonus > 0 ||
        stats.defenseBonus > 0 ||
        stats.maintenanceGold > 0 ||
        hasAnyPositiveOutput(stats.production));

    if (!isConstructedAsset) continue;

    if (assetName === 'building-village') {
      villagePopulationsByKey[key] =
        typeof tile.meta?.localPopulation === 'number' && Number.isFinite(tile.meta.localPopulation)
          ? Math.max(1, tile.meta.localPopulation)
          : stats.housingCapacity + modEff.housingBonus;
    }
    if (stats.workersRequired > 0) {
      structureWorkerDemandsByKey[key] = stats.workersRequired;
    }

    capacity += stats.housingCapacity + modEff.housingBonus;
    storageBonus += stats.storageBonus + modEff.storageGeneralBonus;
    moduleFoodStorageBonus += modEff.storageFoodBonus;
    buildingMaint += Math.max(0, stats.maintenanceGold + modEff.maintenanceDelta);
    if (stats.housingCapacity > 0 && level >= 2) {
      urbanQualityScore += level - 1;
    }
    urbanQualityScore += modEff.urbanQualityBonus;

    const loc = computeBuildingLocationEfficiency(
      worldState,
      tile,
      assetName,
      assets,
      underConstructionKeys,
      roads,
      roadConnectivity,
      cityCenters,
      regionalSummary.hexBonusesByKey
    );

    const chainAdj = computeBuildingChainAdjacency({
      worldState,
      tile,
      assetName,
      assets,
      underConstructionKeys,
    });

    // Avoid double-counting locationFactor water note on Farm since Stage 2 irrigation replaces it cleanly
    let adjustedLocFactor = loc.factor;
    if (assetName === 'building-farm' && chainAdj.isIrrigated) {
      adjustedLocFactor = Math.max(0.75, Number((loc.factor - 0.15).toFixed(2)));
    }
    const mergedNotes = Array.from(new Set([...loc.notesPt, ...chainAdj.notesPt]));

    const logistics = computeBuildingLogistics({
      q: tile.q,
      r: tile.r,
      cityCenters,
      roads,
      connectivity: roadConnectivity,
    });

    const regBonus = regionalSummary.hexBonusesByKey[key];

    const hasWaterNeighbor = chainAdj.hasWaterAccess;

    workOrders.push({
      key,
      assetName,
      labelPt: stats.labelPt,
      role: bDef.role,
      workersRequired: stats.workersRequired,
    });

    completedBuildings.push({
      key,
      tile,
      assetName,
      level,
      maxLevel: stats.maxLevel,
      stats,
      installedModules,
      modEff,
      moduleConstructionInProgress,
      bDef,
      hasWaterNeighbor,
      upgradeInProgress: upgradeInfo,
      locationFactor: adjustedLocFactor,
      locationNotesPt: mergedNotes,
      chainAdj,
      logisticsFactor: Number(
        Math.min(1.45, logistics.factor + modEff.logisticsBonusPct).toFixed(2)
      ),
      logisticsEfficiencyPct: Math.round(
        Math.min(1.45, logistics.factor + modEff.logisticsBonusPct) * 100
      ),
      logisticsStatusPt: logistics.labelPt,
      districtLabelPt: regBonus?.districtLabelPt ?? null,
      districtMultiplier: regBonus?.multiplier ?? 1,
      districtGoldFlat: regBonus?.bonusGoldFlat ?? 0,
      hasRoad: logistics.hasRoad,
      roadLevel: logistics.roadLevel,
      roadBonusNotesPt: logistics.notesPt,
    });
  }

  const adjacencyPools = evaluateWorldAdjacencyPools({
    worldState,
    assets,
    owner,
    underConstructionKeys,
    villagePopulationsByKey,
    structureWorkerDemandsByKey,
  });

  // Military unit maintenance & population slot usage
  const milPower = computeFactionMilitaryPower(
    worldState,
    units,
    assets,
    owner,
    unlockedTechs,
    underConstructionKeys
  );
  const unitPopUsed = units
    .filter((u) => u.owner === owner && u.hp > 0)
    .reduce((sum, u) => sum + (u.type === 'knight' || u.type === 'warship' ? 2 : 1), 0);

  // 1. Allocate workers deterministically per building
  const workerAlloc = allocateWorkersToBuildings({
    population,
    unitWorkersUsed: unitPopUsed,
    expansionWorkersUsed,
    workOrders,
  });

  // 1b. Resolve finite Forest timber & fuel extraction for Serrarias and Fundições
  const timberConsumers: Array<{
    key: string;
    q: number;
    r: number;
    assetName: 'dirt-lumber' | 'building-smelter';
    woodDemand: number;
    allowOwnTile: boolean;
  }> = [];

  for (const item of completedBuildings) {
    const assign = workerAlloc.assignmentsByKey[item.key];
    const workerRatio = assign
      ? computeWorkerProductionScale(assign.assigned, assign.required)
      : 1;
    if (workerRatio <= 0) continue;
    if (item.assetName === 'dirt-lumber') {
      timberConsumers.push({
        key: item.key,
        q: item.tile.q,
        r: item.tile.r,
        assetName: 'dirt-lumber',
        woodDemand: DEFAULT_ADJACENCY_CONFIG.lumber.timberInputPerTurn * workerRatio,
        allowOwnTile: true,
      });
    } else if (item.assetName === 'building-smelter') {
      timberConsumers.push({
        key: item.key,
        q: item.tile.q,
        r: item.tile.r,
        assetName: 'building-smelter',
        woodDemand: DEFAULT_ADJACENCY_CONFIG.smelter.woodFuelPerTurn * workerRatio,
        allowOwnTile: false,
      });
    }
  }

  const forestTimber = resolveForestTimberChain({
    worldState,
    assets,
    consumers: timberConsumers,
    owner,
  });

  // Compute Smelter fuel ratios (prefer adjacent active Forest woodStock; fallback to kingdom wood stock)
  let remainingKingdomWoodFuel = Math.max(0, resources.wood || 0);
  const smelterFuelByKey: Record<
    string,
    { fuelRatio: number; usedForestFuel: boolean; kingdomFuelUsed: number; forestFuelUsed: number }
  > = {};
  let totalKingdomWoodFuelConsumed = 0;

  for (const item of completedBuildings) {
    if (item.assetName !== 'building-smelter') continue;
    const assign = workerAlloc.assignmentsByKey[item.key];
    const workerRatio = assign
      ? computeWorkerProductionScale(assign.assigned, assign.required)
      : 1;
    const neededFuel = DEFAULT_ADJACENCY_CONFIG.smelter.woodFuelPerTurn * workerRatio;
    const forestFuelUsed = forestTimber.timberSuppliedByConsumerKey[item.key] ?? 0;
    let kingdomFuelUsed = 0;
    if (forestFuelUsed < neededFuel && remainingKingdomWoodFuel > 0) {
      const deficit = neededFuel - forestFuelUsed;
      kingdomFuelUsed = Math.min(remainingKingdomWoodFuel, deficit);
      remainingKingdomWoodFuel -= kingdomFuelUsed;
      totalKingdomWoodFuelConsumed += kingdomFuelUsed;
    }
    const totalSupplied = forestFuelUsed + kingdomFuelUsed;
    const fuelRatio = neededFuel > 0 ? Math.min(1, totalSupplied / neededFuel) : 1;
    smelterFuelByKey[item.key] = {
      fuelRatio,
      usedForestFuel: forestFuelUsed > 0,
      kingdomFuelUsed,
      forestFuelUsed,
    };
  }

  const computeResilientMultiplier = (
    rawMult: number,
    resilience: number,
    extraMitigation = 0
  ): number => {
    if (rawMult >= 1) return rawMult;
    const totalResilience = Math.min(0.75, resilience + extraMitigation);
    return 1 - (1 - rawMult) * (1 - totalResilience);
  };

  const getRegionalSpecForHex = (key: string) => {
    const cityId = regionalSummary.controllingCityIdByHexKey[key];
    return cityId ? regionalSummary.cityProfilesById[cityId]?.primarySpecialization ?? null : null;
  };

  // Helper to resolve base ore/stone for Mountain deposits without creating extra TerrainTypes
  const getEffectiveMineDepositProduction = (item: (typeof completedBuildings)[number]) => {
    const baseMineDef = item.stats.baseDef.production;
    const levelScaleOre = baseMineDef.ore > 0 ? item.stats.production.ore / baseMineDef.ore : 1;
    const levelScaleStone =
      baseMineDef.stone > 0 ? item.stats.production.stone / baseMineDef.stone : 1;
    const dep = item.chainAdj.mountainDeposit;
    const template =
      dep === 'stone'
        ? DEFAULT_ADJACENCY_CONFIG.mine.stoneDepositOutput
        : dep === 'ore'
          ? DEFAULT_ADJACENCY_CONFIG.mine.oreDepositOutput
          : DEFAULT_ADJACENCY_CONFIG.mine.mixedDepositOutput;
    return {
      stone: template.stone * levelScaleStone,
      ore: template.ore * levelScaleOre,
    };
  };

  // 2. First pass: calculate ore extraction and pre-starvation food (including Farm -> Mill + Curral + Doca chains)
  let extractedOreThisTurn = baseOreProd;
  let preStarveFoodProd = baseFoodProd * seasonFoodMult * weatherFoodMult;
  const pass1Farms: Array<{ key: string; q: number; r: number; rawGrainProduced: number }> = [];
  const pass1Mills: Array<{
    key: string;
    q: number;
    r: number;
    assetName: 'building-mill' | 'building-watermill';
    processingCapacity: number;
    efficiencyMultiplier: number;
  }> = [];

  for (const item of completedBuildings) {
    const assign = workerAlloc.assignmentsByKey[item.key];
    const workerRatio = assign
      ? computeWorkerProductionScale(assign.assigned, assign.required)
      : 1;
    const rawScale =
      item.locationFactor *
      item.logisticsFactor *
      item.districtMultiplier *
      workerRatio *
      effectFactor;
    const citySpec = getRegionalSpecForHex(item.key);
    const citySpecTier = citySpec ? SPECIALIZATION_STAGE_META[citySpec.stage].tier : 0;

    if (item.assetName === 'building-mine' || item.stats.production.ore > 0) {
      const regMiningMult =
        citySpec?.id === 'mining' ? (citySpecTier === 3 ? 1.15 : citySpecTier === 2 ? 1.1 : 1.06) : 1;
      const effRainOrePass1 =
        weather.id === 'rain' || weather.id === 'storm'
          ? 1 - 0.15 * (1 - Math.min(0.75, item.modEff.rainStormResilience))
          : 1;
      const baseOre =
        item.assetName === 'building-mine'
          ? getEffectiveMineDepositProduction(item).ore
          : item.stats.production.ore;
      const chainMult = item.assetName === 'building-mine' ? item.chainAdj.netMultiplier : 1;
      extractedOreThisTurn +=
        baseOre *
        (1 + item.modEff.prodPct.ore) *
        rawScale *
        chainMult *
        mods.stoneOreMultiplier *
        mods.oreBonusMultiplier *
        regMiningMult *
        effRainOrePass1;
    }

    if (item.stats.production.food > 0) {
      const waterMitigation =
        weather.id === 'drought_weather' && item.hasWaterNeighbor ? 0.35 : 0;
      const techMitigation = unlockedTechs.includes('agriculture') ? 0.1 : 0;
      const regionalFoodMitigation =
        citySpec?.id === 'agricultural'
          ? citySpecTier === 3
            ? 0.15
            : citySpecTier === 2
              ? 0.1
              : 0.05
          : 0;
      const seasonModResilience =
        item.modEff.seasonalResilience +
        (season === 'winter' ? item.modEff.winterResilience : 0);
      const weatherModResilience =
        item.modEff.seasonalResilience +
        (weather.id === 'frost' ? item.modEff.winterResilience : 0) +
        (weather.id === 'drought_weather' ? item.modEff.droughtResilience : 0) +
        (weather.id === 'rain' || weather.id === 'storm'
          ? item.modEff.rainStormResilience
          : 0);
      const springSummerBonus =
        season === 'spring' || season === 'summer'
          ? item.modEff.springSummerFoodPct
          : 0;
      const effSeasonFood = computeResilientMultiplier(
        seasonFoodMult,
        item.stats.seasonalResilience + seasonModResilience,
        techMitigation + regionalFoodMitigation
      );
      const effWeatherFood = computeResilientMultiplier(
        weatherFoodMult,
        item.stats.seasonalResilience + weatherModResilience,
        waterMitigation
      );
      const climateFactor =
        (1 + item.modEff.prodPct.food + springSummerBonus) *
        mods.foodMultiplier *
        effectFoodMult *
        effSeasonFood *
        effWeatherFood;

      if (item.assetName === 'building-farm') {
        const rawGrain =
          item.stats.production.food *
          climateFactor *
          rawScale *
          item.chainAdj.terrainMultiplier *
          item.chainAdj.netMultiplier;
        pass1Farms.push({
          key: item.key,
          q: item.tile.q,
          r: item.tile.r,
          rawGrainProduced: Math.max(0, rawGrain),
        });
      } else if (
        item.assetName === 'building-mill' ||
        item.assetName === 'building-watermill'
      ) {
        const isWaterMill = item.assetName === 'building-watermill';
        const hasWater = !isWaterMill || item.chainAdj.hasWaterAccess;
        const baseCap = isWaterMill
          ? DEFAULT_ADJACENCY_CONFIG.mill.watermillGrainCapacity
          : DEFAULT_ADJACENCY_CONFIG.mill.millGrainCapacity;
        const capScale = item.stats.production.food / Math.max(1, item.stats.baseDef.production.food);
        const cap = hasWater
          ? baseCap * capScale * workerRatio * item.chainAdj.netMultiplier
          : 0;
        pass1Mills.push({
          key: item.key,
          q: item.tile.q,
          r: item.tile.r,
          assetName: item.assetName,
          processingCapacity: Math.max(0, cap),
          efficiencyMultiplier:
            item.locationFactor *
            item.logisticsFactor *
            item.districtMultiplier *
            effectFactor *
            (1 + item.modEff.prodPct.food),
        });
      } else if (item.assetName === 'building-sheep') {
        const pastureRatio =
          adjacencyPools.pasture.consumersByKey[item.key]?.fulfillmentRatio ?? 0;
        preStarveFoodProd +=
          item.stats.production.food *
          climateFactor *
          rawScale *
          pastureRatio *
          item.chainAdj.netMultiplier;
      } else if (item.assetName === 'building-dock') {
        const fishingRatio =
          adjacencyPools.fishing.consumersByKey[item.key]?.fulfillmentRatio ?? 0;
        preStarveFoodProd += item.stats.production.food * climateFactor * rawScale * fishingRatio;
      } else {
        preStarveFoodProd += item.stats.production.food * climateFactor * rawScale;
      }
    }
  }

  const pass1GrainChain = solveGrainProcessingChain({
    worldState,
    farms: pass1Farms,
    mills: pass1Mills,
  });
  for (const excess of Object.values(pass1GrainChain.excessGrainByFarmKey)) {
    preStarveFoodProd += excess;
  }
  for (const procFood of Object.values(pass1GrainChain.processedFoodByMillKey)) {
    preStarveFoodProd += procFood;
  }

  // 3. Evaluate food balance & starvation factor (includes 1-turn safety margin grace period)
  const popDynamicsPreview = evaluatePopulationDynamics({
    population,
    housingCapacity: capacity,
    workerAllocation: workerAlloc,
    foodStock: resources.food,
    foodProduced: Math.round(preStarveFoodProd),
    foodDeficitTurns,
    activeEffects,
    foodDemandMult: seasonFoodDemandMult,
    seasonalPopGrowthBonusMod: seasonPopGrowthMod,
    urbanQualityScore,
    roadConnectivityScore: roadConnectivity.networks.filter((n) => n.connectedCityIds.length >= 2).length,
    stabilityBonus: activeCities.some((c) => c.connectedCityIds.length > 0) ? 1 : 0,
  });
  const starvationFactor = popDynamicsPreview.starvationFactor;

  // 4. Compute input availability ratio (e.g. Ore -> Metal for Fundições)
  let totalOreDemand = 0;
  for (const item of completedBuildings) {
    const reqOre = item.bDef.inputConsumption?.ore ?? 0;
    if (reqOre <= 0) continue;
    const assign = workerAlloc.assignmentsByKey[item.key];
    const workerRatio = assign ? assign.ratio : 1;
    if (workerRatio <= 0) continue;
    const fuelInfo = smelterFuelByKey[item.key];
    if (fuelInfo && fuelInfo.fuelRatio <= 0.01) continue;
    totalOreDemand += reqOre * workerRatio * (fuelInfo ? fuelInfo.fuelRatio : 1);
  }

  const availableOrePool = Math.max(0, (resources.ore || 0) + Math.floor(extractedOreThisTurn));
  const oreInputRatio =
    totalOreDemand > 0 ? Math.min(1, availableOrePool / totalOreDemand) : 1;

  // 5. Final per-building production & status aggregation (pre-Market so Markets observe active producers)
  const finalFarms: Array<{ key: string; q: number; r: number; rawGrainProduced: number }> = [];
  const finalMills: Array<{
    key: string;
    q: number;
    r: number;
    assetName: 'building-mill' | 'building-watermill';
    processingCapacity: number;
    efficiencyMultiplier: number;
  }> = [];

  interface PendingBuildingOutput {
    item: (typeof completedBuildings)[number];
    workersAssigned: number;
    workersRequired: number;
    workerRatio: number;
    inputRatio: number;
    fuelRatio: number;
    timberRatio: number;
    pastureRatio: number;
    fishingRatio: number;
    combinedFactor: number;
    effSeasonFood: number;
    effWeatherFood: number;
    effSeasonWood: number;
    effWeatherWood: number;
    effSeasonGold: number;
    effWeatherGold: number;
    effRainStoneOre: number;
    seasonModRes: number;
    weatherModRes: number;
    regCommerceMult: number;
    actualProduction: BuildingProduction;
    inputConsumed: Partial<Record<InputResourceKey, number>>;
    oreUsed: number;
  }

  const pendingOutputs: PendingBuildingOutput[] = [];

  for (const item of completedBuildings) {
    const assign = workerAlloc.assignmentsByKey[item.key];
    const workersAssigned = assign ? assign.assigned : 0;
    const workersRequired = assign ? assign.required : item.stats.workersRequired;
    const workerRatio = assign
      ? computeWorkerProductionScale(assign.assigned, assign.required)
      : 1;

    const reqOreInput = item.bDef.inputConsumption?.ore ?? 0;
    const inputRatio = reqOreInput > 0 ? oreInputRatio : 1;
    const fuelInfo = smelterFuelByKey[item.key];
    const fuelRatio = item.assetName === 'building-smelter' ? (fuelInfo?.fuelRatio ?? 0) : 1;

    let timberRatio = 1;
    if (item.assetName === 'dirt-lumber') {
      const neededTimber = DEFAULT_ADJACENCY_CONFIG.lumber.timberInputPerTurn * workerRatio;
      const suppliedTimber = forestTimber.timberSuppliedByConsumerKey[item.key] ?? 0;
      timberRatio = neededTimber > 0 ? Math.min(1, suppliedTimber / neededTimber) : 0;
    }

    const pastureRatio =
      item.assetName === 'building-sheep'
        ? (adjacencyPools.pasture.consumersByKey[item.key]?.fulfillmentRatio ?? 0)
        : 1;
    const fishingRatio =
      item.assetName === 'building-dock'
        ? (adjacencyPools.fishing.consumersByKey[item.key]?.fulfillmentRatio ?? 0)
        : 1;

    const combinedFactor =
      item.locationFactor *
      item.logisticsFactor *
      item.districtMultiplier *
      workerRatio *
      inputRatio *
      fuelRatio *
      timberRatio *
      pastureRatio *
      fishingRatio *
      starvationFactor *
      effectFactor;

    const citySpec = getRegionalSpecForHex(item.key);
    const citySpecTier = citySpec ? SPECIALIZATION_STAGE_META[citySpec.stage].tier : 0;
    const regMiningMult =
      citySpec?.id === 'mining' ? (citySpecTier === 3 ? 1.15 : citySpecTier === 2 ? 1.1 : 1.06) : 1;
    const regForestryMult =
      citySpec?.id === 'forestry' ? (citySpecTier === 3 ? 1.15 : citySpecTier === 2 ? 1.1 : 1.06) : 1;
    const regCommerceMult =
      citySpec?.id === 'commercial' && item.bDef.role === 'commerce'
        ? citySpecTier === 3
          ? 1.08
          : citySpecTier === 2
            ? 1.05
            : 1.03
        : 1;
    const regFoodMitigation =
      citySpec?.id === 'agricultural'
        ? citySpecTier === 3
          ? 0.15
          : citySpecTier === 2
            ? 0.1
            : 0.05
        : 0;

    const waterMitigation =
      weather.id === 'drought_weather' && item.hasWaterNeighbor ? 0.35 : 0;
    const techAgriMitigation = unlockedTechs.includes('agriculture') ? 0.1 : 0;
    const seasonModRes =
      item.modEff.seasonalResilience +
      (season === 'winter' ? item.modEff.winterResilience : 0);
    const weatherModRes =
      item.modEff.seasonalResilience +
      (weather.id === 'frost' ? item.modEff.winterResilience : 0) +
      (weather.id === 'drought_weather' ? item.modEff.droughtResilience : 0) +
      (weather.id === 'rain' || weather.id === 'storm'
        ? item.modEff.rainStormResilience
        : 0);
    const springSummerFoodMod =
      season === 'spring' || season === 'summer' ? item.modEff.springSummerFoodPct : 0;

    const effSeasonFood = computeResilientMultiplier(
      seasonFoodMult,
      item.stats.seasonalResilience + seasonModRes,
      techAgriMitigation + regFoodMitigation
    );
    const effWeatherFood = computeResilientMultiplier(
      weatherFoodMult,
      item.stats.seasonalResilience + weatherModRes,
      waterMitigation
    );
    const effSeasonWood = computeResilientMultiplier(
      seasonWoodMult,
      item.stats.seasonalResilience + seasonModRes
    );
    const effWeatherWood = computeResilientMultiplier(
      weatherWoodMult,
      item.stats.seasonalResilience + weatherModRes
    );
    const effSeasonGold =
      item.bDef.role === 'commerce'
        ? computeResilientMultiplier(
            seasonTradeMult,
            item.stats.seasonalResilience + seasonModRes
          )
        : 1;
    const effWeatherGold = computeResilientMultiplier(
      weatherGoldMult,
      item.stats.seasonalResilience + weatherModRes
    );

    const effRainStoneOre =
      weather.id === 'rain' || weather.id === 'storm'
        ? 1 - 0.15 * (1 - Math.min(0.75, item.modEff.rainStormResilience))
        : 1;

    const mineBase =
      item.assetName === 'building-mine'
        ? getEffectiveMineDepositProduction(item)
        : { stone: item.stats.production.stone, ore: item.stats.production.ore };

    const smelterFuelBonus =
      item.assetName === 'building-smelter' && fuelInfo?.usedForestFuel
        ? 1 + DEFAULT_ADJACENCY_CONFIG.smelter.forestFuelBonus
        : 1;

    const chainNetMult =
      item.assetName === 'building-farm' ||
      item.assetName === 'building-sheep' ||
      item.assetName === 'building-mine'
        ? item.chainAdj.netMultiplier
        : 1;
    const terrainMult =
      item.assetName === 'building-farm' ? item.chainAdj.terrainMultiplier : 1;

    const actualProduction: BuildingProduction = {
      gold:
        item.assetName === 'building-market'
          ? 0 // Resolved after producers via solveLocalCommerceChain
          : item.assetName === 'building-mill' || item.assetName === 'building-watermill'
            ? 0 // Resolved via solveGrainProcessingChain
            : Math.round(
                item.stats.production.gold *
                  (1 + item.modEff.prodPct.gold) *
                  mods.goldMultiplier *
                  effectGoldMult *
                  effSeasonGold *
                  effWeatherGold *
                  regCommerceMult *
                  combinedFactor *
                  chainNetMult
              ) + (workerRatio > 0 ? item.districtGoldFlat + item.modEff.flatGold : 0),
      wood: Math.round(
        item.stats.production.wood *
          (1 + item.modEff.prodPct.wood) *
          effSeasonWood *
          effWeatherWood *
          regForestryMult *
          combinedFactor
      ),
      stone: Math.round(
        mineBase.stone *
          (1 + item.modEff.prodPct.stone) *
          mods.stoneOreMultiplier *
          regMiningMult *
          effRainStoneOre *
          combinedFactor *
          chainNetMult
      ),
      food:
        item.assetName === 'building-farm' ||
        item.assetName === 'building-mill' ||
        item.assetName === 'building-watermill'
          ? 0 // Resolved via solveGrainProcessingChain
          : Math.round(
              item.stats.production.food *
                (1 + item.modEff.prodPct.food + springSummerFoodMod) *
                mods.foodMultiplier *
                effectFoodMult *
                effSeasonFood *
                effWeatherFood *
                combinedFactor *
                chainNetMult *
                terrainMult
            ),
      ore: Math.round(
        mineBase.ore *
          (1 + item.modEff.prodPct.ore) *
          mods.stoneOreMultiplier *
          mods.oreBonusMultiplier *
          regMiningMult *
          effRainStoneOre *
          combinedFactor *
          chainNetMult
      ),
      metal: Math.round(
        item.stats.production.metal *
          (1 + item.modEff.prodPct.metal) *
          regMiningMult *
          combinedFactor *
          smelterFuelBonus
      ),
      science:
        Math.round(
          item.stats.production.science *
            (1 + item.modEff.prodPct.science) *
            combinedFactor
        ) + (workerRatio > 0 ? item.modEff.flatScience : 0),
    };

    if (item.assetName === 'building-farm') {
      const rawGrain =
        item.stats.production.food *
        (1 + item.modEff.prodPct.food + springSummerFoodMod) *
        mods.foodMultiplier *
        effectFoodMult *
        effSeasonFood *
        effWeatherFood *
        combinedFactor *
        chainNetMult *
        terrainMult;
      finalFarms.push({
        key: item.key,
        q: item.tile.q,
        r: item.tile.r,
        rawGrainProduced: Math.max(0, rawGrain),
      });
    } else if (
      item.assetName === 'building-mill' ||
      item.assetName === 'building-watermill'
    ) {
      const isWaterMill = item.assetName === 'building-watermill';
      const hasWater = !isWaterMill || item.chainAdj.hasWaterAccess;
      const baseCap = isWaterMill
        ? DEFAULT_ADJACENCY_CONFIG.mill.watermillGrainCapacity
        : DEFAULT_ADJACENCY_CONFIG.mill.millGrainCapacity;
      const capScale = item.stats.production.food / Math.max(1, item.stats.baseDef.production.food);
      const cap = hasWater
        ? baseCap *
          capScale *
          workerRatio *
          starvationFactor *
          item.chainAdj.netMultiplier
        : 0;
      finalMills.push({
        key: item.key,
        q: item.tile.q,
        r: item.tile.r,
        assetName: item.assetName,
        processingCapacity: Math.max(0, cap),
        efficiencyMultiplier:
          item.locationFactor *
          item.logisticsFactor *
          item.districtMultiplier *
          effectFactor *
          (1 + item.modEff.prodPct.food),
      });
    }

    const oreUsed =
      reqOreInput > 0
        ? Math.round(reqOreInput * workerRatio * inputRatio * fuelRatio * 10) / 10
        : 0;
    const inputConsumed: Partial<Record<InputResourceKey, number>> = {};
    if (reqOreInput > 0) inputConsumed.ore = Math.round(oreUsed);
    if (item.assetName === 'dirt-lumber') {
      const consumedTimber = forestTimber.timberSuppliedByConsumerKey[item.key] ?? 0;
      if (consumedTimber > 0) inputConsumed.wood = Math.round(consumedTimber);
    } else if (item.assetName === 'building-smelter' && fuelInfo) {
      const totalFuelUsed = fuelInfo.forestFuelUsed + fuelInfo.kingdomFuelUsed;
      if (totalFuelUsed > 0) inputConsumed.wood = Math.round(totalFuelUsed);
    }

    pendingOutputs.push({
      item,
      workersAssigned,
      workersRequired,
      workerRatio,
      inputRatio,
      fuelRatio,
      timberRatio,
      pastureRatio,
      fishingRatio,
      combinedFactor,
      effSeasonFood,
      effWeatherFood,
      effSeasonWood,
      effWeatherWood,
      effSeasonGold,
      effWeatherGold,
      effRainStoneOre,
      seasonModRes,
      weatherModRes,
      regCommerceMult,
      actualProduction,
      inputConsumed,
      oreUsed,
    });
  }

  // 5b. Resolve final Grain -> Mill transformation
  const grainChain = solveGrainProcessingChain({
    worldState,
    farms: finalFarms,
    mills: finalMills,
  });

  for (const po of pendingOutputs) {
    if (po.item.assetName === 'building-farm') {
      po.actualProduction.food = Math.round(
        grainChain.excessGrainByFarmKey[po.item.key] ?? 0
      );
    } else if (
      po.item.assetName === 'building-mill' ||
      po.item.assetName === 'building-watermill'
    ) {
      const processedGrain = grainChain.grainProcessedByMillKey[po.item.key] ?? 0;
      po.actualProduction.food = grainChain.processedFoodByMillKey[po.item.key] ?? 0;
      po.actualProduction.gold =
        (grainChain.processedGoldByMillKey[po.item.key] ?? 0) +
        (processedGrain > 0 && po.workerRatio > 0
          ? po.item.districtGoldFlat + po.item.modEff.flatGold
          : 0);
      if (processedGrain > 0) {
        po.inputConsumed.food = Math.round(processedGrain);
      }
    }
  }

  // 5c. Resolve local Commerce chain for Markets (never produces resources, shares demand & values variety)
  const marketInputs: Array<{
    key: string;
    q: number;
    r: number;
    capacityWeight: number;
    workerRatio: number;
  }> = [];
  const activeProducersByKey: Record<
    string,
    { assetName: string; q: number; r: number; isActive: boolean }
  > = {};
  const housingDemandByKey: Record<
    string,
    { assetName: string; q: number; r: number; weight: number }
  > = {};

  for (const po of pendingOutputs) {
    const { item, actualProduction } = po;
    if (item.assetName === 'building-market') {
      marketInputs.push({
        key: item.key,
        q: item.tile.q,
        r: item.tile.r,
        capacityWeight: item.level,
        workerRatio: po.workerRatio,
      });
    } else {
      const hasOutput =
        actualProduction.food > 0 ||
        actualProduction.wood > 0 ||
        actualProduction.stone > 0 ||
        actualProduction.ore > 0 ||
        actualProduction.metal > 0 ||
        actualProduction.gold > 0 ||
        (item.assetName === 'building-farm' &&
          (grainChain.grainConsumedByFarmKey[item.key] ?? 0) > 0);
      activeProducersByKey[item.key] = {
        assetName: item.assetName,
        q: item.tile.q,
        r: item.tile.r,
        isActive: hasOutput,
      };
    }

    if (item.assetName === 'building-village') {
      housingDemandByKey[item.key] = {
        assetName: item.assetName,
        q: item.tile.q,
        r: item.tile.r,
        weight: DEFAULT_ADJACENCY_CONFIG.commerce.villageDemandWeight * (1 + (item.level - 1) * 0.3),
      };
    } else if (
      item.assetName === 'building-castle' ||
      item.assetName === 'unit-mansion'
    ) {
      housingDemandByKey[item.key] = {
        assetName: item.assetName,
        q: item.tile.q,
        r: item.tile.r,
        weight: 0.75,
      };
    } else if (
      item.assetName === 'building-house' ||
      item.assetName === 'building-cabin'
    ) {
      housingDemandByKey[item.key] = {
        assetName: item.assetName,
        q: item.tile.q,
        r: item.tile.r,
        weight: DEFAULT_ADJACENCY_CONFIG.commerce.housingDemandWeight,
      };
    }
  }

  const commerceChain = solveLocalCommerceChain({
    worldState,
    markets: marketInputs,
    activeProducersByKey,
    housingDemandByKey,
  });

  for (const po of pendingOutputs) {
    if (po.item.assetName === 'building-market') {
      const marketRep = commerceChain.marketsByKey[po.item.key];
      const baseCommerceGold = marketRep?.commercialGold ?? 0;
      po.actualProduction = {
        gold:
          po.workerRatio > 0
            ? Math.round(
                baseCommerceGold *
                  (1 + po.item.modEff.prodPct.gold) *
                  mods.goldMultiplier *
                  effectGoldMult *
                  po.effSeasonGold *
                  po.effWeatherGold *
                  po.regCommerceMult *
                  po.item.logisticsFactor *
                  po.item.districtMultiplier *
                  starvationFactor *
                  effectFactor
              ) +
              po.item.districtGoldFlat +
              po.item.modEff.flatGold
            : 0,
        wood: 0,
        stone: 0,
        food: 0,
        ore: 0,
        metal: 0,
        science: 0,
      };
    }
  }

  // 5d. Aggregate final building production, statuses & reports
  let buildingGoldGross = 0;
  let buildingWoodProd = 0;
  let buildingStoneProd = 0;
  let buildingFoodProd = 0;
  let buildingOreProd = 0;
  let buildingMetalProd = 0;
  let buildingScienceProd = 0;
  let totalOreConsumed = 0;

  const attentionHexKeys: string[] = [];
  const operationCounts = {
    operating: 0,
    partial: 0,
    idle: 0,
    underConstruction: underConstructionCount,
  };

  for (const po of pendingOutputs) {
    const {
      item,
      workersAssigned,
      workersRequired,
      workerRatio,
      inputRatio,
      fuelRatio,
      timberRatio,
      pastureRatio,
      fishingRatio,
      combinedFactor,
      effSeasonFood,
      effWeatherFood,
      effSeasonWood,
      effWeatherWood,
      effSeasonGold,
      effWeatherGold,
      effRainStoneOre,
      seasonModRes,
      weatherModRes,
      actualProduction,
      inputConsumed,
      oreUsed,
    } = po;
    const reqOreInput = item.bDef.inputConsumption?.ore ?? 0;

    totalOreConsumed += oreUsed;
    buildingGoldGross += actualProduction.gold;
    buildingWoodProd += actualProduction.wood;
    buildingStoneProd += actualProduction.stone;
    buildingFoodProd += actualProduction.food;
    buildingOreProd += actualProduction.ore;
    buildingMetalProd += actualProduction.metal;
    buildingScienceProd += actualProduction.science;

    // Seasonal note for contextual UI
    let seasonalNotePt: string | null = null;
    if (seasonProfile) {
      if (item.stats.production.food > 0) {
        const netFoodFactor = effSeasonFood * effWeatherFood;
        if (Math.abs(netFoodFactor - 1) >= 0.04) {
          const pct = Math.round((netFoodFactor - 1) * 100);
          const totalProtPct = Math.min(
            75,
            Math.round(
              (item.stats.seasonalResilience + Math.max(seasonModRes, weatherModRes)) * 100
            )
          );
          seasonalNotePt =
            pct >= 0
              ? `${seasonProfile.labelPt}: +${pct}% Alimento`
              : `${seasonProfile.labelPt}: ${pct}% Alimento${
                  totalProtPct > 0 ? ` (protege ${totalProtPct}%)` : ''
                }`;
        }
      } else if (item.stats.production.wood > 0 && Math.abs(effSeasonWood * effWeatherWood - 1) >= 0.04) {
        const pct = Math.round((effSeasonWood * effWeatherWood - 1) * 100);
        seasonalNotePt = `${seasonProfile.labelPt}: ${pct >= 0 ? '+' : ''}${pct}% Madeira`;
      } else if (item.bDef.role === 'commerce' && Math.abs(effSeasonGold * effWeatherGold - 1) >= 0.04) {
        const pct = Math.round((effSeasonGold * effWeatherGold - 1) * 100);
        seasonalNotePt = `${seasonProfile.labelPt}: ${pct >= 0 ? '+' : ''}${pct}% Comércio`;
      } else if ((item.stats.production.ore > 0 || item.stats.production.stone > 0) && effRainStoneOre < 0.99) {
        const pct = Math.round((effRainStoneOre - 1) * 100);
        const prot = Math.min(75, Math.round(item.modEff.rainStormResilience * 100));
        seasonalNotePt = `${weather.labelPt}: ${pct}% Mineração${
          prot > 0 ? ` (protege ${prot}%)` : ''
        }`;
      }
    }

    // Determine clear status & causal reason
    let status: BuildingOperationStatus = 'operating';
    let statusLabelPt = 'Operando';
    let reasonPt: string | null = null;

    if (workersRequired > 0 && workersAssigned === 0) {
      status = 'idle';
      statusLabelPt = 'Parado';
      reasonPt = `Sem trabalhadores (0/${workersRequired}): construa Casas`;
    } else if (reqOreInput > 0 && inputRatio <= 0.01) {
      status = 'idle';
      statusLabelPt = 'Parado';
      reasonPt = 'Falta de minério para fundir metal';
    } else if (item.assetName === 'building-smelter' && fuelRatio <= 0.01) {
      status = 'idle';
      statusLabelPt = 'Parado';
      reasonPt = 'Falta de combustível (madeira) para fundição';
    } else if (item.assetName === 'dirt-lumber' && timberRatio <= 0.01) {
      status = 'idle';
      statusLabelPt = 'Parado';
      reasonPt = 'Floresta esgotada: sem madeira disponível';
    } else if (item.assetName === 'building-sheep' && pastureRatio <= 0.01) {
      status = 'idle';
      statusLabelPt = 'Parado';
      reasonPt = 'Sem pasto em Planície adjacente';
    } else if (item.assetName === 'building-dock' && fishingRatio <= 0.01) {
      status = 'idle';
      statusLabelPt = 'Parado';
      reasonPt = 'Sem capacidade de pesca disponível';
    } else if (
      item.assetName === 'building-watermill' &&
      !item.chainAdj.hasWaterAccess
    ) {
      status = 'idle';
      statusLabelPt = 'Parado';
      reasonPt = 'Sem Água adjacente para mover a roda';
    } else if (
      (item.assetName === 'building-mill' || item.assetName === 'building-watermill') &&
      (grainChain.grainProcessedByMillKey[item.key] ?? 0) <= 0.01
    ) {
      status = 'idle';
      statusLabelPt = 'Parado';
      reasonPt = 'Sem Fazenda adjacente para fornecer grão';
    } else if (workersRequired > 0 && workerRatio < 1) {
      status = 'partial';
      statusLabelPt = 'Parcial';
      reasonPt = `Equipe incompleta (${workersAssigned}/${workersRequired} trabalhadores)`;
    } else if (reqOreInput > 0 && inputRatio < 0.99) {
      status = 'partial';
      statusLabelPt = 'Parcial';
      reasonPt = 'Suprimento de minério insuficiente';
    } else if (item.assetName === 'building-smelter' && fuelRatio < 0.99) {
      status = 'partial';
      statusLabelPt = 'Parcial';
      reasonPt = 'Combustível de madeira insuficiente';
    } else if (item.assetName === 'dirt-lumber' && timberRatio < 0.99) {
      status = 'partial';
      statusLabelPt = 'Parcial';
      reasonPt = 'Estoque de madeira da floresta quase esgotado';
    } else if (item.assetName === 'building-sheep' && pastureRatio < 0.99) {
      status = 'partial';
      statusLabelPt = 'Parcial';
      reasonPt = 'Pasto compartilhado insuficiente';
    } else if (item.assetName === 'building-dock' && fishingRatio < 0.99) {
      status = 'partial';
      statusLabelPt = 'Parcial';
      reasonPt = 'Pesca compartilhada ou poluída';
    } else if (starvationFactor < 1) {
      status = 'partial';
      statusLabelPt = 'Parcial';
      reasonPt = 'Escassez de alimento reduz o ritmo';
    } else if (effectFactor < 1) {
      status = 'partial';
      statusLabelPt = 'Parcial';
      reasonPt = 'Evento ativo reduz produtividade';
    }

    if (item.upgradeInProgress && status === 'operating') {
      statusLabelPt = `Melhorando p/ Nv.${item.upgradeInProgress.targetLevel}`;
      reasonPt = `Obra de evolução (${item.upgradeInProgress.turnsRemaining}/${item.upgradeInProgress.totalTurns}t)`;
    } else if (item.moduleConstructionInProgress && status === 'operating') {
      statusLabelPt = `Instalando ${item.moduleConstructionInProgress.labelPt}`;
      reasonPt = `Módulo (${item.moduleConstructionInProgress.turnsRemaining}/${item.moduleConstructionInProgress.totalTurns}t)`;
    }

    if (status === 'operating') operationCounts.operating += 1;
    else if (status === 'partial') operationCounts.partial += 1;
    else if (status === 'idle') operationCounts.idle += 1;

    if (status === 'idle' || status === 'partial') {
      attentionHexKeys.push(item.key);
    }

    const COMMERCE_CATEGORY_LABELS_PT: Record<LocalCommerceProductCategory, string> = {
      grain: 'Grãos',
      flour: 'Farinha',
      livestock: 'Pecuária',
      lumber: 'Madeira',
      minerals: 'Minerais',
      metal: 'Metal',
      fish: 'Pescado',
      maritime: 'Comércio Marítimo',
    };

    const localWorkers = adjacencyPools.workers.consumersByKey[item.key]?.allocated ?? 0;
    const positiveSet = new Set<string>(item.chainAdj.positiveNeighborKeys);
    const penaltySet = new Set<string>(item.chainAdj.penaltyNeighborKeys);

    // Worker origin summary
    let workerOriginPt: string | null = null;
    if (workersRequired > 0) {
      if (workersAssigned === 0) {
        workerOriginPt = `Sem trabalhadores (0/${workersRequired})`;
      } else if (localWorkers >= workersAssigned) {
        workerOriginPt = `Vila adjacente (${workersAssigned}/${workersRequired})`;
      } else if (localWorkers > 0) {
        workerOriginPt = `Vila adj. (${Math.round(localWorkers * 10) / 10}) + Reino (${workersAssigned}/${workersRequired})`;
      } else {
        workerOriginPt = `População do reino (${workersAssigned}/${workersRequired})`;
      }
    }

    // Chain-specific capacity, resource origin & neighbor highlights
    let capacitySummaryPt: string | null = null;
    let resourceOriginPt: string | null = null;
    const bonusSummaryPt: string[] = [...item.chainAdj.bonusNotesPt];
    const penaltySummaryPt: string[] = [...item.chainAdj.penaltyNotesPt];
    let marketDetails: MarketInspectionDetails | undefined;

    if (item.assetName === 'building-farm') {
      const consumedGrain = grainChain.grainConsumedByFarmKey[item.key] ?? 0;
      const excessGrain = grainChain.excessGrainByFarmKey[item.key] ?? 0;
      const irr = adjacencyPools.irrigationByKey[item.key];
      resourceOriginPt =
        getHexTerrainAndResource(item.tile.q, item.tile.r, item.tile).terrainType === 'fertile'
          ? 'Solo Fértil (100%)'
          : 'Planície (68%)';
      capacitySummaryPt =
        consumedGrain > 0
          ? `Grão: ${Math.round(consumedGrain)} moído · ${Math.round(excessGrain)} bruto`
          : irr?.isIrrigated
            ? `Irrigação: ${irr.irrigationCapacity}/${irr.maxCap}`
            : null;
    } else if (
      item.assetName === 'building-mill' ||
      item.assetName === 'building-watermill'
    ) {
      const millSpec = finalMills.find((m) => m.key === item.key);
      const procGrain = grainChain.grainProcessedByMillKey[item.key] ?? 0;
      const maxCap = Math.round(millSpec?.processingCapacity ?? 0);
      capacitySummaryPt = `Capacidade: ${Math.round(procGrain)}/${maxCap} grão/t`;
      resourceOriginPt =
        procGrain > 0
          ? 'Grão: Fazenda adjacente'
          : item.assetName === 'building-watermill' && !item.chainAdj.hasWaterAccess
            ? 'Grão/Água: exige Água adjacente'
            : 'Grão: sem Fazenda adjacente';
    } else if (item.assetName === 'building-sheep') {
      const pAlloc = adjacencyPools.pasture.consumersByKey[item.key];
      const alloc = pAlloc?.allocated ?? 0;
      const dem = pAlloc?.demand ?? DEFAULT_ADJACENCY_CONFIG.sheep.pastureDemand;
      capacitySummaryPt = `Pasto: ${Math.round(alloc * 10) / 10}/${dem}`;
      resourceOriginPt =
        alloc > 0 ? 'Pasto: Planície adjacente' : 'Pasto: sem Planície aberta';
      if ((pAlloc?.sharedWithConsumerKeys.length ?? 0) > 0) {
        penaltySummaryPt.push(
          `Pasto dividido com ${pAlloc!.sharedWithConsumerKeys.length} estrutura(s)`
        );
      }
    } else if (item.assetName === 'dirt-lumber') {
      const timberSupplied = forestTimber.timberSuppliedByConsumerKey[item.key] ?? 0;
      const activeForestStocks = item.chainAdj.activeForestNeighborKeys
        .map((fk) => getForestWoodStock(worldState.hexes[fk]))
        .reduce((a, b) => a + b, 0);
      const ownStock = getForestWoodStock(item.tile);
      const availableTotal = activeForestStocks > 0 ? activeForestStocks : ownStock;
      capacitySummaryPt = `Estoque florestal: ${Math.round(availableTotal)} mad. (${Math.round(timberSupplied)}/t)`;
      resourceOriginPt =
        item.chainAdj.activeForestNeighborKeys.length > 0
          ? 'Madeira: Floresta adjacente'
          : ownStock > 0
            ? 'Madeira: Floresta local'
            : 'Madeira: Floresta esgotada';
    } else if (item.assetName === 'building-mine') {
      const depLabel =
        item.chainAdj.mountainDeposit === 'stone'
          ? 'Depósito de Pedra (Pedreira)'
          : item.chainAdj.mountainDeposit === 'ore'
            ? 'Veio de Minério'
            : 'Veio Misto (Pedra & Minério)';
      resourceOriginPt = `${depLabel} · Montanha`;
    } else if (item.assetName === 'building-smelter') {
      const fuelInfo = smelterFuelByKey[item.key];
      const hasAdjMine = positiveSet.size > 0 && item.chainAdj.positiveNeighborKeys.some((k) => {
        const nt = worldState.hexes[k];
        return nt && assets[nt.structureIndex]?.name === 'building-mine';
      });
      const oreSrc = hasAdjMine ? 'Mina adjacente' : 'Estoque de minério';
      const fuelSrc = fuelInfo?.usedForestFuel
        ? 'Floresta adjacente'
        : (fuelInfo?.kingdomFuelUsed ?? 0) > 0
          ? 'Reserva de madeira do reino'
          : 'Sem combustível';
      resourceOriginPt = `Minério: ${oreSrc} · Combustível: ${fuelSrc}`;
      capacitySummaryPt = `Consumo/t: ${inputConsumed.ore ?? 0} Min · ${inputConsumed.wood ?? 0} Mad`;
    } else if (item.assetName === 'building-dock') {
      const fAlloc = adjacencyPools.fishing.consumersByKey[item.key];
      const alloc = fAlloc?.allocated ?? 0;
      const dem = fAlloc?.demand ?? DEFAULT_ADJACENCY_CONFIG.dock.fishingDemand;
      capacitySummaryPt = `Pesca: ${Math.round(alloc * 10) / 10}/${dem}`;
      resourceOriginPt = alloc > 0 ? 'Pesca: Água adjacente' : 'Pesca: sem Água produtiva';
      if ((fAlloc?.sharedWithConsumerKeys.length ?? 0) > 0) {
        penaltySummaryPt.push(
          `Pesca dividida com ${fAlloc!.sharedWithConsumerKeys.length} estrutura(s)`
        );
      }
      for (const nKey of item.chainAdj.positiveNeighborKeys) {
        const wRep = adjacencyPools.waterByKey[nKey];
        if (wRep && wRep.pollutionPenaltyPct > 0) {
          penaltySummaryPt.push(`Água poluída (-${wRep.pollutionPenaltyPct}%)`);
          break;
        }
      }
    } else if (item.assetName === 'building-village') {
      const vRep = adjacencyPools.villagesByKey[item.key];
      if (vRep) {
        const huntAlloc = Math.round((vRep.hunting?.allocated ?? 0) * 10) / 10;
        const fishAlloc = Math.round((vRep.fishing?.allocated ?? 0) * 10) / 10;
        const pastAlloc = Math.round((vRep.pasture?.allocated ?? 0) * 10) / 10;
        capacitySummaryPt = `Oferta trab.: ${Math.round(vRep.workerSupply * 10) / 10} (aloc. ${Math.round(vRep.workersSuppliedTotal * 10) / 10})`;
        resourceOriginPt = `Pools: Caça ${huntAlloc} · Pesca ${fishAlloc} · Pasto ${pastAlloc}`;
        if (vRep.pollutionPenaltyPct > 0) {
          penaltySummaryPt.push(`Poluição da Fundição (-${vRep.pollutionPenaltyPct}% trab.)`);
        }
        for (const consumerKey of Object.keys(vRep.workerConsumersByKey)) {
          if ((vRep.workerConsumersByKey[consumerKey] ?? 0) > 0) {
            positiveSet.add(consumerKey);
          }
        }
      }
    } else if (item.assetName === 'building-market') {
      const mRep = commerceChain.marketsByKey[item.key];
      if (mRep) {
        const producersList: Array<{ key: string; labelPt: string; categoryPt: string }> = [];
        for (const pKey of mRep.suppliedProducerKeys) {
          positiveSet.add(pKey);
          const pItem = completedBuildings.find((cb) => cb.key === pKey);
          if (pItem) {
            const cat = PRODUCER_COMMERCE_CATEGORY[pItem.assetName];
            const catPt = cat ? COMMERCE_CATEGORY_LABELS_PT[cat] : 'Produto';
            producersList.push({
              key: pKey,
              labelPt: pItem.stats.labelPt,
              categoryPt: catPt,
            });
          }
        }
        for (const dKey of mRep.demandProviderKeys) {
          positiveSet.add(dKey);
        }
        for (const peerKey of mRep.sharedWithMarketKeys) {
          const peerTile = worldState.hexes[peerKey];
          if (
            peerTile &&
            Math.max(
              Math.abs(peerTile.q - item.tile.q),
              Math.abs(peerTile.r - item.tile.r),
              Math.abs(peerTile.q + peerTile.r - (item.tile.q + item.tile.r))
            ) <= 2
          ) {
            penaltySet.add(peerKey);
          }
        }
        const distinctProductsPt = mRep.distinctProductTypes.map(
          (c) => COMMERCE_CATEGORY_LABELS_PT[c]
        );
        const varietyMultiplierPct = Math.round((mRep.varietyMultiplier - 1) * 100);
        const varietyBonusPt =
          distinctProductsPt.length > 1
            ? `${distinctProductsPt.length} produtos distintos (+${varietyMultiplierPct}% eficiência)`
            : distinctProductsPt.length === 1
              ? '1 produto (adicione produtores diferentes para bônus)'
              : 'Sem produtores adjacentes ativos';
        const sharedWithMarketsCount = mRep.sharedWithMarketKeys.length;
        const sharedDemandNotePt =
          sharedWithMarketsCount > 0
            ? `Demanda/oferta dividida com ${sharedWithMarketsCount} Mercado(s) vizinho(s)`
            : null;
        if (varietyMultiplierPct > 0) {
          bonusSummaryPt.push(`Variedade local (+${varietyMultiplierPct}%)`);
        }
        if (sharedDemandNotePt) {
          penaltySummaryPt.push(sharedDemandNotePt);
        }
        capacitySummaryPt = `Volume local: ${mRep.allocatedSupplyUnits} · Demanda: ${mRep.allocatedDemandUnits}`;
        resourceOriginPt =
          producersList.length > 0
            ? `Abastecido por: ${producersList.map((p) => p.labelPt).join(', ')}`
            : 'Comércio local sem produtores adjacentes';
        marketDetails = {
          producers: producersList,
          distinctProductsPt,
          varietyMultiplierPct,
          varietyBonusPt,
          sharedWithMarketsCount,
          sharedDemandNotePt,
        };
      }
    } else if (
      item.assetName === 'building-archery' ||
      item.assetName === 'building-tower' ||
      item.assetName === 'unit-wall-tower'
    ) {
      const neighbors = getHexNeighbors(worldState, item.tile.q, item.tile.r, assets, underConstructionKeys);
      let protectedCount = 0;
      for (const n of neighbors) {
        if (n.exists && n.isCompleteBuilding && n.owner === owner) {
          positiveSet.add(n.key);
          protectedCount += 1;
        }
      }
      if (
        (item.assetName === 'building-tower' || item.assetName === 'unit-wall-tower') &&
        getHexTerrainAndResource(item.tile.q, item.tile.r, item.tile).terrainType === 'mountain'
      ) {
        bonusSummaryPt.push('Altitude de Montanha (+3 Def / +Alcance)');
      }
      if (protectedCount > 0) {
        bonusSummaryPt.push(`Protege ${protectedCount} prédio(s) adjacente(s)`);
      }
    }

    // Add district/road/upgrade notes to bonusSummaryPt cleanly without duplicates
    if (item.locationNotesPt.length > 0) {
      for (const note of item.locationNotesPt) {
        if (!bonusSummaryPt.includes(note) && !penaltySummaryPt.includes(note)) {
          if (note.includes('(-')) {
            penaltySummaryPt.push(note);
          } else {
            bonusSummaryPt.push(note);
          }
        }
      }
    }

    buildingsByKey[item.key] = {
      key: item.key,
      assetName: item.assetName,
      labelPt: item.stats.labelPt,
      level: item.level,
      maxLevel: item.maxLevel,
      status,
      statusLabelPt,
      reasonPt,
      seasonalNotePt,
      upgradeInProgress: item.upgradeInProgress,
      installedModules: item.installedModules,
      moduleConstructionInProgress: item.moduleConstructionInProgress,
      workersAssigned,
      workersRequired,
      localWorkersFromVillages: localWorkers,
      locationEfficiencyPct: Math.round(item.locationFactor * 100),
      effectiveEfficiencyPct: Math.round(combinedFactor * 100),
      locationBonusNotesPt: item.locationNotesPt,
      logisticsEfficiencyPct: item.logisticsEfficiencyPct,
      logisticsStatusPt: item.logisticsStatusPt,
      districtLabelPt: item.districtLabelPt,
      hasRoad: item.hasRoad,
      roadLevel: item.roadLevel,
      roadBonusNotesPt: item.roadBonusNotesPt,
      potentialProduction: { ...item.stats.production },
      actualProduction,
      effectiveHousingCapacity: item.stats.housingCapacity + item.modEff.housingBonus,
      effectiveStorageGeneral: item.stats.storageBonus + item.modEff.storageGeneralBonus,
      effectiveStorageFood: item.modEff.storageFoodBonus,
      effectiveDefenseBonus: item.stats.defenseBonus + item.modEff.defenseBonus,
      effectiveMaintenanceGold: Math.max(0, item.stats.maintenanceGold + item.modEff.maintenanceDelta),
      inputConsumed,
      positiveNeighborKeys: Array.from(positiveSet).sort(),
      penaltyNeighborKeys: Array.from(penaltySet).sort(),
      capacitySummaryPt,
      resourceOriginPt,
      workerOriginPt,
      bonusSummaryPt,
      penaltySummaryPt,
      ...(marketDetails ? { marketDetails } : {}),
    };
  }

  const rawRoadMaint = owner === 'player' ? roadConnectivity.roadMaintenanceGold : 0;
  const effectiveRoadUpkeepSaved = Math.min(rawRoadMaint, regionalRoadUpkeepSaved);
  const roadMaint = Math.max(0, rawRoadMaint - effectiveRoadUpkeepSaved);
  const networkTradeGold = owner === 'player' ? roadConnectivity.networkTradeGold : 0;
  const corridorTradeGold = owner === 'player' ? regionalSummary.corridorTradeGold : 0;

  const tradeRouteMult = seasonTradeMult * (1 + mods.tradeRouteBonus);
  const finalGoldGross =
    Math.round(
      (baseGoldGross * mods.goldMultiplier +
        tradePactGoldBonus * (1 + mods.tradeRouteBonus) +
        regionalBonusGold +
        (networkTradeGold + corridorTradeGold) * tradeRouteMult) *
        effectGoldMult *
        weatherGoldMult
    ) + buildingGoldGross;
  const totalMaint = Math.round(
    (buildingMaint * mods.maintenanceMultiplier +
      milPower.unitMaintenanceGold +
      roadMaint) *
      seasonUpkeepMult
  );

  const roundedKingdomWoodFuel = Math.round(totalKingdomWoodFuelConsumed);
  const finalWood =
    Math.round((baseWoodProd * seasonWoodMult * weatherWoodMult + buildingWoodProd) * mods.woodMultiplier) -
    roundedKingdomWoodFuel;
  const finalStone =
    Math.round(baseStoneProd * mods.stoneOreMultiplier) + buildingStoneProd;
  const finalFoodProd =
    Math.round(
      baseFoodProd *
        mods.foodMultiplier *
        effectFoodMult *
        seasonFoodMult *
        weatherFoodMult
    ) + buildingFoodProd;
  const finalOreProd =
    Math.round(baseOreProd * mods.stoneOreMultiplier * mods.oreBonusMultiplier) +
    buildingOreProd;
  const roundedOreConsumed = Math.round(totalOreConsumed);
  const finalOreNet = finalOreProd - roundedOreConsumed;
  const finalMetalProd = Math.round(buildingMetalProd * mods.metalMultiplier);
  const finalScience = Math.max(
    1,
    Math.round(
      (Math.round(baseScienceProd) + buildingScienceProd + effectScienceBonus + regionalBonusScience + mods.flatScienceBonus) *
        mods.scienceMultiplier
    )
  );

  // Final population dynamics check using exact foodProduced
  const popDynamics = evaluatePopulationDynamics({
    population,
    housingCapacity: capacity,
    workerAllocation: workerAlloc,
    foodStock: resources.food,
    foodProduced: finalFoodProd,
    foodDeficitTurns,
    activeEffects,
    foodDemandMult: seasonFoodDemandMult * mods.foodDemandMultiplier,
    seasonalPopGrowthBonusMod: seasonPopGrowthMod + mods.popGrowthBonus,
    urbanQualityScore,
    roadConnectivityScore: roadConnectivity.networks.filter((n) => n.connectedCityIds.length >= 2).length,
    stabilityBonus: activeCities.some((c) => c.connectedCityIds.length > 0) ? 1 : 0,
  });

  const foodNet = finalFoodProd - popDynamics.foodConsumption;

  const seasonalSummaryPt = seasonProfile
    ? `${seasonProfile.labelPt}: ${seasonProfile.descriptionPt}${
        weather.id !== 'clear' ? ` Clima: ${weather.labelPt}.` : ''
      }`
    : null;

  return {
    goldGross: finalGoldGross,
    goldMaintenance: totalMaint,
    goldTradePactBonus: tradePactGoldBonus,
    roadMaintenanceGold: roadMaint,
    networkTradeGold,
    corridorTradeGold,
    regionalBonusGold,
    regionalBonusScience,
    regionalStorageBonus,
    regionalFoodStorageBonus,
    regionalHousingBonus,
    regionalRoadUpkeepSaved: effectiveRoadUpkeepSaved,
    goldNet: finalGoldGross - totalMaint,
    woodNet: finalWood,
    stoneNet: finalStone,
    foodProduced: finalFoodProd,
    foodConsumed: popDynamics.foodConsumption,
    foodNet,
    oreProduced: finalOreProd,
    oreConsumed: roundedOreConsumed,
    oreNet: finalOreNet,
    metalProduced: finalMetalProd,
    metalNet: finalMetalProd,
    scienceNet: finalScience,
    foodDeficitTurnsNext: popDynamics.nextFoodDeficitTurns,
    storageCaps: {
      wood: 100 + storageBonus,
      stone: 100 + storageBonus,
      food: 120 + storageBonus + regionalFoodStorageBonus + moduleFoodStorageBonus,
      ore: 80 + storageBonus,
      metal: 60 + storageBonus,
    },
    population: {
      current: popDynamics.current,
      capacity: popDynamics.capacity,
      usedWorkers: popDynamics.usedWorkers,
      buildingWorkersAssigned: popDynamics.buildingWorkersAssigned,
      buildingWorkersRequired: popDynamics.buildingWorkersRequired,
      unitWorkersUsed: popDynamics.unitWorkersUsed,
      expansionWorkersUsed: popDynamics.expansionWorkersUsed,
      availableWorkers: popDynamics.availableWorkers,
      foodConsumption: popDynamics.foodConsumption,
      hasFoodDeficit: popDynamics.hasFoodDeficit,
      nextFoodDeficitTurns: popDynamics.nextFoodDeficitTurns,
      projectedGrowth: popDynamics.projectedGrowth,
      efficiency: popDynamics.efficiency,
      efficiencyReasonPt: popDynamics.efficiencyReasonPt,
    },
    underConstructionCount,
    citySummaryCount: activeCities.length,
    roadConnectivity,
    regionalSummary,
    adjacencyPools,
    grainChain,
    commerceChain,
    forestWoodConsumptionsByKey: forestTimber.forestWoodConsumedByKey,
    kingdomWoodFuelConsumed: roundedKingdomWoodFuel,
    buildingsByKey,
    attentionHexKeys,
    season: season ?? null,
    weather,
    foodDemandMult: seasonFoodDemandMult,
    seasonalSummaryPt,
    operationCounts,
  };
}

export function getKingdomStage(params: {
  territoryCount: number;
  population: number;
  unlockedTechCount: number;
  militaryUnitCount: number;
}): KingdomStageInfo {
  const { territoryCount, population, unlockedTechCount, militaryUnitCount } = params;

  if (territoryCount >= 22 && unlockedTechCount >= 5 && militaryUnitCount >= 3) {
    return {
      stageIndex: 5,
      labelPt: 'Reino Soberano',
      nextMilestonePt: 'Domínio completo alcançado!',
    };
  }
  if (territoryCount >= 16 && unlockedTechCount >= 4) {
    return {
      stageIndex: 4,
      labelPt: 'Principado Industrial',
      nextMilestonePt: '22 territórios, 5 pesquisas e 3 tropas para Reino Soberano',
    };
  }
  if (territoryCount >= 12 && unlockedTechCount >= 2) {
    return {
      stageIndex: 3,
      labelPt: 'Cidade Mercante',
      nextMilestonePt: '16 territórios e 4 pesquisas para Principado Industrial',
    };
  }
  if (territoryCount >= 9 || population >= 20) {
    return {
      stageIndex: 2,
      labelPt: 'Vila em Expansão',
      nextMilestonePt: '12 territórios e 2 pesquisas para Cidade Mercante',
    };
  }
  return {
    stageIndex: 1,
    labelPt: 'Acampamento Real',
    nextMilestonePt: '9 territórios ou 20 moradores para Vila em Expansão',
  };
}
