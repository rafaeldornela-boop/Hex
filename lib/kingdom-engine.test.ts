import test from 'node:test';
import assert from 'node:assert/strict';
import { HEX_ASSETS } from './repo-data';
import { hexKey } from './hex-engine';
import { countFactionTerritory } from './faction-engine';
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
  getKingdomProgression,
  performDiplomacyAction,
  recruitUnitInKingdom,
  resolveKingdomEvent,
  serializeKingdomState,
  setActiveResearchInKingdom,
} from './kingdom-engine';

function idxOf(name: string): number {
  const idx = HEX_ASSETS.findIndex((a) => a.name === name);
  assert.ok(idx >= 0, `Missing asset ${name}`);
  return idx;
}

test('createStarterKingdomState seeds player core, 2 rival factions, initial units, and balanced economy', () => {
  const state = createStarterKingdomState(HEX_ASSETS);
  assert.equal(state.turn, 1);
  assert.equal(state.population, 18);
  assert.equal(countFactionTerritory(state.worldState, 'player'), 7);
  assert.equal(countFactionTerritory(state.worldState, 'iron_clan'), 4);
  assert.equal(countFactionTerritory(state.worldState, 'azure_league'), 4);
  assert.equal(state.units.length, 2);

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
  const core = getStrategicRegionInfo(0, 0);
  assert.equal(core.rareFeature, 'none');
  assert.equal(core.conquestCostMultiplier, 1);

  const iron = getStrategicRegionInfo(0, 2);
  assert.equal(iron.rareFeature, 'pure_iron');
  assert.equal(iron.labelPt, 'Ferro Puro');
  assert.ok(iron.bonusOrePerTurn > 0);

  const state = createStarterKingdomState(HEX_ASSETS);
  const ironCost = calculateStrategicConquestCost(state, 0, 2, HEX_ASSETS);
  assert.ok(ironCost > 500);
});

test('buildInKingdom enforces tech lock, worker availability, resource costs, and demolish preserves tile', () => {
  let state = createStarterKingdomState(HEX_ASSETS);

  // Conquer (1, 1) forest and (-1, -1) plains adjacent to core
  const c1 = conquerInKingdom(state, 1, 1, HEX_ASSETS);
  assert.equal(c1.conquered, true);
  state = c1.nextState;

  const c2 = conquerInKingdom(state, -1, -1, HEX_ASSETS);
  assert.equal(c2.conquered, true);
  state = c2.nextState;

  // Attempt to build Quartel before Military research -> blocked
  const barracksBlocked = buildInKingdom(
    state,
    -1,
    -1,
    idxOf('building-archery'),
    90,
    HEX_ASSETS
  );
  assert.equal(barracksBlocked.built, false);
  assert.match(barracksBlocked.messagePt ?? '', /Requer pesquisa/);

  // Attempt to build Serraria on forest without tech -> allowed! Deducts gold, wood, stone
  const woodBefore = state.resources.wood;
  const goldBefore = state.worldState.cash;
  const lumber = buildInKingdom(state, 1, 1, idxOf('dirt-lumber'), 90, HEX_ASSETS);
  assert.equal(lumber.built, true);
  state = lumber.nextState;
  assert.equal(state.resources.wood, woodBefore - 5);
  assert.equal(state.worldState.cash, goldBefore - 75);

  // Building on an already occupied tile is blocked
  const doubleBuild = buildInKingdom(state, 1, 1, idxOf('building-house'), 90, HEX_ASSETS);
  assert.equal(doubleBuild.built, false);
  assert.match(doubleBuild.messagePt ?? '', /já possui uma construção/);

  // Worker shortage check
  const starvedWorkers: typeof state = { ...state, population: 6 };
  const noWorkerBuild = buildInKingdom(
    starvedWorkers,
    -1,
    -1,
    idxOf('building-market'),
    90,
    HEX_ASSETS
  );
  assert.equal(noWorkerBuild.built, false);
  assert.match(noWorkerBuild.messagePt ?? '', /Sem trabalhadores livres/);

  // Demolish Serraria leaves player-owned free forest
  const dem = demolishInKingdom(state, 1, 1, HEX_ASSETS);
  assert.equal(dem.removed, true);
  assert.equal(dem.nextState.worldState.hexes[hexKey(1, 1)]?.owner, 'player');
  assert.equal(dem.nextState.worldState.hexes[hexKey(1, 1)]?.terrainType, 'forest');
});

test('research progression, turn advance, events, and diplomacy work cleanly', () => {
  let state = createStarterKingdomState(HEX_ASSETS);
  const avail = getAvailableTechs(state.research);
  assert.ok(avail.some((t) => t.id === 'agriculture'));
  assert.ok(avail.some((t) => t.id === 'mining'));

  const sel = setActiveResearchInKingdom(state, 'mining');
  assert.equal(sel.selected, true);
  state = sel.nextState;

  // Build a University on an adjacent plains hex to boost science so mining completes rapidly
  const conq = conquerInKingdom(state, -1, -1, HEX_ASSETS);
  state = conq.nextState;
  const uni = buildInKingdom(
    state,
    -1,
    -1,
    idxOf('building-wizard-tower'),
    90,
    HEX_ASSETS
  );
  assert.equal(uni.built, true);
  state = uni.nextState;

  // Turn 2 & Turn 3: mining completes and turn 3 generates a KingdomEvent
  const t2 = advanceKingdomTurn(state, HEX_ASSETS);
  state = t2.nextState;
  assert.equal(state.turn, 2);

  const t3 = advanceKingdomTurn(state, HEX_ASSETS);
  state = t3.nextState;
  assert.equal(state.turn, 3);
  assert.ok(state.research.unlocked.includes('mining'), 'Mining should unlock by turn 3 with University');
  assert.ok(state.activeEvent !== null, 'Turn 3 must generate a kingdom event');

  // Resolve active event with first choice
  const firstChoice = state.activeEvent!.choices[0].id;
  const resolved = resolveKingdomEvent(state, firstChoice, HEX_ASSETS);
  state = resolved.nextState;
  assert.equal(state.activeEvent, null);
  assert.equal(state.eventHistory.length, 1);

  // Diplomacy with Azure League (initially neutral -> trade_pact gives +$20/turn)
  const pact = performDiplomacyAction(state, 'azure_league', 'trade_pact');
  assert.equal(pact.success, true);
  state = pact.nextState;
  const econWithPact = getKingdomEconomy(state, HEX_ASSETS);
  assert.equal(econWithPact.goldTradePactBonus, 20);
});

test('military recruitment, movement, and combat capture of enemy territory', () => {
  let state = createStarterKingdomState(HEX_ASSETS);
  // Unlock military & metallurgy directly on research state to test unit pipeline end-to-end
  state = {
    ...state,
    research: {
      unlocked: ['mining', 'military', 'metallurgy'],
      activeTechId: 'agriculture',
      progressScience: 0,
    },
  };

  // Recruit a knight at the player castle (0,0)
  const rec = recruitUnitInKingdom(state, 0, 0, 'knight', HEX_ASSETS);
  assert.equal(rec.recruited, true);
  state = rec.nextState;
  assert.equal(state.units.filter((u) => u.owner === 'player').length, 1);

  // Walk knight east toward iron_clan frontier (0,0) -> (1,0) -> (2,0) -> (3,-1) -> (4,-2)
  const step1 = commandUnitInKingdom(state, { q: 0, r: 0 }, { q: 1, r: 0 }, HEX_ASSETS);
  assert.equal(step1.acted, true);
  state = step1.nextState;

  // Trying to move twice on the same turn is blocked
  const doubleMove = commandUnitInKingdom(state, { q: 1, r: 0 }, { q: 2, r: 0 }, HEX_ASSETS);
  assert.equal(doubleMove.acted, false);

  // Advance turns and march to (3, -1)
  state = advanceKingdomTurn(state, HEX_ASSETS).nextState;
  state = commandUnitInKingdom(state, { q: 1, r: 0 }, { q: 2, r: 0 }, HEX_ASSETS).nextState;
  state = advanceKingdomTurn(state, HEX_ASSETS).nextState;
  state = commandUnitInKingdom(state, { q: 2, r: 0 }, { q: 3, r: -1 }, HEX_ASSETS).nextState;
  state = advanceKingdomTurn(state, HEX_ASSETS).nextState;

  // Attack iron_clan garrisoned hex at (4, -2)
  // Note: iron_clan has infantry (def 7 + terrain 0 + tower 8 + garrison 3 = 18), knight has att 14 + metallurgy 4 + base 3 = 21 -> victory!
  const cashBeforeAttack = state.worldState.cash;
  const attack = commandUnitInKingdom(state, { q: 3, r: -1 }, { q: 4, r: -2 }, HEX_ASSETS);
  assert.equal(attack.acted, true);
  assert.equal(attack.capturedKey, hexKey(4, -2));
  assert.equal(attack.nextState.worldState.hexes[hexKey(4, -2)]?.owner, 'player');
  assert.equal(attack.nextState.worldState.cash, cashBeforeAttack + 120);
});

test('serializeKingdomState and deserializeKingdomState round-trip v2 state and support v1 fallback', () => {
  const starter = createStarterKingdomState(HEX_ASSETS);
  const rec = setActiveResearchInKingdom(starter, 'mining').nextState;
  const json = serializeKingdomState(rec);
  const loaded = deserializeKingdomState(json, HEX_ASSETS.length);
  assert.ok(loaded !== null);
  assert.equal(loaded.turn, 1);
  assert.equal(loaded.population, 18);
  assert.equal(loaded.research.activeTechId, 'mining');
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
});
