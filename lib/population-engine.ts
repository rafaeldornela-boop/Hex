import type { BuildingRole } from './buildings-catalog';
import type { ActiveWorldEffect } from './events-engine';

export const MIN_KINGDOM_POPULATION = 4;
export const BASE_HOUSING_CAPACITY = 4;
export const FOOD_CONSUMPTION_PER_CITIZEN = 0.6;

export interface BuildingWorkOrder {
  key: string;
  assetName: string;
  labelPt: string;
  role: BuildingRole;
  workersRequired: number;
}

export interface BuildingWorkerAssignment {
  key: string;
  assigned: number;
  required: number;
  ratio: number;
}

export interface WorkerAllocationSummary {
  totalPopulation: number;
  unitWorkersUsed: number;
  expansionWorkersUsed: number;
  buildingWorkersRequired: number;
  buildingWorkersAssigned: number;
  totalWorkersUsed: number;
  availableWorkers: number;
  assignmentsByKey: Record<string, BuildingWorkerAssignment>;
}

export interface PopulationDynamicsResult {
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
  efficiency: number;
  starvationFactor: number;
  efficiencyReasonPt: string | null;
}

function getBuildingStaffingPriority(order: BuildingWorkOrder): number {
  switch (order.assetName) {
    case 'building-farm':
    case 'building-dock':
    case 'building-watermill':
    case 'building-mill':
    case 'building-sheep':
      return 1;
    case 'dirt-lumber':
    case 'building-mine':
    case 'building-smelter':
      return 2;
    case 'building-market':
    case 'building-port':
    case 'building-wizard-tower':
      return 3;
    default:
      return order.role === 'military' ? 4 : 5;
  }
}

export function computeFoodDemand(population: number): number {
  const safePop = Math.max(0, Number.isFinite(population) ? population : 0);
  return Math.max(2, Math.ceil(safePop * FOOD_CONSUMPTION_PER_CITIZEN));
}

/**
 * Deterministically allocates available citizens across completed buildings requiring workers.
 * Essential food and extraction buildings are staffed before commerce/science/garrisons,
 * so worker shortages visibly stall or throttle specific structures rather than hiding causes.
 */
export function allocateWorkersToBuildings(params: {
  population: number;
  unitWorkersUsed: number;
  expansionWorkersUsed?: number;
  workOrders: BuildingWorkOrder[];
}): WorkerAllocationSummary {
  const safePop = Math.max(0, Math.round(Number.isFinite(params.population) ? params.population : 0));
  const safeUnitWorkers = Math.max(
    0,
    Math.round(Number.isFinite(params.unitWorkersUsed) ? params.unitWorkersUsed : 0)
  );
  const safeExpansionWorkers = Math.max(
    0,
    Math.round(Number.isFinite(params.expansionWorkersUsed ?? 0) ? (params.expansionWorkersUsed ?? 0) : 0)
  );

  let remainingWorkforce = Math.max(0, safePop - safeUnitWorkers - safeExpansionWorkers);
  let buildingWorkersRequired = 0;
  let buildingWorkersAssigned = 0;

  const sorted = [...params.workOrders].sort((a, b) => {
    const pDiff = getBuildingStaffingPriority(a) - getBuildingStaffingPriority(b);
    if (pDiff !== 0) return pDiff;
    return a.key.localeCompare(b.key);
  });

  const assignmentsByKey: Record<string, BuildingWorkerAssignment> = {};

  for (const order of sorted) {
    const req = Math.max(0, Math.round(order.workersRequired));
    buildingWorkersRequired += req;
    if (req === 0) {
      assignmentsByKey[order.key] = {
        key: order.key,
        assigned: 0,
        required: 0,
        ratio: 1,
      };
      continue;
    }

    const assigned = Math.min(req, remainingWorkforce);
    remainingWorkforce -= assigned;
    buildingWorkersAssigned += assigned;

    assignmentsByKey[order.key] = {
      key: order.key,
      assigned,
      required: req,
      ratio: assigned / req,
    };
  }

  const totalWorkersUsed = buildingWorkersRequired + safeUnitWorkers + safeExpansionWorkers;
  const availableWorkers = Math.max(
    0,
    safePop - buildingWorkersAssigned - safeUnitWorkers - safeExpansionWorkers
  );

  return {
    totalPopulation: safePop,
    unitWorkersUsed: safeUnitWorkers,
    expansionWorkersUsed: safeExpansionWorkers,
    buildingWorkersRequired,
    buildingWorkersAssigned,
    totalWorkersUsed,
    availableWorkers,
    assignmentsByKey,
  };
}

/**
 * Computes food balance, safety-margin grace turn, gradual population growth/decline,
 * and workforce efficiency for the current turn state.
 */
export function evaluatePopulationDynamics(params: {
  population: number;
  housingCapacity: number;
  workerAllocation: WorkerAllocationSummary;
  foodStock: number;
  foodProduced: number;
  foodDeficitTurns?: number;
  activeEffects?: ActiveWorldEffect[];
}): PopulationDynamicsResult {
  const safePop = Math.max(
    0,
    Math.round(Number.isFinite(params.population) ? params.population : 0)
  );
  const safeCap = Math.max(
    BASE_HOUSING_CAPACITY,
    Math.round(Number.isFinite(params.housingCapacity) ? params.housingCapacity : BASE_HOUSING_CAPACITY)
  );
  const safeFoodStock = Math.max(0, Number.isFinite(params.foodStock) ? params.foodStock : 0);
  const safeFoodProd = Math.max(0, Number.isFinite(params.foodProduced) ? params.foodProduced : 0);
  const prevDeficitTurns = Math.max(0, Math.round(params.foodDeficitTurns ?? 0));
  const activeEffects = params.activeEffects ?? [];

  const foodConsumption = computeFoodDemand(safePop);
  const totalAvailableFood = safeFoodStock + safeFoodProd;
  const hasFoodDeficit = totalAvailableFood < foodConsumption;
  const foodSurplusAfterFeed = totalAvailableFood - foodConsumption;

  let nextFoodDeficitTurns = 0;
  let starvationFactor = 1;
  let projectedGrowth = 0;

  if (hasFoodDeficit) {
    nextFoodDeficitTurns = prevDeficitTurns + 1;
    if (prevDeficitTurns === 0) {
      // Safety margin grace turn: slowdown warning before population loss
      starvationFactor = 0.85;
      projectedGrowth = 0;
    } else {
      // Sustained deficit: sharper slowdown + gradual population decline
      starvationFactor = 0.65;
      projectedGrowth = safePop > MIN_KINGDOM_POPULATION ? -1 : 0;
    }
  } else {
    nextFoodDeficitTurns = 0;
    starvationFactor = 1;
    if (safePop < safeCap && foodSurplusAfterFeed >= 4) {
      const spareHousing = safeCap - safePop;
      const foodNet = safeFoodProd - foodConsumption;
      projectedGrowth = foodNet >= 10 && spareHousing >= 2 ? 2 : 1;
    }
  }

  let effectEffPenalty = 0;
  for (const eff of activeEffects) {
    if (typeof eff.efficiencyPenalty === 'number' && Number.isFinite(eff.efficiencyPenalty)) {
      effectEffPenalty += eff.efficiencyPenalty;
    }
  }
  const effectFactor = Math.max(0.5, 1 - effectEffPenalty);

  const workerShortage =
    params.workerAllocation.buildingWorkersAssigned <
    params.workerAllocation.buildingWorkersRequired;
  const workerFactor =
    params.workerAllocation.buildingWorkersRequired > 0
      ? Math.max(
          0.25,
          params.workerAllocation.buildingWorkersAssigned /
            params.workerAllocation.buildingWorkersRequired
        )
      : 1;

  const efficiency = Math.max(
    0.25,
    Math.min(1, workerFactor * starvationFactor * effectFactor)
  );

  let efficiencyReasonPt: string | null = null;
  if (hasFoodDeficit) {
    efficiencyReasonPt =
      prevDeficitTurns === 0
        ? 'Alerta de alimento: margem de reserva ativa antes de perda populacional'
        : 'Escassez contínua de alimento: produtividade caiu e população recua';
  } else if (workerShortage) {
    efficiencyReasonPt = `Faltam trabalhadores (${params.workerAllocation.buildingWorkersAssigned}/${params.workerAllocation.buildingWorkersRequired}): construa Casas`;
  } else if (effectEffPenalty > 0) {
    efficiencyReasonPt = 'Evento ativo reduz produtividade temporariamente';
  } else if (safePop >= safeCap) {
    efficiencyReasonPt = 'Moradias lotadas: construa Casas para crescer mais';
  }

  return {
    current: safePop,
    capacity: safeCap,
    usedWorkers: params.workerAllocation.totalWorkersUsed,
    buildingWorkersAssigned: params.workerAllocation.buildingWorkersAssigned,
    buildingWorkersRequired: params.workerAllocation.buildingWorkersRequired,
    unitWorkersUsed: params.workerAllocation.unitWorkersUsed,
    expansionWorkersUsed: params.workerAllocation.expansionWorkersUsed,
    availableWorkers: params.workerAllocation.availableWorkers,
    foodConsumption,
    hasFoodDeficit,
    nextFoodDeficitTurns,
    projectedGrowth,
    efficiency,
    starvationFactor,
    efficiencyReasonPt,
  };
}
