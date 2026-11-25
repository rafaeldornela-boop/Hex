import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
  aggregateTileModuleEffects,
  computeModuleScaledCost,
  getBuildingModuleVisualPlacement,
  getCompatibleModulesForBuilding,
  getInstalledModules,
  getModuleSlotsForBuilding,
  isPointInsideLocalHex,
  isValidBuildingModuleId,
} from './building-modules-engine';
import { isConstructibleBuildingName } from './buildings-catalog';
import { getBuildingMaxLevel } from './building-upgrade-engine';
import { evaluateRegionalWorld } from './regional-engine';
import { computeRoadConnectivity } from './road-engine';
import { computeCalendarSnapshot } from './calendar-engine';
import { normalizeClimateWeather } from './season-engine';
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
  const resourceMap: Record<TerrainType, 'none' | 'wood' | 'food' | 'ore' | 'water'> = {
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
  const lumberReport = econ.buildingsByKey['0,-1'];
  assert.equal(lumberReport.status, 'partial');
  assert.equal(lumberReport.workersAssigned, 1);
  assert.equal(lumberReport.workersRequired, 2);
  assert.ok(lumberReport.actualProduction.wood > 0);
});

test('city evolution requires BOTH developmentScore AND minimum population thresholds', () => {
  // Score 120 without enough population cannot skip to Grande Cidade
  assert.equal(getCityStageForMetrics({ developmentScore: 120, population: 6 }), 1);
  assert.equal(getCityStageForMetrics({ developmentScore: 120, population: 8 }), 2);
  assert.equal(getCityStageForMetrics({ developmentScore: 120, population: 18 }), 3);
  assert.equal(getCityStageForMetrics({ developmentScore: 120, population: 28 }), 4);
  assert.equal(getCityStageForMetrics({ developmentScore: 120, population: 40 }), 5);
  // High population without score is also gated by score
  assert.equal(getCityStageForMetrics({ developmentScore: 10, population: 50 }), 1);
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

  // Food cap increase: +25 (Farm Nv2) + 15 (House Nv2) + 20 (mil_armory general) + 35 (farm_silo food) = 95
  assert.equal(moddedEcon.storageCaps.food - baseEcon.storageCaps.food, 95);
  assert.equal(moddedEcon.storageCaps.wood - baseEcon.storageCaps.wood, 60);
  assert.ok(moddedEcon.foodProduced > baseEcon.foodProduced);
  assert.equal(moddedEcon.population.capacity - baseEcon.population.capacity, 2 + 4); // +2 res_extension, +4 Nv.2 house
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
        unlocked: ['agriculture', 'construction'],
        activeTechId: null,
        progressScience: 0,
      },
    }
  );

  const evalBefore = evaluateBuildingModulesInKingdom(state, 1, 0, HEX_ASSETS);
  assert.ok(evalBefore !== null);
  assert.equal(evalBefore.slotsMax, 1);
  assert.equal(evalBefore.slotsUsed, 0);

  const goldBefore = state.worldState.cash;
  const woodBefore = state.resources.wood;

  // Install farm_silo (2 turns) — cost deducted immediately up front
  const installRes = installBuildingModuleInKingdom(state, 1, 0, 'farm_silo', HEX_ASSETS);
  assert.equal(installRes.started, true);
  state = installRes.nextState;
  assert.ok(state.worldState.cash < goldBefore);
  assert.ok(state.resources.wood < woodBefore);

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

test('all 35 building modules pass catalog integrity, compatible assets, effects, visual kinds, and hex-bound checks', () => {
  const modules = Object.values(BUILDING_MODULES);
  assert.equal(modules.length, 35);
  assert.equal(isValidBuildingModuleId('nonexistent_module_id'), false);

  const sceneSource = readFileSync(
    join(process.cwd(), 'components/game/HexSceneController.ts'),
    'utf8'
  );
  const assetNameSet = new Set(HEX_ASSETS.map((a) => a.name));

  for (const mod of modules) {
    assert.equal(isValidBuildingModuleId(mod.id), true);
    assert.ok(mod.labelPt.trim().length > 0, `Missing labelPt for ${mod.id}`);
    assert.ok(mod.summaryPt.trim().length > 0, `Missing summaryPt for ${mod.id}`);
    assert.ok(mod.buildTimeTurns >= 1, `Invalid buildTimeTurns for ${mod.id}`);
    assert.ok(mod.compatibleAssets.length >= 1, `No compatible assets for ${mod.id}`);

    // Verify compatible buildings exist in asset catalog & build rules (capital castle also valid)
    for (const assetName of mod.compatibleAssets) {
      assert.ok(assetNameSet.has(assetName), `Asset ${assetName} missing in HEX_ASSETS for ${mod.id}`);
      assert.ok(
        assetName === 'building-castle' || isConstructibleBuildingName(assetName),
        `Compatible asset ${assetName} for ${mod.id} is neither castle nor constructible`
      );
    }

    // Verify valid concrete effect in engine aggregation
    const agg = aggregateTileModuleEffects(mod.compatibleAssets[0], [mod.id]);
    const prodSum = Object.values(agg.prodPct).reduce((a, b) => a + b, 0);
    const hasEffect =
      prodSum !== 0 ||
      agg.springSummerFoodPct !== 0 ||
      agg.flatGold !== 0 ||
      agg.flatScience !== 0 ||
      agg.housingBonus !== 0 ||
      agg.storageGeneralBonus !== 0 ||
      agg.storageFoodBonus !== 0 ||
      agg.defenseBonus !== 0 ||
      agg.maintenanceDelta !== 0 ||
      agg.urbanQualityBonus !== 0 ||
      agg.logisticsBonusPct !== 0 ||
      agg.seasonalResilience !== 0 ||
      agg.winterResilience !== 0 ||
      agg.droughtResilience !== 0 ||
      agg.rainStormResilience !== 0 ||
      Object.keys(agg.regionalWeights).length > 0;
    assert.equal(hasEffect, true, `Module ${mod.id} has empty effect`);

    // Verify 3D visual coverage in HexSceneController.ts
    assert.ok(mod.visual.footprintRadius > 0 && mod.visual.footprintRadius <= 0.12);
    assert.ok(
      sceneSource.includes(`case '${mod.visual.kind}':`),
      `HexSceneController.ts missing case '${mod.visual.kind}' for module ${mod.id}`
    );

    // Verify strict hex containment across every compatible asset and level
    for (const assetName of mod.compatibleAssets) {
      const maxLv = getBuildingMaxLevel(assetName);
      for (let lv = 1; lv <= maxLv; lv++) {
        const placement = getBuildingModuleVisualPlacement(assetName, mod.id, lv);
        assert.ok(Number.isFinite(placement.groundY));
        assert.ok(
          isPointInsideLocalHex(
            placement.offsetX,
            placement.offsetZ,
            placement.footprintRadius
          ),
          `Module ${mod.id} on ${assetName} Nv.${lv} overflows hex bounds: (${placement.offsetX}, ${placement.offsetZ}) r=${placement.footprintRadius}`
        );
        if (mod.id === 'port_expanded_dock') {
          assert.equal(placement.isOverWater, true);
          assert.equal(placement.groundY, 0.1);
        }
      }
    }
  }

  assert.match(BUILDING_MODULES.castle_royal_archive.summaryPt, /Vocação Acadêmica/);
});

test('isolated silo storage, irrigation production, incompatible blocking, and deduplication (no doubled bonuses)', () => {
  const farmBase = makeSandbox(
    [
      makeTile(0, 0, 'plains', 'building-castle'),
      makeTile(1, 0, 'fertile', 'building-farm', 'player', 2),
      makeTile(-1, 0, 'mountain', 'building-mine', 'player', 1),
    ],
    {
      population: 12,
      resources: { wood: 100, stone: 100, food: 100, ore: 50, metal: 20, science: 0 },
      research: {
        unlocked: ['agriculture', 'mining'],
        activeTechId: null,
        progressScience: 0,
      },
    }
  );
  const econBase = getKingdomEconomy(farmBase, HEX_ASSETS);

  // Silo only alters food storage (+35) and report matches
  const farmSilo = makeSandbox(
    [
      makeTile(0, 0, 'plains', 'building-castle'),
      makeTile(1, 0, 'fertile', 'building-farm', 'player', 2, ['farm_silo']),
      makeTile(-1, 0, 'mountain', 'building-mine', 'player', 1),
    ],
    {
      population: 12,
      resources: { wood: 100, stone: 100, food: 100, ore: 50, metal: 20, science: 0 },
      research: {
        unlocked: ['agriculture', 'mining'],
        activeTechId: null,
        progressScience: 0,
      },
    }
  );
  const econSilo = getKingdomEconomy(farmSilo, HEX_ASSETS);
  assert.equal(econSilo.storageCaps.food - econBase.storageCaps.food, 35);
  assert.equal(econSilo.storageCaps.wood - econBase.storageCaps.wood, 0);
  assert.equal(econSilo.buildingsByKey['1,0'].effectiveStorageFood, 35);

  // Duplicate IDs on the same tile must NOT duplicate bonuses
  const farmSiloDup = makeSandbox(
    [
      makeTile(0, 0, 'plains', 'building-castle'),
      makeTile(1, 0, 'fertile', 'building-farm', 'player', 2, ['farm_silo', 'farm_silo']),
      makeTile(-1, 0, 'mountain', 'building-mine', 'player', 1),
    ],
    {
      population: 12,
      resources: { wood: 100, stone: 100, food: 100, ore: 50, metal: 20, science: 0 },
      research: {
        unlocked: ['agriculture', 'mining'],
        activeTechId: null,
        progressScience: 0,
      },
    }
  );
  assert.deepEqual(getInstalledModules(farmSiloDup.worldState.hexes['1,0']), ['farm_silo']);
  const econSiloDup = getKingdomEconomy(farmSiloDup, HEX_ASSETS);
  assert.equal(econSiloDup.storageCaps.food, econSilo.storageCaps.food);
  assert.equal(econSiloDup.buildingsByKey['1,0'].effectiveStorageFood, 35);

  // Irrigation alters food production
  const farmIrrig = makeSandbox(
    [
      makeTile(0, 0, 'plains', 'building-castle'),
      makeTile(1, 0, 'fertile', 'building-farm', 'player', 2, ['farm_irrigation']),
      makeTile(-1, 0, 'mountain', 'building-mine', 'player', 1),
    ],
    {
      population: 12,
      resources: { wood: 100, stone: 100, food: 100, ore: 50, metal: 20, science: 0 },
      research: {
        unlocked: ['agriculture', 'mining'],
        activeTechId: null,
        progressScience: 0,
      },
    }
  );
  const econIrrig = getKingdomEconomy(farmIrrig, HEX_ASSETS);
  assert.ok(econIrrig.foodProduced > econBase.foodProduced);
  assert.ok(
    econIrrig.buildingsByKey['1,0'].actualProduction.food >
      econBase.buildingsByKey['1,0'].actualProduction.food
  );

  // Incompatible modules are blocked by installer and ignored by engine aggregation
  const incompatOnMine = installBuildingModuleInKingdom(farmBase, -1, 0, 'farm_silo', HEX_ASSETS);
  assert.equal(incompatOnMine.started, false);
  const incompatOnFarm = installBuildingModuleInKingdom(farmBase, 1, 0, 'mine_deep_gallery', HEX_ASSETS);
  assert.equal(incompatOnFarm.started, false);
  const bogusEff = aggregateTileModuleEffects('building-mine', ['farm_silo']);
  assert.equal(bogusEff.storageFoodBonus, 0);
  assert.equal(bogusEff.winterResilience, 0);
});

test('seasonal weather resilience, regional specialization boost, and legacy meta.modules migration', () => {
  // 1. Seasonal drought mitigation (farm_irrigation) & winter frost mitigation (farm_silo)
  const drought = normalizeClimateWeather({ id: 'drought_weather', turnsRemaining: 2 });
  const frost = normalizeClimateWeather({ id: 'frost', turnsRemaining: 2 });
  const summerCal = computeCalendarSnapshot(15);
  const autumnCal = computeCalendarSnapshot(27);
  const winterCal = computeCalendarSnapshot(39);

  const farmPlainSummer = makeSandbox(
    [
      makeTile(0, 0, 'plains', 'building-castle'),
      makeTile(1, 0, 'plains', 'building-farm', 'player', 1),
    ],
    {
      calendar: summerCal,
      climateWeather: drought,
      population: 10,
      resources: { wood: 100, stone: 100, food: 100, ore: 40, metal: 20, science: 0 },
    }
  );
  const farmIrrigSummer = makeSandbox(
    [
      makeTile(0, 0, 'plains', 'building-castle'),
      makeTile(1, 0, 'plains', 'building-farm', 'player', 1, ['farm_irrigation']),
    ],
    {
      calendar: summerCal,
      climateWeather: drought,
      population: 10,
      resources: { wood: 100, stone: 100, food: 100, ore: 40, metal: 20, science: 0 },
    }
  );
  const econDryBase = getKingdomEconomy(farmPlainSummer, HEX_ASSETS);
  const econDryIrrig = getKingdomEconomy(farmIrrigSummer, HEX_ASSETS);
  assert.ok(econDryIrrig.foodProduced > econDryBase.foodProduced);

  const farmPlainWinter = makeSandbox(
    [
      makeTile(0, 0, 'plains', 'building-castle'),
      makeTile(1, 0, 'fertile', 'building-farm', 'player', 1),
    ],
    {
      calendar: winterCal,
      climateWeather: frost,
      population: 10,
      resources: { wood: 100, stone: 100, food: 100, ore: 40, metal: 20, science: 0 },
    }
  );
  const farmSiloWinter = makeSandbox(
    [
      makeTile(0, 0, 'plains', 'building-castle'),
      makeTile(1, 0, 'fertile', 'building-farm', 'player', 1, ['farm_silo']),
    ],
    {
      calendar: winterCal,
      climateWeather: frost,
      population: 10,
      resources: { wood: 100, stone: 100, food: 100, ore: 40, metal: 20, science: 0 },
    }
  );
  const econFrostBase = getKingdomEconomy(farmPlainWinter, HEX_ASSETS);
  const econFrostSilo = getKingdomEconomy(farmSiloWinter, HEX_ASSETS);
  assert.ok(econFrostSilo.foodProduced > econFrostBase.foodProduced);

  // Rain storm mitigation on Mine with mine_drainage
  const storm = normalizeClimateWeather({ id: 'storm', turnsRemaining: 2 });
  const mineStormBase = makeSandbox(
    [
      makeTile(0, 0, 'plains', 'building-castle'),
      makeTile(1, 0, 'mountain', 'building-mine', 'player', 2),
    ],
    {
      calendar: autumnCal,
      climateWeather: storm,
      population: 12,
      resources: { wood: 100, stone: 100, food: 100, ore: 40, metal: 20, science: 0 },
    }
  );
  const mineStormDrain = makeSandbox(
    [
      makeTile(0, 0, 'plains', 'building-castle'),
      makeTile(1, 0, 'mountain', 'building-mine', 'player', 2, ['mine_drainage']),
    ],
    {
      calendar: autumnCal,
      climateWeather: storm,
      population: 12,
      resources: { wood: 100, stone: 100, food: 100, ore: 40, metal: 20, science: 0 },
    }
  );
  const econStormBase = getKingdomEconomy(mineStormBase, HEX_ASSETS);
  const econStormDrain = getKingdomEconomy(mineStormDrain, HEX_ASSETS);
  assert.ok(
    econStormDrain.buildingsByKey['1,0'].actualProduction.ore >
      econStormBase.buildingsByKey['1,0'].actualProduction.ore
  );

  // 2. Regional specialization incorporates modules (e.g. farm_seed_vault -> +3 agricultural)
  const cities = [
    { id: 'cap', name: 'Capital', center: { q: 0, r: 0 }, owner: 'player' as const, level: 2 },
  ];
  const sampleRoads = {
    '0,0': { q: 0, r: 0, level: 1 as const, owner: 'player' as const },
    '1,0': { q: 1, r: 0, level: 1 as const, owner: 'player' as const },
  };
  const connBase = computeRoadConnectivity({
    worldState: farmBaseCheckWorld(farmPlainWinter),
    cityCenters: cities,
    roads: sampleRoads,
    assets: HEX_ASSETS,
  });
  const regBase = evaluateRegionalWorld({
    worldState: farmPlainWinter.worldState,
    cities,
    roads: sampleRoads,
    connectivity: connBase,
    assets: HEX_ASSETS,
  });
  const farmAgroModded = makeSandbox([
    makeTile(0, 0, 'plains', 'building-castle'),
    makeTile(1, 0, 'fertile', 'building-farm', 'player', 2, ['farm_seed_vault', 'farm_silo']),
  ]);
  const connMod = computeRoadConnectivity({
    worldState: farmAgroModded.worldState,
    cityCenters: cities,
    roads: sampleRoads,
    assets: HEX_ASSETS,
  });
  const regMod = evaluateRegionalWorld({
    worldState: farmAgroModded.worldState,
    cities,
    roads: sampleRoads,
    connectivity: connMod,
    assets: HEX_ASSETS,
  });
  const agroBaseScore =
    regBase.cityProfilesById['cap']?.specializations.find((s) => s.id === 'agricultural')?.score ??
    0;
  const agroModScore =
    regMod.cityProfilesById['cap']?.specializations.find((s) => s.id === 'agricultural')?.score ??
    0;
  assert.ok(agroBaseScore > 0);
  assert.equal(agroModScore - agroBaseScore, 3);

  // 3. Save migration preserves legacy meta.modules and strips invalid/duplicate entries
  const legacySaved = JSON.parse(serializeKingdomState(farmBaseCheckState(farmPlainWinter)));
  const farmEntry = (legacySaved.structures as Array<{ q: number; r: number; modules?: string[]; meta?: Record<string, unknown> }>).find(
    (s) => s.q === 1 && s.r === 0
  );
  assert.ok(farmEntry);
  delete farmEntry.modules;
  farmEntry.meta = {
    ...(farmEntry.meta ?? {}),
    modules: ['farm_silo', 'farm_silo', 'invalid_mod_x'],
  };
  const migrated = deserializeKingdomState(JSON.stringify(legacySaved), HEX_ASSETS.length);
  assert.ok(migrated !== null);
  assert.deepEqual(migrated.worldState.hexes['1,0']?.modules, ['farm_silo']);
  assert.deepEqual(migrated.worldState.hexes['1,0']?.meta?.modules, ['farm_silo']);
});

function farmBaseCheckWorld(state: KingdomState) {
  return state.worldState;
}

function farmBaseCheckState(state: KingdomState) {
  return state;
}
