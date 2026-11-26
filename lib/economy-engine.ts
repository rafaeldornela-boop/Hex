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
  getHexTerrainAndResource,
  getStrategicRegionInfo,
} from './terrain-engine';
import { AXIAL_DIRECTIONS } from './territory-engine';
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

  const neighborTiles: Array<{
    tile: PlacedHex | undefined;
    terrain: string;
    assetName: string;
    isCompleteBuilding: boolean;
  }> = [];

  for (const dir of AXIAL_DIRECTIONS) {
    const nq = tile.q + dir.q;
    const nr = tile.r + dir.r;
    const nKey = hexKey(nq, nr);
    const nTile = worldState.hexes[nKey];
    const terrain = getHexTerrainAndResource(nq, nr, nTile).terrainType;
    const nAsset = nTile ? (assets[nTile.structureIndex]?.name ?? '') : '';
    const isComplete = Boolean(nTile) && !underConstructionKeys?.has(nKey);
    neighborTiles.push({
      tile: nTile,
      terrain,
      assetName: nAsset,
      isCompleteBuilding: isComplete,
    });
  }

  const countTerrain = (t: string) =>
    neighborTiles.filter((n) => n.terrain === t).length;
  const hasCompleteNeighborAsset = (names: string[]) =>
    neighborTiles.some((n) => n.isCompleteBuilding && names.includes(n.assetName));
  const countCompleteNeighborAsset = (names: string[]) =>
    neighborTiles.filter((n) => n.isCompleteBuilding && names.includes(n.assetName)).length;

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
      const landCount = neighborTiles.filter((n) => n.terrain !== 'water').length;
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
      const forestNeighbors = countTerrain('forest');
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
      const mountainNeighbors = countTerrain('mountain');
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
      const housingCount = countCompleteNeighborAsset([
        'building-house',
        'building-cabin',
        'building-village',
        'unit-mansion',
        'building-castle',
      ]);
      if (housingCount > 0) {
        const bonus = Math.min(0.25, housingCount * 0.1);
        factor += bonus;
        notesPt.push(`Moradias próximas (+${Math.round(bonus * 100)}%)`);
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

  for (const tile of Object.values(worldState.hexes)) {
    if (tile.owner !== owner) continue;
    const key = hexKey(tile.q, tile.r);
    const assetName = assets[tile.structureIndex]?.name ?? '';
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
    if (terrainInfo.resourceType === 'wood') baseWoodProd += 1;
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
      const bDef = stats.baseDef;
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
      stats.housingCapacity > 0 ||
      stats.workersRequired > 0 ||
      stats.storageBonus > 0 ||
      stats.defenseBonus > 0 ||
      stats.maintenanceGold > 0 ||
      hasAnyPositiveOutput(stats.production);

    if (!isConstructedAsset) continue;

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

    const logistics = computeBuildingLogistics({
      q: tile.q,
      r: tile.r,
      cityCenters,
      roads,
      connectivity: roadConnectivity,
    });

    const regBonus = regionalSummary.hexBonusesByKey[key];

    const hasWaterNeighbor =
      terrainInfo.terrainType === 'water' ||
      AXIAL_DIRECTIONS.some((dir) => {
        const nq = tile.q + dir.q;
        const nr = tile.r + dir.r;
        return (
          getHexTerrainAndResource(nq, nr, worldState.hexes[hexKey(nq, nr)])
            .terrainType === 'water'
        );
      });

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
      locationFactor: loc.factor,
      locationNotesPt: loc.notesPt,
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

  const computeResilientMultiplier = (
    rawMult: number,
    resilience: number,
    extraMitigation = 0
  ): number => {
    if (rawMult >= 1) return rawMult;
    const totalResilience = Math.min(0.75, resilience + extraMitigation);
    return 1 - (1 - rawMult) * (1 - totalResilience);
  };

  // 2. First pass: calculate ore extraction and food baseline before checking input conversions and starvation
  let extractedOreThisTurn = baseOreProd;
  let preStarveFoodProd = baseFoodProd * seasonFoodMult * weatherFoodMult;

  const getRegionalSpecForHex = (key: string) => {
    const cityId = regionalSummary.controllingCityIdByHexKey[key];
    return cityId ? regionalSummary.cityProfilesById[cityId]?.primarySpecialization ?? null : null;
  };

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

    if (item.stats.production.ore > 0) {
      const regMiningMult =
        citySpec?.id === 'mining' ? (citySpecTier === 3 ? 1.15 : citySpecTier === 2 ? 1.1 : 1.06) : 1;
      const effRainOrePass1 =
        weather.id === 'rain' || weather.id === 'storm'
          ? 1 - 0.15 * (1 - Math.min(0.75, item.modEff.rainStormResilience))
          : 1;
      extractedOreThisTurn +=
        item.stats.production.ore *
        (1 + item.modEff.prodPct.ore) *
        rawScale *
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
      preStarveFoodProd +=
        item.stats.production.food *
        (1 + item.modEff.prodPct.food + springSummerBonus) *
        rawScale *
        mods.foodMultiplier *
        effectFoodMult *
        effSeasonFood *
        effWeatherFood;
    }
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
    totalOreDemand += reqOre * workerRatio;
  }

  const availableOrePool = Math.max(0, (resources.ore || 0) + Math.floor(extractedOreThisTurn));
  const oreInputRatio =
    totalOreDemand > 0 ? Math.min(1, availableOrePool / totalOreDemand) : 1;

  // 5. Final per-building production & status aggregation
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

  for (const item of completedBuildings) {
    const assign = workerAlloc.assignmentsByKey[item.key];
    const workersAssigned = assign ? assign.assigned : 0;
    const workersRequired = assign ? assign.required : item.stats.workersRequired;
    const workerRatio = assign
      ? computeWorkerProductionScale(assign.assigned, assign.required)
      : 1;

    const reqOreInput = item.bDef.inputConsumption?.ore ?? 0;
    const inputRatio = reqOreInput > 0 ? oreInputRatio : 1;

    const combinedFactor =
      item.locationFactor *
      item.logisticsFactor *
      item.districtMultiplier *
      workerRatio *
      inputRatio *
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

    const actualProduction: BuildingProduction = {
      gold:
        Math.round(
          item.stats.production.gold *
            (1 + item.modEff.prodPct.gold) *
            mods.goldMultiplier *
            effectGoldMult *
            effSeasonGold *
            effWeatherGold *
            regCommerceMult *
            combinedFactor
        ) +
        (workerRatio > 0 ? item.districtGoldFlat + item.modEff.flatGold : 0),
      wood: Math.round(
        item.stats.production.wood *
          (1 + item.modEff.prodPct.wood) *
          effSeasonWood *
          effWeatherWood *
          regForestryMult *
          combinedFactor
      ),
      stone: Math.round(
        item.stats.production.stone *
          (1 + item.modEff.prodPct.stone) *
          mods.stoneOreMultiplier *
          regMiningMult *
          effRainStoneOre *
          combinedFactor
      ),
      food: Math.round(
        item.stats.production.food *
          (1 + item.modEff.prodPct.food + springSummerFoodMod) *
          mods.foodMultiplier *
          effectFoodMult *
          effSeasonFood *
          effWeatherFood *
          combinedFactor
      ),
      ore: Math.round(
        item.stats.production.ore *
          (1 + item.modEff.prodPct.ore) *
          mods.stoneOreMultiplier *
          mods.oreBonusMultiplier *
          regMiningMult *
          effRainStoneOre *
          combinedFactor
      ),
      metal: Math.round(
        item.stats.production.metal *
          (1 + item.modEff.prodPct.metal) *
          regMiningMult *
          combinedFactor
      ),
      science:
        Math.round(
          item.stats.production.science *
            (1 + item.modEff.prodPct.science) *
            combinedFactor
        ) + (workerRatio > 0 ? item.modEff.flatScience : 0),
    };

    const oreUsed =
      reqOreInput > 0 ? Math.round(reqOreInput * workerRatio * inputRatio * 10) / 10 : 0;
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
    } else if (workersRequired > 0 && workerRatio < 1) {
      status = 'partial';
      statusLabelPt = 'Parcial';
      reasonPt = `Equipe incompleta (${workersAssigned}/${workersRequired} trabalhadores)`;
    } else if (reqOreInput > 0 && inputRatio < 0.99) {
      status = 'partial';
      statusLabelPt = 'Parcial';
      reasonPt = 'Suprimento de minério insuficiente';
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
      inputConsumed: reqOreInput > 0 ? { ore: Math.round(oreUsed) } : {},
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

  const finalWood =
    Math.round((baseWoodProd * seasonWoodMult * weatherWoodMult + buildingWoodProd) * mods.woodMultiplier);
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
