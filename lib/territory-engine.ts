import type { HexAssetEntry } from './godot-docs';
import {
  hexKey,
  type AxialCoord,
  type HexOwner,
  type HexWorldState,
  type PlacedHex,
} from './hex-engine';
import {
  TERRAIN_METADATA,
  getHexTerrainAndResource,
  getStrategicRegionInfo,
  type StrategicRegionInfo,
  type TerrainType,
} from './terrain-engine';
import { TECH_BY_ID, getTechModifiers, type TechId } from './tech-engine';

export type { HexOwner } from './hex-engine';

export const NOT_OWNED_BUILD_MESSAGE =
  'Conquiste este território antes de construir.';
export const ALREADY_OCCUPIED_BUILD_MESSAGE =
  'Este território já possui uma construção.';

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

export function axialDistance(a: AxialCoord, b: AxialCoord): number {
  return (
    (Math.abs(a.q - b.q) +
      Math.abs(a.q + a.r - b.q - b.r) +
      Math.abs(a.r - b.r)) /
    2
  );
}

export function getHexOwner(
  state: HexWorldState,
  q: number,
  r: number
): HexOwner {
  const raw = state.hexes[hexKey(q, r)]?.owner;
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : 'neutral';
}

export function isHexOwnedBy(
  tile: Pick<PlacedHex, 'owner'> | null | undefined,
  actorId: HexOwner = 'player'
): boolean {
  const owner: HexOwner =
    typeof tile?.owner === 'string' && tile.owner.trim().length > 0
      ? tile.owner.trim()
      : 'neutral';
  return owner === actorId;
}

export function canBuildInTerritory(
  state: HexWorldState,
  q: number,
  r: number,
  actorId: HexOwner = 'player'
): boolean {
  return isHexOwnedBy(state.hexes[hexKey(q, r)], actorId);
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
 * Checks whether (q, r) is directly adjacent to at least one hex owned by `actorId`.
 */
export function isAdjacentToTerritory(
  state: HexWorldState,
  q: number,
  r: number,
  actorId: HexOwner = 'player'
): boolean {
  for (const dir of AXIAL_DIRECTIONS) {
    const neighborKey = hexKey(q + dir.q, r + dir.r);
    if (state.hexes[neighborKey]?.owner === actorId) {
      return true;
    }
  }
  return false;
}

/**
 * Checks whether (q, r) is directly adjacent to at least one player-owned hex.
 */
export function isAdjacentToPlayerTerritory(
  state: HexWorldState,
  q: number,
  r: number
): boolean {
  return isAdjacentToTerritory(state, q, r, 'player');
}

export interface ActiveExpansion {
  q: number;
  r: number;
  turnsRemaining: number;
  totalTurns: number;
  workersCommitted: number;
  owner: HexOwner;
}

export interface TerritorialCapacitySummary {
  controlled: number;
  inProgress: number;
  used: number;
  capacity: number;
  remaining: number;
  baseCapacity: number;
  populationBonus: number;
  infrastructureBonus: number;
  techBonus: number;
  maxAnchorReach: number;
  anchorCoords: AxialCoord[];
}

const INFRASTRUCTURE_CAPACITY_BONUS: Record<string, number> = {
  'building-castle': 3,
  'building-village': 2,
  'unit-mansion': 2,
  'building-tower': 1,
  'unit-wall-tower': 1,
  'building-port': 1,
  'building-market': 1,
};

const ANCHOR_BUILDING_ASSETS = new Set<string>([
  'building-castle',
  'building-village',
  'unit-mansion',
  'building-tower',
  'unit-wall-tower',
  'building-port',
  'building-market',
  'building-archery',
  'bridge',
]);

export function computeTerritorialCapacity(params: {
  worldState: HexWorldState;
  population: number;
  unlockedTechs: TechId[];
  assets: HexAssetEntry[];
  owner?: HexOwner;
  underConstructionKeys?: Set<string>;
  activeExpansions?: ActiveExpansion[];
  playerCapital?: AxialCoord;
}): TerritorialCapacitySummary {
  const {
    worldState,
    population,
    unlockedTechs,
    assets,
    owner = 'player',
    underConstructionKeys,
    activeExpansions = [],
    playerCapital,
  } = params;

  const baseCapacity = 4;
  const populationBonus = Math.floor(Math.max(0, population) / 4);
  const techMods = getTechModifiers(unlockedTechs);
  const techBonus = techMods.territorialCapacityBonus;
  const maxAnchorReach = 2 + techMods.anchorReachBonus;

  let controlled = 0;
  let infrastructureBonus = 0;
  const anchorCoords: AxialCoord[] = [];
  const anchorSeen = new Set<string>();

  for (const tile of Object.values(worldState.hexes)) {
    if (tile.owner !== owner) continue;
    controlled++;

    const key = hexKey(tile.q, tile.r);
    if (underConstructionKeys?.has(key)) continue;

    const assetName = assets[tile.structureIndex]?.name ?? '';
    infrastructureBonus += INFRASTRUCTURE_CAPACITY_BONUS[assetName] ?? 0;

    if (ANCHOR_BUILDING_ASSETS.has(assetName)) {
      anchorSeen.add(key);
      anchorCoords.push({ q: tile.q, r: tile.r });
    }
  }

  if (owner === 'player' && playerCapital) {
    const capKey = hexKey(playerCapital.q, playerCapital.r);
    if (worldState.hexes[capKey]?.owner === 'player' && !anchorSeen.has(capKey)) {
      anchorSeen.add(capKey);
      anchorCoords.push({ q: playerCapital.q, r: playerCapital.r });
    }
  }

  if (anchorCoords.length === 0) {
    for (const tile of Object.values(worldState.hexes)) {
      if (tile.owner === owner) {
        anchorCoords.push({ q: tile.q, r: tile.r });
        break;
      }
    }
  }

  const inProgress = activeExpansions.filter((e) => e.owner === owner).length;
  const capacity = baseCapacity + populationBonus + infrastructureBonus + techBonus;
  const used = controlled + inProgress;
  const remaining = Math.max(0, capacity - used);

  return {
    controlled,
    inProgress,
    used,
    capacity,
    remaining,
    baseCapacity,
    populationBonus,
    infrastructureBonus,
    techBonus,
    maxAnchorReach,
    anchorCoords,
  };
}

export interface HexInfluenceInfo {
  score: number;
  requiredInfluence: number;
  turnsRequired: number;
  workersRequired: number;
  minDistToAnchor: number;
  maxAnchorReach: number;
  withinReach: boolean;
  requiredTech: TechId | null;
  terrainType: TerrainType;
  strategic: StrategicRegionInfo;
}

const TERRAIN_EXPANSION_PROFILE: Record<
  TerrainType,
  { baseTurns: number; reqInfluence: number; workers: number }
> = {
  plains: { baseTurns: 1, reqInfluence: 4, workers: 1 },
  fertile: { baseTurns: 1, reqInfluence: 5, workers: 1 },
  water: { baseTurns: 2, reqInfluence: 6, workers: 1 },
  forest: { baseTurns: 2, reqInfluence: 7, workers: 1 },
  mountain: { baseTurns: 3, reqInfluence: 11, workers: 2 },
};

function getBuildingInfluenceProfile(
  assetName: string
): { power: number; decay: number } | null {
  if (!assetName) return null;
  if (assetName === 'building-castle') return { power: 9, decay: 2.5 };
  if (
    assetName === 'building-village' ||
    assetName === 'unit-mansion' ||
    assetName === 'unit-wall-tower'
  ) {
    return { power: 6, decay: 2 };
  }
  if (
    assetName === 'building-market' ||
    assetName === 'building-port' ||
    assetName === 'building-tower' ||
    assetName === 'building-archery' ||
    assetName === 'building-wizard-tower' ||
    assetName === 'bridge'
  ) {
    return { power: 5, decay: 2 };
  }
  if (assetName === 'building-house' || assetName === 'building-cabin') {
    return { power: 3.5, decay: 1.5 };
  }
  if (
    assetName.startsWith('building-') ||
    assetName.startsWith('dirt-') ||
    assetName.startsWith('unit-')
  ) {
    return { power: 2.5, decay: 1.5 };
  }
  return null;
}

function getRequiredTechForStrategicFeature(
  feature: StrategicRegionInfo['rareFeature']
): TechId | null {
  switch (feature) {
    case 'gold_vein':
    case 'pure_iron':
      return 'mining';
    case 'rich_soil':
      return 'agriculture';
    case 'natural_harbor':
      return 'trade';
    default:
      return null;
  }
}

export function computeHexInfluence(params: {
  worldState: HexWorldState;
  q: number;
  r: number;
  population: number;
  unlockedTechs: TechId[];
  assets: HexAssetEntry[];
  owner?: HexOwner;
  underConstructionKeys?: Set<string>;
  anchorCoords?: AxialCoord[];
  maxAnchorReach?: number;
  playerCapital?: AxialCoord;
}): HexInfluenceInfo {
  const {
    worldState,
    q,
    r,
    population,
    unlockedTechs,
    assets,
    owner = 'player',
    underConstructionKeys,
    playerCapital,
  } = params;

  const techMods = getTechModifiers(unlockedTechs);
  const resolvedMaxReach =
    params.maxAnchorReach ?? 2 + techMods.anchorReachBonus;

  let anchors = params.anchorCoords;
  if (!anchors) {
    const capSummary = computeTerritorialCapacity({
      worldState,
      population,
      unlockedTechs,
      assets,
      owner,
      underConstructionKeys,
      playerCapital,
    });
    anchors = capSummary.anchorCoords;
  }

  let minDistToAnchor = Infinity;
  for (const anchor of anchors) {
    const d = axialDistance(anchor, { q, r });
    if (d < minDistToAnchor) {
      minDistToAnchor = d;
    }
  }

  const targetCoord: AxialCoord = { q, r };
  let rawScore = 0;

  for (const tile of Object.values(worldState.hexes)) {
    if (tile.owner !== owner) continue;
    const d = axialDistance(tile, targetCoord);
    if (d === 0 || d > 4) continue;

    const tileKey = hexKey(tile.q, tile.r);
    if (underConstructionKeys?.has(tileKey)) continue;

    const assetName = assets[tile.structureIndex]?.name ?? '';
    const profile = getBuildingInfluenceProfile(assetName);
    if (profile) {
      rawScore += Math.max(0, profile.power - d * profile.decay);
    } else if (d === 1) {
      rawScore += 1;
    }
  }

  if (minDistToAnchor <= 2) {
    rawScore += Math.min(4, Math.floor(Math.max(0, population) / 6));
  }

  const score = Math.round(rawScore);

  const existingTile = worldState.hexes[hexKey(q, r)] ?? null;
  const terrainInfo = getHexTerrainAndResource(q, r, existingTile);
  const profile = TERRAIN_EXPANSION_PROFILE[terrainInfo.terrainType];
  const strategic = getStrategicRegionInfo(q, r, existingTile);
  const requiredTech = getRequiredTechForStrategicFeature(strategic.rareFeature);

  const requiredInfluence = profile.reqInfluence + strategic.expansionInfluenceMod;
  const distanceTurnPenalty = minDistToAnchor >= 3 ? 1 : 0;
  const surplusInfluenceBonus = score >= requiredInfluence + 6 ? 1 : 0;

  const turnsRequired = Math.max(
    1,
    Math.min(
      4,
      profile.baseTurns +
        distanceTurnPenalty +
        strategic.expansionExtraTurns -
        techMods.expansionTurnReduction -
        surplusInfluenceBonus
    )
  );

  return {
    score,
    requiredInfluence,
    turnsRequired,
    workersRequired: profile.workers,
    minDistToAnchor,
    maxAnchorReach: resolvedMaxReach,
    withinReach: Number.isFinite(minDistToAnchor) && minDistToAnchor <= resolvedMaxReach,
    requiredTech,
    terrainType: terrainInfo.terrainType,
    strategic,
  };
}

export type ExpansionFailureReason =
  | 'already_owned'
  | 'rival_territory'
  | 'already_expanding'
  | 'out_of_bounds'
  | 'not_adjacent'
  | 'out_of_reach'
  | 'capacity_reached'
  | 'requires_tech'
  | 'insufficient_influence'
  | 'insufficient_workers';

export interface ExpansionCheckResult {
  canExpand: boolean;
  reason?: ExpansionFailureReason;
  owner: HexOwner;
  isAdjacent: boolean;
  influence: HexInfluenceInfo;
  turnsRequired: number;
  workersRequired: number;
  requiredTech: TechId | null;
  capacitySummary: TerritorialCapacitySummary;
}

export function evaluateExpansion(params: {
  worldState: HexWorldState;
  q: number;
  r: number;
  population: number;
  unlockedTechs: TechId[];
  availableWorkers: number;
  assets: HexAssetEntry[];
  owner?: HexOwner;
  underConstructionKeys?: Set<string>;
  activeExpansions?: ActiveExpansion[];
  playerCapital?: AxialCoord;
}): ExpansionCheckResult {
  const {
    worldState,
    q,
    r,
    population,
    unlockedTechs,
    availableWorkers,
    assets,
    owner: actorId = 'player',
    underConstructionKeys,
    activeExpansions = [],
    playerCapital,
  } = params;

  const key = hexKey(q, r);
  const existingTile = worldState.hexes[key] ?? null;
  const tileOwner = getHexOwner(worldState, q, r);

  const capacitySummary = computeTerritorialCapacity({
    worldState,
    population,
    unlockedTechs,
    assets,
    owner: actorId,
    underConstructionKeys,
    activeExpansions,
    playerCapital,
  });

  const influence = computeHexInfluence({
    worldState,
    q,
    r,
    population,
    unlockedTechs,
    assets,
    owner: actorId,
    underConstructionKeys,
    anchorCoords: capacitySummary.anchorCoords,
    maxAnchorReach: capacitySummary.maxAnchorReach,
    playerCapital,
  });

  const adjacent = isAdjacentToTerritory(worldState, q, r, actorId);

  const fail = (reason: ExpansionFailureReason): ExpansionCheckResult => ({
    canExpand: false,
    reason,
    owner: tileOwner,
    isAdjacent: adjacent,
    influence,
    turnsRequired: influence.turnsRequired,
    workersRequired: influence.workersRequired,
    requiredTech: influence.requiredTech,
    capacitySummary,
  });

  if (tileOwner === actorId) return fail('already_owned');
  if (tileOwner !== 'neutral') return fail('rival_territory');
  if (activeExpansions.some((e) => e.q === q && e.r === r)) {
    return fail('already_expanding');
  }
  if (typeof worldState.worldCols === 'number' && !existingTile) {
    return fail('out_of_bounds');
  }
  if (!adjacent) return fail('not_adjacent');
  if (!influence.withinReach) return fail('out_of_reach');
  if (capacitySummary.remaining <= 0) return fail('capacity_reached');
  if (influence.requiredTech && !unlockedTechs.includes(influence.requiredTech)) {
    return fail('requires_tech');
  }
  if (influence.score < influence.requiredInfluence) {
    return fail('insufficient_influence');
  }
  if (availableWorkers < influence.workersRequired) {
    return fail('insufficient_workers');
  }

  return {
    canExpand: true,
    owner: tileOwner,
    isAdjacent: true,
    influence,
    turnsRequired: influence.turnsRequired,
    workersRequired: influence.workersRequired,
    requiredTech: influence.requiredTech,
    capacitySummary,
  };
}

export const canExpand = evaluateExpansion;

export function getExpansionFailureMessage(check: ExpansionCheckResult): string {
  switch (check.reason) {
    case 'already_owned':
      return 'Este hexágono já pertence ao seu território.';
    case 'rival_territory':
      return 'Território de outra facção! Use uma unidade militar para atacar.';
    case 'already_expanding':
      return 'Este hexágono já está sendo incorporado.';
    case 'out_of_bounds':
      return 'Fora dos limites deste mundo.';
    case 'not_adjacent':
      return 'Só é possível expandir para hexágonos vizinhos ao seu território.';
    case 'out_of_reach':
      return `Fora do alcance administrativo (${check.influence.minDistToAnchor}/${check.influence.maxAnchorReach}). Construa uma Vila, Torre ou Mercado próximo.`;
    case 'capacity_reached':
      return `Capacidade territorial esgotada (${check.capacitySummary.used}/${check.capacitySummary.capacity}). Aumente população, infraestrutura ou tecnologia.`;
    case 'requires_tech': {
      const techName = check.requiredTech
        ? TECH_BY_ID[check.requiredTech]?.namePt ?? check.requiredTech
        : '';
      return `Requer pesquisa em ${techName} para incorporar esta região.`;
    }
    case 'insufficient_influence':
      return `Influência insuficiente (${check.influence.score}/${check.influence.requiredInfluence}). Desenvolva edifícios próximos para expandir.`;
    case 'insufficient_workers':
      return `Trabalhadores livres insuficientes (precisa ${check.workersRequired}).`;
    default:
      return 'Não é possível incorporar este território no momento.';
  }
}

export interface StartExpansionResult {
  started: boolean;
  nextExpansions: ActiveExpansion[];
  expansion: ActiveExpansion | null;
  check: ExpansionCheckResult;
  messagePt: string;
}

/**
 * Initiates multi-turn organic territorial incorporation.
 * Consumes ZERO gold: depends strictly on frontier adjacency, reach, territorial capacity,
 * local influence, unlocked tech (for rare features), and available workers.
 */
export function startExpansion(params: {
  worldState: HexWorldState;
  activeExpansions: ActiveExpansion[];
  q: number;
  r: number;
  population: number;
  unlockedTechs: TechId[];
  availableWorkers: number;
  assets: HexAssetEntry[];
  owner?: HexOwner;
  underConstructionKeys?: Set<string>;
  playerCapital?: AxialCoord;
}): StartExpansionResult {
  const {
    activeExpansions,
    q,
    r,
    owner = 'player',
  } = params;

  const check = evaluateExpansion(params);
  if (!check.canExpand) {
    return {
      started: false,
      nextExpansions: activeExpansions,
      expansion: null,
      check,
      messagePt: getExpansionFailureMessage(check),
    };
  }

  const expansion: ActiveExpansion = {
    q,
    r,
    turnsRemaining: check.turnsRequired,
    totalTurns: check.turnsRequired,
    workersCommitted: check.workersRequired,
    owner,
  };

  const terrainLabel = TERRAIN_METADATA[check.influence.terrainType].labelPt;
  const featureSuffix = check.influence.strategic.labelPt
    ? ` (${check.influence.strategic.labelPt})`
    : '';
  const turnsLabel =
    expansion.totalTurns === 1 ? '1 turno' : `${expansion.totalTurns} turnos`;

  return {
    started: true,
    nextExpansions: [...activeExpansions, expansion],
    expansion,
    check,
    messagePt: `Incorporação iniciada em ${terrainLabel}${featureSuffix} (${turnsLabel}).`,
  };
}

/**
 * Returns all neutral coordinates directly adjacent to the player's territory
 * that currently satisfy all expansion requirements.
 */
export function getExpandableFrontierCoords(params: {
  worldState: HexWorldState;
  activeExpansions?: ActiveExpansion[];
  population: number;
  unlockedTechs: TechId[];
  availableWorkers: number;
  assets: HexAssetEntry[];
  owner?: HexOwner;
  underConstructionKeys?: Set<string>;
  playerCapital?: AxialCoord;
}): AxialCoord[] {
  const {
    worldState,
    activeExpansions = [],
    population,
    unlockedTechs,
    availableWorkers,
    assets,
    owner = 'player',
    underConstructionKeys,
    playerCapital,
  } = params;

  const seen = new Set<string>();
  const frontier: AxialCoord[] = [];

  for (const tile of Object.values(worldState.hexes)) {
    if (tile.owner !== owner) continue;
    for (const dir of AXIAL_DIRECTIONS) {
      const nq = tile.q + dir.q;
      const nr = tile.r + dir.r;
      const nKey = hexKey(nq, nr);
      if (seen.has(nKey)) continue;
      seen.add(nKey);

      const check = evaluateExpansion({
        worldState,
        q: nq,
        r: nr,
        population,
        unlockedTechs,
        availableWorkers,
        assets,
        owner,
        underConstructionKeys,
        activeExpansions,
        playerCapital,
      });

      if (check.canExpand) {
        frontier.push({ q: nq, r: nr });
      }
    }
  }

  return frontier;
}

/**
 * Returns neutral hexes within administrative reach & strong cultural/infrastructure influence
 * so the 3D view can subtly show the kingdom's sphere of influence.
 */
export function getInfluenceCoverageCoords(params: {
  worldState: HexWorldState;
  activeExpansions?: ActiveExpansion[];
  population: number;
  unlockedTechs: TechId[];
  assets: HexAssetEntry[];
  owner?: HexOwner;
  underConstructionKeys?: Set<string>;
  playerCapital?: AxialCoord;
}): AxialCoord[] {
  const {
    worldState,
    activeExpansions = [],
    population,
    unlockedTechs,
    assets,
    owner = 'player',
    underConstructionKeys,
    playerCapital,
  } = params;

  const capSummary = computeTerritorialCapacity({
    worldState,
    population,
    unlockedTechs,
    assets,
    owner,
    underConstructionKeys,
    activeExpansions,
    playerCapital,
  });

  const expandingKeys = new Set(activeExpansions.map((e) => hexKey(e.q, e.r)));
  const bounded = typeof worldState.worldCols === 'number';
  const seen = new Set<string>();
  const coverage: AxialCoord[] = [];

  for (const tile of Object.values(worldState.hexes)) {
    if (tile.owner !== owner) continue;
    for (let dq = -2; dq <= 2; dq++) {
      for (let dr = -2; dr <= 2; dr++) {
        if (Math.abs(dq + dr) > 2) continue;
        if (dq === 0 && dr === 0) continue;

        const nq = tile.q + dq;
        const nr = tile.r + dr;
        const nKey = hexKey(nq, nr);
        if (seen.has(nKey)) continue;
        seen.add(nKey);

        const existing = worldState.hexes[nKey];
        if (bounded && !existing) continue;
        if (existing?.owner && existing.owner !== 'neutral') continue;
        if (expandingKeys.has(nKey)) continue;

        const inf = computeHexInfluence({
          worldState,
          q: nq,
          r: nr,
          population,
          unlockedTechs,
          assets,
          owner,
          underConstructionKeys,
          anchorCoords: capSummary.anchorCoords,
          maxAnchorReach: capSummary.maxAnchorReach,
          playerCapital,
        });

        if (inf.withinReach && inf.score >= 4) {
          coverage.push({ q: nq, r: nr });
        }
      }
    }
  }

  return coverage;
}
