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
  getKingdomMarket,
  getKingdomProgression,
  performDiplomacyAction,
  recruitUnitInKingdom,
  resolveKingdomEvent,
  serializeKingdomState,
  setActiveResearchInKingdom,
  tradeResourceInKingdom,
} from './kingdom-engine';

function idxOf(name: string): number {
  const idx = HEX_ASSETS.findIndex((a) => a.name === name);
  assert.ok(idx >= 0, `Missing asset ${name}`);
  return idx;
}

test('createStarterKingdomState seeds player core, 2 rival factions with full economy/research, initial units, and balanced economy', () => {
  const state = createStarterKingdomState(HEX_ASSETS);
  assert.equal(state.turn, 1);
  assert.equal(state.population, 18);
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

test('buildInKingdom enforces multi-turn construction queue, tech lock, worker availability, resource costs, and demolish preserves tile', () => {
  let state = createStarterKingdomState(HEX_ASSETS);

  // Conquer (1, 1) forest and (-1, -1) plains adjacent to core
  state = conquerInKingdom(state, 1, 1, HEX_ASSETS).nextState;
  state = conquerInKingdom(state, -1, -1, HEX_ASSETS).nextState;

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

  // Build Serraria on forest (takes 2 turns, deducts gold, wood, stone)
  const woodBefore = state.resources.wood;
  const goldBefore = state.worldState.cash;
  const econBeforeLumber = getKingdomEconomy(state, HEX_ASSETS);
  const lumber = buildInKingdom(state, 1, 1, idxOf('dirt-lumber'), 90, HEX_ASSETS);
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
  const dem = demolishInKingdom(t3.nextState, 1, 1, HEX_ASSETS);
  assert.equal(dem.removed, true);
  assert.equal(dem.nextState.worldState.hexes[hexKey(1, 1)]?.owner, 'player');
  assert.equal(dem.nextState.worldState.hexes[hexKey(1, 1)]?.terrainType, 'forest');
});

test('research progression, multi-turn event effects, trade market, and rival AI growth work cleanly', () => {
  let state = createStarterKingdomState(HEX_ASSETS);
  const avail = getAvailableTechs(state.research);
  assert.ok(avail.some((t) => t.id === 'agriculture'));
  assert.ok(avail.some((t) => t.id === 'mining'));

  state = setActiveResearchInKingdom(state, 'mining').nextState;

  // Build a University (2 turns) on an adjacent plains hex
  state = conquerInKingdom(state, -1, -1, HEX_ASSETS).nextState;
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

  // Check rival AI factions grew their research & territory over 4 turns
  const totalAiTiles =
    countFactionTerritory(state.worldState, 'iron_clan') +
    countFactionTerritory(state.worldState, 'azure_league');
  assert.ok(totalAiTiles >= 10, 'AI factions should expand strategically');

  // Test dynamic Trade Market buy & sell
  const market = getKingdomMarket(state, HEX_ASSETS);
  assert.equal(market.quotes.length, 4);
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

  state = advanceKingdomTurn(state, HEX_ASSETS).nextState;
  state = commandUnitInKingdom(state, { q: 1, r: 0 }, { q: 2, r: 0 }, HEX_ASSETS).nextState;
  state = advanceKingdomTurn(state, HEX_ASSETS).nextState;
  state = commandUnitInKingdom(state, { q: 2, r: 0 }, { q: 3, r: -1 }, HEX_ASSETS).nextState;
  state = advanceKingdomTurn(state, HEX_ASSETS).nextState;

  const cashBeforeAttack = state.worldState.cash;
  const attack = commandUnitInKingdom(state, { q: 3, r: -1 }, { q: 4, r: -2 }, HEX_ASSETS);
  assert.equal(attack.acted, true);
  assert.equal(attack.capturedKey, hexKey(4, -2));
  assert.equal(attack.nextState.worldState.hexes[hexKey(4, -2)]?.owner, 'player');
  assert.equal(attack.nextState.worldState.cash, cashBeforeAttack + 120);
});

test('serializeKingdomState and deserializeKingdomState round-trip v3 constructions/effects and support v1/v2 fallback', () => {
  let starter = createStarterKingdomState(HEX_ASSETS);
  starter = setActiveResearchInKingdom(starter, 'mining').nextState;
  starter = conquerInKingdom(starter, 1, 1, HEX_ASSETS).nextState;
  starter = buildInKingdom(starter, 1, 1, idxOf('dirt-lumber'), 90, HEX_ASSETS).nextState;

  const json = serializeKingdomState(starter);
  const loaded = deserializeKingdomState(json, HEX_ASSETS.length);
  assert.ok(loaded !== null);
  assert.equal(loaded.turn, 1);
  assert.equal(loaded.population, 18);
  assert.equal(loaded.research.activeTechId, 'mining');
  assert.equal(loaded.constructions.length, 1);
  assert.equal(loaded.constructions[0].turnsRemaining, 2);
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
