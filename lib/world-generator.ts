import type { HexAssetEntry } from './godot-docs';
import {
  DEFAULT_ROTATION_DEG,
  HEX_WORLD_SCALE,
  INITIAL_CASH,
  axialToWorld,
  hexKey,
  type AxialCoord,
  type HexOwner,
  type HexWorldState,
  type PlacedHex,
} from './hex-engine';
import {
  DEFAULT_FOREST_WOOD_STOCK,
  TERRAIN_METADATA,
  getResourceForTerrain,
  type RareFeatureType,
  type TerrainType,
} from './terrain-engine';
import { AXIAL_DIRECTIONS } from './territory-engine';
import { createInitialFactions, type FactionState } from './faction-engine';
import { UNIT_CATALOG, type UnitEntity } from './military-engine';

export const DEFAULT_WORLD_SEED = 42026;
export const WORLD_COLS = 32;
export const WORLD_ROWS = 32;

export type WorldBiomeProfile =
  | 'river_valley'
  | 'highland_ore'
  | 'emerald_forests'
  | 'coastal_frontier';

export interface ProceduralWorldResult {
  seed: number;
  biomeProfile: WorldBiomeProfile;
  worldState: HexWorldState;
  playerCapital: AxialCoord;
  factions: FactionState[];
  units: UnitEntity[];
}

export function createRandomWorldSeed(): number {
  return Math.floor(100000 + Math.random() * 89999999);
}

export function axialDistance(a: AxialCoord, b: AxialCoord): number {
  return (
    (Math.abs(a.q - b.q) +
      Math.abs(a.q + a.r - b.q - b.r) +
      Math.abs(a.r - b.r)) /
    2
  );
}

function createMulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2d(ix: number, iy: number, seed: number): number {
  let h =
    Math.imul(ix, 374761393) ^
    Math.imul(iy, 668265263) ^
    Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function valueNoise2d(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = smoothstep(x - ix);
  const fy = smoothstep(y - iy);

  const v00 = hash2d(ix, iy, seed);
  const v10 = hash2d(ix + 1, iy, seed);
  const v01 = hash2d(ix, iy + 1, seed);
  const v11 = hash2d(ix + 1, iy + 1, seed);

  return lerp(lerp(v00, v10, fx), lerp(v01, v11, fx), fy);
}

function fbm2d(
  x: number,
  y: number,
  seed: number,
  octaves = 4,
  lacunarity = 2.05,
  gain = 0.5
): number {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;

  for (let i = 0; i < octaves; i++) {
    sum += valueNoise2d(x * freq, y * freq, seed + i * 1013) * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }

  return sum / norm;
}

function ridge2d(x: number, y: number, seed: number): number {
  const n = fbm2d(x, y, seed, 3);
  return 1 - Math.abs(n * 2 - 1);
}

interface InternalCell {
  col: number;
  row: number;
  q: number;
  r: number;
  wx: number;
  wz: number;
  elevation: number;
  moisture: number;
  ridge: number;
  terrainType: TerrainType;
  riverTile: boolean;
  rareFeature: RareFeatureType;
}

const BIOME_PROFILES: WorldBiomeProfile[] = [
  'river_valley',
  'highland_ore',
  'emerald_forests',
  'coastal_frontier',
];

function selectBiomeProfile(seed: number): WorldBiomeProfile {
  return BIOME_PROFILES[Math.abs(seed) % BIOME_PROFILES.length];
}

function pickTerrainAssetName(
  terrainType: TerrainType,
  elevation: number,
  roll: number,
  nearCoast: boolean
): string {
  switch (terrainType) {
    case 'plains':
      return elevation > 0.56 || roll > 0.82 ? 'grass-hill' : 'grass';
    case 'forest':
      return 'grass-forest';
    case 'mountain':
      if (elevation > 0.78 || roll < 0.55) return 'stone-mountain';
      if (roll < 0.86) return 'stone-hill';
      return 'stone-rocks';
    case 'fertile':
      return 'dirt';
    case 'water':
      if (!nearCoast && roll > 0.94) return 'water-island';
      if (nearCoast && roll > 0.86) return 'water-rocks';
      return 'water';
  }
}

export function generateProceduralKingdomWorld(
  assets: HexAssetEntry[],
  seed: number = DEFAULT_WORLD_SEED,
  cols: number = WORLD_COLS,
  rows: number = WORLD_ROWS
): ProceduralWorldResult {
  const rng = createMulberry32(seed);
  const biomeProfile = selectBiomeProfile(seed);

  const indexByName = new Map<string, number>();
  assets.forEach((a, idx) => indexByName.set(a.name, idx));
  const idxOf = (name: string, fallback = 0): number =>
    indexByName.get(name) ?? fallback;

  const halfCols = Math.floor(cols / 2);
  const halfRows = Math.floor(rows / 2);

  const cells = new Map<string, InternalCell>();
  const cellList: InternalCell[] = [];

  // Biome bias weights
  const seaLevel =
    biomeProfile === 'coastal_frontier'
      ? 0.36
      : biomeProfile === 'river_valley'
        ? 0.28
        : 0.26;
  const mountainThreshold =
    biomeProfile === 'highland_ore'
      ? 0.7
      : biomeProfile === 'emerald_forests'
        ? 0.78
        : 0.75;
  const forestMoistureThreshold =
    biomeProfile === 'emerald_forests'
      ? 0.48
      : biomeProfile === 'highland_ore'
        ? 0.56
        : 0.53;

  // 1. Generate coherent elevation, moisture, and ridge fields
  for (let col = 0; col < cols; col++) {
    const q = col - halfCols;
    const rowOffset = Math.floor(q / 2);
    for (let row = 0; row < rows; row++) {
      const r = row - halfRows - rowOffset;
      const worldPos = axialToWorld(q, r);

      // Normalized grid coordinates [-1, 1] for organic continental coastline
      const nx = (col / (cols - 1)) * 2 - 1;
      const ny = (row / (rows - 1)) * 2 - 1;
      const edgeDist = Math.max(Math.abs(nx), Math.abs(ny));
      const radialDist = Math.hypot(nx * 0.92, ny * 0.92);
      const continentMask = Math.max(edgeDist * 0.88, radialDist * 0.92);

      // Domain-warped world space sampling (invariant to HEX_WORLD_SCALE)
      const scaleInv = 1.65 / HEX_WORLD_SCALE;
      const sx = worldPos.x * scaleInv * 0.085;
      const sz = worldPos.z * scaleInv * 0.085;
      const warpX = (fbm2d(sx + 11.3, sz - 7.1, seed + 17, 2) - 0.5) * 1.45;
      const warpZ = (fbm2d(sx - 5.7, sz + 14.2, seed + 53, 2) - 0.5) * 1.45;

      const baseElev = fbm2d(sx + warpX, sz + warpZ, seed + 101, 4);
      const ridgeVal = ridge2d(sx * 1.15 + warpX * 0.6, sz * 1.15 + warpZ * 0.6, seed + 307);
      const moisture = fbm2d(sx * 1.1 - warpZ * 0.4, sz * 1.1 + warpX * 0.4, seed + 709, 3);

      const coastalDrop = Math.pow(Math.max(0, continentMask - 0.58) / 0.44, 1.75) * 0.68;
      const combinedElev = Math.max(
        0,
        Math.min(1, baseElev * 0.72 + ridgeVal * 0.28 - coastalDrop)
      );

      let terrainType: TerrainType = 'plains';
      if (combinedElev < seaLevel) {
        terrainType = 'water';
      } else if (
        combinedElev > mountainThreshold ||
        (ridgeVal > 0.91 && combinedElev > seaLevel + 0.22)
      ) {
        terrainType = 'mountain';
      } else if (moisture > forestMoistureThreshold) {
        terrainType = 'forest';
      } else if (
        moisture > forestMoistureThreshold - 0.07 &&
        combinedElev < 0.46 &&
        ridgeVal < 0.76
      ) {
        terrainType = 'fertile';
      }

      const cell: InternalCell = {
        col,
        row,
        q,
        r,
        wx: worldPos.x,
        wz: worldPos.z,
        elevation: combinedElev,
        moisture,
        ridge: ridgeVal,
        terrainType,
        riverTile: false,
        rareFeature: 'none',
      };
      cells.set(hexKey(q, r), cell);
      cellList.push(cell);
    }
  }

  // 2. Carve 2-3 continuous downhill meandering rivers + lakes from highlands to coast
  const riverSources = cellList
    .filter(
      (c) =>
        c.col >= 5 &&
        c.col <= cols - 6 &&
        c.row >= 5 &&
        c.row <= rows - 6 &&
        c.elevation > 0.56 &&
        c.elevation < 0.78
    )
    .sort((a, b) => b.elevation - a.elevation);

  const riverTargetCount = biomeProfile === 'river_valley' ? 3 : 2;
  const chosenSources: InternalCell[] = [];
  for (const cand of riverSources) {
    if (
      chosenSources.every(
        (prev) => axialDistance(prev, cand) >= 9
      )
    ) {
      chosenSources.push(cand);
      if (chosenSources.length >= riverTargetCount) break;
    }
  }

  for (const source of chosenSources) {
    let curr: InternalCell | undefined = source;
    const visited = new Set<string>();
    for (let step = 0; step < 34 && curr; step++) {
      const k = hexKey(curr.q, curr.r);
      visited.add(k);
      curr.terrainType = 'water';
      curr.riverTile = true;

      // Collect unvisited neighbors and bias smoothly downhill toward lowest elevation
      const neighbors: InternalCell[] = [];
      for (const dir of AXIAL_DIRECTIONS) {
        const n = cells.get(hexKey(curr.q + dir.q, curr.r + dir.r));
        if (n && !visited.has(hexKey(n.q, n.r))) {
          neighbors.push(n);
        }
      }
      if (neighbors.length === 0) break;

      // Stop if river reached open sea (water tile that wasn't just carved by this river)
      const seaNeighbor = neighbors.find((n) => n.terrainType === 'water' && !n.riverTile);
      if (seaNeighbor && step >= 4) break;

      neighbors.sort((a, b) => {
        const jitterA = (hash2d(a.col, a.row, seed + step) - 0.5) * 0.04;
        const jitterB = (hash2d(b.col, b.row, seed + step) - 0.5) * 0.04;
        return a.elevation + jitterA - (b.elevation + jitterB);
      });
      curr = neighbors[0];
    }
  }

  // 3. Turn riverbanks & moist valley floors into coherent fertile strips
  for (const cell of cellList) {
    if (cell.terrainType === 'water' || cell.terrainType === 'mountain') continue;
    let waterNeighbors = 0;
    let riverNeighbors = 0;
    for (const dir of AXIAL_DIRECTIONS) {
      const n = cells.get(hexKey(cell.q + dir.q, cell.r + dir.r));
      if (n?.terrainType === 'water') {
        waterNeighbors++;
        if (n.riverTile) riverNeighbors++;
      }
    }
    if (riverNeighbors >= 1 && cell.elevation < 0.64) {
      cell.terrainType = 'fertile';
    } else if (
      waterNeighbors >= 1 &&
      cell.moisture > 0.51 &&
      cell.elevation < 0.45
    ) {
      cell.terrainType = 'fertile';
    }
  }

  // 4. Cellular smoothing pass: clean 1-tile isolated noise spikes for readable terrain clusters
  const smoothedTypes = new Map<string, TerrainType>();
  for (const cell of cellList) {
    if (cell.riverTile) {
      smoothedTypes.set(hexKey(cell.q, cell.r), 'water');
      continue;
    }
    const counts: Record<TerrainType, number> = {
      plains: 0,
      forest: 0,
      mountain: 0,
      water: 0,
      fertile: 0,
    };
    let totalN = 0;
    for (const dir of AXIAL_DIRECTIONS) {
      const n = cells.get(hexKey(cell.q + dir.q, cell.r + dir.r));
      if (n) {
        counts[n.terrainType]++;
        totalN++;
      }
    }
    const sameCount = counts[cell.terrainType];
    if (totalN >= 5 && sameCount === 0) {
      // Replace lone outlier with dominant neighbor biome
      let bestType: TerrainType = cell.terrainType;
      let bestCount = -1;
      for (const t of ['plains', 'forest', 'fertile', 'mountain', 'water'] as TerrainType[]) {
        if (counts[t] > bestCount) {
          bestCount = counts[t];
          bestType = t;
        }
      }
      smoothedTypes.set(hexKey(cell.q, cell.r), bestType);
    } else {
      smoothedTypes.set(hexKey(cell.q, cell.r), cell.terrainType);
    }
  }
  for (const cell of cellList) {
    cell.terrainType = smoothedTypes.get(hexKey(cell.q, cell.r)) ?? cell.terrainType;
  }

  // 5. Assign spaced strategic rare features across the map
  const placedRares: AxialCoord[] = [];
  for (const cell of cellList) {
    if (cell.col < 3 || cell.col > cols - 4 || cell.row < 3 || cell.row > rows - 4) {
      continue;
    }
    const roll = hash2d(cell.col + 31, cell.row - 19, seed + 991);
    let candidate: RareFeatureType = 'none';
    if (cell.terrainType === 'mountain' && roll < 0.085) {
      candidate = roll < 0.03 ? 'gold_vein' : 'pure_iron';
    } else if (cell.terrainType === 'fertile' && roll < 0.06) {
      candidate = 'rich_soil';
    } else if (cell.terrainType === 'water' && !cell.riverTile && roll < 0.05) {
      // Natural harbor only if adjacent to at least 1 land hex
      const hasLand = AXIAL_DIRECTIONS.some((dir) => {
        const n = cells.get(hexKey(cell.q + dir.q, cell.r + dir.r));
        return n && n.terrainType !== 'water';
      });
      if (hasLand) candidate = 'natural_harbor';
    } else if (
      (cell.terrainType === 'forest' || cell.terrainType === 'plains') &&
      roll < 0.028
    ) {
      candidate = 'arcane_crystal';
    }

    if (
      candidate !== 'none' &&
      placedRares.every((prev) => axialDistance(prev, cell) >= 4)
    ) {
      cell.rareFeature = candidate;
      placedRares.push({ q: cell.q, r: cell.r });
    }
  }

  // 6. Helper to measure reachable land mass from a candidate site
  const countReachableLand = (start: AxialCoord, maxVisit = 40): number => {
    const startCell = cells.get(hexKey(start.q, start.r));
    if (!startCell || startCell.terrainType === 'water') return 0;
    const seen = new Set<string>([hexKey(start.q, start.r)]);
    const queue: InternalCell[] = [startCell];
    let head = 0;
    while (head < queue.length && seen.size < maxVisit) {
      const cur = queue[head++];
      for (const dir of AXIAL_DIRECTIONS) {
        const n = cells.get(hexKey(cur.q + dir.q, cur.r + dir.r));
        if (!n || n.terrainType === 'water') continue;
        const nk = hexKey(n.q, n.r);
        if (!seen.has(nk)) {
          seen.add(nk);
          queue.push(n);
        }
      }
    }
    return seen.size;
  };

  // 7. Find viable player starting site near center of landmass
  const centerCoord = {
    q: 0,
    r: 0,
  };
  let bestPlayerSite: InternalCell | null = null;
  let bestPlayerScore = -Infinity;

  for (const cell of cellList) {
    if (cell.col < 6 || cell.col > cols - 7 || cell.row < 6 || cell.row > rows - 7) {
      continue;
    }
    if (cell.terrainType === 'water' || cell.terrainType === 'mountain') continue;

    let landRing1 = 0;
    for (const dir of AXIAL_DIRECTIONS) {
      const n = cells.get(hexKey(cell.q + dir.q, cell.r + dir.r));
      if (n && n.terrainType !== 'water') landRing1++;
    }
    if (landRing1 < 5) continue;

    const reachable = countReachableLand(cell, 32);
    if (reachable < 16) continue;

    // Score proximity to food, wood, ore, water within radius 3 + near map center
    let hasFertile = false;
    let hasForest = false;
    let hasMountain = false;
    let hasWater = false;
    for (const other of cellList) {
      const d = axialDistance(cell, other);
      if (d === 0 || d > 3) continue;
      if (other.terrainType === 'fertile') hasFertile = true;
      else if (other.terrainType === 'forest') hasForest = true;
      else if (other.terrainType === 'mountain') hasMountain = true;
      else if (other.terrainType === 'water') hasWater = true;
    }

    const distFromOrigin = axialDistance(cell, centerCoord);
    const score =
      landRing1 * 6 +
      (cell.terrainType === 'plains' ? 8 : 4) +
      (hasFertile ? 16 : 0) +
      (hasForest ? 16 : 0) +
      (hasMountain ? 12 : 0) +
      (hasWater ? 6 : 0) -
      distFromOrigin * 1.8;

    if (score > bestPlayerScore) {
      bestPlayerScore = score;
      bestPlayerSite = cell;
    }
  }

  // Absolute fallback if a super watery edge case occurred
  if (!bestPlayerSite) {
    bestPlayerSite =
      cells.get(hexKey(0, 0)) ?? cellList[Math.floor(cellList.length / 2)];
    bestPlayerSite.terrainType = 'plains';
  }

  const playerCapital: AxialCoord = {
    q: bestPlayerSite.q,
    r: bestPlayerSite.r,
  };

  // Guarantee fertile + forest presence on immediate ring-2 frontier around player start
  const ring2Coords: InternalCell[] = [];
  for (const other of cellList) {
    if (axialDistance(playerCapital, other) === 2) {
      ring2Coords.push(other);
    }
  }
  const hasRing2Fertile = ring2Coords.some((c) => c.terrainType === 'fertile');
  if (!hasRing2Fertile) {
    const cand =
      ring2Coords.find((c) => c.terrainType === 'plains') ??
      ring2Coords.find((c) => c.terrainType !== 'water') ??
      ring2Coords[0];
    if (cand) cand.terrainType = 'fertile';
  }
  const hasRing2Forest = ring2Coords.some((c) => c.terrainType === 'forest');
  if (!hasRing2Forest) {
    const cand =
      ring2Coords.find((c) => c.terrainType === 'plains') ??
      ring2Coords.find((c) => c.terrainType !== 'water' && c.terrainType !== 'fertile') ??
      ring2Coords[1];
    if (cand) cand.terrainType = 'forest';
  }

  // Build base PlacedHex map for all 1,024 tiles
  const hexes: Record<string, PlacedHex> = {};
  for (const cell of cellList) {
    const nearCoast = AXIAL_DIRECTIONS.some((dir) => {
      const n = cells.get(hexKey(cell.q + dir.q, cell.r + dir.r));
      return n && n.terrainType !== 'water';
    });
    const roll = hash2d(cell.col, cell.row, seed + 444);
    const assetName = pickTerrainAssetName(
      cell.terrainType,
      cell.elevation,
      roll,
      nearCoast
    );
    const resInfo = getResourceForTerrain(cell.terrainType);
    const orientation =
      cell.terrainType === 'water'
        ? DEFAULT_ROTATION_DEG
        : ((Math.floor(rng() * 6) * 60 + DEFAULT_ROTATION_DEG) % 360);

    hexes[hexKey(cell.q, cell.r)] = {
      q: cell.q,
      r: cell.r,
      orientation,
      structureIndex: idxOf(assetName, idxOf('grass')),
      owner: 'neutral',
      terrainType: cell.terrainType,
      resourceType: resInfo.resourceType,
      resourceAmount: resInfo.resourceAmount,
      ...(cell.terrainType === 'forest'
        ? { woodStock: DEFAULT_FOREST_WOOD_STOCK }
        : {}),
      ...(cell.rareFeature !== 'none' ? { rareFeature: cell.rareFeature } : {}),
    };
  }

  // Helper to stamp a starting hub safely onto valid connected land
  const applyOwnedHub = (
    hubCenter: AxialCoord,
    owner: HexOwner,
    centerAsset: string,
    neighborLayouts: Array<{
      asset: string | null;
      terrainType?: TerrainType;
      orientation?: number;
    }>
  ): AxialCoord[] => {
    const placedCoords: AxialCoord[] = [];
    const centerKey = hexKey(hubCenter.q, hubCenter.r);
    const centerTile = hexes[centerKey];
    if (centerTile) {
      const centerTerrain: TerrainType =
        centerTile.terrainType === 'water' || centerTile.terrainType === 'mountain'
          ? 'plains'
          : centerTile.terrainType ?? 'plains';
      const centerRes = getResourceForTerrain(centerTerrain);
      hexes[centerKey] = {
        ...centerTile,
        owner,
        orientation: DEFAULT_ROTATION_DEG,
        structureIndex: idxOf(centerAsset),
        terrainType: centerTerrain,
        resourceType: centerRes.resourceType,
        resourceAmount: centerRes.resourceAmount,
        rareFeature: undefined,
      };
      placedCoords.push(hubCenter);
    }

    for (let i = 0; i < AXIAL_DIRECTIONS.length && i < neighborLayouts.length; i++) {
      const dir = AXIAL_DIRECTIONS[i];
      const nCoord = { q: hubCenter.q + dir.q, r: hubCenter.r + dir.r };
      const nKey = hexKey(nCoord.q, nCoord.r);
      const nTile = hexes[nKey];
      if (!nTile) continue;
      const layout = neighborLayouts[i];

      let nextTerrain: TerrainType = layout.terrainType ?? nTile.terrainType ?? 'plains';
      if (nextTerrain === 'water') {
        nextTerrain = 'plains';
      }
      if (!layout.terrainType && layout.asset === null && nTile.terrainType === 'water') {
        nextTerrain = 'plains';
      }
      if (!layout.terrainType && layout.asset === 'building-mine') {
        nextTerrain = 'mountain';
      }
      if (!layout.terrainType && layout.asset === 'building-farm') {
        nextTerrain = 'fertile';
      }
      if (
        !layout.terrainType &&
        (layout.asset === 'building-market' ||
          layout.asset === 'building-house' ||
          layout.asset === 'building-village' ||
          layout.asset === 'building-mill' ||
          layout.asset === 'building-tower' ||
          layout.asset === 'building-archery') &&
        nextTerrain === 'mountain'
      ) {
        nextTerrain = 'plains';
      }

      const resInfo = getResourceForTerrain(nextTerrain);
      const fallbackTerrainAsset = TERRAIN_METADATA[nextTerrain].defaultAssetName;
      hexes[nKey] = {
        ...nTile,
        owner,
        orientation: layout.orientation ?? DEFAULT_ROTATION_DEG,
        structureIndex: layout.asset
          ? idxOf(layout.asset)
          : idxOf(fallbackTerrainAsset),
        terrainType: nextTerrain,
        resourceType: resInfo.resourceType,
        resourceAmount: resInfo.resourceAmount,
      };
      placedCoords.push(nCoord);
    }

    return placedCoords;
  };

  // 8. Stamp 7-hex Player Core (matches starter economy identically + 1 free owned hex!)
  applyOwnedHub(playerCapital, 'player', 'building-castle', [
    { asset: 'building-market', terrainType: 'plains', orientation: 150 },
    { asset: 'building-house', terrainType: 'plains', orientation: 90 },
    { asset: 'building-village', terrainType: 'plains', orientation: 210 },
    { asset: 'building-farm', terrainType: 'fertile', orientation: 90 },
    { asset: 'building-mill', terrainType: 'plains', orientation: 90 },
    { asset: null, terrainType: 'plains' }, // Free owned plains hex ready for player's first contextual construction
  ]);

  // 9. Find viable rival hub sites well-separated from player & each other
  const pickRivalSite = (
    excludeSites: AxialCoord[],
    preferMountain: boolean
  ): AxialCoord => {
    let best: InternalCell | null = null;
    let bestScore = -Infinity;

    for (const cell of cellList) {
      if (cell.col < 4 || cell.col > cols - 5 || cell.row < 4 || cell.row > rows - 5) {
        continue;
      }
      if (cell.terrainType === 'water') continue;
      const distPlayer = axialDistance(cell, playerCapital);
      if (distPlayer < 6 || distPlayer > 12) continue;
      if (excludeSites.some((ex) => axialDistance(cell, ex) < 6)) continue;

      let landN = 0;
      let mountainN = 0;
      let fertileN = 0;
      for (const dir of AXIAL_DIRECTIONS) {
        const n = cells.get(hexKey(cell.q + dir.q, cell.r + dir.r));
        if (n && n.terrainType !== 'water') landN++;
        if (n?.terrainType === 'mountain') mountainN++;
        if (n?.terrainType === 'fertile') fertileN++;
      }
      if (landN < 4) continue;

      const score =
        landN * 5 +
        (preferMountain ? mountainN * 8 : fertileN * 8) -
        Math.abs(distPlayer - 8) * 3;
      if (score > bestScore) {
        bestScore = score;
        best = cell;
      }
    }

    if (best) return { q: best.q, r: best.r };
    const fallback = cells.get(
      hexKey(
        playerCapital.q + (preferMountain ? 6 : -6),
        playerCapital.r + (preferMountain ? -2 : 4)
      )
    );
    return fallback
      ? { q: fallback.q, r: fallback.r }
      : { q: playerCapital.q + (preferMountain ? 5 : -5), r: playerCapital.r };
  };

  const ironSite = pickRivalSite([], true);
  const ironCoords = applyOwnedHub(ironSite, 'iron_clan', 'building-castle', [
    { asset: 'building-mine', terrainType: 'mountain' },
    { asset: 'building-tower', terrainType: 'plains' },
    { asset: 'building-archery', terrainType: 'plains' },
  ]);

  const azureSite = pickRivalSite([ironSite], false);
  const azureCoords = applyOwnedHub(azureSite, 'azure_league', 'building-castle', [
    { asset: 'building-market', terrainType: 'plains' },
    { asset: 'building-house', terrainType: 'plains' },
    { asset: 'building-farm', terrainType: 'fertile' },
  ]);

  const factions = createInitialFactions().map((f) => {
    if (f.id === 'iron_clan') return { ...f, capitalCoord: ironSite };
    if (f.id === 'azure_league') return { ...f, capitalCoord: azureSite };
    return f;
  });

  const ironUnitCoord = ironCoords[2] ?? ironSite;
  const azureUnitCoord = azureCoords[2] ?? azureSite;

  const units: UnitEntity[] = [
    {
      id: 'unit-iron-1',
      type: 'infantry',
      owner: 'iron_clan',
      q: ironUnitCoord.q,
      r: ironUnitCoord.r,
      hp: UNIT_CATALOG.infantry.maxHp,
      maxHp: UNIT_CATALOG.infantry.maxHp,
      movedThisTurn: false,
    },
    {
      id: 'unit-azure-1',
      type: 'archer',
      owner: 'azure_league',
      q: azureUnitCoord.q,
      r: azureUnitCoord.r,
      hp: UNIT_CATALOG.archer.maxHp,
      maxHp: UNIT_CATALOG.archer.maxHp,
      movedThisTurn: false,
    },
  ];

  return {
    seed,
    biomeProfile,
    worldState: {
      cash: INITIAL_CASH,
      hexes,
      seed,
      worldCols: cols,
      worldRows: rows,
    },
    playerCapital,
    factions,
    units,
  };
}
