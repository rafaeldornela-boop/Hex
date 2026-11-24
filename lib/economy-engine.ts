import type { HexAssetEntry } from './godot-docs';
import { getBuildingDefinition, type ResourceCost } from './buildings-catalog';
import type { HexOwner, HexWorldState } from './hex-engine';
import {
  getHexTerrainAndResource,
  getStrategicRegionInfo,
} from './terrain-engine';
import { getTechModifiers, type TechId } from './tech-engine';
import { computeFactionMilitaryPower, type UnitEntity } from './military-engine';

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
  efficiency: number; // 0.75..1.0
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

  for (const tile of Object.values(worldState.hexes)) {
    if (tile.owner !== owner) continue;
    const assetName = assets[tile.structureIndex]?.name ?? '';
    const bDef = getBuildingDefinition(assetName);
    const terrainInfo = getHexTerrainAndResource(tile.q, tile.r, tile);
    const strategic = getStrategicRegionInfo(tile.q, tile.r);

    capacity += bDef.housingCapacity;
    usedWorkers += bDef.workersRequired;
    storageBonus += bDef.storageBonus;
    buildingMaint += bDef.maintenanceGold;

    // Natural tile baseline yield + building production
    if (terrainInfo.resourceType === 'wood') woodProd += 1;
    if (terrainInfo.resourceType === 'food') foodProd += 1;
    if (terrainInfo.resourceType === 'water') foodProd += 1;
    if (terrainInfo.resourceType === 'ore') stoneProd += 1;

    goldGross += bDef.production.gold + strategic.bonusGoldPerTurn;
    woodProd += bDef.production.wood;
    stoneProd += bDef.production.stone;
    foodProd += bDef.production.food + strategic.bonusFoodPerTurn;
    oreProd += bDef.production.ore + strategic.bonusOrePerTurn;
    scienceProd += bDef.production.science + strategic.bonusSciencePerTurn;
  }

  // Military unit maintenance & population slot usage
  const milPower = computeFactionMilitaryPower(
    worldState,
    units,
    assets,
    owner,
    unlockedTechs
  );
  const unitPopUsed = units
    .filter((u) => u.owner === owner && u.hp > 0)
    .reduce((sum, u) => sum + (u.type === 'knight' || u.type === 'warship' ? 2 : 1), 0);

  const totalWorkersNeeded = usedWorkers + unitPopUsed;
  const availableWorkers = Math.max(0, population - totalWorkersNeeded);

  const foodConsumption = Math.max(2, Math.ceil(population * 0.35));
  const starving = resources.food <= 0 && foodProd < foodConsumption;
  const workerShortage = population < totalWorkersNeeded;
  const efficiency = starving ? 0.75 : workerShortage ? 0.85 : 1.0;

  const finalGoldGross = Math.round(
    (goldGross * mods.goldMultiplier * efficiency + tradePactGoldBonus) *
      eventGoldMultiplier
  );
  const totalMaint = buildingMaint + milPower.unitMaintenanceGold;
  const finalFoodProd = Math.round(
    foodProd * mods.foodMultiplier * efficiency * eventFoodMultiplier
  );
  const finalWood = Math.round(woodProd * efficiency);
  const finalStone = Math.round(stoneProd * mods.stoneOreMultiplier * efficiency);
  const finalOre = Math.round(
    oreProd * mods.stoneOreMultiplier * mods.oreBonusMultiplier * efficiency
  );
  const finalScience = Math.max(1, Math.round(scienceProd * efficiency));

  const foodNet = finalFoodProd - foodConsumption;
  let projectedGrowth = 0;
  if (population < capacity && resources.food + foodNet >= 4) {
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
    },
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
