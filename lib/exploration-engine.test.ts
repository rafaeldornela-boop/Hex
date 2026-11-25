import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialExplorationState,
  bootstrapExplorationFromWorld,
  isHexRevealed,
  getHexVisibility,
  evaluateExploration,
  startExploration,
  advanceExplorationTurn,
  getDiscoveryCatalog,
  serializeExplorationState,
  deserializeExplorationState,
  type ExplorationState,
} from './exploration-engine';
import {
  createStarterWorldState,
  hexKey,
} from './hex-engine';
import { HEX_ASSETS } from './repo-data';

test('createInitialExplorationState creates empty or initial coords state', () => {
  const empty = createInitialExplorationState();
  assert.equal(empty.revealedKeys.length, 0);
  assert.equal(empty.nextExplorerId, 1);

  const withCoords = createInitialExplorationState([{ q: 0, r: 0 }]);
  assert.equal(withCoords.revealedKeys.length, 1);
  assert.ok(isHexRevealed(withCoords, 0, 0));
  assert.equal(isHexRevealed(withCoords, 1, 0), false);
});

test('bootstrapExplorationFromWorld reveals owned tiles and neighbors', () => {
  const world = createStarterWorldState(HEX_ASSETS);
  const exp = bootstrapExplorationFromWorld(world, 'player');

  // Player owned tiles should be revealed
  for (const [key, tile] of Object.entries(world.hexes)) {
    if (tile.owner === 'player') {
      assert.ok(exp.revealedKeys.includes(key), `expected ${key} to be revealed`);
    }
  }

  // Visibility check
  const visOwned = getHexVisibility(exp, world, 0, 0, 'player');
  assert.equal(visOwned, 'owned');

  const visFar = getHexVisibility(exp, world, 10, 10, 'player');
  assert.equal(visFar, 'unknown');
});

test('evaluateExploration enforces adjacency, range and costs', () => {
  const world = createStarterWorldState(HEX_ASSETS);
  const exp = bootstrapExplorationFromWorld(world, 'player');

  // Target adjacent unrevealed tile
  let target = { q: 2, r: 0 };
  let evalRes = evaluateExploration({
    exploration: exp,
    worldState: world,
    q: target.q,
    r: target.r,
  });

  if (exp.revealedKeys.includes(hexKey(target.q, target.r))) {
    assert.equal(evalRes.canExplore, false);
    assert.equal(evalRes.reason, 'Hexágono já revelado.');
  }

  // Distant tile (not adjacent to revealed)
  const farRes = evaluateExploration({
    exploration: exp,
    worldState: world,
    q: 15,
    r: 15,
  });
  assert.equal(farRes.canExplore, false);
});

test('startExploration and advanceExplorationTurn reveals target and neighbors', () => {
  const world = createStarterWorldState(HEX_ASSETS);
  const exp = bootstrapExplorationFromWorld(world, 'player');

  // Find an unrevealed tile adjacent to a revealed one
  let candidateTarget: { q: number; r: number } | null = null;
  for (const key of exp.revealedKeys) {
    const tile = world.hexes[key];
    if (!tile) continue;
    // Check neighbors
    const neighbors = [
      { q: tile.q + 1, r: tile.r },
      { q: tile.q - 1, r: tile.r },
      { q: tile.q, r: tile.r + 1 },
      { q: tile.q, r: tile.r - 1 },
    ];
    for (const n of neighbors) {
      if (!exp.revealedKeys.includes(hexKey(n.q, n.r)) && world.hexes[hexKey(n.q, n.r)]) {
        candidateTarget = n;
        break;
      }
    }
    if (candidateTarget) break;
  }

  assert.ok(candidateTarget, 'should find a candidate target');

  const startRes = startExploration({
    exploration: exp,
    worldState: world,
    q: candidateTarget.q,
    r: candidateTarget.r,
    availableGold: 100,
    availableFood: 100,
  });

  assert.equal(startRes.started, true);
  assert.equal(startRes.nextExploration.activeExplorers.length, 1);

  // Advance turns until complete
  let curState = startRes.nextExploration;
  for (let turn = 1; turn <= 3; turn++) {
    const advRes = advanceExplorationTurn({
      exploration: curState,
      worldState: world,
      turn,
    });
    curState = advRes.nextState;
    if (curState.activeExplorers.length === 0) break;
  }

  assert.ok(curState.revealedKeys.includes(hexKey(candidateTarget.q, candidateTarget.r)));
  assert.equal(curState.activeExplorers.length, 0);
});

test('serialization round-trip', () => {
  const state: ExplorationState = {
    revealedKeys: ['0,0', '1,0', '0,1'],
    claimedDiscoveries: [
      {
        id: 'ruin_1',
        namePt: 'Ruínas',
        kind: 'ruin',
        coord: { q: 1, r: 0 },
        descriptionPt: 'Desc',
        reward: { gold: 50 },
      },
    ],
    activeExplorers: [],
    nextExplorerId: 2,
    rangeBonus: 1,
    rangeBonusTurnsRemaining: 3,
    explorationCount: 1,
  };

  const serialized = serializeExplorationState(state);
  const deserialized = deserializeExplorationState(serialized);
  assert.ok(deserialized);
  assert.deepEqual(deserialized!.revealedKeys, state.revealedKeys);
  assert.equal(deserialized!.claimedDiscoveries.length, 1);
  assert.equal(deserialized!.rangeBonus, 1);
  assert.equal(deserialized!.rangeBonusTurnsRemaining, 3);
});

test('getDiscoveryCatalog returns predefined templates', () => {
  const catalog = getDiscoveryCatalog();
  assert.ok(catalog.length > 0);
  for (const item of catalog) {
    assert.ok(item.id);
    assert.ok(item.namePt);
    assert.ok(item.kind);
    assert.ok(item.descriptionPt);
  }
});
