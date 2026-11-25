import test from 'node:test';
import assert from 'node:assert/strict';
import { HEX_ASSETS } from './repo-data';
import {
  HEX_WORLD_SCALE,
  axialToWorld,
  hexKey,
  worldToAxial,
  type AxialCoord,
} from './hex-engine';
import { generateProceduralKingdomWorld } from './world-generator';
import {
  computeFarmCropVisualState,
  computeHexSeasonalVisualProfile,
} from './season-engine';
import {
  HYSTERESIS_MARGIN,
  SPECIALIZATION_STAGE_META,
  evaluateRegionalWorld,
  getSpecializationStage,
} from './regional-engine';
import { computeRoadConnectivity, type RoadMap } from './road-engine';
import {
  advanceKingdomTurn,
  buildInKingdom,
  buildOrUpgradeRoadInKingdom,
  createStarterKingdomState,
  deserializeKingdomState,
  getKingdomEconomy,
  serializeKingdomState,
} from './kingdom-engine';
import { computeCalendarSnapshot } from './calendar-engine';
import type { CityEntity } from './city-engine';

function idxOf(name: string): number {
  const idx = HEX_ASSETS.findIndex((a) => a.name === name);
  assert.ok(idx >= 0, `Missing asset ${name}`);
  return idx;
}

test('HEX_WORLD_SCALE is expanded to 2.05, axial<->world round-trips, and procedural terrain stays deterministic across seed', () => {
  assert.equal(HEX_WORLD_SCALE, 2.05);

  const testCoords: AxialCoord[] = [
    { q: 0, r: 0 },
    { q: 3, r: -2 },
    { q: -7, r: 5 },
    { q: 11, r: -9 },
  ];
  for (const c of testCoords) {
    const pos = axialToWorld(c.q, c.r);
    const back = worldToAxial(pos.x, pos.z);
    assert.deepEqual(back, c);
  }

  const worldA = generateProceduralKingdomWorld(HEX_ASSETS, 42026);
  const worldB = generateProceduralKingdomWorld(HEX_ASSETS, 42026);
  const keysA = Object.keys(worldA.worldState.hexes).sort();
  const keysB = Object.keys(worldB.worldState.hexes).sort();
  assert.deepEqual(keysA, keysB);
  assert.deepEqual(worldA.playerCapital, worldB.playerCapital);

  // Sample several hexes to guarantee identical biome & asset layout
  for (let i = 0; i < keysA.length; i += 23) {
    const k = keysA[i];
    assert.equal(
      worldA.worldState.hexes[k].terrainType,
      worldB.worldState.hexes[k].terrainType
    );
    assert.equal(
      worldA.worldState.hexes[k].structureIndex,
      worldB.worldState.hexes[k].structureIndex
    );
  }
});

test('seasonal visual biome profiles transform all biomes cleanly without mutating gameplay terrain or snowing sand', () => {
  // 1. Mountain gets winter snow cap, zero green/orange foliageTint
  const mountainWinter = computeHexSeasonalVisualProfile({
    q: 0,
    r: 12,
    tile: { terrainType: 'mountain', resourceType: 'ore' },
    assetName: 'stone-mountain',
    season: 'winter',
    seasonProgress: 0.5,
  });
  assert.equal(mountainWinter.subVariant, 'alpine');
  assert.ok(mountainWinter.snowAmount > 0.5);
  assert.equal(mountainWinter.foliageShift, 0);

  const mountainAutumn = computeHexSeasonalVisualProfile({
    q: 0,
    r: 12,
    tile: { terrainType: 'mountain', resourceType: 'ore' },
    assetName: 'stone-mountain',
    season: 'autumn',
    seasonProgress: 0.5,
  });
  assert.equal(mountainAutumn.foliageShift, 0);
  assert.equal(mountainAutumn.snowAmount, 0);

  // 2. Arid sand never gets snow in winter
  const sandWinter = computeHexSeasonalVisualProfile({
    q: 0,
    r: 12,
    tile: { terrainType: 'plains', resourceType: 'food' },
    assetName: 'sand-rocks',
    season: 'winter',
    seasonProgress: 0.5,
  });
  assert.equal(sandWinter.subVariant, 'arid_sand');
  assert.equal(sandWinter.snowAmount, 0);
  assert.equal(sandWinter.flowerDensity, 0);

  // 3. Plains & fertile bloom flowers in spring, fade in autumn/winter
  const fertileSpring = computeHexSeasonalVisualProfile({
    q: 2,
    r: -1,
    tile: { terrainType: 'fertile', resourceType: 'food' },
    assetName: 'dirt',
    season: 'spring',
    seasonProgress: 0.5,
  });
  assert.equal(fertileSpring.subVariant, 'riverbank_fertile');
  assert.ok(fertileSpring.foliageShift > 0.4);
  assert.ok(fertileSpring.wetnessOrIce > 0.6);

  // 4. Forest differentiates deciduous vs boreal conifers across northern vs southern latitudes
  let seenDeciduous = false;
  let seenConifer = false;
  for (let q = -10; q <= 10; q++) {
    for (let r = -10; r <= 10; r++) {
      const prof = computeHexSeasonalVisualProfile({
        q,
        r,
        tile: { terrainType: 'forest', resourceType: 'wood' },
        assetName: 'grass-forest',
        season: 'autumn',
        seasonProgress: 0.6,
      });
      if (prof.subVariant === 'deciduous_forest') seenDeciduous = true;
      if (prof.subVariant === 'boreal_conifer') seenConifer = true;
    }
  }
  assert.ok(seenDeciduous && seenConifer, 'Forests should include both deciduous and boreal conifer sub-variants');

  // 5. Cold northern water gets winter ice, summer water has zero ice
  const northWaterWinter = computeHexSeasonalVisualProfile({
    q: 0,
    r: -14, // Wait: northRatio uses northSouth = -(r + 0.5*q), (-northSouth + 1)/halfRows -> positive r gives positive northRatio
    tile: { terrainType: 'water', resourceType: 'food' },
    assetName: 'water',
    season: 'winter',
    seasonProgress: 0.5,
  });
  const trueNorthWaterWinter = computeHexSeasonalVisualProfile({
    q: 0,
    r: 14,
    tile: { terrainType: 'water', resourceType: 'food' },
    assetName: 'water',
    season: 'winter',
    seasonProgress: 0.5,
  });
  const trueNorthWaterSummer = computeHexSeasonalVisualProfile({
    q: 0,
    r: 14,
    tile: { terrainType: 'water', resourceType: 'food' },
    assetName: 'water',
    season: 'summer',
    seasonProgress: 0.5,
  });
  assert.equal(northWaterWinter.iceAmount, 0);
  assert.ok(trueNorthWaterWinter.iceAmount > 0.35);
  assert.equal(trueNorthWaterSummer.iceAmount, 0);
});

test('farm 4-season visual crop cycle advances from sprouts to lush to harvest to dormant and scales with level', () => {
  const spring = computeFarmCropVisualState({ season: 'spring', seasonProgress: 0.4, farmLevel: 1 });
  const summer = computeFarmCropVisualState({ season: 'summer', seasonProgress: 0.5, farmLevel: 1 });
  const autumn = computeFarmCropVisualState({ season: 'autumn', seasonProgress: 0.5, farmLevel: 1 });
  const autumnLv3 = computeFarmCropVisualState({ season: 'autumn', seasonProgress: 0.5, farmLevel: 3 });
  const winter = computeFarmCropVisualState({ season: 'winter', seasonProgress: 0.5, farmLevel: 1 });

  assert.equal(spring.stage, 'sprouts');
  assert.equal(summer.stage, 'lush');
  assert.equal(autumn.stage, 'harvest');
  assert.equal(winter.stage, 'dormant');
  assert.ok(autumnLv3.headScale > autumn.headScale);
  assert.ok(autumn.stalkHeightScale > winter.stalkHeightScale);
});

test('regional engine computes deterministic non-overlapping tile partition, port specialization, 3 stages, and hysteresis', () => {
  let state = createStarterKingdomState(HEX_ASSETS, 42026);
  const cap = state.playerCapital!;

  // Create a controlled 2-city setup to verify non-overlapping partition, port spec, stages & hysteresis
  const cityA: CityEntity = {
    id: 'city-a',
    name: 'Auróra',
    center: { q: cap.q, r: cap.r },
    owner: 'player',
    foundedTurn: 1,
    level: 2,
    populationShare: 20,
    connectedCityCount: 1,
    specializationLabel: 'Centro Urbano',
    districtsSummary: [],
    regionHexKeys: [],
  };
  const cityB: CityEntity = {
    id: 'city-b',
    name: 'Porto Sul',
    center: { q: cap.q + 4, r: cap.r },
    owner: 'player',
    foundedTurn: 5,
    level: 1,
    populationShare: 10,
    connectedCityCount: 1,
    specializationLabel: 'Região Portuária',
    districtsSummary: [],
    regionHexKeys: [],
  };

  // Own hexes between and around both cities; place port + dock + water around cityB
  const hexes = { ...state.worldState.hexes };
  for (let dq = -2; dq <= 7; dq++) {
    for (let dr = -2; dr <= 2; dr++) {
      const q = cap.q + dq;
      const r = cap.r + dr;
      const k = hexKey(q, r);
      const existing = hexes[k];
      if (!existing) continue;
      hexes[k] = {
        ...existing,
        owner: 'player',
        terrainType: dq >= 5 ? 'water' : 'plains',
        resourceType: 'food',
        structureIndex: idxOf(dq >= 5 ? 'water' : 'grass'),
      };
    }
  }
  // Put castle at cityA, village at cityB, port + dock adjacent to cityB
  hexes[hexKey(cityA.center.q, cityA.center.r)] = {
    ...hexes[hexKey(cityA.center.q, cityA.center.r)],
    owner: 'player',
    terrainType: 'plains',
    structureIndex: idxOf('building-castle'),
  };
  hexes[hexKey(cityB.center.q, cityB.center.r)] = {
    ...hexes[hexKey(cityB.center.q, cityB.center.r)],
    owner: 'player',
    terrainType: 'plains',
    structureIndex: idxOf('building-village'),
  };
  const portCoord = { q: cityB.center.q + 1, r: cityB.center.r };
  const dockCoord = { q: cityB.center.q + 1, r: cityB.center.r - 1 };
  hexes[hexKey(portCoord.q, portCoord.r)] = {
    ...hexes[hexKey(portCoord.q, portCoord.r)],
    owner: 'player',
    terrainType: 'water',
    structureIndex: idxOf('building-port'),
  };
  hexes[hexKey(dockCoord.q, dockCoord.r)] = {
    ...hexes[hexKey(dockCoord.q, dockCoord.r)],
    owner: 'player',
    terrainType: 'water',
    structureIndex: idxOf('building-dock'),
  };

  const roads: RoadMap = {};
  for (let dq = 0; dq <= 5; dq++) {
    const k = hexKey(cap.q + dq, cap.r);
    roads[k] = {
      q: cap.q + dq,
      r: cap.r,
      level: 2,
      owner: 'player',
    };
  }

  const worldState = { ...state.worldState, hexes };
  const connectivity = computeRoadConnectivity({
    worldState,
    roads,
    cityCenters: [cityA, cityB].map((c) => ({ id: c.id, center: c.center, level: c.level })),
    assets: HEX_ASSETS,
    owner: 'player',
  });

  const summary = evaluateRegionalWorld({
    worldState,
    cities: [cityA, cityB],
    roads,
    connectivity,
    assets: HEX_ASSETS,
  });

  // Check deterministic non-overlapping partition: no hex belongs to two cities
  const allAssigned = [
    ...(summary.regionHexKeysByCityId[cityA.id] ?? []),
    ...(summary.regionHexKeysByCityId[cityB.id] ?? []),
  ];
  assert.equal(new Set(allAssigned).size, allAssigned.length, 'Regions must be strictly disjoint');
  assert.equal(Object.keys(summary.controllingCityIdByHexKey).length, allAssigned.length);

  // Check port specialization & port district on cityB
  const profB = summary.cityProfilesById[cityB.id];
  assert.equal(profB.primarySpecialization.id, 'port');
  assert.ok(profB.districts.some((d) => d.type === 'port'));

  // Check stage helper thresholds
  assert.equal(getSpecializationStage(SPECIALIZATION_STAGE_META.developing.minScore), 'developing');
  assert.equal(getSpecializationStage(SPECIALIZATION_STAGE_META.consolidated.minScore), 'consolidated');
  assert.equal(getSpecializationStage(SPECIALIZATION_STAGE_META.specialized.minScore), 'specialized');

  // Check hysteresis: if previous primary on cityB is 'commercial' and its score is within HYSTERESIS_MARGIN of port, it stays 'commercial'
  const commercialScore = profB.specializations.find((s) => s.id === 'commercial')?.score ?? 0;
  if (
    commercialScore >= SPECIALIZATION_STAGE_META.developing.minScore &&
    profB.primarySpecialization.score < commercialScore + HYSTERESIS_MARGIN
  ) {
    const hystSummary = evaluateRegionalWorld({
      worldState,
      cities: [cityA, cityB],
      roads,
      connectivity,
      assets: HEX_ASSETS,
      previousPrimaryByCityId: { [cityB.id]: 'commercial' },
    });
    assert.equal(hystSummary.cityProfilesById[cityB.id].primarySpecialization.id, 'commercial');
  } else {
    // Otherwise test hysteresis synthetically on cityA (urban vs slightly higher agricultural)
    const profA = summary.cityProfilesById[cityA.id];
    const runnerUp = profA.specializations[1];
    if (
      runnerUp &&
      runnerUp.score >= SPECIALIZATION_STAGE_META.developing.minScore &&
      profA.primarySpecialization.score < runnerUp.score + HYSTERESIS_MARGIN
    ) {
      const hystA = evaluateRegionalWorld({
        worldState,
        cities: [cityA, cityB],
        roads,
        connectivity,
        assets: HEX_ASSETS,
        previousPrimaryByCityId: { [cityA.id]: runnerUp.id },
      });
      assert.equal(hystA.cityProfilesById[cityA.id].primarySpecialization.id, runnerUp.id);
    }
  }
});

test('regional economy bonuses stay balanced (winter remains harsher than spring) and save/load v9 preserves primarySpecialization & regionHexKeys', () => {
  let state = createStarterKingdomState(HEX_ASSETS, 42026);
  const cap = state.playerCapital!;

  // Give resources/techs and construct 2 farms + market to push specialization and test bonuses
  state = {
    ...state,
    worldState: { ...state.worldState, cash: 5000 },
    resources: { ...state.resources, wood: 200, stone: 200, food: 120, ore: 60, metal: 30 },
    research: { ...state.research, unlocked: ['agriculture', 'construction', 'trade'] },
  };

  // Build road on capital and adjacent farm
  const roadRes = buildOrUpgradeRoadInKingdom(state, cap.q, cap.r, HEX_ASSETS);
  if (roadRes.built) state = roadRes.nextState;

  const freeAdj = Object.values(state.worldState.hexes).find(
    (t) =>
      t.owner === 'player' &&
      (t.terrainType === 'plains' || t.terrainType === 'fertile') &&
      HEX_ASSETS[t.structureIndex]?.name.startsWith('grass')
  );
  if (freeAdj) {
    const farmBuild = buildInKingdom(state, freeAdj.q, freeAdj.r, idxOf('building-farm'), 90, HEX_ASSETS);
    if (farmBuild.built) {
      state = farmBuild.nextState;
      state = advanceKingdomTurn(state, HEX_ASSETS).nextState;
    }
  }

  const springEcon = getKingdomEconomy(state, HEX_ASSETS);
  const winterEcon = getKingdomEconomy(
    {
      ...state,
      turn: 37,
      calendar: computeCalendarSnapshot(37),
    },
    HEX_ASSETS
  );

  // Even with agricultural regional resilience, winter must still reduce food output vs spring
  assert.ok(
    winterEcon.foodProduced < springEcon.foodProduced,
    `Expected winter food (${winterEcon.foodProduced}) < spring food (${springEcon.foodProduced})`
  );
  assert.ok(springEcon.regionalSummary.cityProfilesById[state.cities[0].id]);

  // Save/load version 9 round-trip
  const rawV9 = serializeKingdomState(state);
  const parsedV9 = JSON.parse(rawV9);
  assert.equal(parsedV9.version, 10);

  const reloaded = deserializeKingdomState(rawV9, HEX_ASSETS.length);
  assert.ok(reloaded !== null);
  assert.ok(reloaded.cities.length >= 1);
  assert.ok(reloaded.cities[0].primarySpecialization);
  assert.ok(Array.isArray(reloaded.cities[0].regionHexKeys));

  // Backward compatibility: loading a synthetic version 8 save normalizes cities cleanly
  const rawV8 = JSON.stringify({
    ...parsedV9,
    version: 8,
    cities: parsedV9.cities.map((c: Record<string, unknown>) => {
      const copy = { ...c };
      delete copy.primarySpecialization;
      delete copy.regionHexKeys;
      return copy;
    }),
  });
  const reloadedV8 = deserializeKingdomState(rawV8, HEX_ASSETS.length);
  assert.ok(reloadedV8 !== null);
  assert.ok(reloadedV8.cities.length >= 1);
  assert.ok(Array.isArray(reloadedV8.cities[0].regionHexKeys));
});
