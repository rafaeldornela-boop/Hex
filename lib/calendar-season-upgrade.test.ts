import test from 'node:test';
import assert from 'node:assert/strict';
import { HEX_ASSETS } from './repo-data';
import { computeCalendarSnapshot } from './calendar-engine';
import {
  DAY_PHASE_ORDER,
  computeAtmosphereTarget,
  getDayPhaseForTurn,
} from './day-night-engine';
import {
  advanceClimateWeather,
  computeTileClimateProfile,
  computeTileSnowFactor,
  createInitialClimateWeather,
} from './season-engine';
import {
  getBuildingLevel,
  getEffectiveBuildingStats,
} from './building-upgrade-engine';
import { hexKey } from './hex-engine';
import {
  advanceKingdomTurn,
  createStarterKingdomState,
  demolishInKingdom,
  deserializeKingdomState,
  evaluateBuildingUpgradeInKingdom,
  getKingdomEconomy,
  serializeKingdomState,
  upgradeBuildingInKingdom,
} from './kingdom-engine';

function idxOf(name: string): number {
  const idx = HEX_ASSETS.findIndex((a) => a.name === name);
  assert.ok(idx >= 0, `Missing asset ${name}`);
  return idx;
}

test('calendar rolls over deterministically across 12-turn seasons and 48-turn years with winter warning', () => {
  const t1 = computeCalendarSnapshot(1);
  assert.equal(t1.year, 1);
  assert.equal(t1.season, 'spring');
  assert.equal(t1.dayOfMonth, 1);
  assert.equal(t1.turnsUntilWinter, 36);
  assert.equal(t1.isWinterWarning, false);

  const t12 = computeCalendarSnapshot(12);
  assert.equal(t12.season, 'spring');
  assert.equal(t12.turnInSeason, 12);
  assert.equal(t12.dayOfMonth, 28);

  const t13 = computeCalendarSnapshot(13);
  assert.equal(t13.season, 'summer');
  assert.equal(t13.monthOfYear, 2);
  assert.equal(t13.turnsUntilWinter, 24);

  const t25 = computeCalendarSnapshot(25);
  assert.equal(t25.season, 'autumn');
  assert.equal(t25.turnsUntilWinter, 12);
  assert.equal(t25.isWinterWarning, true);

  const t37 = computeCalendarSnapshot(37);
  assert.equal(t37.season, 'winter');
  assert.equal(t37.turnsUntilWinter, 0);

  const t49 = computeCalendarSnapshot(49);
  assert.equal(t49.year, 2);
  assert.equal(t49.season, 'spring');
});

test('day-night engine cycles all 6 phases cleanly and maintains readable moonlight at night', () => {
  const seen = new Set<string>();
  for (let turn = 1; turn <= 6; turn++) {
    const phase = getDayPhaseForTurn(turn);
    seen.add(phase);
    const atm = computeAtmosphereTarget({ phase, season: 'winter', weather: 'clear' });
    assert.ok(atm.sunIntensity >= 0.7, 'Night moonlight must stay readable');
    assert.ok(atm.hemiIntensity >= 0.5, 'Night hemisphere fill must stay legible');
  }
  assert.equal(seen.size, DAY_PHASE_ORDER.length);

  const nightAtm = computeAtmosphereTarget({ phase: 'night', season: 'spring' });
  assert.equal(nightAtm.isNight, true);
  assert.equal(nightAtm.cityNightGlow, 1);
  assert.equal(nightAtm.roadLampGlow, 1);
  assert.ok(nightAtm.starVisibility > 0.8);

  const dayAtm = computeAtmosphereTarget({ phase: 'day', season: 'summer' });
  assert.equal(dayAtm.isNight, false);
  assert.equal(dayAtm.cityNightGlow, 0);
});

test('seasonal climate applies selective winter snow only on cold/alpine regions and avoids warm/sand hexes', () => {
  const mountainNorth = computeTileClimateProfile({
    q: 0,
    r: 12,
    tile: { terrainType: 'mountain', resourceType: 'ore' },
    worldCols: 32,
    worldRows: 32,
  });
  assert.equal(mountainNorth.supportsSnow, true);
  assert.equal(mountainNorth.zone, 'alpine');

  const warmSouthPlains = computeTileClimateProfile({
    q: 0,
    r: -12,
    tile: { terrainType: 'plains', resourceType: 'food' },
    worldCols: 32,
    worldRows: 32,
  });
  assert.equal(warmSouthPlains.supportsSnow, false);
  assert.equal(warmSouthPlains.zone, 'warm');

  const mountainWinterSnow = computeTileSnowFactor({
    climate: mountainNorth,
    season: 'winter',
    seasonProgress: 0.5,
  });
  const warmWinterSnow = computeTileSnowFactor({
    climate: warmSouthPlains,
    season: 'winter',
    seasonProgress: 0.5,
  });
  const mountainSummerSnow = computeTileSnowFactor({
    climate: mountainNorth,
    season: 'summer',
    seasonProgress: 0.5,
  });

  assert.ok(mountainWinterSnow >= 0.65);
  assert.equal(warmWinterSnow, 0);
  assert.equal(mountainSummerSnow, 0);
});

test('seasonal economy penalizes winter food while upgraded Fazenda Nv. II mitigates seasonal drop and increases output', () => {
  let state = createStarterKingdomState(HEX_ASSETS, 42026);
  // Find starter Fazenda
  const farmTile = Object.values(state.worldState.hexes).find(
    (t) => t.owner === 'player' && HEX_ASSETS[t.structureIndex]?.name === 'building-farm'
  );
  assert.ok(farmTile, 'Starter core must contain a Fazenda');

  // Unlock agriculture & construction and add sufficient treasury/resources to test upgrade directly
  state = {
    ...state,
    worldState: { ...state.worldState, cash: 5000 },
    resources: { ...state.resources, wood: 150, stone: 150, ore: 60, metal: 30, food: 120 },
    research: { ...state.research, unlocked: ['agriculture', 'construction'] },
  };

  // Without agriculture upgrade -> verify Nv.1 vs Nv.2 stats and winter impact
  const springEcon = getKingdomEconomy(state, HEX_ASSETS);
  const winterState = {
    ...state,
    turn: 37,
    calendar: computeCalendarSnapshot(37),
    climateWeather: createInitialClimateWeather(),
  };
  const winterEconLv1 = getKingdomEconomy(winterState, HEX_ASSETS);
  assert.ok(
    winterEconLv1.foodConsumed > springEcon.foodConsumed,
    'Winter must increase food demand'
  );
  assert.ok(
    winterEconLv1.foodProduced < springEcon.foodProduced,
    'Winter must lower agricultural output'
  );

  // Upgrade Fazenda -> Nv. 2
  const evalUpgrade = evaluateBuildingUpgradeInKingdom(
    state,
    farmTile.q,
    farmTile.r,
    HEX_ASSETS
  );
  assert.equal(evalUpgrade.canUpgrade, true);
  assert.equal(evalUpgrade.nextTier?.level, 2);

  const started = upgradeBuildingInKingdom(state, farmTile.q, farmTile.r, HEX_ASSETS);
  assert.equal(started.started, true);
  assert.equal(started.nextState.constructions.length, 1);
  assert.equal(started.nextState.constructions[0].kind, 'upgrade');
  assert.equal(started.nextState.constructions[0].targetLevel, 2);

  // Advance turns until Fazenda II completes
  let progressed = started.nextState;
  const turnsNeeded = evalUpgrade.nextTier!.upgradeTimeTurns;
  for (let i = 0; i < turnsNeeded; i++) {
    progressed = advanceKingdomTurn(progressed, HEX_ASSETS).nextState;
  }

  const updatedFarmTile = progressed.worldState.hexes[hexKey(farmTile.q, farmTile.r)];
  assert.equal(getBuildingLevel(updatedFarmTile), 2);
  const lv2Stats = getEffectiveBuildingStats('building-farm', 2);
  assert.ok(lv2Stats.production.food > getEffectiveBuildingStats('building-farm', 1).production.food);
  assert.ok(lv2Stats.seasonalResilience >= 0.25);

  const econAfterUpgrade = getKingdomEconomy(progressed, HEX_ASSETS);
  const farmReport = econAfterUpgrade.buildingsByKey[hexKey(farmTile.q, farmTile.r)];
  assert.equal(farmReport.level, 2);

  // Round-trip save/load v8 preserves upgraded building level and calendar
  const saved = serializeKingdomState(progressed);
  const reloaded = deserializeKingdomState(saved, HEX_ASSETS.length);
  assert.ok(reloaded !== null);
  assert.equal(
    getBuildingLevel(reloaded.worldState.hexes[hexKey(farmTile.q, farmTile.r)]),
    2
  );
  assert.equal(reloaded.calendar.turn, progressed.turn);

  // Demolish resets level cleanly
  const demolished = demolishInKingdom(progressed, farmTile.q, farmTile.r, HEX_ASSETS);
  assert.equal(demolished.removed, true);
  assert.equal(
    getBuildingLevel(demolished.nextState.worldState.hexes[hexKey(farmTile.q, farmTile.r)]),
    1
  );
});

test('controlled climate weather advances cleanly and resolves after bounded turns', () => {
  let weather = createInitialClimateWeather();
  let seenNonClear = false;
  for (let turn = 2; turn <= 48; turn++) {
    const cal = computeCalendarSnapshot(turn);
    const step = advanceClimateWeather({
      nextTurn: turn,
      season: cal.season,
      prevWeather: weather,
      worldSeed: 42026,
    });
    weather = step.weather;
    if (weather.id !== 'clear') {
      seenNonClear = true;
      assert.ok(weather.turnsRemaining >= 1 && weather.turnsRemaining <= 3);
    }
  }
  assert.equal(seenNonClear, true, 'At least one bounded weather event should appear across a year');
});
