import type { HexAssetEntry } from './godot-docs';
import type { ResourceCost } from './buildings-catalog';
import { getBuildingLevel, getEffectiveBuildingStats } from './building-upgrade-engine';
import { aggregateTileModuleEffects, getInstalledModules } from './building-modules-engine';
import { hexKey, type AxialCoord, type HexOwner, type HexWorldState, type PlacedHex } from './hex-engine';
import type { RoadConnectivitySummary, RoadMap } from './road-engine';
import { getHexTerrainAndResource, getTerrainDefenseBonus } from './terrain-engine';
import { AXIAL_DIRECTIONS, axialDistance } from './territory-engine';
import type { TechId } from './tech-engine';

export type UnitType = 'infantry' | 'archer' | 'knight' | 'warship';
export type UnitSupplyStatus = 'supplied' | 'strained' | 'unsupplied';
export type ThreatLevel = 'baixo' | 'moderado' | 'alto' | 'critico';

export interface UnitDefinition {
  type: UnitType;
  namePt: string;
  attack: number;
  defense: number;
  maxHp: number;
  baseMoveRange: number;
  maintenanceGold: number;
  populationCost: number;
  cost: {
    gold: number;
    wood: number;
    food: number;
    ore: number;
    metal: number;
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

export interface DamagedHexRecord {
  key: string;
  q: number;
  r: number;
  damagePct: number; // 0..65
  productionPenaltyPct: number; // 0..60
  defensePenalty: number;
  turnsRemaining: number;
  repairCost: ResourceCost;
  reasonPt: string;
  lastConflictTurn: number;
}

export interface UnitSupplyReport {
  unitId: string;
  owner: HexOwner;
  q: number;
  r: number;
  status: UnitSupplyStatus;
  statusLabelPt: string;
  nearestHubDist: number;
  connectedByRoad: boolean;
  combatMultiplier: number;
  attritionDamagePerTurn: number;
  extraMaintenanceGold: number;
  reasonPt: string;
}

export interface ArmyLogisticsSummary {
  owner: HexOwner;
  totalUnits: number;
  suppliedCount: number;
  strainedCount: number;
  unsuppliedCount: number;
  readinessScore: number; // 0..100
  extraSupplyUpkeepGold: number;
  supplyReachHexes: number;
  reportsByUnitId: Record<string, UnitSupplyReport>;
  summaryPt: string;
}

export interface FortificationReport {
  key: string;
  q: number;
  r: number;
  isFortifiedStructure: boolean;
  structuralDefense: number;
  moduleDefense: number;
  neighborBastionAura: number;
  garrisonUnitBonus: number;
  archerSupportBonus: number;
  damagePenalty: number;
  totalDefenseScore: number;
  notesPt: string[];
}

export interface RouteProtectionReport {
  protectionScore: number; // 0..100
  guardedHexCount: number;
  totalPathHexes: number;
  riskReductionPct: number; // 0..65
  statusLabelPt: string;
}

export interface FactionMilitaryIntelligence {
  factionId: HexOwner;
  scoutPrecisionPct: number; // 35..100
  estimatedAttackPower: number;
  estimatedDefensePower: number;
  playerPowerRatio: number;
  threatLevel: ThreatLevel;
  threatLabelPt: string;
  borderExposureCount: number;
  vulnerableHexKeys: string[];
  strategicAssessmentPt: string;
}

export interface ConflictDamageOutcome {
  targetKey: string;
  damagePct: number;
  productionPenaltyPct: number;
  defensePenalty: number;
  stabilityHit: number;
  lootResources: Partial<Record<'wood' | 'stone' | 'food' | 'ore' | 'metal', number>>;
  repairCost: ResourceCost;
  summaryPt: string;
}

export const FORTIFICATION_ASSETS = new Set<string>([
  'building-castle',
  'unit-wall-tower',
  'building-tower',
  'building-archery',
  'building-wall',
  'building-walls',
]);

const SUPPLY_HUB_ASSETS = new Set<string>([
  'building-castle',
  'building-village',
  'unit-mansion',
  'building-archery',
  'unit-wall-tower',
  'building-port',
  'building-farm',
  'building-mill',
]);

const MARITIME_SUPPLY_ASSETS = new Set<string>(['building-port', 'building-dock']);

export const UNIT_CATALOG: Record<UnitType, UnitDefinition> = {
  infantry: {
    type: 'infantry',
    namePt: 'Infantaria',
    attack: 7,
    defense: 7,
    maxHp: 20,
    baseMoveRange: 1,
    maintenanceGold: 3,
    populationCost: 1,
    cost: { gold: 80, wood: 5, food: 15, ore: 10, metal: 0 },
    requiredTech: 'military',
    navalOnly: false,
  },
  archer: {
    type: 'archer',
    namePt: 'Arqueiro',
    attack: 9,
    defense: 5,
    maxHp: 16,
    baseMoveRange: 1,
    maintenanceGold: 4,
    populationCost: 1,
    cost: { gold: 100, wood: 20, food: 10, ore: 5, metal: 0 },
    requiredTech: 'military',
    navalOnly: false,
  },
  knight: {
    type: 'knight',
    namePt: 'Cavaleiro',
    attack: 14,
    defense: 11,
    maxHp: 28,
    baseMoveRange: 2,
    maintenanceGold: 7,
    populationCost: 2,
    cost: { gold: 180, wood: 10, food: 25, ore: 12, metal: 3 },
    requiredTech: 'metallurgy',
    navalOnly: false,
  },
  warship: {
    type: 'warship',
    namePt: 'Navio de Guerra',
    attack: 12,
    defense: 9,
    maxHp: 26,
    baseMoveRange: 2,
    maintenanceGold: 6,
    populationCost: 2,
    cost: { gold: 160, wood: 35, food: 10, ore: 15, metal: 0 },
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

export function getUnitMovementAllowance(
  unit: UnitEntity,
  worldState: HexWorldState,
  unlockedTechs: TechId[] = [],
  roads?: RoadMap
): number {
  const def = UNIT_CATALOG[unit.type];
  let range = def.baseMoveRange;
  const currentRoad = roads?.[hexKey(unit.q, unit.r)];
  if (unit.type === 'infantry' && currentRoad && currentRoad.owner === unit.owner && currentRoad.level >= 2) {
    range += 1;
  }
  if (unit.type === 'warship' && unlockedTechs.includes('trade')) {
    range += 1;
  }
  if (unit.type === 'knight') {
    const tile = worldState.hexes[hexKey(unit.q, unit.r)];
    const terrain = getHexTerrainAndResource(unit.q, unit.r, tile).terrainType;
    if ((terrain === 'mountain' || terrain === 'forest') && !currentRoad) {
      range = 1;
    }
  }
  return Math.max(1, range);
}

export function getReachableUnitCoords(params: {
  unit: UnitEntity;
  worldState: HexWorldState;
  units: UnitEntity[];
  assets: HexAssetEntry[];
  unlockedTechs?: TechId[];
  roads?: RoadMap;
  underConstructionKeys?: Set<string>;
  canAttackOwner?: (targetOwner: HexOwner) => boolean;
}): Array<AxialCoord & { cost: number; isAttackTarget: boolean }> {
  const {
    unit,
    worldState,
    units,
    assets,
    unlockedTechs = [],
    roads,
    underConstructionKeys,
    canAttackOwner = (owner) => owner !== 'player' && owner !== 'neutral' && owner !== unit.owner,
  } = params;

  if (unit.movedThisTurn || unit.hp <= 0) return [];

  const uDef = UNIT_CATALOG[unit.type];
  const maxSteps = getUnitMovementAllowance(unit, worldState, unlockedTechs, roads);
  const bounded = typeof worldState.worldCols === 'number';

  const queue: Array<{ q: number; r: number; cost: number }> = [{ q: unit.q, r: unit.r, cost: 0 }];
  const bestCost = new Map<string, number>([[hexKey(unit.q, unit.r), 0]]);
  const results = new Map<string, AxialCoord & { cost: number; isAttackTarget: boolean }>();

  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur.cost >= maxSteps) continue;

    for (const dir of AXIAL_DIRECTIONS) {
      const nq = cur.q + dir.q;
      const nr = cur.r + dir.r;
      const nk = hexKey(nq, nr);
      const tile = worldState.hexes[nk];
      if (bounded && !tile) continue;

      const terrain = getHexTerrainAndResource(nq, nr, tile).terrainType;
      const assetName = tile ? (assets[tile.structureIndex]?.name ?? '') : '';
      const isCompletedBridge =
        assetName === 'bridge' && !underConstructionKeys?.has(nk);

      if (uDef.navalOnly && terrain !== 'water') continue;
      if (!uDef.navalOnly && terrain === 'water' && !isCompletedBridge) continue;

      const occupant = getUnitAt(units, nq, nr);
      const targetOwner: HexOwner = tile?.owner ?? 'neutral';

      const isFriendlyOrNeutral = targetOwner === unit.owner || targetOwner === 'neutral';
      const isEnemyTarget = targetOwner !== unit.owner && targetOwner !== 'neutral';
      const occupiedByFriendly = Boolean(occupant && occupant.owner === unit.owner);

      const roadHere = roads?.[nk];
      const stepCost =
        !uDef.navalOnly &&
        (terrain === 'mountain' || terrain === 'forest') &&
        !roadHere &&
        cur.cost > 0
          ? 2
          : 1;
      const nextCost = cur.cost + stepCost;
      if (nextCost > maxSteps) continue;

      if (isEnemyTarget) {
        if (canAttackOwner(targetOwner)) {
          const prev = results.get(nk);
          if (!prev || nextCost < prev.cost) {
            results.set(nk, { q: nq, r: nr, cost: nextCost, isAttackTarget: true });
          }
        }
        // Combat stops further movement through enemy hex
        continue;
      }

      if (occupant && !occupiedByFriendly) continue;

      const recorded = bestCost.get(nk);
      if (recorded === undefined || nextCost < recorded) {
        bestCost.set(nk, nextCost);
        if (isFriendlyOrNeutral && !occupant) {
          results.set(nk, { q: nq, r: nr, cost: nextCost, isAttackTarget: false });
        }
        if (nextCost < maxSteps) {
          queue.push({ q: nq, r: nr, cost: nextCost });
        }
      }
    }
  }

  return Array.from(results.values());
}

export function evaluateUnitSupply(params: {
  unit: UnitEntity;
  worldState: HexWorldState;
  assets: HexAssetEntry[];
  unlockedTechs?: TechId[];
  roads?: RoadMap;
  connectivity?: RoadConnectivitySummary;
  underConstructionKeys?: Set<string>;
  capitalCoord?: AxialCoord;
  foodDeficitTurns?: number;
  alliedOwners?: Set<HexOwner>;
}): UnitSupplyReport {
  const {
    unit,
    worldState,
    assets,
    unlockedTechs = [],
    roads = {},
    connectivity,
    underConstructionKeys,
    capitalCoord,
    foodDeficitTurns = 0,
    alliedOwners,
  } = params;

  const isFriendlyOwner = (owner: HexOwner | undefined) =>
    owner === unit.owner || (owner ? alliedOwners?.has(owner) ?? false : false);

  const uDef = UNIT_CATALOG[unit.type];
  const baseReach =
    (uDef.navalOnly ? 4 : 4) +
    (unlockedTechs.includes('construction') ? 1 : 0) +
    (unlockedTechs.includes('engineering') ? 1 : 0) +
    (uDef.navalOnly && unlockedTechs.includes('trade') ? 1 : 0);

  const hubCoords: AxialCoord[] = [];
  if (capitalCoord) {
    const capTile = worldState.hexes[hexKey(capitalCoord.q, capitalCoord.r)];
    if (!capTile || isFriendlyOwner(capTile.owner)) {
      hubCoords.push(capitalCoord);
    }
  }

  let bestHubDist = Infinity;
  let extraModuleRange = 0;

  for (const tile of Object.values(worldState.hexes)) {
    if (!isFriendlyOwner(tile.owner)) continue;
    const key = hexKey(tile.q, tile.r);
    if (underConstructionKeys?.has(key)) continue;
    const assetName = assets[tile.structureIndex]?.name ?? '';

    const validHub = uDef.navalOnly
      ? MARITIME_SUPPLY_ASSETS.has(assetName)
      : SUPPLY_HUB_ASSETS.has(assetName);
    if (!validHub) continue;

    hubCoords.push({ q: tile.q, r: tile.r });
    const d = axialDistance(unit, tile);
    if (d < bestHubDist) {
      bestHubDist = d;
    }

    if (d <= 2) {
      const mods = getInstalledModules(tile);
      if (mods.includes('mil_armory') || mods.includes('mil_beacon') || mods.includes('port_lighthouse')) {
        extraModuleRange = Math.max(extraModuleRange, 1);
      }
    }
  }

  for (const hc of hubCoords) {
    const d = axialDistance(unit, hc);
    if (d < bestHubDist) bestHubDist = d;
  }

  const unitKey = hexKey(unit.q, unit.r);
  const unitTile = worldState.hexes[unitKey];
  const onFriendlyTile = isFriendlyOwner(unitTile?.owner);
  const roadHere = roads[unitKey];
  const metricHere = connectivity?.tileMetricsByKey[unitKey];
  const connectedByRoad =
    Boolean(metricHere?.connectedToCity) ||
    (Boolean(roadHere) && isFriendlyOwner(roadHere?.owner)) ||
    AXIAL_DIRECTIONS.some((dir) => {
      const nk = hexKey(unit.q + dir.q, unit.r + dir.r);
      const nRoad = roads[nk];
      return Boolean(connectivity?.tileMetricsByKey[nk]?.connectedToCity) || (Boolean(nRoad) && isFriendlyOwner(nRoad?.owner));
    });

  const effectiveReach = baseReach + extraModuleRange + (connectedByRoad ? 2 : 0);

  if (foodDeficitTurns >= 3) {
    return {
      unitId: unit.id,
      owner: unit.owner,
      q: unit.q,
      r: unit.r,
      status: 'unsupplied',
      statusLabelPt: 'Sem Suprimentos',
      nearestHubDist: Number.isFinite(bestHubDist) ? bestHubDist : 99,
      connectedByRoad,
      combatMultiplier: 0.7,
      attritionDamagePerTurn: 3,
      extraMaintenanceGold: 2,
      reasonPt: 'Escassez severa de alimentos interrompeu o abastecimento.',
    };
  }

  if (hubCoords.length === 0 || bestHubDist > effectiveReach + 1) {
    return {
      unitId: unit.id,
      owner: unit.owner,
      q: unit.q,
      r: unit.r,
      status: 'unsupplied',
      statusLabelPt: 'Sem Suprimentos',
      nearestHubDist: Number.isFinite(bestHubDist) ? bestHubDist : 99,
      connectedByRoad,
      combatMultiplier: 0.7,
      attritionDamagePerTurn: 3,
      extraMaintenanceGold: 2,
      reasonPt: 'Unidade isolada além das linhas de suprimento (-30% combate, atrito).',
    };
  }

  if (
    foodDeficitTurns >= 2 ||
    bestHubDist > effectiveReach ||
    (!onFriendlyTile && !connectedByRoad && bestHubDist >= effectiveReach)
  ) {
    return {
      unitId: unit.id,
      owner: unit.owner,
      q: unit.q,
      r: unit.r,
      status: 'strained',
      statusLabelPt: 'Suprimento Limitado',
      nearestHubDist: bestHubDist,
      connectedByRoad,
      combatMultiplier: 0.85,
      attritionDamagePerTurn: 0,
      extraMaintenanceGold: 1,
      reasonPt: 'Linha de suprimento estendida (-15% eficácia em combate).',
    };
  }

  return {
    unitId: unit.id,
    owner: unit.owner,
    q: unit.q,
    r: unit.r,
    status: 'supplied',
    statusLabelPt: 'Abastecida',
    nearestHubDist: bestHubDist,
    connectedByRoad,
    combatMultiplier: 1.0,
    attritionDamagePerTurn: 0,
    extraMaintenanceGold: 0,
    reasonPt: connectedByRoad
      ? 'Logística rodoviária conectada ao núcleo urbano.'
      : 'Abastecida por guarnições próximas.',
  };
}

export function evaluateFactionLogistics(params: {
  worldState: HexWorldState;
  units: UnitEntity[];
  assets: HexAssetEntry[];
  owner: HexOwner;
  unlockedTechs?: TechId[];
  roads?: RoadMap;
  connectivity?: RoadConnectivitySummary;
  underConstructionKeys?: Set<string>;
  capitalCoord?: AxialCoord;
  foodDeficitTurns?: number;
  alliedOwners?: Set<HexOwner>;
}): ArmyLogisticsSummary {
  const ownedUnits = params.units.filter((u) => u.owner === params.owner && u.hp > 0);
  const reportsByUnitId: Record<string, UnitSupplyReport> = {};
  let suppliedCount = 0;
  let strainedCount = 0;
  let unsuppliedCount = 0;
  let extraSupplyUpkeepGold = 0;

  for (const unit of ownedUnits) {
    const rep = evaluateUnitSupply({
      unit,
      worldState: params.worldState,
      assets: params.assets,
      unlockedTechs: params.unlockedTechs,
      roads: params.roads,
      connectivity: params.connectivity,
      underConstructionKeys: params.underConstructionKeys,
      capitalCoord: params.capitalCoord,
      foodDeficitTurns: params.foodDeficitTurns,
      alliedOwners: params.alliedOwners,
    });
    reportsByUnitId[unit.id] = rep;
    extraSupplyUpkeepGold += rep.extraMaintenanceGold;
    if (rep.status === 'supplied') suppliedCount += 1;
    else if (rep.status === 'strained') strainedCount += 1;
    else unsuppliedCount += 1;
  }

  const totalUnits = ownedUnits.length;
  const readinessScore =
    totalUnits === 0
      ? 100
      : Math.round(
          ((suppliedCount * 100 + strainedCount * 68 + unsuppliedCount * 30) / totalUnits)
        );
  const unlockedTechs = params.unlockedTechs ?? [];
  const supplyReachHexes =
    4 +
    (unlockedTechs.includes('construction') ? 1 : 0) +
    (unlockedTechs.includes('engineering') ? 1 : 0);

  let summaryPt = 'Linhas logísticas estáveis.';
  if (totalUnits === 0) {
    summaryPt = 'Sem tropas em campanha; guarnições locais ativas.';
  } else if (unsuppliedCount > 0) {
    summaryPt = `${unsuppliedCount} ${
      unsuppliedCount === 1 ? 'unidade sem suprimentos' : 'unidades sem suprimentos'
    } sofrendo atrito.`;
  } else if (strainedCount > 0) {
    summaryPt = `${strainedCount} ${
      strainedCount === 1 ? 'unidade com suprimento limitado' : 'unidades com suprimento limitado'
    }.`;
  }

  return {
    owner: params.owner,
    totalUnits,
    suppliedCount,
    strainedCount,
    unsuppliedCount,
    readinessScore,
    extraSupplyUpkeepGold,
    supplyReachHexes,
    reportsByUnitId,
    summaryPt,
  };
}

export function applySupplyConsequencesToUnits(params: {
  units: UnitEntity[];
  worldState: HexWorldState;
  assets: HexAssetEntry[];
  unlockedTechsByOwner: Partial<Record<HexOwner, TechId[]>>;
  roads?: RoadMap;
  connectivity?: RoadConnectivitySummary;
  underConstructionKeys?: Set<string>;
  capitalByOwner?: Partial<Record<HexOwner, AxialCoord>>;
  foodDeficitByOwner?: Partial<Record<HexOwner, number>>;
  alliedOwnersByOwner?: Partial<Record<HexOwner, Set<HexOwner>>>;
}): {
  units: UnitEntity[];
  attritionMessagesPt: string[];
  supplyExtraUpkeepByOwner: Record<string, number>;
} {
  const attritionMessagesPt: string[] = [];
  const supplyExtraUpkeepByOwner: Record<string, number> = {};

  const updated = params.units
    .map((u) => {
      if (u.hp <= 0) return u;
      const rep = evaluateUnitSupply({
        unit: u,
        worldState: params.worldState,
        assets: params.assets,
        unlockedTechs: params.unlockedTechsByOwner[u.owner] ?? [],
        roads: params.roads,
        connectivity: params.connectivity,
        underConstructionKeys: params.underConstructionKeys,
        capitalCoord: params.capitalByOwner?.[u.owner],
        foodDeficitTurns: params.foodDeficitByOwner?.[u.owner] ?? 0,
        alliedOwners: params.alliedOwnersByOwner?.[u.owner],
      });
      supplyExtraUpkeepByOwner[u.owner] =
        (supplyExtraUpkeepByOwner[u.owner] ?? 0) + rep.extraMaintenanceGold;

      if (rep.attritionDamagePerTurn > 0) {
        const nextHp = Math.max(1, u.hp - rep.attritionDamagePerTurn);
        if (u.owner === 'player' && nextHp < u.hp) {
          attritionMessagesPt.push(
            `${UNIT_CATALOG[u.type].namePt} em (${u.q},${u.r}) perdeu ${u.hp - nextHp} HP por falta de suprimentos.`
          );
        }
        return { ...u, hp: nextHp };
      }

      return u;
    });

  return {
    units: updated,
    attritionMessagesPt,
    supplyExtraUpkeepByOwner,
  };
}

export function computeNeighborFortificationBonus(
  worldState: HexWorldState,
  q: number,
  r: number,
  owner: HexOwner | undefined,
  assets: HexAssetEntry[],
  underConstructionKeys?: Set<string>,
  damagedHexes?: Record<string, DamagedHexRecord>
): number {
  if (!owner || owner === 'neutral') return 0;
  let bonus = 0;
  for (const dir of AXIAL_DIRECTIONS) {
    const nq = q + dir.q;
    const nr = r + dir.r;
    const nk = hexKey(nq, nr);
    const nTile = worldState.hexes[nk];
    if (!nTile || nTile.owner !== owner) continue;
    if (underConstructionKeys?.has(nk)) continue;
    const nAsset = assets[nTile.structureIndex]?.name ?? '';
    if (!FORTIFICATION_ASSETS.has(nAsset)) continue;
    const dmg = damagedHexes?.[nk];
    if (dmg && dmg.damagePct >= 50) continue;
    bonus += 2;
  }
  return Math.min(4, bonus);
}

export function evaluateHexFortification(params: {
  worldState: HexWorldState;
  q: number;
  r: number;
  units: UnitEntity[];
  assets: HexAssetEntry[];
  defenderTechs?: TechId[];
  underConstructionKeys?: Set<string>;
  damagedHexes?: Record<string, DamagedHexRecord>;
}): FortificationReport {
  const {
    worldState,
    q,
    r,
    units,
    assets,
    defenderTechs = [],
    underConstructionKeys,
    damagedHexes,
  } = params;
  const key = hexKey(q, r);
  const tile = worldState.hexes[key];
  const terrainInfo = getHexTerrainAndResource(q, r, tile);
  const assetName = tile ? (assets[tile.structureIndex]?.name ?? '') : '';
  const isCompleted = Boolean(tile && !underConstructionKeys?.has(key));
  const isFortifiedStructure = isCompleted && FORTIFICATION_ASSETS.has(assetName);
  const notesPt: string[] = [];

  let structuralDefense = 0;
  let moduleDefense = 0;
  if (tile && isCompleted) {
    structuralDefense = getEffectiveBuildingStats(assetName, getBuildingLevel(tile)).defenseBonus;
    moduleDefense = aggregateTileModuleEffects(assetName, getInstalledModules(tile)).defenseBonus;
    if (structuralDefense > 0) notesPt.push(`Estrutura +${structuralDefense}`);
    if (moduleDefense > 0) notesPt.push(`Módulos +${moduleDefense}`);
  }

  const neighborBastionAura = tile
    ? computeNeighborFortificationBonus(
        worldState,
        q,
        r,
        tile.owner,
        assets,
        underConstructionKeys,
        damagedHexes
      )
    : 0;
  if (neighborBastionAura > 0) {
    notesPt.push(`Cobertura de fortificação vizinha +${neighborBastionAura}`);
  }

  const defender = getUnitAt(units, q, r);
  const techBonus = defenderTechs.includes('metallurgy') ? 4 : 0;
  let garrisonUnitBonus = 0;
  if (defender) {
    const def = UNIT_CATALOG[defender.type];
    const entrenchment = isFortifiedStructure ? 3 : 0;
    garrisonUnitBonus =
      Math.round((def.defense + techBonus) * (defender.hp / defender.maxHp)) + entrenchment;
    notesPt.push(
      entrenchment > 0
        ? `Guarnição entrincheirada +${garrisonUnitBonus}`
        : `Guarnição +${garrisonUnitBonus}`
    );
  }

  // Allied/owned archer standing in an adjacent hex provides covering volley defense
  let archerSupportBonus = 0;
  if (tile && tile.owner && tile.owner !== 'neutral') {
    const supportingArcher = units.find(
      (u) =>
        u.owner === tile.owner &&
        u.hp > 0 &&
        u.type === 'archer' &&
        axialDistance(u, { q, r }) === 1
    );
    if (supportingArcher) {
      archerSupportBonus = 2;
      notesPt.push('Apoio de arqueiros +2');
    }
  }

  const dmgRecord = damagedHexes?.[key];
  const damagePenalty = dmgRecord ? Math.max(0, dmgRecord.defensePenalty) : 0;
  if (damagePenalty > 0) {
    notesPt.push(`Danos estruturais -${damagePenalty}`);
  }

  const baseMilitiaAndTerrain = getTerrainDefenseBonus(terrainInfo.terrainType) + 3;
  const totalDefenseScore = Math.max(
    1,
    baseMilitiaAndTerrain +
      structuralDefense +
      moduleDefense +
      neighborBastionAura +
      garrisonUnitBonus +
      archerSupportBonus -
      damagePenalty
  );

  return {
    key,
    q,
    r,
    isFortifiedStructure,
    structuralDefense,
    moduleDefense,
    neighborBastionAura,
    garrisonUnitBonus,
    archerSupportBonus,
    damagePenalty,
    totalDefenseScore,
    notesPt,
  };
}

export function evaluateRouteMilitaryProtection(params: {
  worldState: HexWorldState;
  units: UnitEntity[];
  assets: HexAssetEntry[];
  owner: HexOwner;
  pathCoords: AxialCoord[];
  underConstructionKeys?: Set<string>;
}): RouteProtectionReport {
  const { worldState, units, assets, owner, pathCoords, underConstructionKeys } = params;
  if (pathCoords.length === 0) {
    return {
      protectionScore: 0,
      guardedHexCount: 0,
      totalPathHexes: 0,
      riskReductionPct: 0,
      statusLabelPt: 'Desprotegida',
    };
  }

  const friendlyForts: PlacedHex[] = [];
  for (const tile of Object.values(worldState.hexes)) {
    if (tile.owner !== owner) continue;
    const k = hexKey(tile.q, tile.r);
    if (underConstructionKeys?.has(k)) continue;
    const name = assets[tile.structureIndex]?.name ?? '';
    if (FORTIFICATION_ASSETS.has(name) || name === 'building-port') {
      friendlyForts.push(tile);
    }
  }
  const friendlyUnits = units.filter((u) => u.owner === owner && u.hp > 0);

  let guardedHexCount = 0;
  for (const coord of pathCoords) {
    const nearFort = friendlyForts.some((f) => axialDistance(coord, f) <= 2);
    const nearUnit = friendlyUnits.some((u) => axialDistance(coord, u) <= 2);
    if (nearFort || nearUnit) {
      guardedHexCount += 1;
    }
  }

  const protectionScore = Math.round((guardedHexCount / pathCoords.length) * 100);
  const riskReductionPct = Math.min(65, Math.round(protectionScore * 0.65));
  const statusLabelPt =
    protectionScore >= 75
      ? 'Escolta Segura'
      : protectionScore >= 40
        ? 'Patrulha Parcial'
        : 'Rota Vulnerável';

  return {
    protectionScore,
    guardedHexCount,
    totalPathHexes: pathCoords.length,
    riskReductionPct,
    statusLabelPt,
  };
}

export function computeFactionMilitaryPower(
  worldState: HexWorldState,
  units: UnitEntity[],
  assets: HexAssetEntry[],
  owner: HexOwner,
  unlockedTechs: TechId[],
  underConstructionKeys?: Set<string>,
  damagedHexes?: Record<string, DamagedHexRecord>
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
    const key = hexKey(tile.q, tile.r);
    if (underConstructionKeys?.has(key)) continue;
    const assetName = assets[tile.structureIndex]?.name ?? '';
    const stats = getEffectiveBuildingStats(assetName, getBuildingLevel(tile));
    const modDef = aggregateTileModuleEffects(assetName, getInstalledModules(tile)).defenseBonus;
    const dmgPenalty = damagedHexes?.[key]?.defensePenalty ?? 0;
    defensePower += Math.max(0, stats.defenseBonus + modDef - dmgPenalty);
  }

  return { attackPower, defensePower, unitCount, unitMaintenanceGold };
}

export function computeHexDefenseScore(
  worldState: HexWorldState,
  q: number,
  r: number,
  units: UnitEntity[],
  assets: HexAssetEntry[],
  defenderTechs: TechId[] = [],
  underConstructionKeys?: Set<string>,
  damagedHexes?: Record<string, DamagedHexRecord>
): number {
  return evaluateHexFortification({
    worldState,
    q,
    r,
    units,
    assets,
    defenderTechs,
    underConstructionKeys,
    damagedHexes,
  }).totalDefenseScore;
}

export function computeMilitaryIntelligence(params: {
  worldState: HexWorldState;
  units: UnitEntity[];
  assets: HexAssetEntry[];
  playerTechs: TechId[];
  factions: Array<{ id: HexOwner; namePt: string; unlockedTechs: TechId[] }>;
  diplomacyRelations?: Partial<Record<HexOwner, string>>;
  underConstructionKeys?: Set<string>;
  damagedHexes?: Record<string, DamagedHexRecord>;
}): Record<string, FactionMilitaryIntelligence> {
  const {
    worldState,
    units,
    assets,
    playerTechs,
    factions,
    diplomacyRelations = {},
    underConstructionKeys,
    damagedHexes,
  } = params;

  const playerPower = computeFactionMilitaryPower(
    worldState,
    units,
    assets,
    'player',
    playerTechs,
    underConstructionKeys,
    damagedHexes
  );
  const playerTotal = Math.max(1, playerPower.attackPower + playerPower.defensePower);

  const playerTiles = Object.values(worldState.hexes).filter((t) => t.owner === 'player');
  const watchTowers = playerTiles.filter((t) => {
    const name = assets[t.structureIndex]?.name ?? '';
    const mods = getInstalledModules(t);
    return (
      name === 'building-tower' ||
      name === 'unit-wall-tower' ||
      mods.includes('mil_beacon') ||
      mods.includes('port_lighthouse')
    );
  });

  // Identify player frontier tiles exposed to each faction
  const intelByFaction: Record<string, FactionMilitaryIntelligence> = {};

  for (const faction of factions) {
    const actual = computeFactionMilitaryPower(
      worldState,
      units,
      assets,
      faction.id,
      faction.unlockedTechs,
      underConstructionKeys,
      damagedHexes
    );
    const factionTiles = Object.values(worldState.hexes).filter((t) => t.owner === faction.id);
    const factionUnits = units.filter((u) => u.owner === faction.id && u.hp > 0);

    // Scout coverage comes from towers, beacons, nearby player units, and diplomatic relation
    const nearWatchCount = watchTowers.filter((wt) =>
      factionTiles.some((ft) => axialDistance(wt, ft) <= 4)
    ).length;
    const nearUnitsCount = units.filter(
      (u) =>
        u.owner === 'player' &&
        u.hp > 0 &&
        (factionUnits.some((fu) => axialDistance(u, fu) <= 3) ||
          factionTiles.some((ft) => axialDistance(u, ft) <= 3))
    ).length;

    const rel = diplomacyRelations[faction.id];
    const diploSight = rel === 'allied' ? 40 : rel === 'friendly' || rel === 'trade_pact' ? 20 : 0;
    const scoutPrecisionPct = Math.min(
      100,
      40 + nearWatchCount * 15 + nearUnitsCount * 12 + diploSight + (playerTechs.includes('trade') ? 8 : 0)
    );

    const vulnerableKeys: string[] = [];
    for (const pt of playerTiles) {
      const hasNeighborEnemy = AXIAL_DIRECTIONS.some((dir) => {
        const nt = worldState.hexes[hexKey(pt.q + dir.q, pt.r + dir.r)];
        return nt?.owner === faction.id;
      });
      const nearEnemyUnit = factionUnits.some((fu) => axialDistance(pt, fu) <= 2);
      if (hasNeighborEnemy || nearEnemyUnit) {
        const hexDef = computeHexDefenseScore(
          worldState,
          pt.q,
          pt.r,
          units,
          assets,
          playerTechs,
          underConstructionKeys,
          damagedHexes
        );
        if (hexDef < Math.max(12, actual.attackPower * 0.45)) {
          vulnerableKeys.push(hexKey(pt.q, pt.r));
        }
      }
    }

    const factionTotal = actual.attackPower + actual.defensePower;
    const ratioToPlayer = Number((factionTotal / playerTotal).toFixed(2));
    const isHostile = rel === 'hostile';

    let threatLevel: ThreatLevel = 'baixo';
    if ((isHostile && (ratioToPlayer >= 1.1 || vulnerableKeys.length >= 2)) || ratioToPlayer >= 1.6) {
      threatLevel = 'critico';
    } else if (isHostile || ratioToPlayer >= 1.15 || vulnerableKeys.length >= 1) {
      threatLevel = 'alto';
    } else if (ratioToPlayer >= 0.75) {
      threatLevel = 'moderado';
    }

    const threatLabelPt =
      threatLevel === 'critico'
        ? 'Ameaça Crítica'
        : threatLevel === 'alto'
          ? 'Ameaça Alta'
          : threatLevel === 'moderado'
            ? 'Ameaça Moderada'
            : 'Ameaça Baixa';

    let strategicAssessmentPt = `${faction.namePt}: força estimada equilibrada.`;
    if (vulnerableKeys.length > 0) {
      strategicAssessmentPt = `${faction.namePt}: ${vulnerableKeys.length} hex(es) de fronteira vulnerável(is) próximo(s).`;
    } else if (ratioToPlayer >= 1.25) {
      strategicAssessmentPt = `${faction.namePt} possui superioridade militar significativa.`;
    } else if (ratioToPlayer <= 0.6) {
      strategicAssessmentPt = `Nosso poder militar intimida ${faction.namePt}.`;
    }

    intelByFaction[faction.id] = {
      factionId: faction.id,
      scoutPrecisionPct,
      estimatedAttackPower: actual.attackPower,
      estimatedDefensePower: actual.defensePower,
      playerPowerRatio: Number((playerTotal / Math.max(1, factionTotal)).toFixed(2)),
      threatLevel,
      threatLabelPt,
      borderExposureCount: vulnerableKeys.length,
      vulnerableHexKeys: vulnerableKeys,
      strategicAssessmentPt,
    };
  }

  return intelByFaction;
}

export function createConflictDamageForTile(params: {
  tile: PlacedHex;
  assets: HexAssetEntry[];
  captured: boolean;
  battleIntensity: number; // 0.5..1.5
  turn: number;
  defenderHasWallsOrEngineering?: boolean;
}): ConflictDamageOutcome {
  const {
    tile,
    assets,
    captured,
    battleIntensity,
    turn,
    defenderHasWallsOrEngineering = false,
  } = params;
  const key = hexKey(tile.q, tile.r);
  const assetName = assets[tile.structureIndex]?.name ?? '';
  const stats = getEffectiveBuildingStats(assetName, getBuildingLevel(tile));
  const hasConstructedAsset =
    stats.workersRequired > 0 ||
    stats.housingCapacity > 0 ||
    stats.defenseBonus > 0 ||
    stats.storageBonus > 0 ||
    stats.production.gold > 0 ||
    stats.production.food > 0 ||
    stats.production.wood > 0 ||
    stats.production.ore > 0 ||
    stats.production.metal > 0 ||
    stats.production.science > 0;

  if (!hasConstructedAsset) {
    return {
      targetKey: key,
      damagePct: 0,
      productionPenaltyPct: 0,
      defensePenalty: 0,
      stabilityHit: captured ? 1 : 0,
      lootResources: {},
      repairCost: { gold: 0, wood: 0, stone: 0, food: 0, ore: 0, metal: 0 },
      summaryPt: captured ? 'Terreno capturado sem edifícios danificados.' : 'Escaramuça em campo aberto.',
    };
  }

  const mitigation = defenderHasWallsOrEngineering ? 0.78 : 1.0;
  const rawPct = Math.round((captured ? 34 : 18) * battleIntensity * mitigation);
  const damagePct = Math.max(10, Math.min(55, rawPct));
  const productionPenaltyPct = Math.min(60, damagePct);
  const defensePenalty = Math.max(1, Math.round((stats.defenseBonus + 3) * (damagePct / 100)));
  const stabilityHit = assetName === 'building-castle' || assetName === 'building-village' ? 4 : captured ? 2 : 1;

  const lootResources: Partial<Record<'wood' | 'stone' | 'food' | 'ore' | 'metal', number>> = {};
  if (captured) {
    if (stats.production.food > 0) lootResources.food = 8 + Math.round(stats.production.food);
    if (stats.production.wood > 0) lootResources.wood = 6 + Math.round(stats.production.wood);
    if (stats.production.ore > 0) lootResources.ore = 5 + Math.round(stats.production.ore);
    if (stats.production.metal > 0) lootResources.metal = 2;
  }

  const repairCost: ResourceCost = {
    gold: 25 + Math.round(damagePct * 1.4),
    wood: 4 + Math.round(damagePct * 0.25),
    stone: 3 + Math.round(damagePct * 0.2),
    food: 0,
    ore: 0,
    metal: damagePct >= 35 ? 1 : 0,
  };

  void turn;
  return {
    targetKey: key,
    damagePct,
    productionPenaltyPct,
    defensePenalty,
    stabilityHit,
    lootResources,
    repairCost,
    summaryPt: captured
      ? `Infraestrutura capturada com ${damagePct}% de danos de guerra (requer reconstrução).`
      : `Cerco deixou ${damagePct}% de danos na estrutura.`,
  };
}

export function repairDamagedTileRecord(
  damagedHexes: Record<string, DamagedHexRecord> | undefined,
  q: number,
  r: number
): Record<string, DamagedHexRecord> {
  if (!damagedHexes) return {};
  const key = hexKey(q, r);
  if (!damagedHexes[key]) return damagedHexes;
  const next = { ...damagedHexes };
  delete next[key];
  return next;
}

export function stepDamagedTilesRecovery(
  damagedHexes: Record<string, DamagedHexRecord> | undefined,
  isAtWarWithOwner: (key: string) => boolean
): Record<string, DamagedHexRecord> {
  if (!damagedHexes) return {};
  const next: Record<string, DamagedHexRecord> = {};
  for (const [k, rec] of Object.entries(damagedHexes)) {
    const recovery = isAtWarWithOwner(k) ? 4 : 10;
    const nextDamage = rec.damagePct - recovery;
    const nextTurns = Math.max(0, rec.turnsRemaining - 1);
    if (nextDamage <= 0 || nextTurns === 0) continue;
    next[k] = {
      ...rec,
      damagePct: nextDamage,
      productionPenaltyPct: Math.min(60, nextDamage),
      defensePenalty: Math.max(1, Math.round(rec.defensePenalty * (nextDamage / Math.max(1, rec.damagePct)))),
      turnsRemaining: nextTurns,
      repairCost: {
        ...rec.repairCost,
        gold: Math.max(15, Math.round(rec.repairCost.gold * (nextDamage / Math.max(1, rec.damagePct)))),
        wood: Math.max(2, Math.round(rec.repairCost.wood * (nextDamage / Math.max(1, rec.damagePct)))),
        stone: Math.max(2, Math.round(rec.repairCost.stone * (nextDamage / Math.max(1, rec.damagePct)))),
      },
    };
  }
  return next;
}

export interface CombatResolution {
  attackerWon: boolean;
  capturedHex: boolean;
  attackerDamage: number;
  defenderDamage: number;
  lootGold: number;
  summaryPt: string;
  attackerScore?: number;
  defenderScore?: number;
  attackerSupplyStatus?: UnitSupplyStatus;
  consequence?: ConflictDamageOutcome;
}

export function resolveHexCombat(
  attacker: UnitEntity,
  attackerTechs: TechId[],
  worldState: HexWorldState,
  targetQ: number,
  targetR: number,
  units: UnitEntity[],
  assets: HexAssetEntry[],
  defenderTechs: TechId[] = [],
  underConstructionKeys?: Set<string>,
  options?: {
    attackerSupplyStatus?: UnitSupplyStatus;
    damagedHexes?: Record<string, DamagedHexRecord>;
    turn?: number;
  }
): CombatResolution {
  const attDef = UNIT_CATALOG[attacker.type];
  const attTechBonus = attackerTechs.includes('metallurgy') ? 4 : 0;
  const supplyMult =
    options?.attackerSupplyStatus === 'unsupplied'
      ? 0.7
      : options?.attackerSupplyStatus === 'strained'
        ? 0.85
        : 1.0;

  const baseAttack = Math.round((attDef.attack + attTechBonus) * (attacker.hp / attacker.maxHp)) + 3;
  const attackScore = Math.max(1, Math.round(baseAttack * supplyMult));

  const fortReport = evaluateHexFortification({
    worldState,
    q: targetQ,
    r: targetR,
    units,
    assets,
    defenderTechs,
    underConstructionKeys,
    damagedHexes: options?.damagedHexes,
  });
  const defenseScore = fortReport.totalDefenseScore;

  const defender = getUnitAt(units, targetQ, targetR);
  const targetTile = worldState.hexes[hexKey(targetQ, targetR)];

  const intensity = Number(
    Math.min(1.5, Math.max(0.6, attackScore / Math.max(1, defenseScore))).toFixed(2)
  );

  if (attackScore >= defenseScore) {
    const margin = attackScore - defenseScore;
    const attackerDamage = Math.max(2, Math.min(attacker.hp - 1, 7 - Math.floor(margin / 2)));
    const defenderDamage = defender ? defender.hp : 0;
    const lootGold = 120;
    const consequence = targetTile
      ? createConflictDamageForTile({
          tile: targetTile,
          assets,
          captured: true,
          battleIntensity: intensity,
          turn: options?.turn ?? 1,
          defenderHasWallsOrEngineering:
            fortReport.isFortifiedStructure || defenderTechs.includes('engineering'),
        })
      : undefined;

    return {
      attackerWon: true,
      capturedHex: true,
      attackerDamage,
      defenderDamage,
      lootGold,
      attackerScore: attackScore,
      defenderScore: defenseScore,
      attackerSupplyStatus: options?.attackerSupplyStatus ?? 'supplied',
      consequence,
      summaryPt: `Vitória! Território capturado (+$${lootGold}).`,
    };
  }

  const deficit = defenseScore - attackScore;
  const attackerDamage = Math.min(attacker.hp, 6 + deficit);
  const defenderDamage = defender ? Math.max(3, Math.floor(attackScore / 2)) : 0;
  const consequence = targetTile
    ? createConflictDamageForTile({
        tile: targetTile,
        assets,
        captured: false,
        battleIntensity: intensity,
        turn: options?.turn ?? 1,
        defenderHasWallsOrEngineering:
          fortReport.isFortifiedStructure || defenderTechs.includes('engineering'),
      })
    : undefined;

  return {
    attackerWon: false,
    capturedHex: false,
    attackerDamage,
    defenderDamage,
    lootGold: 0,
    attackerScore: attackScore,
    defenderScore: defenseScore,
    attackerSupplyStatus: options?.attackerSupplyStatus ?? 'supplied',
    consequence,
    summaryPt: `Ataque repelido (Força ${attackScore} vs Defesa ${defenseScore}).`,
  };
}

