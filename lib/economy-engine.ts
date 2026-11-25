import type { HexAssetEntry } from './godot-docs';
import {
  getBuildingDefinition,
  type BuildingProduction,
  type InputResourceKey,
  type ResourceCost,
} from './buildings-catalog';
import { hexKey, type HexOwner, type HexWorldState, type PlacedHex } from './hex-engine';
import {
  BASE_HOUSING_CAPACITY,
  allocateWorkersToBuildings,
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
  status: BuildingOperationStatus;
  statusLabelPt: string;
  reasonPt: string | null;
  workersAssigned: number;
  workersRequired: number;
  locationEfficiencyPct: number;
  effectiveEfficiencyPct: number;
  locationBonusNotesPt: string[];
  potentialProduction: BuildingProduction;
  actualProduction: BuildingProduction;
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
  buildingsByKey: Record<string, BuildingOperationReport>;
  attentionHexKeys: string[];
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
  underConstructionKeys?: Set<string>
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

  return {
    factor: Math.max(0.75, Math.min(1.45, Number(factor.toFixed(2)))),
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
  } = params;

  const mods = getTechModifiers(unlockedTechs);

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

  let capacity = BASE_HOUSING_CAPACITY;
  let storageBonus = mods.bonusStorage;

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
    bDef: ReturnType<typeof getBuildingDefinition>;
    locationFactor: number;
    locationNotesPt: string[];
  }> = [];
  const buildingsByKey: Record<string, BuildingOperationReport> = {};

  for (const tile of Object.values(worldState.hexes)) {
    if (tile.owner !== owner) continue;
    const key = hexKey(tile.q, tile.r);
    const assetName = assets[tile.structureIndex]?.name ?? '';
    const isUnderConstruction = Boolean(underConstructionKeys?.has(key));

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

    if (isUnderConstruction) {
      underConstructionCount += 1;
      const bDef = getBuildingDefinition(assetName);
      buildingsByKey[key] = {
        key,
        assetName,
        labelPt: bDef.labelPt,
        status: 'under_construction',
        statusLabelPt: 'Em construção',
        reasonPt: 'Aguardando conclusão da obra',
        workersAssigned: 0,
        workersRequired: bDef.workersRequired,
        locationEfficiencyPct: 100,
        effectiveEfficiencyPct: 0,
        locationBonusNotesPt: [],
        potentialProduction: { ...bDef.production },
        actualProduction: { ...ZERO_PROD },
        inputConsumed: {},
      };
      continue;
    }

    const bDef = getBuildingDefinition(assetName);
    const isConstructedAsset =
      bDef.housingCapacity > 0 ||
      bDef.workersRequired > 0 ||
      bDef.storageBonus > 0 ||
      bDef.defenseBonus > 0 ||
      bDef.maintenanceGold > 0 ||
      hasAnyPositiveOutput(bDef.production);

    if (!isConstructedAsset) continue;

    capacity += bDef.housingCapacity;
    storageBonus += bDef.storageBonus;
    buildingMaint += bDef.maintenanceGold;

    const loc = computeBuildingLocationEfficiency(
      worldState,
      tile,
      assetName,
      assets,
      underConstructionKeys
    );

    workOrders.push({
      key,
      assetName,
      labelPt: bDef.labelPt,
      role: bDef.role,
      workersRequired: bDef.workersRequired,
    });

    completedBuildings.push({
      key,
      tile,
      assetName,
      bDef,
      locationFactor: loc.factor,
      locationNotesPt: loc.notesPt,
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

  // 2. First pass: calculate ore extraction and food baseline before checking input conversions and starvation
  let extractedOreThisTurn = baseOreProd;
  let preStarveFoodProd = baseFoodProd;

  for (const item of completedBuildings) {
    const assign = workerAlloc.assignmentsByKey[item.key];
    const workerRatio = assign ? assign.ratio : 1;
    const rawScale = item.locationFactor * workerRatio * effectFactor;

    if (item.bDef.production.ore > 0) {
      extractedOreThisTurn +=
        item.bDef.production.ore *
        rawScale *
        mods.stoneOreMultiplier *
        mods.oreBonusMultiplier;
    }
    if (item.bDef.production.food > 0) {
      preStarveFoodProd +=
        item.bDef.production.food * rawScale * mods.foodMultiplier * effectFoodMult;
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
    const workersRequired = assign ? assign.required : item.bDef.workersRequired;
    const workerRatio = assign ? assign.ratio : 1;

    const reqOreInput = item.bDef.inputConsumption?.ore ?? 0;
    const inputRatio = reqOreInput > 0 ? oreInputRatio : 1;

    const combinedFactor =
      item.locationFactor * workerRatio * inputRatio * starvationFactor * effectFactor;

    const actualProduction: BuildingProduction = {
      gold: Math.round(item.bDef.production.gold * mods.goldMultiplier * effectGoldMult * combinedFactor),
      wood: Math.round(item.bDef.production.wood * combinedFactor),
      stone: Math.round(item.bDef.production.stone * mods.stoneOreMultiplier * combinedFactor),
      food: Math.round(item.bDef.production.food * mods.foodMultiplier * effectFoodMult * combinedFactor),
      ore: Math.round(
        item.bDef.production.ore * mods.stoneOreMultiplier * mods.oreBonusMultiplier * combinedFactor
      ),
      metal: Math.round(item.bDef.production.metal * combinedFactor),
      science: Math.round(item.bDef.production.science * combinedFactor),
    };

    const oreUsed = reqOreInput > 0 ? Math.round(reqOreInput * workerRatio * inputRatio * 10) / 10 : 0;
    totalOreConsumed += oreUsed;

    buildingGoldGross += actualProduction.gold;
    buildingWoodProd += actualProduction.wood;
    buildingStoneProd += actualProduction.stone;
    buildingFoodProd += actualProduction.food;
    buildingOreProd += actualProduction.ore;
    buildingMetalProd += actualProduction.metal;
    buildingScienceProd += actualProduction.science;

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

    if (status === 'operating') operationCounts.operating += 1;
    else if (status === 'partial') operationCounts.partial += 1;
    else if (status === 'idle') operationCounts.idle += 1;

    if (status === 'idle' || status === 'partial') {
      attentionHexKeys.push(item.key);
    }

    buildingsByKey[item.key] = {
      key: item.key,
      assetName: item.assetName,
      labelPt: item.bDef.labelPt,
      status,
      statusLabelPt,
      reasonPt,
      workersAssigned,
      workersRequired,
      locationEfficiencyPct: Math.round(item.locationFactor * 100),
      effectiveEfficiencyPct: Math.round(combinedFactor * 100),
      locationBonusNotesPt: item.locationNotesPt,
      potentialProduction: { ...item.bDef.production },
      actualProduction,
      inputConsumed: reqOreInput > 0 ? { ore: Math.round(oreUsed) } : {},
    };
  }

  const finalGoldGross =
    Math.round((baseGoldGross * mods.goldMultiplier + tradePactGoldBonus) * effectGoldMult) +
    buildingGoldGross;
  const totalMaint = buildingMaint + milPower.unitMaintenanceGold;

  const finalWood = Math.round(baseWoodProd) + buildingWoodProd;
  const finalStone = Math.round(baseStoneProd * mods.stoneOreMultiplier) + buildingStoneProd;
  const finalFoodProd =
    Math.round(baseFoodProd * mods.foodMultiplier * effectFoodMult) + buildingFoodProd;
  const finalOreProd =
    Math.round(baseOreProd * mods.stoneOreMultiplier * mods.oreBonusMultiplier) +
    buildingOreProd;
  const roundedOreConsumed = Math.round(totalOreConsumed);
  const finalOreNet = finalOreProd - roundedOreConsumed;
  const finalMetalProd = buildingMetalProd;
  const finalScience = Math.max(1, Math.round(baseScienceProd) + buildingScienceProd + effectScienceBonus);

  // Final population dynamics check using exact foodProduced
  const popDynamics = evaluatePopulationDynamics({
    population,
    housingCapacity: capacity,
    workerAllocation: workerAlloc,
    foodStock: resources.food,
    foodProduced: finalFoodProd,
    foodDeficitTurns,
    activeEffects,
  });

  const foodNet = finalFoodProd - popDynamics.foodConsumption;

  return {
    goldGross: finalGoldGross,
    goldMaintenance: totalMaint,
    goldTradePactBonus: tradePactGoldBonus,
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
      food: 120 + storageBonus,
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
    buildingsByKey,
    attentionHexKeys,
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
