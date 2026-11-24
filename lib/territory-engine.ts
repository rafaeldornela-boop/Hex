import type { HexAssetEntry } from './godot-docs';
import {
  DEFAULT_ROTATION_DEG,
  hexKey,
  type AxialCoord,
  type HexWorldState,
  type PlacedHex,
} from './hex-engine';
import {
  TERRAIN_METADATA,
  getHexTerrainAndResource,
} from './terrain-engine';

export type HexOwner = 'player' | 'neutral';

export const DEFAULT_CONQUEST_COST = 500;

/**
 * Axial neighbor offsets matching flat-topped hexes in `axialToWorld(q, r)`.
 * Order matches hexagon edge index 0..5 (SE, S, SW, NW, N, NE) for border rendering.
 */
export const AXIAL_DIRECTIONS: readonly AxialCoord[] = [
  { q: 1, r: -1 }, // Edge 0->1: SE (+30°)
  { q: 0, r: -1 }, // Edge 1->2: S  (+90°)
  { q: -1, r: 0 }, // Edge 2->3: SW (+150°)
  { q: -1, r: 1 }, // Edge 3->4: NW (+210°)
  { q: 0, r: 1 }, // Edge 4->5: N  (+270°)
  { q: 1, r: 0 }, // Edge 5->0: NE (+330°)
] as const;

/**
 * Small initial player territory: castle center (0,0) + its 6 direct neighbors.
 */
export const INITIAL_PLAYER_TERRITORY_COORDS: readonly AxialCoord[] = [
  { q: 0, r: 0 },
  { q: 1, r: 0 },
  { q: -1, r: 0 },
  { q: 0, r: 1 },
  { q: 0, r: -1 },
  { q: 1, r: -1 },
  { q: -1, r: 1 },
] as const;

const INITIAL_TERRITORY_KEY_SET = new Set(
  INITIAL_PLAYER_TERRITORY_COORDS.map((c) => hexKey(c.q, c.r))
);

export function isInitialPlayerTerritoryCoord(q: number, r: number): boolean {
  return INITIAL_TERRITORY_KEY_SET.has(hexKey(q, r));
}

export function getAxialNeighbors(q: number, r: number): AxialCoord[] {
  return AXIAL_DIRECTIONS.map((dir) => ({
    q: q + dir.q,
    r: r + dir.r,
  }));
}

export function getHexOwner(
  state: HexWorldState,
  q: number,
  r: number
): HexOwner {
  const tile = state.hexes[hexKey(q, r)];
  return tile?.owner === 'player' ? 'player' : 'neutral';
}

export function countPlayerTerritory(state: HexWorldState): number {
  let count = 0;
  for (const tile of Object.values(state.hexes)) {
    if (tile.owner === 'player') {
      count++;
    }
  }
  return count;
}

/**
 * Checks whether (q, r) is directly adjacent to at least one player-owned hex.
 */
export function isAdjacentToPlayerTerritory(
  state: HexWorldState,
  q: number,
  r: number
): boolean {
  for (const dir of AXIAL_DIRECTIONS) {
    const neighborKey = hexKey(q + dir.q, r + dir.r);
    if (state.hexes[neighborKey]?.owner === 'player') {
      return true;
    }
  }
  return false;
}

/**
 * Isolated conquest cost rule.
 * Currently a fixed cost per hex; accepts tile/asset context so future terrain
 * or distance modifiers can be plugged in without changing callers.
 */
export function calculateConquestCost(
  _coord: AxialCoord,
  _existingTile?: PlacedHex | null,
  _assets?: HexAssetEntry[]
): number {
  return DEFAULT_CONQUEST_COST;
}

export type ConquestFailureReason =
  | 'already_owned'
  | 'not_adjacent'
  | 'insufficient_funds';

export interface ConquestCheckResult {
  canConquer: boolean;
  reason?: ConquestFailureReason;
  cost: number;
  owner: HexOwner;
  isAdjacent: boolean;
}

/**
 * Evaluates whether a hex at (q, r) can be conquered right now.
 */
export function evaluateConquest(
  state: HexWorldState,
  q: number,
  r: number,
  assets?: HexAssetEntry[]
): ConquestCheckResult {
  const key = hexKey(q, r);
  const existingTile = state.hexes[key] ?? null;
  const owner: HexOwner = existingTile?.owner === 'player' ? 'player' : 'neutral';
  const cost = calculateConquestCost({ q, r }, existingTile, assets);

  if (owner === 'player') {
    return {
      canConquer: false,
      reason: 'already_owned',
      cost,
      owner,
      isAdjacent: true,
    };
  }

  const adjacent = isAdjacentToPlayerTerritory(state, q, r);
  if (!adjacent) {
    return {
      canConquer: false,
      reason: 'not_adjacent',
      cost,
      owner,
      isAdjacent: false,
    };
  }

  if (state.cash < cost) {
    return {
      canConquer: false,
      reason: 'insufficient_funds',
      cost,
      owner,
      isAdjacent: true,
    };
  }

  return {
    canConquer: true,
    cost,
    owner,
    isAdjacent: true,
  };
}

export interface ConquestActionResult {
  nextState: HexWorldState;
  conquered: boolean;
  cost: number;
  reason?: ConquestFailureReason;
}

/**
 * Executes territorial conquest on a neutral adjacent hex.
 * - Existing neutral tiles keep their structure & orientation and become owned by 'player'.
 * - Empty adjacent grid coordinates expand the island with a player-owned grass hex.
 */
export function conquerHexInState(
  state: HexWorldState,
  q: number,
  r: number,
  assets: HexAssetEntry[]
): ConquestActionResult {
  const check = evaluateConquest(state, q, r, assets);
  if (!check.canConquer) {
    return {
      nextState: state,
      conquered: false,
      cost: check.cost,
      reason: check.reason,
    };
  }

  const key = hexKey(q, r);
  const existing = state.hexes[key];

  const terrainInfo = getHexTerrainAndResource(q, r, existing);
  let nextTile: PlacedHex;
  if (existing) {
    nextTile = {
      ...existing,
      owner: 'player',
      terrainType: terrainInfo.terrainType,
      resourceType: terrainInfo.resourceType,
      resourceAmount: terrainInfo.resourceAmount,
    };
  } else {
    const targetAssetName = TERRAIN_METADATA[terrainInfo.terrainType].defaultAssetName;
    const terrainAssetIdx = Math.max(
      0,
      assets.findIndex((a) => a.name === targetAssetName)
    );
    nextTile = {
      q,
      r,
      orientation: DEFAULT_ROTATION_DEG,
      structureIndex: terrainAssetIdx,
      owner: 'player',
      terrainType: terrainInfo.terrainType,
      resourceType: terrainInfo.resourceType,
      resourceAmount: terrainInfo.resourceAmount,
    };
  }

  return {
    nextState: {
      ...state,
      cash: state.cash - check.cost,
      hexes: {
        ...state.hexes,
        [key]: nextTile,
      },
    },
    conquered: true,
    cost: check.cost,
  };
}

/**
 * Returns all neutral coordinates directly adjacent to the player's territory.
 * Used by the 3D renderer to highlight valid expansion targets along the frontier.
 */
export function getConquerableFrontierCoords(state: HexWorldState): AxialCoord[] {
  const seen = new Set<string>();
  const frontier: AxialCoord[] = [];

  for (const tile of Object.values(state.hexes)) {
    if (tile.owner !== 'player') continue;
    for (const dir of AXIAL_DIRECTIONS) {
      const nq = tile.q + dir.q;
      const nr = tile.r + dir.r;
      const nKey = hexKey(nq, nr);
      if (seen.has(nKey)) continue;
      seen.add(nKey);
      if (state.hexes[nKey]?.owner !== 'player') {
        frontier.push({ q: nq, r: nr });
      }
    }
  }

  return frontier;
}

export function getConquestFailureMessage(
  reason: ConquestFailureReason,
  cost: number
): string {
  switch (reason) {
    case 'insufficient_funds':
      return `Dinheiro insuficiente ($${cost.toLocaleString('pt-BR')} necessários)`;
    case 'not_adjacent':
      return 'Só é possível conquistar hexágonos vizinhos ao seu território';
    case 'already_owned':
      return 'Este hexágono já pertence ao seu território';
  }
}
