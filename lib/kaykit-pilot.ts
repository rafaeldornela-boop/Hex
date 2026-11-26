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
