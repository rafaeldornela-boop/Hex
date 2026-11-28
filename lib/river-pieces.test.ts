import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALLOWED_ORIENTATIONS,
  CANONICAL_CURVE_EDGES,
  RIVER_PIECE_DEFINITIONS,
  getRiverPieceExits,
  isRiverPieceName,
  localEdgeToWorldDirection,
  selectRiverPiece,
  worldDirectionToLocalEdge,
  type RiverPieceName,
} from './river-pieces';

test('river-corner and river-corner-sharp: sharp is 60° and corner is 120°', () => {
  // Confirm table definition:
  // river-corner-sharp must be the sharp 60° bend (adjacent edges [0, 1])
  assert.deepEqual(CANONICAL_CURVE_EDGES['river-corner-sharp'], [0, 1]);
  assert.equal(RIVER_PIECE_DEFINITIONS['river-corner-sharp'].bendAngleDeg, 60);

  // river-corner must be the gentle 120° bend (separated by 120°, 2 hex edge steps [1, 5])
  assert.deepEqual(CANONICAL_CURVE_EDGES['river-corner'], [1, 5]);
  assert.equal(RIVER_PIECE_DEFINITIONS['river-corner'].bendAngleDeg, 120);

  // Verify difference between local edges:
  const sharpEdges = RIVER_PIECE_DEFINITIONS['river-corner-sharp'].localEdges;
  const cornerEdges = RIVER_PIECE_DEFINITIONS['river-corner'].localEdges;

  // In unrotated GLB, sharp is [3, 4] (adjacent, diff = 1 edge = 60°)
  const sharpDiff = Math.abs(sharpEdges[0] - sharpEdges[1]);
  assert.equal(sharpDiff, 1, 'river-corner-sharp edges must be adjacent (60°)');

  // In unrotated GLB, corner is [3, 5] (diff = 2 edges = 120°)
  const cornerDiff = Math.abs(cornerEdges[0] - cornerEdges[1]);
  assert.equal(cornerDiff, 2, 'river-corner edges must be 2 steps apart (120°)');
});

test('intersections A through H have measured local edges from GLB', () => {
  // 3-way
  assert.deepEqual(RIVER_PIECE_DEFINITIONS['river-intersectionA'].localEdges, [3, 4, 5]);
  assert.deepEqual(RIVER_PIECE_DEFINITIONS['river-intersectionB'].localEdges, [0, 3, 5]);
  assert.deepEqual(RIVER_PIECE_DEFINITIONS['river-intersectionC'].localEdges, [0, 1, 3]);
  assert.deepEqual(RIVER_PIECE_DEFINITIONS['river-intersectionF'].localEdges, [1, 3, 5]);

  // 4-way
  assert.deepEqual(RIVER_PIECE_DEFINITIONS['river-intersectionD'].localEdges, [0, 1, 3, 5]);
  assert.deepEqual(RIVER_PIECE_DEFINITIONS['river-intersectionE'].localEdges, [0, 1, 3, 4]);
  assert.deepEqual(RIVER_PIECE_DEFINITIONS['river-intersectionH'].localEdges, [0, 3, 4, 5]);

  // 5-way
  assert.deepEqual(RIVER_PIECE_DEFINITIONS['river-intersectionG'].localEdges, [0, 1, 3, 4, 5]);

  // 6-way
  assert.deepEqual(RIVER_PIECE_DEFINITIONS['river-crossing'].localEdges, [0, 1, 2, 3, 4, 5]);
});

test('localEdgeToWorldDirection and worldDirectionToLocalEdge are exact inverses', () => {
  for (const rot of ALLOWED_ORIENTATIONS) {
    for (let e = 0; e < 6; e++) {
      const worldDir = localEdgeToWorldDirection(e, rot);
      const backToLocal = worldDirectionToLocalEdge(worldDir, rot);
      assert.equal(backToLocal, e, `Roundtrip failed for localEdge ${e} at rot ${rot}`);
    }
  }
});

test('selectRiverPiece maps all 63 non-empty subsets of 6 directions with exact exit roundtrip', () => {
  // Generate all non-empty subsets of [0..5]
  function* getSubsets(arr: number[]): Generator<number[]> {
    const len = arr.length;
    for (let i = 1; i < 1 << len; i++) {
      const subset: number[] = [];
      for (let j = 0; j < len; j++) {
        if (i & (1 << j)) subset.push(arr[j]);
      }
      yield subset;
    }
  }

  let totalTested = 0;
  for (const subset of getSubsets([0, 1, 2, 3, 4, 5])) {
    const { pieceName, orientation } = selectRiverPiece(subset);
    const exits = getRiverPieceExits(pieceName, orientation);
    assert.deepEqual(
      exits,
      subset,
      `Mismatch for requested directions [${subset}] -> got piece ${pieceName} at ${orientation}° with exits [${exits}]`
    );
    totalTested++;
  }
  assert.equal(totalTested, 63, 'Expected exactly 63 non-empty subsets');
});

test('selectRiverPiece respects role: source -> river-start, mouth -> river-end', () => {
  for (let dir = 0; dir < 6; dir++) {
    const source = selectRiverPiece([dir], 'source');
    assert.equal(source.pieceName, 'river-start');
    assert.deepEqual(getRiverPieceExits(source.pieceName, source.orientation), [dir]);

    const mouth = selectRiverPiece([dir], 'mouth');
    assert.equal(mouth.pieceName, 'river-end');
    assert.deepEqual(getRiverPieceExits(mouth.pieceName, mouth.orientation), [dir]);
  }
});

test('isRiverPieceName validates all 14 river model names', () => {
  const expected: RiverPieceName[] = [
    'river-start',
    'river-end',
    'river-straight',
    'river-corner',
    'river-corner-sharp',
    'river-intersectionA',
    'river-intersectionB',
    'river-intersectionC',
    'river-intersectionD',
    'river-intersectionE',
    'river-intersectionF',
    'river-intersectionG',
    'river-intersectionH',
    'river-crossing',
  ];
  for (const name of expected) {
    assert.ok(isRiverPieceName(name), `${name} should be recognized`);
  }
  assert.ok(!isRiverPieceName('grass'));
  assert.ok(!isRiverPieceName('stone-mountain'));
});
