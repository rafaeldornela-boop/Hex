import type { HexAssetEntry } from './godot-docs';
import {
  BUILDING_CATALOG,
  STRATEGY_PALETTE_ORDER,
  getBuildingDefinition,
  isConstructibleBuildingName,
  type BuildingDefinition,
  type ResourceCost,
} from './buildings-catalog';
import { canAffordCost, computeEffectiveBuildCost, type TurnProductionBreakdown } from './economy-engine';
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
import type { KingdomResources } from './economy-engine';

export interface BuildRuleValidationResult {
  allowed: boolean;
  reasonPt: string | null;
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
      definition: null,
      effectiveCost: null,
      terrain,
    };
  }

  if (!existing || existing.owner !== 'player') {
    return {
      allowed: false,
      reasonPt: NOT_OWNED_BUILD_MESSAGE,
      definition: null,
      effectiveCost: null,
      terrain,
    };
  }

  if (hasHexConstruction(existing, assets) || hasActiveConstructionAtCoord) {
    return {
      allowed: false,
      reasonPt: ALREADY_OCCUPIED_BUILD_MESSAGE,
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
      definition: bDef,
      effectiveCost: null,
      terrain,
    };
  }

  if (!isBuildingAllowedOnTerrain(asset.name, terrainInfo.terrainType)) {
    return {
      allowed: false,
      reasonPt: INCOMPATIBLE_TERRAIN_MESSAGE,
      definition: bDef,
      effectiveCost: null,
      terrain,
    };
  }

  if (bDef.workersRequired > 0 && availableWorkers < bDef.workersRequired) {
    return {
      allowed: false,
      reasonPt: `Sem trabalhadores livres (precisa ${bDef.workersRequired}). Construa Casas.`,
      definition: bDef,
      effectiveCost: null,
      terrain,
    };
  }

  const effectiveCost = computeEffectiveBuildCost(asset.name, unlockedTechs);
  if (checkAffordability) {
    const afford = canAffordCost(worldState.cash, resources, effectiveCost);
    if (!afford.affordable) {
      return {
        allowed: false,
        reasonPt: afford.missingLabelPt ?? 'Recursos insuficientes.',
        definition: bDef,
        effectiveCost,
        terrain,
      };
    }
  }

  return {
    allowed: true,
    reasonPt: null,
    definition: bDef,
    effectiveCost,
    terrain,
  };
}

/**
 * Evaluates "O que posso construir neste hex?" using the exact same rules as `buildInKingdom`.
 * Never returns natural terrains, incompatible buildings, or tech/worker-locked clutter.
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

  const options: ContextualBuildOption[] = [];
  let hiddenByWorkers = 0;

  for (const assetName of STRATEGY_PALETTE_ORDER) {
    const assetIndex = indexByName.get(assetName);
    if (assetIndex === undefined) continue;
    const bDef = BUILDING_CATALOG[assetName];
    if (!bDef) continue;

    if (!isBuildingAllowedOnTerrain(assetName, terrainInfo.terrainType)) continue;
    if (bDef.requiredTech && !unlockedTechs.includes(bDef.requiredTech)) continue;

    if (bDef.workersRequired > 0 && economy.population.availableWorkers < bDef.workersRequired) {
      hiddenByWorkers++;
      continue;
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
  if (options.length === 0 && hiddenByWorkers > 0) {
    hintPt = 'Sem trabalhadores livres para obras aqui. Construa Casas em planície ou floresta.';
  } else if (options.length === 0) {
    hintPt = 'Nenhuma estrutura compatível desbloqueada para este terreno.';
  } else if (hiddenByWorkers > 0) {
    hintPt = 'Construa Casas para liberar mais trabalhadores para obras avançadas.';
  }

  return {
    canBuildOnHex: options.length > 0,
    blockedReasonPt: null,
    hintPt,
    terrain,
    options,
  };
}
