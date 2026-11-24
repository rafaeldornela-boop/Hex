import type { HexAssetEntry } from './godot-docs';
import { getBuildingDefinition } from './buildings-catalog';
import { hexKey, type AxialCoord, type HexOwner, type HexWorldState } from './hex-engine';
import { getHexTerrainAndResource, getTerrainDefenseBonus } from './terrain-engine';
import { AXIAL_DIRECTIONS } from './territory-engine';
import type { TechId } from './tech-engine';

export type UnitType = 'infantry' | 'archer' | 'knight' | 'warship';

export interface UnitDefinition {
  type: UnitType;
  namePt: string;
  attack: number;
  defense: number;
  maxHp: number;
  maintenanceGold: number;
  populationCost: number;
  cost: {
    gold: number;
    wood: number;
    food: number;
    ore: number;
  };
  requiredTech: TechId | null;
  navalOnly: boolean;
}

export interface UnitEntity {
  id: string;
  type: UnitType;
  owner: HexOwner;
  q: number;
  r: number;
  hp: number;
  maxHp: number;
  movedThisTurn: boolean;
}

export const UNIT_CATALOG: Record<UnitType, UnitDefinition> = {
  infantry: {
    type: 'infantry',
    namePt: 'Infantaria',
    attack: 7,
    defense: 7,
    maxHp: 20,
    maintenanceGold: 3,
    populationCost: 1,
    cost: { gold: 80, wood: 5, food: 15, ore: 10 },
    requiredTech: 'military',
    navalOnly: false,
  },
  archer: {
    type: 'archer',
    namePt: 'Arqueiro',
    attack: 9,
    defense: 5,
    maxHp: 16,
    maintenanceGold: 4,
    populationCost: 1,
    cost: { gold: 100, wood: 20, food: 10, ore: 5 },
    requiredTech: 'military',
    navalOnly: false,
  },
  knight: {
    type: 'knight',
    namePt: 'Cavaleiro',
    attack: 14,
    defense: 11,
    maxHp: 28,
    maintenanceGold: 7,
    populationCost: 2,
    cost: { gold: 180, wood: 10, food: 25, ore: 25 },
    requiredTech: 'metallurgy',
    navalOnly: false,
  },
  warship: {
    type: 'warship',
    namePt: 'Navio de Guerra',
    attack: 12,
    defense: 9,
    maxHp: 26,
    maintenanceGold: 6,
    populationCost: 2,
    cost: { gold: 160, wood: 35, food: 10, ore: 15 },
    requiredTech: 'trade',
    navalOnly: true,
  },
};

export function isAdjacentCoord(a: AxialCoord, b: AxialCoord): boolean {
  const dq = b.q - a.q;
  const dr = b.r - a.r;
  return AXIAL_DIRECTIONS.some((d) => d.q === dq && d.r === dr);
}

export function getUnitAt(
  units: UnitEntity[],
  q: number,
  r: number
): UnitEntity | undefined {
  return units.find((u) => u.q === q && u.r === r && u.hp > 0);
}

export function computeFactionMilitaryPower(
  worldState: HexWorldState,
  units: UnitEntity[],
  assets: HexAssetEntry[],
  owner: HexOwner,
  unlockedTechs: TechId[]
): {
  attackPower: number;
  defensePower: number;
  unitCount: number;
  unitMaintenanceGold: number;
} {
  const techBonus = unlockedTechs.includes('metallurgy') ? 4 : 0;
  let attackPower = 0;
  let defensePower = 0;
  let unitCount = 0;
  let unitMaintenanceGold = 0;

  for (const unit of units) {
    if (unit.owner !== owner || unit.hp <= 0) continue;
    const def = UNIT_CATALOG[unit.type];
    const hpRatio = unit.hp / unit.maxHp;
    attackPower += Math.round((def.attack + techBonus) * hpRatio);
    defensePower += Math.round((def.defense + techBonus) * hpRatio);
    unitCount += 1;
    unitMaintenanceGold += def.maintenanceGold;
  }

  for (const tile of Object.values(worldState.hexes)) {
    if (tile.owner !== owner) continue;
    const assetName = assets[tile.structureIndex]?.name ?? '';
    const bDef = getBuildingDefinition(assetName);
    defensePower += bDef.defenseBonus;
  }

  return { attackPower, defensePower, unitCount, unitMaintenanceGold };
}

export function computeHexDefenseScore(
  worldState: HexWorldState,
  q: number,
  r: number,
  units: UnitEntity[],
  assets: HexAssetEntry[],
  defenderTechs: TechId[] = []
): number {
  const tile = worldState.hexes[hexKey(q, r)];
  const terrainInfo = getHexTerrainAndResource(q, r, tile);
  let score = getTerrainDefenseBonus(terrainInfo.terrainType) + 3; // base garrison militia

  if (tile) {
    const assetName = assets[tile.structureIndex]?.name ?? '';
    score += getBuildingDefinition(assetName).defenseBonus;
  }

  const defender = getUnitAt(units, q, r);
  if (defender) {
    const def = UNIT_CATALOG[defender.type];
    const techBonus = defenderTechs.includes('metallurgy') ? 4 : 0;
    score += Math.round((def.defense + techBonus) * (defender.hp / defender.maxHp));
  }

  return score;
}

export interface CombatResolution {
  attackerWon: boolean;
  capturedHex: boolean;
  attackerDamage: number;
  defenderDamage: number;
  lootGold: number;
  summaryPt: string;
}

export function resolveHexCombat(
  attacker: UnitEntity,
  attackerTechs: TechId[],
  worldState: HexWorldState,
  targetQ: number,
  targetR: number,
  units: UnitEntity[],
  assets: HexAssetEntry[],
  defenderTechs: TechId[] = []
): CombatResolution {
  const attDef = UNIT_CATALOG[attacker.type];
  const attTechBonus = attackerTechs.includes('metallurgy') ? 4 : 0;
  const attackScore =
    Math.round((attDef.attack + attTechBonus) * (attacker.hp / attacker.maxHp)) + 3;
  const defenseScore = computeHexDefenseScore(
    worldState,
    targetQ,
    targetR,
    units,
    assets,
    defenderTechs
  );

  const defender = getUnitAt(units, targetQ, targetR);

  if (attackScore >= defenseScore) {
    const margin = attackScore - defenseScore;
    const attackerDamage = Math.max(2, Math.min(attacker.hp - 1, 7 - Math.floor(margin / 2)));
    const defenderDamage = defender ? defender.hp : 0;
    const lootGold = 120;
    return {
      attackerWon: true,
      capturedHex: true,
      attackerDamage,
      defenderDamage,
      lootGold,
      summaryPt: `Vitória! Território capturado (+$${lootGold}).`,
    };
  }

  const deficit = defenseScore - attackScore;
  const attackerDamage = Math.min(attacker.hp, 6 + deficit);
  const defenderDamage = defender ? Math.max(3, Math.floor(attackScore / 2)) : 0;
  return {
    attackerWon: false,
    capturedHex: false,
    attackerDamage,
    defenderDamage,
    lootGold: 0,
    summaryPt: `Ataque repelido (Força ${attackScore} vs Defesa ${defenseScore}).`,
  };
}
