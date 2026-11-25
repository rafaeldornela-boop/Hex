import test from 'node:test';
import assert from 'node:assert/strict';
import { HEX_ASSETS } from './repo-data';
import { DEFAULT_ROTATION_DEG, hasHexConstruction, hexKey, type AxialCoord } from './hex-engine';
import {
  advanceKingdomTurn,
  buildInKingdom,
  createSandboxKingdomState,
  createStarterKingdomState,
  demolishInKingdom,
  deserializeKingdomState,
  evaluateExpansionInKingdom,
  getKingdomEconomy,
  serializeKingdomState,
  startExpansionInKingdom,
  type KingdomState,
} from './kingdom-engine';
import { computeBuildingLocationEfficiency } from './economy-engine';
import {
  MIN_KINGDOM_POPULATION,
  allocateWorkersToBuildings,
  computeFoodDemand,
  evaluatePopulationDynamics,
} from './population-engine';
import { AXIAL_DIRECTIONS } from './territory-engine';
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
  owner: 'player' | 'neutral' = 'player'
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
  };
}

function buildSandboxWithTiles(tiles: ReturnType<typeof makeTile>[]): KingdomState {
  const base = createSandboxKingdomState();
  const hexes: KingdomState['worldState']['hexes'] = {};
  for (const t of tiles) {
    hexes[hexKey(t.q, t.r)] = t;
  }
  return {
    ...base,
    worldState: {
      ...base.worldState,
      cash: 2500,
      hexes,
    },
  };
}

test('population-engine enforces priority worker allocation and 1-turn food grace period before decline', () => {
  const alloc = allocateWorkersToBuildings({
    population: 3,
    unitWorkersUsed: 0,
    workOrders: [
      { key: '1,0', assetName: 'building-market', labelPt: 'Mercado', role: 'commerce', workersRequired: 2 },
      { key: '0,0', assetName: 'building-farm', labelPt: 'Fazenda', role: 'production', workersRequired: 2 },
      { key: '0,1', assetName: 'dirt-lumber', labelPt: 'Serraria', role: 'production', workersRequired: 2 },
    ],
  });

  // Farm (priority 1) gets 2/2, Serraria (priority 2) gets 1/2, Market (priority 3) gets 0/2
  assert.equal(alloc.assignmentsByKey['0,0'].assigned, 2);
  assert.equal(alloc.assignmentsByKey['0,1'].assigned, 1);
  assert.equal(alloc.assignmentsByKey['1,0'].assigned, 0);
  assert.equal(alloc.availableWorkers, 0);

  // Grace turn (prev foodDeficitTurns === 0): warns & throttles to 0.85x, NO immediate population loss
  const graceTurn = evaluatePopulationDynamics({
    population: 12,
    housingCapacity: 20,
    workerAllocation: alloc,
    foodStock: 0,
    foodProduced: 2,
    foodDeficitTurns: 0,
  });
  assert.equal(graceTurn.hasFoodDeficit, true);
  assert.equal(graceTurn.nextFoodDeficitTurns, 1);
  assert.equal(graceTurn.starvationFactor, 0.85);
  assert.equal(graceTurn.projectedGrowth, 0);

  // Sustained deficit (foodDeficitTurns >= 1): sharper penalty + gradual decline
  const sustainedDeficit = evaluatePopulationDynamics({
    population: 12,
    housingCapacity: 20,
    workerAllocation: alloc,
    foodStock: 0,
    foodProduced: 2,
    foodDeficitTurns: 1,
  });
  assert.equal(sustainedDeficit.nextFoodDeficitTurns, 2);
  assert.equal(sustainedDeficit.starvationFactor, 0.65);
  assert.equal(sustainedDeficit.projectedGrowth, -1);

  // Never drops below MIN_KINGDOM_POPULATION
  const floorCheck = evaluatePopulationDynamics({
    population: MIN_KINGDOM_POPULATION,
    housingCapacity: 20,
    workerAllocation: alloc,
    foodStock: 0,
    foodProduced: 0,
    foodDeficitTurns: 3,
  });
  assert.equal(floorCheck.projectedGrowth, 0);
});

test('per-building worker shortage stalls idle structures until Casa + turn recovery', () => {
  // 1 Castle (+8 cap = 12 total cap), 1 Farm (2w, prio 1), 1 Serraria (2w, prio 2), 1 Market (2w, prio 3)
  // Demand = 6 workers, Population = 4 -> Farm & Serraria get 2/2, Market gets 0/2 (idle!)
  let state = buildSandboxWithTiles([
    makeTile(0, 0, 'plains', 'building-castle'),
    makeTile(1, 0, 'fertile', 'building-farm'),
    makeTile(0, -1, 'forest', 'dirt-lumber'),
    makeTile(0, 1, 'plains', 'building-market'),
    makeTile(-1, 0, 'plains'),
    makeTile(-1, 1, 'fertile'),
  ]);
  state = {
    ...state,
    population: 4,
    resources: { ...state.resources, food: 60 },
  };

  const econIdle = getKingdomEconomy(state, HEX_ASSETS);
  assert.equal(econIdle.buildingsByKey['1,0'].status, 'operating');
  assert.equal(econIdle.buildingsByKey['0,-1'].status, 'operating');
  assert.equal(econIdle.buildingsByKey['0,1'].status, 'idle');
  assert.equal(econIdle.buildingsByKey['0,1'].actualProduction.gold, 0);
  assert.match(econIdle.buildingsByKey['0,1'].reasonPt ?? '', /Sem trabalhadores/);
  assert.ok(econIdle.attentionHexKeys.includes('0,1'));

  // Build Casa on (-1, 0) -> 1 turn construction, produces nothing while under construction
  const buildHouse = buildInKingdom(state, -1, 0, idxOf('building-house'), 90, HEX_ASSETS);
  assert.equal(buildHouse.built, true);
  state = buildHouse.nextState;

  const econWhileBuilding = getKingdomEconomy(state, HEX_ASSETS);
  assert.equal(econWhileBuilding.buildingsByKey['-1,0'].status, 'under_construction');
  assert.equal(econWhileBuilding.buildingsByKey['-1,0'].workersAssigned, 0);

  // Turn 2: House finishes in Step 1, food surplus triggers population growth (+2) -> pop becomes 6!
  state = advanceKingdomTurn(state, HEX_ASSETS).nextState;
  assert.ok(state.population >= 6, `Expected population growth after House, got ${state.population}`);

  const econRecovered = getKingdomEconomy(state, HEX_ASSETS);
  assert.equal(econRecovered.buildingsByKey['0,1'].status, 'operating');
  assert.equal(econRecovered.buildingsByKey['0,1'].workersAssigned, 2);
  assert.ok(econRecovered.buildingsByKey['0,1'].actualProduction.gold >= 18);
});

test('food deficit follows 1-turn grace period then declines population cleanly and recovers on surplus', () => {
  let state = buildSandboxWithTiles([
    makeTile(0, 0, 'plains', 'building-castle'),
    makeTile(1, 0, 'plains', 'building-house'),
    makeTile(-1, 0, 'fertile'),
  ]);
  state = {
    ...state,
    population: 14, // food demand = ceil(14 * 0.6) = 9/turn; base food prod = 4 + 2 = 6/turn
    resources: { ...state.resources, food: 0 },
  };

  // Turn 1 -> Turn 2: grace period! Pop stays 14, foodDeficitTurns becomes 1
  state = advanceKingdomTurn(state, HEX_ASSETS).nextState;
  assert.equal(state.population, 14);
  assert.equal(state.foodDeficitTurns, 1);

  // Turn 2 -> Turn 3: sustained deficit -> population declines to 13
  state = advanceKingdomTurn(state, HEX_ASSETS).nextState;
  assert.equal(state.population, 13);
  assert.ok(state.foodDeficitTurns >= 2);

  // Restore food surplus -> deficit counter resets and population stabilizes/recovers
  state = {
    ...state,
    resources: { ...state.resources, food: 50 },
  };
  state = advanceKingdomTurn(state, HEX_ASSETS).nextState;
  assert.equal(state.foodDeficitTurns, 0);
  assert.ok(state.population >= 13);
});

test('location & adjacency efficiency differentiates smart placement from isolated placement', () => {
  const isolatedForest = makeTile(0, 0, 'forest', 'dirt-lumber');
  const isolatedWorld = buildSandboxWithTiles([
    isolatedForest,
    makeTile(1, 0, 'plains'),
    makeTile(0, 1, 'plains'),
  ]).worldState;

  const clusterWorld = buildSandboxWithTiles([
    isolatedForest,
    makeTile(1, 0, 'forest'),
    makeTile(0, 1, 'forest'),
    makeTile(-1, 1, 'forest'),
  ]).worldState;

  const isoEff = computeBuildingLocationEfficiency(
    isolatedWorld,
    isolatedForest,
    'dirt-lumber',
    HEX_ASSETS
  );
  const clusEff = computeBuildingLocationEfficiency(
    clusterWorld,
    isolatedForest,
    'dirt-lumber',
    HEX_ASSETS
  );
  assert.ok(clusEff.factor > isoEff.factor);

  const farmTile = makeTile(0, 0, 'fertile', 'building-farm');
  const farmBoostedWorld = buildSandboxWithTiles([
    farmTile,
    makeTile(1, 0, 'water'),
    makeTile(0, 1, 'plains', 'building-mill'),
  ]).worldState;
  const farmEff = computeBuildingLocationEfficiency(
    farmBoostedWorld,
    farmTile,
    'building-farm',
    HEX_ASSETS
  );
  assert.ok(farmEff.factor >= 1.3);
  assert.ok(farmEff.notesPt.length >= 2);
});

test('Fundição consumes ore to smelt metal and stalls cleanly on ore shortage', () => {
  let state = buildSandboxWithTiles([
    makeTile(0, 0, 'plains', 'building-castle'),
    makeTile(1, 0, 'mountain', 'building-mine'),
    makeTile(0, 1, 'plains', 'building-smelter'),
  ]);
  state = {
    ...state,
    population: 12,
    resources: { ...state.resources, ore: 10, metal: 0 },
    research: {
      unlocked: ['mining', 'metallurgy'],
      activeTechId: null,
      progressScience: 0,
    },
  };

  // With Mine supplying ore, Smelter operates, consumes 2 ore, produces >= 3 metal
  const econWithOre = getKingdomEconomy(state, HEX_ASSETS);
  assert.equal(econWithOre.buildingsByKey['0,1'].status, 'operating');
  assert.equal(econWithOre.oreConsumed, 2);
  assert.ok(econWithOre.metalProduced >= 3);

  state = advanceKingdomTurn(state, HEX_ASSETS).nextState;
  assert.ok(state.resources.metal >= 3);

  // Without Mine and 0 ore stockpile, Smelter stalls due to missing ore input
  const noOreState = buildSandboxWithTiles([
    makeTile(0, 0, 'plains', 'building-castle'),
    makeTile(0, 1, 'plains', 'building-smelter'),
  ]);
  const stalledState: KingdomState = {
    ...noOreState,
    population: 12,
    resources: { ...noOreState.resources, ore: 0, metal: 0 },
  };
  const econNoOre = getKingdomEconomy(stalledState, HEX_ASSETS);
  assert.equal(econNoOre.buildingsByKey['0,1'].status, 'idle');
  assert.match(econNoOre.buildingsByKey['0,1'].reasonPt ?? '', /Falta de minério/);
  assert.equal(econNoOre.metalProduced, 0);
});

test('economy invariants hold across organic expansion, multi-turn simulation, demolition, and v4/v5/v6 save/load', () => {
  let state = createStarterKingdomState(HEX_ASSETS, 42026);
  const cap = state.playerCapital!;

  // Start organic incorporation on an eligible adjacent forest tile (zero gold spent)
  let forestCoord: AxialCoord | null = null;
  for (const tile of Object.values(state.worldState.hexes)) {
    if (tile.owner !== 'neutral' || tile.terrainType !== 'forest') continue;
    const adj = AXIAL_DIRECTIONS.some(
      (d) => state.worldState.hexes[hexKey(tile.q + d.q, tile.r + d.r)]?.owner === 'player'
    );
    if (adj && evaluateExpansionInKingdom(state, tile.q, tile.r, HEX_ASSETS).canExpand) {
      forestCoord = { q: tile.q, r: tile.r };
      break;
    }
  }

  if (forestCoord) {
    const cashBeforeExpand = state.worldState.cash;
    const started = startExpansionInKingdom(state, forestCoord.q, forestCoord.r, HEX_ASSETS);
    assert.equal(started.started, true);
    state = started.nextState;
    assert.equal(state.worldState.cash, cashBeforeExpand);

    const econDuringExpand = getKingdomEconomy(state, HEX_ASSETS);
    assert.ok(econDuringExpand.population.expansionWorkersUsed >= 1);

    const turnsNeeded = started.expansion!.totalTurns;
    for (let t = 0; t < turnsNeeded; t++) {
      state = advanceKingdomTurn(state, HEX_ASSETS).nextState;
    }
    assert.equal(state.worldState.hexes[hexKey(forestCoord.q, forestCoord.r)]?.owner, 'player');
    assert.equal(getKingdomEconomy(state, HEX_ASSETS).population.expansionWorkersUsed, 0);

    const built = buildInKingdom(state, forestCoord.q, forestCoord.r, idxOf('dirt-lumber'), 90, HEX_ASSETS);
    assert.equal(built.built, true);
    state = built.nextState;
  }

  for (let i = 0; i < 6; i++) {
    const res = advanceKingdomTurn(state, HEX_ASSETS);
    state = res.nextState;
    const econ = getKingdomEconomy(state, HEX_ASSETS);

    assert.ok(Number.isFinite(state.worldState.cash) && state.worldState.cash >= 0);
    assert.ok(Number.isFinite(state.resources.wood) && state.resources.wood >= 0 && state.resources.wood <= econ.storageCaps.wood);
    assert.ok(Number.isFinite(state.resources.stone) && state.resources.stone >= 0 && state.resources.stone <= econ.storageCaps.stone);
    assert.ok(Number.isFinite(state.resources.food) && state.resources.food >= 0 && state.resources.food <= econ.storageCaps.food);
    assert.ok(Number.isFinite(state.resources.ore) && state.resources.ore >= 0 && state.resources.ore <= econ.storageCaps.ore);
    assert.ok(Number.isFinite(state.resources.metal) && state.resources.metal >= 0 && state.resources.metal <= econ.storageCaps.metal);
    assert.ok(state.population >= MIN_KINGDOM_POPULATION && state.population <= econ.population.capacity);
    assert.ok(econ.population.availableWorkers >= 0);
    assert.equal(computeFoodDemand(state.population), econ.foodConsumed);
  }

  // Demolish preserves terrain and natural resource
  if (forestCoord) {
    const dem = demolishInKingdom(state, forestCoord.q, forestCoord.r, HEX_ASSETS);
    assert.equal(dem.removed, true);
    const tileAfter = dem.nextState.worldState.hexes[hexKey(forestCoord.q, forestCoord.r)];
    assert.equal(tileAfter?.owner, 'player');
    assert.equal(tileAfter?.terrainType, 'forest');
    assert.equal(tileAfter?.resourceType, 'wood');
    assert.equal(hasHexConstruction(tileAfter, HEX_ASSETS), false);
    state = dem.nextState;
  }

  // Save/Load v7 round-trip + v4/v5/v6 compatibility
  const saved = serializeKingdomState(state);
  const parsed = JSON.parse(saved);
  assert.equal(parsed.version, 7);

  const loaded = deserializeKingdomState(saved, HEX_ASSETS.length);
  assert.ok(loaded !== null);
  assert.equal(loaded.resources.metal, state.resources.metal);
  assert.equal(loaded.foodDeficitTurns, state.foodDeficitTurns);
  assert.deepEqual(loaded.playerCapital, cap);
  assert.ok(Array.isArray(loaded.expansions));

  const v4Legacy = JSON.stringify({
    ...parsed,
    version: 4,
    expansions: undefined,
    resources: {
      wood: 30,
      stone: 20,
      food: 40,
      ore: 15,
      science: 5,
    },
    foodDeficitTurns: undefined,
  });
  const loadedV4 = deserializeKingdomState(v4Legacy, HEX_ASSETS.length);
  assert.ok(loadedV4 !== null);
  assert.equal(loadedV4.resources.metal, 10);
  assert.equal(loadedV4.foodDeficitTurns, 0);
  assert.equal(loadedV4.expansions.length, 0);
});
