import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_ROTATION_DEG,
  createEmptyWorldState,
  createStarterWorldState,
  deserializeWorldState,
  hexKey,
  placeHexInState,
  serializeWorldState,
} from './hex-engine';
import { HEX_ASSETS } from './repo-data';
import {
  calculatePlayerResources,
  canBuildStructureOnTerrain,
  getHexTerrainAndResource,
  getResourceForTerrain,
  getTerrainForHex,
  type TerrainType,
} from './terrain-engine';
import { conquerHexInState } from './territory-engine';

test('getTerrainForHex is deterministic per axial (q, r) and covers all 5 terrain types', () => {
  const seen = new Set<TerrainType>();
  for (let q = -8; q <= 8; q++) {
    for (let r = -8; r <= 8; r++) {
      const t1 = getTerrainForHex(q, r);
      const t2 = getTerrainForHex(q, r);
      assert.equal(t1, t2, `Terrain at (${q},${r}) must be deterministic`);
      seen.add(t1);
    }
  }
  assert.deepEqual(
    Array.from(seen).sort(),
    ['fertile', 'forest', 'mountain', 'plains', 'water']
  );
});

test('getResourceForTerrain maps every terrain to its expected basic resource', () => {
  assert.deepEqual(getResourceForTerrain('plains'), {
    resourceType: 'none',
    resourceAmount: 0,
  });
  assert.deepEqual(getResourceForTerrain('forest'), {
    resourceType: 'wood',
    resourceAmount: 10,
  });
  assert.deepEqual(getResourceForTerrain('mountain'), {
    resourceType: 'ore',
    resourceAmount: 10,
  });
  assert.deepEqual(getResourceForTerrain('fertile'), {
    resourceType: 'food',
    resourceAmount: 10,
  });
  assert.deepEqual(getResourceForTerrain('water'), {
    resourceType: 'water',
    resourceAmount: 10,
  });
});

test('only player-owned territories contribute resources and conquest adds hex resources', () => {
  const starter = createStarterWorldState(HEX_ASSETS);
  const initialRes = calculatePlayerResources(starter);

  // Starter core has two fertile tiles ((-1,1) and (1,-1)) and 5 plains tiles.
  // Neutral forests, mountains, and water must NOT be counted yet.
  assert.equal(initialRes.food, 20);
  assert.equal(initialRes.wood, 0);
  assert.equal(initialRes.ore, 0);
  assert.equal(initialRes.water, 0);

  // Conquer adjacent Forest (1, 1) -> wood +10
  const afterForest = conquerHexInState(starter, 1, 1, HEX_ASSETS);
  assert.equal(afterForest.conquered, true);
  assert.equal(afterForest.nextState.hexes[hexKey(1, 1)].terrainType, 'forest');
  assert.equal(afterForest.nextState.hexes[hexKey(1, 1)].resourceType, 'wood');
  const resAfterForest = calculatePlayerResources(afterForest.nextState);
  assert.equal(resAfterForest.wood, 10);
  assert.equal(resAfterForest.ore, 0);

  // Conquer adjacent Mountain (0, 2) -> ore +10
  const afterMountain = conquerHexInState(afterForest.nextState, 0, 2, HEX_ASSETS);
  assert.equal(afterMountain.conquered, true);
  const resAfterMountain = calculatePlayerResources(afterMountain.nextState);
  assert.equal(resAfterMountain.wood, 10);
  assert.equal(resAfterMountain.ore, 10);

  // Conquer adjacent Water (0, -2) (adjacent to (0,-1)) -> water +10
  const afterWater = conquerHexInState(afterMountain.nextState, 0, -2, HEX_ASSETS);
  assert.equal(afterWater.conquered, true);
  const resAfterWater = calculatePlayerResources(afterWater.nextState);
  assert.equal(resAfterWater.water, 10);
});

test('building terrain restrictions block incompatible placements and preserve terrain metadata', () => {
  const farmIdx = HEX_ASSETS.findIndex((a) => a.name === 'building-farm');
  const mineIdx = HEX_ASSETS.findIndex((a) => a.name === 'building-mine');
  const lumberIdx = HEX_ASSETS.findIndex((a) => a.name === 'dirt-lumber');
  const houseIdx = HEX_ASSETS.findIndex((a) => a.name === 'building-house');
  assert.ok(farmIdx >= 0 && mineIdx >= 0 && lumberIdx >= 0 && houseIdx >= 0);

  // Pure function checks
  assert.equal(canBuildStructureOnTerrain('building-farm', 'fertile'), true);
  assert.equal(canBuildStructureOnTerrain('building-farm', 'forest'), false);
  assert.equal(canBuildStructureOnTerrain('building-farm', 'mountain'), false);

  assert.equal(canBuildStructureOnTerrain('building-mine', 'mountain'), true);
  assert.equal(canBuildStructureOnTerrain('building-mine', 'plains'), false);
  assert.equal(canBuildStructureOnTerrain('building-mine', 'fertile'), false);

  assert.equal(canBuildStructureOnTerrain('dirt-lumber', 'forest'), true);
  assert.equal(canBuildStructureOnTerrain('dirt-lumber', 'plains'), false);
  assert.equal(canBuildStructureOnTerrain('dirt-lumber', 'water'), false);

  assert.equal(canBuildStructureOnTerrain('building-house', 'plains'), true);
  assert.equal(canBuildStructureOnTerrain('building-house', 'forest'), true);

  // State enforcement: starter (0,2) is mountain, (1,1) is forest, (2,-2) is fertile
  let state = createStarterWorldState(HEX_ASSETS);

  // Try building Farm on Forest (1,1) -> must block
  const farmOnForest = placeHexInState(state, 1, 1, farmIdx, DEFAULT_ROTATION_DEG, HEX_ASSETS);
  assert.equal(farmOnForest.changed, false);
  assert.equal(farmOnForest.blockedReason, 'incompatible_terrain');

  // Try building Mine on Fertile (2,-2) -> must block
  const mineOnFertile = placeHexInState(state, 2, -2, mineIdx, DEFAULT_ROTATION_DEG, HEX_ASSETS);
  assert.equal(mineOnFertile.changed, false);
  assert.equal(mineOnFertile.blockedReason, 'incompatible_terrain');

  // Try building Lumber (Serraria) on Mountain (0,2) -> must block
  const lumberOnMountain = placeHexInState(state, 0, 2, lumberIdx, DEFAULT_ROTATION_DEG, HEX_ASSETS);
  assert.equal(lumberOnMountain.changed, false);
  assert.equal(lumberOnMountain.blockedReason, 'incompatible_terrain');

  // Valid placements succeed and preserve underlying terrain/resource/owner
  state = conquerHexInState(state, 0, 2, HEX_ASSETS).nextState;
  const mineOnMountain = placeHexInState(state, 0, 2, mineIdx, DEFAULT_ROTATION_DEG, HEX_ASSETS);
  assert.equal(mineOnMountain.changed, true);
  assert.equal(mineOnMountain.blockedReason, undefined);
  assert.equal(mineOnMountain.nextState.hexes[hexKey(0, 2)].terrainType, 'mountain');
  assert.equal(mineOnMountain.nextState.hexes[hexKey(0, 2)].resourceType, 'ore');
  assert.equal(mineOnMountain.nextState.hexes[hexKey(0, 2)].owner, 'player');

  const farmOnFertile = placeHexInState(
    mineOnMountain.nextState,
    2,
    -2,
    farmIdx,
    DEFAULT_ROTATION_DEG,
    HEX_ASSETS
  );
  assert.equal(farmOnFertile.changed, true);
  assert.equal(farmOnFertile.nextState.hexes[hexKey(2, -2)].terrainType, 'fertile');

  const lumberOnForest = placeHexInState(
    farmOnFertile.nextState,
    1,
    1,
    lumberIdx,
    DEFAULT_ROTATION_DEG,
    HEX_ASSETS
  );
  assert.equal(lumberOnForest.changed, true);
  assert.equal(lumberOnForest.nextState.hexes[hexKey(1, 1)].terrainType, 'forest');
});

test('serialization round-trip preserves terrainType, resourceType, and resourceAmount', () => {
  const starter = createStarterWorldState(HEX_ASSETS);
  const conquered = conquerHexInState(starter, 0, 2, HEX_ASSETS).nextState;
  const json = serializeWorldState(conquered);
  const restored = deserializeWorldState(json, HEX_ASSETS.length);
  assert.ok(restored !== null);

  const mountain = getHexTerrainAndResource(0, 2, restored.hexes[hexKey(0, 2)]);
  assert.equal(mountain.terrainType, 'mountain');
  assert.equal(mountain.resourceType, 'ore');
  assert.equal(mountain.resourceAmount, 10);

  const fertile = getHexTerrainAndResource(2, -2, restored.hexes[hexKey(2, -2)]);
  assert.equal(fertile.terrainType, 'fertile');
  assert.equal(fertile.resourceType, 'food');
  assert.equal(fertile.resourceAmount, 10);

  const empty = createEmptyWorldState();
  assert.equal(calculatePlayerResources(empty).wood, 0);
});
