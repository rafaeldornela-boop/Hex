import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getKaykitComposition,
  getKaykitPilotStats,
  isKaykitPilotTile,
  kaykitUrl,
  listKaykitPilotPaths,
  KAYKIT_PILOT_RADIUS,
} from './kaykit-pilot';

test('pilot radius includes origin ring', () => {
  assert.equal(isKaykitPilotTile(0, 0), true);
  assert.equal(isKaykitPilotTile(1, 0), true);
  assert.equal(isKaykitPilotTile(2, 0), true);
  assert.equal(isKaykitPilotTile(3, 0), false);
  assert.equal(isKaykitPilotTile(2, -2), true); // dist 2
  assert.equal(isKaykitPilotTile(3, -1), false);
});

test('compositions cover core terrain and buildings', () => {
  for (const name of [
    'grass',
    'grass-forest',
    'grass-hill',
    'stone-mountain',
    'water',
    'path-straight',
    'river-straight',
    'building-farm',
    'building-house',
    'building-market',
    'building-mine',
  ]) {
    const c = getKaykitComposition(name);
    assert.ok(c, name);
    assert.ok(c!.base.endsWith('.gltf'), name);
  }
  assert.equal(getKaykitComposition('unknown-xyz'), null);
});

test('kaykit urls and path list', () => {
  assert.equal(kaykitUrl('tiles/base/hex_grass.gltf'), 'https://cdn.jsdelivr.net/gh/KayKit-Game-Assets/KayKit-Medieval-Hexagon-Pack-1.0@main/addons/kaykit_medieval_hexagon_pack/Assets/gltf/tiles/base/hex_grass.gltf');
  const paths = listKaykitPilotPaths();
  assert.ok(paths.length >= 10);
  assert.ok(paths.every((p) => p.endsWith('.gltf')));
  const stats = getKaykitPilotStats();
  assert.equal(stats.radius, KAYKIT_PILOT_RADIUS);
  assert.ok(stats.mappedAssets >= 15);
});
