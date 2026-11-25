import test from 'node:test';
import assert from 'node:assert/strict';
import { HEX_ASSETS } from './repo-data';
import { hasHexConstruction, hexKey, type AxialCoord } from './hex-engine';
import { countFactionTerritory } from './faction-engine';
import { AXIAL_DIRECTIONS, getConquerableFrontierCoords } from './territory-engine';
import { getStrategicRegionInfo } from './terrain-engine';
import { getAvailableTechs } from './tech-engine';
import {
  advanceKingdomTurn,
  buildInKingdom,
  calculateStrategicConquestCost,
  commandUnitInKingdom,
  conquerInKingdom,
  createStarterKingdomState,
  demolishInKingdom,
  deserializeKingdomState,
  getKingdomEconomy,
  getKingdomMarket,
  getKingdomProgression,
  performDiplomacyAction,
  recruitUnitInKingdom,
  resolveKingdomEvent,
  serializeKingdomState,
  setActiveResearchInKingdom,
  tradeResourceInKingdom,
  type KingdomState,
} from './kingdom-engine';

function idxOf(name: string): number {
  const idx = HEX_ASSETS.findIndex((a) => a.name === name);
  assert.ok(idx >= 0, `Missing asset ${name}`);
  return idx;
}

function findNeutralFrontierWithTerrain(
  state: KingdomState,
  terrain: 'plains' | 'forest' | 'fertile' | 'mountain'
): AxialCoord {
  const frontier = getConquerableFrontierCoords(state.worldState);
  for (const coord of frontier) {
    const tile = state.worldState.hexes[hexKey(coord.q, coord.r)];
    if (tile?.terrainType === terrain) return coord;
  }
  throw new Error(`No adjacent ${terrain} frontier tile found`);
}

function getFreeOwnedCoord(state: KingdomState): AxialCoord {
  const cap = state.playerCapital ?? { q: 0, r: 0 };
  for (const dir of AXIAL_DIRECTIONS) {
    const c = { q: cap.q + dir.q, r: cap.r + dir.r };
    const tile = state.worldState.hexes[hexKey(c.q, c.r)];
    if (tile && tile.owner === 'player' && !hasHexConstruction(tile, HEX_ASSETS)) {
      return c;
    }
  }
  const free = Object.values(state.worldState.hexes).find(
    (t) =>
      t.owner === 'player' &&
      (t.terrainType === 'plains' || t.terrainType === 'fertile') &&
      !hasHexConstruction(t, HEX_ASSETS)
  );
  assert.ok(free, 'Expected at least one free owned hex in starter core');
  return { q: free.q, r: free.r };
}

test('createStarterKingdomState seeds 32x32 world, player core, 2 rival factions, initial units, and balanced economy', () => {
  const state = createStarterKingdomState(HEX_ASSETS);
  assert.equal(state.turn, 1);
  assert.equal(state.population, 18);
  assert.equal(Object.keys(state.worldState.hexes).length, 1024);
  assert.ok(state.playerCapital !== undefined);
  assert.equal(countFactionTerritory(state.worldState, 'player'), 7);
  assert.equal(countFactionTerritory(state.worldState, 'iron_clan'), 4);
  assert.equal(countFactionTerritory(state.worldState, 'azure_league'), 4);
  assert.equal(state.units.length, 2);
  assert.equal(state.factions[0].population, 12);
  assert.ok(state.factions[0].resources.wood > 0);

  const econ = getKingdomEconomy(state, HEX_ASSETS);
  assert.equal(econ.population.capacity, 28);
  assert.equal(econ.population.usedWorkers, 6);
  assert.equal(econ.population.availableWorkers, 12);
  assert.ok(econ.goldNet > 0);
  assert.ok(econ.foodNet > 0);
  assert.ok(econ.scienceNet >= 3);

  const prog = getKingdomProgression(state, HEX_ASSETS);
  assert.equal(prog.stage.stageIndex, 1);
  assert.equal(prog.stage.labelPt, 'Acampamento Real');
});

test('strategic regions give deterministic rare resources and conquest modifiers', () => {
  const state = createStarterKingdomState(HEX_ASSETS);
  const cap = state.playerCapital!;
  const coreTile = state.worldState.hexes[hexKey(cap.q, cap.r)];
  const core = getStrategicRegionInfo(cap.q, cap.r, coreTile);
  assert.equal(core.rareFeature, 'none');
  assert.equal(core.conquestCostMultiplier, 1);

  const rareTile = Object.values(state.worldState.hexes).find(
    (t) => t.rareFeature && t.rareFeature !== 'none'
  );
  assert.ok(rareTile, 'Procedural world must generate strategic rare nodes');
  const rareInfo = getStrategicRegionInfo(rareTile.q, rareTile.r, rareTile);
  assert.notEqual(rareInfo.rareFeature, 'none');
  assert.ok(rareInfo.labelPt.length > 0);

  const ironCost = calculateStrategicConquestCost(
    state,
    rareTile.q,
    rareTile.r,
    HEX_ASSETS
  );
  assert.ok(ironCost >= 500);
});

test('buildInKingdom blocks natural terrain assets, enforces multi-turn queue, tech lock, worker availability, and demolish preserves tile', () => {
  let state = createStarterKingdomState(HEX_ASSETS);
  const freeCoord = getFreeOwnedCoord(state);

  // Natural terrain assets can NEVER be built
  const naturalBlocked = buildInKingdom(
    state,
    freeCoord.q,
    freeCoord.r,
    idxOf('grass-forest'),
    90,
    HEX_ASSETS
  );
  assert.equal(naturalBlocked.built, false);
  assert.match(naturalBlocked.messagePt ?? '', /Terrenos naturais/);

  // Attempt to build Quartel before Military research -> blocked
  const barracksBlocked = buildInKingdom(
    state,
    freeCoord.q,
    freeCoord.r,
    idxOf('building-archery'),
    90,
    HEX_ASSETS
  );
  assert.equal(barracksBlocked.built, false);
  assert.match(barracksBlocked.messagePt ?? '', /Requer pesquisa/);

  // Ensure a forest tile is owned in frontier
  let forestCoord: AxialCoord;
  try {
    forestCoord = findNeutralFrontierWithTerrain(state, 'forest');
    state = conquerInKingdom(state, forestCoord.q, forestCoord.r, HEX_ASSETS).nextState;
  } catch {
    const anyNeutral = findNeutralFrontierWithTerrain(state, 'plains');
    forestCoord = { ...anyNeutral };
    state = conquerInKingdom(state, forestCoord.q, forestCoord.r, HEX_ASSETS).nextState;
    state = {
      ...state,
      worldState: {
        ...state.worldState,
        hexes: {
          ...state.worldState.hexes,
          [hexKey(forestCoord.q, forestCoord.r)]: {
            ...state.worldState.hexes[hexKey(forestCoord.q, forestCoord.r)],
            terrainType: 'forest',
            resourceType: 'wood',
            structureIndex: idxOf('grass-forest'),
          },
        },
      },
    };
  }

  // Build Serraria on forest (takes 2 turns, deducts gold, wood, stone)
  const woodBefore = state.resources.wood;
  const goldBefore = state.worldState.cash;
  const econBeforeLumber = getKingdomEconomy(state, HEX_ASSETS);
  const lumber = buildInKingdom(
    state,
    forestCoord.q,
    forestCoord.r,
    idxOf('dirt-lumber'),
    90,
    HEX_ASSETS
  );
  assert.equal(lumber.built, true);
  state = lumber.nextState;
  assert.equal(state.resources.wood, woodBefore - 5);
  assert.equal(state.worldState.cash, goldBefore - 75);
  assert.equal(state.constructions.length, 1);
  assert.equal(state.constructions[0].turnsRemaining, 2);

  // Under-construction Serraria does NOT produce wood yet!
  const econWhileBuilding = getKingdomEconomy(state, HEX_ASSETS);
  assert.equal(econWhileBuilding.underConstructionCount, 1);
  assert.equal(econWhileBuilding.woodNet, econBeforeLumber.woodNet);

  // Building on an already occupied tile is blocked
  const doubleBuild = buildInKingdom(
    state,
    forestCoord.q,
    forestCoord.r,
    idxOf('building-house'),
    90,
    HEX_ASSETS
  );
  assert.equal(doubleBuild.built, false);
  assert.match(doubleBuild.messagePt ?? '', /já possui uma construção/);

  // Worker shortage still allows queueing on the remaining free owned plains hex with a clear warning,
  // and once completed it reports idle/partial until Casas restore workforce
  const starvedWorkers: typeof state = { ...state, population: 6 };
  const shortWorkerBuild = buildInKingdom(
    starvedWorkers,
    freeCoord.q,
    freeCoord.r,
    idxOf('building-market'),
    90,
    HEX_ASSETS
  );
  assert.equal(shortWorkerBuild.built, true);
  assert.match(shortWorkerBuild.messagePt ?? '', /Faltam trabalhadores/);
  const econShort = getKingdomEconomy(shortWorkerBuild.nextState, HEX_ASSETS);
  assert.equal(
    econShort.buildingsByKey[hexKey(freeCoord.q, freeCoord.r)]?.status,
    'under_construction'
  );

  // Advance 2 turns -> Serraria completes and increases wood production!
  const t2 = advanceKingdomTurn(state, HEX_ASSETS);
  assert.equal(t2.nextState.constructions.length, 1);
  assert.equal(t2.nextState.constructions[0].turnsRemaining, 1);
  const t3 = advanceKingdomTurn(t2.nextState, HEX_ASSETS);
  assert.equal(t3.nextState.constructions.length, 0);
  assert.ok(t3.completedBuildings.includes('Serraria'));
  const econAfterLumber = getKingdomEconomy(t3.nextState, HEX_ASSETS);
  assert.ok(econAfterLumber.woodNet > econBeforeLumber.woodNet);

  // Demolish Serraria leaves player-owned free forest
  const dem = demolishInKingdom(t3.nextState, forestCoord.q, forestCoord.r, HEX_ASSETS);
  assert.equal(dem.removed, true);
  assert.equal(dem.nextState.worldState.hexes[hexKey(forestCoord.q, forestCoord.r)]?.owner, 'player');
  assert.equal(dem.nextState.worldState.hexes[hexKey(forestCoord.q, forestCoord.r)]?.terrainType, 'forest');
});

test('research progression, multi-turn event effects, trade market, and rival AI growth work cleanly', () => {
  let state = createStarterKingdomState(HEX_ASSETS);
  const avail = getAvailableTechs(state.research);
  assert.ok(avail.some((t) => t.id === 'agriculture'));
  assert.ok(avail.some((t) => t.id === 'mining'));

  state = setActiveResearchInKingdom(state, 'mining').nextState;

  // Build a University (2 turns) on free owned plains hex
  const uniCoord = getFreeOwnedCoord(state);
  const uni = buildInKingdom(
    state,
    uniCoord.q,
    uniCoord.r,
    idxOf('building-wizard-tower'),
    90,
    HEX_ASSETS
  );
  assert.equal(uni.built, true);
  state = uni.nextState;

  // Turn 2 & Turn 3: University finishes on T3, Turn 3 triggers Seca Severa (multi-turn event)
  state = advanceKingdomTurn(state, HEX_ASSETS).nextState; // T2 (uni 1t left)
  state = advanceKingdomTurn(state, HEX_ASSETS).nextState; // T3 (uni completes)
  assert.equal(state.turn, 3);
  assert.ok(state.activeEvent !== null, 'Turn 3 must generate a kingdom event');

  // Accept drought (second choice) -> attaches 3-turn active world effect reducing food by 30%
  const econBeforeDrought = getKingdomEconomy(state, HEX_ASSETS);
  const droughtChoice = state.activeEvent!.choices[state.activeEvent!.choices.length - 1].id;
  state = resolveKingdomEvent(state, droughtChoice, HEX_ASSETS).nextState;
  assert.equal(state.activeEvent, null);
  assert.equal(state.activeEffects.length, 1);
  assert.equal(state.activeEffects[0].turnsRemaining, 3);
  const econDuringDrought = getKingdomEconomy(state, HEX_ASSETS);
  assert.ok(econDuringDrought.foodProduced < econBeforeDrought.foodProduced);

  // Turn 4: University now contributes +6 Science -> Mining (15) unlocks! Effect ticks down to 2 turns.
  state = advanceKingdomTurn(state, HEX_ASSETS).nextState;
  assert.ok(state.research.unlocked.includes('mining'), 'Mining unlocks once University is complete');
  assert.equal(state.activeEffects[0].turnsRemaining, 2);

  // Check rival AI factions grew their territory over 4 turns
  const totalAiTiles =
    countFactionTerritory(state.worldState, 'iron_clan') +
    countFactionTerritory(state.worldState, 'azure_league');
  assert.ok(totalAiTiles >= 10, 'AI factions should expand strategically');

  // Test dynamic Trade Market buy & sell (including Metal)
  const market = getKingdomMarket(state, HEX_ASSETS);
  assert.equal(market.quotes.length, 5);
  const cashBeforeTrade = state.worldState.cash;
  const oreBeforeTrade = state.resources.ore;
  const bought = tradeResourceInKingdom(state, 'ore', 'buy', 10, HEX_ASSETS);
  assert.equal(bought.success, true);
  assert.ok(bought.nextState.resources.ore > oreBeforeTrade);
  assert.ok(bought.nextState.worldState.cash < cashBeforeTrade);

  const sold = tradeResourceInKingdom(bought.nextState, 'wood', 'sell', 10, HEX_ASSETS);
  assert.equal(sold.success, true);
  assert.ok(sold.nextState.worldState.cash > bought.nextState.worldState.cash);

  // Diplomacy with Azure League (initially neutral -> trade_pact gives +$20/turn)
  const pact = performDiplomacyAction(sold.nextState, 'azure_league', 'trade_pact');
  assert.equal(pact.success, true);
  const econWithPact = getKingdomEconomy(pact.nextState, HEX_ASSETS);
  assert.equal(econWithPact.goldTradePactBonus, 20);
});

test('military recruitment, movement, and combat capture of enemy territory', () => {
  let state = createStarterKingdomState(HEX_ASSETS);
  state = {
    ...state,
    research: {
      unlocked: ['mining', 'military', 'metallurgy'],
      activeTechId: 'agriculture',
      progressScience: 0,
    },
  };

  const cap = state.playerCapital!;
  const rec = recruitUnitInKingdom(state, cap.q, cap.r, 'knight', HEX_ASSETS);
  assert.equal(rec.recruited, true);
  state = rec.nextState;
  assert.equal(state.units.filter((u) => u.owner === 'player').length, 1);

  // Helper BFS from unit position to nearest enemy tile (handles dynamic AI unit/border shifts)
  const findStepTowardEnemy = (
    curState: KingdomState,
    from: AxialCoord
  ): { step: AxialCoord; isEnemyTarget: boolean } => {
    const queue: Array<{ coord: AxialCoord; firstStep: AxialCoord | null }> = [
      { coord: from, firstStep: null },
    ];
    const visited = new Set<string>([hexKey(from.q, from.r)]);
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const dir of AXIAL_DIRECTIONS) {
        const n = { q: cur.coord.q + dir.q, r: cur.coord.r + dir.r };
        const nk = hexKey(n.q, n.r);
        if (visited.has(nk)) continue;
        const tile = curState.worldState.hexes[nk];
        if (!tile || tile.terrainType === 'water') continue;
        const firstStep = cur.firstStep ?? n;
        const isEnemyTile = tile.owner !== 'player' && tile.owner !== 'neutral';
        const occ = curState.units.find((u) => u.q === n.q && u.r === n.r);
        if (isEnemyTile && (!occ || occ.owner !== 'player')) {
          return { step: firstStep, isEnemyTarget: firstStep.q === n.q && firstStep.r === n.r };
        }
        if (occ) continue;
        visited.add(nk);
        queue.push({ coord: n, firstStep });
      }
    }
    throw new Error('Expected reachable enemy territory on land');
  };

  // Walk step 1 and verify double move is blocked on same turn
  let prev = cap;
  const firstHop = findStepTowardEnemy(state, prev);
  const step1 = commandUnitInKingdom(state, prev, firstHop.step, HEX_ASSETS);
  assert.equal(step1.acted, true);
  state = step1.nextState;
  prev = firstHop.step;

  const nextCheck = findStepTowardEnemy(state, prev);
  const doubleMove = commandUnitInKingdom(state, prev, nextCheck.step, HEX_ASSETS);
  assert.equal(doubleMove.acted, false);

  let capturedEnemyTile = false;
  for (let turnStep = 0; turnStep < 14; turnStep++) {
    state = advanceKingdomTurn(state, HEX_ASSETS).nextState;
    const unitNow = state.units.find((u) => u.owner === 'player');
    assert.ok(unitNow, 'Player knight should still be active');
    prev = { q: unitNow.q, r: unitNow.r };

    const hop = findStepTowardEnemy(state, prev);
    const cashBeforeAttack = state.worldState.cash;
    const res = commandUnitInKingdom(state, prev, hop.step, HEX_ASSETS);
    assert.equal(res.acted, true, `March step failed: ${res.messagePt}`);
    state = res.nextState;

    if (res.capturedKey) {
      assert.equal(state.worldState.hexes[res.capturedKey]?.owner, 'player');
      assert.ok(state.worldState.cash >= cashBeforeAttack + 120);
      capturedEnemyTile = true;
      break;
    }
  }
  assert.equal(capturedEnemyTile, true, 'Knight should reach and capture enemy territory');
});

test('serializeKingdomState and deserializeKingdomState round-trip v4 procedural state and support v1 fallback', () => {
  let starter = createStarterKingdomState(HEX_ASSETS, 987654);
  starter = setActiveResearchInKingdom(starter, 'mining').nextState;
  const freeCoord = getFreeOwnedCoord(starter);
  starter = buildInKingdom(starter, freeCoord.q, freeCoord.r, idxOf('building-house'), 90, HEX_ASSETS).nextState;

  const json = serializeKingdomState(starter);
  const loaded = deserializeKingdomState(json, HEX_ASSETS.length);
  assert.ok(loaded !== null);
  assert.equal(loaded.worldSeed, 987654);
  assert.deepEqual(loaded.playerCapital, starter.playerCapital);
  assert.equal(Object.keys(loaded.worldState.hexes).length, 1024);
  assert.equal(loaded.turn, 1);
  assert.equal(loaded.population, 18);
  assert.equal(loaded.research.activeTechId, 'mining');
  assert.equal(loaded.constructions.length, 1);
  assert.equal(loaded.constructions[0].turnsRemaining, 1);
  assert.equal(loaded.factions.length, 2);
  assert.equal(loaded.units.length, 2);

  // v1 payload backward-compatibility
  const v1 = JSON.stringify({
    version: 1,
    cash: 8500,
    structures: Object.values(starter.worldState.hexes),
  });
  const loadedV1 = deserializeKingdomState(v1, HEX_ASSETS.length);
  assert.ok(loadedV1 !== null);
  assert.equal(loadedV1.worldState.cash, 8500);
  assert.equal(loadedV1.turn, 1);
  assert.equal(loadedV1.constructions.length, 0);
});

