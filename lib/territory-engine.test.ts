import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_ROTATION_DEG,
  INITIAL_CASH,
  axialToWorld,
  createStarterWorldState,
  demolishHexInState,
  deserializeWorldState,
  hasHexConstruction,
  hexKey,
  placeHexInState,
  serializeWorldState,
  type HexWorldState,
} from './hex-engine';
import {
  advanceKingdomTurn,
  createSandboxKingdomState,
  createStarterKingdomState,
  deserializeKingdomState,
  evaluateExpansionInKingdom,
  getKingdomEconomy,
  getKingdomTerritoryCapacity,
  serializeKingdomState,
  startExpansionInKingdom,
  type KingdomState,
} from './kingdom-engine';
import { calculatePlayerResources, getHexTerrainAndResource } from './terrain-engine';
import {
  ALREADY_OCCUPIED_BUILD_MESSAGE,
  AXIAL_DIRECTIONS,
  INITIAL_PLAYER_TERRITORY_COORDS,
  NOT_OWNED_BUILD_MESSAGE,
  canBuildInTerritory,
  canExpand,
  computeHexInfluence,
  computeTerritorialCapacity,
  countPlayerTerritory,
  evaluateExpansion,
  getAxialNeighbors,
  getExpandableFrontierCoords,
  getExpansionFailureMessage,
  getHexOwner,
  isAdjacentToPlayerTerritory,
  startExpansion,
} from './territory-engine';
import { HEX_ASSETS } from './repo-data';

function idxOf(name: string): number {
  const idx = HEX_ASSETS.findIndex((a) => a.name === name);
  assert.ok(idx >= 0, `Missing asset ${name}`);
  return idx;
}

function grantHexOwnershipForTest(
  state: HexWorldState,
  q: number,
  r: number,
  owner = 'player'
): HexWorldState {
  const key = hexKey(q, r);
  const existing = state.hexes[key];
  assert.ok(existing, `Expected tile at (${q},${r})`);
  const terrainInfo = getHexTerrainAndResource(q, r, existing);
  return {
    ...state,
    hexes: {
      ...state.hexes,
      [key]: {
        ...existing,
        owner,
        terrainType: terrainInfo.terrainType,
        resourceType: terrainInfo.resourceType,
        resourceAmount: terrainInfo.resourceAmount,
      },
    },
  };
}

function makeChainWorld(length: number, extraBuildings: Record<string, string> = {}): HexWorldState {
  const hexes: HexWorldState['hexes'] = {};
  for (let q = 0; q <= length + 2; q++) {
    for (let r = -1; r <= 1; r++) {
      const key = hexKey(q, r);
      const customAsset = extraBuildings[key];
      const owner = q <= length && r === 0 ? 'player' : 'neutral';
      hexes[key] = {
        q,
        r,
        orientation: DEFAULT_ROTATION_DEG,
        structureIndex: idxOf(customAsset ?? 'grass'),
        owner,
        terrainType: 'plains',
        resourceType: 'none',
        resourceAmount: 0,
        rareFeature: 'none',
      };
    }
  }
  return { cash: INITIAL_CASH, hexes };
}

test('starter world starts with 7 player-owned hexes and remaining neutral hexes', () => {
  const starter = createStarterWorldState(HEX_ASSETS);
  assert.equal(countPlayerTerritory(starter), INITIAL_PLAYER_TERRITORY_COORDS.length);
  assert.equal(countPlayerTerritory(starter), 7);

  for (const c of INITIAL_PLAYER_TERRITORY_COORDS) {
    assert.equal(getHexOwner(starter, c.q, c.r), 'player');
  }

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

test('1 & 2: distant hexes are blocked and adjacent eligible hexes expand with ZERO gold spent', () => {
  const starter = createStarterWorldState(HEX_ASSETS);

  // Distant hex (0, -3) is not adjacent to player territory -> blocked
  assert.equal(isAdjacentToPlayerTerritory(starter, 0, -3), false);
  const farCheck = evaluateExpansion({
    worldState: starter,
    q: 0,
    r: -3,
    population: 18,
    unlockedTechs: [],
    availableWorkers: 10,
    assets: HEX_ASSETS,
    playerCapital: { q: 0, r: 0 },
  });
  assert.equal(farCheck.canExpand, false);
  assert.equal(farCheck.reason, 'not_adjacent');

  const farStart = startExpansion({
    worldState: starter,
    activeExpansions: [],
    q: 0,
    r: -3,
    population: 18,
    unlockedTechs: [],
    availableWorkers: 10,
    assets: HEX_ASSETS,
    playerCapital: { q: 0, r: 0 },
  });
  assert.equal(farStart.started, false);
  assert.equal(farStart.nextExpansions.length, 0);
  assert.equal(starter.cash, INITIAL_CASH);

  // Adjacent plains hex (2, -1) -> eligible and starts incorporation without spending money
  assert.equal(isAdjacentToPlayerTerritory(starter, 2, -1), true);
  const adjCheck = canExpand({
    worldState: starter,
    q: 2,
    r: -1,
    population: 18,
    unlockedTechs: [],
    availableWorkers: 10,
    assets: HEX_ASSETS,
    playerCapital: { q: 0, r: 0 },
  });
  assert.equal(adjCheck.canExpand, true);

  const kingdom = createStarterKingdomState(HEX_ASSETS, 42026);
  const frontier = getExpandableFrontierCoords({
    worldState: kingdom.worldState,
    activeExpansions: kingdom.expansions,
    population: kingdom.population,
    unlockedTechs: kingdom.research.unlocked,
    availableWorkers: getKingdomEconomy(kingdom, HEX_ASSETS).population.availableWorkers,
    assets: HEX_ASSETS,
    playerCapital: kingdom.playerCapital,
  });
  assert.ok(frontier.length > 0);
  const target = frontier[0];
  const cashBefore = kingdom.worldState.cash;
  const started = startExpansionInKingdom(kingdom, target.q, target.r, HEX_ASSETS);
  assert.equal(started.started, true);
  assert.equal(started.nextState.worldState.cash, cashBefore, 'Organic expansion must spend ZERO gold');
  assert.equal(started.nextState.expansions.length, 1);
});

test('3, 4 & 5: population grows capacity, infrastructure extends anchor reach and projects influence farther', () => {
  const baseWorld = makeChainWorld(3, { '0,0': 'building-castle' });

  // Population growth raises territorial capacity (floor(pop / 4))
  const lowPopCap = computeTerritorialCapacity({
    worldState: baseWorld,
    population: 8,
    unlockedTechs: [],
    assets: HEX_ASSETS,
    playerCapital: { q: 0, r: 0 },
  });
  const highPopCap = computeTerritorialCapacity({
    worldState: baseWorld,
    population: 24,
    unlockedTechs: [],
    assets: HEX_ASSETS,
    playerCapital: { q: 0, r: 0 },
  });
  assert.ok(
    highPopCap.capacity > lowPopCap.capacity,
    `Expected capacity to increase with population (${lowPopCap.capacity} -> ${highPopCap.capacity})`
  );
  assert.equal(highPopCap.populationBonus - lowPopCap.populationBonus, 4);

  // Adjacent hex (4, 0) is distance 4 from castle at (0, 0) -> beyond default maxAnchorReach (2)
  const outOfReachCheck = evaluateExpansion({
    worldState: baseWorld,
    q: 4,
    r: 0,
    population: 24,
    unlockedTechs: [],
    availableWorkers: 8,
    assets: HEX_ASSETS,
    playerCapital: { q: 0, r: 0 },
  });
  assert.equal(outOfReachCheck.isAdjacent, true);
  assert.equal(outOfReachCheck.influence.minDistToAnchor, 4);
  assert.equal(outOfReachCheck.influence.withinReach, false);
  assert.equal(outOfReachCheck.canExpand, false);
  assert.equal(outOfReachCheck.reason, 'out_of_reach');
  assert.match(getExpansionFailureMessage(outOfReachCheck), /alcance administrativo/i);

  // Building a Vila (anchor + capacity +2) at (3, 0) extends anchor reach & raises capacity + influence
  const forwardVillageWorld = makeChainWorld(3, {
    '0,0': 'building-castle',
    '3,0': 'building-village',
  });
  const infraCap = computeTerritorialCapacity({
    worldState: forwardVillageWorld,
    population: 24,
    unlockedTechs: [],
    assets: HEX_ASSETS,
    playerCapital: { q: 0, r: 0 },
  });
  assert.equal(infraCap.infrastructureBonus, highPopCap.infrastructureBonus + 2);

  const reachedCheck = evaluateExpansion({
    worldState: forwardVillageWorld,
    q: 4,
    r: 0,
    population: 24,
    unlockedTechs: [],
    availableWorkers: 8,
    assets: HEX_ASSETS,
    playerCapital: { q: 0, r: 0 },
  });
  assert.equal(reachedCheck.influence.minDistToAnchor, 1);
  assert.equal(reachedCheck.influence.withinReach, true);
  assert.ok(reachedCheck.influence.score >= reachedCheck.influence.requiredInfluence);
  assert.equal(reachedCheck.canExpand, true);

  // Tech bonuses ('construction', 'trade', 'engineering') expand capacity, reach, and reduce turns
  const techCap = computeTerritorialCapacity({
    worldState: forwardVillageWorld,
    population: 24,
    unlockedTechs: ['construction', 'trade', 'engineering'],
    assets: HEX_ASSETS,
    playerCapital: { q: 0, r: 0 },
  });
  assert.equal(techCap.techBonus, 8);
  assert.equal(techCap.maxAnchorReach, 5);
});

test('6: terrain difficulty differentiates influence, turns, workers, and rare-feature tech gates', () => {
  const starter = createStarterWorldState(HEX_ASSETS);
  // Neighbors of starter core on starter island:
  // (2, -1) plains, (1, 1) forest, (0, 2) mountain (pure_iron rare feature on legacy lookup)
  const plainsInf = computeHexInfluence({
    worldState: starter,
    q: 2,
    r: -1,
    population: 18,
    unlockedTechs: [],
    assets: HEX_ASSETS,
    playerCapital: { q: 0, r: 0 },
  });
  const forestInf = computeHexInfluence({
    worldState: starter,
    q: 1,
    r: 1,
    population: 18,
    unlockedTechs: [],
    assets: HEX_ASSETS,
    playerCapital: { q: 0, r: 0 },
  });
  const mountainInf = computeHexInfluence({
    worldState: starter,
    q: 0,
    r: 2,
    population: 18,
    unlockedTechs: [],
    assets: HEX_ASSETS,
    playerCapital: { q: 0, r: 0 },
  });

  assert.equal(plainsInf.terrainType, 'plains');
  assert.equal(forestInf.terrainType, 'forest');
  assert.equal(mountainInf.terrainType, 'mountain');
  assert.ok(forestInf.requiredInfluence > plainsInf.requiredInfluence);
  assert.ok(mountainInf.requiredInfluence > forestInf.requiredInfluence);
  assert.equal(plainsInf.workersRequired, 1);
  assert.equal(mountainInf.workersRequired, 2);
  assert.ok(mountainInf.turnsRequired >= forestInf.turnsRequired);

  // Strategic mountain with pure_iron requires 'mining' tech before incorporation
  const rareStarter = grantHexOwnershipForTest(starter, 0, 1);
  const rareWorld: HexWorldState = {
    ...rareStarter,
    hexes: {
      ...rareStarter.hexes,
      [hexKey(0, 2)]: {
        ...rareStarter.hexes[hexKey(0, 2)],
        rareFeature: 'pure_iron',
      },
    },
  };
  const gatedCheck = evaluateExpansion({
    worldState: rareWorld,
    q: 0,
    r: 2,
    population: 30,
    unlockedTechs: [],
    availableWorkers: 10,
    assets: HEX_ASSETS,
    playerCapital: { q: 0, r: 0 },
  });
  assert.equal(gatedCheck.canExpand, false);
  assert.equal(gatedCheck.reason, 'requires_tech');
  assert.equal(gatedCheck.requiredTech, 'mining');
});

test('7 & 8: multi-turn incorporation completes across turns, releases workers, updates frontier, and persists in v6 save/load', () => {
  let state = createStarterKingdomState(HEX_ASSETS, 42026);
  const initialTerritory = countPlayerTerritory(state.worldState);

  const frontier = getExpandableFrontierCoords({
    worldState: state.worldState,
    activeExpansions: state.expansions,
    population: state.population,
    unlockedTechs: state.research.unlocked,
    availableWorkers: getKingdomEconomy(state, HEX_ASSETS).population.availableWorkers,
    assets: HEX_ASSETS,
    playerCapital: state.playerCapital,
  });
  assert.ok(frontier.length > 0);

  // Pick a target requiring >= 2 turns if available so we can test mid-incorporation save/load
  let target = frontier[0];
  for (const coord of frontier) {
    const check = evaluateExpansionInKingdom(state, coord.q, coord.r, HEX_ASSETS);
    if (check.turnsRequired >= 2) {
      target = coord;
      break;
    }
  }

  const started = startExpansionInKingdom(state, target.q, target.r, HEX_ASSETS);
  assert.equal(started.started, true);
  state = started.nextState;
  const totalTurns = started.expansion!.totalTurns;

  // Duplicate incorporation on same tile is blocked with already_expanding
  const duplicateDuring = startExpansionInKingdom(state, target.q, target.r, HEX_ASSETS);
  assert.equal(duplicateDuring.started, false);
  assert.equal(duplicateDuring.check.reason, 'already_expanding');

  // Capacity summary reflects inProgress slot & workers are committed
  const capDuring = getKingdomTerritoryCapacity(state, HEX_ASSETS);
  assert.equal(capDuring.inProgress, 1);
  assert.equal(capDuring.used, capDuring.controlled + 1);
  assert.ok(getKingdomEconomy(state, HEX_ASSETS).population.expansionWorkersUsed >= 1);

  // Round-trip save/load while expansion is active
  const savedMid = serializeKingdomState(state);
  const loadedMid = deserializeKingdomState(savedMid, HEX_ASSETS.length);
  assert.ok(loadedMid !== null);
  assert.equal(loadedMid.expansions.length, 1);
  assert.equal(loadedMid.expansions[0].q, target.q);
  assert.equal(loadedMid.expansions[0].r, target.r);
  state = loadedMid;

  // Advance turns until incorporated
  let incorporated = false;
  for (let i = 0; i < totalTurns; i++) {
    const res = advanceKingdomTurn(state, HEX_ASSETS);
    state = res.nextState;
    if (res.incorporatedKeys.includes(hexKey(target.q, target.r))) {
      incorporated = true;
    }
  }

  assert.equal(incorporated, true, 'Queued expansion must incorporate after turnsRequired');
  assert.equal(getHexOwner(state.worldState, target.q, target.r), 'player');
  assert.equal(countPlayerTerritory(state.worldState), initialTerritory + 1);
  assert.equal(state.expansions.length, 0);
  assert.equal(getKingdomEconomy(state, HEX_ASSETS).population.expansionWorkersUsed, 0);

  // Cannot re-incorporate an already owned tile
  const duplicateAfter = startExpansionInKingdom(state, target.q, target.r, HEX_ASSETS);
  assert.equal(duplicateAfter.started, false);
  assert.equal(duplicateAfter.check.reason, 'already_owned');
});

test('9 & 10: capacity reached, worker shortage, and rival faction tiles block peaceful expansion cleanly', () => {
  // Capacity reached when controlled tiles == capacity (base 4 + pop 0/4 + castle 3 = 7)
  const fullWorld = makeChainWorld(6, { '0,0': 'building-castle' });
  const capCheck = evaluateExpansion({
    worldState: fullWorld,
    q: 1,
    r: 1, // adjacent to (1,0) & axial distance 2 from castle (0,0) -> within reach
    population: 0,
    unlockedTechs: [],
    availableWorkers: 4,
    assets: HEX_ASSETS,
    playerCapital: { q: 0, r: 0 },
  });
  assert.equal(capCheck.capacitySummary.controlled, 7);
  assert.equal(capCheck.capacitySummary.capacity, 7);
  assert.equal(capCheck.capacitySummary.remaining, 0);
  assert.equal(capCheck.canExpand, false);
  assert.equal(capCheck.reason, 'capacity_reached');

  // Worker shortage blocks expansion when availableWorkers === 0
  const workerShortCheck = evaluateExpansion({
    worldState: makeChainWorld(1, { '0,0': 'building-castle' }),
    q: 2,
    r: 0,
    population: 16,
    unlockedTechs: [],
    availableWorkers: 0,
    assets: HEX_ASSETS,
    playerCapital: { q: 0, r: 0 },
  });
  assert.equal(workerShortCheck.canExpand, false);
  assert.equal(workerShortCheck.reason, 'insufficient_workers');

  // Rival faction territory is strictly blocked from peaceful expansion
  const starter = createStarterKingdomState(HEX_ASSETS, 42026);
  const rivalTile = Object.values(starter.worldState.hexes).find(
    (t) => t.owner !== 'player' && t.owner !== 'neutral'
  );
  assert.ok(rivalTile, 'Expected rival faction territory in starter kingdom');
  const rivalCheck = evaluateExpansionInKingdom(starter, rivalTile.q, rivalTile.r, HEX_ASSETS);
  assert.equal(rivalCheck.canExpand, false);
  assert.equal(rivalCheck.reason, 'rival_territory');
  assert.match(getExpansionFailureMessage(rivalCheck), /unidade militar/i);
});

test('building on free owned hex preserves ownership and world serialization round-trips owners', () => {
  const starter = createStarterWorldState(HEX_ASSETS);
  const houseIdx = idxOf('building-house');
  const withForestOwned = grantHexOwnershipForTest(starter, 1, 1);
  const built = placeHexInState(withForestOwned, 1, 1, houseIdx, 90, HEX_ASSETS);
  assert.equal(built.changed, true);
  assert.equal(getHexOwner(built.nextState, 1, 1), 'player');

  const withSecondOwned = grantHexOwnershipForTest(built.nextState, 0, 2);
  const raw = serializeWorldState(withSecondOwned);
  const restored = deserializeWorldState(raw, HEX_ASSETS.length);
  assert.ok(restored !== null);
  assert.equal(countPlayerTerritory(restored), 9);
  assert.equal(getHexOwner(restored, 0, 2), 'player');
  assert.equal(getHexOwner(restored, 2, 0), 'neutral');
});

test('building is restricted strictly to player territory and never deducts cash on neutral or rival tiles', () => {
  const starter = createStarterWorldState(HEX_ASSETS);
  const houseIdx = idxOf('building-house');
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
  const withRival = grantHexOwnershipForTest(starter, 2, -2, 'enemy_1');
  assert.equal(getHexOwner(withRival, 2, -2), 'enemy_1');
  assert.equal(canBuildInTerritory(withRival, 2, -2, 'player'), false);
  const rivalAttempt = placeHexInState(withRival, 2, -2, paidIdx, 90, HEX_ASSETS);
  assert.equal(rivalAttempt.changed, false);
  assert.equal(rivalAttempt.spent, 0);
  assert.equal(rivalAttempt.blockedReason, 'not_owned');
  assert.equal(rivalAttempt.nextState.cash, withRival.cash);

  // Multi-faction seam: that faction itself could build on its own free tile
  assert.equal(canBuildInTerritory(withRival, 2, -2, 'enemy_1'), true);
  const rivalSelfBuild = placeHexInState(
    withRival,
    2,
    -2,
    houseIdx,
    90,
    HEX_ASSETS,
    'enemy_1'
  );
  assert.equal(rivalSelfBuild.changed, true);
  assert.equal(getHexOwner(rivalSelfBuild.nextState, 2, -2), 'enemy_1');

  // 4. Owned free tile (2, 0) enables building on it and deducts paid price
  const withOwnedForest = grantHexOwnershipForTest(starter, 2, 0);
  assert.equal(canBuildInTerritory(withOwnedForest, 2, 0, 'player'), true);
  const validBuild = placeHexInState(
    withOwnedForest,
    2,
    0,
    paidIdx,
    90,
    HEX_ASSETS
  );
  assert.equal(validBuild.changed, true);
  assert.equal(validBuild.spent, paidPrice);
  assert.equal(validBuild.nextState.cash, withOwnedForest.cash - paidPrice);
  assert.equal(getHexOwner(validBuild.nextState, 2, 0), 'player');
});

test('single building per hex blocks overwrite with zero cash spent and demolition restores free terrain and resources', () => {
  assert.equal(
    ALREADY_OCCUPIED_BUILD_MESSAGE,
    'Este território já possui uma construção.'
  );
  const starter = createStarterWorldState(HEX_ASSETS);
  const paidIdx = HEX_ASSETS.findIndex((a) => a.price > 0);
  const mineIdx = idxOf('building-mine');
  assert.ok(paidIdx >= 0 && mineIdx >= 0);

  // 1. Starter castle at (0, 0) already has a building -> cannot build paid piece on top
  const overCastle = placeHexInState(starter, 0, 0, paidIdx, 90, HEX_ASSETS);
  assert.equal(overCastle.changed, false);
  assert.equal(overCastle.spent, 0);
  assert.equal(overCastle.blockedReason, 'already_occupied');
  assert.equal(overCastle.nextState.cash, starter.cash);

  // 2. Grant owned Mountain (0, 2) -> free terrain with ore = 10, build Mine, then block overwrite
  const withOwnedMountain = grantHexOwnershipForTest(starter, 0, 2);
  const resBeforeBuild = calculatePlayerResources(withOwnedMountain);
  assert.equal(resBeforeBuild.ore, 10);

  const builtMine = placeHexInState(withOwnedMountain, 0, 2, mineIdx, 90, HEX_ASSETS);
  assert.equal(builtMine.changed, true);
  assert.equal(hasHexConstruction(builtMine.nextState.hexes[hexKey(0, 2)], HEX_ASSETS), true);

  const overwriteAttempt = placeHexInState(builtMine.nextState, 0, 2, paidIdx, 90, HEX_ASSETS);
  assert.equal(overwriteAttempt.changed, false);
  assert.equal(overwriteAttempt.spent, 0);
  assert.equal(overwriteAttempt.blockedReason, 'already_occupied');
  assert.equal(overwriteAttempt.nextState.cash, builtMine.nextState.cash);

  // 3. Cannot demolish neutral or rival buildings
  const neutralDemolish = demolishHexInState(builtMine.nextState, 2, -1, HEX_ASSETS);
  assert.equal(neutralDemolish.removed, false);
  assert.equal(neutralDemolish.blockedReason, 'not_owned');

  // 4. Demolish player's Mine on (0, 2) -> removes building, keeps player ownership, mountain terrain, ore=10, and cash
  const cashBeforeDemolish = builtMine.nextState.cash;
  const demolished = demolishHexInState(builtMine.nextState, 0, 2, HEX_ASSETS);
  assert.equal(demolished.removed, true);
  const tile = demolished.nextState.hexes[hexKey(0, 2)];
  assert.equal(tile.owner, 'player');
  assert.equal(tile.terrainType, 'mountain');
  assert.equal(tile.resourceType, 'ore');
  assert.equal(tile.resourceAmount, 10);
  assert.equal(hasHexConstruction(tile, HEX_ASSETS), false);
  assert.equal(HEX_ASSETS[tile.structureIndex].name, 'stone-mountain');
  assert.equal(countPlayerTerritory(demolished.nextState), 8);
  assert.equal(calculatePlayerResources(demolished.nextState).ore, 10);
  assert.equal(demolished.nextState.cash, cashBeforeDemolish);

  // 5. Demolishing a fertile starter farm (-1, 1) keeps food=20 and restores 'dirt'
  const demolishFarm = demolishHexInState(demolished.nextState, -1, 1, HEX_ASSETS);
  assert.equal(demolishFarm.removed, true);
  const farmTile = demolishFarm.nextState.hexes[hexKey(-1, 1)];
  assert.equal(farmTile.owner, 'player');
  assert.equal(farmTile.terrainType, 'fertile');
  assert.equal(farmTile.resourceType, 'food');
  assert.equal(HEX_ASSETS[farmTile.structureIndex].name, 'dirt');
  assert.equal(calculatePlayerResources(demolishFarm.nextState).food, 20);

  // 6. Can build again on the freed mountain hex
  const rebuilt = placeHexInState(demolishFarm.nextState, 0, 2, paidIdx, 90, HEX_ASSETS);
  assert.equal(rebuilt.changed, true);
  assert.equal(rebuilt.spent, HEX_ASSETS[paidIdx].price);
  assert.equal(hasHexConstruction(rebuilt.nextState.hexes[hexKey(0, 2)], HEX_ASSETS), true);
});
