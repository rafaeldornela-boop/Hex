/**
 * KayKit Medieval Hexagon Pack — visual pilot layer.
 *
 * Goal: richer hexes (base tile + separate props) on a small map region
 * without changing game logic (economy, terrain rules, save/load, etc.).
 *
 * Assets: CC0 from KayKit-Game-Assets/KayKit-Medieval-Hexagon-Pack-1.0
 * Served from jsDelivr CDN (no local binary required for GitHub Pages).
 */

export const KAYKIT_PILOT_ENABLED = true;

/** Axial radius from origin where pilot composition applies. */
export const KAYKIT_PILOT_RADIUS = 2;

/**
 * Uniform scale so KayKit hex tiles match board spacing (HEX_WORLD_SCALE ≈ 2.05).
 * Tune this if tiles leave gaps or overlap after visual QA.
 */
export const KAYKIT_MODEL_SCALE = 2.05;

export type KaykitPropPlacement = {
  /** Path under /kaykit/ without leading slash, e.g. decoration/nature/tree_single_A.gltf */
  path: string;
  /** Local offset in hex-local units (before world scale). */
  offset?: [number, number, number];
  /** Extra uniform scale multiplier on top of KAYKIT_MODEL_SCALE. */
  scale?: number;
  /** Y rotation in degrees. */
  rotationY?: number;
};

export type KaykitComposition = {
  /** Main mesh path under /kaykit/ */
  base: string;
  props?: KaykitPropPlacement[];
  /** Optional note for docs / debugging */
  label?: string;
};

/** jsDelivr CDN root for KayKit FREE pack GLTF assets (CC0). */
export const KAYKIT_CDN_ROOT =
  'https://cdn.jsdelivr.net/gh/KayKit-Game-Assets/KayKit-Medieval-Hexagon-Pack-1.0@main/addons/kaykit_medieval_hexagon_pack/Assets/gltf';

/** Public URL for a kaykit relative path (CDN — no local binary required). */
export function kaykitUrl(relPath: string): string {
  return `${KAYKIT_CDN_ROOT}/${relPath.replace(/^\//, '')}`;
}

export function isKaykitPilotTile(q: number, r: number): boolean {
  if (!KAYKIT_PILOT_ENABLED) return false;
  // cube distance on axial: |q| + |r| + |s| with s = -q-r
  const s = -q - r;
  const dist = (Math.abs(q) + Math.abs(r) + Math.abs(s)) / 2;
  return dist <= KAYKIT_PILOT_RADIUS;
}

/**
 * Map current HEX logical asset names → KayKit base + optional props.
 * Only names that appear in the pilot download set are listed.
 * Unknown names return null → keep legacy GLB path.
 */
const COMPOSITIONS: Record<string, KaykitComposition> = {
  grass: {
    label: 'plain grass',
    base: 'tiles/base/hex_grass.gltf',
    props: [
      { path: 'decoration/nature/rock_single_A.gltf', offset: [0.22, 0, -0.18], scale: 0.85, rotationY: 25 },
    ],
  },
  'grass-forest': {
    label: 'forest',
    base: 'tiles/base/hex_grass.gltf',
    props: [
      { path: 'decoration/nature/trees_A_medium.gltf', offset: [0, 0, 0], scale: 1, rotationY: 0 },
      { path: 'decoration/nature/rock_single_B.gltf', offset: [-0.28, 0, 0.2], scale: 0.7, rotationY: 40 },
    ],
  },
  'grass-hill': {
    label: 'hills',
    base: 'tiles/base/hex_grass.gltf',
    props: [
      { path: 'decoration/nature/hill_single_A.gltf', offset: [0, 0, 0], scale: 1 },
      { path: 'decoration/nature/tree_single_A.gltf', offset: [0.25, 0, -0.15], scale: 0.8, rotationY: 15 },
    ],
  },
  dirt: {
    label: 'dirt',
    base: 'tiles/base/hex_grass.gltf',
    props: [{ path: 'buildings/neutral/building_dirt.gltf', offset: [0, 0, 0], scale: 1 }],
  },
  'dirt-lumber': {
    label: 'lumber yard dirt',
    base: 'tiles/base/hex_grass.gltf',
    props: [
      { path: 'decoration/props/resource_lumber.gltf', offset: [0.1, 0, 0.1], scale: 1 },
      { path: 'decoration/nature/tree_single_B.gltf', offset: [-0.2, 0, -0.15], scale: 0.9 },
    ],
  },
  'stone-mountain': {
    label: 'mountain',
    base: 'tiles/base/hex_grass.gltf',
    props: [{ path: 'decoration/nature/mountain_A_grass.gltf', offset: [0, 0, 0], scale: 1 }],
  },
  'stone-hill': {
    label: 'stone hill',
    base: 'tiles/base/hex_grass.gltf',
    props: [
      { path: 'decoration/nature/hill_single_B.gltf', offset: [0, 0, 0], scale: 1 },
      { path: 'decoration/nature/rock_single_C.gltf', offset: [0.2, 0, 0.15], scale: 0.9 },
    ],
  },
  'stone-rocks': {
    label: 'rocky',
    base: 'tiles/base/hex_grass.gltf',
    props: [
      { path: 'decoration/nature/rock_single_A.gltf', offset: [0.15, 0, 0.1], scale: 1 },
      { path: 'decoration/nature/rock_single_B.gltf', offset: [-0.2, 0, -0.12], scale: 0.85, rotationY: 50 },
      { path: 'decoration/nature/rock_single_C.gltf', offset: [0.05, 0, -0.25], scale: 0.7 },
    ],
  },
  stone: {
    label: 'stone',
    base: 'tiles/base/hex_grass.gltf',
    props: [{ path: 'decoration/nature/rock_single_C.gltf', offset: [0, 0, 0], scale: 1 }],
  },
  water: {
    label: 'water',
    base: 'tiles/base/hex_water.gltf',
  },
  'water-rocks': {
    label: 'water rocks',
    base: 'tiles/base/hex_water.gltf',
    props: [{ path: 'decoration/nature/rock_single_A.gltf', offset: [0.2, 0, 0], scale: 0.8 }],
  },
  'water-island': {
    label: 'island',
    base: 'tiles/base/hex_grass.gltf',
    props: [
      { path: 'decoration/nature/tree_single_A.gltf', offset: [0, 0, 0], scale: 0.75 },
      { path: 'decoration/nature/rock_single_B.gltf', offset: [0.22, 0, 0.1], scale: 0.6 },
    ],
  },
  sand: {
    label: 'sand',
    base: 'tiles/base/hex_grass.gltf',
  },
  'sand-desert': {
    label: 'desert',
    base: 'tiles/base/hex_grass.gltf',
    props: [{ path: 'decoration/nature/rock_single_A.gltf', offset: [0.1, 0, -0.1], scale: 0.9 }],
  },
  'sand-rocks': {
    label: 'sand rocks',
    base: 'tiles/base/hex_grass.gltf',
    props: [
      { path: 'decoration/nature/rock_single_A.gltf', offset: [0.15, 0, 0], scale: 0.85 },
      { path: 'decoration/nature/rock_single_C.gltf', offset: [-0.18, 0, 0.12], scale: 0.7 },
    ],
  },
  // Roads — sample subset
  'path-straight': {
    label: 'road straight',
    base: 'tiles/roads/hex_road_A.gltf',
  },
  'path-corner': {
    label: 'road corner',
    base: 'tiles/roads/hex_road_B.gltf',
  },
  'path-end': {
    label: 'road end',
    base: 'tiles/roads/hex_road_C.gltf',
  },
  'path-crossing': {
    label: 'road crossing',
    base: 'tiles/roads/hex_road_D.gltf',
  },
  // Rivers — sample
  'river-straight': {
    label: 'river straight',
    base: 'tiles/rivers/hex_river_A.gltf',
  },
  'river-corner': {
    label: 'river corner',
    base: 'tiles/rivers/hex_river_B.gltf',
  },
  'river-crossing': {
    label: 'river crossing',
    base: 'tiles/rivers/hex_river_crossing_A.gltf',
  },
  bridge: {
    label: 'bridge',
    base: 'tiles/base/hex_grass.gltf',
    props: [{ path: 'buildings/neutral/building_bridge_A.gltf', offset: [0, 0, 0], scale: 1 }],
  },
  // Buildings (player color: blue for pilot)
  'building-farm': {
    label: 'farm',
    base: 'tiles/base/hex_grass.gltf',
    props: [
      { path: 'buildings/neutral/building_grain.gltf', offset: [0, 0, 0], scale: 1 },
      { path: 'decoration/props/sack.gltf', offset: [0.28, 0, 0.15], scale: 0.9, rotationY: 20 },
    ],
  },
  'building-house': {
    label: 'house',
    base: 'tiles/base/hex_grass.gltf',
    props: [
      { path: 'buildings/blue/building_home_A_blue.gltf', offset: [0, 0, 0], scale: 1 },
      { path: 'decoration/props/barrel.gltf', offset: [0.3, 0, -0.2], scale: 0.85 },
    ],
  },
  'building-cabin': {
    label: 'cabin',
    base: 'tiles/base/hex_grass.gltf',
    props: [{ path: 'buildings/blue/building_home_B_blue.gltf', offset: [0, 0, 0], scale: 1 }],
  },
  'building-market': {
    label: 'market',
    base: 'tiles/base/hex_grass.gltf',
    props: [
      { path: 'buildings/blue/building_market_blue.gltf', offset: [0, 0, 0], scale: 1 },
      { path: 'decoration/props/crate_A_small.gltf', offset: [0.32, 0, 0.18], scale: 0.9 },
      { path: 'decoration/props/wheelbarrow.gltf', offset: [-0.28, 0, 0.2], scale: 0.85, rotationY: -30 },
    ],
  },
  'building-mine': {
    label: 'mine',
    base: 'tiles/base/hex_grass.gltf',
    props: [
      { path: 'buildings/blue/building_mine_blue.gltf', offset: [0, 0, 0], scale: 1 },
      { path: 'decoration/props/resource_stone.gltf', offset: [0.3, 0, -0.15], scale: 0.9 },
    ],
  },
  'building-mill': {
    label: 'windmill',
    base: 'tiles/base/hex_grass.gltf',
    props: [{ path: 'buildings/blue/building_windmill_blue.gltf', offset: [0, 0, 0], scale: 1 }],
  },
  'building-watermill': {
    label: 'watermill',
    base: 'tiles/base/hex_grass.gltf',
    props: [{ path: 'buildings/blue/building_watermill_blue.gltf', offset: [0, 0, 0], scale: 1 }],
  },
  'building-tower': {
    label: 'tower',
    base: 'tiles/base/hex_grass.gltf',
    props: [{ path: 'buildings/blue/building_tower_A_blue.gltf', offset: [0, 0, 0], scale: 1 }],
  },
  'building-castle': {
    label: 'castle',
    base: 'tiles/base/hex_grass.gltf',
    props: [{ path: 'buildings/blue/building_castle_blue.gltf', offset: [0, 0, 0], scale: 1 }],
  },
  'building-village': {
    label: 'village well',
    base: 'tiles/base/hex_grass.gltf',
    props: [
      { path: 'buildings/blue/building_well_blue.gltf', offset: [0, 0, 0], scale: 1 },
      { path: 'buildings/blue/building_home_A_blue.gltf', offset: [0.15, 0, 0.2], scale: 0.75, rotationY: 40 },
    ],
  },
};

export function getKaykitComposition(assetName: string): KaykitComposition | null {
  return COMPOSITIONS[assetName] ?? null;
}

/** All unique kaykit model paths referenced by the pilot map (for preload). */
export function listKaykitPilotPaths(): string[] {
  const set = new Set<string>();
  for (const c of Object.values(COMPOSITIONS)) {
    set.add(c.base);
    for (const p of c.props ?? []) set.add(p.path);
  }
  return Array.from(set);
}

export function getKaykitPilotStats(): {
  enabled: boolean;
  radius: number;
  mappedAssets: number;
  modelPaths: number;
} {
  return {
    enabled: KAYKIT_PILOT_ENABLED,
    radius: KAYKIT_PILOT_RADIUS,
    mappedAssets: Object.keys(COMPOSITIONS).length,
    modelPaths: listKaykitPilotPaths().length,
  };
}
