import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_ROTATION_DEG,
  HEX_FLAT_TO_FLAT,
  INITIAL_CASH,
  axialToWorld,
  createEmptyWorldState,
  createStarterWorldState,
  cycleStructureIndex,
  demolishHexInState,
  deserializeWorldState,
  hasHexConstruction,
  hexKey,
  placeHexInState,
  rotateHexStep,
  serializeWorldState,
  worldToAxial,
} from './hex-engine';
import { HEX_ASSETS } from './repo-data';

test('axialToWorld and worldToAxial round-trip accurately across hex grid', () => {
  const coords = [
    { q: 0, r: 0 },
    { q: 1, r: 0 },
    { q: -2, r: 3 },
    { q: 4, r: -2 },
    { q: -3, r: -1 },
  ];
  for (const { q, r } of coords) {
    const world = axialToWorld(q, r);
    const back = worldToAxial(world.x, world.z);
    assert.deepEqual(back, { q, r });
  }
});

test('adjacent hex centers are exactly HEX_FLAT_TO_FLAT units apart for zero-gap tessellation', () => {
  const origin = axialToWorld(0, 0);
  const neighbors = [
    axialToWorld(1, 0),
    axialToWorld(0, 1),
    axialToWorld(-1, 1),
    axialToWorld(-1, 0),
    axialToWorld(0, -1),
    axialToWorld(1, -1),
  ];
  for (const n of neighbors) {
    const dist = Math.hypot(n.x - origin.x, n.z - origin.z);
    assert.ok(
      Math.abs(dist - HEX_FLAT_TO_FLAT) < 1e-9,
      `Expected dist ${HEX_FLAT_TO_FLAT}, got ${dist}`
    );
  }
});

test('rotateHexStep and cycleStructureIndex wrap cleanly', () => {
  assert.equal(rotateHexStep(90, 1), 150);
  assert.equal(rotateHexStep(330, 1), 30);
  assert.equal(rotateHexStep(30, -1), 330);

  assert.equal(cycleStructureIndex(0, -1, 72), 71);
  assert.equal(cycleStructureIndex(71, 1, 72), 0);
  assert.equal(cycleStructureIndex(10, 5, 72), 15);
});

test('placeHexInState enforces ownership, blocks building over existing constructions, and demolishHexInState restores terrain without refund', () => {
  const bridgeIdx = HEX_ASSETS.findIndex((a) => a.name === 'bridge');
  const houseIdx = HEX_ASSETS.findIndex((a) => a.name === 'building-house');
  const forestIdx = HEX_ASSETS.findIndex((a) => a.name === 'grass-forest');
  assert.ok(bridgeIdx >= 0 && houseIdx >= 0 && forestIdx >= 0);
  assert.equal(HEX_ASSETS[bridgeIdx].price, 100);

  let state = createEmptyWorldState();
  // Unowned coordinate cannot be built upon directly
  const blocked = placeHexInState(state, 2, -1, bridgeIdx, DEFAULT_ROTATION_DEG, HEX_ASSETS);
  assert.equal(blocked.changed, false);
  assert.equal(blocked.spent, 0);
  assert.equal(blocked.blockedReason, 'not_owned');
  assert.equal(blocked.nextState.cash, INITIAL_CASH);

  // Give player ownership of (2, -1) with free forest terrain
  state = {
    ...state,
    hexes: {
      [hexKey(2, -1)]: {
        q: 2,
        r: -1,
        orientation: DEFAULT_ROTATION_DEG,
        structureIndex: forestIdx,
        owner: 'player',
        terrainType: 'forest',
        resourceType: 'wood',
        resourceAmount: 10,
      },
    },
  };
  assert.equal(hasHexConstruction(state.hexes[hexKey(2, -1)], HEX_ASSETS), false);

  const placed = placeHexInState(state, 2, -1, bridgeIdx, DEFAULT_ROTATION_DEG, HEX_ASSETS);
  assert.equal(placed.changed, true);
  assert.equal(placed.spent, 100);
  assert.equal(placed.nextState.cash, INITIAL_CASH - 100);
  state = placed.nextState;
  assert.equal(hasHexConstruction(state.hexes[hexKey(2, -1)], HEX_ASSETS), true);

  // Attempting to build another construction on the already-occupied hex is blocked with $0 spent
  const overwriteBlocked = placeHexInState(state, 2, -1, houseIdx, 150, HEX_ASSETS);
  assert.equal(overwriteBlocked.changed, false);
  assert.equal(overwriteBlocked.spent, 0);
  assert.equal(overwriteBlocked.blockedReason, 'already_occupied');
  assert.equal(overwriteBlocked.nextState.cash, INITIAL_CASH - 100);
  assert.equal(overwriteBlocked.nextState.hexes[hexKey(2, -1)].structureIndex, bridgeIdx);

  // Demolishing removes only the construction, keeps player ownership, terrain, resource, and cash (no refund)
  const demolished = demolishHexInState(state, 2, -1, HEX_ASSETS);
  assert.equal(demolished.removed, true);
  const restoredTile = demolished.nextState.hexes[hexKey(2, -1)];
  assert.ok(restoredTile !== undefined);
  assert.equal(hasHexConstruction(restoredTile, HEX_ASSETS), false);
  assert.equal(restoredTile.structureIndex, forestIdx);
  assert.equal(restoredTile.owner, 'player');
  assert.equal(restoredTile.terrainType, 'forest');
  assert.equal(restoredTile.resourceType, 'wood');
  assert.equal(restoredTile.resourceAmount, 10);
  assert.equal(demolished.nextState.cash, INITIAL_CASH - 100);

  // Demolishing an already free terrain returns removed: false
  const demolishEmpty = demolishHexInState(demolished.nextState, 2, -1, HEX_ASSETS);
  assert.equal(demolishEmpty.removed, false);
  assert.equal(demolishEmpty.blockedReason, 'no_building');

  // After demolishing, the hex is free and can receive a new construction
  const rebuilt = placeHexInState(
    demolished.nextState,
    2,
    -1,
    houseIdx,
    DEFAULT_ROTATION_DEG,
    HEX_ASSETS
  );
  assert.equal(rebuilt.changed, true);
  assert.equal(rebuilt.nextState.hexes[hexKey(2, -1)].structureIndex, houseIdx);
});

test('starter world and serialization round-trip preserve all tiles, cash, rareFeature, and faction owners', () => {
  const starter = createStarterWorldState(HEX_ASSETS);
  const count = Object.keys(starter.hexes).length;
  assert.ok(count >= 25, `Expected >= 25 starter hexes, got ${count}`);

  // Simulate a future faction owner & rareFeature on one tile to verify round-trip readiness
  starter.seed = 777123;
  starter.worldCols = 32;
  starter.worldRows = 32;
  starter.hexes[hexKey(3, -1)] = {
    ...starter.hexes[hexKey(3, -1)],
    owner: 'faction_rival',
    rareFeature: 'gold_vein',
  };

  const json = serializeWorldState(starter);
  const loaded = deserializeWorldState(json, HEX_ASSETS.length);
  assert.ok(loaded !== null);
  assert.equal(loaded.cash, starter.cash);
  assert.equal(loaded.seed, 777123);
  assert.equal(loaded.worldCols, 32);
  assert.equal(loaded.worldRows, 32);
  assert.equal(Object.keys(loaded.hexes).length, count);
  assert.equal(loaded.hexes[hexKey(3, -1)].owner, 'faction_rival');
  assert.equal(loaded.hexes[hexKey(3, -1)].rareFeature, 'gold_vein');
  assert.equal(deserializeWorldState('not-json', HEX_ASSETS.length), null);
});
