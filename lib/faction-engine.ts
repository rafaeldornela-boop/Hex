import type { HexAssetEntry } from './godot-docs';
import {
  DEFAULT_ROTATION_DEG,
  hexKey,
  type AxialCoord,
  type HexOwner,
  type HexWorldState,
} from './hex-engine';
import { getHexTerrainAndResource } from './terrain-engine';
import { AXIAL_DIRECTIONS, calculateConquestCost } from './territory-engine';
import type { TechId } from './tech-engine';
import { UNIT_CATALOG, getUnitAt, type UnitEntity } from './military-engine';

export type FactionRelation = 'neutral' | 'truce' | 'trade_pact' | 'hostile';

export interface FactionState {
  id: HexOwner;
  namePt: string;
  colorHex: string;
  borderHexNum: number;
  cash: number;
  relation: FactionRelation;
  truceTurnsRemaining: number;
  unlockedTechs: TechId[];
  capitalCoord: AxialCoord;
  personality: 'expansionist' | 'mercantile';
}

export function createInitialFactions(): FactionState[] {
  return [
    {
      id: 'iron_clan',
      namePt: 'Clã da Rocha',
      colorHex: '#dc2626',
      borderHexNum: 0xdc2626,
      cash: 750,
      relation: 'hostile',
      truceTurnsRemaining: 0,
      unlockedTechs: ['mining', 'military'],
      capitalCoord: { q: 5, r: -2 },
      personality: 'expansionist',
    },
    {
      id: 'azure_league',
      namePt: 'Liga de Safira',
      colorHex: '#2563eb',
      borderHexNum: 0x2563eb,
      cash: 850,
      relation: 'neutral',
      truceTurnsRemaining: 0,
      unlockedTechs: ['agriculture', 'trade'],
      capitalCoord: { q: -4, r: 4 },
      personality: 'mercantile',
    },
  ];
}

export function seedRivalFactionTilesAndUnits(
  worldState: HexWorldState,
  assets: HexAssetEntry[]
): { worldState: HexWorldState; units: UnitEntity[] } {
  const indexOf = (name: string) =>
    Math.max(
      0,
      assets.findIndex((a) => a.name === name)
    );

  const nextHexes = { ...worldState.hexes };

  const rivalBlueprints: Array<{
    q: number;
    r: number;
    owner: HexOwner;
    asset: string;
  }> = [
    // Clã da Rocha (East)
    { q: 5, r: -2, owner: 'iron_clan', asset: 'building-castle' },
    { q: 5, r: -3, owner: 'iron_clan', asset: 'building-mine' },
    { q: 4, r: -2, owner: 'iron_clan', asset: 'building-tower' },
    { q: 6, r: -2, owner: 'iron_clan', asset: 'building-archery' },
    // Liga de Safira (Northwest)
    { q: -4, r: 4, owner: 'azure_league', asset: 'building-castle' },
    { q: -4, r: 3, owner: 'azure_league', asset: 'building-market' },
    { q: -3, r: 4, owner: 'azure_league', asset: 'building-house' },
    { q: -5, r: 4, owner: 'azure_league', asset: 'building-farm' },
  ];

  for (const bp of rivalBlueprints) {
    const key = hexKey(bp.q, bp.r);
    const terrainInfo = getHexTerrainAndResource(bp.q, bp.r);
    nextHexes[key] = {
      q: bp.q,
      r: bp.r,
      orientation: DEFAULT_ROTATION_DEG,
      structureIndex: indexOf(bp.asset),
      owner: bp.owner,
      terrainType: terrainInfo.terrainType,
      resourceType: terrainInfo.resourceType,
      resourceAmount: terrainInfo.resourceAmount,
    };
  }

  const units: UnitEntity[] = [
    {
      id: 'unit-iron-1',
      type: 'infantry',
      owner: 'iron_clan',
      q: 4,
      r: -2,
      hp: UNIT_CATALOG.infantry.maxHp,
      maxHp: UNIT_CATALOG.infantry.maxHp,
      movedThisTurn: false,
    },
    {
      id: 'unit-azure-1',
      type: 'archer',
      owner: 'azure_league',
      q: -3,
      r: 4,
      hp: UNIT_CATALOG.archer.maxHp,
      maxHp: UNIT_CATALOG.archer.maxHp,
      movedThisTurn: false,
    },
  ];

  return {
    worldState: {
      ...worldState,
      hexes: nextHexes,
    },
    units,
  };
}

export function countFactionTerritory(
  worldState: HexWorldState,
  factionId: HexOwner
): number {
  let count = 0;
  for (const tile of Object.values(worldState.hexes)) {
    if (tile.owner === factionId) count++;
  }
  return count;
}

export function getTradePactBonusGold(factions: FactionState[]): number {
  return factions.reduce(
    (sum, f) => sum + (f.relation === 'trade_pact' ? 20 : 0),
    0
  );
}

/**
 * Advances AI factions cleanly each turn:
 * - Income generation
 * - Controlled neutral frontier expansion (capped so AI does not overwhelm early)
 * - Occasional garrison recruitment up to territory cap
 */
export function advanceFactionsTurn(params: {
  worldState: HexWorldState;
  factions: FactionState[];
  units: UnitEntity[];
  assets: HexAssetEntry[];
  turn: number;
}): {
  worldState: HexWorldState;
  factions: FactionState[];
  units: UnitEntity[];
  conqueredKeys: string[];
  newsPt: string | null;
} {
  let nextWorld = params.worldState;
  let nextUnits = [...params.units];
  const nextFactions: FactionState[] = [];
  const conqueredKeys: string[] = [];
  let newsPt: string | null = null;

  for (const faction of params.factions) {
    const ownedTiles = Object.values(nextWorld.hexes).filter(
      (t) => t.owner === faction.id
    );
    if (ownedTiles.length === 0) {
      nextFactions.push(faction);
      continue;
    }

    const updatedTruce = Math.max(0, faction.truceTurnsRemaining - 1);
    const updatedRelation: FactionRelation =
      faction.relation === 'truce' && updatedTruce === 0
        ? faction.personality === 'expansionist'
          ? 'hostile'
          : 'neutral'
        : faction.relation;

    let cash = faction.cash + ownedTiles.length * 45 + 60;

    // Expand once every 2 turns if affordable and under soft cap (12 tiles)
    if (params.turn % 2 === 0 && ownedTiles.length < 12 && cash >= 450) {
      const candidates: AxialCoord[] = [];
      for (const tile of ownedTiles) {
        for (const dir of AXIAL_DIRECTIONS) {
          const nq = tile.q + dir.q;
          const nr = tile.r + dir.r;
          const existing = nextWorld.hexes[hexKey(nq, nr)];
          if (!existing || !existing.owner || existing.owner === 'neutral') {
            candidates.push({ q: nq, r: nr });
          }
        }
      }

      if (candidates.length > 0) {
        const pick = candidates[(params.turn + ownedTiles.length) % candidates.length];
        const key = hexKey(pick.q, pick.r);
        const existing = nextWorld.hexes[key];
        const cost = calculateConquestCost(pick, existing, params.assets);
        if (cash >= cost) {
          cash -= cost;
          const terrainInfo = getHexTerrainAndResource(pick.q, pick.r, existing);
          const defaultIdx = Math.max(
            0,
            params.assets.findIndex(
              (a) =>
                a.name ===
                (terrainInfo.terrainType === 'mountain'
                  ? 'stone-mountain'
                  : terrainInfo.terrainType === 'forest'
                    ? 'grass-forest'
                    : terrainInfo.terrainType === 'fertile'
                      ? 'dirt'
                      : terrainInfo.terrainType === 'water'
                        ? 'water'
                        : 'grass')
            )
          );
          nextWorld = {
            ...nextWorld,
            hexes: {
              ...nextWorld.hexes,
              [key]: existing
                ? {
                    ...existing,
                    owner: faction.id,
                    terrainType: terrainInfo.terrainType,
                    resourceType: terrainInfo.resourceType,
                    resourceAmount: terrainInfo.resourceAmount,
                  }
                : {
                    q: pick.q,
                    r: pick.r,
                    orientation: DEFAULT_ROTATION_DEG,
                    structureIndex: defaultIdx,
                    owner: faction.id,
                    terrainType: terrainInfo.terrainType,
                    resourceType: terrainInfo.resourceType,
                    resourceAmount: terrainInfo.resourceAmount,
                  },
            },
          };
          conqueredKeys.push(key);
          newsPt = `${faction.namePt} expandiu seu território.`;
        }
      }
    }

    // Recruit garrison unit if faction has fewer than 3 units and >= 250 cash
    const factionUnits = nextUnits.filter(
      (u) => u.owner === faction.id && u.hp > 0
    );
    if (params.turn % 3 === 0 && factionUnits.length < 3 && cash >= 250) {
      const freeOwned = ownedTiles.find(
        (t) => !getUnitAt(nextUnits, t.q, t.r)
      );
      if (freeOwned) {
        cash -= 160;
        const unitType = faction.personality === 'expansionist' ? 'infantry' : 'archer';
        nextUnits = [
          ...nextUnits,
          {
            id: `unit-${faction.id}-${params.turn}`,
            type: unitType,
            owner: faction.id,
            q: freeOwned.q,
            r: freeOwned.r,
            hp: UNIT_CATALOG[unitType].maxHp,
            maxHp: UNIT_CATALOG[unitType].maxHp,
            movedThisTurn: false,
          },
        ];
      }
    }

    nextFactions.push({
      ...faction,
      cash,
      relation: updatedRelation,
      truceTurnsRemaining: updatedTruce,
    });
  }

  return {
    worldState: nextWorld,
    factions: nextFactions,
    units: nextUnits,
    conqueredKeys,
    newsPt,
  };
}
