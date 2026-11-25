import test from 'node:test';
import assert from 'node:assert/strict';
import { HEX_ASSETS } from './repo-data';
import { DEFAULT_ROTATION_DEG, hexKey } from './hex-engine';
import {
  advanceKingdomTurn,
  createSandboxKingdomState,
  createStarterKingdomState,
  demolishInKingdom,
  deserializeKingdomState,
  evaluateBuildingModulesInKingdom,
  getKingdomEconomy,
  installBuildingModuleInKingdom,
  serializeKingdomState,
  upgradeBuildingInKingdom,
  type KingdomState,
} from './kingdom-engine';
import {
  computeWorkerProductionScale,
  evaluatePopulationDynamics,
  allocateWorkersToBuildings,
} from './population-engine';
import { getCityStageForMetrics } from './city-engine';
import {
  BUILDING_MODULES,
  computeModuleScaledCost,
  getCompatibleModulesForBuilding,
  getModuleSlotsForBuilding,
} from './building-modules-engine';
import { computeHexDefenseScore } from './military-engine';
import { TERRAIN_METADATA, type TerrainType } from './terrain-engine';

function idxOf(name: string): number {
  const idx = HEX_ASSETS.findIndex((a) => a.name === name);
  assert.ok(idx >= 0, `Missing asset ${name}`);
  return idx;
}

function makeTile(
  q: number,
  r: number,
  terrainType: TerrainType,
  assetName?: string,
  owner: 'player' | 'neutral' = 'player',
  level = 1,
  modules?: string[]
) {
  const chosenAsset = assetName ?? TERRAIN_METADATA[terrainType].defaultAssetName;
  const resourceMap: Record<TerrainType, 'wood' | 'stone' | 'food' | 'ore' | 'water'> = {
    plains: 'food',
    forest: 'wood',
    mountain: 'ore',
    fertile: 'food',
    water: 'water',
  };
  return {
    q,
    r,
    orientation: DEFAULT_ROTATION_DEG,
    structureIndex: idxOf(chosenAsset),
    owner,
    terrainType,
    resourceType: resourceMap[terrainType],
    resourceAmount: 100,
    ...(level > 1 ? { level } : {}),
    ...(modules && modules.length > 0 ? { modules } : {}),
  };
}

function makeSandbox(tiles: ReturnType<typeof makeTile>[], overrides?: Partial<KingdomState>): KingdomState {
  const base = createSandboxKingdomState();
  const hexes: KingdomState['worldState']['hexes'] = {};
  for (const t of tiles) {
    hexes[hexKey(t.q, t.r)] = t;
  }
  return {
    ...base,
    playerCapital: { q: 0, r: 0 },
    ...overrides,
    worldState: {
      ...base.worldState,
      cash: 3000,
      hexes,
      ...(overrides?.worldState ?? {}),
    },
  };
}

test('simplified city population exposes population, housing, growth and workers, and caps growth when housing is full', () => {
  const starter = createStarterKingdomState(HEX_ASSETS, 42026);
  const capital = starter.cities[0];
  assert.ok(capital, 'Starter kingdom must have a capital city');
  assert.ok(capital.population > 0);
  assert.ok(capital.housingCapacity >= capital.population);
  assert.equal(typeof capital.growthPerTurn, 'number');
  assert.equal(typeof capital.availableWorkers, 'number');

  // Full housing must stop positive population growth
  const alloc = allocateWorkersToBuildings({
    population: 16,
    unitWorkersUsed: 0,
    workOrders: [],
  });
  const fullHousing = evaluatePopulationDynamics({
    population: 16,
    housingCapacity: 16,
    workerAllocation: alloc,
    foodStock: 80,
    foodProduced: 30,
    foodDeficitTurns: 0,
    urbanQualityScore: 8,
    roadConnectivityScore: 3,
  });
  assert.equal(fullHousing.projectedGrowth, 0);

  // Surplus + free housing + urban quality drives positive growth
  const growing = evaluatePopulationDynamics({
    population: 16,
    housingCapacity: 26,
    workerAllocation: alloc,
    foodStock: 80,
    foodProduced: 30,
    foodDeficitTurns: 0,
    urbanQualityScore: 8,
    roadConnectivityScore: 3,
  });
  assert.ok(growing.projectedGrowth >= 1);
});

test('worker shortage smoothly scales partial production instead of all-or-nothing collapse', () => {
  assert.equal(computeWorkerProductionScale(4, 4), 1);
  assert.equal(computeWorkerProductionScale(3, 4), 0.8);
  assert.ok(Math.abs(computeWorkerProductionScale(2, 4) - 0.325) < 0.001);
  assert.equal(computeWorkerProductionScale(0, 4), 0);

  // 1 Castle (8 pop), 1 Farm (2w, prio 1), 1 Serraria (2w, prio 2), 1 Mine (2w, prio 2) with 5 workers -> Mine gets 1/2 (partial)
  const state = makeSandbox(
    [
      makeTile(0, 0, 'plains', 'building-castle'),
      makeTile(1, 0, 'fertile', 'building-farm'),
      makeTile(0, -1, 'forest', 'dirt-lumber'),
      makeTile(-1, 0, 'mountain', 'building-mine'),
    ],
    {
      population: 5,
      resources: {
        wood: 50,
        stone: 50,
        food: 50,
        ore: 20,
        metal: 10,
        science: 0,
      },
      research: {
        unlocked: ['mining'],
        activeTechId: null,
        progressScience: 0,
      },
    }
  );

  const econ = getKingdomEconomy(state, HEX_ASSETS);
  const mineReport = econ.buildingsByKey['-1,0'];
  assert.equal(mineReport.status, 'partial');
  assert.equal(mineReport.workersAssigned, 1);
  assert.equal(mineReport.workersRequired, 2);
  assert.ok(mineReport.actualProduction.ore > 0);
});

test('city evolution requires BOTH developmentScore AND minimum population thresholds', () => {
  // Score 120 without enough population cannot skip to Grande Cidade
  assert.equal(getCityStageForMetrics({ developmentScore: 120, population: 6 }).level, 1);
  assert.equal(getCityStageForMetrics({ developmentScore: 120, population: 8 }).level, 2);
  assert.equal(getCityStageForMetrics({ developmentScore: 120, population: 18 }).level, 3);
  assert.equal(getCityStageForMetrics({ developmentScore: 120, population: 28 }).level, 4);
  assert.equal(getCityStageForMetrics({ developmentScore: 120, population: 40 }).level, 5);
  // High population without score is also gated by score
  assert.equal(getCityStageForMetrics({ developmentScore: 10, population: 50 }).level, 1);
});

test('module slots scale with structural building level and always require strategic choice (< compatible)', () => {
  const checkBuildings = [
    { asset: 'building-farm', maxLevel: 3 },
    { asset: 'dirt-lumber', maxLevel: 3 },
    { asset: 'building-mine', maxLevel: 3 },
    { asset: 'building-market', maxLevel: 3 },
    { asset: 'building-house', maxLevel: 3 },
    { asset: 'building-castle', maxLevel: 4 },
  ];

  for (const { asset, maxLevel } of checkBuildings) {
    const compatible = getCompatibleModulesForBuilding(asset);
    assert.ok(compatible.length > maxLevel, `${asset} needs compatible.length > ${maxLevel}`);
    for (let lvl = 1; lvl <= maxLevel; lvl++) {
      const slots = getModuleSlotsForBuilding(asset, lvl);
      assert.equal(slots, lvl);
      assert.ok(slots < compatible.length, `${asset} lvl ${lvl} slots (${slots}) must be < compatible (${compatible.length})`);
    }
  }
});

test('installed modules modify economy, housing, storage, defense, and cost scales with building level', () => {
  // Cost scaling by level
  const costL1 = computeModuleScaledCost(BUILDING_MODULES.farm_silo, 1, []);
  const costL2 = computeModuleScaledCost(BUILDING_MODULES.farm_silo, 2, []);
  assert.ok(costL2.gold > costL1.gold);

  const baseState = makeSandbox(
    [
      makeTile(0, 0, 'plains', 'building-castle'),
      makeTile(1, 0, 'fertile', 'building-farm'),
      makeTile(0, 1, 'plains', 'building-house'),
      makeTile(-1, 0, 'plains', 'unit-wall-tower'),
    ],
    {
      population: 12,
      resources: { wood: 80, stone: 80, food: 60, ore: 20, metal: 20, science: 0 },
    }
  );
  const baseEcon = getKingdomEconomy(baseState, HEX_ASSETS);
  const baseDef = computeHexDefenseScore(
    baseState.worldState,
    -1,
    0,
    baseState.units,
    HEX_ASSETS,
    []
  );

  const moddedState = makeSandbox(
    [
      makeTile(0, 0, 'plains', 'building-castle'),
      makeTile(1, 0, 'fertile', 'building-farm', 'player', 2, ['farm_silo', 'farm_irrigation']),
      makeTile(0, 1, 'plains', 'building-house', 'player', 2, ['res_extension', 'res_plaza']),
      makeTile(-1, 0, 'plains', 'unit-wall-tower', 'player', 1, ['mil_armory']),
    ],
    {
      population: 12,
      resources: { wood: 80, stone: 80, food: 60, ore: 20, metal: 20, science: 0 },
    }
  );
  const moddedEcon = getKingdomEconomy(moddedState, HEX_ASSETS);
  const moddedDef = computeHexDefenseScore(
    moddedState.worldState,
    -1,
    0,
    moddedState.units,
    HEX_ASSETS,
    []
  );

  assert.equal(moddedEcon.storageCaps.food - baseEcon.storageCaps.food, 35);
  assert.ok(moddedEcon.foodProduced > baseEcon.foodProduced);
  assert.equal(moddedEcon.population.capacity - baseEcon.population.capacity, 2 + 1); // +2 res_extension, +1 Nv.2 house
  assert.equal(moddedDef - baseDef, 4); // +4 mil_armory
});

test('module installation shares construction queue, preserves active building, completes on turn, cleans on demolish, and round-trips v10 save', () => {
  let state = makeSandbox(
    [
      makeTile(0, 0, 'plains', 'building-castle'),
      makeTile(1, 0, 'fertile', 'building-farm'),
    ],
    {
      population: 12,
      resources: { wood: 120, stone: 120, food: 80, ore: 40, metal: 30, science: 0 },
      research: {
        unlocked: ['agriculture', 'construction', 'masonry'],
        activeTechId: null,
        progressScience: 0,
      },
    }
  );

  const evalBefore = evaluateBuildingModulesInKingdom(state, 1, 0, HEX_ASSETS);
  assert.ok(evalBefore !== null);
  assert.equal(evalBefore.slotsMax, 1);
  assert.equal(evalBefore.slotsUsed, 0);

  // Install farm_silo (2 turns)
  const installRes = installBuildingModuleInKingdom(state, 1, 0, 'farm_silo', HEX_ASSETS);
  assert.equal(installRes.started, true);
  state = installRes.nextState;

  // Parent Farm must remain operational while module is installing!
  const econDuring = getKingdomEconomy(state, HEX_ASSETS);
  assert.equal(econDuring.buildingsByKey['1,0'].status, 'operating');

  // Cannot start structural upgrade OR second module on same hex while queue is busy
  const blockedUpgrade = upgradeBuildingInKingdom(state, 1, 0, HEX_ASSETS);
  assert.equal(blockedUpgrade.started, false);
  const blockedSecondMod = installBuildingModuleInKingdom(state, 1, 0, 'farm_barn', HEX_ASSETS);
  assert.equal(blockedSecondMod.started, false);

  // Save & load v10 mid-installation
  const savedMid = serializeKingdomState(state);
  const parsedMid = JSON.parse(savedMid);
  assert.equal(parsedMid.version, 10);
  const loadedMid = deserializeKingdomState(savedMid, HEX_ASSETS.length);
  assert.ok(loadedMid !== null);
  assert.equal(loadedMid.constructions.length, 1);
  assert.equal(loadedMid.constructions[0].kind, 'module');
  assert.equal(loadedMid.constructions[0].moduleId, 'farm_silo');
  state = loadedMid;

  // Advance turns until farm_silo finishes
  const turns = state.constructions[0].turnsRemaining;
  let lastTurnRes;
  for (let i = 0; i < turns; i++) {
    lastTurnRes = advanceKingdomTurn(state, HEX_ASSETS);
    state = lastTurnRes.nextState;
  }
  assert.ok(lastTurnRes && lastTurnRes.completedModules.length === 1);
  assert.deepEqual(state.worldState.hexes['1,0']?.modules, ['farm_silo']);

  // Slots now full (1/1) at Nv. I -> second module blocked until upgrade to Nv. II
  const evalAfter = evaluateBuildingModulesInKingdom(state, 1, 0, HEX_ASSETS);
  assert.ok(evalAfter !== null);
  assert.equal(evalAfter.slotsUsed, 1);
  const farmBarnOpt = evalAfter.options.find((o) => o.definition.id === 'farm_barn');
  assert.equal(farmBarnOpt?.status, 'blocked');
  assert.match(farmBarnOpt?.reasonPt ?? '', /Slots cheios/);

  // Save & load v10 with installed module
  const savedDone = serializeKingdomState(state);
  const loadedDone = deserializeKingdomState(savedDone, HEX_ASSETS.length);
  assert.ok(loadedDone !== null);
  assert.deepEqual(loadedDone.worldState.hexes['1,0']?.modules, ['farm_silo']);

  // Demolish removes installed modules cleanly
  const dem = demolishInKingdom(loadedDone, 1, 0, HEX_ASSETS);
  assert.equal(dem.removed, true);
  assert.equal(dem.nextState.worldState.hexes['1,0']?.modules, undefined);
});
