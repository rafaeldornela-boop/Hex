import test from 'node:test';
import assert from 'node:assert/strict';
import { HEX_ASSETS } from './repo-data';
import { hasHexConstruction, hexKey } from './hex-engine';
import { AXIAL_DIRECTIONS } from './territory-engine';
import {
  getStrategicRegionInfo,
  isNaturalTerrainAssetName,
  type TerrainType,
} from './terrain-engine';
import { evaluateHexBuildOptions, validateBuildCandidateOnHex } from './build-rules';
import { createStarterKingdomState, getKingdomEconomy, buildInKingdom } from './kingdom-engine';
import {
  DEFAULT_WORLD_SEED,
  WORLD_COLS,
  WORLD_ROWS,
  axialDistance,
  generateProceduralKingdomWorld,
} from './world-generator';

function idxOf(name: string): number {
  const idx = HEX_ASSETS.findIndex((a) => a.name === name);
  assert.ok(idx >= 0, `Missing asset ${name}`);
  return idx;
}

test('generateProceduralKingdomWorld is deterministic for identical seed and diverse across seeds', () => {
  const worldA = generateProceduralKingdomWorld(HEX_ASSETS, DEFAULT_WORLD_SEED);
  const worldA2 = generateProceduralKingdomWorld(HEX_ASSETS, DEFAULT_WORLD_SEED);
  const worldB = generateProceduralKingdomWorld(HEX_ASSETS, DEFAULT_WORLD_SEED + 1);

  assert.equal(Object.keys(worldA.worldState.hexes).length, WORLD_COLS * WORLD_ROWS);
  assert.deepEqual(worldA.playerCapital, worldA2.playerCapital);
  assert.equal(worldA.biomeProfile, worldA2.biomeProfile);

  for (const [k, tile] of Object.entries(worldA.worldState.hexes)) {
    const t2 = worldA2.worldState.hexes[k];
    assert.ok(t2 !== undefined);
    assert.equal(tile.terrainType, t2.terrainType);
    assert.equal(tile.structureIndex, t2.structureIndex);
    assert.equal(tile.owner, t2.owner);
    assert.equal(tile.rareFeature, t2.rareFeature);
  }

  // Different seed must produce different biome profile and tile distribution
  assert.notEqual(worldA.biomeProfile, worldB.biomeProfile);
  let diffs = 0;
  for (const [k, tile] of Object.entries(worldA.worldState.hexes)) {
    if (worldB.worldState.hexes[k]?.terrainType !== tile.terrainType) diffs++;
  }
  assert.ok(diffs > 100, `Expected > 100 terrain differences across seeds, got ${diffs}`);
});

test('all 4 biome profiles generate 1024 hexes with all 5 terrains, spaced rares, and viable connected hubs', () => {
  const seeds = Array.from({ length: 16 }, (_, i) => 10000 + i);
  const profilesSeen = new Set<string>();

  for (const seed of seeds) {
    const result = generateProceduralKingdomWorld(HEX_ASSETS, seed);
    profilesSeen.add(result.biomeProfile);

    const tiles = Object.values(result.worldState.hexes);
    assert.equal(tiles.length, 1024);

    const counts: Record<TerrainType, number> = {
      plains: 0,
      forest: 0,
      mountain: 0,
      water: 0,
      fertile: 0,
    };
    const rareCoords: Array<{ q: number; r: number }> = [];

    for (const tile of tiles) {
      if (tile.terrainType) counts[tile.terrainType]++;
      if (tile.rareFeature && tile.rareFeature !== 'none') {
        rareCoords.push({ q: tile.q, r: tile.r });
      }
    }

    // All 5 terrain types present in meaningful quantities
    assert.ok(counts.plains >= 30, `Seed ${seed} lacks plains`);
    assert.ok(counts.forest >= 20, `Seed ${seed} lacks forest`);
    assert.ok(counts.mountain >= 15, `Seed ${seed} lacks mountains`);
    assert.ok(counts.water >= 40, `Seed ${seed} lacks water`);
    assert.ok(counts.fertile >= 15, `Seed ${seed} lacks fertile tiles`);

    // Rare nodes never crowd each other, and non-rare tiles stay 'none' via getStrategicRegionInfo
    for (const tile of tiles) {
      if (!tile.rareFeature || tile.rareFeature === 'none') {
        assert.equal(
          getStrategicRegionInfo(tile.q, tile.r, tile).rareFeature,
          'none',
          `Non-rare procedural tile at ${tile.q},${tile.r} leaked strategic feature on seed ${seed}`
        );
      }
    }
    for (let i = 0; i < rareCoords.length; i++) {
      for (let j = i + 1; j < rareCoords.length; j++) {
        assert.ok(
          axialDistance(rareCoords[i], rareCoords[j]) >= 4,
          `Rare nodes too close on seed ${seed}`
        );
      }
    }

    // Player capital is connected to >= 5 non-water ring-1 neighbors & separated from rivals
    const cap = result.playerCapital;
    let ring1Land = 0;
    for (const dir of AXIAL_DIRECTIONS) {
      const n = result.worldState.hexes[hexKey(cap.q + dir.q, cap.r + dir.r)];
      assert.ok(n !== undefined, `Player ring-1 neighbor missing on seed ${seed}`);
      assert.equal(n.owner, 'player');
      if (n.terrainType !== 'water') ring1Land++;
    }
    assert.ok(ring1Land >= 6, `Player core must be solid land, got ${ring1Land}`);

    for (const faction of result.factions) {
      assert.ok(
        axialDistance(cap, faction.capitalCoord) >= 5,
        `Faction ${faction.id} too close to player on seed ${seed}`
      );
    }
  }

  assert.equal(profilesSeen.size, 4, 'All 4 biome profiles should be covered');
});

test('evaluateHexBuildOptions strictly matches terrain rules and never exposes natural terrains', () => {
  const starter = createStarterKingdomState(HEX_ASSETS, DEFAULT_WORLD_SEED);
  const fullTechStarter = {
    ...starter,
    research: {
      ...starter.research,
      unlocked: ['agriculture', 'mining', 'trade', 'military', 'engineering', 'metallurgy'] as typeof starter.research.unlocked,
    },
  };
  const econ = getKingdomEconomy(fullTechStarter, HEX_ASSETS);

  // Pick a guaranteed free owned hex from starter core
  const freeOwned = Object.values(fullTechStarter.worldState.hexes).find(
    (t) => t.owner === 'player' && !hasHexConstruction(t, HEX_ASSETS)
  );
  assert.ok(freeOwned, 'Expected a free owned starter hex');

  const terrains: TerrainType[] = ['plains', 'forest', 'mountain', 'fertile', 'water'];
  for (const terrain of terrains) {
    const mutatedWorld = {
      ...fullTechStarter.worldState,
      hexes: {
        ...fullTechStarter.worldState.hexes,
        [hexKey(freeOwned.q, freeOwned.r)]: {
          ...freeOwned,
          terrainType: terrain,
          structureIndex: idxOf('grass'),
        },
      },
    };

    const evaluation = evaluateHexBuildOptions({
      worldState: mutatedWorld,
      resources: fullTechStarter.resources,
      unlockedTechs: fullTechStarter.research.unlocked,
      economy: econ,
      hasActiveConstructionAtCoord: false,
      q: freeOwned.q,
      r: freeOwned.r,
      assets: HEX_ASSETS,
    });

    assert.ok(evaluation.options.length > 0, `Expected build options on ${terrain}`);
    for (const opt of evaluation.options) {
      assert.equal(
        isNaturalTerrainAssetName(opt.assetName),
        false,
        `Natural terrain ${opt.assetName} leaked into contextual menu!`
      );
      const v = validateBuildCandidateOnHex({
        worldState: mutatedWorld,
        resources: fullTechStarter.resources,
        unlockedTechs: fullTechStarter.research.unlocked,
        availableWorkers: econ.population.availableWorkers,
        hasActiveConstructionAtCoord: false,
        q: freeOwned.q,
        r: freeOwned.r,
        structureIndex: opt.assetIndex,
        assets: HEX_ASSETS,
        checkAffordability: false,
      });
      assert.equal(v.allowed, true, `Option ${opt.assetName} on ${terrain} should validate`);
    }

    if (terrain === 'water') {
      assert.equal(
        evaluation.options.some((o) => o.assetName === 'building-house'),
        false,
        'Houses cannot be offered on water'
      );
      assert.equal(
        evaluation.options.some((o) => o.assetName === 'building-port'),
        true,
        'Port should be offered on water once Sailing is unlocked'
      );
    }

    if (terrain === 'mountain') {
      assert.equal(
        evaluation.options.some((o) => o.assetName === 'building-farm'),
        false,
        'Farms cannot be offered on mountain'
      );
      assert.equal(
        evaluation.options.some((o) => o.assetName === 'building-mine'),
        true,
        'Mine should be offered on mountain once Mining is unlocked'
      );
    }
  }

  // Neutral hex must return empty options and ownership message
  const neutralTile = Object.values(fullTechStarter.worldState.hexes).find(
    (t) => t.owner === 'neutral'
  )!;
  const neutralEval = evaluateHexBuildOptions({
    worldState: fullTechStarter.worldState,
    resources: fullTechStarter.resources,
    unlockedTechs: fullTechStarter.research.unlocked,
    economy: econ,
    hasActiveConstructionAtCoord: false,
    q: neutralTile.q,
    r: neutralTile.r,
    assets: HEX_ASSETS,
  });
  assert.equal(neutralEval.canBuildOnHex, false);
  assert.equal(neutralEval.options.length, 0);
  assert.match(neutralEval.blockedReasonPt ?? '', /Conquiste este território/);

  // Direct buildInKingdom call with natural terrain asset must fail cleanly
  for (const naturalName of ['grass', 'grass-forest', 'stone-mountain', 'water', 'river-straight', 'path-straight']) {
    const res = buildInKingdom(
      fullTechStarter,
      freeOwned.q,
      freeOwned.r,
      idxOf(naturalName),
      90,
      HEX_ASSETS
    );
    assert.equal(res.built, false, `${naturalName} must never be constructible`);
  }
});
