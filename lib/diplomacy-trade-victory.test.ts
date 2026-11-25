import test from 'node:test';
import assert from 'node:assert/strict';
import { HEX_ASSETS } from './repo-data';
import { hexKey, type HexWorldState, type PlacedHex } from './hex-engine';
import { TECH_TREE, type TechId } from './tech-engine';
import {
  UNIT_CATALOG,
  computeMilitaryIntelligence,
  evaluateFactionLogistics,
  evaluateHexFortification,
  evaluateRouteMilitaryProtection,
  evaluateUnitSupply,
  getReachableUnitCoords,
  type UnitEntity,
} from './military-engine';
import {
  analyzeFactionResourceBalances,
  evaluateTradeInfrastructure,
  quoteBilateralResourcePrices,
} from './interfaction-trade-engine';
import { evaluateVictoryAndDefeat } from './victory-engine';
import {
  advanceKingdomTurn,
  closeTradeRouteInKingdom,
  commandUnitInKingdom,
  createSandboxKingdomState,
  createStarterKingdomState,
  deserializeKingdomState,
  getKingdomDiplomacySummary,
  getKingdomEconomy,
  getKingdomHexFortification,
  getKingdomInterfactionTradeSummary,
  getKingdomMilitaryIntelligence,
  getKingdomMilitaryLogistics,
  getKingdomVictoryProgress,
  openTradeRouteInKingdom,
  performDiplomacyAction,
  repairDamagedHexInKingdom,
  serializeKingdomState,
  tradeWithFactionInKingdom,
  type KingdomState,
} from './kingdom-engine';

function idxOf(name: string): number {
  const idx = HEX_ASSETS.findIndex((a) => a.name === name);
  assert.ok(idx >= 0, `Missing asset ${name}`);
  return idx;
}

function makeTile(
  q: number,
  r: number,
  assetName: string,
  owner: PlacedHex['owner'],
  extra: Partial<PlacedHex> = {}
): PlacedHex {
  return {
    q,
    r,
    structureIndex: idxOf(assetName),
    orientation: 0,
    owner,
    terrainType: 'plains',
    resourceType: 'none',
    ...extra,
  };
}

function buildStarterWithGold(gold = 2500): KingdomState {
  const base = createStarterKingdomState(HEX_ASSETS, 42026);
  return {
    ...base,
    worldState: {
      ...base.worldState,
      cash: gold,
    },
  };
}

test('Diplomacy 2.0 covers all 5 stances, treaties, border friction, and betrayal penalties', () => {
  let state = buildStarterWithGold(3000);

  // Initial states: iron_clan is hostile, azure_league is neutral
  let dipSummary = getKingdomDiplomacySummary(state);
  const ironInit = dipSummary.evaluations.find((e) => e.factionId === 'iron_clan')!;
  const azureInit = dipSummary.evaluations.find((e) => e.factionId === 'azure_league')!;
  assert.equal(ironInit.stance, 'hostile');
  assert.equal(azureInit.stance, 'neutral');

  // Cannot sign alliance immediately from neutral trust (< 35 without treaties)
  const blockedAlliance = performDiplomacyAction(state, 'azure_league', 'alliance');
  assert.equal(blockedAlliance.success, false);

  // Improve azure_league to friendly then allied: trade_pact -> non_aggression -> resource_aid -> alliance
  const pactRes = performDiplomacyAction(state, 'azure_league', 'trade_pact');
  assert.equal(pactRes.success, true);
  state = pactRes.nextState;

  const friendlyEval = getKingdomDiplomacySummary(state).evaluations.find(
    (e) => e.factionId === 'azure_league'
  )!;
  assert.equal(friendlyEval.stance, 'friendly');
  assert.equal(friendlyEval.treaties.tradePact, true);

  const nonAggRes = performDiplomacyAction(state, 'azure_league', 'non_aggression');
  assert.equal(nonAggRes.success, true);
  state = nonAggRes.nextState;

  const aidRes = performDiplomacyAction(state, 'azure_league', 'resource_aid', {
    resource: 'food',
    amount: 20,
  });
  assert.equal(aidRes.success, true);
  state = aidRes.nextState;

  const allianceRes = performDiplomacyAction(state, 'azure_league', 'alliance');
  assert.equal(allianceRes.success, true);
  state = allianceRes.nextState;

  const alliedEval = getKingdomDiplomacySummary(state).evaluations.find(
    (e) => e.factionId === 'azure_league'
  )!;
  assert.equal(alliedEval.stance, 'allied');
  assert.equal(alliedEval.treaties.alliance, true);

  // Turn iron_clan from hostile -> wary via truce, then advance to peace_treaty
  const truceRes = performDiplomacyAction(state, 'iron_clan', 'truce');
  assert.equal(truceRes.success, true);
  state = truceRes.nextState;
  const ironWary = getKingdomDiplomacySummary(state).evaluations.find(
    (e) => e.factionId === 'iron_clan'
  )!;
  assert.equal(ironWary.stance, 'wary');

  // Border friction check: placing player territory near iron_clan capital generates negative border friction
  const nearCapTile = makeTile(
    state.factions.find((f) => f.id === 'iron_clan')!.capitalCoord.q - 1,
    state.factions.find((f) => f.id === 'iron_clan')!.capitalCoord.r,
    'grass',
    'player'
  );
  state = {
    ...state,
    worldState: {
      ...state.worldState,
      hexes: {
        ...state.worldState.hexes,
        [hexKey(nearCapTile.q, nearCapTile.r)]: nearCapTile,
      },
    },
  };
  const borderEval = getKingdomDiplomacySummary(state).evaluations.find(
    (e) => e.factionId === 'iron_clan'
  )!;
  assert.ok(borderEval.borderFrictionScore < 0, 'Expected border expansion near rival capital to add friction');

  // Betrayal check: declaring war against allied azure_league triggers heavy betrayal penalty + lowers iron_clan trust
  const trustBeforeBetrayal = borderEval.trustScore;
  const betrayRes = performDiplomacyAction(state, 'azure_league', 'war');
  assert.equal(betrayRes.success, true);
  assert.match(betrayRes.messagePt, /Aliança quebrada/);
  const afterBetray = getKingdomDiplomacySummary(betrayRes.nextState);
  const azureAfter = afterBetray.evaluations.find((e) => e.factionId === 'azure_league')!;
  const ironAfter = afterBetray.evaluations.find((e) => e.factionId === 'iron_clan')!;
  assert.equal(azureAfter.stance, 'hostile');
  assert.ok(azureAfter.betrayalPenalty <= -35);
  assert.ok(ironAfter.trustScore < trustBeforeBetrayal);

  // Territorial concession restores relations even during hostility
  const concRes = performDiplomacyAction(betrayRes.nextState, 'iron_clan', 'territorial_concession');
  assert.equal(concRes.success, true);
  const ironPostConc = getKingdomDiplomacySummary(concRes.nextState).evaluations.find(
    (e) => e.factionId === 'iron_clan'
  )!;
  assert.ok(ironPostConc.trustScore > ironAfter.trustScore);
  assert.equal(ironPostConc.atWar, false);
});

test('Interfaction Trade analyzes surplus/scarcity, quotes dynamic prices, settles routes, and enforces embargoes/escorts', () => {
  let state = buildStarterWithGold(2400);

  // Add surplus wood (260/380 cap) & scarce ore (8 < threshold) for player vs partner market
  state = {
    ...state,
    resources: { ...state.resources, wood: 260, stone: 95, food: 220, ore: 8, metal: 12 },
  };
  const econ = getKingdomEconomy(state, HEX_ASSETS);
  const { playerProfile, partnerProfilesById } = analyzeFactionResourceBalances({
    worldState: state.worldState,
    assets: HEX_ASSETS,
    playerResources: state.resources,
    playerEconomy: econ,
    factions: state.factions,
  });
  assert.ok(playerProfile.surplusResources.includes('wood'));
  assert.ok(playerProfile.scarceResources.includes('ore'));
  assert.ok(partnerProfilesById.azure_league.balances.metal.supplyState !== undefined);

  // Maritime routes blocked until a port/dock is constructed
  const maritimeBlocked = openTradeRouteInKingdom(
    state,
    {
      partnerFactionId: 'azure_league',
      mode: 'maritime',
      exportResource: 'wood',
      exportAmount: 5,
      importResource: 'ore',
      importAmount: 2,
    },
    HEX_ASSETS
  );
  assert.equal(maritimeBlocked.success, false);
  assert.match(maritimeBlocked.messagePt, /Porto ou Doca/);

  // Compare tariff/prices neutral vs friendly trade pact
  const snapBeforePact = getKingdomInterfactionTradeSummary(state, HEX_ASSETS);
  const azureQuoteNeutral = snapBeforePact.partners.find((p) => p.factionId === 'azure_league')!;
  const ironBlocked = snapBeforePact.partners.find((p) => p.factionId === 'iron_clan')!;
  assert.equal(ironBlocked.tradeAllowed, false);

  state = performDiplomacyAction(state, 'azure_league', 'trade_pact').nextState;
  const snapWithPact = getKingdomInterfactionTradeSummary(state, HEX_ASSETS);
  const azureWithPact = snapWithPact.partners.find((p) => p.factionId === 'azure_league')!;
  assert.ok(azureWithPact.tariffRatePct < azureQuoteNeutral.tariffRatePct);

  const bilateralQuotes = quoteBilateralResourcePrices({
    playerProfile,
    partnerProfile: partnerProfilesById.azure_league,
    faction: state.factions.find((f) => f.id === 'azure_league')!,
    diplomacy: {
      stance: 'friendly',
      hasTradePact: true,
      atWar: false,
      embargoed: false,
      trustScore: 45,
    },
    infrastructure: snapWithPact.infrastructure,
    season: 'winter',
  });
  const springQuotes = quoteBilateralResourcePrices({
    playerProfile,
    partnerProfile: partnerProfilesById.azure_league,
    faction: state.factions.find((f) => f.id === 'azure_league')!,
    diplomacy: {
      stance: 'friendly',
      hasTradePact: true,
      atWar: false,
      embargoed: false,
      trustScore: 45,
    },
    infrastructure: snapWithPact.infrastructure,
    season: 'spring',
  });
  const foodWinter = bilateralQuotes.find((q) => q.resource === 'food')!;
  const foodSpring = springQuotes.find((q) => q.resource === 'food')!;
  assert.ok(foodWinter.importUnitCostGold >= foodSpring.importUnitCostGold);

  // Build operational port on a player coastal hex to unlock maritime trade routes
  const playerHex = Object.values(state.worldState.hexes).find((t) => t.owner === 'player')!;
  state = {
    ...state,
    research: {
      ...state.research,
      unlocked: Array.from(new Set<TechId>([...state.research.unlocked, 'trade', 'construction'])),
    },
    worldState: {
      ...state.worldState,
      hexes: {
        ...state.worldState.hexes,
        [hexKey(playerHex.q, playerHex.r)]: makeTile(
          playerHex.q,
          playerHex.r,
          'building-port',
          'player',
          { level: 2 }
        ),
      },
    },
  };

  const infraCheck = evaluateTradeInfrastructure({
    worldState: state.worldState,
    assets: HEX_ASSETS,
    unlockedTechs: state.research.unlocked,
  });
  assert.equal(infraCheck.hasMaritimeCapability, true);

  // Direct spot trade moves real gold and resources between kingdoms
  const azureWoodBefore = state.factions.find((f) => f.id === 'azure_league')!.resources.wood;
  const playerWoodBefore = state.resources.wood;
  const spotSell = tradeWithFactionInKingdom(
    state,
    { partnerFactionId: 'azure_league', action: 'sell', resource: 'wood', amount: 10 },
    HEX_ASSETS
  );
  assert.equal(spotSell.success, true);
  assert.equal(spotSell.nextState.resources.wood, playerWoodBefore - 10);
  assert.ok(
    spotSell.nextState.factions.find((f) => f.id === 'azure_league')!.resources.wood > azureWoodBefore
  );
  state = spotSell.nextState;

  // Open land trade route and advance turn: transfers real cargo and pays net gold
  const routeRes = openTradeRouteInKingdom(
    state,
    {
      partnerFactionId: 'azure_league',
      mode: 'land',
      exportResource: 'wood',
      exportAmount: 6,
      importResource: 'ore',
      importAmount: 2,
    },
    HEX_ASSETS
  );
  assert.equal(routeRes.success, true);
  assert.ok(routeRes.routeId);
  state = routeRes.nextState;

  const afterTurn = advanceKingdomTurn(state, HEX_ASSETS).nextState;
  const routeAfterTurn = afterTurn.interfactionTrade!.routes.find(
    (r) => r.id === routeRes.routeId
  )!;
  assert.equal(routeAfterTurn.successfulTurns, 1);
  assert.ok(routeAfterTurn.totalValueTradedGold > 0);

  // Declaring war immediately embargoes active trade routes
  const warRes = performDiplomacyAction(afterTurn, 'azure_league', 'war');
  const embargoedRoute = warRes.nextState.interfactionTrade!.routes.find(
    (r) => r.id === routeRes.routeId
  )!;
  assert.equal(embargoedRoute.status, 'embargoed');

  // Closing route cleans up cleanly
  const closeRes = closeTradeRouteInKingdom(warRes.nextState, routeRes.routeId!);
  assert.equal(closeRes.closed, true);
  assert.equal(closeRes.nextState.interfactionTrade!.routes.length, 0);
});

test('Military 2.0 validates supply/logistics attrition, road mobility, fortifications, route protection, and intelligence', () => {
  // Build custom deterministic mini-map so every coordinate and supply hop is exact
  const worldState: HexWorldState = {
    seed: 1,
    worldCols: 12,
    worldRows: 12,
    cash: 1500,
    hexes: {},
  };
  for (let q = -4; q <= 7; q++) {
    for (let r = -3; r <= 3; r++) {
      worldState.hexes[hexKey(q, r)] = makeTile(q, r, 'grass', q <= 2 ? 'player' : 'iron_clan');
    }
  }
  worldState.hexes[hexKey(0, 0)] = makeTile(0, 0, 'building-castle', 'player', {
    modules: ['mil_armory'],
  });
  worldState.hexes[hexKey(1, 0)] = makeTile(1, 0, 'building-tower', 'player', {
    modules: ['mil_beacon'],
  });
  worldState.hexes[hexKey(0, 1)] = makeTile(0, 1, 'unit-wall-tower', 'player');
  worldState.hexes[hexKey(2, 0)] = makeTile(2, 0, 'building-farm', 'player');

  const roadTiles = {
    [hexKey(0, 0)]: { q: 0, r: 0, level: 2 as const, owner: 'player' as const },
    [hexKey(1, 0)]: { q: 1, r: 0, level: 2 as const, owner: 'player' as const },
    [hexKey(2, 0)]: { q: 2, r: 0, level: 2 as const, owner: 'player' as const },
  };

  const knightHome: UnitEntity = {
    id: 'u-knight',
    type: 'knight',
    owner: 'player',
    q: 0,
    r: 0,
    hp: 24,
    maxHp: 24,
    movedThisTurn: false,
  };
  const garrisonArcher: UnitEntity = {
    id: 'u-arch',
    type: 'archer',
    owner: 'player',
    q: 1,
    r: 0,
    hp: 16,
    maxHp: 16,
    movedThisTurn: false,
  };
  const strayedScout: UnitEntity = {
    id: 'u-deep',
    type: 'infantry',
    owner: 'player',
    q: 7,
    r: 0,
    hp: 20,
    maxHp: 20,
    movedThisTurn: false,
  };
  const enemyUnit: UnitEntity = {
    id: 'u-enemy',
    type: 'infantry',
    owner: 'iron_clan',
    q: 3,
    r: 0,
    hp: 20,
    maxHp: 20,
    movedThisTurn: false,
  };

  const units = [knightHome, garrisonArcher, strayedScout, enemyUnit];

  // Knight reach on plains is 2 hexes
  const reachable = getReachableUnitCoords({
    unit: knightHome,
    worldState,
    units,
    assets: HEX_ASSETS,
    unlockedTechs: ['military', 'engineering'],
    roads: roadTiles,
  });
  assert.ok(reachable.some((c) => c.q === 2 && c.r === 0));

  // Supply check: garrison & castle supplied, deep raid at q=7 unsupplied
  const supCastle = evaluateUnitSupply({
    unit: knightHome,
    worldState,
    assets: HEX_ASSETS,
    unlockedTechs: ['military'],
    roads: roadTiles,
    capitalCoord: { q: 0, r: 0 },
  });
  const supDeep = evaluateUnitSupply({
    unit: strayedScout,
    worldState,
    assets: HEX_ASSETS,
    unlockedTechs: ['military'],
    roads: roadTiles,
    capitalCoord: { q: 0, r: 0 },
    foodDeficitTurns: 3,
  });
  assert.equal(supCastle.status, 'supplied');
  assert.equal(supDeep.status, 'unsupplied');
  assert.ok(supDeep.attritionDamagePerTurn > 0);
  assert.ok(supDeep.combatMultiplier < 1.0);

  const armyLog = evaluateFactionLogistics({
    worldState,
    units,
    assets: HEX_ASSETS,
    owner: 'player',
    unlockedTechs: ['military'],
    roads: roadTiles,
    capitalCoord: { q: 0, r: 0 },
  });
  assert.equal(armyLog.totalUnits, 3);
  assert.ok(armyLog.readinessScore < 100);

  // Fortification aura check: castle + tower/wall aura + archer support + armory module
  const castleFort = evaluateHexFortification({
    worldState,
    q: 0,
    r: 0,
    units,
    assets: HEX_ASSETS,
    defenderTechs: ['engineering'],
  });
  assert.equal(castleFort.isFortifiedStructure, true);
  assert.ok(castleFort.moduleDefense >= 4);
  assert.ok(castleFort.neighborBastionAura > 0);
  assert.ok(castleFort.archerSupportBonus >= 2);
  assert.ok(castleFort.totalDefenseScore >= 20);

  // Route protection check along guarded vs unguarded path
  const guardedRoute = evaluateRouteMilitaryProtection({
    worldState,
    units,
    assets: HEX_ASSETS,
    owner: 'player',
    pathCoords: [
      { q: 0, r: 0 },
      { q: 1, r: 0 },
      { q: 2, r: 0 },
    ],
  });
  const unguardedRoute = evaluateRouteMilitaryProtection({
    worldState,
    units,
    assets: HEX_ASSETS,
    owner: 'player',
    pathCoords: [
      { q: 5, r: 3 },
      { q: 6, r: 3 },
    ],
  });
  assert.ok(guardedRoute.protectionScore > unguardedRoute.protectionScore);
  assert.ok(guardedRoute.protectionScore >= 75);

  // Military intelligence exposes border vulnerability & scout sight bonus
  const factions = createSandboxKingdomState().factions;
  const intel = computeMilitaryIntelligence({
    worldState,
    units,
    assets: HEX_ASSETS,
    playerTechs: ['trade', 'military'],
    factions,
    diplomacyRelations: { iron_clan: 'hostile', azure_league: 'neutral' },
  });
  assert.ok(intel.iron_clan.scoutPrecisionPct >= 60);
  assert.ok(intel.iron_clan.borderExposureCount >= 1);
  assert.ok(['alto', 'critico'].includes(intel.iron_clan.threatLevel));
});

test('Conflict consequences damage hexes, cut economy proportionally, pay reparations, and recover cleanly upon repair', () => {
  let state = buildStarterWithGold(3000);
  const enemyTarget = Object.values(state.worldState.hexes).find(
    (t) => t.owner === 'iron_clan' && t.terrainType !== 'water'
  )!;

  // Position a healthy player knight adjacent to enemy target tile with a valuable building
  const adjCoord = { q: enemyTarget.q - 1, r: enemyTarget.r };
  const attackHexKey = hexKey(enemyTarget.q, enemyTarget.r);
  const attacker: UnitEntity = {
    id: 'u-test-att',
    type: 'knight',
    owner: 'player',
    q: adjCoord.q,
    r: adjCoord.r,
    hp: UNIT_CATALOG.knight.maxHp,
    maxHp: UNIT_CATALOG.knight.maxHp,
    movedThisTurn: false,
  };
  state = {
    ...state,
    research: {
      ...state.research,
      unlocked: ['agriculture', 'mining', 'metallurgy', 'military'],
    },
    worldState: {
      ...state.worldState,
      hexes: {
        ...state.worldState.hexes,
        [hexKey(adjCoord.q, adjCoord.r)]: makeTile(adjCoord.q, adjCoord.r, 'grass', 'player'),
        [attackHexKey]: makeTile(enemyTarget.q, enemyTarget.r, 'building-farm', 'iron_clan'),
      },
    },
    units: [...state.units.filter((u) => !(u.q === enemyTarget.q && u.r === enemyTarget.r)), attacker],
  };

  // Combat resolves: damages tile proportionally and sets damagedHexes record
  const cmdRes = commandUnitInKingdom(state, adjCoord, enemyTarget, HEX_ASSETS);
  assert.equal(cmdRes.acted, true);
  state = cmdRes.nextState;
  const dmgRecord = state.damagedHexes?.[attackHexKey];
  assert.ok(dmgRecord, 'Expected conflict damage record on fought tile');
  assert.ok(dmgRecord.damagePct > 0);
  assert.ok(dmgRecord.productionPenaltyPct > 0);

  if (cmdRes.capturedKey) {
    // Damaged farm yields penalized output in economy breakdown and fort defense drops
    const econDamaged = getKingdomEconomy(state, HEX_ASSETS);
    const farmReportDamaged = econDamaged.buildingsByKey[attackHexKey];
    const fortDamaged = getKingdomHexFortification(state, enemyTarget.q, enemyTarget.r, HEX_ASSETS);
    assert.ok(fortDamaged.damagePenalty > 0);
    if (farmReportDamaged) {
      assert.match(farmReportDamaged.reasonPt ?? '', /danificado por conflito/);
    }

    // Repair restores tile and clears penalty
    const repRes = repairDamagedHexInKingdom(state, enemyTarget.q, enemyTarget.r);
    assert.equal(repRes.repaired, true);
    state = repRes.nextState;
    assert.equal(state.damagedHexes?.[attackHexKey], undefined);
    const fortRepaired = getKingdomHexFortification(state, enemyTarget.q, enemyTarget.r, HEX_ASSETS);
    assert.equal(fortRepaired.damagePenalty, 0);
  }

  // Test reparations upon favorable peace_treaty (give player clear power advantage first)
  const fortifiedWorld = { ...state.worldState, hexes: { ...state.worldState.hexes } };
  const extraUnits: UnitEntity[] = [...state.units];
  for (let i = 0; i < 6; i++) {
    const c = { q: 0, r: 10 + i };
    fortifiedWorld.hexes[hexKey(c.q, c.r)] = makeTile(c.q, c.r, 'grass', 'player');
    extraUnits.push({
      id: `u-dom-${i}`,
      type: 'knight',
      owner: 'player',
      q: c.q,
      r: c.r,
      hp: 24,
      maxHp: 24,
      movedThisTurn: false,
    });
  }
  state = { ...state, worldState: fortifiedWorld, units: extraUnits };
  const peaceRes = performDiplomacyAction(state, 'iron_clan', 'peace_treaty');
  assert.equal(peaceRes.success, true);
  assert.match(peaceRes.messagePt, /Reparações/);
  const cashBeforeRep = peaceRes.nextState.worldState.cash;
  const ironCashBefore = peaceRes.nextState.factions.find((f) => f.id === 'iron_clan')!.cash;
  const afterRepTurn = advanceKingdomTurn(peaceRes.nextState, HEX_ASSETS).nextState;
  const ironCashAfter = afterRepTurn.factions.find((f) => f.id === 'iron_clan')!.cash;
  assert.ok(ironCashAfter <= ironCashBefore + 60); // paid reparations out of cash/turn balance
  assert.ok(afterRepTurn.worldState.cash >= cashBeforeRep - 100);

  // Verify intelligence & logistics wrappers respond properly on full KingdomState
  assert.ok(getKingdomMilitaryLogistics(afterRepTurn, HEX_ASSETS).totalUnits >= 1);
  assert.ok(getKingdomMilitaryIntelligence(afterRepTurn, HEX_ASSETS).iron_clan);
});

test('Victory Engine evaluates all 6 objective victory paths and 3 fair defeat conditions', () => {
  // 1. Starter game starts ongoing with trackable progress < 100%
  const starter = createStarterKingdomState(HEX_ASSETS, 42026);
  const startVictory = getKingdomVictoryProgress(starter, HEX_ASSETS);
  assert.equal(startVictory.status, 'ongoing');
  assert.equal(startVictory.paths.length, 6);
  assert.ok(startVictory.paths.every((p) => p.progressPct >= 0 && p.progressPct < 100));

  // Helper to fabricate a clean mock world for victory path checks
  const makeVictoryState = (): KingdomState => {
    const base = createStarterKingdomState(HEX_ASSETS, 42026);
    const cleanHexes: Record<string, PlacedHex> = {};
    cleanHexes[hexKey(0, 0)] = makeTile(0, 0, 'building-castle', 'player', { level: 3 });
    cleanHexes[hexKey(10, 0)] = makeTile(10, 0, 'building-castle', 'iron_clan');
    cleanHexes[hexKey(-10, 0)] = makeTile(-10, 0, 'building-castle', 'azure_league');
    return {
      ...base,
      playerCapital: { q: 0, r: 0 },
      worldState: {
        ...base.worldState,
        worldCols: 32,
        worldRows: 32,
        cash: 1500,
        hexes: cleanHexes,
      },
      units: [],
      cities: [
        {
          id: 'c1',
          name: 'Capital',
          center: { q: 0, r: 0 },
          owner: 'player',
          foundedTurn: 1,
          level: 2,
          stageLabelPt: 'Aldeia',
          developmentScore: 30,
          nextLevelScore: 42,
          localPopulation: 15,
          population: 15,
          housingCapacity: 25,
          growthPerTurn: 1,
          availableWorkers: 10,
          workersRequired: 5,
          workersAssigned: 5,
          urbanQualityScore: 2,
          specializations: [],
          districts: [],
          connectedCityIds: [],
          networkId: null,
          stabilityLabelPt: 'Estável',
          growthBonusPct: 0,
        },
      ],
    };
  };

  // A. Territorial Victory
  const terrState = makeVictoryState();
  for (let i = 1; i <= 30; i++) {
    terrState.worldState.hexes[hexKey(i % 6, Math.floor(i / 6) + 1)] = makeTile(
      i % 6,
      Math.floor(i / 6) + 1,
      'grass',
      'player'
    );
  }
  terrState.cities = [
    ...terrState.cities,
    { ...terrState.cities[0], id: 'c2', center: { q: 2, r: 2 } },
    { ...terrState.cities[0], id: 'c3', center: { q: 4, r: 3 } },
  ];
  const terrSnap = getKingdomVictoryProgress(terrState, HEX_ASSETS);
  assert.equal(terrSnap.status, 'victory');
  assert.equal(terrSnap.achievedVictoryId, 'territorial');

  // B. Technological Victory
  const techState = makeVictoryState();
  techState.research.unlocked = TECH_TREE.map((t) => t.id);
  techState.worldState.hexes[hexKey(0, 1)] = makeTile(0, 1, 'building-wizard-tower', 'player', {
    level: 2,
  });
  const techEcon = {
    ...getKingdomEconomy(techState, HEX_ASSETS),
    scienceNet: 30,
  };
  const techSnap = evaluateVictoryAndDefeat({
    turn: 10,
    worldState: techState.worldState,
    assets: HEX_ASSETS,
    playerCapital: techState.playerCapital,
    gold: techState.worldState.cash,
    resources: techState.resources,
    population: 25,
    foodDeficitTurns: 0,
    unlockedTechs: techState.research.unlocked,
    units: [],
    factions: techState.factions,
    cities: techState.cities,
    economy: techEcon,
  });
  assert.equal(techSnap.status, 'victory');
  assert.equal(techSnap.achievedVictoryId, 'technological');

  // C. Economic Victory
  const econState = makeVictoryState();
  econState.research.unlocked = ['trade'];
  econState.worldState.cash = 4500;
  econState.worldState.hexes[hexKey(1, 0)] = makeTile(1, 0, 'building-market', 'player');
  econState.worldState.hexes[hexKey(0, 1)] = makeTile(0, 1, 'building-port', 'player');
  econState.interfactionTrade = {
    routes: [
      {
        id: 'r1',
        partnerFactionId: 'azure_league',
        mode: 'land',
        status: 'active',
        exportResource: 'wood',
        exportAmount: 5,
        importResource: null,
        importAmount: 0,
        establishedTurn: 1,
        disruptedTurnsRemaining: 0,
        pathCoords: [{ q: 0, r: 0 }],
        connectivityScore: 80,
        securityScore: 80,
        tariffRatePct: 5,
        totalValueTradedGold: 900,
        successfulTurns: 5,
        interruptionReasonPt: null,
      },
      {
        id: 'r2',
        partnerFactionId: 'azure_league',
        mode: 'maritime',
        status: 'active',
        exportResource: 'food',
        exportAmount: 4,
        importResource: null,
        importAmount: 0,
        establishedTurn: 1,
        disruptedTurnsRemaining: 0,
        pathCoords: [{ q: 0, r: 0 }],
        connectivityScore: 85,
        securityScore: 85,
        tariffRatePct: 4,
        totalValueTradedGold: 900,
        successfulTurns: 5,
        interruptionReasonPt: null,
      },
    ],
    nextRouteSeq: 3,
    totalExportGoldAllTime: 1800,
    totalImportSpendAllTime: 0,
    totalTariffGoldAllTime: 90,
    lastTurnNetGold: 150,
    lastTurnSummaryPt: null,
  };
  const econBreakdown = {
    ...getKingdomEconomy(econState, HEX_ASSETS),
    goldNet: 150,
  };
  const econSnap = evaluateVictoryAndDefeat({
    turn: 15,
    worldState: econState.worldState,
    assets: HEX_ASSETS,
    playerCapital: econState.playerCapital,
    gold: econState.worldState.cash,
    resources: econState.resources,
    population: 25,
    foodDeficitTurns: 0,
    unlockedTechs: econState.research.unlocked,
    units: [],
    factions: econState.factions,
    cities: econState.cities,
    economy: econBreakdown,
    tradeState: econState.interfactionTrade,
  });
  assert.equal(econSnap.status, 'victory');
  assert.equal(econSnap.achievedVictoryId, 'economic');

  // D. Urban Victory
  const urbState = makeVictoryState();
  urbState.population = 65;
  urbState.cities = [
    {
      ...urbState.cities[0],
      id: 'u1',
      level: 4,
      urbanQualityScore: 7,
      connectedCityIds: ['u2'],
    },
    {
      ...urbState.cities[0],
      id: 'u2',
      center: { q: 2, r: 0 },
      level: 3,
      urbanQualityScore: 4,
      connectedCityIds: ['u1'],
    },
    {
      ...urbState.cities[0],
      id: 'u3',
      center: { q: 4, r: 0 },
      level: 2,
      urbanQualityScore: 2,
    },
  ];
  const urbEcon = getKingdomEconomy(urbState, HEX_ASSETS);
  const urbSnap = evaluateVictoryAndDefeat({
    turn: 20,
    worldState: urbState.worldState,
    assets: HEX_ASSETS,
    playerCapital: urbState.playerCapital,
    gold: urbState.worldState.cash,
    resources: urbState.resources,
    population: urbState.population,
    foodDeficitTurns: 0,
    unlockedTechs: urbState.research.unlocked,
    units: [],
    factions: urbState.factions,
    cities: urbState.cities,
    economy: {
      ...urbEcon,
      roadConnectivity: {
        ...urbEcon.roadConnectivity,
        networks: [
          {
            id: 'net1',
            hexKeys: ['0,0', '1,0', '2,0'],
            connectedCityIds: ['u1', 'u2'],
            avgLevel: 2,
            maxLevel: 2,
            length: 3,
            tradeGoldBonus: 12,
            efficiencyBonusPct: 10,
          },
        ],
      },
    },
  });
  assert.equal(urbSnap.status, 'victory');
  assert.equal(urbSnap.achievedVictoryId, 'urban');

  // E. Diplomatic Victory
  const dipState = makeVictoryState();
  const dipSnap = evaluateVictoryAndDefeat({
    turn: 18,
    worldState: dipState.worldState,
    assets: HEX_ASSETS,
    playerCapital: dipState.playerCapital,
    gold: dipState.worldState.cash,
    resources: dipState.resources,
    population: 25,
    foodDeficitTurns: 0,
    unlockedTechs: dipState.research.unlocked,
    units: [],
    factions: dipState.factions,
    cities: dipState.cities,
    diplomacySnapshots: [
      {
        factionId: 'iron_clan',
        stance: 'friendly',
        trustScore: 70,
        atWar: false,
        hasTradePact: true,
        hasNonAggression: true,
        hasAlliance: false,
      },
      {
        factionId: 'azure_league',
        stance: 'allied',
        trustScore: 80,
        atWar: false,
        hasTradePact: true,
        hasNonAggression: true,
        hasAlliance: true,
      },
    ],
  });
  assert.equal(dipSnap.status, 'victory');
  assert.equal(dipSnap.achievedVictoryId, 'diplomatic');

  // F. Military Victory
  const milState = makeVictoryState();
  // Capture both rival capitals + field 4 well-supplied troops near own capital
  milState.worldState.hexes[hexKey(10, 0)] = makeTile(10, 0, 'building-castle', 'player');
  milState.worldState.hexes[hexKey(-10, 0)] = makeTile(-10, 0, 'building-castle', 'player');
  milState.worldState.hexes[hexKey(1, 0)] = makeTile(1, 0, 'grass', 'player');
  milState.worldState.hexes[hexKey(0, 1)] = makeTile(0, 1, 'grass', 'player');
  milState.worldState.hexes[hexKey(-1, 0)] = makeTile(-1, 0, 'grass', 'player');
  milState.worldState.hexes[hexKey(0, -1)] = makeTile(0, -1, 'grass', 'player');
  milState.units = [
    { id: 'm1', type: 'knight', owner: 'player', q: 1, r: 0, hp: 24, maxHp: 24, movedThisTurn: false },
    { id: 'm2', type: 'knight', owner: 'player', q: 0, r: 1, hp: 24, maxHp: 24, movedThisTurn: false },
    { id: 'm3', type: 'infantry', owner: 'player', q: -1, r: 0, hp: 20, maxHp: 20, movedThisTurn: false },
    { id: 'm4', type: 'archer', owner: 'player', q: 0, r: -1, hp: 16, maxHp: 16, movedThisTurn: false },
  ];
  const milSnap = evaluateVictoryAndDefeat({
    turn: 22,
    worldState: milState.worldState,
    assets: HEX_ASSETS,
    playerCapital: milState.playerCapital,
    gold: milState.worldState.cash,
    resources: milState.resources,
    population: 25,
    foodDeficitTurns: 0,
    unlockedTechs: ['military', 'metallurgy'],
    units: milState.units,
    factions: milState.factions,
    cities: milState.cities,
    persistedState: {
      status: 'ongoing',
      achievedVictoryId: null,
      defeatReason: null,
      resolvedTurn: null,
      headlinePt: null,
      trackedRivalCapitals: {
        iron_clan: { q: 10, r: 0 },
        azure_league: { q: -10, r: 0 },
      },
      capitalLostStreak: 0,
      economicCollapseStreak: 0,
      acknowledgedEndState: false,
    },
  });
  assert.equal(milSnap.status, 'victory');
  assert.equal(milSnap.achievedVictoryId, 'military');

  // Defeat 1: Unfair instant defeat is avoided — 1 turn of capital loss gives a warning
  const capWarnState = makeVictoryState();
  capWarnState.worldState.hexes[hexKey(1, 0)] = makeTile(1, 0, 'building-village', 'player');
  capWarnState.worldState.hexes[hexKey(0, 0)] = makeTile(0, 0, 'building-castle', 'iron_clan');
  const warn1 = evaluateVictoryAndDefeat({
    turn: 8,
    worldState: capWarnState.worldState,
    assets: HEX_ASSETS,
    playerCapital: { q: 0, r: 0 },
    gold: 200,
    resources: capWarnState.resources,
    population: 12,
    foodDeficitTurns: 0,
    unlockedTechs: [],
    units: [],
    factions: capWarnState.factions,
    cities: capWarnState.cities,
    advanceStreaks: true,
  });
  assert.equal(warn1.status, 'ongoing');
  assert.ok(warn1.activeWarningsPt.length > 0);

  // Defeat 2: Sustained loss of capital triggers defeat
  const capLoss2 = evaluateVictoryAndDefeat({
    turn: 9,
    worldState: capWarnState.worldState,
    assets: HEX_ASSETS,
    playerCapital: { q: 0, r: 0 },
    gold: 200,
    resources: capWarnState.resources,
    population: 12,
    foodDeficitTurns: 0,
    unlockedTechs: [],
    units: [],
    factions: capWarnState.factions,
    cities: capWarnState.cities,
    persistedState: warn1.persisted,
    advanceStreaks: true,
  });
  assert.equal(capLoss2.status, 'defeat');
  assert.equal(capLoss2.defeatReason, 'capital_lost');

  // Defeat 3: Structural economic & famine collapse only triggers after multi-turn warning window
  const collapseState = makeVictoryState();
  collapseState.resources.food = 0;
  const negEcon = { ...getKingdomEconomy(collapseState, HEX_ASSETS), goldNet: -40 };
  let collapsePersisted = collapseState.victoryState;
  for (let t = 1; t <= 2; t++) {
    const step = evaluateVictoryAndDefeat({
      turn: t,
      worldState: { ...collapseState.worldState, cash: 0 },
      assets: HEX_ASSETS,
      playerCapital: collapseState.playerCapital,
      gold: 0,
      resources: collapseState.resources,
      population: 10,
      foodDeficitTurns: 5,
      unlockedTechs: [],
      units: [],
      factions: collapseState.factions,
      cities: collapseState.cities,
      economy: negEcon,
      persistedState: collapsePersisted,
      advanceStreaks: true,
    });
    assert.equal(step.status, 'ongoing');
    assert.ok(step.activeWarningsPt.length > 0);
    collapsePersisted = step.persisted;
  }
  const finalCollapse = evaluateVictoryAndDefeat({
    turn: 3,
    worldState: { ...collapseState.worldState, cash: 0 },
    assets: HEX_ASSETS,
    playerCapital: collapseState.playerCapital,
    gold: 0,
    resources: collapseState.resources,
    population: 10,
    foodDeficitTurns: 5,
    unlockedTechs: [],
    units: [],
    factions: collapseState.factions,
    cities: collapseState.cities,
    economy: negEcon,
    persistedState: collapsePersisted,
    advanceStreaks: true,
  });
  assert.equal(finalCollapse.status, 'defeat');
  assert.equal(finalCollapse.defeatReason, 'total_collapse');

  // Defeat 4: Conquered when 0 territories remain
  const zeroTerrWorld = { ...makeVictoryState().worldState, hexes: {} };
  const conqSnap = evaluateVictoryAndDefeat({
    turn: 5,
    worldState: zeroTerrWorld,
    assets: HEX_ASSETS,
    playerCapital: { q: 0, r: 0 },
    gold: 0,
    resources: makeVictoryState().resources,
    population: 8,
    foodDeficitTurns: 0,
    unlockedTechs: [],
    units: [],
    factions: [],
    cities: [],
  });
  assert.equal(conqSnap.status, 'defeat');
  assert.equal(conqSnap.defeatReason, 'conquered');
});

test('Serialization v10 round-trip preserves diplomacy treaties, trade routes, conflict damages, and victory progress', () => {
  let state = buildStarterWithGold(2500);
  state = performDiplomacyAction(state, 'azure_league', 'trade_pact').nextState;
  state = performDiplomacyAction(state, 'azure_league', 'non_aggression').nextState;

  const routeOpen = openTradeRouteInKingdom(
    state,
    {
      partnerFactionId: 'azure_league',
      mode: 'land',
      exportResource: 'wood',
      exportAmount: 4,
      importResource: 'ore',
      importAmount: 2,
    },
    HEX_ASSETS
  );
  assert.equal(routeOpen.success, true);
  state = routeOpen.nextState;

  const dmgKey = hexKey(0, 0);
  state = {
    ...state,
    damagedHexes: {
      [dmgKey]: {
        key: dmgKey,
        q: 0,
        r: 0,
        damagePct: 24,
        productionPenaltyPct: 24,
        defensePenalty: 3,
        turnsRemaining: 3,
        repairCost: { gold: 40, wood: 10, stone: 10, food: 0, ore: 0, metal: 0 },
        reasonPt: 'Cerco na fronteira.',
        lastConflictTurn: 1,
      },
    },
  };

  const json = serializeKingdomState(state);
  const parsedRaw = JSON.parse(json) as { version: number };
  assert.equal(parsedRaw.version, 10);

  const restored = deserializeKingdomState(json, HEX_ASSETS.length)!;
  assert.ok(restored);
  assert.equal(restored.diplomacyByFactionId!.azure_league.treaties.tradePact, true);
  assert.equal(restored.diplomacyByFactionId!.azure_league.treaties.nonAggressionTurns, 8);
  assert.equal(restored.interfactionTrade!.routes.length, 1);
  assert.equal(restored.interfactionTrade!.routes[0].exportResource, 'wood');
  assert.equal(restored.damagedHexes![dmgKey].damagePct, 24);
  assert.equal(restored.victoryState!.status, 'ongoing');
});
