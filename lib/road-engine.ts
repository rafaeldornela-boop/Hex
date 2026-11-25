import type { HexAssetEntry } from './godot-docs';
import type { ResourceCost } from './buildings-catalog';
import { hexKey, type AxialCoord, type HexOwner, type HexWorldState } from './hex-engine';
import { TECH_BY_ID, type TechId } from './tech-engine';
import { getHexTerrainAndResource } from './terrain-engine';

export type RoadLevel = 1 | 2 | 3 | 4 | 5;

export interface RoadLevelDefinition {
  level: RoadLevel;
  namePt: string;
  shortNamePt: string;
  descriptionPt: string;
  cost: ResourceCost;
  requiredTech: TechId | null;
  maintenanceGold: number;
  logisticsBonusPct: number;
  influenceBonus: number;
  colorHex: string;
}

export interface RoadTile {
  q: number;
  r: number;
  level: RoadLevel;
  owner: HexOwner;
}

export type RoadMap = Record<string, RoadTile>;

export interface RoadNetwork {
  id: string;
  hexKeys: string[];
  connectedCityIds: string[];
  avgLevel: number;
  maxLevel: RoadLevel;
  length: number;
  tradeGoldBonus: number;
  efficiencyBonusPct: number;
}

export interface RoadTileConnectivity {
  key: string;
  hasRoad: boolean;
  isBridge: boolean;
  level: number;
  connectedToCity: boolean;
  networkId: string | null;
  connectedCityIds: string[];
  connectedCityCount: number;
  nearestCityId: string | null;
  roadDistanceToNearestCity: number;
}

export interface RoadConnectivitySummary {
  networks: RoadNetwork[];
  tileMetricsByKey: Record<string, RoadTileConnectivity>;
  totalRoadTiles: number;
  roadMaintenanceGold: number;
  networkTradeGold: number;
  maxConnectedRoadLevel: number;
  roadTerritoryReachBonus: number;
}

const AXIAL_STEPS: readonly AxialCoord[] = [
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
  { q: 1, r: 0 },
];

export const ROAD_CATALOG: Record<RoadLevel, RoadLevelDefinition> = {
  1: {
    level: 1,
    namePt: 'Trilha',
    shortNamePt: 'Trilha',
    descriptionPt: 'Caminho batido que liga terras próximas e reduz isolamento.',
    cost: { gold: 15, wood: 4, stone: 0, food: 0, ore: 0, metal: 0 },
    requiredTech: null,
    maintenanceGold: 0,
    logisticsBonusPct: 4,
    influenceBonus: 1,
    colorHex: '#b48a5a',
  },
  2: {
    level: 2,
    namePt: 'Estrada de Terra',
    shortNamePt: 'Terra',
    descriptionPt: 'Via compactada para carroças de suprimento e madeira.',
    cost: { gold: 30, wood: 6, stone: 6, food: 0, ore: 0, metal: 0 },
    requiredTech: null,
    maintenanceGold: 1,
    logisticsBonusPct: 8,
    influenceBonus: 2,
    colorHex: '#9c7144',
  },
  3: {
    level: 3,
    namePt: 'Estrada Pavimentada',
    shortNamePt: 'Pavimentada',
    descriptionPt: 'Calçamento de pedra que amplia o alcance administrativo e o transporte.',
    cost: { gold: 55, wood: 0, stone: 14, food: 0, ore: 0, metal: 0 },
    requiredTech: 'construction',
    maintenanceGold: 1,
    logisticsBonusPct: 12,
    influenceBonus: 3,
    colorHex: '#94a3b8',
  },
  4: {
    level: 4,
    namePt: 'Grande Estrada',
    shortNamePt: 'Grande Estrada',
    descriptionPt: 'Corredor largo para caravanas entre cidades e mercados.',
    cost: { gold: 85, wood: 0, stone: 18, food: 0, ore: 0, metal: 2 },
    requiredTech: 'trade',
    maintenanceGold: 2,
    logisticsBonusPct: 16,
    influenceBonus: 4,
    colorHex: '#cbd5e1',
  },
  5: {
    level: 5,
    namePt: 'Via Comercial',
    shortNamePt: 'Via Comercial',
    descriptionPt: 'Artéria imperial com guias douradas e máxima eficiência logística.',
    cost: { gold: 125, wood: 0, stone: 22, food: 0, ore: 0, metal: 4 },
    requiredTech: 'engineering',
    maintenanceGold: 2,
    logisticsBonusPct: 22,
    influenceBonus: 5,
    colorHex: '#eab308',
  },
};

export function getRoadDefinition(level: RoadLevel): RoadLevelDefinition {
  return ROAD_CATALOG[level];
}

export function getRoadAt(
  roads: RoadMap | undefined,
  q: number,
  r: number
): RoadTile | null {
  if (!roads) return null;
  return roads[hexKey(q, r)] ?? null;
}

export function getNextRoadLevel(currentLevel: number): RoadLevel | null {
  if (currentLevel < 1) return 1;
  if (currentLevel >= 5) return null;
  return (currentLevel + 1) as RoadLevel;
}

export function canBuildOrUpgradeRoad(params: {
  worldState: HexWorldState;
  roads: RoadMap | undefined;
  q: number;
  r: number;
  cash: number;
  resources: { wood: number; stone: number; food: number; ore: number; metal: number };
  unlockedTechs: TechId[];
  assets: HexAssetEntry[];
  underConstructionKeys?: Set<string>;
  actorId?: HexOwner;
}): {
  allowed: boolean;
  targetLevel: RoadLevel | null;
  definition: RoadLevelDefinition | null;
  isUpgrade: boolean;
  reasonPt: string | null;
} {
  const {
    worldState,
    roads,
    q,
    r,
    cash,
    resources,
    unlockedTechs,
    assets,
    underConstructionKeys,
    actorId = 'player',
  } = params;

  const key = hexKey(q, r);
  const tile = worldState.hexes[key];

  if (!tile || tile.owner !== actorId) {
    return {
      allowed: false,
      targetLevel: null,
      definition: null,
      isUpgrade: false,
      reasonPt: 'Conquiste este território antes de construir estradas.',
    };
  }

  const terrainInfo = getHexTerrainAndResource(q, r, tile);
  const assetName = assets[tile.structureIndex]?.name ?? '';
  const isCompletedBridge =
    assetName === 'bridge' && !underConstructionKeys?.has(key);

  if (terrainInfo.terrainType === 'water' && !isCompletedBridge) {
    return {
      allowed: false,
      targetLevel: null,
      definition: null,
      isUpgrade: false,
      reasonPt: 'Construa uma Ponte concluída antes de estender estradas sobre a água.',
    };
  }

  const existingRoad = roads?.[key];
  const currentLevel = existingRoad?.owner === actorId ? existingRoad.level : 0;
  const targetLevel = getNextRoadLevel(currentLevel);

  if (!targetLevel) {
    return {
      allowed: false,
      targetLevel: null,
      definition: ROAD_CATALOG[5],
      isUpgrade: true,
      reasonPt: 'Esta via já atingiu o nível máximo (Via Comercial).',
    };
  }

  const def = ROAD_CATALOG[targetLevel];
  const isUpgrade = currentLevel > 0;

  if (def.requiredTech && !unlockedTechs.includes(def.requiredTech)) {
    return {
      allowed: false,
      targetLevel,
      definition: def,
      isUpgrade,
      reasonPt: `Requer pesquisa em ${TECH_BY_ID[def.requiredTech].namePt} para ${def.namePt}.`,
    };
  }

  if (cash < def.cost.gold) {
    return {
      allowed: false,
      targetLevel,
      definition: def,
      isUpgrade,
      reasonPt: `Ouro insuficiente ($${def.cost.gold}) para ${def.namePt}.`,
    };
  }
  if (resources.wood < def.cost.wood) {
    return {
      allowed: false,
      targetLevel,
      definition: def,
      isUpgrade,
      reasonPt: `Madeira insuficiente (${def.cost.wood}) para ${def.namePt}.`,
    };
  }
  if (resources.stone < def.cost.stone) {
    return {
      allowed: false,
      targetLevel,
      definition: def,
      isUpgrade,
      reasonPt: `Pedra insuficiente (${def.cost.stone}) para ${def.namePt}.`,
    };
  }
  if (resources.metal < def.cost.metal) {
    return {
      allowed: false,
      targetLevel,
      definition: def,
      isUpgrade,
      reasonPt: `Metal insuficiente (${def.cost.metal}) para ${def.namePt}.`,
    };
  }

  return {
    allowed: true,
    targetLevel,
    definition: def,
    isUpgrade,
    reasonPt: null,
  };
}

export function computeRoadConnectivity(params: {
  worldState: HexWorldState;
  roads: RoadMap | undefined;
  cityCenters: Array<{ id: string; center: AxialCoord; level: number }>;
  assets: HexAssetEntry[];
  owner?: HexOwner;
  underConstructionKeys?: Set<string>;
}): RoadConnectivitySummary {
  const {
    worldState,
    roads = {},
    cityCenters,
    assets,
    owner = 'player',
    underConstructionKeys,
  } = params;

  const cityByKey = new Map<string, { id: string; center: AxialCoord; level: number }>();
  for (const city of cityCenters) {
    const cKey = hexKey(city.center.q, city.center.r);
    if (worldState.hexes[cKey]?.owner === owner) {
      cityByKey.set(cKey, city);
    }
  }

  const traversable = new Map<
    string,
    {
      q: number;
      r: number;
      level: number;
      hasRoad: boolean;
      isBridge: boolean;
    }
  >();

  let totalRoadTiles = 0;
  let roadMaintenanceGold = 0;

  for (const tile of Object.values(worldState.hexes)) {
    if (tile.owner !== owner) continue;
    const key = hexKey(tile.q, tile.r);
    const road = roads[key];
    const hasOwnedRoad = Boolean(road && road.owner === owner);
    const assetName = assets[tile.structureIndex]?.name ?? '';
    const isCompletedBridge =
      assetName === 'bridge' && !underConstructionKeys?.has(key);
    const isCity = cityByKey.has(key);

    if (hasOwnedRoad && road) {
      totalRoadTiles += 1;
      roadMaintenanceGold += ROAD_CATALOG[road.level].maintenanceGold;
    }

    if (hasOwnedRoad || isCompletedBridge || isCity) {
      const effectiveLevel = hasOwnedRoad && road
        ? road.level
        : isCompletedBridge
          ? 2
          : isCity
            ? Math.max(2, Math.min(5, cityByKey.get(key)?.level ?? 2))
            : 1;
      traversable.set(key, {
        q: tile.q,
        r: tile.r,
        level: effectiveLevel,
        hasRoad: hasOwnedRoad,
        isBridge: isCompletedBridge,
      });
    }
  }

  // Build connected components via BFS
  const visited = new Set<string>();
  const networks: RoadNetwork[] = [];
  const tileMetricsByKey: Record<string, RoadTileConnectivity> = {};
  let networkTradeGold = 0;
  let maxConnectedRoadLevel = 0;

  // Multi-source BFS from city centers to get exact road-hop distance to nearest city
  const distToNearestCity = new Map<string, { cityId: string; dist: number }>();
  const cityDistQueue: Array<{ key: string; cityId: string; dist: number }> = [];
  for (const [cKey, city] of cityByKey.entries()) {
    distToNearestCity.set(cKey, { cityId: city.id, dist: 0 });
    cityDistQueue.push({ key: cKey, cityId: city.id, dist: 0 });
  }
  let cdHead = 0;
  while (cdHead < cityDistQueue.length) {
    const cur = cityDistQueue[cdHead++];
    const curNode = traversable.get(cur.key);
    if (!curNode) continue;
    for (const step of AXIAL_STEPS) {
      const nKey = hexKey(curNode.q + step.q, curNode.r + step.r);
      if (!traversable.has(nKey) || distToNearestCity.has(nKey)) continue;
      distToNearestCity.set(nKey, { cityId: cur.cityId, dist: cur.dist + 1 });
      cityDistQueue.push({ key: nKey, cityId: cur.cityId, dist: cur.dist + 1 });
    }
  }

  let netCounter = 0;
  for (const [startKey, startNode] of traversable.entries()) {
    if (visited.has(startKey)) continue;

    const compKeys: string[] = [];
    const compCityIds: string[] = [];
    const queue = [startKey];
    visited.add(startKey);
    let head = 0;
    let levelSum = 0;
    let roadCountInComp = 0;
    let maxLvl: RoadLevel = 1;

    while (head < queue.length) {
      const k = queue[head++];
      const node = traversable.get(k)!;
      compKeys.push(k);
      const cityHere = cityByKey.get(k);
      if (cityHere) {
        compCityIds.push(cityHere.id);
      }
      if (node.hasRoad || node.isBridge) {
        roadCountInComp += 1;
        levelSum += node.level;
        if (node.level > maxLvl) {
          maxLvl = Math.min(5, Math.max(1, node.level)) as RoadLevel;
        }
      }
      for (const step of AXIAL_STEPS) {
        const nk = hexKey(node.q + step.q, node.r + step.r);
        if (!visited.has(nk) && traversable.has(nk)) {
          visited.add(nk);
          queue.push(nk);
        }
      }
    }

    const connectedToCity = compCityIds.length > 0;
    const isRealNetwork = roadCountInComp >= 1 || compCityIds.length >= 2;
    const avgLevel =
      roadCountInComp > 0 ? Number((levelSum / roadCountInComp).toFixed(2)) : 1;

    let netId: string | null = null;
    if (isRealNetwork) {
      netCounter += 1;
      netId = `net-${netCounter}`;

      const cityPairsBonus =
        compCityIds.length >= 2
          ? Math.round((compCityIds.length - 1) * (8 + avgLevel * 3) + Math.min(8, roadCountInComp))
          : connectedToCity && roadCountInComp >= 2
            ? Math.min(6, Math.floor(roadCountInComp / 2) + (avgLevel >= 3 ? 2 : 0))
            : 0;

      const efficiencyBonusPct = connectedToCity
        ? Math.round(avgLevel * 2 + (compCityIds.length >= 2 ? 4 : 0))
        : 0;

      networkTradeGold += cityPairsBonus;
      if (connectedToCity && maxLvl > maxConnectedRoadLevel) {
        maxConnectedRoadLevel = maxLvl;
      }

      networks.push({
        id: netId,
        hexKeys: compKeys,
        connectedCityIds: compCityIds,
        avgLevel,
        maxLevel: maxLvl,
        length: roadCountInComp,
        tradeGoldBonus: cityPairsBonus,
        efficiencyBonusPct,
      });
    }

    for (const k of compKeys) {
      const node = traversable.get(k)!;
      const nearest = distToNearestCity.get(k);
      tileMetricsByKey[k] = {
        key: k,
        hasRoad: node.hasRoad,
        isBridge: node.isBridge,
        level: node.level,
        connectedToCity,
        networkId: netId,
        connectedCityIds: compCityIds,
        connectedCityCount: compCityIds.length,
        nearestCityId: nearest?.cityId ?? null,
        roadDistanceToNearestCity: nearest?.dist ?? Infinity,
      };
    }
  }

  const roadTerritoryReachBonus = maxConnectedRoadLevel >= 3 ? 1 : 0;

  return {
    networks,
    tileMetricsByKey,
    totalRoadTiles,
    roadMaintenanceGold,
    networkTradeGold,
    maxConnectedRoadLevel,
    roadTerritoryReachBonus,
  };
}

export function normalizeRoadMap(
  raw: unknown,
  worldState: HexWorldState
): RoadMap {
  if (!raw || typeof raw !== 'object') return {};
  const result: RoadMap = {};
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!val || typeof val !== 'object') continue;
    const candidate = val as Partial<RoadTile>;
    if (
      typeof candidate.q !== 'number' ||
      typeof candidate.r !== 'number' ||
      typeof candidate.level !== 'number'
    ) {
      continue;
    }
    const q = Math.round(candidate.q);
    const r = Math.round(candidate.r);
    const k = hexKey(q, r);
    const tile = worldState.hexes[k];
    if (!tile) continue;
    const level = Math.max(1, Math.min(5, Math.round(candidate.level))) as RoadLevel;
    const owner: HexOwner =
      typeof candidate.owner === 'string' && candidate.owner.trim()
        ? candidate.owner.trim()
        : tile.owner ?? 'player';
    if (tile.owner !== owner) continue;
    result[key === k ? key : k] = { q, r, level, owner };
  }
  return result;
}
