import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INITIAL_CASH,
  axialToWorld,
  createStarterWorldState,
  deserializeWorldState,
  hexKey,
  placeHexInState,
  serializeWorldState,
} from './hex-engine';
import {
  AXIAL_DIRECTIONS,
  DEFAULT_CONQUEST_COST,
  INITIAL_PLAYER_TERRITORY_COORDS,
  NOT_OWNED_BUILD_MESSAGE,
  calculateConquestCost,
  canBuildInTerritory,
  conquerHexInState,
  countPlayerTerritory,
  evaluateConquest,
  getAxialNeighbors,
  getConquerableFrontierCoords,
  getHexOwner,
  isAdjacentToPlayerTerritory,
} from './territory-engine';
import { HEX_ASSETS } from './repo-data';

test('starter world starts with 7 player-owned hexes and remaining neutral hexes', () => {
  const starter = createStarterWorldState(HEX_ASSETS);
  assert.equal(countPlayerTerritory(starter), INITIAL_PLAYER_TERRITORY_COORDS.length);
  assert.equal(countPlayerTerritory(starter), 7);

  for (const c of INITIAL_PLAYER_TERRITORY_COORDS) {
    assert.equal(getHexOwner(starter, c.q, c.r), 'player');
  }

  // Ring-2 tiles must start neutral
  assert.equal(getHexOwner(starter, 0, 2), 'neutral');
  assert.equal(getHexOwner(starter, 2, 0), 'neutral');
  assert.equal(getHexOwner(starter, -2, 1), 'neutral');
});

test('axial neighbor directions match exact flat-topped edge angles 0..5', () => {
  const origin = axialToWorld(0, 0);
  AXIAL_DIRECTIONS.forEach((dir, edgeIdx) => {
    const neighbor = axialToWorld(dir.q, dir.r);
    const angle = Math.atan2(neighbor.z - origin.z, neighbor.x - origin.x);
    const expectedEdgeMid = (Math.PI / 3) * (edgeIdx + 0.5);
    const diff = Math.atan2(
      Math.sin(angle - expectedEdgeMid),
      Math.cos(angle - expectedEdgeMid)
    );
    assert.ok(
      Math.abs(diff) < 1e-6,
      `Direction ${edgeIdx} angle mismatch: got ${angle}, expected ${expectedEdgeMid}`
    );
  });
  assert.equal(getAxialNeighbors(0, 0).length, 6);
});

test('adjacency rules allow conquering adjacent neutral hex and block distant hexes', () => {
  const starter = createStarterWorldState(HEX_ASSETS);

  // (0, 2) is adjacent to (0, 1) which is owned by player
  assert.equal(isAdjacentToPlayerTerritory(starter, 0, 2), true);
  const adjCheck = evaluateConquest(starter, 0, 2, HEX_ASSETS);
  assert.equal(adjCheck.canConquer, true);
  assert.equal(adjCheck.cost, DEFAULT_CONQUEST_COST);

  // (0, -3) is far from the 7-hex starter core (only neighbors (0,-2) which is neutral)
  assert.equal(isAdjacentToPlayerTerritory(starter, 0, -3), false);
  const farCheck = evaluateConquest(starter, 0, -3, HEX_ASSETS);
  assert.equal(farCheck.canConquer, false);
  assert.equal(farCheck.reason, 'not_adjacent');

  // Attempting to conquer distant hex must fail without mutating cash or ownership
  const farAttempt = conquerHexInState(starter, 0, -3, HEX_ASSETS);
  assert.equal(farAttempt.conquered, false);
  assert.equal(farAttempt.reason, 'not_adjacent');
  assert.equal(farAttempt.nextState.cash, INITIAL_CASH);
  assert.equal(getHexOwner(farAttempt.nextState, 0, -3), 'neutral');
});

test('conquering deducts cash, changes ownership, updates frontier, and enables chaining expansion', () => {
  const starter = createStarterWorldState(HEX_ASSETS);
  const originalMountainIdx = starter.hexes[hexKey(0, 2)].structureIndex;

  // Before conquering (0, 2), (0, 3) is NOT adjacent
  assert.equal(isAdjacentToPlayerTerritory(starter, 0, 3), false);

  const first = conquerHexInState(starter, 0, 2, HEX_ASSETS);
  assert.equal(first.conquered, true);
  assert.equal(first.cost, DEFAULT_CONQUEST_COST);
  assert.equal(first.nextState.cash, INITIAL_CASH - DEFAULT_CONQUEST_COST);
  assert.equal(getHexOwner(first.nextState, 0, 2), 'player');
  assert.equal(countPlayerTerritory(first.nextState), 8);
  // Preserves existing structure on the conquered hex
  assert.equal(first.nextState.hexes[hexKey(0, 2)].structureIndex, originalMountainIdx);

  // Now (0, 3) IS adjacent to newly conquered (0, 2) and can be conquered next
  assert.equal(isAdjacentToPlayerTerritory(first.nextState, 0, 3), true);
  const second = conquerHexInState(first.nextState, 0, 3, HEX_ASSETS);
  assert.equal(second.conquered, true);
  assert.equal(second.nextState.cash, INITIAL_CASH - DEFAULT_CONQUEST_COST * 2);
  assert.equal(getHexOwner(second.nextState, 0, 3), 'player');
  assert.equal(countPlayerTerritory(second.nextState), 9);

  // Frontier coordinates should never include player-owned tiles
  const frontier = getConquerableFrontierCoords(second.nextState);
  assert.ok(frontier.length >= 12);
  for (const coord of frontier) {
    assert.equal(getHexOwner(second.nextState, coord.q, coord.r), 'neutral');
    assert.equal(isAdjacentToPlayerTerritory(second.nextState, coord.q, coord.r), true);
  }
});

test('cannot conquer the same hex twice', () => {
  const starter = createStarterWorldState(HEX_ASSETS);

  // Initial owned hex
  const ownedCheck = evaluateConquest(starter, 0, 0, HEX_ASSETS);
  assert.equal(ownedCheck.canConquer, false);
  assert.equal(ownedCheck.reason, 'already_owned');

  const first = conquerHexInState(starter, 0, 2, HEX_ASSETS);
  assert.equal(first.conquered, true);

  const duplicate = conquerHexInState(first.nextState, 0, 2, HEX_ASSETS);
  assert.equal(duplicate.conquered, false);
  assert.equal(duplicate.reason, 'already_owned');
  assert.equal(duplicate.nextState.cash, first.nextState.cash);
  assert.equal(countPlayerTerritory(duplicate.nextState), 8);
});

test('insufficient funds blocks conquest cleanly without modifying state', () => {
  const starter = createStarterWorldState(HEX_ASSETS);
  const cost = calculateConquestCost({ q: 0, r: 2 });
  const poorState = { ...starter, cash: cost - 1 };

  const check = evaluateConquest(poorState, 0, 2, HEX_ASSETS);
  assert.equal(check.canConquer, false);
  assert.equal(check.reason, 'insufficient_funds');

  const attempt = conquerHexInState(poorState, 0, 2, HEX_ASSETS);
  assert.equal(attempt.conquered, false);
  assert.equal(attempt.reason, 'insufficient_funds');
  assert.equal(attempt.nextState.cash, cost - 1);
  assert.equal(getHexOwner(attempt.nextState, 0, 2), 'neutral');
  assert.equal(countPlayerTerritory(attempt.nextState), 7);
});

test('building on owned hex preserves ownership and serialization round-trips owners', () => {
  const starter = createStarterWorldState(HEX_ASSETS);
  const houseIdx = HEX_ASSETS.findIndex((a) => a.name === 'building-house');
  const built = placeHexInState(starter, 0, 0, houseIdx, 90, HEX_ASSETS);
  assert.equal(built.changed, true);
  assert.equal(getHexOwner(built.nextState, 0, 0), 'player');

  const conquered = conquerHexInState(built.nextState, 0, 2, HEX_ASSETS);
  const raw = serializeWorldState(conquered.nextState);
  const restored = deserializeWorldState(raw, HEX_ASSETS.length);
  assert.ok(restored !== null);
  assert.equal(countPlayerTerritory(restored), 8);
  assert.equal(getHexOwner(restored, 0, 2), 'player');
  assert.equal(getHexOwner(restored, 2, 0), 'neutral');
});

test('building is restricted strictly to player territory and never deducts cash on neutral or rival tiles', () => {
  const starter = createStarterWorldState(HEX_ASSETS);
  const houseIdx = HEX_ASSETS.findIndex((a) => a.name === 'building-house');
  const paidIdx = HEX_ASSETS.findIndex((a) => a.price > 0);
  assert.ok(houseIdx >= 0 && paidIdx >= 0);
  const paidPrice = HEX_ASSETS[paidIdx].price;
  assert.ok(paidPrice > 0);
  assert.equal(NOT_OWNED_BUILD_MESSAGE, 'Conquiste este território antes de construir.');

  // 1. Neutral tile (2, 0) -> blocked, cash untouched even for a paid piece
  assert.equal(canBuildInTerritory(starter, 2, 0, 'player'), false);
  const neutralAttempt = placeHexInState(starter, 2, 0, paidIdx, 90, HEX_ASSETS);
  assert.equal(neutralAttempt.changed, false);
  assert.equal(neutralAttempt.spent, 0);
  assert.equal(neutralAttempt.blockedReason, 'not_owned');
  assert.equal(neutralAttempt.nextState.cash, starter.cash);

  // 2. Empty unowned coordinate (5, 5) -> blocked, cash untouched
  assert.equal(canBuildInTerritory(starter, 5, 5, 'player'), false);
  const emptyAttempt = placeHexInState(starter, 5, 5, paidIdx, 90, HEX_ASSETS);
  assert.equal(emptyAttempt.changed, false);
  assert.equal(emptyAttempt.spent, 0);
  assert.equal(emptyAttempt.blockedReason, 'not_owned');
  assert.equal(emptyAttempt.nextState.cash, starter.cash);

  // 3. Rival / another owner faction ('enemy_1') -> blocked for 'player', cash untouched
  const withRival = {
    ...starter,
    hexes: {
      ...starter.hexes,
      [hexKey(2, -1)]: {
        ...starter.hexes[hexKey(2, -1)],
        owner: 'enemy_1',
      },
    },
  };
  assert.equal(getHexOwner(withRival, 2, -1), 'enemy_1');
  assert.equal(canBuildInTerritory(withRival, 2, -1, 'player'), false);
  const rivalAttempt = placeHexInState(withRival, 2, -1, paidIdx, 90, HEX_ASSETS);
  assert.equal(rivalAttempt.changed, false);
  assert.equal(rivalAttempt.spent, 0);
  assert.equal(rivalAttempt.blockedReason, 'not_owned');
  assert.equal(rivalAttempt.nextState.cash, withRival.cash);

  // Multi-faction seam: that faction itself could build on its own tile
  assert.equal(canBuildInTerritory(withRival, 2, -1, 'enemy_1'), true);
  const rivalSelfBuild = placeHexInState(
    withRival,
    2,
    -1,
    houseIdx,
    90,
    HEX_ASSETS,
    'enemy_1'
  );
  assert.equal(rivalSelfBuild.changed, true);
  assert.equal(getHexOwner(rivalSelfBuild.nextState, 2, -1), 'enemy_1');

  // 4. Conquering neutral tile (2, 0) enables building on it and deducts paid price
  const conquered = conquerHexInState(starter, 2, 0, HEX_ASSETS);
  assert.equal(conquered.conquered, true);
  assert.equal(canBuildInTerritory(conquered.nextState, 2, 0, 'player'), true);
  const validBuild = placeHexInState(
    conquered.nextState,
    2,
    0,
    paidIdx,
    90,
    HEX_ASSETS
  );
  assert.equal(validBuild.changed, true);
  assert.equal(validBuild.spent, paidPrice);
  assert.equal(validBuild.nextState.cash, conquered.nextState.cash - paidPrice);
  assert.equal(getHexOwner(validBuild.nextState, 2, 0), 'player');
});
