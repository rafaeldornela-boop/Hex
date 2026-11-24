import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_ROTATION_DEG,
  INITIAL_CASH,
  axialToWorld,
  createEmptyWorldState,
  createStarterWorldState,
  cycleStructureIndex,
  demolishHexInState,
  deserializeWorldState,
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

test('adjacent hex centers are exactly 1.0 unit apart for zero-gap tessellation', () => {
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
    assert.ok(Math.abs(dist - 1.0) < 1e-9, `Expected dist 1.0, got ${dist}`);
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

test('placeHexInState enforces ownership, charges price once per structure change, and demolishHexInState removes tile', () => {
  const bridgeIdx = HEX_ASSETS.findIndex((a) => a.name === 'bridge');
  assert.ok(bridgeIdx >= 0);
  assert.equal(HEX_ASSETS[bridgeIdx].price, 100);

  let state = createEmptyWorldState();
  // Unowned coordinate cannot be built upon directly
  const blocked = placeHexInState(state, 2, -1, bridgeIdx, DEFAULT_ROTATION_DEG, HEX_ASSETS);
  assert.equal(blocked.changed, false);
  assert.equal(blocked.spent, 0);
  assert.equal(blocked.blockedReason, 'not_owned');
  assert.equal(blocked.nextState.cash, INITIAL_CASH);

  // Give player ownership of (2, -1) with a grass/building tile different from bridge
  const otherIdx = HEX_ASSETS.findIndex((a) => a.name === 'grass');
  assert.ok(otherIdx >= 0 && otherIdx !== bridgeIdx);
  state = {
    ...state,
    hexes: {
      [hexKey(2, -1)]: {
        q: 2,
        r: -1,
        orientation: DEFAULT_ROTATION_DEG,
        structureIndex: otherIdx,
        owner: 'player',
      },
    },
  };

  const placed = placeHexInState(state, 2, -1, bridgeIdx, DEFAULT_ROTATION_DEG, HEX_ASSETS);
  assert.equal(placed.changed, true);
  assert.equal(placed.spent, 100);
  assert.equal(placed.nextState.cash, INITIAL_CASH - 100);
  state = placed.nextState;

  // Rotating same structure on same hex should not double-charge
  const rotated = placeHexInState(state, 2, -1, bridgeIdx, 150, HEX_ASSETS);
  assert.equal(rotated.changed, true);
  assert.equal(rotated.spent, 0);
  assert.equal(rotated.nextState.cash, INITIAL_CASH - 100);
  state = rotated.nextState;

  // Demolish removes the tile
  const demolished = demolishHexInState(state, 2, -1);
  assert.equal(demolished.removed, true);
  assert.equal(demolished.nextState.hexes[hexKey(2, -1)], undefined);
});

test('starter world and serialization round-trip preserve all tiles, cash, and faction owners', () => {
  const starter = createStarterWorldState(HEX_ASSETS);
  const count = Object.keys(starter.hexes).length;
  assert.ok(count >= 25, `Expected >= 25 starter hexes, got ${count}`);

  // Simulate a future faction owner on one tile to verify round-trip readiness
  starter.hexes[hexKey(3, -1)] = {
    ...starter.hexes[hexKey(3, -1)],
    owner: 'faction_rival',
  };

  const json = serializeWorldState(starter);
  const loaded = deserializeWorldState(json, HEX_ASSETS.length);
  assert.ok(loaded !== null);
  assert.equal(loaded.cash, starter.cash);
  assert.equal(Object.keys(loaded.hexes).length, count);
  assert.equal(loaded.hexes[hexKey(3, -1)].owner, 'faction_rival');
  assert.equal(deserializeWorldState('not-json', HEX_ASSETS.length), null);
});
