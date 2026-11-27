import type { HexAssetEntry } from './godot-docs';

/**
 * Future-ready domain schema for upcoming Hex mechanics.
 * NOTE: None of these mechanics are active yet — these types and pure classifiers
 * establish clean extension seams for territory, terrain, resources, population,
 * workers, production, and city expansion without rewriting the current builder.
 */

export type TerrainCategory =
  | 'grassland'
  | 'forest'
  | 'hill'
  | 'mountain'
  | 'stone'
  | 'sand'
  | 'water'
  | 'dirt'
  | 'infrastructure'
  | 'building'
  | 'unit';

export type ResourceKind = 'wood' | 'stone' | 'ore' | 'food' | 'gold';

export type BuildingFunctionTag =
  | 'housing'
  | 'production'
  | 'commerce'
  | 'defense'
  | 'civic'
  | 'maritime'
  | 'decorative';

export interface TileDomainMetadata {
  ownerTerritoryId?: string;
  level?: number;
  assignedWorkers?: number;
  localPopulation?: number;
  discovered?: boolean;
  modules?: string[];
}

export interface FutureEconomySnapshot {
  resources: Record<ResourceKind, number>;
  population: number;
  populationCap: number;
  availableWorkers: number;
  cityTier: number;
  claimedHexCount: number;
}

export interface HexPieceDescriptor {
  index: number;
  asset: HexAssetEntry;
  displayName: string;
  terrain: TerrainCategory;
  buildingRole: BuildingFunctionTag | null;
}

export function formatHexDisplayName(assetName: string): string {
  return assetName
    .replace(/^building-/, '')
    .replace(/^unit-/, '')
    .replace(/-/g, ' ');
}

export function classifyHexTerrain(asset: HexAssetEntry): TerrainCategory {
  const n = asset.name;
  if (asset.category === 'building') return 'building';
  if (asset.category === 'unit') return 'unit';
  if (asset.category === 'path' || asset.category === 'river' || asset.category === 'bridge') {
    return 'infrastructure';
  }
  if (n.includes('forest')) return 'forest';
  if (n.includes('mountain')) return 'mountain';
  if (n.includes('hill')) return 'hill';
  if (asset.category === 'stone') return 'stone';
  if (asset.category === 'sand') return 'sand';
  if (asset.category === 'water') return 'water';
  if (asset.category === 'dirt') return 'dirt';
  return 'grassland';
}

export function classifyBuildingRole(asset: HexAssetEntry): BuildingFunctionTag | null {
  if (asset.category !== 'building') return null;
  const n = asset.name;
  if (n.includes('house') || n.includes('cabin') || n.includes('village')) return 'housing';
  if (n.includes('farm') || n.includes('mill') || n.includes('mine') || n.includes('smelter') || n.includes('sheep')) {
    return 'production';
  }
  if (n.includes('market')) return 'commerce';
  if (n.includes('port') || n.includes('dock')) return 'maritime';
  if (n.includes('castle') || n.includes('tower') || n.includes('wall') || n.includes('archery')) {
    return 'defense';
  }
  return 'civic';
}

export function describeHexPiece(asset: HexAssetEntry, index: number): HexPieceDescriptor {
  return {
    index,
    asset,
    displayName: formatHexDisplayName(asset.name),
    terrain: classifyHexTerrain(asset),
    buildingRole: classifyBuildingRole(asset),
  };
}
