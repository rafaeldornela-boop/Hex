import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeTwoFingerGestureDelta,
  isCleanTap,
  normalizeAngleDelta,
  screenPanToWorldDelta,
} from './touch-gestures';
import { resolveRenderQualityProfile } from './device-profile';
import { classifyBuildingRole, classifyHexTerrain } from './world-domain';
import { HEX_ASSETS } from './repo-data';

test('isCleanTap distinguishes short stationary taps from drags and multi-touch', () => {
  assert.equal(isCleanTap({ x: 100, y: 100 }, { x: 104, y: 103 }, 120, false), true);
  assert.equal(isCleanTap({ x: 100, y: 100 }, { x: 130, y: 100 }, 120, false), false);
  assert.equal(isCleanTap({ x: 100, y: 100 }, { x: 101, y: 101 }, 500, false), false);
  assert.equal(isCleanTap({ x: 100, y: 100 }, { x: 101, y: 101 }, 100, true), false);
});

test('computeTwoFingerGestureDelta zooms in on spread, zooms out on pinch, and filters tiny twist jitter', () => {
  // Spread fingers apart -> zoom in (negative zoomDelta)
  const spread = computeTwoFingerGestureDelta(
    { x: 100, y: 200 },
    { x: 200, y: 200 },
    { x: 80, y: 200 },
    { x: 220, y: 200 },
    11
  );
  assert.ok(spread.zoomDelta < 0, `Expected zoom in (<0), got ${spread.zoomDelta}`);
  assert.equal(spread.yawDeltaRad, 0);

  // Pinch fingers together -> zoom out (positive zoomDelta)
  const pinch = computeTwoFingerGestureDelta(
    { x: 80, y: 200 },
    { x: 220, y: 200 },
    { x: 110, y: 200 },
    { x: 190, y: 200 },
    11
  );
  assert.ok(pinch.zoomDelta > 0, `Expected zoom out (>0), got ${pinch.zoomDelta}`);

  // Twist fingers clockwise -> non-zero yawDeltaRad
  const twist = computeTwoFingerGestureDelta(
    { x: 100, y: 200 },
    { x: 200, y: 200 },
    { x: 100, y: 185 },
    { x: 200, y: 215 },
    11
  );
  assert.ok(Math.abs(twist.yawDeltaRad) > 0.05);
});

test('normalizeAngleDelta wraps angles across -PI/+PI boundary', () => {
  const delta = normalizeAngleDelta(Math.PI * 1.9);
  assert.ok(Math.abs(delta - -Math.PI * 0.1) < 1e-6);
});

test('screenPanToWorldDelta scales proportionally to camera distance and respects yaw', () => {
  const panNear = screenPanToWorldDelta(50, 0, 800, 8, 0);
  const panFar = screenPanToWorldDelta(50, 0, 800, 16, 0);
  assert.ok(Math.abs(panFar.dx) > Math.abs(panNear.dx));
  assert.ok(panNear.dx < 0, 'Dragging finger right should move camera target left');
});

test('resolveRenderQualityProfile keeps desktop high and scales mobile progressively', () => {
  const desktop = resolveRenderQualityProfile({
    isSoftwareGl: false,
    isCoarsePointer: false,
    viewportWidth: 1440,
    devicePixelRatio: 2,
    hardwareConcurrency: 8,
    deviceMemory: 8,
  });
  assert.equal(desktop.tier, 'desktop-high');
  assert.equal(desktop.shadowsEnabled, true);
  assert.equal(desktop.shadowMapSize, 1024);

  const mobileMid = resolveRenderQualityProfile({
    isSoftwareGl: false,
    isCoarsePointer: true,
    viewportWidth: 390,
    devicePixelRatio: 3,
    hardwareConcurrency: 6,
    deviceMemory: 6,
  });
  assert.equal(mobileMid.tier, 'mobile-balanced');
  assert.equal(mobileMid.pixelRatio, 1.5);
  assert.equal(mobileMid.shadowMapSize, 512);

  const mobileLow = resolveRenderQualityProfile({
    isSoftwareGl: false,
    isCoarsePointer: true,
    viewportWidth: 360,
    devicePixelRatio: 2,
    hardwareConcurrency: 4,
    deviceMemory: 2,
  });
  assert.equal(mobileLow.tier, 'mobile-low');
  assert.equal(mobileLow.shadowsEnabled, false);
  assert.equal(mobileLow.pixelRatio, 1);
});

test('world-domain classifiers categorize real hex assets cleanly', () => {
  const house = HEX_ASSETS.find((a) => a.name === 'building-house')!;
  const forest = HEX_ASSETS.find((a) => a.name === 'grass-forest')!;
  const mine = HEX_ASSETS.find((a) => a.name === 'building-mine')!;

  assert.equal(classifyHexTerrain(forest), 'forest');
  assert.equal(classifyBuildingRole(house), 'housing');
  assert.equal(classifyBuildingRole(mine), 'production');
});
