import type { HexAssetEntry } from './godot-docs';
import { getInstalledModules } from './building-modules-engine';
import type { CityEntity } from './city-engine';
import type { KingdomResources, TurnProductionBreakdown } from './economy-engine';
import type { FactionState } from './faction-engine';
import {
  hasHexConstruction,
  hexKey,
  type AxialCoord,
  type HexOwner,
  type HexWorldState,
} from './hex-engine';
import type { InterfactionTradeState } from './interfaction-trade-engine';
import {
  computeFactionMilitaryPower,
  evaluateFactionLogistics,
  type DamagedHexRecord,
  type UnitEntity,
} from './military-engine';
import type { RoadConnectivitySummary, RoadMap } from './road-engine';
import { TECH_TREE, type TechId } from './tech-engine';

export type VictoryPathId =
  | 'territorial'
  | 'economic'
  | 'technological'
  | 'urban'
  | 'diplomatic'
  | 'military';

export type DefeatReasonId = 'capital_lost' | 'conquered' | 'total_collapse';

export type MatchStatus = 'ongoing' | 'victory' | 'defeat';

export interface VictoryDiplomacySnapshot {
  factionId: HexOwner;
  stance: 'hostile' | 'wary' | 'neutral' | 'friendly' | 'allied';
  trustScore: number;
  atWar: boolean;
  hasTradePact: boolean;
  hasNonAggression: boolean;
  hasAlliance: boolean;
}

export interface VictoryMilestone {
  id: string;
  labelPt: string;
  current: number;
  target: number;
  completed: boolean;
  unitPt?: string;
}

export interface VictoryPathEvaluation {
  id: VictoryPathId;
  namePt: string;
  descriptionPt: string;
  progressPct: number;
  achieved: boolean;
  milestones: VictoryMilestone[];
  summaryPt: string;
}

export interface DefeatConditionEvaluation {
  reason: DefeatReasonId;
  labelPt: string;
  detailPt: string;
  warningTurnsRemaining: number | null;
}

export interface PersistedVictoryState {
  status: MatchStatus;
  achievedVictoryId: VictoryPathId | null;
  defeatReason: DefeatReasonId | null;
  resolvedTurn: number | null;
  headlinePt: string | null;
  trackedRivalCapitals: Record<string, AxialCoord>;
  capitalLostStreak: number;
  economicCollapseStreak: number;
  acknowledgedEndState: boolean;
}

export interface VictoryProgressSnapshot {
  status: MatchStatus;
  achievedVictoryId: VictoryPathId | null;
  defeatReason: DefeatReasonId | null;
  headlinePt: string | null;
  leadingPathId: VictoryPathId;
  paths: VictoryPathEvaluation[];
  activeWarningsPt: string[];
  defeatEvaluation: DefeatConditionEvaluation | null;
  persisted: PersistedVictoryState;
}

export const VICTORY_THRESHOLDS = {
  territorial: {
    minHexes: 28,
    minWorldSharePct: 55,
    minCities: 3,
  },
  economic: {
    minGoldReserve: 4000,
    minGoldNetPerTurn: 120,
    minTradeStructures: 2,
    minActiveRoutesOrVolume: { routes: 2, exportVolumeGold: 1200 },
  },
  technological: {
    totalTechs: TECH_TREE.length,
    minScienceNetPerTurn: 24,
    minAcademicHubs: 1,
  },
  urban: {
    minPopulation: 55,
    minCities: 3,
    minCityLevel: 4,
    minConnectedCities: 2,
    minBestUrbanQuality: 5,
  },
  diplomatic: {
    minSurvivingRivals: 1,
    minAvgTrust: 65,
    minAlliances: 1,
  },
  military: {
    minUnits: 4,
    minPowerRatioVsSurviving: 2.0,
    minArmyReadiness: 65,
  },
} as const;

export function createInitialVictoryState(
  factions: FactionState[] = []
): PersistedVictoryState {
  const trackedRivalCapitals: Record<string, AxialCoord> = {};
  for (const faction of factions) {
    trackedRivalCapitals[faction.id] = {
      q: faction.capitalCoord.q,
      r: faction.capitalCoord.r,
    };
  }
  return {
    status: 'ongoing',
    achievedVictoryId: null,
    defeatReason: null,
    resolvedTurn: null,
    headlinePt: null,
    trackedRivalCapitals,
    capitalLostStreak: 0,
    economicCollapseStreak: 0,
    acknowledgedEndState: false,
  };
}

export function normalizeVictoryState(
  raw: unknown,
  factions: FactionState[] = []
): PersistedVictoryState {
  const base = createInitialVictoryState(factions);
  if (!raw || typeof raw !== 'object') return base;
  const obj = raw as Record<string, unknown>;

  const status: MatchStatus =
    obj.status === 'victory' || obj.status === 'defeat' ? obj.status : 'ongoing';

  const validVictories: VictoryPathId[] = [
    'territorial',
    'economic',
    'technological',
    'urban',
    'diplomatic',
    'military',
  ];
  const achievedVictoryId =
    typeof obj.achievedVictoryId === 'string' &&
    validVictories.includes(obj.achievedVictoryId as VictoryPathId)
      ? (obj.achievedVictoryId as VictoryPathId)
      : null;

  const validDefeats: DefeatReasonId[] = ['capital_lost', 'conquered', 'total_collapse'];
  const defeatReason =
    typeof obj.defeatReason === 'string' &&
    validDefeats.includes(obj.defeatReason as DefeatReasonId)
      ? (obj.defeatReason as DefeatReasonId)
      : null;

  const trackedRivalCapitals: Record<string, AxialCoord> = {
    ...base.trackedRivalCapitals,
  };
  if (obj.trackedRivalCapitals && typeof obj.trackedRivalCapitals === 'object') {
    for (const [id, coord] of Object.entries(
      obj.trackedRivalCapitals as Record<string, unknown>
    )) {
      if (
        coord &&
        typeof coord === 'object' &&
        typeof (coord as AxialCoord).q === 'number' &&
        typeof (coord as AxialCoord).r === 'number'
      ) {
        trackedRivalCapitals[id] = {
          q: (coord as AxialCoord).q,
          r: (coord as AxialCoord).r,
        };
      }
    }
  }

  return {
    status,
    achievedVictoryId,
    defeatReason,
    resolvedTurn:
      typeof obj.resolvedTurn === 'number' && Number.isFinite(obj.resolvedTurn)
        ? Math.max(0, Math.round(obj.resolvedTurn))
        : null,
    headlinePt: typeof obj.headlinePt === 'string' ? obj.headlinePt : null,
    trackedRivalCapitals,
    capitalLostStreak:
      typeof obj.capitalLostStreak === 'number' && Number.isFinite(obj.capitalLostStreak)
        ? Math.max(0, Math.round(obj.capitalLostStreak))
        : 0,
    economicCollapseStreak:
      typeof obj.economicCollapseStreak === 'number' &&
      Number.isFinite(obj.economicCollapseStreak)
        ? Math.max(0, Math.round(obj.economicCollapseStreak))
        : 0,
    acknowledgedEndState: Boolean(obj.acknowledgedEndState),
  };
}

function milestoneProgress(current: number, target: number): number {
  if (target <= 0) return current > 0 ? 100 : 0;
  return Math.max(0, Math.min(100, Math.round((current / target) * 100)));
}

function computePathProgress(milestones: VictoryMilestone[]): {
  progressPct: number;
  achieved: boolean;
} {
  if (milestones.length === 0) return { progressPct: 0, achieved: false };
  const sum = milestones.reduce(
    (acc, m) => acc + milestoneProgress(m.current, m.target),
    0
  );
  const achieved = milestones.every((m) => m.completed);
  const rawPct = Math.round(sum / milestones.length);
  return {
    progressPct: achieved ? 100 : Math.min(99, rawPct),
    achieved,
  };
}

export function evaluateVictoryAndDefeat(params: {
  turn: number;
  worldState: HexWorldState;
  assets: HexAssetEntry[];
  playerCapital?: AxialCoord;
  gold: number;
  resources: KingdomResources;
  population: number;
  foodDeficitTurns: number;
  unlockedTechs: TechId[];
  units: UnitEntity[];
  factions: FactionState[];
  cities: CityEntity[];
  economy?: TurnProductionBreakdown;
  roadConnectivity?: RoadConnectivitySummary;
  roads?: RoadMap;
  diplomacySnapshots?: VictoryDiplomacySnapshot[];
  tradeState?: InterfactionTradeState;
  underConstructionKeys?: Set<string>;
  damagedHexes?: Record<string, DamagedHexRecord>;
  persistedState?: PersistedVictoryState;
  advanceStreaks?: boolean;
}): VictoryProgressSnapshot {
  const {
    turn,
    worldState,
    assets,
    playerCapital = { q: 0, r: 0 },
    gold,
    resources,
    population,
    foodDeficitTurns,
    unlockedTechs,
    units,
    factions,
    cities,
    economy,
    roadConnectivity,
    roads,
    diplomacySnapshots,
    tradeState,
    underConstructionKeys,
    damagedHexes,
    advanceStreaks = false,
  } = params;

  const basePersisted = normalizeVictoryState(params.persistedState, factions);

  // Merge current faction capitals into tracking map
  const trackedRivalCapitals: Record<string, AxialCoord> = {
    ...basePersisted.trackedRivalCapitals,
  };
  for (const faction of factions) {
    if (!trackedRivalCapitals[faction.id]) {
      trackedRivalCapitals[faction.id] = {
        q: faction.capitalCoord.q,
        r: faction.capitalCoord.r,
      };
    }
  }

  let playerTerritoryCount = 0;
  let claimedNonNeutralCount = 0;
  const territoryByOwner: Record<string, number> = {};
  let tradeStructures = 0;
  let academicHubs = 0;

  for (const tile of Object.values(worldState.hexes)) {
    const tileOwner = tile.owner ?? 'neutral';
    if (tileOwner !== 'neutral') {
      claimedNonNeutralCount += 1;
      territoryByOwner[tileOwner] = (territoryByOwner[tileOwner] ?? 0) + 1;
    }
    if (tileOwner !== 'player') continue;
    playerTerritoryCount += 1;

    if (!hasHexConstruction(tile, assets)) continue;
    const key = hexKey(tile.q, tile.r);
    if (underConstructionKeys?.has(key)) continue;

    const assetName = assets[tile.structureIndex]?.name ?? '';
    const modules = getInstalledModules(tile);
    if (
      assetName === 'building-market' ||
      assetName === 'building-port' ||
      assetName === 'building-dock'
    ) {
      tradeStructures += 1;
    }
    if (
      assetName === 'building-wizard-tower' ||
      (assetName === 'building-castle' && modules.includes('castle_royal_archive')) ||
      modules.some((m) => m.startsWith('acad_'))
    ) {
      academicHubs += 1;
    }
  }

  const playerCities = cities.filter((c) => c.owner === 'player');
  const bestCityLevel = playerCities.reduce((max, c) => Math.max(max, c.level), 0);
  const bestUrbanQuality = playerCities.reduce(
    (max, c) => Math.max(max, c.urbanQualityScore),
    0
  );
  const effectiveConnectivity = roadConnectivity ?? economy?.roadConnectivity;
  const connectedCityIds = new Set<string>();
  for (const net of effectiveConnectivity?.networks ?? []) {
    if (net.connectedCityIds.length >= 2) {
      for (const cid of net.connectedCityIds) connectedCityIds.add(cid);
    }
  }
  const connectedCitiesCount = connectedCityIds.size;

  const goldNet = economy?.goldNet ?? 0;
  const scienceNet = economy?.scienceNet ?? 1;

  // 1. Territorial Victory
  const territorySharePct =
    claimedNonNeutralCount > 0
      ? Math.round((playerTerritoryCount / claimedNonNeutralCount) * 100)
      : 0;
  const terrMilestones: VictoryMilestone[] = [
    {
      id: 'terr_hexes',
      labelPt: 'Territórios sob domínio',
      current: playerTerritoryCount,
      target: VICTORY_THRESHOLDS.territorial.minHexes,
      completed: playerTerritoryCount >= VICTORY_THRESHOLDS.territorial.minHexes,
      unitPt: 'hexes',
    },
    {
      id: 'terr_share',
      labelPt: 'Participação entre terras reivindicadas',
      current: territorySharePct,
      target: VICTORY_THRESHOLDS.territorial.minWorldSharePct,
      completed:
        playerTerritoryCount >= 18 &&
        territorySharePct >= VICTORY_THRESHOLDS.territorial.minWorldSharePct,
      unitPt: '%',
    },
    {
      id: 'terr_cities',
      labelPt: 'Cidades administradas',
      current: playerCities.length,
      target: VICTORY_THRESHOLDS.territorial.minCities,
      completed: playerCities.length >= VICTORY_THRESHOLDS.territorial.minCities,
      unitPt: 'cidades',
    },
  ];
  const terrProg = computePathProgress(terrMilestones);

  // 2. Economic Victory
  const activeRouteCount =
    tradeState?.routes.filter((r) => r.status === 'active').length ?? 0;
  const exportVolumeGold = tradeState?.totalExportGoldAllTime ?? 0;
  const tradeReachScore =
    activeRouteCount >= VICTORY_THRESHOLDS.economic.minActiveRoutesOrVolume.routes ||
    exportVolumeGold >=
      VICTORY_THRESHOLDS.economic.minActiveRoutesOrVolume.exportVolumeGold
      ? 100
      : Math.max(
          milestoneProgress(
            activeRouteCount,
            VICTORY_THRESHOLDS.economic.minActiveRoutesOrVolume.routes
          ),
          milestoneProgress(
            exportVolumeGold,
            VICTORY_THRESHOLDS.economic.minActiveRoutesOrVolume.exportVolumeGold
          )
        );
  const econMilestones: VictoryMilestone[] = [
    {
      id: 'econ_gold',
      labelPt: 'Reserva no Tesouro Real',
      current: Math.round(gold),
      target: VICTORY_THRESHOLDS.economic.minGoldReserve,
      completed: gold >= VICTORY_THRESHOLDS.economic.minGoldReserve,
      unitPt: 'ouro',
    },
    {
      id: 'econ_net',
      labelPt: 'Superávit líquido por turno',
      current: Math.round(goldNet),
      target: VICTORY_THRESHOLDS.economic.minGoldNetPerTurn,
      completed: goldNet >= VICTORY_THRESHOLDS.economic.minGoldNetPerTurn,
      unitPt: 'ouro/turno',
    },
    {
      id: 'econ_infra',
      labelPt: 'Mercados e Portos operacionais',
      current: tradeStructures,
      target: VICTORY_THRESHOLDS.economic.minTradeStructures,
      completed:
        tradeStructures >= VICTORY_THRESHOLDS.economic.minTradeStructures &&
        unlockedTechs.includes('trade'),
      unitPt: 'estruturas',
    },
    {
      id: 'econ_routes',
      labelPt: 'Comércio internacional consolidado',
      current: tradeReachScore,
      target: 100,
      completed: tradeReachScore >= 100,
      unitPt: '%',
    },
  ];
  const econProg = computePathProgress(econMilestones);

  // 3. Technological Victory
  const techMilestones: VictoryMilestone[] = [
    {
      id: 'tech_tree',
      labelPt: 'Tecnologias desbloqueadas',
      current: unlockedTechs.length,
      target: VICTORY_THRESHOLDS.technological.totalTechs,
      completed: unlockedTechs.length >= VICTORY_THRESHOLDS.technological.totalTechs,
      unitPt: 'techs',
    },
    {
      id: 'tech_science',
      labelPt: 'Produção científica por turno',
      current: Math.round(scienceNet),
      target: VICTORY_THRESHOLDS.technological.minScienceNetPerTurn,
      completed: scienceNet >= VICTORY_THRESHOLDS.technological.minScienceNetPerTurn,
      unitPt: 'ciência/turno',
    },
    {
      id: 'tech_hub',
      labelPt: 'Centros acadêmicos / Arquivos Reais',
      current: academicHubs,
      target: VICTORY_THRESHOLDS.technological.minAcademicHubs,
      completed: academicHubs >= VICTORY_THRESHOLDS.technological.minAcademicHubs,
      unitPt: 'centros',
    },
  ];
  const techProg = computePathProgress(techMilestones);

  // 4. Urban Victory
  const urbanMilestones: VictoryMilestone[] = [
    {
      id: 'urb_pop',
      labelPt: 'População total do reino',
      current: population,
      target: VICTORY_THRESHOLDS.urban.minPopulation,
      completed: population >= VICTORY_THRESHOLDS.urban.minPopulation,
      unitPt: 'hab.',
    },
    {
      id: 'urb_cities',
      labelPt: 'Cidades fundadas',
      current: playerCities.length,
      target: VICTORY_THRESHOLDS.urban.minCities,
      completed: playerCities.length >= VICTORY_THRESHOLDS.urban.minCities,
      unitPt: 'cidades',
    },
    {
      id: 'urb_tier',
      labelPt: 'Metrópole Nível 4+ com qualidade urbana',
      current: bestCityLevel,
      target: VICTORY_THRESHOLDS.urban.minCityLevel,
      completed:
        bestCityLevel >= VICTORY_THRESHOLDS.urban.minCityLevel &&
        bestUrbanQuality >= VICTORY_THRESHOLDS.urban.minBestUrbanQuality,
      unitPt: 'nível',
    },
    {
      id: 'urb_links',
      labelPt: 'Cidades integradas por estradas',
      current: connectedCitiesCount,
      target: VICTORY_THRESHOLDS.urban.minConnectedCities,
      completed: connectedCitiesCount >= VICTORY_THRESHOLDS.urban.minConnectedCities,
      unitPt: 'cidades',
    },
  ];
  const urbanProg = computePathProgress(urbanMilestones);

  // 5. Diplomatic Victory
  const survivingRivals = factions.filter(
    (f) => (territoryByOwner[f.id] ?? 0) > 0
  );
  const dipById = new Map<string, VictoryDiplomacySnapshot>();
  for (const d of diplomacySnapshots ?? []) {
    dipById.set(d.factionId, d);
  }
  const survivingDip = survivingRivals.map((f) => {
    const snap = dipById.get(f.id);
    if (snap) return snap;
    const isPact = f.relation === 'trade_pact';
    return {
      factionId: f.id,
      stance:
        f.relation === 'hostile'
          ? ('hostile' as const)
          : f.relation === 'trade_pact'
            ? ('friendly' as const)
            : ('neutral' as const),
      trustScore: isPact ? 45 : f.relation === 'hostile' ? -45 : 10,
      atWar: f.relation === 'hostile',
      hasTradePact: isPact,
      hasNonAggression: isPact || f.relation === 'truce',
      hasAlliance: false,
    };
  });

  const activeWars = survivingDip.filter((d) => d.atWar || d.stance === 'hostile').length;
  const friendlyOrAlliedCount = survivingDip.filter(
    (d) => d.stance === 'friendly' || d.stance === 'allied'
  ).length;
  const allianceCount = survivingDip.filter((d) => d.hasAlliance || d.stance === 'allied').length;
  const avgTrust =
    survivingDip.length > 0
      ? Math.round(
          survivingDip.reduce((s, d) => s + d.trustScore, 0) / survivingDip.length
        )
      : 0;

  const dipMilestones: VictoryMilestone[] = [
    {
      id: 'dip_surviving',
      labelPt: 'Todas as facções ativas amigáveis ou aliadas',
      current: survivingRivals.length === 0 ? 0 : friendlyOrAlliedCount,
      target: Math.max(1, survivingRivals.length),
      completed:
        survivingRivals.length >= VICTORY_THRESHOLDS.diplomatic.minSurvivingRivals &&
        activeWars === 0 &&
        friendlyOrAlliedCount >= survivingRivals.length,
      unitPt: 'facções',
    },
    {
      id: 'dip_alliance',
      labelPt: 'Alianças formais assinadas',
      current: allianceCount,
      target: VICTORY_THRESHOLDS.diplomatic.minAlliances,
      completed:
        survivingRivals.length >= 1 &&
        allianceCount >= VICTORY_THRESHOLDS.diplomatic.minAlliances &&
        survivingDip.every((d) => d.hasTradePact || d.hasAlliance || d.hasNonAggression),
      unitPt: 'alianças',
    },
    {
      id: 'dip_trust',
      labelPt: 'Confiança diplomática média',
      current: Math.max(0, avgTrust),
      target: VICTORY_THRESHOLDS.diplomatic.minAvgTrust,
      completed:
        survivingRivals.length >= 1 &&
        avgTrust >= VICTORY_THRESHOLDS.diplomatic.minAvgTrust,
      unitPt: 'confiança',
    },
  ];
  const dipProg = computePathProgress(dipMilestones);

  // 6. Military Domination Victory
  const trackedEntries = Object.entries(trackedRivalCapitals);
  let capturedRivalCapitals = 0;
  for (const [fId, capCoord] of trackedEntries) {
    const capTile = worldState.hexes[hexKey(capCoord.q, capCoord.r)];
    const factionTerritories = territoryByOwner[fId] ?? 0;
    if ((capTile && capTile.owner === 'player') || factionTerritories === 0) {
      capturedRivalCapitals += 1;
    }
  }
  const targetCapitals = Math.max(1, trackedEntries.length);

  const playerPower = computeFactionMilitaryPower(
    worldState,
    units,
    assets,
    'player',
    unlockedTechs,
    underConstructionKeys,
    damagedHexes
  );
  const playerLogistics = evaluateFactionLogistics({
    worldState,
    units,
    assets,
    owner: 'player',
    unlockedTechs,
    roads,
    connectivity: effectiveConnectivity,
    underConstructionKeys,
    capitalCoord: playerCapital,
    foodDeficitTurns,
  });

  let survivingRivalAttack = 0;
  for (const faction of survivingRivals) {
    const p = computeFactionMilitaryPower(
      worldState,
      units,
      assets,
      faction.id,
      faction.unlockedTechs,
      underConstructionKeys,
      damagedHexes
    );
    survivingRivalAttack += p.attackPower;
  }
  const powerRatio =
    survivingRivalAttack <= 0
      ? playerPower.attackPower > 0
        ? VICTORY_THRESHOLDS.military.minPowerRatioVsSurviving
        : 0
      : Number((playerPower.attackPower / survivingRivalAttack).toFixed(2));

  const milMilestones: VictoryMilestone[] = [
    {
      id: 'mil_capitals',
      labelPt: 'Capitais rivais conquistadas ou neutralizadas',
      current: trackedEntries.length === 0 ? 0 : capturedRivalCapitals,
      target: targetCapitals,
      completed:
        trackedEntries.length > 0 && capturedRivalCapitals >= targetCapitals,
      unitPt: 'capitais',
    },
    {
      id: 'mil_units',
      labelPt: 'Tropas ativas mobilizadas',
      current: playerPower.unitCount,
      target: VICTORY_THRESHOLDS.military.minUnits,
      completed:
        playerPower.unitCount >= VICTORY_THRESHOLDS.military.minUnits &&
        playerLogistics.readinessScore >= VICTORY_THRESHOLDS.military.minArmyReadiness,
      unitPt: 'unidades',
    },
    {
      id: 'mil_ratio',
      labelPt: 'Razão de poder militar ofensivo (x10)',
      current: Math.round(powerRatio * 10),
      target: Math.round(VICTORY_THRESHOLDS.military.minPowerRatioVsSurviving * 10),
      completed: powerRatio >= VICTORY_THRESHOLDS.military.minPowerRatioVsSurviving,
      unitPt: 'x0.1',
    },
  ];
  const milProg = computePathProgress(milMilestones);

  const paths: VictoryPathEvaluation[] = [
    {
      id: 'territorial',
      namePt: 'Hegemonia Territorial',
      descriptionPt:
        'Expanda fronteiras, consolide cidades e domine a maior parte das terras colonizadas.',
      progressPct: terrProg.progressPct,
      achieved: terrProg.achieved,
      milestones: terrMilestones,
      summaryPt: `${playerTerritoryCount}/${VICTORY_THRESHOLDS.territorial.minHexes} hexes · ${territorySharePct}% domínio · ${playerCities.length} cidades.`,
    },
    {
      id: 'economic',
      namePt: 'Império Comercial',
      descriptionPt:
        'Acumule reservas, mantenha forte superávit e lidere as rotas comerciais internacionais.',
      progressPct: econProg.progressPct,
      achieved: econProg.achieved,
      milestones: econMilestones,
      summaryPt: `$${Math.round(gold)} tesouro · +$${Math.round(goldNet)}/turno · ${activeRouteCount} rotas ativas.`,
    },
    {
      id: 'technological',
      namePt: 'Supremacia Científica',
      descriptionPt:
        'Pesquise toda a árvore tecnológica e sustente um polo acadêmico avançado.',
      progressPct: techProg.progressPct,
      achieved: techProg.achieved,
      milestones: techMilestones,
      summaryPt: `${unlockedTechs.length}/${TECH_TREE.length} tecnologias · +${Math.round(scienceNet)} ciência/turno.`,
    },
    {
      id: 'urban',
      namePt: 'Metrópole Dourada',
      descriptionPt:
        'Construa grandes cidades prósperas conectadas por infraestrutura viária e qualidade urbana.',
      progressPct: urbanProg.progressPct,
      achieved: urbanProg.achieved,
      milestones: urbanMilestones,
      summaryPt: `${population} hab. · ${playerCities.length} cidades (Nív. máx. ${bestCityLevel}) · ${connectedCitiesCount} conectadas.`,
    },
    {
      id: 'diplomatic',
      namePt: 'Pacto das Nações',
      descriptionPt:
        'Estabeleça paz duradoura, acordos comerciais e aliança formal com os reinos sobreviventes.',
      progressPct: dipProg.progressPct,
      achieved: dipProg.achieved,
      milestones: dipMilestones,
      summaryPt: `${friendlyOrAlliedCount}/${survivingRivals.length} amigáveis · ${allianceCount} alianças · confiança média ${avgTrust}.`,
    },
    {
      id: 'military',
      namePt: 'Domínio Militar',
      descriptionPt:
        'Conquiste as capitais rivais mantendo um exército bem abastecido e superior.',
      progressPct: milProg.progressPct,
      achieved: milProg.achieved,
      milestones: milMilestones,
      summaryPt: `${capturedRivalCapitals}/${targetCapitals} capitais · ${playerPower.unitCount} tropas · prontidão ${playerLogistics.readinessScore}%.`,
    },
  ];

  // Leading path (highest progress)
  const leadingPath = paths.reduce((best, curr) =>
    curr.progressPct > best.progressPct ? curr : best
  );

  // Defeat condition evaluation (with fair warning windows!)
  const capitalKey = hexKey(playerCapital.q, playerCapital.r);
  const capitalTile = worldState.hexes[capitalKey];
  const capitalUnderPlayerControl = Boolean(capitalTile && capitalTile.owner === 'player');
  const capitalLostNow = !capitalUnderPlayerControl;

  const isCollapsedNow =
    gold <= 0 &&
    goldNet < 0 &&
    resources.food <= 0 &&
    foodDeficitTurns >= 4;

  const nextCapitalLostStreak = capitalLostNow
    ? advanceStreaks
      ? basePersisted.capitalLostStreak + 1
      : Math.max(basePersisted.capitalLostStreak, 1)
    : 0;
  const nextCollapseStreak = isCollapsedNow
    ? advanceStreaks
      ? basePersisted.economicCollapseStreak + 1
      : Math.max(basePersisted.economicCollapseStreak, 1)
    : 0;

  const activeWarningsPt: string[] = [];
  if (capitalLostNow && playerTerritoryCount > 0) {
    activeWarningsPt.push(
      `Capital perdida! Retome a capital rapidamente (${Math.max(
        0,
        2 - nextCapitalLostStreak
      )} turno(s) de margem antes da queda definitiva).`
    );
  }
  if (isCollapsedNow) {
    activeWarningsPt.push(
      `Risco de colapso econômico e alimentar (${Math.max(
        0,
        3 - nextCollapseStreak
      )} turno(s) para recuperação antes da ruína).`
    );
  }

  let defeatEvaluation: DefeatConditionEvaluation | null = null;
  if (playerTerritoryCount === 0) {
    defeatEvaluation = {
      reason: 'conquered',
      labelPt: 'Anexação Total',
      detailPt: 'O reino perdeu todos os seus territórios e não possui mais base soberana.',
      warningTurnsRemaining: 0,
    };
  } else if (capitalLostNow && (nextCapitalLostStreak >= 2 || playerCities.length === 0)) {
    defeatEvaluation = {
      reason: 'capital_lost',
      labelPt: 'Queda da Capital',
      detailPt:
        'A capital foi tomada e não houve retomada ou centro urbano alternativo capaz de sustentar a coroa.',
      warningTurnsRemaining: 0,
    };
  } else if (isCollapsedNow && nextCollapseStreak >= 3) {
    defeatEvaluation = {
      reason: 'total_collapse',
      labelPt: 'Colapso Estrutural',
      detailPt:
        'Insolvência prolongada e escassez severa de alimentos paralisaram o governo e a população do reino.',
      warningTurnsRemaining: 0,
    };
  }

  // If already resolved previously, keep outcome unless state explicitly reset
  let nextStatus: MatchStatus = basePersisted.status;
  let achievedVictoryId = basePersisted.achievedVictoryId;
  let defeatReason = basePersisted.defeatReason;
  let resolvedTurn = basePersisted.resolvedTurn;
  let headlinePt = basePersisted.headlinePt;

  if (nextStatus === 'ongoing') {
    const achievedPath = paths.find((p) => p.achieved) ?? null;
    if (achievedPath) {
      nextStatus = 'victory';
      achievedVictoryId = achievedPath.id;
      resolvedTurn = turn;
      headlinePt = `Vitória alcançada: ${achievedPath.namePt}!`;
    } else if (defeatEvaluation) {
      nextStatus = 'defeat';
      defeatReason = defeatEvaluation.reason;
      resolvedTurn = turn;
      headlinePt = `Derrota: ${defeatEvaluation.labelPt} — ${defeatEvaluation.detailPt}`;
    }
  } else if (nextStatus === 'defeat' && !defeatEvaluation && defeatReason) {
    defeatEvaluation = {
      reason: defeatReason,
      labelPt:
        defeatReason === 'conquered'
          ? 'Anexação Total'
          : defeatReason === 'capital_lost'
            ? 'Queda da Capital'
            : 'Colapso Estrutural',
      detailPt: headlinePt ?? 'Condição de derrota atingida.',
      warningTurnsRemaining: 0,
    };
  }

  const persisted: PersistedVictoryState = {
    status: nextStatus,
    achievedVictoryId,
    defeatReason,
    resolvedTurn,
    headlinePt,
    trackedRivalCapitals,
    capitalLostStreak: nextCapitalLostStreak,
    economicCollapseStreak: nextCollapseStreak,
    acknowledgedEndState: basePersisted.acknowledgedEndState,
  };

  return {
    status: nextStatus,
    achievedVictoryId,
    defeatReason,
    headlinePt,
    leadingPathId: leadingPath.id,
    paths,
    activeWarningsPt,
    defeatEvaluation,
    persisted,
  };
}
