import test from 'node:test';
import assert from 'node:assert/strict';
import { HEX_ASSETS } from './repo-data';
import {
  DEFAULT_ROTATION_DEG,
  HEX_FLAT_TO_FLAT,
  axialToWorld,
  createStarterWorldState,
  deserializeWorldState,
  hasHexConstruction,
  hexKey,
  placeHexInState,
  serializeWorldState,
  type HexWorldState,
  type PlacedHex,
} from './hex-engine';
import {
  DEFAULT_FOREST_WOOD_STOCK,
  TERRAIN_METADATA,
  calculatePlayerResources,
  resolveTerrainTypeFromAssetName,
  type TerrainType,
} from './terrain-engine';
import { AXIAL_DIRECTIONS, axialDistance } from './territory-engine';
import {
  DEFAULT_ADJACENCY_CONFIG,
  computeAdjacencyScaledEffect,
  computeFertileIrrigation,
  computeForestHuntingCapacity,
  computePlainsPastureCapacity,
  computeWaterFishingCapacity,
  consumeForestWood,
  evaluateWorldAdjacencyPools,
  getForestWoodStock,
  getHexNeighbors,
} from './adjacency-engine';
import {
  advanceKingdomTurn,
  createSandboxKingdomState,
  deserializeKingdomState,
  getKingdomEconomy,
  serializeKingdomState,
  type KingdomState,
} from './kingdom-engine';
import { generateProceduralKingdomWorld } from './world-generator';

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
  extra?: Partial<PlacedHex>
): PlacedHex {
  const chosenAsset = assetName ?? TERRAIN_METADATA[terrainType].defaultAssetName;
  const resourceMap: Record<TerrainType, 'none' | 'wood' | 'food' | 'ore' | 'water'> = {
    plains: 'none',
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
    resourceAmount: terrainType === 'plains' ? 0 : 10,
    ...(terrainType === 'forest' ? { woodStock: DEFAULT_FOREST_WOOD_STOCK } : {}),
    ...extra,
  };
}

function makeWorld(tiles: PlacedHex[]): HexWorldState {
  const hexes: Record<string, PlacedHex> = {};
  for (const t of tiles) {
    hexes[hexKey(t.q, t.r)] = t;
  }
  return {
    cash: 2000,
    hexes,
  };
}

function makeSandboxKingdom(tiles: PlacedHex[]): KingdomState {
  const base = createSandboxKingdomState();
  const worldState = makeWorld(tiles);
  return {
    ...base,
    population: 18,
    worldState: {
      ...base.worldState,
      ...worldState,
    },
  };
}

test('central neighbor query returns exactly 6 real hexagonal neighbors with exact axial & world geometry', () => {
  const center = makeTile(2, -1, 'plains');
  const ringTiles = AXIAL_DIRECTIONS.map((d, i) =>
    makeTile(center.q + d.q, center.r + d.r, i % 2 === 0 ? 'forest' : 'water')
  );
  const world = makeWorld([center, ...ringTiles]);

  const neighbors = getHexNeighbors(world, center.q, center.r, HEX_ASSETS);
  assert.equal(neighbors.length, 6);

  const uniqueKeys = new Set(neighbors.map((n) => n.key));
  assert.equal(uniqueKeys.size, 6);

  const originWorld = axialToWorld(center.q, center.r);
  for (const n of neighbors) {
    assert.equal(n.exists, true);
    assert.equal(axialDistance(center, n.coord), 1);
    const nw = axialToWorld(n.coord.q, n.coord.r);
    const dist = Math.hypot(nw.x - originWorld.x, nw.z - originWorld.z);
    assert.ok(Math.abs(dist - HEX_FLAT_TO_FLAT) < 1e-9);
  }
});

test('terrain visual variants stay mapped to the 5 base economic terrain types', () => {
  assert.equal(resolveTerrainTypeFromAssetName('dirt'), 'fertile');
  assert.equal(resolveTerrainTypeFromAssetName('grass'), 'plains');
  assert.equal(resolveTerrainTypeFromAssetName('grass-hill'), 'plains');
  assert.equal(resolveTerrainTypeFromAssetName('grass-forest'), 'forest');
  assert.equal(resolveTerrainTypeFromAssetName('dirt-lumber'), 'forest');
  assert.equal(resolveTerrainTypeFromAssetName('stone-mountain'), 'mountain');
  assert.equal(resolveTerrainTypeFromAssetName('stone-hill'), 'mountain');
  assert.equal(resolveTerrainTypeFromAssetName('stone-rocks'), 'mountain');
  assert.equal(resolveTerrainTypeFromAssetName('water'), 'water');
  assert.equal(resolveTerrainTypeFromAssetName('water-island'), 'water');
  assert.equal(resolveTerrainTypeFromAssetName('water-rocks'), 'water');
});

test('capacities scale per neighbor and strictly respect configurable bonus caps', () => {
  // Forest hunting: base 4, +2 per forest neighbor, capped at +6 (total max 10 even with 6 neighbors)
  const isolatedForest = makeWorld([makeTile(0, 0, 'forest')]);
  const f0 = computeForestHuntingCapacity(isolatedForest, 0, 0, HEX_ASSETS);
  assert.equal(f0.huntingCapacity, DEFAULT_ADJACENCY_CONFIG.forest.huntingBaseCapacity);
  assert.equal(f0.huntingCapReached, false);

  const oneNeighborForest = makeWorld([
    makeTile(0, 0, 'forest'),
    makeTile(AXIAL_DIRECTIONS[0].q, AXIAL_DIRECTIONS[0].r, 'forest'),
  ]);
  const f1 = computeForestHuntingCapacity(oneNeighborForest, 0, 0, HEX_ASSETS);
  assert.equal(
    f1.huntingCapacity,
    DEFAULT_ADJACENCY_CONFIG.forest.huntingBaseCapacity +
      DEFAULT_ADJACENCY_CONFIG.forest.huntingPerNeighborBonus
  );

  const fullForestRing = makeWorld([
    makeTile(0, 0, 'forest'),
    ...AXIAL_DIRECTIONS.map((d) => makeTile(d.q, d.r, 'forest')),
  ]);
  const f6 = computeForestHuntingCapacity(fullForestRing, 0, 0, HEX_ASSETS);
  assert.equal(f6.activeForestNeighbors, 6);
  assert.equal(
    f6.huntingAdjacencyBonus,
    DEFAULT_ADJACENCY_CONFIG.forest.huntingMaxNeighborBonus
  );
  assert.equal(
    f6.huntingCapacity,
    DEFAULT_ADJACENCY_CONFIG.forest.huntingBaseCapacity +
      DEFAULT_ADJACENCY_CONFIG.forest.huntingMaxNeighborBonus
  );
  assert.equal(f6.huntingCapReached, true);

  // Water fishing: base 4, +2 per water neighbor, capped at +6
  const fullWaterRing = makeWorld([
    makeTile(0, 0, 'water', 'water'),
    ...AXIAL_DIRECTIONS.map((d, i) =>
      makeTile(d.q, d.r, 'water', i === 0 ? 'water-island' : i === 1 ? 'water-rocks' : 'water')
    ),
  ]);
  const w6 = computeWaterFishingCapacity(fullWaterRing, 0, 0, HEX_ASSETS);
  assert.equal(w6.waterNeighbors, 6);
  assert.equal(
    w6.totalCapacity,
    DEFAULT_ADJACENCY_CONFIG.water.fishingBaseCapacity +
      DEFAULT_ADJACENCY_CONFIG.water.fishingMaxNeighborBonus
  );
  assert.equal(w6.capReached, true);

  // Configurable cap override via central scaling helper
  const neighbors = getHexNeighbors(fullForestRing, 0, 0, HEX_ASSETS);
  const customScaled = computeAdjacencyScaledEffect(
    neighbors,
    (n) => n.exists && n.terrainType === 'forest',
    { baseValue: 5, perNeighborBonus: 3, maxBonus: 6 }
  );
  assert.equal(customScaled.matchingNeighborCount, 6);
  assert.equal(customScaled.rawBonus, 18);
  assert.equal(customScaled.cappedBonus, 6);
  assert.equal(customScaled.totalValue, 11);
  assert.equal(customScaled.capReached, true);
});

test('two Forests contribute to one Village hunting pool (both adjacent and clustered)', () => {
  // Single forest next to village
  const oneForestWorld = makeWorld([
    makeTile(0, 0, 'plains', 'building-village'),
    makeTile(1, 0, 'forest'),
  ]);
  const oneSummary = evaluateWorldAdjacencyPools({
    worldState: oneForestWorld,
    assets: HEX_ASSETS,
  });
  const vOne = oneSummary.villagesByKey['0,0']?.hunting;
  assert.ok(vOne);
  assert.equal(vOne.availableCapacity, 4);
  assert.equal(vOne.allocated, 4);

  // Two forests adjacent to the same village
  const twoForestWorld = makeWorld([
    makeTile(0, 0, 'plains', 'building-village'),
    makeTile(1, 0, 'forest'),
    makeTile(0, 1, 'forest'),
  ]);
  const twoSummary = evaluateWorldAdjacencyPools({
    worldState: twoForestWorld,
    assets: HEX_ASSETS,
  });
  const vTwo = twoSummary.villagesByKey['0,0']?.hunting;
  assert.ok(vTwo);
  assert.equal(vTwo.providerKeys.length, 2);
  assert.ok(vTwo.availableCapacity > vOne.availableCapacity);
  assert.ok(vTwo.allocated > vOne.allocated);
  assert.equal(vTwo.allocated, 10); // Village base demand 10 fully satisfied by 6 + 6 = 12

  // Non-touching forests on opposite sides of the village also combine
  const oppositeForestWorld = makeWorld([
    makeTile(0, 0, 'plains', 'building-village'),
    makeTile(1, 0, 'forest'),
    makeTile(-1, 0, 'forest'),
  ]);
  const oppSummary = evaluateWorldAdjacencyPools({
    worldState: oppositeForestWorld,
    assets: HEX_ASSETS,
  });
  const vOpp = oppSummary.villagesByKey['0,0']?.hunting;
  assert.ok(vOpp);
  assert.equal(vOpp.availableCapacity, 8);
  assert.equal(vOpp.allocated, 8);
});

test('two Villages contesting the same Forest share finite pool proportionally to population/demand', () => {
  // Equal population Villages (10 vs 10) sharing a single Forest (capacity 4)
  const equalWorld = makeWorld([
    makeTile(1, 0, 'forest'),
    makeTile(0, 0, 'plains', 'building-village'),
    makeTile(2, 0, 'plains', 'building-village'),
  ]);
  const equalSummary = evaluateWorldAdjacencyPools({
    worldState: equalWorld,
    assets: HEX_ASSETS,
  });
  const v1Eq = equalSummary.villagesByKey['0,0']?.hunting;
  const v2Eq = equalSummary.villagesByKey['2,0']?.hunting;
  assert.ok(v1Eq && v2Eq);
  assert.equal(v1Eq.allocated, 2);
  assert.equal(v2Eq.allocated, 2);
  assert.equal(equalSummary.hunting.totalAllocated, 4);
  assert.deepEqual(v1Eq.sharedWithConsumerKeys, ['2,0']);

  // Unequal populations (10 vs 20) sharing a Forest (capacity 4 -> 1.3333 vs 2.6667, ratio 1:2)
  const unequalSummary = evaluateWorldAdjacencyPools({
    worldState: equalWorld,
    assets: HEX_ASSETS,
    villagePopulationsByKey: {
      '0,0': 10,
      '2,0': 20,
    },
  });
  const v1Un = unequalSummary.villagesByKey['0,0']?.hunting;
  const v2Un = unequalSummary.villagesByKey['2,0']?.hunting;
  assert.ok(v1Un && v2Un);
  assert.ok(v2Un.allocated > v1Un.allocated);
  assert.ok(Math.abs(v2Un.allocated / v1Un.allocated - 2) < 1e-3);
  assert.ok(Math.abs(v1Un.allocated + v2Un.allocated - 4) < 1e-3);

  // Configurable equal_split mode ignores demand imbalance and splits evenly
  const equalSplitSummary = evaluateWorldAdjacencyPools({
    worldState: equalWorld,
    assets: HEX_ASSETS,
    villagePopulationsByKey: {
      '0,0': 10,
      '2,0': 20,
    },
    configOverrides: { sharingMode: 'equal_split' },
  });
  assert.equal(equalSplitSummary.villagesByKey['0,0']?.hunting?.allocated, 2);
  assert.equal(equalSplitSummary.villagesByKey['2,0']?.hunting?.allocated, 2);
});

test('two Villages also share Water fishing and Plains pasture pools without creating infinite capacity', () => {
  const sharedWorld = makeWorld([
    makeTile(1, 0, 'water', 'water'),
    makeTile(1, -1, 'plains', 'grass-hill'),
    makeTile(0, 0, 'plains', 'building-village'),
    makeTile(2, -1, 'plains', 'building-village'),
  ]);
  // Note: (0,0) touches (1,0) water and (1,-1) plains? Check axial distances:
  // (0,0) to (1,0) = 1; (0,0) to (1,-1) = 1; (2,-1) to (1,0) = 1; (2,-1) to (1,-1) = 1!
  const summary = evaluateWorldAdjacencyPools({
    worldState: sharedWorld,
    assets: HEX_ASSETS,
    villagePopulationsByKey: {
      '0,0': 10,
      '2,-1': 30,
    },
  });

  const v1Fish = summary.villagesByKey['0,0']?.fishing!;
  const v2Fish = summary.villagesByKey['2,-1']?.fishing!;
  assert.equal(summary.fishing.totalCapacity, 4);
  assert.equal(v1Fish.allocated, 1);
  assert.equal(v2Fish.allocated, 3);

  const v1Pasture = summary.villagesByKey['0,0']?.pasture!;
  const v2Pasture = summary.villagesByKey['2,-1']?.pasture!;
  assert.equal(summary.pasture.totalCapacity, 3);
  assert.ok(Math.abs(v1Pasture.allocated - 0.75) < 1e-4);
  assert.ok(Math.abs(v2Pasture.allocated - 2.25) < 1e-4);
  assert.ok(Math.abs(v1Pasture.allocated + v2Pasture.allocated - 3) < 1e-4);
});

test('forest wood depletion transitions logical/visual state to dirt-lumber and drops hunting capacity', () => {
  let world = makeWorld([
    makeTile(0, 0, 'plains', 'building-village'),
    makeTile(1, 0, 'forest', 'grass-forest', 'player', { woodStock: 30 }),
    makeTile(0, 1, 'forest', 'grass-forest', 'player', { woodStock: 50 }),
  ]);

  const beforeSummary = evaluateWorldAdjacencyPools({
    worldState: world,
    assets: HEX_ASSETS,
  });
  assert.equal(beforeSummary.forestsByKey['1,0'].woodStock, 30);
  assert.equal(beforeSummary.forestsByKey['1,0'].isDepleted, false);
  assert.equal(beforeSummary.forestsByKey['1,0'].huntingCapacity, 6);
  assert.equal(beforeSummary.forestsByKey['0,1'].huntingCapacity, 6);
  assert.equal(beforeSummary.villagesByKey['0,0'].hunting?.allocated, 10);

  // Partial wood consumption does not deplete yet
  const step1 = consumeForestWood(world, 1, 0, 20, HEX_ASSETS);
  world = step1.nextState;
  assert.equal(step1.consumed, 20);
  assert.equal(step1.remainingStock, 10);
  assert.equal(step1.isDepleted, false);
  assert.equal(step1.transitionedToAsset, null);
  assert.equal(
    HEX_ASSETS[world.hexes['1,0'].structureIndex].name,
    'grass-forest'
  );

  // Consuming remaining wood reaches threshold -> transitions to dirt-lumber
  const step2 = consumeForestWood(world, 1, 0, 25, HEX_ASSETS);
  world = step2.nextState;
  assert.equal(step2.consumed, 10);
  assert.equal(step2.remainingStock, 0);
  assert.equal(step2.depletedNow, true);
  assert.equal(step2.isDepleted, true);
  assert.equal(step2.transitionedToAsset, 'dirt-lumber');

  const depletedTile = world.hexes['1,0'];
  assert.equal(HEX_ASSETS[depletedTile.structureIndex].name, 'dirt-lumber');
  assert.equal(depletedTile.terrainType, 'forest');
  assert.equal(depletedTile.forestDepleted, true);
  assert.equal(depletedTile.woodStock, 0);
  assert.equal(hasHexConstruction(depletedTile, HEX_ASSETS), false);

  // Depleted forest stops providing hunting and stops giving active-forest neighbor bonus to (0,1)
  const afterSummary = evaluateWorldAdjacencyPools({
    worldState: world,
    assets: HEX_ASSETS,
  });
  assert.equal(afterSummary.forestsByKey['1,0'].isDepleted, true);
  assert.equal(afterSummary.forestsByKey['1,0'].huntingCapacity, 0);
  assert.equal(afterSummary.forestsByKey['0,1'].huntingCapacity, 4);
  assert.equal(afterSummary.villagesByKey['0,0'].hunting?.allocated, 4);

  // Depleted forest is excluded from wood resource summary and persists across serialization
  assert.equal(calculatePlayerResources(world).wood, 10); // only (0,1) counts
  const serialized = serializeWorldState(world);
  const restored = deserializeWorldState(serialized, HEX_ASSETS.length);
  assert.ok(restored);
  assert.equal(restored.hexes['1,0'].forestDepleted, true);
  assert.equal(restored.hexes['1,0'].woodStock, 0);
  assert.equal(
    HEX_ASSETS[restored.hexes['1,0'].structureIndex].name,
    'dirt-lumber'
  );
  assert.equal(hasHexConstruction(restored.hexes['1,0'], HEX_ASSETS), false);

  // Building & demolishing on depleted forest restores dirt-lumber rather than grass-forest
  const built = placeHexInState(
    restored,
    1,
    0,
    idxOf('building-house'),
    DEFAULT_ROTATION_DEG,
    HEX_ASSETS
  );
  assert.equal(built.changed, true);
  const kingdom = makeSandboxKingdom(Object.values(built.nextState.hexes));
  const econ = getKingdomEconomy(kingdom, HEX_ASSETS);
  assert.equal(econ.adjacencyPools.forestsByKey['1,0'].isDepleted, true);
});

test('fertile + water generates irrigation with neighborhood cap', () => {
  const dryWorld = makeWorld([makeTile(0, 0, 'fertile', 'dirt')]);
  const dryIrr = computeFertileIrrigation(dryWorld, 0, 0, HEX_ASSETS);
  assert.equal(dryIrr.isFertile, true);
  assert.equal(dryIrr.isIrrigated, false);
  assert.equal(dryIrr.irrigationCapacity, 0);

  const twoWaterWorld = makeWorld([
    makeTile(0, 0, 'fertile', 'dirt'),
    makeTile(1, 0, 'water', 'water'),
    makeTile(0, 1, 'water', 'water-rocks'),
  ]);
  const irr2 = computeFertileIrrigation(twoWaterWorld, 0, 0, HEX_ASSETS);
  assert.equal(irr2.isIrrigated, true);
  assert.equal(irr2.waterNeighborCount, 2);
  assert.equal(
    irr2.irrigationCapacity,
    2 * DEFAULT_ADJACENCY_CONFIG.water.irrigationPerWaterNeighbor
  );
  assert.equal(irr2.capReached, false);

  // Full 6 water neighbors hits configurable cap (9 instead of 18)
  const sixWaterWorld = makeWorld([
    makeTile(0, 0, 'fertile', 'dirt'),
    ...AXIAL_DIRECTIONS.map((d) => makeTile(d.q, d.r, 'water', 'water-island')),
  ]);
  const irr6 = computeFertileIrrigation(sixWaterWorld, 0, 0, HEX_ASSETS);
  assert.equal(irr6.waterNeighborCount, 6);
  assert.equal(
    irr6.irrigationCapacity,
    DEFAULT_ADJACENCY_CONFIG.water.irrigationMaxPerFertileHex
  );
  assert.equal(irr6.capReached, true);

  // Non-fertile tile next to water receives 0 irrigation
  const plainsWorld = makeWorld([
    makeTile(0, 0, 'plains', 'grass'),
    makeTile(1, 0, 'water', 'water'),
  ]);
  const plainsIrr = computeFertileIrrigation(plainsWorld, 0, 0, HEX_ASSETS);
  assert.equal(plainsIrr.isFertile, false);
  assert.equal(plainsIrr.irrigationCapacity, 0);
});

test('plains + plains increases pasture pool capacity across grass and grass-hill variants', () => {
  const singlePlains = makeWorld([makeTile(0, 0, 'plains', 'grass')]);
  const pSingle = computePlainsPastureCapacity(singlePlains, 0, 0, HEX_ASSETS);
  assert.equal(pSingle.totalCapacity, DEFAULT_ADJACENCY_CONFIG.plains.pastureBaseCapacity);

  const pairPlains = makeWorld([
    makeTile(0, 0, 'plains', 'grass'),
    makeTile(1, 0, 'plains', 'grass-hill'),
  ]);
  const pPair = computePlainsPastureCapacity(pairPlains, 0, 0, HEX_ASSETS);
  assert.equal(pPair.plainsNeighbors, 1);
  assert.ok(pPair.totalCapacity > pSingle.totalCapacity);
  assert.equal(
    pPair.totalCapacity,
    DEFAULT_ADJACENCY_CONFIG.plains.pastureBaseCapacity +
      DEFAULT_ADJACENCY_CONFIG.plains.pasturePerNeighborBonus
  );

  // 6 adjacent plains hits cap
  const fullPlains = makeWorld([
    makeTile(0, 0, 'plains', 'grass'),
    ...AXIAL_DIRECTIONS.map((d, i) =>
      makeTile(d.q, d.r, 'plains', i % 2 === 0 ? 'grass' : 'grass-hill')
    ),
  ]);
  const p6 = computePlainsPastureCapacity(fullPlains, 0, 0, HEX_ASSETS);
  assert.equal(p6.plainsNeighbors, 6);
  assert.equal(
    p6.totalCapacity,
    DEFAULT_ADJACENCY_CONFIG.plains.pastureBaseCapacity +
      DEFAULT_ADJACENCY_CONFIG.plains.pastureMaxNeighborBonus
  );
  assert.equal(p6.capReached, true);
});

test('village supplies workers to adjacent structures with proportional sharing and dock readiness', () => {
  const world = makeWorld([
    makeTile(0, 0, 'plains', 'building-village'),
    makeTile(1, 0, 'fertile', 'building-farm'), // needs 2
    makeTile(0, 1, 'mountain', 'building-mine'), // needs 2
    makeTile(-1, 0, 'water', 'building-dock'), // needs 1, also taps water fishing pool
    makeTile(-1, 1, 'water', 'water'),
  ]);

  // With ample village supply (pop 10), all adjacent structures receive 100% of their demand
  const fullPool = evaluateWorldAdjacencyPools({
    worldState: world,
    assets: HEX_ASSETS,
  });
  assert.equal(fullPool.workers.consumersByKey['1,0'].allocated, 2);
  assert.equal(fullPool.workers.consumersByKey['0,1'].allocated, 2);
  assert.equal(fullPool.workers.consumersByKey['-1,0'].allocated, 1);
  assert.equal(fullPool.villagesByKey['0,0'].workersSuppliedTotal, 5);

  // Dock & Village both share (-1,0) water pool cleanly
  assert.ok(fullPool.fishing.consumersByKey['-1,0']);
  assert.ok(fullPool.fishing.consumersByKey['0,0']);

  // With constrained village supply (pop 2.5 -> 2.5 workers for 5 demand -> 50% each)
  const scarcePool = evaluateWorldAdjacencyPools({
    worldState: world,
    assets: HEX_ASSETS,
    villagePopulationsByKey: { '0,0': 2.5 },
  });
  assert.equal(scarcePool.workers.consumersByKey['1,0'].allocated, 1);
  assert.equal(scarcePool.workers.consumersByKey['0,1'].allocated, 1);
  assert.equal(scarcePool.workers.consumersByKey['-1,0'].allocated, 0.5);
  assert.equal(scarcePool.workers.totalAllocated, 2.5);
});

test('integration: world-generator, starter world, economy-engine, and turn-engine preserve forest stock & adjacency pools', () => {
  const starter = createStarterWorldState(HEX_ASSETS);
  const starterForest = Object.values(starter.hexes).find(
    (h) => h.terrainType === 'forest' && !hasHexConstruction(h, HEX_ASSETS)
  );
  assert.ok(starterForest);
  assert.equal(getForestWoodStock(starterForest), DEFAULT_FOREST_WOOD_STOCK);

  const proc = generateProceduralKingdomWorld(HEX_ASSETS, 42026);
  const procForest = Object.values(proc.worldState.hexes).find(
    (h) => h.terrainType === 'forest'
  );
  assert.ok(procForest);
  assert.equal(getForestWoodStock(procForest), DEFAULT_FOREST_WOOD_STOCK);

  let kingdom = makeSandboxKingdom([
    makeTile(0, 0, 'plains', 'building-castle'),
    makeTile(1, 0, 'plains', 'building-village'),
    makeTile(1, 1, 'forest', 'grass-forest', 'player', { woodStock: 0 }),
    makeTile(0, 1, 'fertile', 'dirt'),
    makeTile(-1, 1, 'water', 'water'),
  ]);

  // Turn step syncs depleted woodStock=0 forest to dirt-lumber automatically
  const turnRes = advanceKingdomTurn(kingdom, HEX_ASSETS);
  kingdom = turnRes.nextState;
  const depletedHex = kingdom.worldState.hexes['1,1'];
  assert.equal(depletedHex.forestDepleted, true);
  assert.equal(HEX_ASSETS[depletedHex.structureIndex].name, 'dirt-lumber');

  const econ = getKingdomEconomy(kingdom, HEX_ASSETS);
  assert.equal(econ.adjacencyPools.forestsByKey['1,1'].isDepleted, true);
  assert.equal(econ.adjacencyPools.forestsByKey['1,1'].huntingCapacity, 0);
  assert.equal(econ.adjacencyPools.irrigationByKey['0,1'].isIrrigated, true);
  assert.ok(econ.adjacencyPools.irrigationByKey['0,1'].irrigationCapacity > 0);
  assert.equal(econ.buildingsByKey['1,1'], undefined); // not miscounted as Serraria!

  // Save/load v10 preserves forestDepleted & woodStock
  const saved = serializeKingdomState(kingdom);
  const loaded = deserializeKingdomState(saved, HEX_ASSETS.length);
  assert.ok(loaded);
  assert.equal(loaded.worldState.hexes['1,1'].forestDepleted, true);
  assert.equal(loaded.worldState.hexes['1,1'].woodStock, 0);
});
