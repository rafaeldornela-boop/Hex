import type { HexAssetEntry } from './godot-docs';
import { getBuildingDefinition, type ResourceCost } from './buildings-catalog';
import { hexKey, type HexOwner, type HexWorldState } from './hex-engine';
import {
  getHexTerrainAndResource,
  getStrategicRegionInfo,
} from './terrain-engine';
import { getTechModifiers, type TechId } from './tech-engine';
import { computeFactionMilitaryPower, type UnitEntity } from './military-engine';
import type { ActiveWorldEffect } from './events-engine';

export interface KingdomResources {
  wood: number;
  stone: number;
  food: number;
  ore: number;
  science: number;
}

export interface ResourceStorageCaps {
  wood: number;
  stone: number;
  food: number;
  ore: number;
}

export interface PopulationSummary {
  current: number;
  capacity: number;
  usedWorkers: number;
  availableWorkers: number;
  foodConsumption: number;
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
  oreNet: number;
  scienceNet: number;
  storageCaps: ResourceStorageCaps;
  population: PopulationSummary;
  underConstructionCount: number;
}

export interface KingdomStageInfo {
  stageIndex: 1 | 2 | 3 | 4 | 5;
  labelPt: string;
  nextMilestonePt: string;
}

export function createInitialResources(): KingdomResources {
  return {
    wood: 60,
    stone: 45,
    food: 65,
    ore: 25,
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
  return { affordable: true, missingLabelPt: null };
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
  activeEffects?: ActiveWorldEffect[];
  tradePactGoldBonus?: number;
  eventGoldMultiplier?: number;
  eventFoodMultiplier?: number;
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
    activeEffects = [],
    tradePactGoldBonus = 0,
    eventGoldMultiplier = 1,
    eventFoodMultiplier = 1,
  } = params;

  const mods = getTechModifiers(unlockedTechs);
  let capacity = 4; // base camp capacity
  let usedWorkers = 0;
  let storageBonus = mods.bonusStorage;

  let goldGross = 8; // royal base tax
  let buildingMaint = 0;
  let woodProd = 2; // basic gathering
  let stoneProd = 1;
  let foodProd = 4;
  let oreProd = 0;
  let scienceProd = 1;
  let underConstructionCount = 0;

  for (const tile of Object.values(worldState.hexes)) {
    if (tile.owner !== owner) continue;
    const key = hexKey(tile.q, tile.r);
    const isUnderConstruction = Boolean(underConstructionKeys?.has(key));
    if (isUnderConstruction) {
      underConstructionCount += 1;
    }

    const terrainInfo = getHexTerrainAndResource(tile.q, tile.r, tile);
    const strategic = getStrategicRegionInfo(tile.q, tile.r, tile);

    // Natural tile baseline yield + strategic rare node bonus
    if (terrainInfo.resourceType === 'wood') woodProd += 1;
    if (terrainInfo.resourceType === 'food') foodProd += 1;
    if (terrainInfo.resourceType === 'water') foodProd += 1;
    if (terrainInfo.resourceType === 'ore') stoneProd += 1;

    goldGross += strategic.bonusGoldPerTurn;
    foodProd += strategic.bonusFoodPerTurn;
    oreProd += strategic.bonusOrePerTurn;
    scienceProd += strategic.bonusSciencePerTurn;

    // Buildings under construction do NOT contribute capacity, storage, workers, or production until completed
    if (isUnderConstruction) continue;

    const assetName = assets[tile.structureIndex]?.name ?? '';
    const bDef = getBuildingDefinition(assetName);

    capacity += bDef.housingCapacity;
    usedWorkers += bDef.workersRequired;
    storageBonus += bDef.storageBonus;
    buildingMaint += bDef.maintenanceGold;

    goldGross += bDef.production.gold;
    woodProd += bDef.production.wood;
    stoneProd += bDef.production.stone;
    foodProd += bDef.production.food;
    oreProd += bDef.production.ore;
    scienceProd += bDef.production.science;
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

  const totalWorkersNeeded = usedWorkers + unitPopUsed;
  const availableWorkers = Math.max(0, population - totalWorkersNeeded);

  const foodConsumption = Math.max(2, Math.ceil(population * 0.35));
  const starving = resources.food <= 0 && foodProd < foodConsumption;
  const workerShortage = population < totalWorkersNeeded;

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

  // Worker shortages scale production proportionally down (or critically stall)
  let workerFactor = 1;
  if (workerShortage && totalWorkersNeeded > 0) {
    workerFactor = Math.max(0.25, population / totalWorkersNeeded);
  }
  const starveFactor = starving ? 0.75 : 1;
  const effectFactor = Math.max(0.5, 1 - effectEffPenalty);
  const efficiency = Math.max(0.25, Math.min(1, workerFactor * starveFactor * effectFactor));

  let efficiencyReasonPt: string | null = null;
  if (starving) {
    efficiencyReasonPt = 'Escassez de alimento reduz produtividade';
  } else if (workerShortage) {
    efficiencyReasonPt = 'Faltam trabalhadores: construa Casas para retomar 100%';
  } else if (effectEffPenalty > 0) {
    efficiencyReasonPt = 'Evento ativo reduz produtividade temporariamente';
  }

  const finalGoldGross = Math.round(
    (goldGross * mods.goldMultiplier * efficiency + tradePactGoldBonus) *
      effectGoldMult
  );
  const totalMaint = buildingMaint + milPower.unitMaintenanceGold;
  const finalFoodProd = Math.round(
    foodProd * mods.foodMultiplier * efficiency * effectFoodMult
  );
  const finalWood = Math.round(woodProd * efficiency);
  const finalStone = Math.round(stoneProd * mods.stoneOreMultiplier * efficiency);
  const finalOre = Math.round(
    oreProd * mods.stoneOreMultiplier * mods.oreBonusMultiplier * efficiency
  );
  const finalScience = Math.max(
    1,
    Math.round(scienceProd * efficiency) + effectScienceBonus
  );

  const foodNet = finalFoodProd - foodConsumption;
  let projectedGrowth = 0;
  if (population < capacity && resources.food + foodNet >= 4 && !starving) {
    projectedGrowth = foodNet >= 8 ? 2 : 1;
  }

  return {
    goldGross: finalGoldGross,
    goldMaintenance: totalMaint,
    goldTradePactBonus: tradePactGoldBonus,
    goldNet: finalGoldGross - totalMaint,
    woodNet: finalWood,
    stoneNet: finalStone,
    foodProduced: finalFoodProd,
    foodConsumed: foodConsumption,
    foodNet,
    oreNet: finalOre,
    scienceNet: finalScience,
    storageCaps: {
      wood: 100 + storageBonus,
      stone: 100 + storageBonus,
      food: 120 + storageBonus,
      ore: 80 + storageBonus,
    },
    population: {
      current: population,
      capacity,
      usedWorkers: totalWorkersNeeded,
      availableWorkers,
      foodConsumption,
      projectedGrowth,
      efficiency,
      efficiencyReasonPt,
    },
    underConstructionCount,
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
