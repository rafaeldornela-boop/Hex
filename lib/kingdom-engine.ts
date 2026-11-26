import type { HexAssetEntry } from './godot-docs';
import { getBuildingDefinition } from './buildings-catalog';
import {
  canAffordCost,
  computeTurnEconomyBreakdown,
  createInitialResources,
  getKingdomStage,
  type KingdomResources,
  type KingdomStageInfo,
  type TurnProductionBreakdown,
} from './economy-engine';
import {
  applyResolutionToNarrative,
  createInitialNarrativeState,
  deserializeNarrativeState,
  resolveEventChoice,
  type ActiveKingdomEvent,
  type ActiveWorldEffect,
  type EventHistoryEntry,
  type NarrativeState,
} from './events-engine';
import {
  createInitialFactions,
  getTradePactBonusGold,
  normalizeFactionState,
  type FactionRelation,
  type FactionState,
} from './faction-engine';
import { processKingdomTurn, type TurnAdvanceResult } from './turn-engine';
import {
  createEmptyWorldState,
  demolishHexInState,
  deserializeWorldState,
  hexKey,
  placeHexInState,
  type AxialCoord,
  type HexOwner,
  type HexWorldState,
} from './hex-engine';
import { validateBuildCandidateOnHex } from './build-rules';
import {
  DEFAULT_WORLD_SEED,
  generateProceduralKingdomWorld,
} from './world-generator';
import {
  UNIT_CATALOG,
  applySupplyConsequencesToUnits,
  computeFactionMilitaryPower,
  computeMilitaryIntelligence,
  createConflictDamageForTile,
  evaluateFactionLogistics,
  evaluateHexFortification,
  evaluateUnitSupply,
  getReachableUnitCoords,
  getUnitAt,
  isAdjacentCoord,
  repairDamagedTileRecord,
  resolveHexCombat,
  stepDamagedTilesRecovery,
  type ArmyLogisticsSummary,
  type DamagedHexRecord,
  type FactionMilitaryIntelligence,
  type FortificationReport,
  type UnitEntity,
  type UnitType,
} from './military-engine';
import {
  advanceInterfactionTradeTurn,
  closeInternationalRoute,
  createInitialInterfactionTradeState,
  disruptRoutesNearCoord,
  embargoFactionRoutes,
  executeInternationalSpotTrade,
  getInterfactionTradeSummary,
  normalizeInterfactionTradeState,
  openInternationalRoute,
  type DiplomacyTradeContext,
  type InterfactionMarketSnapshot,
  type InterfactionTradeState,
  type RouteTransportMode,
} from './interfaction-trade-engine';
import {
  createInitialVictoryState,
  evaluateVictoryAndDefeat,
  normalizeVictoryState,
  type PersistedVictoryState,
  type VictoryDiplomacySnapshot,
  type VictoryProgressSnapshot,
} from './victory-engine';
import {
  advanceResearchProgress,
  createInitialResearchState,
  selectActiveTech,
  TECH_BY_ID,
  type ResearchState,
  type TechDefinition,
  type TechId,
} from './tech-engine';
import {
  INCOMPATIBLE_TERRAIN_MESSAGE,
  getHexTerrainAndResource,
} from './terrain-engine';
import {
  ALREADY_OCCUPIED_BUILD_MESSAGE,
  NOT_OWNED_BUILD_MESSAGE,
  axialDistance,
  computeTerritorialCapacity,
  countPlayerTerritory,
  evaluateExpansion,
  startExpansion,
  type ActiveExpansion,
  type ExpansionCheckResult,
  type TerritorialCapacitySummary,
} from './territory-engine';
import {
  computeMarketSummary,
  type MarketSummary,
  type TradableResource,
} from './trade-engine';
import {
  canBuildOrUpgradeRoad,
  computeRoadConnectivity,
  normalizeRoadMap,
  type RoadConnectivitySummary,
  type RoadLevel,
  type RoadMap,
} from './road-engine';
import {
  ensureStarterCapitalCity,
  normalizeCities,
  syncAndEvolveCities,
  type CityEntity,
} from './city-engine';
import {
  computeCalendarSnapshot,
  normalizeCalendarSnapshot,
  type CalendarSnapshot,
} from './calendar-engine';
import {
  getDayPhaseForTurn,
  isValidDayPhase,
  type DayPhaseId,
} from './day-night-engine';
import {
  createInitialClimateWeather,
  normalizeClimateWeather,
  type ActiveClimateWeather,
} from './season-engine';
import {
  evaluateBuildingUpgrade,
  toRomanLevel,
  type BuildingUpgradeEvaluation,
} from './building-upgrade-engine';
import {
  BUILDING_MODULES,
  evaluateBuildingModules,
  getInstalledModules,
  isValidBuildingModuleId,
  type BuildingModuleId,
  type BuildingModulesEvaluation,
} from './building-modules-engine';

export interface ActiveConstruction {
  q: number;
  r: number;
  structureIndex: number;
  orientation: number;
  assetName: string;
  turnsRemaining: number;
  totalTurns: number;
  owner: HexOwner;
  kind?: 'build' | 'upgrade' | 'module';
  targetLevel?: number;
  moduleId?: BuildingModuleId;
}

export type DiplomaticStance =
  | 'hostile'
  | 'wary'
  | 'neutral'
  | 'friendly'
  | 'allied';

export interface TreatyState {
  peaceTreatyTurns: number;
  nonAggressionTurns: number;
  tradePact: boolean;
  alliance: boolean;
  truceTurnsRemaining: number;
  warReparationsPerTurn: number;
  reparationsDirection: 'player_receives' | 'player_pays' | null;
  reparationsTurnsRemaining: number;
  embargoActive: boolean;
}

export interface DiplomacyHistoryEvent {
  turn: number;
  labelPt: string;
  deltaTrust: number;
}

export interface FactionDiplomacyState {
  factionId: HexOwner;
  stance: DiplomaticStance;
  trustScore: number; // -100 .. +100
  atWar: boolean;
  conflictCount: number;
  turnsSinceLastConflict: number;
  borderFrictionScore: number;
  tradeGoodwillScore: number;
  militaryBalanceDelta: number;
  betrayalPenalty: number;
  treaties: TreatyState;
  history: DiplomacyHistoryEvent[];
  lastStanceReasonPt: string;
}

export type DiplomacyActionType =
  | 'truce'
  | 'trade_pact'
  | 'war'
  | 'peace_treaty'
  | 'non_aggression'
  | 'alliance'
  | 'resource_aid'
  | 'territorial_concession';

export interface DiplomacyActionPayload {
  resource?: 'wood' | 'stone' | 'food' | 'ore' | 'metal';
  amount?: number;
  coord?: AxialCoord;
}

export interface DiplomacyEvaluation {
  factionId: HexOwner;
  factionNamePt: string;
  stance: DiplomaticStance;
  stanceLabelPt: string;
  trustScore: number;
  atWar: boolean;
  borderFrictionScore: number;
  tradeGoodwillScore: number;
  betrayalPenalty: number;
  treaties: TreatyState;
  lastStanceReasonPt: string;
  recentHistory: DiplomacyHistoryEvent[];
}

export interface KingdomState {
  turn: number;
  calendar: CalendarSnapshot;
  dayPhase: DayPhaseId;
  climateWeather: ActiveClimateWeather;
  worldSeed?: number;
  playerCapital?: AxialCoord;
  worldState: HexWorldState;
  resources: KingdomResources;
  population: number;
  foodDeficitTurns: number;
  research: ResearchState;
  units: UnitEntity[];
  factions: FactionState[];
  constructions: ActiveConstruction[];
  expansions: ActiveExpansion[];
  roads: RoadMap;
  cities: CityEntity[];
  activeEffects: ActiveWorldEffect[];
  activeEvent: ActiveKingdomEvent | null;
  eventHistory: EventHistoryEntry[];
  narrativeState?: NarrativeState;
  lastTurnSummaryPt: string | null;
  diplomacyByFactionId?: Record<string, FactionDiplomacyState>;
  interfactionTrade?: InterfactionTradeState;
  damagedHexes?: Record<string, DamagedHexRecord>;
  victoryState?: PersistedVictoryState;
}

export function getUnderConstructionKeys(state: KingdomState): Set<string> {
  return new Set(
    state.constructions
      .filter((c) => c.kind !== 'upgrade' && c.kind !== 'module')
      .map((c) => hexKey(c.q, c.r))
  );
}

export function getAllActiveConstructionOverlayKeys(state: KingdomState): Set<string> {
  return new Set(state.constructions.map((c) => hexKey(c.q, c.r)));
}

export function getUpgradingConstructionsByKey(
  state: KingdomState
): Record<string, { targetLevel: number; turnsRemaining: number; totalTurns: number }> {
  const map: Record<
    string,
    { targetLevel: number; turnsRemaining: number; totalTurns: number }
  > = {};
  for (const c of state.constructions) {
    if (c.kind === 'upgrade' && typeof c.targetLevel === 'number') {
      map[hexKey(c.q, c.r)] = {
        targetLevel: c.targetLevel,
        turnsRemaining: c.turnsRemaining,
        totalTurns: c.totalTurns,
      };
    }
  }
  return map;
}

export function getModuleConstructionsByKey(
  state: KingdomState
): Record<string, { moduleId: BuildingModuleId; turnsRemaining: number; totalTurns: number }> {
  const map: Record<
    string,
    { moduleId: BuildingModuleId; turnsRemaining: number; totalTurns: number }
  > = {};
  for (const c of state.constructions) {
    if (c.kind === 'module' && c.moduleId && isValidBuildingModuleId(c.moduleId)) {
      map[hexKey(c.q, c.r)] = {
        moduleId: c.moduleId,
        turnsRemaining: c.turnsRemaining,
        totalTurns: c.totalTurns,
      };
    }
  }
  return map;
}

export function getConstructionAt(
  state: KingdomState,
  q: number,
  r: number
): ActiveConstruction | null {
  return state.constructions.find((c) => c.q === q && c.r === r) ?? null;
}

export function getExpansionAt(
  state: KingdomState,
  q: number,
  r: number
): ActiveExpansion | null {
  return (state.expansions ?? []).find((e) => e.q === q && e.r === r) ?? null;
}

function createDefaultTreaties(relation: FactionRelation = 'neutral', truceTurnsRemaining = 0): TreatyState {
  return {
    peaceTreatyTurns: 0,
    nonAggressionTurns: 0,
    tradePact: relation === 'trade_pact',
    alliance: false,
    truceTurnsRemaining: relation === 'truce' ? Math.max(0, truceTurnsRemaining) : 0,
    warReparationsPerTurn: 0,
    reparationsDirection: null,
    reparationsTurnsRemaining: 0,
    embargoActive: relation === 'hostile',
  };
}

export function stanceFromLegacyRelation(relation: FactionRelation): DiplomaticStance {
  if (relation === 'hostile') return 'hostile';
  if (relation === 'trade_pact') return 'friendly';
  if (relation === 'truce') return 'wary';
  return 'neutral';
}

export function legacyRelationFromDiplomacy(dip: FactionDiplomacyState): FactionRelation {
  if (dip.atWar || dip.stance === 'hostile') return 'hostile';
  if (dip.treaties.tradePact) return 'trade_pact';
  if (dip.treaties.truceTurnsRemaining > 0 || dip.treaties.peaceTreatyTurns > 0) return 'truce';
  return 'neutral';
}

export function getDiplomaticStanceLabelPt(stance: DiplomaticStance): string {
  switch (stance) {
    case 'hostile':
      return 'Hostil';
    case 'wary':
      return 'Desconfiado';
    case 'neutral':
      return 'Neutro';
    case 'friendly':
      return 'Amigável';
    case 'allied':
      return 'Aliado';
  }
}

function defaultTrustFromRelation(relation: FactionRelation): number {
  if (relation === 'hostile') return -45;
  if (relation === 'trade_pact') return 42;
  if (relation === 'truce') return -10;
  return 10;
}

export function appendDiplomacyHistory(
  dip: FactionDiplomacyState,
  turn: number,
  labelPt: string,
  deltaTrust: number
): FactionDiplomacyState {
  const nextHistory: DiplomacyHistoryEvent[] = [
    { turn, labelPt, deltaTrust },
    ...dip.history,
  ].slice(0, 10);
  return { ...dip, history: nextHistory };
}

export function recalculateFactionStance(dip: FactionDiplomacyState): FactionDiplomacyState {
  const clampedTrust = Math.max(-100, Math.min(100, Math.round(dip.trustScore)));
  let stance: DiplomaticStance;
  let embargoActive = dip.treaties.embargoActive;

  if (dip.atWar) {
    stance = 'hostile';
    embargoActive = true;
  } else if (dip.treaties.alliance && clampedTrust >= 55) {
    stance = 'allied';
    embargoActive = false;
  } else if (clampedTrust <= -35) {
    if (dip.treaties.truceTurnsRemaining > 0 || dip.treaties.peaceTreatyTurns > 0) {
      stance = 'wary';
    } else {
      stance = 'hostile';
      embargoActive = true;
    }
  } else if (clampedTrust < 0) {
    stance = 'wary';
    embargoActive = false;
  } else if (clampedTrust < 30) {
    stance = 'neutral';
    embargoActive = false;
  } else {
    stance = dip.treaties.alliance ? 'allied' : 'friendly';
    embargoActive = false;
  }

  return {
    ...dip,
    trustScore: clampedTrust,
    stance,
    treaties: {
      ...dip.treaties,
      embargoActive,
    },
  };
}

export function createInitialDiplomacyMap(
  factions: FactionState[]
): Record<string, FactionDiplomacyState> {
  const map: Record<string, FactionDiplomacyState> = {};
  for (const f of factions) {
    const atWar = f.relation === 'hostile';
    map[f.id] = recalculateFactionStance({
      factionId: f.id,
      stance: stanceFromLegacyRelation(f.relation),
      trustScore: defaultTrustFromRelation(f.relation),
      atWar,
      conflictCount: atWar ? 1 : 0,
      turnsSinceLastConflict: atWar ? 0 : 10,
      borderFrictionScore: 0,
      tradeGoodwillScore: f.relation === 'trade_pact' ? 12 : 0,
      militaryBalanceDelta: 0,
      betrayalPenalty: 0,
      treaties: createDefaultTreaties(f.relation, f.truceTurnsRemaining),
      history: [],
      lastStanceReasonPt: atWar
        ? 'Rivalidade inicial nas fronteiras.'
        : f.relation === 'trade_pact'
          ? 'Acordo mercantil aberto.'
          : 'Postura diplomática inicial.',
    });
  }
  return map;
}

export function normalizeDiplomacyMap(
  raw: unknown,
  factions: FactionState[]
): Record<string, FactionDiplomacyState> {
  const fallback = createInitialDiplomacyMap(factions);
  if (!raw || typeof raw !== 'object') return fallback;
  const rawObj = raw as Record<string, unknown>;
  const result: Record<string, FactionDiplomacyState> = {};

  for (const faction of factions) {
    const def = fallback[faction.id];
    const item = rawObj[faction.id];
    if (!item || typeof item !== 'object') {
      result[faction.id] = def;
      continue;
    }
    const r = item as Record<string, unknown>;
    const rawTreaties =
      r.treaties && typeof r.treaties === 'object'
        ? (r.treaties as Record<string, unknown>)
        : {};
    const treaties: TreatyState = {
      peaceTreatyTurns: Math.max(0, Math.round(Number(rawTreaties.peaceTreatyTurns ?? 0) || 0)),
      nonAggressionTurns: Math.max(
        0,
        Math.round(Number(rawTreaties.nonAggressionTurns ?? 0) || 0)
      ),
      tradePact: Boolean(rawTreaties.tradePact ?? def.treaties.tradePact),
      alliance: Boolean(rawTreaties.alliance ?? false),
      truceTurnsRemaining: Math.max(
        0,
        Math.round(Number(rawTreaties.truceTurnsRemaining ?? faction.truceTurnsRemaining ?? 0) || 0)
      ),
      warReparationsPerTurn: Math.max(
        0,
        Math.round(Number(rawTreaties.warReparationsPerTurn ?? 0) || 0)
      ),
      reparationsDirection:
        rawTreaties.reparationsDirection === 'player_receives' ||
        rawTreaties.reparationsDirection === 'player_pays'
          ? rawTreaties.reparationsDirection
          : null,
      reparationsTurnsRemaining: Math.max(
        0,
        Math.round(Number(rawTreaties.reparationsTurnsRemaining ?? 0) || 0)
      ),
      embargoActive: Boolean(rawTreaties.embargoActive ?? def.treaties.embargoActive),
    };

    const history: DiplomacyHistoryEvent[] = Array.isArray(r.history)
      ? r.history
          .filter(
            (h): h is DiplomacyHistoryEvent =>
              Boolean(h) &&
              typeof h === 'object' &&
              typeof (h as DiplomacyHistoryEvent).turn === 'number' &&
              typeof (h as DiplomacyHistoryEvent).labelPt === 'string'
          )
          .slice(0, 10)
      : [];

    result[faction.id] = recalculateFactionStance({
      factionId: faction.id,
      stance:
        r.stance === 'hostile' ||
        r.stance === 'wary' ||
        r.stance === 'neutral' ||
        r.stance === 'friendly' ||
        r.stance === 'allied'
          ? r.stance
          : def.stance,
      trustScore:
        typeof r.trustScore === 'number' && Number.isFinite(r.trustScore)
          ? Math.max(-100, Math.min(100, Math.round(r.trustScore)))
          : def.trustScore,
      atWar: Boolean(r.atWar ?? (faction.relation === 'hostile')),
      conflictCount: Math.max(0, Math.round(Number(r.conflictCount ?? def.conflictCount) || 0)),
      turnsSinceLastConflict: Math.max(
        0,
        Math.round(Number(r.turnsSinceLastConflict ?? def.turnsSinceLastConflict) || 0)
      ),
      borderFrictionScore: Math.min(
        0,
        Math.max(-30, Math.round(Number(r.borderFrictionScore ?? 0) || 0))
      ),
      tradeGoodwillScore: Math.max(
        0,
        Math.min(35, Math.round(Number(r.tradeGoodwillScore ?? def.tradeGoodwillScore) || 0))
      ),
      militaryBalanceDelta: Math.round(Number(r.militaryBalanceDelta ?? 0) || 0),
      betrayalPenalty: Math.min(
        0,
        Math.max(-50, Math.round(Number(r.betrayalPenalty ?? 0) || 0))
      ),
      treaties,
      history,
      lastStanceReasonPt:
        typeof r.lastStanceReasonPt === 'string'
          ? r.lastStanceReasonPt
          : def.lastStanceReasonPt,
    });
  }

  return result;
}

function getDiplomacyMapForState(state: KingdomState): Record<string, FactionDiplomacyState> {
  return normalizeDiplomacyMap(state.diplomacyByFactionId, state.factions);
}

function buildDiplomacyTradeContextMap(
  diplomacyMap: Record<string, FactionDiplomacyState>,
  factions: FactionState[]
): Record<string, DiplomacyTradeContext> {
  const ctx: Record<string, DiplomacyTradeContext> = {};
  for (const faction of factions) {
    const dip = diplomacyMap[faction.id];
    if (!dip) continue;
    ctx[faction.id] = {
      stance: dip.stance,
      hasTradePact: dip.treaties.tradePact || faction.relation === 'trade_pact',
      atWar: dip.atWar,
      embargoed: dip.treaties.embargoActive || dip.stance === 'hostile',
      trustScore: dip.trustScore,
    };
  }
  return ctx;
}

function syncFactionsFromDiplomacy(
  factions: FactionState[],
  diplomacyMap: Record<string, FactionDiplomacyState>
): FactionState[] {
  return factions.map((f) => {
    const dip = diplomacyMap[f.id];
    if (!dip) return f;
    return {
      ...f,
      relation: legacyRelationFromDiplomacy(dip),
      truceTurnsRemaining: dip.treaties.truceTurnsRemaining,
    };
  });
}

function computeBorderPressureScore(
  worldState: HexWorldState,
  faction: FactionState
): { borderFrictionScore: number; adjacentBordersCount: number; nearCapitalCount: number } {
  const factionTiles = [];
  const playerTiles = [];
  for (const tile of Object.values(worldState.hexes)) {
    if (tile.owner === faction.id) factionTiles.push(tile);
    else if (tile.owner === 'player') playerTiles.push(tile);
  }

  let adjacentBordersCount = 0;
  let nearCapitalCount = 0;
  for (const pt of playerTiles) {
    const touchesFaction = factionTiles.some((ft) => axialDistance(pt, ft) === 1);
    if (touchesFaction) adjacentBordersCount += 1;
    if (axialDistance(pt, faction.capitalCoord) <= 3) nearCapitalCount += 1;
  }

  const mult = faction.personality === 'expansionist' ? 1.2 : 0.8;
  const raw = Math.round(-(adjacentBordersCount * 2 + nearCapitalCount * 4) * mult);
  return {
    borderFrictionScore: Math.max(-28, Math.min(0, raw)),
    adjacentBordersCount,
    nearCapitalCount,
  };
}

function buildWarDamageSyncEffect(state: KingdomState): {
  effect: ActiveWorldEffect | null;
  penaltyByKey: Record<string, number>;
} {
  const damaged = state.damagedHexes ?? {};
  const entries = Object.entries(damaged);
  if (entries.length === 0) return { effect: null, penaltyByKey: {} };

  let totalPenalty = 0;
  let playerDamagedCount = 0;
  const penaltyByKey: Record<string, number> = {};

  for (const [k, rec] of entries) {
    const tile = state.worldState.hexes[k];
    if (!tile || tile.owner !== 'player') continue;
    if (rec.damagePct <= 0 || rec.productionPenaltyPct <= 0) continue;
    playerDamagedCount += 1;
    totalPenalty += rec.productionPenaltyPct;
    penaltyByKey[k] = rec.productionPenaltyPct;
  }

  if (playerDamagedCount === 0) return { effect: null, penaltyByKey: {} };
  const playerHexCount = Math.max(
    1,
    Object.values(state.worldState.hexes).filter((t) => t.owner === 'player').length
  );
  const aggregatePenalty = Math.min(
    0.4,
    Math.max(0.05, Number((totalPenalty / (playerHexCount * 100)).toFixed(2)))
  );

  return {
    effect: {
      id: 'eff-war-damage-sync',
      titlePt: 'Danos de Conflito',
      descriptionPt: `${playerDamagedCount} setor(es) danificado(s) aguardando reparos.`,
      turnsRemaining: 1,
      efficiencyPenalty: aggregatePenalty,
    },
    penaltyByKey,
  };
}

export function createStarterKingdomState(
  assets: HexAssetEntry[],
  seed: number = DEFAULT_WORLD_SEED
): KingdomState {
  const generated = generateProceduralKingdomWorld(assets, seed);
  const initialResearch = createInitialResearchState();
  const initialCities = syncAndEvolveCities({
    worldState: generated.worldState,
    roads: {},
    existingCities: ensureStarterCapitalCity({
      playerCapital: generated.playerCapital,
      worldState: generated.worldState,
      worldSeed: generated.seed,
      existingCities: [],
    }),
    playerCapital: generated.playerCapital,
    population: 18,
    unlockedTechs: initialResearch.unlocked,
    assets,
    turn: 1,
    worldSeed: generated.seed,
  }).cities;

  return {
    turn: 1,
    calendar: computeCalendarSnapshot(1),
    dayPhase: getDayPhaseForTurn(1),
    climateWeather: createInitialClimateWeather(),
    worldSeed: generated.seed,
    playerCapital: generated.playerCapital,
    worldState: generated.worldState,
    resources: createInitialResources(),
    population: 18,
    foodDeficitTurns: 0,
    research: initialResearch,
    units: generated.units,
    factions: generated.factions,
    constructions: [],
    expansions: [],
    roads: {},
    cities: initialCities,
    activeEffects: [],
    activeEvent: null,
    eventHistory: [],
    narrativeState: createInitialNarrativeState(),
    lastTurnSummaryPt: null,
    diplomacyByFactionId: createInitialDiplomacyMap(generated.factions),
    interfactionTrade: createInitialInterfactionTradeState(),
    damagedHexes: {},
    victoryState: createInitialVictoryState(generated.factions),
  };
}

export function createSandboxKingdomState(): KingdomState {
  const initialFactions = createInitialFactions();
  return {
    turn: 1,
    calendar: computeCalendarSnapshot(1),
    dayPhase: getDayPhaseForTurn(1),
    climateWeather: createInitialClimateWeather(),
    worldState: createEmptyWorldState(),
    resources: createInitialResources(),
    population: 8,
    foodDeficitTurns: 0,
    research: createInitialResearchState(),
    units: [],
    factions: initialFactions,
    constructions: [],
    expansions: [],
    roads: {},
    cities: [],
    activeEffects: [],
    activeEvent: null,
    eventHistory: [],
    narrativeState: createInitialNarrativeState(),
    lastTurnSummaryPt: null,
    diplomacyByFactionId: createInitialDiplomacyMap(initialFactions),
    interfactionTrade: createInitialInterfactionTradeState(),
    damagedHexes: {},
    victoryState: createInitialVictoryState(initialFactions),
  };
}

export function getKingdomEconomy(
  state: KingdomState,
  assets: HexAssetEntry[]
): TurnProductionBreakdown {
  const tradePactBonus = getTradePactBonusGold(state.factions);
  const underKeys = getUnderConstructionKeys(state);
  const upgradingByKey = getUpgradingConstructionsByKey(state);
  const moduleByKey = getModuleConstructionsByKey(state);
  const calendar = state.calendar ?? computeCalendarSnapshot(state.turn);
  const weather = state.climateWeather ?? createInitialClimateWeather();
  const expansionWorkersUsed = (state.expansions ?? [])
    .filter((e) => e.owner === 'player')
    .reduce((sum, e) => sum + e.workersCommitted, 0);

  const warDamage = buildWarDamageSyncEffect(state);
  const baseActiveEffects = (state.activeEffects ?? []).filter(
    (e) => e.id !== 'eff-war-damage-sync'
  );
  const effectiveEffects = warDamage.effect
    ? [...baseActiveEffects, warDamage.effect]
    : baseActiveEffects;

  const breakdown = computeTurnEconomyBreakdown({
    worldState: state.worldState,
    resources: state.resources,
    population: state.population,
    unlockedTechs: state.research.unlocked,
    units: state.units,
    assets,
    owner: 'player',
    underConstructionKeys: underKeys,
    expansionWorkersUsed,
    activeEffects: effectiveEffects,
    tradePactGoldBonus: tradePactBonus,
    eventGoldMultiplier: state.activeEvent?.goldMultiplierMod ?? 1,
    eventFoodMultiplier: state.activeEvent?.foodMultiplierMod ?? 1,
    foodDeficitTurns: state.foodDeficitTurns ?? 0,
    roads: state.roads ?? {},
    cities: state.cities ?? [],
    playerCapital: state.playerCapital,
    worldSeed: state.worldSeed ?? state.worldState.seed,
    season: calendar.season,
    weather,
    upgradingConstructionsByKey: upgradingByKey,
    moduleConstructionsByKey: moduleByKey,
  });

  if (Object.keys(warDamage.penaltyByKey).length > 0) {
    for (const [key, pct] of Object.entries(warDamage.penaltyByKey)) {
      const bReport = breakdown.buildingsByKey[key];
      if (!bReport) continue;
      const mult = Math.max(0.35, (100 - pct) / 100);
      bReport.actualProduction = {
        gold: Math.round(bReport.actualProduction.gold * mult),
        wood: Math.round(bReport.actualProduction.wood * mult),
        stone: Math.round(bReport.actualProduction.stone * mult),
        food: Math.round(bReport.actualProduction.food * mult),
        ore: Math.round(bReport.actualProduction.ore * mult),
        metal: Math.round(bReport.actualProduction.metal * mult),
        science: Math.round(bReport.actualProduction.science * mult),
      };
      bReport.reasonPt = `Setor danificado por conflito (-${pct}% produção; repare para restaurar).`;
    }
  }

  return breakdown;
}

export function getKingdomRoadSummary(
  state: KingdomState,
  assets: HexAssetEntry[]
): RoadConnectivitySummary {
  const activeCities =
    state.cities && state.cities.length > 0
      ? state.cities
      : ensureStarterCapitalCity({
          playerCapital: state.playerCapital,
          worldState: state.worldState,
          worldSeed: state.worldSeed ?? state.worldState.seed,
          existingCities: [],
        });

  return computeRoadConnectivity({
    worldState: state.worldState,
    roads: state.roads ?? {},
    cityCenters: activeCities.map((c) => ({
      id: c.id,
      center: c.center,
      level: c.level,
    })),
    assets,
    owner: 'player',
    underConstructionKeys: getUnderConstructionKeys(state),
  });
}

export function getKingdomMarket(
  state: KingdomState,
  assets: HexAssetEntry[]
): MarketSummary {
  const economy = getKingdomEconomy(state, assets);
  return computeMarketSummary({
    worldState: state.worldState,
    resources: state.resources,
    economy,
    unlockedTechs: state.research.unlocked,
    factions: state.factions,
    activeEffects: state.activeEffects,
    assets,
    underConstructionKeys: getUnderConstructionKeys(state),
    roadConnectivity: economy.roadConnectivity,
    regionalSummary: economy.regionalSummary,
  });
}

export function getKingdomProgression(
  state: KingdomState,
  assets: HexAssetEntry[]
): {
  stage: KingdomStageInfo;
  military: ReturnType<typeof computeFactionMilitaryPower>;
} {
  const territoryCount = countPlayerTerritory(state.worldState);
  const military = computeFactionMilitaryPower(
    state.worldState,
    state.units,
    assets,
    'player',
    state.research.unlocked,
    getUnderConstructionKeys(state),
    state.damagedHexes
  );
  return {
    stage: getKingdomStage({
      territoryCount,
      population: state.population,
      unlockedTechCount: state.research.unlocked.length,
      militaryUnitCount: military.unitCount,
    }),
    military,
  };
}

export function getKingdomTerritoryCapacity(
  state: KingdomState,
  assets: HexAssetEntry[]
): TerritorialCapacitySummary {
  const roadConnectivity = getKingdomRoadSummary(state, assets);
  return computeTerritorialCapacity({
    worldState: state.worldState,
    population: state.population,
    unlockedTechs: state.research.unlocked,
    assets,
    owner: 'player',
    underConstructionKeys: getUnderConstructionKeys(state),
    activeExpansions: state.expansions ?? [],
    playerCapital: state.playerCapital,
    roads: state.roads ?? {},
    roadConnectivity,
    cities: state.cities ?? [],
  });
}

export function evaluateExpansionInKingdom(
  state: KingdomState,
  q: number,
  r: number,
  assets: HexAssetEntry[]
): ExpansionCheckResult {
  const econ = getKingdomEconomy(state, assets);
  return evaluateExpansion({
    worldState: state.worldState,
    q,
    r,
    population: state.population,
    unlockedTechs: state.research.unlocked,
    availableWorkers: econ.population.availableWorkers,
    assets,
    owner: 'player',
    underConstructionKeys: getUnderConstructionKeys(state),
    activeExpansions: state.expansions ?? [],
    playerCapital: state.playerCapital,
    roads: state.roads ?? {},
    roadConnectivity: econ.roadConnectivity,
    cities: state.cities ?? [],
  });
}

export const canExpandInKingdom = evaluateExpansionInKingdom;

export function tradeResourceInKingdom(
  state: KingdomState,
  resource: TradableResource,
  action: 'buy' | 'sell',
  quantity: number,
  assets: HexAssetEntry[]
): {
  nextState: KingdomState;
  success: boolean;
  totalGold: number;
  messagePt: string;
} {
  const amount = Math.max(1, Math.round(quantity));
  const market = getKingdomMarket(state, assets);
  const quote = market.quotes.find((q) => q.resource === resource);
  if (!quote) {
    return {
      nextState: state,
      success: false,
      totalGold: 0,
      messagePt: 'Recurso indisponível no mercado.',
    };
  }

  if (action === 'buy') {
    const spaceLeft = Math.max(0, quote.cap - quote.stock);
    if (spaceLeft <= 0) {
      return {
        nextState: state,
        success: false,
        totalGold: 0,
        messagePt: `Armazém de ${quote.labelPt} já está cheio (${quote.cap}).`,
      };
    }
    const actualAmount = Math.min(amount, spaceLeft);
    const totalCost = actualAmount * quote.buyPricePerUnit;
    if (state.worldState.cash < totalCost) {
      return {
        nextState: state,
        success: false,
        totalGold: totalCost,
        messagePt: `Ouro insuficiente ($${totalCost} para ${actualAmount} ${quote.labelPt}).`,
      };
    }

    return {
      nextState: {
        ...state,
        worldState: {
          ...state.worldState,
          cash: state.worldState.cash - totalCost,
        },
        resources: {
          ...state.resources,
          [resource]: state.resources[resource] + actualAmount,
        },
      },
      success: true,
      totalGold: totalCost,
      messagePt: `Comprou +${actualAmount} ${quote.labelPt} por $${totalCost}.`,
    };
  }

  // Sell
  if (quote.stock <= 0) {
    return {
      nextState: state,
      success: false,
      totalGold: 0,
      messagePt: `Sem estoque de ${quote.labelPt} para vender.`,
    };
  }
  const actualAmount = Math.min(amount, quote.stock);
  const totalRevenue = actualAmount * quote.sellPricePerUnit;

  return {
    nextState: {
      ...state,
      worldState: {
        ...state.worldState,
        cash: state.worldState.cash + totalRevenue,
      },
      resources: {
        ...state.resources,
        [resource]: state.resources[resource] - actualAmount,
      },
    },
    success: true,
    totalGold: totalRevenue,
    messagePt: `Vendeu ${actualAmount} ${quote.labelPt} por +$${totalRevenue}.`,
  };
}

export function buildInKingdom(
  state: KingdomState,
  q: number,
  r: number,
  structureIndex: number,
  orientation: number,
  assets: HexAssetEntry[]
): {
  nextState: KingdomState;
  built: boolean;
  messagePt: string | null;
} {
  const key = hexKey(q, r);
  const existing = state.worldState.hexes[key];
  const asset = assets[structureIndex];
  if (!asset) {
    return { nextState: state, built: false, messagePt: null };
  }

  const econ = getKingdomEconomy(state, assets);
  const validation = validateBuildCandidateOnHex({
    worldState: state.worldState,
    resources: state.resources,
    unlockedTechs: state.research.unlocked,
    availableWorkers: econ.population.availableWorkers,
    hasActiveConstructionAtCoord: Boolean(getConstructionAt(state, q, r)),
    q,
    r,
    structureIndex,
    assets,
    checkAffordability: true,
  });

  if (!validation.allowed || !validation.definition || !validation.effectiveCost) {
    return {
      nextState: state,
      built: false,
      messagePt: validation.reasonPt,
    };
  }

  const bDef = validation.definition;
  const cost = validation.effectiveCost;

  const zeroPricedAssets = assets.map((a, idx) =>
    idx === structureIndex ? { ...a, price: 0 } : a
  );
  const placed = placeHexInState(
    state.worldState,
    q,
    r,
    structureIndex,
    orientation,
    zeroPricedAssets,
    'player'
  );
  if (!placed.changed) {
    return {
      nextState: state,
      built: false,
      messagePt:
        placed.blockedReason === 'already_occupied'
          ? ALREADY_OCCUPIED_BUILD_MESSAGE
          : placed.blockedReason === 'incompatible_terrain'
            ? INCOMPATIBLE_TERRAIN_MESSAGE
            : placed.blockedReason === 'not_owned'
              ? NOT_OWNED_BUILD_MESSAGE
              : null,
    };
  }

  const totalTurns = Math.max(1, bDef.buildTimeTurns);
  const newConstruction: ActiveConstruction = {
    q,
    r,
    structureIndex,
    orientation,
    assetName: asset.name,
    turnsRemaining: totalTurns,
    totalTurns,
    owner: 'player',
    kind: 'build',
  };

  return {
    nextState: {
      ...state,
      worldState: {
        ...placed.nextState,
        cash: state.worldState.cash - cost.gold,
      },
      resources: {
        ...state.resources,
        wood: state.resources.wood - cost.wood,
        stone: state.resources.stone - cost.stone,
        food: state.resources.food - cost.food,
        ore: state.resources.ore - cost.ore,
        metal: state.resources.metal - cost.metal,
      },
      constructions: [...state.constructions, newConstruction],
    },
    built: true,
    messagePt: validation.workerWarningPt
      ? `${bDef.labelPt} em construção (${totalTurns} ${
          totalTurns === 1 ? 'turno' : 'turnos'
        }) · Faltam trabalhadores!`
      : `${bDef.labelPt} em construção (${totalTurns} ${
          totalTurns === 1 ? 'turno' : 'turnos'
        })!`,
  };
}

export function evaluateBuildingUpgradeInKingdom(
  state: KingdomState,
  q: number,
  r: number,
  assets: HexAssetEntry[]
): BuildingUpgradeEvaluation {
  const econ = getKingdomEconomy(state, assets);
  return evaluateBuildingUpgrade({
    worldState: state.worldState,
    q,
    r,
    assets,
    resources: state.resources,
    population: state.population,
    unlockedTechs: state.research.unlocked,
    availableWorkers: econ.population.availableWorkers,
    hasActiveConstructionAtCoord: Boolean(getConstructionAt(state, q, r)),
    roads: state.roads ?? {},
    roadConnectivity: econ.roadConnectivity,
    cities: state.cities ?? [],
  });
}

export function upgradeBuildingInKingdom(
  state: KingdomState,
  q: number,
  r: number,
  assets: HexAssetEntry[]
): {
  nextState: KingdomState;
  started: boolean;
  evaluation: BuildingUpgradeEvaluation;
  messagePt: string;
} {
  const evaluation = evaluateBuildingUpgradeInKingdom(state, q, r, assets);
  if (!evaluation.canUpgrade || !evaluation.nextTier || !evaluation.effectiveCost) {
    return {
      nextState: state,
      started: false,
      evaluation,
      messagePt: evaluation.reasonPt ?? 'Não é possível evoluir esta estrutura.',
    };
  }

  const tile = state.worldState.hexes[hexKey(q, r)];
  if (!tile) {
    return {
      nextState: state,
      started: false,
      evaluation,
      messagePt: 'Território inválido.',
    };
  }

  const assetName = assets[tile.structureIndex]?.name ?? '';
  const cost = evaluation.effectiveCost;
  const tier = evaluation.nextTier;
  const totalTurns = Math.max(1, tier.upgradeTimeTurns);

  const upgradeOrder: ActiveConstruction = {
    q,
    r,
    structureIndex: tile.structureIndex,
    orientation: tile.orientation,
    assetName,
    turnsRemaining: totalTurns,
    totalTurns,
    owner: 'player',
    kind: 'upgrade',
    targetLevel: tier.level,
  };

  return {
    nextState: {
      ...state,
      worldState: {
        ...state.worldState,
        cash: state.worldState.cash - cost.gold,
      },
      resources: {
        ...state.resources,
        wood: state.resources.wood - cost.wood,
        stone: state.resources.stone - cost.stone,
        food: state.resources.food - cost.food,
        ore: state.resources.ore - cost.ore,
        metal: state.resources.metal - cost.metal,
      },
      constructions: [...state.constructions, upgradeOrder],
    },
    started: true,
    evaluation,
    messagePt: `Evoluindo para Nível ${toRomanLevel(tier.level)} (${totalTurns} ${
      totalTurns === 1 ? 'turno' : 'turnos'
    })!`,
  };
}

export function evaluateBuildingModulesInKingdom(
  state: KingdomState,
  q: number,
  r: number,
  assets: HexAssetEntry[]
): BuildingModulesEvaluation | null {
  return evaluateBuildingModules({
    worldState: state.worldState,
    q,
    r,
    assets,
    resources: state.resources,
    unlockedTechs: state.research.unlocked,
    constructions: state.constructions,
    underConstructionKeys: getUnderConstructionKeys(state),
  });
}

export function installBuildingModuleInKingdom(
  state: KingdomState,
  q: number,
  r: number,
  moduleId: BuildingModuleId,
  assets: HexAssetEntry[]
): {
  nextState: KingdomState;
  started: boolean;
  evaluation: BuildingModulesEvaluation | null;
  messagePt: string;
} {
  const evaluation = evaluateBuildingModulesInKingdom(state, q, r, assets);
  if (!evaluation) {
    return {
      nextState: state,
      started: false,
      evaluation: null,
      messagePt: 'Esta estrutura não possui melhorias modulares compatíveis.',
    };
  }

  const option = evaluation.options.find((opt) => opt.definition.id === moduleId);
  if (!option) {
    return {
      nextState: state,
      started: false,
      evaluation,
      messagePt: 'Módulo incompatível com esta construção.',
    };
  }

  if (option.status !== 'available') {
    return {
      nextState: state,
      started: false,
      evaluation,
      messagePt: option.reasonPt ?? option.statusLabelPt,
    };
  }

  const tile = state.worldState.hexes[hexKey(q, r)];
  if (!tile) {
    return {
      nextState: state,
      started: false,
      evaluation,
      messagePt: 'Território inválido.',
    };
  }

  const assetName = assets[tile.structureIndex]?.name ?? '';
  const cost = option.scaledCost;
  const totalTurns = Math.max(1, option.definition.buildTimeTurns);

  const moduleOrder: ActiveConstruction = {
    q,
    r,
    structureIndex: tile.structureIndex,
    orientation: tile.orientation,
    assetName,
    turnsRemaining: totalTurns,
    totalTurns,
    owner: 'player',
    kind: 'module',
    moduleId,
  };

  const nextState: KingdomState = {
    ...state,
    worldState: {
      ...state.worldState,
      cash: state.worldState.cash - cost.gold,
    },
    resources: {
      ...state.resources,
      wood: state.resources.wood - cost.wood,
      stone: state.resources.stone - cost.stone,
      food: state.resources.food - cost.food,
      ore: state.resources.ore - cost.ore,
      metal: state.resources.metal - cost.metal,
    },
    constructions: [...state.constructions, moduleOrder],
  };

  return {
    nextState,
    started: true,
    evaluation: evaluateBuildingModulesInKingdom(nextState, q, r, assets),
    messagePt: `Instalando módulo ${BUILDING_MODULES[moduleId].labelPt} (${totalTurns} ${
      totalTurns === 1 ? 'turno' : 'turnos'
    })!`,
  };
}

export function buildOrUpgradeRoadInKingdom(
  state: KingdomState,
  q: number,
  r: number,
  assets: HexAssetEntry[]
): {
  nextState: KingdomState;
  built: boolean;
  targetLevel: RoadLevel | null;
  isUpgrade: boolean;
  messagePt: string | null;
} {
  const check = canBuildOrUpgradeRoad({
    worldState: state.worldState,
    roads: state.roads ?? {},
    q,
    r,
    cash: state.worldState.cash,
    resources: state.resources,
    unlockedTechs: state.research.unlocked,
    assets,
    underConstructionKeys: getUnderConstructionKeys(state),
    actorId: 'player',
  });

  if (!check.allowed || !check.targetLevel || !check.definition) {
    return {
      nextState: state,
      built: false,
      targetLevel: check.targetLevel,
      isUpgrade: check.isUpgrade,
      messagePt: check.reasonPt,
    };
  }

  const key = hexKey(q, r);
  const cost = check.definition.cost;
  const nextRoads: RoadMap = {
    ...(state.roads ?? {}),
    [key]: {
      q,
      r,
      level: check.targetLevel,
      owner: 'player',
    },
  };

  const citySync = syncAndEvolveCities({
    worldState: state.worldState,
    roads: nextRoads,
    existingCities: state.cities ?? [],
    playerCapital: state.playerCapital,
    population: state.population,
    unlockedTechs: state.research.unlocked,
    assets,
    underConstructionKeys: getUnderConstructionKeys(state),
    hasFoodDeficit: (state.foodDeficitTurns ?? 0) > 0,
    turn: state.turn,
    worldSeed: state.worldSeed ?? state.worldState.seed,
  });

  const actionLabel = check.isUpgrade ? 'Estrada melhorada' : 'Via construída';
  const connectedCityCount =
    citySync.connectivity.tileMetricsByKey[key]?.connectedCityCount ?? 0;
  const linkSuffix =
    connectedCityCount >= 2 ? ' · Conexão entre cidades ativa!' : '';

  return {
    nextState: {
      ...state,
      worldState: {
        ...state.worldState,
        cash: state.worldState.cash - cost.gold,
      },
      resources: {
        ...state.resources,
        wood: state.resources.wood - cost.wood,
        stone: state.resources.stone - cost.stone,
        metal: state.resources.metal - cost.metal,
      },
      roads: nextRoads,
      cities: citySync.cities,
    },
    built: true,
    targetLevel: check.targetLevel,
    isUpgrade: check.isUpgrade,
    messagePt: `${actionLabel}: ${check.definition.namePt}${linkSuffix}`,
  };
}

export function demolishRoadInKingdom(
  state: KingdomState,
  q: number,
  r: number,
  assets: HexAssetEntry[]
): {
  nextState: KingdomState;
  removed: boolean;
  messagePt: string;
} {
  const key = hexKey(q, r);
  const existing = (state.roads ?? {})[key];
  if (!existing || existing.owner !== 'player') {
    return {
      nextState: state,
      removed: false,
      messagePt: 'Não há estrada neste território.',
    };
  }
  const nextRoads: RoadMap = { ...(state.roads ?? {}) };
  delete nextRoads[key];

  const citySync = syncAndEvolveCities({
    worldState: state.worldState,
    roads: nextRoads,
    existingCities: state.cities ?? [],
    playerCapital: state.playerCapital,
    population: state.population,
    unlockedTechs: state.research.unlocked,
    assets,
    underConstructionKeys: getUnderConstructionKeys(state),
    hasFoodDeficit: (state.foodDeficitTurns ?? 0) > 0,
    turn: state.turn,
    worldSeed: state.worldSeed ?? state.worldState.seed,
  });

  return {
    nextState: {
      ...state,
      roads: nextRoads,
      cities: citySync.cities,
    },
    removed: true,
    messagePt: 'Estrada removida.',
  };
}

export function demolishInKingdom(
  state: KingdomState,
  q: number,
  r: number,
  assets: HexAssetEntry[]
): {
  nextState: KingdomState;
  removed: boolean;
  messagePt: string | null;
} {
  const key = hexKey(q, r);
  const prevTile = state.worldState.hexes[key];
  const prevAssetName = prevTile ? assets[prevTile.structureIndex]?.name ?? '' : '';

  const res = demolishHexInState(state.worldState, q, r, assets, 'player');
  if (!res.removed) {
    return {
      nextState: state,
      removed: false,
      messagePt:
        res.blockedReason === 'not_owned'
          ? 'Você só pode demolir construções do seu território.'
          : 'Não há construção neste território.',
    };
  }

  // Roads on land are preserved; a road on a water bridge must be cleared when the bridge is demolished.
  let nextRoads = state.roads ?? {};
  const terrainAfter = res.nextState.hexes[key]
    ? getHexTerrainAndResource(q, r, res.nextState.hexes[key]).terrainType
    : 'plains';
  if ((prevAssetName === 'bridge' || terrainAfter === 'water') && nextRoads[key]) {
    nextRoads = { ...nextRoads };
    delete nextRoads[key];
  }

  const nextConstructions = state.constructions.filter((c) => !(c.q === q && c.r === r));
  const isCapital =
    state.playerCapital &&
    state.playerCapital.q === q &&
    state.playerCapital.r === r;
  const remainingCities = isCapital
    ? state.cities ?? []
    : (state.cities ?? []).filter((c) => !(c.center.q === q && c.center.r === r));

  const citySync = syncAndEvolveCities({
    worldState: res.nextState,
    roads: nextRoads,
    existingCities: remainingCities,
    playerCapital: state.playerCapital,
    population: state.population,
    unlockedTechs: state.research.unlocked,
    assets,
    underConstructionKeys: new Set(
      nextConstructions
        .filter((c) => c.kind !== 'upgrade' && c.kind !== 'module')
        .map((c) => hexKey(c.q, c.r))
    ),
    hasFoodDeficit: (state.foodDeficitTurns ?? 0) > 0,
    turn: state.turn,
    worldSeed: state.worldSeed ?? res.nextState.seed,
  });

  return {
    nextState: {
      ...state,
      worldState: res.nextState,
      constructions: nextConstructions,
      roads: nextRoads,
      cities: citySync.cities,
    },
    removed: true,
    messagePt: 'Construção demolida — terreno livre preservado.',
  };
}

export function startExpansionInKingdom(
  state: KingdomState,
  q: number,
  r: number,
  assets: HexAssetEntry[]
): {
  nextState: KingdomState;
  started: boolean;
  expansion: ActiveExpansion | null;
  check: ExpansionCheckResult;
  messagePt: string;
} {
  const econ = getKingdomEconomy(state, assets);
  const res = startExpansion({
    worldState: state.worldState,
    activeExpansions: state.expansions ?? [],
    q,
    r,
    population: state.population,
    unlockedTechs: state.research.unlocked,
    availableWorkers: econ.population.availableWorkers,
    assets,
    owner: 'player',
    underConstructionKeys: getUnderConstructionKeys(state),
    playerCapital: state.playerCapital,
    roads: state.roads ?? {},
    roadConnectivity: econ.roadConnectivity,
    cities: state.cities ?? [],
  });

  if (!res.started) {
    return {
      nextState: state,
      started: false,
      expansion: null,
      check: res.check,
      messagePt: res.messagePt,
    };
  }

  return {
    nextState: {
      ...state,
      expansions: res.nextExpansions,
    },
    started: true,
    expansion: res.expansion,
    check: res.check,
    messagePt: res.messagePt,
  };
}

export function setActiveResearchInKingdom(
  state: KingdomState,
  techId: TechId
): { nextState: KingdomState; selected: boolean; messagePt: string } {
  const res = selectActiveTech(state.research, techId);
  if (!res.selected) {
    return {
      nextState: state,
      selected: false,
      messagePt: 'Pesquisa ainda bloqueada ou já concluída.',
    };
  }
  return {
    nextState: {
      ...state,
      research: res.nextResearch,
    },
    selected: true,
    messagePt: `Pesquisa ativa: ${TECH_BY_ID[techId].namePt}`,
  };
}

export function recruitUnitInKingdom(
  state: KingdomState,
  q: number,
  r: number,
  unitType: UnitType,
  assets: HexAssetEntry[]
): {
  nextState: KingdomState;
  recruited: boolean;
  messagePt: string;
} {
  const tile = state.worldState.hexes[hexKey(q, r)];
  if (!tile || tile.owner !== 'player') {
    return {
      nextState: state,
      recruited: false,
      messagePt: 'Selecione uma base do seu território.',
    };
  }

  if (getConstructionAt(state, q, r)) {
    return {
      nextState: state,
      recruited: false,
      messagePt: 'Construção em andamento. Aguarde a conclusão para recrutar.',
    };
  }

  const assetName = assets[tile.structureIndex]?.name ?? '';
  const bDef = getBuildingDefinition(assetName);
  if (!bDef.canRecruitUnits) {
    return {
      nextState: state,
      recruited: false,
      messagePt: 'Recrute tropas em um Quartel, Bastião, Castelo ou Porto.',
    };
  }

  if (getUnitAt(state.units, q, r)) {
    return {
      nextState: state,
      recruited: false,
      messagePt: 'Já existe uma unidade estacionada neste hexágono.',
    };
  }

  const uDef = UNIT_CATALOG[unitType];
  if (uDef.navalOnly && assetName !== 'building-port') {
    return {
      nextState: state,
      recruited: false,
      messagePt: 'Navios só podem ser recrutados em um Porto.',
    };
  }
  if (!uDef.navalOnly && assetName === 'building-port') {
    return {
      nextState: state,
      recruited: false,
      messagePt: 'Portos recrutam apenas unidades navais.',
    };
  }

  if (uDef.requiredTech && !state.research.unlocked.includes(uDef.requiredTech)) {
    return {
      nextState: state,
      recruited: false,
      messagePt: `Requer pesquisa: ${TECH_BY_ID[uDef.requiredTech].namePt}.`,
    };
  }

  const econ = getKingdomEconomy(state, assets);
  if (econ.population.availableWorkers < uDef.populationCost) {
    return {
      nextState: state,
      recruited: false,
      messagePt: `População livre insuficiente (precisa ${uDef.populationCost}).`,
    };
  }

  const afford = canAffordCost(state.worldState.cash, state.resources, {
    ...uDef.cost,
    stone: 0,
  });
  if (!afford.affordable) {
    return {
      nextState: state,
      recruited: false,
      messagePt: afford.missingLabelPt ?? 'Recursos insuficientes.',
    };
  }

  const newUnit: UnitEntity = {
    id: `unit-p-${state.turn}-${state.units.length + 1}-${q}-${r}`,
    type: unitType,
    owner: 'player',
    q,
    r,
    hp: uDef.maxHp,
    maxHp: uDef.maxHp,
    movedThisTurn: false,
  };

  return {
    nextState: {
      ...state,
      worldState: {
        ...state.worldState,
        cash: state.worldState.cash - uDef.cost.gold,
      },
      resources: {
        ...state.resources,
        wood: state.resources.wood - uDef.cost.wood,
        food: state.resources.food - uDef.cost.food,
        ore: state.resources.ore - uDef.cost.ore,
        metal: state.resources.metal - uDef.cost.metal,
      },
      units: [...state.units, newUnit],
    },
    recruited: true,
    messagePt: `${uDef.namePt} recrutado!`,
  };
}

function registerConflictInDiplomacyMap(params: {
  diplomacyMap: Record<string, FactionDiplomacyState>;
  factions: FactionState[];
  targetFactionId: HexOwner;
  turn: number;
  attackerSide: 'player' | 'faction';
  reasonPt: string;
}): {
  nextMap: Record<string, FactionDiplomacyState>;
  betrayedTreatyPt: string | null;
} {
  const { diplomacyMap, factions, targetFactionId, turn, attackerSide, reasonPt } = params;
  const nextMap: Record<string, FactionDiplomacyState> = { ...diplomacyMap };
  const current = nextMap[targetFactionId];
  if (!current) {
    return { nextMap, betrayedTreatyPt: null };
  }

  let betrayalHit = 0;
  let betrayedTreatyPt: string | null = null;
  if (attackerSide === 'player') {
    if (current.treaties.alliance) {
      betrayalHit = -35;
      betrayedTreatyPt = 'Aliança quebrada';
    } else if (
      current.treaties.peaceTreatyTurns > 0 ||
      current.treaties.nonAggressionTurns > 0 ||
      current.treaties.truceTurnsRemaining > 0
    ) {
      betrayalHit = -25;
      betrayedTreatyPt = 'Pacto de paz ou não agressão violado';
    } else if (current.treaties.tradePact) {
      betrayalHit = -15;
      betrayedTreatyPt = 'Acordo comercial rompido por ataque';
    }
  }

  const baseTrustDelta = -22 + betrayalHit;
  let updatedTarget: FactionDiplomacyState = {
    ...current,
    atWar: true,
    conflictCount: current.conflictCount + 1,
    turnsSinceLastConflict: 0,
    trustScore: current.trustScore + baseTrustDelta,
    betrayalPenalty: Math.max(-50, current.betrayalPenalty + betrayalHit),
    treaties: {
      ...current.treaties,
      peaceTreatyTurns: 0,
      nonAggressionTurns: 0,
      truceTurnsRemaining: 0,
      tradePact: false,
      alliance: false,
      reparationsTurnsRemaining: 0,
      warReparationsPerTurn: 0,
      reparationsDirection: null,
      embargoActive: true,
    },
    lastStanceReasonPt: betrayedTreatyPt
      ? `${reasonPt} (${betrayedTreatyPt})`
      : reasonPt,
  };
  updatedTarget = appendDiplomacyHistory(
    updatedTarget,
    turn,
    betrayedTreatyPt ?? reasonPt,
    baseTrustDelta
  );
  nextMap[targetFactionId] = recalculateFactionStance(updatedTarget);

  // Other factions react if the player committed diplomatic betrayal
  if (betrayedTreatyPt) {
    for (const f of factions) {
      if (f.id === targetFactionId) continue;
      const other = nextMap[f.id];
      if (!other) continue;
      let penalized: FactionDiplomacyState = {
        ...other,
        trustScore: other.trustScore - 10,
        lastStanceReasonPt: `Desconfiança após quebra de tratado contra ${
          factions.find((x) => x.id === targetFactionId)?.namePt ?? targetFactionId
        }.`,
      };
      penalized = appendDiplomacyHistory(penalized, turn, 'Quebra de tratado em outro reino', -10);
      nextMap[f.id] = recalculateFactionStance(penalized);
    }
  }

  return { nextMap, betrayedTreatyPt };
}

export function commandUnitInKingdom(
  state: KingdomState,
  from: AxialCoord,
  to: AxialCoord,
  assets: HexAssetEntry[]
): {
  nextState: KingdomState;
  acted: boolean;
  capturedKey?: string;
  messagePt: string;
} {
  const unit = getUnitAt(state.units, from.q, from.r);
  if (!unit || unit.owner !== 'player') {
    return { nextState: state, acted: false, messagePt: 'Nenhuma unidade sua selecionada.' };
  }
  if (unit.movedThisTurn) {
    return {
      nextState: state,
      acted: false,
      messagePt: 'Esta unidade já agiu neste turno. Avance o turno para movê-la.',
    };
  }

  const targetKey = hexKey(to.q, to.r);
  const targetTile = state.worldState.hexes[targetKey];
  if (typeof state.worldState.worldCols === 'number' && !targetTile) {
    return {
      nextState: state,
      acted: false,
      messagePt: 'Limite do mapa alcançado.',
    };
  }

  const terrainInfo = getHexTerrainAndResource(to.q, to.r, targetTile);
  const uDef = UNIT_CATALOG[unit.type];
  const underKeys = getUnderConstructionKeys(state);

  if (uDef.navalOnly && terrainInfo.terrainType !== 'water') {
    return {
      nextState: state,
      acted: false,
      messagePt: 'Navios navegam apenas em hexágonos de água.',
    };
  }
  if (!uDef.navalOnly && terrainInfo.terrainType === 'water') {
    const isBridge =
      targetTile &&
      assets[targetTile.structureIndex]?.name === 'bridge' &&
      !getConstructionAt(state, to.q, to.r);
    if (!isBridge) {
      return {
        nextState: state,
        acted: false,
        messagePt: 'Tropas terrestres não atravessam água sem ponte concluída.',
      };
    }
  }

  const reachable = getReachableUnitCoords({
    unit,
    worldState: state.worldState,
    units: state.units,
    assets,
    unlockedTechs: state.research.unlocked,
    roads: state.roads ?? {},
    underConstructionKeys: underKeys,
    canAttackOwner: (owner) => owner !== 'player' && owner !== 'neutral',
  });
  const reachEntry = reachable.find((c) => c.q === to.q && c.r === to.r);

  const occupant = getUnitAt(state.units, to.q, to.r);
  const targetOwner = targetTile?.owner ?? 'neutral';

  if (!reachEntry) {
    if (isAdjacentCoord(from, to) && occupant && (targetOwner === 'player' || targetOwner === 'neutral')) {
      return {
        nextState: state,
        acted: false,
        messagePt: 'Já há uma unidade nesse hexágono.',
      };
    }
    return {
      nextState: state,
      acted: false,
      messagePt: 'Selecione um hexágono adjacente ou dentro do alcance viário para mover ou atacar.',
    };
  }

  // Friendly move
  if (targetOwner === 'player' || targetOwner === 'neutral') {
    if (occupant) {
      return {
        nextState: state,
        acted: false,
        messagePt: 'Já há uma unidade nesse hexágono.',
      };
    }
    const nextUnits = state.units.map((u) =>
      u.id === unit.id ? { ...u, q: to.q, r: to.r, movedThisTurn: true } : u
    );
    return {
      nextState: { ...state, units: nextUnits },
      acted: true,
      messagePt: `${uDef.namePt} movido.`,
    };
  }

  // Attack enemy faction tile!
  const enemyFaction = state.factions.find((f) => f.id === targetOwner);
  const dipMap = getDiplomacyMapForState(state);
  const alliedOwners = new Set<HexOwner>();
  for (const [fId, d] of Object.entries(dipMap)) {
    if (d.stance === 'allied' || d.stance === 'friendly') {
      alliedOwners.add(fId as HexOwner);
    }
  }

  const roadConn = getKingdomRoadSummary(state, assets);
  const supplyReport = evaluateUnitSupply({
    unit,
    worldState: state.worldState,
    assets,
    unlockedTechs: state.research.unlocked,
    roads: state.roads ?? {},
    connectivity: roadConn,
    underConstructionKeys: underKeys,
    capitalCoord: state.playerCapital,
    foodDeficitTurns: state.foodDeficitTurns ?? 0,
    alliedOwners,
  });

  const combat = resolveHexCombat(
    unit,
    state.research.unlocked,
    state.worldState,
    to.q,
    to.r,
    state.units,
    assets,
    enemyFaction?.unlockedTechs ?? [],
    underKeys,
    {
      attackerSupplyStatus: supplyReport.status,
      damagedHexes: state.damagedHexes,
      turn: state.turn,
    }
  );

  const nextUnits = state.units
    .map((u) => {
      if (u.id === unit.id) {
        const nextHp = Math.max(0, u.hp - combat.attackerDamage);
        return {
          ...u,
          hp: nextHp,
          q: combat.capturedHex ? to.q : u.q,
          r: combat.capturedHex ? to.r : u.r,
          movedThisTurn: true,
        };
      }
      if (occupant && u.id === occupant.id) {
        return { ...u, hp: Math.max(0, u.hp - combat.defenderDamage) };
      }
      return u;
    })
    .filter((u) => u.hp > 0);

  let nextWorld = state.worldState;
  let nextRoads = state.roads ?? {};
  let nextResources = { ...state.resources };
  let nextDamagedHexes = { ...(state.damagedHexes ?? {}) };

  if (combat.consequence && combat.consequence.damagePct > 0) {
    nextDamagedHexes[targetKey] = {
      key: targetKey,
      q: to.q,
      r: to.r,
      damagePct: combat.consequence.damagePct,
      productionPenaltyPct: combat.consequence.productionPenaltyPct,
      defensePenalty: combat.consequence.defensePenalty,
      turnsRemaining: Math.max(2, Math.ceil(combat.consequence.damagePct / 12)),
      repairCost: combat.consequence.repairCost,
      reasonPt: combat.consequence.summaryPt,
      lastConflictTurn: state.turn,
    };
  }

  if (combat.capturedHex && targetTile) {
    nextWorld = {
      ...state.worldState,
      cash: state.worldState.cash + combat.lootGold,
      hexes: {
        ...state.worldState.hexes,
        [targetKey]: {
          ...targetTile,
          owner: 'player',
        },
      },
    };
    if (combat.consequence?.lootResources) {
      const loot = combat.consequence.lootResources;
      nextResources = {
        ...nextResources,
        wood: nextResources.wood + (loot.wood ?? 0),
        stone: nextResources.stone + (loot.stone ?? 0),
        food: nextResources.food + (loot.food ?? 0),
        ore: nextResources.ore + (loot.ore ?? 0),
        metal: nextResources.metal + (loot.metal ?? 0),
      };
    }
    if (nextRoads[targetKey] && nextRoads[targetKey].owner !== 'player') {
      nextRoads = { ...nextRoads };
      delete nextRoads[targetKey];
    }
  }

  const conflictDip = registerConflictInDiplomacyMap({
    diplomacyMap: dipMap,
    factions: state.factions,
    targetFactionId: targetOwner,
    turn: state.turn,
    attackerSide: 'player',
    reasonPt: combat.capturedHex
      ? 'Ofensiva e conquista de território.'
      : 'Assalto armado em fronteira.',
  });
  const nextFactions = syncFactionsFromDiplomacy(state.factions, conflictDip.nextMap);

  const baseTrade = state.interfactionTrade ?? createInitialInterfactionTradeState();
  const disrupted = disruptRoutesNearCoord(
    baseTrade,
    to,
    2,
    2,
    'Operações militares interromperam rota próxima ao fronte.'
  );
  const nextTrade = embargoFactionRoutes(
    disrupted.nextTradeState,
    targetOwner,
    true,
    'Guerra aberta bloqueou o comércio bilateral.'
  );

  const nextExpansions = combat.capturedHex
    ? (state.expansions ?? []).filter((e) => !(e.q === to.q && e.r === to.r))
    : state.expansions ?? [];

  let nextCities = state.cities ?? [];
  if (combat.capturedHex) {
    const citySync = syncAndEvolveCities({
      worldState: nextWorld,
      roads: nextRoads,
      existingCities: nextCities,
      playerCapital: state.playerCapital,
      population: state.population,
      unlockedTechs: state.research.unlocked,
      assets,
      underConstructionKeys: underKeys,
      hasFoodDeficit: (state.foodDeficitTurns ?? 0) > 0,
      turn: state.turn,
      worldSeed: state.worldSeed ?? nextWorld.seed,
    });
    nextCities = citySync.cities;
  }

  const nextState: KingdomState = {
    ...state,
    worldState: nextWorld,
    resources: nextResources,
    units: nextUnits,
    factions: nextFactions,
    expansions: nextExpansions,
    roads: nextRoads,
    cities: nextCities,
    diplomacyByFactionId: conflictDip.nextMap,
    interfactionTrade: nextTrade,
    damagedHexes: nextDamagedHexes,
  };

  return {
    nextState,
    acted: true,
    capturedKey: combat.capturedHex ? targetKey : undefined,
    messagePt: conflictDip.betrayedTreatyPt
      ? `${combat.summaryPt} (${conflictDip.betrayedTreatyPt}).`
      : combat.summaryPt,
  };
}

export function getKingdomDiplomacySummary(state: KingdomState): {
  evaluations: DiplomacyEvaluation[];
  activeWarsCount: number;
  tradePactCount: number;
  allianceCount: number;
} {
  const dipMap = getDiplomacyMapForState(state);
  const evaluations: DiplomacyEvaluation[] = state.factions.map((faction) => {
    const dip = dipMap[faction.id];
    const border = computeBorderPressureScore(state.worldState, faction);
    return {
      factionId: faction.id,
      factionNamePt: faction.namePt,
      stance: dip.stance,
      stanceLabelPt: getDiplomaticStanceLabelPt(dip.stance),
      trustScore: dip.trustScore,
      atWar: dip.atWar,
      borderFrictionScore: border.borderFrictionScore,
      tradeGoodwillScore: dip.tradeGoodwillScore,
      betrayalPenalty: dip.betrayalPenalty,
      treaties: dip.treaties,
      lastStanceReasonPt: dip.lastStanceReasonPt,
      recentHistory: dip.history.slice(0, 5),
    };
  });

  return {
    evaluations,
    activeWarsCount: evaluations.filter((e) => e.atWar).length,
    tradePactCount: evaluations.filter((e) => e.treaties.tradePact).length,
    allianceCount: evaluations.filter((e) => e.treaties.alliance).length,
  };
}

export function performDiplomacyAction(
  state: KingdomState,
  factionId: string,
  action: DiplomacyActionType,
  payload?: DiplomacyActionPayload
): { nextState: KingdomState; success: boolean; messagePt: string } {
  const target = state.factions.find((f) => f.id === factionId);
  if (!target) {
    return { nextState: state, success: false, messagePt: 'Facção não encontrada.' };
  }

  const dipMap = getDiplomacyMapForState(state);
  const currentDip = dipMap[factionId];
  const baseTrade = state.interfactionTrade ?? createInitialInterfactionTradeState();

  if (action === 'war') {
    const conflictDip = registerConflictInDiplomacyMap({
      diplomacyMap: dipMap,
      factions: state.factions,
      targetFactionId: target.id,
      turn: state.turn,
      attackerSide: 'player',
      reasonPt: 'Declaração formal de guerra.',
    });
    const nextFactions = syncFactionsFromDiplomacy(state.factions, conflictDip.nextMap);
    const nextTrade = embargoFactionRoutes(
      baseTrade,
      target.id,
      true,
      `Embargo automático após declaração de guerra a ${target.namePt}.`
    );

    return {
      nextState: {
        ...state,
        factions: nextFactions,
        diplomacyByFactionId: conflictDip.nextMap,
        interfactionTrade: nextTrade,
      },
      success: true,
      messagePt: conflictDip.betrayedTreatyPt
        ? `Guerra declarada contra ${target.namePt}! (${conflictDip.betrayedTreatyPt}).`
        : `Guerra declarada contra ${target.namePt}!`,
    };
  }

  if (action === 'truce') {
    const cost = 220;
    if (state.worldState.cash < cost) {
      return {
        nextState: state,
        success: false,
        messagePt: `Precisa de $${cost} para propor trégua.`,
      };
    }

    const boostedTrust = Math.max(-18, currentDip.trustScore + 15);
    let updatedDip: FactionDiplomacyState = {
      ...currentDip,
      atWar: false,
      trustScore: boostedTrust,
      treaties: {
        ...currentDip.treaties,
        truceTurnsRemaining: 5,
        embargoActive: false,
      },
      lastStanceReasonPt: 'Cessar-fogo de 5 turnos firmado.',
    };
    updatedDip = appendDiplomacyHistory(updatedDip, state.turn, 'Trégua de 5 turnos assinada', 15);
    updatedDip = recalculateFactionStance(updatedDip);
    if (updatedDip.stance === 'hostile') {
      updatedDip = { ...updatedDip, stance: 'wary' };
    }

    const nextMap = { ...dipMap, [target.id]: updatedDip };
    const nextFactions = syncFactionsFromDiplomacy(state.factions, nextMap).map((f) =>
      f.id === target.id ? { ...f, relation: 'truce' as const, truceTurnsRemaining: 5 } : f
    );
    const nextTrade = embargoFactionRoutes(baseTrade, target.id, false);

    return {
      nextState: {
        ...state,
        worldState: { ...state.worldState, cash: state.worldState.cash - cost },
        factions: nextFactions,
        diplomacyByFactionId: nextMap,
        interfactionTrade: nextTrade,
      },
      success: true,
      messagePt: `Trégua de 5 turnos firmada com ${target.namePt}.`,
    };
  }

  if (action === 'trade_pact') {
    const pactCost = 300;
    if (target.relation === 'hostile' || currentDip.atWar) {
      return {
        nextState: state,
        success: false,
        messagePt: 'Firme uma trégua antes de abrir acordo comercial.',
      };
    }
    if (state.worldState.cash < pactCost) {
      return {
        nextState: state,
        success: false,
        messagePt: `Precisa de $${pactCost} para abrir rota comercial.`,
      };
    }

    let updatedDip: FactionDiplomacyState = {
      ...currentDip,
      trustScore: Math.max(30, currentDip.trustScore + 20),
      tradeGoodwillScore: Math.min(35, currentDip.tradeGoodwillScore + 10),
      treaties: {
        ...currentDip.treaties,
        tradePact: true,
        embargoActive: false,
      },
      lastStanceReasonPt: 'Pacto comercial ativo reduz tarifas e fortalece confiança.',
    };
    updatedDip = appendDiplomacyHistory(updatedDip, state.turn, 'Pacto comercial firmado', 20);
    updatedDip = recalculateFactionStance(updatedDip);

    const nextMap = { ...dipMap, [target.id]: updatedDip };
    const nextFactions = syncFactionsFromDiplomacy(state.factions, nextMap).map((f) =>
      f.id === target.id ? { ...f, relation: 'trade_pact' as const } : f
    );

    return {
      nextState: {
        ...state,
        worldState: { ...state.worldState, cash: state.worldState.cash - pactCost },
        factions: nextFactions,
        diplomacyByFactionId: nextMap,
        interfactionTrade: embargoFactionRoutes(baseTrade, target.id, false),
      },
      success: true,
      messagePt: `Acordo comercial ativo com ${target.namePt} (+$20/turno)!`,
    };
  }

  if (action === 'peace_treaty') {
    const playerStrength =
      Object.values(state.worldState.hexes).filter((t) => t.owner === 'player').length * 3 +
      state.units.filter((u) => u.owner === 'player' && u.hp > 0).length * 8;
    const enemyStrength =
      Object.values(state.worldState.hexes).filter((t) => t.owner === target.id).length * 3 +
      state.units.filter((u) => u.owner === target.id && u.hp > 0).length * 8;
    const playerDominates = playerStrength >= enemyStrength * 1.25;
    const peaceCost = playerDominates ? 0 : 160;

    if (state.worldState.cash < peaceCost) {
      return {
        nextState: state,
        success: false,
        messagePt: `Precisa de $${peaceCost} para selar Tratado de Paz.`,
      };
    }

    const repPerTurn = playerDominates ? 25 : 0;
    const repTurns = playerDominates ? 4 : 0;
    const nextTrust = Math.max(-5, currentDip.trustScore + 28);
    let updatedDip: FactionDiplomacyState = {
      ...currentDip,
      atWar: false,
      trustScore: nextTrust,
      treaties: {
        ...currentDip.treaties,
        peaceTreatyTurns: 6,
        truceTurnsRemaining: Math.max(currentDip.treaties.truceTurnsRemaining, 5),
        warReparationsPerTurn: repPerTurn,
        reparationsDirection: repPerTurn > 0 ? 'player_receives' : null,
        reparationsTurnsRemaining: repTurns,
        embargoActive: false,
      },
      lastStanceReasonPt:
        repPerTurn > 0
          ? `Tratado de paz favorável com reparações (+$${repPerTurn}/turno).`
          : 'Tratado de paz formal restaurou relações diplomáticas.',
    };
    updatedDip = appendDiplomacyHistory(updatedDip, state.turn, 'Tratado de Paz assinado', 28);
    updatedDip = recalculateFactionStance(updatedDip);

    const nextMap = { ...dipMap, [target.id]: updatedDip };
    const nextFactions = syncFactionsFromDiplomacy(state.factions, nextMap);
    const nextTrade = embargoFactionRoutes(baseTrade, target.id, false);

    return {
      nextState: {
        ...state,
        worldState: { ...state.worldState, cash: state.worldState.cash - peaceCost },
        factions: nextFactions,
        diplomacyByFactionId: nextMap,
        interfactionTrade: nextTrade,
      },
      success: true,
      messagePt:
        repPerTurn > 0
          ? `Tratado de Paz firmado com ${target.namePt}! Reparações de +$${repPerTurn}/turno por ${repTurns} turnos.`
          : `Tratado de Paz firmado com ${target.namePt} (-$${peaceCost}).`,
    };
  }

  if (action === 'non_aggression') {
    if (currentDip.atWar || currentDip.stance === 'hostile') {
      return {
        nextState: state,
        success: false,
        messagePt: `Firme trégua ou tratado de paz antes de propor pacto de não agressão a ${target.namePt}.`,
      };
    }
    const cost = 140;
    if (state.worldState.cash < cost) {
      return {
        nextState: state,
        success: false,
        messagePt: `Precisa de $${cost} para pacto de não agressão.`,
      };
    }
    let updatedDip: FactionDiplomacyState = {
      ...currentDip,
      trustScore: currentDip.trustScore + 12,
      treaties: {
        ...currentDip.treaties,
        nonAggressionTurns: 8,
      },
      lastStanceReasonPt: 'Fronteiras estabilizadas por Pacto de Não Agressão.',
    };
    updatedDip = appendDiplomacyHistory(
      updatedDip,
      state.turn,
      'Pacto de Não Agressão firmado (8t)',
      12
    );
    updatedDip = recalculateFactionStance(updatedDip);

    const nextMap = { ...dipMap, [target.id]: updatedDip };
    return {
      nextState: {
        ...state,
        worldState: { ...state.worldState, cash: state.worldState.cash - cost },
        factions: syncFactionsFromDiplomacy(state.factions, nextMap),
        diplomacyByFactionId: nextMap,
      },
      success: true,
      messagePt: `Pacto de Não Agressão de 8 turnos assinado com ${target.namePt}.`,
    };
  }

  if (action === 'alliance') {
    if (currentDip.atWar) {
      return {
        nextState: state,
        success: false,
        messagePt: 'Não é possível formar aliança durante estado de guerra.',
      };
    }
    const eligibleByTreaties =
      currentDip.treaties.tradePact && currentDip.treaties.nonAggressionTurns > 0;
    if (currentDip.trustScore < 35 && !eligibleByTreaties) {
      return {
        nextState: state,
        success: false,
        messagePt: `Confiança insuficiente (${currentDip.trustScore}/35) para Aliança com ${target.namePt}.`,
      };
    }
    if (currentDip.betrayalPenalty <= -30) {
      return {
        nextState: state,
        success: false,
        messagePt: `${target.namePt} ainda desconfia de violações recentes de tratados.`,
      };
    }
    const cost = 350;
    if (state.worldState.cash < cost) {
      return {
        nextState: state,
        success: false,
        messagePt: `Precisa de $${cost} para selar Aliança formal.`,
      };
    }
    let updatedDip: FactionDiplomacyState = {
      ...currentDip,
      trustScore: Math.max(65, currentDip.trustScore + 22),
      treaties: {
        ...currentDip.treaties,
        alliance: true,
        nonAggressionTurns: Math.max(currentDip.treaties.nonAggressionTurns, 10),
        embargoActive: false,
      },
      lastStanceReasonPt: 'Aliança estratégica ativa garante cooperação militar e comercial.',
    };
    updatedDip = appendDiplomacyHistory(updatedDip, state.turn, 'Aliança formal selada', 22);
    updatedDip = recalculateFactionStance(updatedDip);

    const nextMap = { ...dipMap, [target.id]: updatedDip };
    return {
      nextState: {
        ...state,
        worldState: { ...state.worldState, cash: state.worldState.cash - cost },
        factions: syncFactionsFromDiplomacy(state.factions, nextMap),
        diplomacyByFactionId: nextMap,
        interfactionTrade: embargoFactionRoutes(baseTrade, target.id, false),
      },
      success: true,
      messagePt: `Aliança formal estabelecida com ${target.namePt}!`,
    };
  }

  if (action === 'resource_aid') {
    if (currentDip.atWar) {
      return {
        nextState: state,
        success: false,
        messagePt: 'Firme paz ou trégua antes de enviar ajuda de recursos.',
      };
    }
    const res = payload?.resource ?? 'food';
    const qty = Math.max(5, Math.min(40, Math.round(payload?.amount ?? 20)));
    if ((state.resources[res] ?? 0) < qty) {
      return {
        nextState: state,
        success: false,
        messagePt: `Estoque insuficiente de ${res} para enviar ${qty} unidades.`,
      };
    }
    const trustGain = Math.min(18, Math.max(6, Math.round(qty * 0.6)));
    let updatedDip: FactionDiplomacyState = {
      ...currentDip,
      trustScore: currentDip.trustScore + trustGain,
      tradeGoodwillScore: Math.min(35, currentDip.tradeGoodwillScore + Math.round(trustGain / 2)),
      lastStanceReasonPt: `Auxílio material (+${qty} ${res}) melhorou a relação bilateral.`,
    };
    updatedDip = appendDiplomacyHistory(
      updatedDip,
      state.turn,
      `Ajuda enviada (${qty} ${res})`,
      trustGain
    );
    updatedDip = recalculateFactionStance(updatedDip);

    const nextMap = { ...dipMap, [target.id]: updatedDip };
    const nextFactions = syncFactionsFromDiplomacy(state.factions, nextMap).map((f) =>
      f.id === target.id
        ? {
            ...f,
            resources: {
              ...f.resources,
              [res]: (f.resources[res] ?? 0) + qty,
            },
          }
        : f
    );

    return {
      nextState: {
        ...state,
        resources: {
          ...state.resources,
          [res]: Math.max(0, state.resources[res] - qty),
        },
        factions: nextFactions,
        diplomacyByFactionId: nextMap,
      },
      success: true,
      messagePt: `Ajuda de ${qty} ${res} enviada a ${target.namePt} (+${trustGain} confiança).`,
    };
  }

  // territorial_concession
  const playerTiles = Object.values(state.worldState.hexes).filter((t) => {
    if (t.owner !== 'player') return false;
    if (state.playerCapital && t.q === state.playerCapital.q && t.r === state.playerCapital.r) {
      return false;
    }
    return true;
  });
  if (playerTiles.length <= 1) {
    return {
      nextState: state,
      success: false,
      messagePt: 'Não há território periférico disponível para concessão.',
    };
  }

  const chosenTile = payload?.coord
    ? playerTiles.find((t) => t.q === payload.coord!.q && t.r === payload.coord!.r)
    : playerTiles
        .slice()
        .sort(
          (a, b) =>
            axialDistance(a, target.capitalCoord) - axialDistance(b, target.capitalCoord)
        )[0];

  if (!chosenTile) {
    return {
      nextState: state,
      success: false,
      messagePt: 'Hexágono escolhido não pode ser cedido (não pertence ao jogador ou é a capital).',
    };
  }

  const chosenKey = hexKey(chosenTile.q, chosenTile.r);
  const nextWorld: HexWorldState = {
    ...state.worldState,
    hexes: {
      ...state.worldState.hexes,
      [chosenKey]: {
        ...chosenTile,
        owner: target.id,
      },
    },
  };

  let updatedDip: FactionDiplomacyState = {
    ...currentDip,
    atWar: false,
    trustScore: currentDip.trustScore + 28,
    treaties: {
      ...currentDip.treaties,
      peaceTreatyTurns: Math.max(currentDip.treaties.peaceTreatyTurns, 6),
      truceTurnsRemaining: Math.max(currentDip.treaties.truceTurnsRemaining, 5),
      embargoActive: false,
    },
    lastStanceReasonPt: `Concessão territorial em (${chosenTile.q},${chosenTile.r}) trouxe distensão.`,
  };
  updatedDip = appendDiplomacyHistory(
    updatedDip,
    state.turn,
    `Concessão territorial (${chosenTile.q},${chosenTile.r})`,
    28
  );
  updatedDip = recalculateFactionStance(updatedDip);

  const nextMap = { ...dipMap, [target.id]: updatedDip };
  const nextConstructions = state.constructions.filter(
    (c) => !(c.q === chosenTile.q && c.r === chosenTile.r)
  );
  const nextExpansions = (state.expansions ?? []).filter(
    (e) => !(e.q === chosenTile.q && e.r === chosenTile.r)
  );

  return {
    nextState: {
      ...state,
      worldState: nextWorld,
      constructions: nextConstructions,
      expansions: nextExpansions,
      factions: syncFactionsFromDiplomacy(state.factions, nextMap),
      diplomacyByFactionId: nextMap,
      interfactionTrade: embargoFactionRoutes(baseTrade, target.id, false),
    },
    success: true,
    messagePt: `Território (${chosenTile.q},${chosenTile.r}) cedido a ${target.namePt} (+28 confiança).`,
  };
}

export function repairDamagedHexInKingdom(
  state: KingdomState,
  q: number,
  r: number
): { nextState: KingdomState; repaired: boolean; messagePt: string } {
  const key = hexKey(q, r);
  const tile = state.worldState.hexes[key];
  const record = state.damagedHexes?.[key];
  if (!tile || tile.owner !== 'player') {
    return {
      nextState: state,
      repaired: false,
      messagePt: 'Selecione um hexágono sob seu controle para reparar.',
    };
  }
  if (!record) {
    return {
      nextState: state,
      repaired: false,
      messagePt: 'Este setor não possui danos estruturais pendentes.',
    };
  }

  const afford = canAffordCost(state.worldState.cash, state.resources, record.repairCost);
  if (!afford.affordable) {
    return {
      nextState: state,
      repaired: false,
      messagePt: afford.missingLabelPt ?? 'Recursos insuficientes para reconstrução.',
    };
  }

  const nextDamagedHexes = repairDamagedTileRecord(state.damagedHexes, q, r);
  return {
    nextState: {
      ...state,
      worldState: {
        ...state.worldState,
        cash: state.worldState.cash - record.repairCost.gold,
      },
      resources: {
        ...state.resources,
        wood: Math.max(0, state.resources.wood - record.repairCost.wood),
        stone: Math.max(0, state.resources.stone - record.repairCost.stone),
        food: Math.max(0, state.resources.food - record.repairCost.food),
        ore: Math.max(0, state.resources.ore - record.repairCost.ore),
        metal: Math.max(0, state.resources.metal - record.repairCost.metal),
      },
      damagedHexes: nextDamagedHexes,
    },
    repaired: true,
    messagePt: `Setor (${q},${r}) reconstruído! Produção e defesa locais restauradas.`,
  };
}

export function getKingdomMilitaryLogistics(
  state: KingdomState,
  assets: HexAssetEntry[]
): ArmyLogisticsSummary {
  const dipMap = getDiplomacyMapForState(state);
  const alliedOwners = new Set<HexOwner>();
  for (const [fId, d] of Object.entries(dipMap)) {
    if (d.stance === 'allied' || d.stance === 'friendly') {
      alliedOwners.add(fId as HexOwner);
    }
  }
  return evaluateFactionLogistics({
    worldState: state.worldState,
    units: state.units,
    assets,
    owner: 'player',
    unlockedTechs: state.research.unlocked,
    roads: state.roads ?? {},
    connectivity: getKingdomRoadSummary(state, assets),
    underConstructionKeys: getUnderConstructionKeys(state),
    capitalCoord: state.playerCapital,
    foodDeficitTurns: state.foodDeficitTurns ?? 0,
    alliedOwners,
  });
}

export function getKingdomMilitaryIntelligence(
  state: KingdomState,
  assets: HexAssetEntry[]
): Record<string, FactionMilitaryIntelligence> {
  const dipMap = getDiplomacyMapForState(state);
  const relMap: Partial<Record<HexOwner, FactionRelation | 'allied' | 'friendly'>> = {};
  for (const f of state.factions) {
    const dip = dipMap[f.id];
    relMap[f.id] = dip?.stance === 'allied'
      ? 'allied'
      : dip?.stance === 'friendly'
        ? 'friendly'
        : f.relation;
  }
  return computeMilitaryIntelligence({
    worldState: state.worldState,
    units: state.units,
    assets,
    playerTechs: state.research.unlocked,
    factions: state.factions,
    diplomacyRelations: relMap,
    underConstructionKeys: getUnderConstructionKeys(state),
    damagedHexes: state.damagedHexes,
  });
}

export function getKingdomHexFortification(
  state: KingdomState,
  q: number,
  r: number,
  assets: HexAssetEntry[]
): FortificationReport {
  const tile = state.worldState.hexes[hexKey(q, r)];
  const owner = tile?.owner ?? 'player';
  const techs =
    owner === 'player'
      ? state.research.unlocked
      : (state.factions.find((f) => f.id === owner)?.unlockedTechs ?? []);
  return evaluateHexFortification({
    worldState: state.worldState,
    q,
    r,
    units: state.units,
    assets,
    defenderTechs: techs,
    underConstructionKeys: getUnderConstructionKeys(state),
    damagedHexes: state.damagedHexes,
  });
}

export function getKingdomInterfactionTradeSummary(
  state: KingdomState,
  assets: HexAssetEntry[]
): InterfactionMarketSnapshot {
  const econ = getKingdomEconomy(state, assets);
  const dipMap = getDiplomacyMapForState(state);
  const dipCtx = buildDiplomacyTradeContextMap(dipMap, state.factions);
  const calendar = state.calendar ?? computeCalendarSnapshot(state.turn);
  return getInterfactionTradeSummary({
    tradeState: state.interfactionTrade ?? createInitialInterfactionTradeState(),
    worldState: state.worldState,
    assets,
    playerResources: state.resources,
    playerEconomy: econ,
    playerCaps: econ.storageCaps,
    factions: state.factions,
    unlockedTechs: state.research.unlocked,
    diplomacyByFactionId: dipCtx,
    underConstructionKeys: getUnderConstructionKeys(state),
    roadConnectivity: econ.roadConnectivity,
    roads: state.roads ?? {},
    season: calendar.season,
    weather: state.climateWeather,
  });
}

export function openTradeRouteInKingdom(
  state: KingdomState,
  params: {
    partnerFactionId: HexOwner;
    mode: RouteTransportMode;
    exportResource: TradableResource | null;
    exportAmount?: number;
    importResource: TradableResource | null;
    importAmount?: number;
  },
  assets: HexAssetEntry[]
): {
  nextState: KingdomState;
  routeId: string | null;
  success: boolean;
  messagePt: string;
} {
  const dipMap = getDiplomacyMapForState(state);
  const dipCtx = buildDiplomacyTradeContextMap(dipMap, state.factions);
  const roadConn = getKingdomRoadSummary(state, assets);
  const result = openInternationalRoute({
    tradeState: state.interfactionTrade ?? createInitialInterfactionTradeState(),
    worldState: state.worldState,
    assets,
    units: state.units,
    unlockedTechs: state.research.unlocked,
    factions: state.factions,
    partnerFactionId: params.partnerFactionId,
    mode: params.mode,
    exportResource: params.exportResource,
    exportAmount: params.exportAmount,
    importResource: params.importResource,
    importAmount: params.importAmount,
    playerCapital: state.playerCapital ?? { q: 0, r: 0 },
    currentTurn: state.turn,
    diplomacy: dipCtx[params.partnerFactionId],
    underConstructionKeys: getUnderConstructionKeys(state),
    roadConnectivity: roadConn,
    roads: state.roads ?? {},
  });

  if (!result.success) {
    return {
      nextState: state,
      routeId: null,
      success: false,
      messagePt: result.messagePt,
    };
  }

  return {
    nextState: {
      ...state,
      interfactionTrade: result.nextTradeState,
    },
    routeId: result.route?.id ?? null,
    success: true,
    messagePt: result.messagePt,
  };
}

export function closeTradeRouteInKingdom(
  state: KingdomState,
  routeId: string
): { nextState: KingdomState; closed: boolean; messagePt: string } {
  const res = closeInternationalRoute(
    state.interfactionTrade ?? createInitialInterfactionTradeState(),
    routeId
  );
  return {
    nextState: res.closed ? { ...state, interfactionTrade: res.nextTradeState } : state,
    closed: res.closed,
    messagePt: res.messagePt,
  };
}

export function tradeWithFactionInKingdom(
  state: KingdomState,
  params: {
    partnerFactionId: HexOwner;
    action: 'buy' | 'sell';
    resource: TradableResource;
    amount: number;
  },
  assets: HexAssetEntry[]
): {
  nextState: KingdomState;
  success: boolean;
  totalGold: number;
  messagePt: string;
} {
  const econ = getKingdomEconomy(state, assets);
  const dipMap = getDiplomacyMapForState(state);
  const dipCtx = buildDiplomacyTradeContextMap(dipMap, state.factions);
  const calendar = state.calendar ?? computeCalendarSnapshot(state.turn);

  const res = executeInternationalSpotTrade({
    worldState: state.worldState,
    assets,
    playerGold: state.worldState.cash,
    playerResources: state.resources,
    playerEconomy: econ,
    playerCaps: econ.storageCaps,
    factions: state.factions,
    partnerFactionId: params.partnerFactionId,
    action: params.action,
    resource: params.resource,
    amount: params.amount,
    unlockedTechs: state.research.unlocked,
    diplomacyByFactionId: dipCtx,
    underConstructionKeys: getUnderConstructionKeys(state),
    roadConnectivity: econ.roadConnectivity,
    roads: state.roads ?? {},
    season: calendar.season,
    weather: state.climateWeather,
  });

  if (!res.success) {
    return {
      nextState: state,
      success: false,
      totalGold: 0,
      messagePt: res.messagePt,
    };
  }

  const nextDipMap = { ...dipMap };
  const targetDip = nextDipMap[params.partnerFactionId];
  if (targetDip && res.goodwillGain > 0) {
    let updated = {
      ...targetDip,
      trustScore: targetDip.trustScore + res.goodwillGain,
      tradeGoodwillScore: Math.min(35, targetDip.tradeGoodwillScore + res.goodwillGain),
      lastStanceReasonPt: 'Intercâmbio comercial direto fortaleceu relações.',
    };
    updated = appendDiplomacyHistory(updated, state.turn, 'Negociação comercial direta', res.goodwillGain);
    nextDipMap[params.partnerFactionId] = recalculateFactionStance(updated);
  }

  return {
    nextState: {
      ...state,
      worldState: {
        ...state.worldState,
        cash: res.nextPlayerGold,
      },
      resources: res.nextPlayerResources,
      factions: syncFactionsFromDiplomacy(res.nextFactions, nextDipMap),
      diplomacyByFactionId: nextDipMap,
    },
    success: true,
    totalGold: res.totalGold,
    messagePt: res.messagePt,
  };
}

export function getKingdomVictoryProgress(
  state: KingdomState,
  assets: HexAssetEntry[]
): VictoryProgressSnapshot {
  const econ = getKingdomEconomy(state, assets);
  const dipMap = getDiplomacyMapForState(state);
  const diplomacySnapshots: VictoryDiplomacySnapshot[] = state.factions.map((f) => {
    const dip = dipMap[f.id];
    return {
      factionId: f.id,
      stance: dip.stance,
      trustScore: dip.trustScore,
      atWar: dip.atWar,
      hasTradePact: dip.treaties.tradePact || f.relation === 'trade_pact',
      hasNonAggression: dip.treaties.nonAggressionTurns > 0,
      hasAlliance: dip.treaties.alliance,
    };
  });

  return evaluateVictoryAndDefeat({
    turn: state.turn,
    worldState: state.worldState,
    assets,
    playerCapital: state.playerCapital,
    gold: state.worldState.cash,
    resources: state.resources,
    population: state.population,
    foodDeficitTurns: state.foodDeficitTurns ?? 0,
    unlockedTechs: state.research.unlocked,
    units: state.units,
    factions: state.factions,
    cities: state.cities ?? [],
    economy: econ,
    roadConnectivity: econ.roadConnectivity,
    roads: state.roads ?? {},
    diplomacySnapshots,
    tradeState: state.interfactionTrade ?? createInitialInterfactionTradeState(),
    underConstructionKeys: getUnderConstructionKeys(state),
    damagedHexes: state.damagedHexes,
    persistedState: state.victoryState,
    advanceStreaks: false,
  });
}

/**
 * Compatibility entry point retained for UI callers and older active-event saves.
 * Catalog choice IDs are resolved by Events Narrative 2.0 so consequences have
 * a single source of truth; unknown legacy IDs are left pending rather than lost.
 */
export function resolveKingdomEvent(
  state: KingdomState,
  choiceId: string,
  assets: HexAssetEntry[]
): { nextState: KingdomState; outcomePt: string } {
  const event = state.activeEvent;
  if (!event) return { nextState: state, outcomePt: '' };

  const economy = getKingdomEconomy(state, assets);
  const { military } = getKingdomProgression(state, assets);
  const resolution = resolveEventChoice(event, choiceId, {
    turn: state.turn,
    gold: state.worldState.cash,
    defensePower: military.defensePower,
  });
  if (!resolution.historyEntry.definitionId) {
    return { nextState: state, outcomePt: 'Escolha de evento desconhecida.' };
  }

  const addStock = (current: number, delta: number, cap: number) =>
    Math.min(cap, Math.max(0, Math.round(current + delta)));
  const nextResources: KingdomResources = {
    ...state.resources,
    food: addStock(state.resources.food, resolution.foodDelta, economy.storageCaps.food),
    wood: addStock(state.resources.wood, resolution.woodDelta, economy.storageCaps.wood),
    ore: addStock(state.resources.ore, resolution.oreDelta, economy.storageCaps.ore),
    stone: addStock(state.resources.stone, resolution.stoneDelta, economy.storageCaps.stone),
  };
  const nextResearch = resolution.scienceDelta > 0
    ? advanceResearchProgress(state.research, resolution.scienceDelta).nextResearch
    : state.research;
  const nextNarrative = applyResolutionToNarrative(
    state.narrativeState ?? createInitialNarrativeState(),
    resolution,
    state.turn
  );

  return {
    nextState: {
      ...state,
      worldState: {
        ...state.worldState,
        cash: Math.max(0, Math.round(state.worldState.cash + resolution.goldDelta)),
      },
      resources: nextResources,
      population: Math.max(4, Math.round(state.population + resolution.populationDelta)),
      research: nextResearch,
      activeEffects: [...state.activeEffects, ...resolution.effectsToAdd],
      activeEvent: null,
      eventHistory: [resolution.historyEntry, ...state.eventHistory].slice(0, 12),
      narrativeState: nextNarrative,
    },
    outcomePt: resolution.outcomePt,
  };
}

function normalizeDamagedHexesRecord(
  raw: unknown
): Record<string, DamagedHexRecord> {
  if (!raw || typeof raw !== 'object') return {};
  const result: Record<string, DamagedHexRecord> = {};
  for (const [key, item] of Object.entries(raw as Record<string, unknown>)) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    if (typeof r.q !== 'number' || typeof r.r !== 'number') continue;
    const damagePct = Math.max(0, Math.min(65, Math.round(Number(r.damagePct ?? 0) || 0)));
    if (damagePct <= 0) continue;
    const rawCost =
      r.repairCost && typeof r.repairCost === 'object'
        ? (r.repairCost as Record<string, unknown>)
        : {};
    result[key] = {
      key,
      q: Math.round(r.q),
      r: Math.round(r.r),
      damagePct,
      productionPenaltyPct: Math.max(
        0,
        Math.min(60, Math.round(Number(r.productionPenaltyPct ?? damagePct) || 0))
      ),
      defensePenalty: Math.max(0, Math.round(Number(r.defensePenalty ?? 0) || 0)),
      turnsRemaining: Math.max(1, Math.round(Number(r.turnsRemaining ?? 2) || 2)),
      repairCost: {
        gold: Math.max(0, Math.round(Number(rawCost.gold ?? 25) || 0)),
        wood: Math.max(0, Math.round(Number(rawCost.wood ?? 6) || 0)),
        stone: Math.max(0, Math.round(Number(rawCost.stone ?? 6) || 0)),
        food: Math.max(0, Math.round(Number(rawCost.food ?? 0) || 0)),
        ore: Math.max(0, Math.round(Number(rawCost.ore ?? 0) || 0)),
        metal: Math.max(0, Math.round(Number(rawCost.metal ?? 0) || 0)),
      },
      reasonPt:
        typeof r.reasonPt === 'string'
          ? r.reasonPt
          : 'Danos de combate em infraestrutura local.',
      lastConflictTurn: Math.max(0, Math.round(Number(r.lastConflictTurn ?? 1) || 1)),
    };
  }
  return result;
}

function advanceDiplomacyTurnStep(params: {
  worldState: HexWorldState;
  assets: HexAssetEntry[];
  units: UnitEntity[];
  playerUnlockedTechs: TechId[];
  playerGold: number;
  factions: FactionState[];
  diplomacyMap: Record<string, FactionDiplomacyState>;
  goodwillGainByFactionId: Record<string, number>;
  conqueredByAiKeys: string[];
  preTurnFactions: FactionState[];
  damagedHexes: Record<string, DamagedHexRecord>;
  tradeState: InterfactionTradeState;
  turn: number;
  underConstructionKeys: Set<string>;
}): {
  nextMap: Record<string, FactionDiplomacyState>;
  nextFactions: FactionState[];
  nextPlayerGold: number;
  nextDamagedHexes: Record<string, DamagedHexRecord>;
  nextTradeState: InterfactionTradeState;
  messagesPt: string[];
} {
  const {
    worldState,
    assets,
    units,
    playerUnlockedTechs,
    factions,
    goodwillGainByFactionId,
    conqueredByAiKeys,
    preTurnFactions,
    turn,
    underConstructionKeys,
  } = params;

  let nextGold = params.playerGold;
  const nextDamaged = { ...params.damagedHexes };
  let nextTrade = params.tradeState;
  const nextMap: Record<string, FactionDiplomacyState> = { ...params.diplomacyMap };
  const messagesPt: string[] = [];

  const workingFactions = factions.map((f) => ({
    ...f,
    resources: { ...f.resources },
  }));

  // 1. Handle AI-initiated hostilities or tile captures from processKingdomTurn
  for (const conqueredKey of conqueredByAiKeys) {
    const tile = worldState.hexes[conqueredKey];
    if (!tile) continue;
    const outcome = createConflictDamageForTile({
      tile,
      assets,
      captured: true,
      battleIntensity: 1.0,
      turn,
      defenderHasWallsOrEngineering: playerUnlockedTechs.includes('engineering'),
    });
    if (outcome.damagePct > 0) {
      nextDamaged[conqueredKey] = {
        key: conqueredKey,
        q: tile.q,
        r: tile.r,
        damagePct: outcome.damagePct,
        productionPenaltyPct: outcome.productionPenaltyPct,
        defensePenalty: outcome.defensePenalty,
        turnsRemaining: Math.max(2, Math.ceil(outcome.damagePct / 12)),
        repairCost: outcome.repairCost,
        reasonPt: outcome.summaryPt,
        lastConflictTurn: turn,
      };
    }
    const disrupted = disruptRoutesNearCoord(
      nextTrade,
      { q: tile.q, r: tile.r },
      2,
      2,
      'Ataque rival próximo às rotas comerciais.'
    );
    nextTrade = disrupted.nextTradeState;

    const tileOwner = tile.owner ?? 'neutral';
    if (tileOwner !== 'player' && tileOwner !== 'neutral' && nextMap[tileOwner]) {
      const reg = registerConflictInDiplomacyMap({
        diplomacyMap: nextMap,
        factions: workingFactions,
        targetFactionId: tileOwner,
        turn,
        attackerSide: 'faction',
        reasonPt: 'Ofensiva militar rival capturou território do jogador.',
      });
      Object.assign(nextMap, reg.nextMap);
      nextTrade = embargoFactionRoutes(
        nextTrade,
        tileOwner,
        true,
        'Ofensiva armada interrompeu intercâmbio comercial.'
      );
    }
  }

  // Detect any faction that switched to hostile in faction-engine without conquest
  for (const faction of workingFactions) {
    const prevF = preTurnFactions.find((pf) => pf.id === faction.id);
    const curDip = nextMap[faction.id];
    if (!curDip) continue;
    if (faction.relation === 'hostile' && prevF?.relation !== 'hostile' && !curDip.atWar) {
      let flipped: FactionDiplomacyState = {
        ...curDip,
        atWar: true,
        conflictCount: curDip.conflictCount + 1,
        turnsSinceLastConflict: 0,
        trustScore: Math.min(curDip.trustScore - 20, -38),
        treaties: {
          ...curDip.treaties,
          peaceTreatyTurns: 0,
          truceTurnsRemaining: 0,
          nonAggressionTurns: 0,
          tradePact: false,
          alliance: false,
          embargoActive: true,
        },
        lastStanceReasonPt: `${faction.namePt} rompeu a paz após tensões fronteiriças.`,
      };
      flipped = appendDiplomacyHistory(flipped, turn, 'Facção iniciou hostilidades', -20);
      nextMap[faction.id] = recalculateFactionStance(flipped);
      nextTrade = embargoFactionRoutes(nextTrade, faction.id, true);
      messagesPt.push(`${faction.namePt} declarou hostilidades!`);
    }
  }

  const playerPower = computeFactionMilitaryPower(
    worldState,
    units,
    assets,
    'player',
    playerUnlockedTechs,
    underConstructionKeys,
    nextDamaged
  );
  const playerTotal = playerPower.attackPower + playerPower.defensePower;

  // 2. Per-faction geopolitical update, treaties, reparations, and trade goodwill
  for (let i = 0; i < workingFactions.length; i++) {
    const faction = workingFactions[i];
    const current = nextMap[faction.id];
    if (!current) continue;

    const border = computeBorderPressureScore(worldState, faction);
    const factionPower = computeFactionMilitaryPower(
      worldState,
      units,
      assets,
      faction.id,
      faction.unlockedTechs,
      underConstructionKeys,
      nextDamaged
    );
    const factionTotal = Math.max(1, factionPower.attackPower + factionPower.defensePower);
    const militaryBalanceDelta = playerTotal - factionTotal;

    let treaties = { ...current.treaties };

    // War reparations settlement
    if (treaties.reparationsTurnsRemaining > 0 && treaties.warReparationsPerTurn > 0) {
      const amount = treaties.warReparationsPerTurn;
      if (treaties.reparationsDirection === 'player_receives') {
        const paid = Math.min(faction.cash, amount);
        faction.cash = Math.max(0, faction.cash - paid);
        nextGold += paid;
      } else if (treaties.reparationsDirection === 'player_pays') {
        const paid = Math.min(nextGold, amount);
        nextGold = Math.max(0, nextGold - paid);
        faction.cash += paid;
      }
      treaties.reparationsTurnsRemaining -= 1;
      if (treaties.reparationsTurnsRemaining === 0) {
        treaties.warReparationsPerTurn = 0;
        treaties.reparationsDirection = null;
      }
    }

    // Tick treaties countdown
    if (treaties.peaceTreatyTurns > 0) treaties.peaceTreatyTurns -= 1;
    if (treaties.nonAggressionTurns > 0) treaties.nonAggressionTurns -= 1;
    if (treaties.truceTurnsRemaining > 0) treaties.truceTurnsRemaining -= 1;

    const tradeGain = goodwillGainByFactionId[faction.id] ?? 0;
    const pactGain = treaties.tradePact ? 1 : 0;
    const allianceGain = treaties.alliance ? 2 : 0;
    const peaceGain = treaties.peaceTreatyTurns > 0 || treaties.nonAggressionTurns > 0 ? 1 : 0;

    // Border friction creates gentle downward drift when heavily crowded without non-aggression
    const borderDrift =
      border.borderFrictionScore <= -14 && treaties.nonAggressionTurns === 0 ? -1 : 0;
    // Military superiority intimidates expansionist hostiles gently or breeds caution if way stronger
    const powerDrift =
      faction.personality === 'expansionist' && militaryBalanceDelta > 20 && !current.atWar
        ? 1
        : 0;
    // War exhaustion reduces hostility very gradually after no new skirmish or sustains tension while warring
    const conflictDecay = current.atWar ? -1 : 1;

    const deltaTrust = tradeGain + pactGain + allianceGain + peaceGain + borderDrift + powerDrift + (current.atWar ? -1 : 0);
    const nextBetrayal = Math.min(0, current.betrayalPenalty + 1);
    const nextTradeGoodwill = Math.min(35, current.tradeGoodwillScore + tradeGain);

    // Check alliance abandonment risk if trust collapses below threshold
    let nextAlliance = treaties.alliance;
    let reasonPt = current.lastStanceReasonPt;
    if (nextAlliance && current.trustScore + deltaTrust < 25) {
      nextAlliance = false;
      messagesPt.push(`Aliança com ${faction.namePt} foi desfeita por perda de confiança.`);
      reasonPt = 'Aliança dissolvida após deterioração da confiança mútua.';
    } else if (tradeGain > 0) {
      reasonPt = `Comércio contínuo reforçou confiança (+${tradeGain}).`;
    } else if (border.nearCapitalCount > 0 && border.borderFrictionScore <= -12) {
      reasonPt = 'Expansão próxima à capital gera atrito fronteiriço.';
    }

    treaties.alliance = nextAlliance;

    let updated: FactionDiplomacyState = {
      ...current,
      turnsSinceLastConflict: current.atWar ? 0 : current.turnsSinceLastConflict + conflictDecay,
      borderFrictionScore: border.borderFrictionScore,
      tradeGoodwillScore: nextTradeGoodwill,
      militaryBalanceDelta,
      betrayalPenalty: nextBetrayal,
      trustScore: current.trustScore + deltaTrust,
      treaties,
      lastStanceReasonPt: reasonPt,
    };
    updated = recalculateFactionStance(updated);
    nextMap[faction.id] = updated;

    nextTrade = embargoFactionRoutes(
      nextTrade,
      faction.id,
      updated.atWar || updated.stance === 'hostile' || updated.treaties.embargoActive
    );
  }

  const syncedFactions = syncFactionsFromDiplomacy(workingFactions, nextMap);

  return {
    nextMap,
    nextFactions: syncedFactions,
    nextPlayerGold: nextGold,
    nextDamagedHexes: nextDamaged,
    nextTradeState: nextTrade,
    messagesPt,
  };
}

export function advanceKingdomTurn(
  state: KingdomState,
  assets: HexAssetEntry[]
): TurnAdvanceResult {
  if (state.activeEvent) {
    return {
      nextState: state,
      completedTech: null,
      completedBuildings: [],
      completedUpgrades: [],
      completedModules: [],
      incorporatedKeys: [],
      foundedCities: [],
      leveledUpCities: [],
      seasonChangedToPt: null,
      newEvent: null,
      conqueredByAiKeys: [],
      headlinePt: 'Resolva o evento ativo antes de avançar o turno.',
      blockedByActiveEvent: true,
    };
  }
  const working = state;

  const preDipMap = getDiplomacyMapForState(working);
  const preFactions = syncFactionsFromDiplomacy(working.factions, preDipMap);
  const warDamageSync = buildWarDamageSyncEffect(working);
  const cleanActiveEffects = (working.activeEffects ?? []).filter(
    (e) => e.id !== 'eff-war-damage-sync'
  );
  const preTurnPlayerKeys = new Set<string>(
    Object.values(working.worldState.hexes)
      .filter((t) => t.owner === 'player')
      .map((t) => hexKey(t.q, t.r))
  );

  const workingWithEffects: KingdomState = {
    ...working,
    factions: preFactions,
    diplomacyByFactionId: preDipMap,
    activeEffects: warDamageSync.effect
      ? [...cleanActiveEffects, warDamageSync.effect]
      : cleanActiveEffects,
  };

  const baseResult = processKingdomTurn(workingWithEffects, assets);
  const capturedFromPlayerKeys = baseResult.conqueredByAiKeys.filter((k) =>
    preTurnPlayerKeys.has(k)
  );
  let nextState: KingdomState = {
    ...baseResult.nextState,
    // Strip transient war-damage aggregator so saved activeEffects never accumulates duplicates
    activeEffects: (baseResult.nextState.activeEffects ?? []).filter(
      (e) => e.id !== 'eff-war-damage-sync'
    ),
    diplomacyByFactionId: preDipMap,
    interfactionTrade:
      working.interfactionTrade ?? createInitialInterfactionTradeState(),
    damagedHexes: working.damagedHexes ?? {},
    victoryState:
      working.victoryState ?? createInitialVictoryState(baseResult.nextState.factions),
  };

  const underKeys = getUnderConstructionKeys(nextState);
  const roadConn = getKingdomRoadSummary(nextState, assets);

  // Build owner lookup for military logistics & damage recovery
  const dipCtx = buildDiplomacyTradeContextMap(preDipMap, nextState.factions);
  const unlockedByOwner: Partial<Record<HexOwner, TechId[]>> = {
    player: nextState.research.unlocked,
  };
  const capitalByOwner: Partial<Record<HexOwner, AxialCoord>> = {
    player: nextState.playerCapital ?? { q: 0, r: 0 },
  };
  const foodDeficitByOwner: Partial<Record<HexOwner, number>> = {
    player: nextState.foodDeficitTurns ?? 0,
  };
  const alliedOwnersByOwner: Partial<Record<HexOwner, Set<HexOwner>>> = {
    player: new Set(
      Object.entries(preDipMap)
        .filter(([, d]) => d.stance === 'allied' || d.stance === 'friendly')
        .map(([id]) => id as HexOwner)
    ),
  };
  for (const f of nextState.factions) {
    unlockedByOwner[f.id] = f.unlockedTechs;
    capitalByOwner[f.id] = f.capitalCoord;
    foodDeficitByOwner[f.id] = f.foodDeficitTurns ?? 0;
  }

  // Military 2.0: Supply lines & attrition across units
  const supplyStep = applySupplyConsequencesToUnits({
    units: nextState.units,
    worldState: nextState.worldState,
    assets,
    unlockedTechsByOwner: unlockedByOwner,
    roads: nextState.roads ?? {},
    connectivity: roadConn,
    underConstructionKeys: underKeys,
    capitalByOwner,
    foodDeficitByOwner,
    alliedOwnersByOwner,
  });
  const playerExtraSupplyUpkeep = supplyStep.supplyExtraUpkeepByOwner.player ?? 0;
  const recoveredDamagedHexes = stepDamagedTilesRecovery(
    nextState.damagedHexes,
    (k) => {
      const owner = nextState.worldState.hexes[k]?.owner;
      if (!owner || owner === 'neutral') return false;
      if (owner === 'player') {
        return Object.values(preDipMap).some((d) => d.atWar);
      }
      return Boolean(preDipMap[owner]?.atWar);
    }
  );

  nextState = {
    ...nextState,
    units: supplyStep.units,
    worldState: {
      ...nextState.worldState,
      cash: Math.max(0, nextState.worldState.cash - playerExtraSupplyUpkeep),
    },
    damagedHexes: recoveredDamagedHexes,
  };

  // Interfaction Trade: Settle international routes
  const econForCaps = getKingdomEconomy(nextState, assets);
  const tradeStep = advanceInterfactionTradeTurn({
    tradeState: nextState.interfactionTrade ?? createInitialInterfactionTradeState(),
    worldState: nextState.worldState,
    assets,
    units: nextState.units,
    playerGold: nextState.worldState.cash,
    playerResources: nextState.resources,
    playerCaps: econForCaps.storageCaps,
    factions: nextState.factions,
    unlockedTechs: nextState.research.unlocked,
    currentTurn: nextState.turn,
    diplomacyByFactionId: dipCtx,
    underConstructionKeys: underKeys,
    roadConnectivity: econForCaps.roadConnectivity,
    roads: nextState.roads ?? {},
    season: nextState.calendar.season,
    weather: nextState.climateWeather,
  });

  nextState = {
    ...nextState,
    interfactionTrade: tradeStep.nextTradeState,
    resources: tradeStep.nextPlayerResources,
    worldState: {
      ...nextState.worldState,
      cash: tradeStep.nextPlayerGold,
    },
    factions: tradeStep.nextFactions,
  };

  // Diplomacy 2.0: Reparations, AI aggression sync, border pressure & trust updates
  const dipStep = advanceDiplomacyTurnStep({
    worldState: nextState.worldState,
    assets,
    units: nextState.units,
    playerUnlockedTechs: nextState.research.unlocked,
    playerGold: nextState.worldState.cash,
    factions: nextState.factions,
    diplomacyMap: preDipMap,
    goodwillGainByFactionId: tradeStep.goodwillGainByFactionId,
    conqueredByAiKeys: capturedFromPlayerKeys,
    preTurnFactions: preFactions,
    damagedHexes: nextState.damagedHexes ?? {},
    tradeState: nextState.interfactionTrade ?? createInitialInterfactionTradeState(),
    turn: nextState.turn,
    underConstructionKeys: underKeys,
  });

  nextState = {
    ...nextState,
    diplomacyByFactionId: dipStep.nextMap,
    factions: dipStep.nextFactions,
    worldState: {
      ...nextState.worldState,
      cash: dipStep.nextPlayerGold,
    },
    damagedHexes: dipStep.nextDamagedHexes,
    interfactionTrade: dipStep.nextTradeState,
  };

  // Victory / Defeat Evaluation with turn streak progression
  const finalEcon = getKingdomEconomy(nextState, assets);
  const victorySnapshots: VictoryDiplomacySnapshot[] = nextState.factions.map((f) => {
    const dip = dipStep.nextMap[f.id];
    return {
      factionId: f.id,
      stance: dip.stance,
      trustScore: dip.trustScore,
      atWar: dip.atWar,
      hasTradePact: dip.treaties.tradePact || f.relation === 'trade_pact',
      hasNonAggression: dip.treaties.nonAggressionTurns > 0,
      hasAlliance: dip.treaties.alliance,
    };
  });

  const victorySnap = evaluateVictoryAndDefeat({
    turn: nextState.turn,
    worldState: nextState.worldState,
    assets,
    playerCapital: nextState.playerCapital,
    gold: nextState.worldState.cash,
    resources: nextState.resources,
    population: nextState.population,
    foodDeficitTurns: nextState.foodDeficitTurns ?? 0,
    unlockedTechs: nextState.research.unlocked,
    units: nextState.units,
    factions: nextState.factions,
    cities: nextState.cities ?? [],
    economy: finalEcon,
    roadConnectivity: finalEcon.roadConnectivity,
    roads: nextState.roads ?? {},
    diplomacySnapshots: victorySnapshots,
    tradeState: nextState.interfactionTrade,
    underConstructionKeys: underKeys,
    damagedHexes: nextState.damagedHexes,
    persistedState: nextState.victoryState,
    advanceStreaks: true,
  });

  const extraHeadlines: string[] = [];
  if (tradeStep.nextTradeState.lastTurnSummaryPt) {
    extraHeadlines.push(tradeStep.nextTradeState.lastTurnSummaryPt);
  }
  if (supplyStep.attritionMessagesPt.length > 0) {
    extraHeadlines.push(supplyStep.attritionMessagesPt[0]);
  }
  if (dipStep.messagesPt.length > 0) {
    extraHeadlines.push(dipStep.messagesPt[0]);
  }
  if (victorySnap.status !== 'ongoing' && victorySnap.headlinePt) {
    extraHeadlines.push(victorySnap.headlinePt);
  } else if (victorySnap.activeWarningsPt.length > 0) {
    extraHeadlines.push(victorySnap.activeWarningsPt[0]);
  }

  const combinedHeadline =
    extraHeadlines.length > 0
      ? `${baseResult.headlinePt} · ${extraHeadlines.join(' ')}`
      : baseResult.headlinePt;

  nextState = {
    ...nextState,
    victoryState: victorySnap.persisted,
    lastTurnSummaryPt: combinedHeadline,
  };

  return {
    ...baseResult,
    nextState,
    headlinePt: combinedHeadline,
  };
}

export function serializeKingdomState(state: KingdomState): string {
  const calendar = state.calendar ?? computeCalendarSnapshot(state.turn);
  const dayPhase = state.dayPhase ?? getDayPhaseForTurn(state.turn);
  const climateWeather = state.climateWeather ?? createInitialClimateWeather();
  return JSON.stringify({
    version: 10,
    turn: state.turn,
    calendar,
    dayPhase,
    climateWeather,
    worldSeed: state.worldSeed ?? state.worldState.seed,
    playerCapital: state.playerCapital,
    seed: state.worldState.seed ?? state.worldSeed,
    worldCols: state.worldState.worldCols,
    worldRows: state.worldState.worldRows,
    cash: state.worldState.cash,
    structures: Object.values(state.worldState.hexes),
    resources: state.resources,
    population: state.population,
    foodDeficitTurns: state.foodDeficitTurns,
    research: state.research,
    units: state.units,
    factions: state.factions,
    constructions: state.constructions,
    expansions: state.expansions ?? [],
    roads: state.roads ?? {},
    cities: state.cities ?? [],
    activeEffects: state.activeEffects,
    activeEvent: state.activeEvent,
    eventHistory: state.eventHistory,
    narrativeState: state.narrativeState ?? createInitialNarrativeState(),
    diplomacyByFactionId: state.diplomacyByFactionId ?? createInitialDiplomacyMap(state.factions),
    interfactionTrade: state.interfactionTrade ?? createInitialInterfactionTradeState(),
    damagedHexes: state.damagedHexes ?? {},
    victoryState: state.victoryState ?? createInitialVictoryState(state.factions),
  });
}

export function deserializeKingdomState(
  raw: string,
  totalAssets: number
): KingdomState | null {
  const worldState = deserializeWorldState(raw, totalAssets);
  if (!worldState) return null;

  // Normalize & validate persisted building modules (supports tile.modules & legacy tile.meta.modules)
  for (const tile of Object.values(worldState.hexes)) {
    const validModules = getInstalledModules(tile);
    if (validModules.length > 0) {
      tile.modules = validModules;
      if (tile.meta) {
        tile.meta = { ...tile.meta, modules: validModules };
      }
    } else if (tile.modules !== undefined || tile.meta?.modules !== undefined) {
      delete tile.modules;
      if (tile.meta && 'modules' in tile.meta) {
        tile.meta = { ...tile.meta, modules: undefined };
      }
    }
  }

  try {
    const parsed = JSON.parse(raw) as Partial<KingdomState> & {
      version?: number;
      seed?: number;
    };
    const defaults = createInitialResources();
    const resources: KingdomResources =
      parsed.resources && typeof parsed.resources === 'object'
        ? {
            wood: Number(parsed.resources.wood ?? defaults.wood),
            stone: Number(parsed.resources.stone ?? defaults.stone),
            food: Number(parsed.resources.food ?? defaults.food),
            ore: Number(parsed.resources.ore ?? defaults.ore),
            metal: Number(parsed.resources.metal ?? defaults.metal),
            science: Number(parsed.resources.science ?? defaults.science),
          }
        : defaults;

    const factions =
      Array.isArray(parsed.factions) && parsed.factions.length > 0
        ? parsed.factions.map((f, idx) => normalizeFactionState(f, idx))
        : createInitialFactions();

    const constructions: ActiveConstruction[] = Array.isArray(parsed.constructions)
      ? parsed.constructions
          .filter(
            (c): c is ActiveConstruction =>
              Boolean(c) &&
              typeof c.q === 'number' &&
              typeof c.r === 'number' &&
              typeof c.turnsRemaining === 'number' &&
              c.turnsRemaining > 0 &&
              (c.kind !== 'module' ||
                (typeof c.moduleId === 'string' && isValidBuildingModuleId(c.moduleId)))
          )
          .map((c) => ({
            q: Math.round(c.q),
            r: Math.round(c.r),
            structureIndex: c.structureIndex,
            orientation: c.orientation,
            assetName: c.assetName,
            turnsRemaining: Math.max(1, Math.round(c.turnsRemaining)),
            totalTurns: Math.max(1, Math.round(c.totalTurns || c.turnsRemaining)),
            owner: typeof c.owner === 'string' && c.owner.trim() ? c.owner.trim() : 'player',
            kind:
              c.kind === 'upgrade'
                ? 'upgrade'
                : c.kind === 'module'
                  ? 'module'
                  : 'build',
            ...(typeof c.targetLevel === 'number' && c.targetLevel >= 2
              ? { targetLevel: Math.min(4, Math.round(c.targetLevel)) }
              : {}),
            ...(c.kind === 'module' &&
            typeof c.moduleId === 'string' &&
            isValidBuildingModuleId(c.moduleId)
              ? { moduleId: c.moduleId }
              : {}),
          }))
      : [];

    const expansions: ActiveExpansion[] = Array.isArray(parsed.expansions)
      ? parsed.expansions
          .filter(
            (e): e is ActiveExpansion =>
              Boolean(e) &&
              typeof e.q === 'number' &&
              typeof e.r === 'number' &&
              typeof e.turnsRemaining === 'number' &&
              e.turnsRemaining > 0
          )
          .map((e) => ({
            q: Math.round(e.q),
            r: Math.round(e.r),
            turnsRemaining: Math.max(1, Math.round(e.turnsRemaining)),
            totalTurns:
              typeof e.totalTurns === 'number' && e.totalTurns >= 1
                ? Math.round(e.totalTurns)
                : Math.max(1, Math.round(e.turnsRemaining)),
            workersCommitted:
              typeof e.workersCommitted === 'number' && e.workersCommitted >= 1
                ? Math.round(e.workersCommitted)
                : 1,
            owner: typeof e.owner === 'string' && e.owner.trim() ? e.owner.trim() : 'player',
          }))
      : [];

    const activeEffects: ActiveWorldEffect[] = Array.isArray(parsed.activeEffects)
      ? parsed.activeEffects.filter(
          (e): e is ActiveWorldEffect =>
            Boolean(e) && typeof e.id === 'string' && typeof e.turnsRemaining === 'number'
        )
      : [];

    let playerCapital: AxialCoord | undefined =
      parsed.playerCapital &&
      typeof parsed.playerCapital.q === 'number' &&
      typeof parsed.playerCapital.r === 'number'
        ? {
            q: Math.round(parsed.playerCapital.q),
            r: Math.round(parsed.playerCapital.r),
          }
        : undefined;

    if (!playerCapital) {
      const playerTiles = Object.values(worldState.hexes).filter(
        (t) => t.owner === 'player'
      );
      if (playerTiles.length > 0) {
        playerCapital = { q: playerTiles[0].q, r: playerTiles[0].r };
      }
    }

    const worldSeed =
      typeof parsed.worldSeed === 'number' && Number.isFinite(parsed.worldSeed)
        ? Math.round(parsed.worldSeed)
        : worldState.seed;

    const roads = normalizeRoadMap(parsed.roads, worldState);
    const cities = normalizeCities(
      parsed.cities,
      worldState,
      playerCapital,
      worldSeed ?? 42026
    );

    const turn = typeof parsed.turn === 'number' && parsed.turn >= 1 ? Math.round(parsed.turn) : 1;
    const calendar = normalizeCalendarSnapshot(parsed.calendar, turn);
    const dayPhase = isValidDayPhase(parsed.dayPhase)
      ? parsed.dayPhase
      : getDayPhaseForTurn(turn);
    const climateWeather = normalizeClimateWeather(parsed.climateWeather);
    const diplomacyByFactionId = normalizeDiplomacyMap(parsed.diplomacyByFactionId, factions);
    const syncedFactions = syncFactionsFromDiplomacy(factions, diplomacyByFactionId);
    const interfactionTrade = normalizeInterfactionTradeState(parsed.interfactionTrade);
    const damagedHexes = normalizeDamagedHexesRecord(parsed.damagedHexes);
    const victoryState = normalizeVictoryState(parsed.victoryState, syncedFactions);
    const cleanEffects = activeEffects.filter((e) => e.id !== 'eff-war-damage-sync');

    return {
      turn,
      calendar,
      dayPhase,
      climateWeather,
      ...(typeof worldSeed === 'number' ? { worldSeed } : {}),
      ...(playerCapital ? { playerCapital } : {}),
      worldState,
      resources,
      population:
        typeof parsed.population === 'number' && parsed.population >= 1
          ? Math.round(parsed.population)
          : 18,
      foodDeficitTurns:
        typeof parsed.foodDeficitTurns === 'number' && parsed.foodDeficitTurns >= 0
          ? Math.round(parsed.foodDeficitTurns)
          : 0,
      research:
        parsed.research && Array.isArray(parsed.research.unlocked)
          ? parsed.research
          : createInitialResearchState(),
      units: Array.isArray(parsed.units) ? parsed.units : [],
      factions: syncedFactions,
      constructions,
      expansions,
      roads,
      cities,
      activeEffects: cleanEffects,
      activeEvent: parsed.activeEvent ?? null,
      eventHistory: Array.isArray(parsed.eventHistory) ? parsed.eventHistory : [],
      narrativeState: parsed.narrativeState
        ? deserializeNarrativeState(JSON.stringify(parsed.narrativeState)) ?? createInitialNarrativeState()
        : createInitialNarrativeState(),
      lastTurnSummaryPt: null,
      diplomacyByFactionId,
      interfactionTrade,
      damagedHexes,
      victoryState,
    };
  } catch {
    return null;
  }
}
