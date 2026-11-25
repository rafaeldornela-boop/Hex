import type { HexAssetEntry } from './godot-docs';
import { getBuildingDefinition } from './buildings-catalog';
import {
  canAffordCost,
  computeEffectiveBuildCost,
  computeTurnEconomyBreakdown,
  createInitialResources,
  type KingdomResources,
} from './economy-engine';
import { MIN_KINGDOM_POPULATION } from './population-engine';
import {
  DEFAULT_ROTATION_DEG,
  hasHexConstruction,
  hexKey,
  type AxialCoord,
  type HexOwner,
  type HexWorldState,
} from './hex-engine';
import {
  getHexTerrainAndResource,
  getStrategicRegionInfo,
  TERRAIN_METADATA,
} from './terrain-engine';
import {
  AXIAL_DIRECTIONS,
  computeHexInfluence,
  computeTerritorialCapacity,
} from './territory-engine';
import {
  advanceResearchProgress,
  nextRecommendedTech,
  type ResearchState,
  type TechId,
} from './tech-engine';
import {
  UNIT_CATALOG,
  getUnitAt,
  isAdjacentCoord,
  resolveHexCombat,
  type UnitEntity,
  type UnitType,
} from './military-engine';

export type FactionRelation = 'neutral' | 'truce' | 'trade_pact' | 'hostile';

export interface FactionState {
  id: HexOwner;
  namePt: string;
  colorHex: string;
  borderHexNum: number;
  cash: number;
  resources: KingdomResources;
  population: number;
  foodDeficitTurns?: number;
  research: ResearchState;
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
      resources: { wood: 55, stone: 60, food: 50, ore: 40, metal: 8, science: 0 },
      population: 12,
      foodDeficitTurns: 0,
      research: {
        unlocked: ['mining', 'military'],
        activeTechId: 'metallurgy',
        progressScience: 0,
      },
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
      resources: { wood: 60, stone: 45, food: 65, ore: 20, metal: 6, science: 0 },
      population: 14,
      foodDeficitTurns: 0,
      research: {
        unlocked: ['agriculture', 'trade'],
        activeTechId: 'construction',
        progressScience: 0,
      },
      relation: 'neutral',
      truceTurnsRemaining: 0,
      unlockedTechs: ['agriculture', 'trade'],
      capitalCoord: { q: -4, r: 4 },
      personality: 'mercantile',
    },
  ];
}

export function normalizeFactionState(raw: Partial<FactionState>, idx: number): FactionState {
  const defaults = createInitialFactions();
  const fallback = defaults.find((f) => f.id === raw.id) ?? defaults[idx % defaults.length];
  const unlockedTechs: TechId[] = Array.isArray(raw.unlockedTechs)
    ? raw.unlockedTechs
    : fallback.unlockedTechs;

  const research: ResearchState =
    raw.research && Array.isArray(raw.research.unlocked)
      ? raw.research
      : {
          unlocked: unlockedTechs,
          activeTechId: nextRecommendedTech(
            { unlocked: unlockedTechs, activeTechId: null, progressScience: 0 },
            raw.personality ?? fallback.personality
          ),
          progressScience: 0,
        };

  return {
    id: raw.id ?? fallback.id,
    namePt: raw.namePt ?? fallback.namePt,
    colorHex: raw.colorHex ?? fallback.colorHex,
    borderHexNum: raw.borderHexNum ?? fallback.borderHexNum,
    cash: typeof raw.cash === 'number' ? raw.cash : fallback.cash,
    resources:
      raw.resources && typeof raw.resources === 'object'
        ? {
            wood: Number(raw.resources.wood ?? fallback.resources.wood),
            stone: Number(raw.resources.stone ?? fallback.resources.stone),
            food: Number(raw.resources.food ?? fallback.resources.food),
            ore: Number(raw.resources.ore ?? fallback.resources.ore),
            metal: Number(raw.resources.metal ?? fallback.resources.metal),
            science: Number(raw.resources.science ?? 0),
          }
        : createInitialResources(),
    population:
      typeof raw.population === 'number' && raw.population >= 4
        ? Math.round(raw.population)
        : fallback.population,
    foodDeficitTurns:
      typeof raw.foodDeficitTurns === 'number' && raw.foodDeficitTurns >= 0
        ? Math.round(raw.foodDeficitTurns)
        : 0,
    research,
    relation: raw.relation ?? fallback.relation,
    truceTurnsRemaining:
      typeof raw.truceTurnsRemaining === 'number' ? raw.truceTurnsRemaining : 0,
    unlockedTechs: research.unlocked,
    capitalCoord: raw.capitalCoord ?? fallback.capitalCoord,
    personality: raw.personality ?? fallback.personality,
  };
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

function hexDistance(a: AxialCoord, b: AxialCoord): number {
  return (
    (Math.abs(a.q - b.q) +
      Math.abs(a.q + a.r - b.q - b.r) +
      Math.abs(a.r - b.r)) /
    2
  );
}

function chooseAiBuildingForTile(
  terrainType: string,
  faction: FactionState,
  popCurrent: number,
  popCapacity: number,
  availableWorkers: number
): string | null {
  const hasTech = (t: TechId) => faction.research.unlocked.includes(t);

  if (popCurrent >= popCapacity - 2) {
    if (hasTech('construction') && terrainType !== 'water') return 'building-village';
    if (terrainType !== 'water') return 'building-house';
  }

  if (availableWorkers < 2) {
    return terrainType !== 'water' ? 'building-house' : null;
  }

  if (terrainType === 'forest') return 'dirt-lumber';
  if (terrainType === 'mountain') {
    if (hasTech('mining')) return 'building-mine';
    return hasTech('metallurgy') && faction.resources.ore >= 10 ? 'building-smelter' : null;
  }
  if (terrainType === 'fertile') {
    return 'building-farm';
  }
  if (terrainType === 'water') {
    return hasTech('trade') ? 'building-port' : 'building-dock';
  }

  // Plains strategic choice by personality
  if (hasTech('metallurgy') && faction.resources.ore >= 12 && availableWorkers >= 2) {
    return 'building-smelter';
  }
  if (faction.personality === 'expansionist') {
    if (hasTech('military')) return 'building-tower';
    return 'building-wizard-tower';
  }
  return 'building-market';
}

/**
 * Advances AI factions cleanly each turn:
 * - Real production & population growth from faction territory and buildings
 * - Research progression using faction science output
 * - Strategic neutral frontier expansion (reacting to rare regions & player growth)
 * - Construction of real 3D buildings on empty owned hexes
 * - Garrison recruitment and tactical movement / sensible border attacks when hostile
 */
export function advanceFactionsTurn(params: {
  worldState: HexWorldState;
  factions: FactionState[];
  units: UnitEntity[];
  assets: HexAssetEntry[];
  turn: number;
  underConstructionKeys?: Set<string>;
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

  const playerTiles = Object.values(nextWorld.hexes).filter((t) => t.owner === 'player');
  const playerGrowing = playerTiles.length >= 9;

  for (const rawFaction of params.factions) {
    const faction = normalizeFactionState(rawFaction, 0);
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

    // 1. Real economy production + population growth
    const econ = computeTurnEconomyBreakdown({
      worldState: nextWorld,
      resources: faction.resources,
      population: faction.population,
      unlockedTechs: faction.research.unlocked,
      units: nextUnits,
      assets: params.assets,
      owner: faction.id,
      tradePactGoldBonus: updatedRelation === 'trade_pact' ? 20 : 0,
      foodDeficitTurns: faction.foodDeficitTurns ?? 0,
    });

    let cash = Math.max(0, faction.cash + Math.max(25, econ.goldNet + 25));
    const resources: KingdomResources = {
      wood: Math.min(econ.storageCaps.wood, Math.max(0, faction.resources.wood + econ.woodNet)),
      stone: Math.min(econ.storageCaps.stone, Math.max(0, faction.resources.stone + econ.stoneNet)),
      food: Math.min(econ.storageCaps.food, Math.max(0, faction.resources.food + econ.foodNet)),
      ore: Math.min(econ.storageCaps.ore, Math.max(0, faction.resources.ore + econ.oreNet)),
      metal: Math.min(econ.storageCaps.metal, Math.max(0, faction.resources.metal + econ.metalNet)),
      science: faction.resources.science + econ.scienceNet,
    };
    const nextPop = Math.max(
      MIN_KINGDOM_POPULATION,
      Math.min(econ.population.capacity, faction.population + econ.population.projectedGrowth)
    );

    // 2. Research progression
    let nextResearch = faction.research;
    if (!nextResearch.activeTechId) {
      nextResearch = {
        ...nextResearch,
        activeTechId: nextRecommendedTech(nextResearch, faction.personality),
      };
    }
    const resStep = advanceResearchProgress(nextResearch, Math.max(2, econ.scienceNet));
    nextResearch = resStep.nextResearch;
    if (!nextResearch.activeTechId) {
      nextResearch = {
        ...nextResearch,
        activeTechId: nextRecommendedTech(nextResearch, faction.personality),
      };
    }

    // 3. Strategic neutral expansion every 2 turns governed by territorial capacity, reach & free workers (no gold purchase)
    const factionCap = computeTerritorialCapacity({
      worldState: nextWorld,
      population: faction.population,
      unlockedTechs: nextResearch.unlocked,
      assets: params.assets,
      owner: faction.id,
      underConstructionKeys: params.underConstructionKeys,
      playerCapital: faction.capitalCoord,
    });

    if (
      params.turn % 2 === 0 &&
      factionCap.remaining > 0 &&
      econ.population.availableWorkers >= 1
    ) {
      const candidates: Array<{ coord: AxialCoord; score: number }> = [];
      const boundedWorld = typeof nextWorld.worldCols === 'number';
      for (const tile of ownedTiles) {
        for (const dir of AXIAL_DIRECTIONS) {
          const nq = tile.q + dir.q;
          const nr = tile.r + dir.r;
          const existing = nextWorld.hexes[hexKey(nq, nr)];
          if (boundedWorld && !existing) continue;
          if (!existing || !existing.owner || existing.owner === 'neutral') {
            const inf = computeHexInfluence({
              worldState: nextWorld,
              q: nq,
              r: nr,
              population: faction.population,
              unlockedTechs: nextResearch.unlocked,
              assets: params.assets,
              owner: faction.id,
              underConstructionKeys: params.underConstructionKeys,
              anchorCoords: factionCap.anchorCoords,
              maxAnchorReach: factionCap.maxAnchorReach,
              playerCapital: faction.capitalCoord,
            });
            if (!inf.withinReach) continue;

            const strategic = getStrategicRegionInfo(nq, nr, existing);
            let score = (strategic.rareFeature !== 'none' ? 15 : 4) + inf.score;
            if (faction.personality === 'expansionist' && playerGrowing && playerTiles.length > 0) {
              const nearestPlayer = Math.min(
                ...playerTiles.map((pt) => hexDistance({ q: nq, r: nr }, pt))
              );
              score += Math.max(0, 12 - nearestPlayer * 2);
            }
            candidates.push({ coord: { q: nq, r: nr }, score });
          }
        }
      }

      if (candidates.length > 0) {
        candidates.sort((a, b) => b.score - a.score);
        const pick = candidates[0].coord;
        const key = hexKey(pick.q, pick.r);
        const existing = nextWorld.hexes[key];
        const terrainInfo = getHexTerrainAndResource(pick.q, pick.r, existing);
        const defaultName = TERRAIN_METADATA[terrainInfo.terrainType].defaultAssetName;
        const defaultIdx = Math.max(
          0,
          params.assets.findIndex((a) => a.name === defaultName)
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
        newsPt =
          faction.personality === 'expansionist' && playerGrowing
            ? `${faction.namePt} expandiu na direção das suas fronteiras.`
            : `${faction.namePt} expandiu seu território.`;
      }
    }

    // 4. AI constructs buildings on empty owned hexes when affordable
    if (params.turn % 2 === 1) {
      const freeOwned = Object.values(nextWorld.hexes).find(
        (t) => t.owner === faction.id && !hasHexConstruction(t, params.assets)
      );
      if (freeOwned) {
        const terrainInfo = getHexTerrainAndResource(freeOwned.q, freeOwned.r, freeOwned);
        const bAssetName = chooseAiBuildingForTile(
          terrainInfo.terrainType,
          { ...faction, research: nextResearch },
          nextPop,
          econ.population.capacity,
          econ.population.availableWorkers
        );
        if (bAssetName) {
          const idx = params.assets.findIndex((a) => a.name === bAssetName);
          const bDef = getBuildingDefinition(bAssetName);
          const cost = computeEffectiveBuildCost(bAssetName, nextResearch.unlocked);
          const afford = canAffordCost(cash, resources, cost);
          const techOk = !bDef.requiredTech || nextResearch.unlocked.includes(bDef.requiredTech);
          if (idx >= 0 && afford.affordable && techOk) {
            cash -= cost.gold;
            resources.wood -= cost.wood;
            resources.stone -= cost.stone;
            resources.food -= cost.food;
            resources.ore -= cost.ore;
            resources.metal -= cost.metal;
            nextWorld = {
              ...nextWorld,
              hexes: {
                ...nextWorld.hexes,
                [hexKey(freeOwned.q, freeOwned.r)]: {
                  ...freeOwned,
                  structureIndex: idx,
                },
              },
            };
          }
        }
      }
    }

    // 5. Recruit garrison unit if faction has fewer than 3 units and resources allow
    const factionUnits = nextUnits.filter(
      (u) => u.owner === faction.id && u.hp > 0
    );
    if (params.turn % 3 === 0 && factionUnits.length < 3) {
      const unitType: UnitType =
        faction.personality === 'expansionist'
          ? nextResearch.unlocked.includes('metallurgy')
            ? 'knight'
            : 'infantry'
          : 'archer';
      const uDef = UNIT_CATALOG[unitType];
      const spawnTile = Object.values(nextWorld.hexes).find(
        (t) =>
          t.owner === faction.id &&
          !getUnitAt(nextUnits, t.q, t.r) &&
          (assetsNameAt(t.structureIndex, params.assets) === 'building-castle' ||
            assetsNameAt(t.structureIndex, params.assets) === 'building-archery')
      ) ?? Object.values(nextWorld.hexes).find(
        (t) => t.owner === faction.id && !getUnitAt(nextUnits, t.q, t.r)
      );

      if (
        spawnTile &&
        cash >= uDef.cost.gold &&
        resources.metal >= uDef.cost.metal &&
        nextPop - econ.population.usedWorkers >= uDef.populationCost
      ) {
        cash -= uDef.cost.gold;
        resources.wood = Math.max(0, resources.wood - uDef.cost.wood);
        resources.food = Math.max(0, resources.food - uDef.cost.food);
        resources.ore = Math.max(0, resources.ore - uDef.cost.ore);
        resources.metal = Math.max(0, resources.metal - uDef.cost.metal);
        nextUnits = [
          ...nextUnits,
          {
            id: `unit-${faction.id}-${params.turn}-${nextUnits.length}`,
            type: unitType,
            owner: faction.id,
            q: spawnTile.q,
            r: spawnTile.r,
            hp: uDef.maxHp,
            maxHp: uDef.maxHp,
            movedThisTurn: false,
          },
        ];
      }
    }

    // 6. Tactical movement & sensible attack for hostile factions (starting turn >= 4)
    if (updatedRelation === 'hostile' && params.turn >= 4 && playerTiles.length > 0) {
      const readyUnit = nextUnits.find(
        (u) => u.owner === faction.id && u.hp > 0 && !u.movedThisTurn
      );
      if (readyUnit) {
        // Check adjacent player tile first for an intelligent attack (only if odds are reasonable)
        const adjPlayerTile = playerTiles.find((pt) =>
          isAdjacentCoord(readyUnit, pt)
        );
        if (adjPlayerTile) {
          const combat = resolveHexCombat(
            readyUnit,
            nextResearch.unlocked,
            nextWorld,
            adjPlayerTile.q,
            adjPlayerTile.r,
            nextUnits,
            params.assets,
            [],
            params.underConstructionKeys
          );
          const attDef = UNIT_CATALOG[readyUnit.type];
          const estAtt = Math.round(
            (attDef.attack + (nextResearch.unlocked.includes('metallurgy') ? 4 : 0)) *
              (readyUnit.hp / readyUnit.maxHp)
          ) + 3;
          // Only engage if attacker won't throw away the unit blindly
          if (combat.attackerWon || estAtt >= 10) {
            const defOccupant = getUnitAt(nextUnits, adjPlayerTile.q, adjPlayerTile.r);
            nextUnits = nextUnits
              .map((u) => {
                if (u.id === readyUnit.id) {
                  return {
                    ...u,
                    hp: Math.max(0, u.hp - combat.attackerDamage),
                    q: combat.capturedHex ? adjPlayerTile.q : u.q,
                    r: combat.capturedHex ? adjPlayerTile.r : u.r,
                    movedThisTurn: true,
                  };
                }
                if (defOccupant && u.id === defOccupant.id) {
                  return { ...u, hp: Math.max(0, u.hp - combat.defenderDamage) };
                }
                return u;
              })
              .filter((u) => u.hp > 0);

            if (combat.capturedHex) {
              const tKey = hexKey(adjPlayerTile.q, adjPlayerTile.r);
              nextWorld = {
                ...nextWorld,
                hexes: {
                  ...nextWorld.hexes,
                  [tKey]: { ...adjPlayerTile, owner: faction.id },
                },
              };
              conqueredKeys.push(tKey);
              newsPt = `${faction.namePt} atacou e tomou um território na fronteira!`;
            } else {
              newsPt = `${faction.namePt} testou suas defesas na fronteira.`;
            }
          }
        } else if (factionUnits.length >= 2) {
          // Advance 1 unit smoothly toward nearest player territory across safe non-water owned/neutral tiles
          const currentDist = Math.min(...playerTiles.map((pt) => hexDistance(readyUnit, pt)));
          let bestStep: AxialCoord | null = null;
          let bestDist = currentDist;
          const boundedWorld = typeof nextWorld.worldCols === 'number';
          for (const dir of AXIAL_DIRECTIONS) {
            const nq = readyUnit.q + dir.q;
            const nr = readyUnit.r + dir.r;
            const tile = nextWorld.hexes[hexKey(nq, nr)];
            if (boundedWorld && !tile) continue;
            const terrain = getHexTerrainAndResource(nq, nr, tile).terrainType;
            if (terrain === 'water') continue;
            if (tile && tile.owner && tile.owner !== faction.id && tile.owner !== 'neutral') {
              continue;
            }
            if (getUnitAt(nextUnits, nq, nr)) continue;
            const d = Math.min(...playerTiles.map((pt) => hexDistance({ q: nq, r: nr }, pt)));
            if (d < bestDist) {
              bestDist = d;
              bestStep = { q: nq, r: nr };
            }
          }
          if (bestStep) {
            nextUnits = nextUnits.map((u) =>
              u.id === readyUnit.id
                ? { ...u, q: bestStep!.q, r: bestStep!.r, movedThisTurn: true }
                : u
            );
          }
        }
      }
    }

    nextFactions.push({
      ...faction,
      cash,
      resources,
      population: nextPop,
      foodDeficitTurns: econ.foodDeficitTurnsNext,
      research: nextResearch,
      unlockedTechs: nextResearch.unlocked,
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

function assetsNameAt(idx: number, assets: HexAssetEntry[]): string {
  return assets[idx]?.name ?? '';
}
