import type { HexAssetEntry } from './godot-docs';
import {
  BUILDING_CATALOG,
  STRATEGY_PALETTE_ORDER,
  getBuildingDefinition,
  isConstructibleBuildingName,
  type BuildingDefinition,
  type ResourceCost,
} from './buildings-catalog';
import {
  canAffordCost,
  computeEffectiveBuildCost,
  type KingdomResources,
  type TurnProductionBreakdown,
} from './economy-engine';
import { hasHexConstruction, hexKey, type HexWorldState } from './hex-engine';
import { TECH_BY_ID, type TechId } from './tech-engine';
import {
  INCOMPATIBLE_TERRAIN_MESSAGE,
  describeTerrain,
  getHexTerrainAndResource,
  isNaturalTerrainAssetName,
  type TerrainDescriptor,
  type TerrainType,
} from './terrain-engine';
import {
  ALREADY_OCCUPIED_BUILD_MESSAGE,
  NOT_OWNED_BUILD_MESSAGE,
} from './territory-engine';
import { getHexNeighbors, isForestDepleted } from './adjacency-engine';

export interface BuildRuleValidationResult {
  allowed: boolean;
  reasonPt: string | null;
  workerWarningPt: string | null;
  definition: BuildingDefinition | null;
  effectiveCost: ResourceCost | null;
  terrain: TerrainDescriptor;
}

export interface ContextualBuildOption {
  assetIndex: number;
  assetName: string;
  definition: BuildingDefinition;
  effectiveCost: ResourceCost;
  affordable: boolean;
  missingLabelPt: string | null;
  workerWarningPt: string | null;
}

export interface HexBuildEvaluation {
  canBuildOnHex: boolean;
  blockedReasonPt: string | null;
  hintPt: string | null;
  terrain: TerrainDescriptor;
  options: ContextualBuildOption[];
}

export const NATURAL_TERRAIN_BLOCKED_MESSAGE =
  'Terrenos naturais fazem parte do mapa e não podem ser construídos manualmente.';

export function isBuildingAllowedOnTerrain(
  assetName: string,
  terrainType: TerrainType
): boolean {
  if (isNaturalTerrainAssetName(assetName) || !isConstructibleBuildingName(assetName)) {
    return false;
  }
  const bDef = BUILDING_CATALOG[assetName];
  if (!bDef) return false;
  if (bDef.allowedTerrains && !bDef.allowedTerrains.includes(terrainType)) {
    return false;
  }
  return true;
}

/**
 * Single source of truth used by both pure kingdom build validation (`buildInKingdom`)
 * and the 3D selector / contextual UI (`GameHud`).
 * Buildings requiring more workers than currently available CAN still be queued
 * (with a clear worker warning), so shortages naturally stall/throttle operation until Casas are built.
 */
export function validateBuildCandidateOnHex(params: {
  worldState: HexWorldState;
  resources: KingdomResources;
  unlockedTechs: TechId[];
  availableWorkers: number;
  hasActiveConstructionAtCoord: boolean;
  q: number;
  r: number;
  structureIndex: number;
  assets: HexAssetEntry[];
  checkAffordability?: boolean;
}): BuildRuleValidationResult {
  const {
    worldState,
    resources,
    unlockedTechs,
    availableWorkers,
    hasActiveConstructionAtCoord,
    q,
    r,
    structureIndex,
    assets,
    checkAffordability = true,
  } = params;

  const key = hexKey(q, r);
  const existing = worldState.hexes[key];
  const terrainInfo = getHexTerrainAndResource(q, r, existing);
  const terrain = describeTerrain(terrainInfo.terrainType);
  const asset = assets[structureIndex];

  if (!asset || isNaturalTerrainAssetName(asset.name) || !isConstructibleBuildingName(asset.name)) {
    return {
      allowed: false,
      reasonPt: NATURAL_TERRAIN_BLOCKED_MESSAGE,
      workerWarningPt: null,
      definition: null,
      effectiveCost: null,
      terrain,
    };
  }

  if (!existing || existing.owner !== 'player') {
    return {
      allowed: false,
      reasonPt: NOT_OWNED_BUILD_MESSAGE,
      workerWarningPt: null,
      definition: null,
      effectiveCost: null,
      terrain,
    };
  }

  if (hasHexConstruction(existing, assets) || hasActiveConstructionAtCoord) {
    return {
      allowed: false,
      reasonPt: ALREADY_OCCUPIED_BUILD_MESSAGE,
      workerWarningPt: null,
      definition: null,
      effectiveCost: null,
      terrain,
    };
  }

  const bDef = getBuildingDefinition(asset.name);
  if (bDef.requiredTech && !unlockedTechs.includes(bDef.requiredTech)) {
    const techName = TECH_BY_ID[bDef.requiredTech]?.namePt ?? bDef.requiredTech;
    return {
      allowed: false,
      reasonPt: `Requer pesquisa: ${techName}.`,
      workerWarningPt: null,
      definition: bDef,
      effectiveCost: null,
      terrain,
    };
  }

  if (!isBuildingAllowedOnTerrain(asset.name, terrainInfo.terrainType)) {
    return {
      allowed: false,
      reasonPt: INCOMPATIBLE_TERRAIN_MESSAGE,
      workerWarningPt: null,
      definition: bDef,
      effectiveCost: null,
      terrain,
    };
  }

  const neighbors = getHexNeighbors(worldState, q, r, assets);
  if (
    (asset.name === 'building-watermill' || asset.name === 'building-dock') &&
    terrainInfo.terrainType !== 'water' &&
    !neighbors.some((n) => n.exists && n.terrainType === 'water')
  ) {
    return {
      allowed: false,
      reasonPt:
        asset.name === 'building-watermill'
          ? 'Moinho Fluvial exige Água adjacente.'
          : 'Doca de Pesca exige Água adjacente.',
      workerWarningPt: null,
      definition: bDef,
      effectiveCost: null,
      terrain,
    };
  }

  if (
    asset.name === 'dirt-lumber' &&
    isForestDepleted(existing) &&
    !neighbors.some((n) => n.exists && n.terrainType === 'forest' && !n.isForestDepleted)
  ) {
    return {
      allowed: false,
      reasonPt: 'Floresta esgotada: não há madeira disponível neste hex ou vizinhos.',
      workerWarningPt: null,
      definition: bDef,
      effectiveCost: null,
      terrain,
    };
  }

  const workerWarningPt =
    bDef.workersRequired > 0 && availableWorkers < bDef.workersRequired
      ? `Faltam trabalhadores (${availableWorkers}/${bDef.workersRequired}): operará parcial ou parada até construir Casas.`
      : null;

  const effectiveCost = computeEffectiveBuildCost(asset.name, unlockedTechs);
  if (checkAffordability) {
    const afford = canAffordCost(worldState.cash, resources, effectiveCost);
    if (!afford.affordable) {
      return {
        allowed: false,
        reasonPt: afford.missingLabelPt ?? 'Recursos insuficientes.',
        workerWarningPt,
        definition: bDef,
        effectiveCost,
        terrain,
      };
    }
  }

  return {
    allowed: true,
    reasonPt: null,
    workerWarningPt,
    definition: bDef,
    effectiveCost,
    terrain,
  };
}

/**
 * Evaluates "O que posso construir neste hex?" using the exact same rules as `buildInKingdom`.
 * Shows worker-short options with an explicit warning so the player understands the causal loop.
 */
export function evaluateHexBuildOptions(params: {
  worldState: HexWorldState;
  resources: KingdomResources;
  unlockedTechs: TechId[];
  economy: TurnProductionBreakdown;
  hasActiveConstructionAtCoord: boolean;
  q: number;
  r: number;
  assets: HexAssetEntry[];
}): HexBuildEvaluation {
  const {
    worldState,
    resources,
    unlockedTechs,
    economy,
    hasActiveConstructionAtCoord,
    q,
    r,
    assets,
  } = params;

  const existing = worldState.hexes[hexKey(q, r)];
  const terrainInfo = getHexTerrainAndResource(q, r, existing);
  const terrain = describeTerrain(terrainInfo.terrainType);

  if (!existing || existing.owner !== 'player') {
    return {
      canBuildOnHex: false,
      blockedReasonPt: NOT_OWNED_BUILD_MESSAGE,
      hintPt: null,
      terrain,
      options: [],
    };
  }

  if (hasHexConstruction(existing, assets) || hasActiveConstructionAtCoord) {
    return {
      canBuildOnHex: false,
      blockedReasonPt: ALREADY_OCCUPIED_BUILD_MESSAGE,
      hintPt: null,
      terrain,
      options: [],
    };
  }

  const indexByName = new Map<string, number>();
  assets.forEach((a, idx) => indexByName.set(a.name, idx));

  const neighbors = getHexNeighbors(worldState, q, r, assets);
  const hasAdjacentWater =
    terrainInfo.terrainType === 'water' ||
    neighbors.some((n) => n.exists && n.terrainType === 'water');
  const hasAdjacentActiveForest =
    (terrainInfo.terrainType === 'forest' && !isForestDepleted(existing)) ||
    neighbors.some((n) => n.exists && n.terrainType === 'forest' && !n.isForestDepleted);

  const options: ContextualBuildOption[] = [];
  let workerShortCount = 0;

  for (const assetName of STRATEGY_PALETTE_ORDER) {
    const assetIndex = indexByName.get(assetName);
    if (assetIndex === undefined) continue;
    const bDef = BUILDING_CATALOG[assetName];
    if (!bDef) continue;

    if (!isBuildingAllowedOnTerrain(assetName, terrainInfo.terrainType)) continue;
    if (bDef.requiredTech && !unlockedTechs.includes(bDef.requiredTech)) continue;
    if ((assetName === 'building-watermill' || assetName === 'building-dock') && !hasAdjacentWater) {
      continue;
    }
    if (assetName === 'dirt-lumber' && !hasAdjacentActiveForest) {
      continue;
    }

    const workerShort =
      bDef.workersRequired > 0 &&
      economy.population.availableWorkers < bDef.workersRequired;
    if (workerShort) {
      workerShortCount++;
    }

    const effectiveCost = computeEffectiveBuildCost(assetName, unlockedTechs);
    const afford = canAffordCost(worldState.cash, resources, effectiveCost);

    options.push({
      assetIndex,
      assetName,
      definition: bDef,
      effectiveCost,
      affordable: afford.affordable,
      missingLabelPt: afford.missingLabelPt,
      workerWarningPt: workerShort
        ? `Faltam trab. (${economy.population.availableWorkers}/${bDef.workersRequired})`
        : null,
    });
  }

  // Prioritize terrain-specialist buildings & affordable options cleanly
  options.sort((a, b) => {
    const aSpec = a.definition.allowedTerrains?.length === 1 ? 0 : 1;
    const bSpec = b.definition.allowedTerrains?.length === 1 ? 0 : 1;
    if (aSpec !== bSpec) return aSpec - bSpec;
    if (a.affordable !== b.affordable) return a.affordable ? -1 : 1;
    return 0;
  });

  let hintPt: string | null = null;
  if (options.length === 0) {
    hintPt = 'Nenhuma estrutura compatível desbloqueada para este terreno.';
  } else if (workerShortCount > 0) {
    hintPt = 'Algumas obras precisam de mais moradores: construa Casas para operar a 100%.';
  }

  return {
    canBuildOnHex: options.length > 0,
    blockedReasonPt: null,
    hintPt,
    terrain,
    options,
  };
}
