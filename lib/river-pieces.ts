import { DEFAULT_ROTATION_DEG } from './hex-engine';

/**
 * Valid Kenney Hexagon river piece asset names matching .glb models in public/godot-assets/models/
 */
export type RiverPieceName =
  | 'river-start'
  | 'river-end'
  | 'river-straight'
  | 'river-corner'
  | 'river-corner-sharp'
  | 'river-intersectionA'
  | 'river-intersectionB'
  | 'river-intersectionC'
  | 'river-intersectionD'
  | 'river-intersectionE'
  | 'river-intersectionF'
  | 'river-intersectionG'
  | 'river-intersectionH'
  | 'river-crossing';

export interface RiverPieceDefinition {
  name: RiverPieceName;
  /**
   * Base local edge exits in model unrotated frame (0..5).
   * Directly measured from the geometry of public/godot-assets/models/*.glb
   * (water surface vertices at Y=0.1625, perimeter dist >= 0.38):
   * Edge 0 = 0°, Edge 1 = 60°, Edge 2 = 120°, Edge 3 = 180°, Edge 4 = 240°, Edge 5 = 300°.
   */
  localEdges: number[];
  /** Relative angle between channel arms for 2-exit pieces */
  bendAngleDeg?: number;
  description: string;
}

/**
 * Canonical curve edge reference.
 * CORRECTION: In earlier draft tables, river-corner and river-corner-sharp were inverted.
 * Measurement from GLB confirms:
 * - river-corner has exits 120° apart (2 hex edge steps: [1, 5] or [0, 2]), i.e. gentle bend.
 * - river-corner-sharp has exits 60° apart (adjacent edges: [0, 1]), i.e. sharp hairpin bend.
 */
export const CANONICAL_CURVE_EDGES = {
  'river-corner': [1, 5] as const, // 120° gentle curve (2 edge steps)
  'river-corner-sharp': [0, 1] as const, // 60° sharp turn (1 edge step / adjacent)
};

/**
 * Complete measured definitions for all 14 Kenney river models.
 * Verified directly against vertex geometry of the .glb assets.
 */
export const RIVER_PIECE_DEFINITIONS: Record<RiverPieceName, RiverPieceDefinition> = {
  'river-start': {
    name: 'river-start',
    localEdges: [3],
    description: 'Highland river source (1 outlet facing downstream)',
  },
  'river-end': {
    name: 'river-end',
    localEdges: [3],
    description: 'Coastal river mouth / foz (1 inlet connecting from river to open water)',
  },
  'river-straight': {
    name: 'river-straight',
    localEdges: [0, 3],
    bendAngleDeg: 180,
    description: 'Straight river channel through opposite hex faces (180°)',
  },
  'river-corner': {
    name: 'river-corner',
    localEdges: [3, 5],
    bendAngleDeg: 120,
    description: 'Gentle river bend (120° separation between edges, 60° deflection)',
  },
  'river-corner-sharp': {
    name: 'river-corner-sharp',
    localEdges: [3, 4],
    bendAngleDeg: 60,
    description: 'Sharp river turn (60° separation between adjacent edges, 120° deflection)',
  },
  'river-intersectionA': {
    name: 'river-intersectionA',
    localEdges: [3, 4, 5],
    description: '3-way junction with 3 consecutive adjacent edges',
  },
  'river-intersectionB': {
    name: 'river-intersectionB',
    localEdges: [0, 3, 5],
    description: '3-way T-junction: straight [0, 3] + right branch [5]',
  },
  'river-intersectionC': {
    name: 'river-intersectionC',
    localEdges: [0, 1, 3],
    description: '3-way T-junction: straight [0, 3] + left branch [1]',
  },
  'river-intersectionD': {
    name: 'river-intersectionD',
    localEdges: [0, 1, 3, 5],
    description: '4-way X-junction: straight [0, 3] + branches [1, 5]',
  },
  'river-intersectionE': {
    name: 'river-intersectionE',
    localEdges: [0, 1, 3, 4],
    description: '4-way junction: straight [0, 3] + branches [1, 4]',
  },
  'river-intersectionF': {
    name: 'river-intersectionF',
    localEdges: [1, 3, 5],
    description: '3-way symmetric Y-junction (120° between all 3 branches)',
  },
  'river-intersectionG': {
    name: 'river-intersectionG',
    localEdges: [0, 1, 3, 4, 5],
    description: '5-way junction connecting 5 edges',
  },
  'river-intersectionH': {
    name: 'river-intersectionH',
    localEdges: [0, 3, 4, 5],
    description: '4-way junction: straight [0, 3] + branches [4, 5]',
  },
  'river-crossing': {
    name: 'river-crossing',
    localEdges: [0, 1, 2, 3, 4, 5],
    description: '6-way grand intersection connecting all 6 hex edges',
  },
};

/**
 * Valid discrete orientation angles in degrees allowed on the board.
 * Step is 60°, base is DEFAULT_ROTATION_DEG (90°).
 */
export const ALLOWED_ORIENTATIONS: readonly number[] = [90, 150, 210, 270, 330, 30] as const;

/**
 * Map a local edge index e in [0..5] to world neighbor direction index in [0..5]
 * when the model is rotated by `orientationDeg` around +Y.
 */
export function localEdgeToWorldDirection(localEdge: number, orientationDeg: number): number {
  const worldAngleDeg = ((localEdge * 60 - orientationDeg) % 360 + 360) % 360;
  return (((worldAngleDeg - 30) / 60) % 6 + 6) % 6;
}

/**
 * Map a world neighbor direction index in [0..5] to local edge index in [0..5]
 * when the model is rotated by `orientationDeg` around +Y.
 */
export function worldDirectionToLocalEdge(worldDir: number, orientationDeg: number): number {
  const worldAngleDeg = 30 + worldDir * 60;
  const localAngleDeg = ((worldAngleDeg + orientationDeg) % 360 + 360) % 360;
  return Math.round(localAngleDeg / 60) % 6;
}

/**
 * Returns the sorted array of world neighbor direction indices (0..5)
 * that this placed piece connects to.
 */
export function getRiverPieceExits(pieceName: RiverPieceName, orientationDeg: number): number[] {
  const def = RIVER_PIECE_DEFINITIONS[pieceName];
  if (!def) return [];
  const exits = def.localEdges.map((e) => localEdgeToWorldDirection(e, orientationDeg));
  return Array.from(new Set(exits)).sort((a, b) => a - b);
}

// Precomputed lookup table mapping sorted world direction tuples to (pieceName, orientation)
const DIRECTION_LOOKUP = new Map<string, { pieceName: RiverPieceName; orientation: number }>();

function buildLookupTable(): void {
  // Populate all 63 combinations
  const piecesInOrder: RiverPieceName[] = [
    'river-straight',
    'river-corner',
    'river-corner-sharp',
    'river-intersectionF',
    'river-intersectionB',
    'river-intersectionC',
    'river-intersectionA',
    'river-intersectionD',
    'river-intersectionE',
    'river-intersectionH',
    'river-intersectionG',
    'river-crossing',
    'river-start',
  ];

  for (const name of piecesInOrder) {
    for (const rot of ALLOWED_ORIENTATIONS) {
      const exits = getRiverPieceExits(name, rot);
      const key = exits.join(',');
      if (!DIRECTION_LOOKUP.has(key)) {
        DIRECTION_LOOKUP.set(key, { pieceName: name, orientation: rot });
      }
    }
  }
}

buildLookupTable();

/**
 * Select the exact river piece and orientation to match a requested set of neighbor directions.
 *
 * @param directions Neighbor directions (0..5) matching AXIAL_DIRECTIONS where river connects
 * @param role 'source' for spring/nascente (river-start), 'mouth' for coastal outlet (river-end), or 'channel'
 */
export function selectRiverPiece(
  directions: number[],
  role: 'source' | 'mouth' | 'channel' = 'channel'
): { pieceName: RiverPieceName; orientation: number } {
  const uniqueDirs = Array.from(new Set(directions.map((d) => ((d % 6) + 6) % 6))).sort(
    (a, b) => a - b
  );

  if (uniqueDirs.length === 0) {
    return { pieceName: 'river-straight', orientation: DEFAULT_ROTATION_DEG };
  }

  // Single-connection endpoint: choose river-start (source) or river-end (mouth)
  if (uniqueDirs.length === 1) {
    const targetDir = uniqueDirs[0];
    const pieceName: RiverPieceName = role === 'mouth' ? 'river-end' : 'river-start';
    // Find orientation where localEdge 3 maps to targetDir
    for (const rot of ALLOWED_ORIENTATIONS) {
      if (localEdgeToWorldDirection(3, rot) === targetDir) {
        return { pieceName, orientation: rot };
      }
    }
    return { pieceName, orientation: DEFAULT_ROTATION_DEG };
  }

  const key = uniqueDirs.join(',');
  const match = DIRECTION_LOOKUP.get(key);
  if (match) {
    return match;
  }

  // Robust fallback for any ambiguous / unexpected pattern:
  // For 2 exits, fallback to straight; for 3+ exits, fallback to crossing
  if (uniqueDirs.length === 2) {
    return { pieceName: 'river-straight', orientation: DEFAULT_ROTATION_DEG };
  }
  return { pieceName: 'river-crossing', orientation: DEFAULT_ROTATION_DEG };
}

export function isRiverPieceName(name: string): name is RiverPieceName {
  return name in RIVER_PIECE_DEFINITIONS;
}
