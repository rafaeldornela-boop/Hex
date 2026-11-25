import test from 'node:test';
import assert from 'node:assert/strict';
import { HEX_ASSETS } from './repo-data';
import { hexKey, type AxialCoord } from './hex-engine';
import {
  advanceKingdomTurn,
  buildInKingdom,
  buildOrUpgradeRoadInKingdom,
  createStarterKingdomState,
  demolishInKingdom,
  demolishRoadInKingdom,
  deserializeKingdomState,
  getKingdomEconomy,
  getKingdomMarket,
  getKingdomTerritoryCapacity,
  serializeKingdomState,
  type KingdomState,
} from './kingdom-engine';
import { computeBuildingLogistics } from './logistics-engine';
import { AXIAL_DIRECTIONS, axialDistance, computeHexInfluence } from './territory-engine';

function idxOf(name: string): number {
  const idx = HEX_ASSETS.findIndex((a) => a.name === name);
  assert.ok(idx >= 0, `Missing asset ${name}`);
  return idx;
}

function getFreeOwnedLandCoord(state: KingdomState): AxialCoord {
  const cap = state.playerCapital ?? { q: 0, r: 0 };
  for (const dir of AXIAL_DIRECTIONS) {
    const c = { q: cap.q + dir.q, r: cap.r + dir.r };
    const tile = state.worldState.hexes[hexKey(c.q, c.r)];
    if (
      tile &&
      tile.owner === 'player' &&
      tile.terrainType !== 'water' &&
      HEX_ASSETS[tile.structureIndex]?.name.startsWith('grass')
    ) {
      return c;
    }
  }
  const anyFree = Object.values(state.worldState.hexes).find(
    (t) => t.owner === 'player' && t.terrainType !== 'water'
  );
  assert.ok(anyFree, 'Expected player land tile');
  return { q: anyFree.q, r: anyFree.r };
}

test('roads can be built on owned free land AND existing buildings without breaking 1-building rule, enforce tech gates, and block neutral/water tiles', () => {
  let state = createStarterKingdomState(HEX_ASSETS);
  const cap = state.playerCapital!;
  const freeLand = getFreeOwnedLandCoord(state);

  // Neutral hex is blocked with zero gold deduction
  const neutralTile = Object.values(state.worldState.hexes).find((t) => t.owner === 'neutral')!;
  const cashBefore = state.worldState.cash;
  const neutralRoad = buildOrUpgradeRoadInKingdom(state, neutralTile.q, neutralTile.r, HEX_ASSETS);
  assert.equal(neutralRoad.built, false);
  assert.equal(neutralRoad.nextState.worldState.cash, cashBefore);
  assert.match(neutralRoad.messagePt ?? '', /Conquiste este território/);

  // Water hex without bridge is blocked
  const waterTile = Object.values(state.worldState.hexes).find((t) => t.terrainType === 'water')!;
  const waterOwnedState: KingdomState = {
    ...state,
    worldState: {
      ...state.worldState,
      hexes: {
        ...state.worldState.hexes,
        [hexKey(waterTile.q, waterTile.r)]: { ...waterTile, owner: 'player' },
      },
    },
  };
  const waterRoad = buildOrUpgradeRoadInKingdom(waterOwnedState, waterTile.q, waterTile.r, HEX_ASSETS);
  assert.equal(waterRoad.built, false);
  assert.match(waterRoad.messagePt ?? '', /Ponte concluída/);

  // Build Trilha (Lv1) directly on top of capital Castle (existing building) AND on free land
  const capRoad1 = buildOrUpgradeRoadInKingdom(state, cap.q, cap.r, HEX_ASSETS);
  assert.equal(capRoad1.built, true);
  assert.equal(capRoad1.targetLevel, 1);
  state = capRoad1.nextState;

  const landRoad1 = buildOrUpgradeRoadInKingdom(state, freeLand.q, freeLand.r, HEX_ASSETS);
  assert.equal(landRoad1.built, true);
  assert.equal(landRoad1.targetLevel, 1);
  state = landRoad1.nextState;

  // Building a House on top of the freeLand hex with a road is ALLOWED (road is separate layer!)
  const houseBuild = buildInKingdom(state, freeLand.q, freeLand.r, idxOf('building-house'), 90, HEX_ASSETS);
  assert.equal(houseBuild.built, true);
  state = houseBuild.nextState;

  // Attempting a 2nd building on the same hex is STILL blocked!
  const secondBuilding = buildInKingdom(state, freeLand.q, freeLand.r, idxOf('building-market'), 90, HEX_ASSETS);
  assert.equal(secondBuilding.built, false);
  assert.match(secondBuilding.messagePt ?? '', /já possui uma construção/);

  // Upgrade road Lv1 -> Lv2 (Estrada de Terra) increases road upkeep
  const road2 = buildOrUpgradeRoadInKingdom(state, freeLand.q, freeLand.r, HEX_ASSETS);
  assert.equal(road2.built, true);
  assert.equal(road2.targetLevel, 2);
  assert.equal(road2.isUpgrade, true);
  state = road2.nextState;

  const econLv2 = getKingdomEconomy(state, HEX_ASSETS);
  assert.equal(econLv2.roadMaintenanceGold, 1);

  // Lv2 -> Lv3 (Estrada Pavimentada) blocked without 'construction' tech
  const road3Blocked = buildOrUpgradeRoadInKingdom(state, freeLand.q, freeLand.r, HEX_ASSETS);
  assert.equal(road3Blocked.built, false);
  assert.match(road3Blocked.messagePt ?? '', /Construção/);

  // Demolish House preserves the road underneath on land
  const dem = demolishInKingdom(state, freeLand.q, freeLand.r, HEX_ASSETS);
  assert.equal(dem.removed, true);
  assert.equal(dem.nextState.roads[hexKey(freeLand.q, freeLand.r)]?.level, 2);

  // Demolish road cleanly
  const demRoad = demolishRoadInKingdom(dem.nextState, freeLand.q, freeLand.r, HEX_ASSETS);
  assert.equal(demRoad.removed, true);
  assert.equal(demRoad.nextState.roads[hexKey(freeLand.q, freeLand.r)], undefined);
});

test('multi-city founding, city-to-city road network, trade gold, districts, logistics penalty, and road reach all connect', () => {
  let state = createStarterKingdomState(HEX_ASSETS, 777123);
  const cap = state.playerCapital!;
  assert.equal(state.cities.length, 1);
  assert.equal(state.cities[0].center.q, cap.q);
  assert.equal(state.cities[0].center.r, cap.r);

  // Unlock tech needed for roads Lv3-5 and Castle/Village/Market
  state = {
    ...state,
    worldState: { ...state.worldState, cash: 5000 },
    resources: { wood: 250, stone: 250, food: 250, ore: 150, metal: 100, science: 0 },
    population: 34,
    research: {
      unlocked: ['agriculture', 'mining', 'construction', 'trade', 'engineering', 'military'],
      activeTechId: null,
      progressScience: 0,
    },
  };

  // Own a corridor of 4 hexes east from capital: (cap.q + 1..4, cap.r)
  const corridorCoords: AxialCoord[] = [1, 2, 3, 4].map((step) => ({
    q: cap.q + step,
    r: cap.r,
  }));
  const updatedHexes = { ...state.worldState.hexes };
  corridorCoords.forEach((c, idx) => {
    const k = hexKey(c.q, c.r);
    const isFarmHex = idx === 3;
    updatedHexes[k] = {
      ...updatedHexes[k],
      owner: 'player',
      terrainType: isFarmHex ? 'fertile' : 'plains',
      resourceType: 'food',
      structureIndex: idxOf(isFarmHex ? 'grass-forest' : 'grass'),
    };
  });
  state = {
    ...state,
    worldState: { ...state.worldState, hexes: updatedHexes },
  };

  // Build an isolated Serraria/Mina/Farm at dist = 4 BEFORE any road is built -> verify logistics penalty!
  const remoteCoord = corridorCoords[3]; // dist 4 from capital
  const remoteFarm = buildInKingdom(state, remoteCoord.q, remoteCoord.r, idxOf('building-farm'), 90, HEX_ASSETS);
  assert.equal(remoteFarm.built, true);
  state = remoteFarm.nextState;

  // Complete farm construction (1 turn) and found a 2nd city (Vila) at dist = 3
  const villageCoord = corridorCoords[2]; // dist 3 from capital
  const remoteLogIsolated = computeBuildingLogistics({
    q: remoteCoord.q,
    r: remoteCoord.r,
    cityCenters: state.cities.map((c) => c.center),
    roads: state.roads,
  });
  assert.ok(remoteLogIsolated.factor < 0.85, `Expected isolation penalty < 0.85, got ${remoteLogIsolated.factor}`);
  assert.equal(remoteLogIsolated.status, 'isolated');

  const villageBuild = buildInKingdom(state, villageCoord.q, villageCoord.r, idxOf('building-village'), 90, HEX_ASSETS);
  assert.equal(villageBuild.built, true);
  state = villageBuild.nextState;

  // Advance turns until Vila completes (3 turns)
  state = advanceKingdomTurn(state, HEX_ASSETS).nextState;
  state = advanceKingdomTurn(state, HEX_ASSETS).nextState;
  const t4 = advanceKingdomTurn(state, HEX_ASSETS);
  state = t4.nextState;

  assert.equal(state.cities.length, 2, 'Completing Vila at dist >= 3 should automatically found a 2nd city');
  assert.notEqual(state.cities[0].name, state.cities[1].name);
  assert.ok(t4.foundedCities.length === 1);

  // Connect capital <-> city 2 with roads Lv1..Lv3 along corridorCoords[0..2]
  const econBeforeNet = getKingdomEconomy(state, HEX_ASSETS);
  const marketBeforeNet = getKingdomMarket(state, HEX_ASSETS);

  for (const stepCoord of [cap, corridorCoords[0], corridorCoords[1], villageCoord, remoteCoord]) {
    state = buildOrUpgradeRoadInKingdom(state, stepCoord.q, stepCoord.r, HEX_ASSETS).nextState; // Lv1
    state = buildOrUpgradeRoadInKingdom(state, stepCoord.q, stepCoord.r, HEX_ASSETS).nextState; // Lv2
    state = buildOrUpgradeRoadInKingdom(state, stepCoord.q, stepCoord.r, HEX_ASSETS).nextState; // Lv3
  }

  const econAfterNet = getKingdomEconomy(state, HEX_ASSETS);
  const marketAfterNet = getKingdomMarket(state, HEX_ASSETS);

  assert.ok(econAfterNet.networkTradeGold > econBeforeNet.networkTradeGold, 'Connected cities must generate network trade gold');
  assert.ok(econAfterNet.corridorTradeGold > 0, 'Connected cities must form a trade corridor');
  assert.ok(marketAfterNet.connectedCitiesCount >= 2);
  assert.ok(marketAfterNet.tradeBonusPercent >= marketBeforeNet.tradeBonusPercent);

  // Verify road-extended administrative reach & influence at remote end of corridor
  const capSummary = getKingdomTerritoryCapacity(state, HEX_ASSETS);
  assert.ok(capSummary.maxAnchorReach >= 3, 'Paved road Lv3+ must extend maxAnchorReach');
  assert.ok(capSummary.roadBonus >= 2, 'Connected 2-city network must add territorial capacity');
  assert.ok(
    capSummary.anchorCoords.some((a) => a.q === remoteCoord.q && a.r === remoteCoord.r),
    'Connected roads must extend anchorCoords'
  );

  // Check logistics at remoteCoord is now >= 1.10 (optimal/connected instead of isolated!)
  const remoteReport = econAfterNet.buildingsByKey[hexKey(remoteCoord.q, remoteCoord.r)];
  assert.ok(remoteReport);
  assert.ok(remoteReport.logisticsEfficiencyPct >= 110);
  assert.equal(remoteReport.hasRoad, true);
  assert.equal(remoteReport.roadLevel, 3);

  // Verify road influence boosts neighboring neutral hex score
  const beyondRemote = { q: remoteCoord.q + 1, r: remoteCoord.r };
  const infWithRoad = computeHexInfluence({
    worldState: state.worldState,
    q: beyondRemote.q,
    r: beyondRemote.r,
    population: state.population,
    unlockedTechs: state.research.unlocked,
    assets: HEX_ASSETS,
    playerCapital: state.playerCapital,
    roads: state.roads,
    roadConnectivity: econAfterNet.roadConnectivity,
  });
  const infNoRoad = computeHexInfluence({
    worldState: state.worldState,
    q: beyondRemote.q,
    r: beyondRemote.r,
    population: state.population,
    unlockedTechs: state.research.unlocked,
    assets: HEX_ASSETS,
    playerCapital: state.playerCapital,
  });
  assert.ok(infWithRoad.score > infNoRoad.score);

  // Verify v7 serialization preserves roads and both cities cleanly
  const saved = serializeKingdomState(state);
  const loaded = deserializeKingdomState(saved, HEX_ASSETS.length)!;
  assert.equal(loaded.cities.length, 2);
  assert.equal(Object.keys(loaded.roads).length, 5);
  assert.equal(loaded.cities[1].name, state.cities[1].name);
  assert.ok(axialDistance(loaded.cities[0].center, loaded.cities[1].center) >= 3);
});
