import type { HexAssetEntry } from './godot-docs';
import { getBuildingLevel, getEffectiveBuildingStats } from './building-upgrade-engine';
import { getInstalledModules } from './building-modules-engine';
import type { SeasonId } from './calendar-engine';
import {
  type KingdomResources,
  type ResourceStorageCaps,
  type TurnProductionBreakdown,
} from './economy-engine';
import type { FactionState } from './faction-engine';
import {
  hasHexConstruction,
  hexKey,
  type AxialCoord,
  type HexOwner,
  type HexWorldState,
} from './hex-engine';
import {
  evaluateRouteMilitaryProtection,
  type UnitEntity,
} from './military-engine';
import type { RoadConnectivitySummary, RoadMap } from './road-engine';
import type { ActiveClimateWeather } from './season-engine';
import type { TechId } from './tech-engine';
import { axialDistance } from './territory-engine';
import type { MarketSupplyState, TradableResource } from './trade-engine';

export type TradeDiplomaticStance =
  | 'hostile'
  | 'wary'
  | 'neutral'
  | 'friendly'
  | 'allied';

export interface DiplomacyTradeContext {
  stance: TradeDiplomaticStance;
  hasTradePact: boolean;
  atWar: boolean;
  embargoed: boolean;
  trustScore: number;
}

export type RouteTransportMode = 'land' | 'maritime';

export type InternationalRouteStatus =
  | 'active'
  | 'disrupted'
  | 'embargoed'
  | 'suspended';

export interface InternationalTradeRoute {
  id: string;
  partnerFactionId: HexOwner;
  mode: RouteTransportMode;
  status: InternationalRouteStatus;
  exportResource: TradableResource | null;
  exportAmount: number;
  importResource: TradableResource | null;
  importAmount: number;
  establishedTurn: number;
  disruptedTurnsRemaining: number;
  pathCoords: AxialCoord[];
  connectivityScore: number;
  securityScore: number;
  tariffRatePct: number;
  totalValueTradedGold: number;
  successfulTurns: number;
  interruptionReasonPt: string | null;
}

export interface ResourceMarketBalance {
  resource: TradableResource;
  labelPt: string;
  stock: number;
  cap: number;
  netPerTurn: number;
  supplyState: MarketSupplyState;
  supplyLabelPt: string;
  /** -100 (critical shortage) .. +100 (deep surplus) */
  balanceScore: number;
}

export interface FactionResourceProfile {
  owner: HexOwner;
  namePt: string;
  cash: number;
  balances: Record<TradableResource, ResourceMarketBalance>;
  surplusResources: TradableResource[];
  scarceResources: TradableResource[];
}

export interface BilateralPriceQuote {
  resource: TradableResource;
  labelPt: string;
  partnerSupplyState: MarketSupplyState;
  playerSupplyState: MarketSupplyState;
  /** Gold cost per unit when the player imports from this faction */
  importUnitCostGold: number;
  /** Gold revenue per unit when the player exports to this faction */
  exportUnitRevenueGold: number;
  /** Effective bilateral tariff % applied */
  tariffPct: number;
  strategicFitLabelPt: string;
}

export interface TradeInfrastructureSummary {
  marketCount: number;
  portCount: number;
  dockCount: number;
  hasMaritimeCapability: boolean;
  hasLighthouse: boolean;
  hasExchangeOrTradeCenter: boolean;
  connectedCitiesCount: number;
  roadTileCount: number;
  landRouteCapacity: number;
  maritimeRouteCapacity: number;
  totalRouteCapacity: number;
  connectivityBonusPct: number;
  tariffDiscountPct: number;
  efficiencyBonusPct: number;
}

export interface PartnerTradeOverview {
  factionId: HexOwner;
  factionNamePt: string;
  stance: TradeDiplomaticStance;
  hasTradePact: boolean;
  tradeAllowed: boolean;
  blockedReasonPt: string | null;
  tariffRatePct: number;
  partnerProfile: FactionResourceProfile;
  quotes: BilateralPriceQuote[];
  activeRouteCount: number;
}

export interface InterfactionTradeState {
  routes: InternationalTradeRoute[];
  nextRouteSeq: number;
  totalExportGoldAllTime: number;
  totalImportSpendAllTime: number;
  totalTariffGoldAllTime: number;
  lastTurnNetGold: number;
  lastTurnSummaryPt: string | null;
}

export interface InterfactionMarketSnapshot {
  infrastructure: TradeInfrastructureSummary;
  playerProfile: FactionResourceProfile;
  partners: PartnerTradeOverview[];
  routes: InternationalTradeRoute[];
  activeRouteCount: number;
  disruptedRouteCount: number;
  embargoedRouteCount: number;
  projectedGoldPerTurn: number;
}

export interface InterfactionTradeTurnOutcome {
  nextTradeState: InterfactionTradeState;
  nextPlayerResources: KingdomResources;
  nextPlayerGold: number;
  nextFactions: FactionState[];
  goldDelta: number;
  tariffGoldCollected: number;
  resourceDeltas: Record<TradableResource, number>;
  goodwillGainByFactionId: Record<string, number>;
  messagesPt: string[];
}

export const TRADABLE_RESOURCES: readonly TradableResource[] = [
  'wood',
  'stone',
  'food',
  'ore',
  'metal',
] as const;

const RESOURCE_META: Record<
  TradableResource,
  { labelPt: string; basePrice: number; safeLowThreshold: number }
> = {
  wood: { labelPt: 'Madeira', basePrice: 8, safeLowThreshold: 22 },
  stone: { labelPt: 'Pedra', basePrice: 10, safeLowThreshold: 20 },
  food: { labelPt: 'Alimento', basePrice: 7, safeLowThreshold: 28 },
  ore: { labelPt: 'Minério', basePrice: 14, safeLowThreshold: 14 },
  metal: { labelPt: 'Metal', basePrice: 22, safeLowThreshold: 8 },
};

function isFinitePositive(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}

export function createInitialInterfactionTradeState(): InterfactionTradeState {
  return {
    routes: [],
    nextRouteSeq: 1,
    totalExportGoldAllTime: 0,
    totalImportSpendAllTime: 0,
    totalTariffGoldAllTime: 0,
    lastTurnNetGold: 0,
    lastTurnSummaryPt: null,
  };
}

export function normalizeInterfactionTradeState(
  raw: unknown
): InterfactionTradeState {
  if (!raw || typeof raw !== 'object') {
    return createInitialInterfactionTradeState();
  }
  const obj = raw as Record<string, unknown>;
  const rawRoutes = Array.isArray(obj.routes) ? obj.routes : [];
  const routes: InternationalTradeRoute[] = [];

  for (const item of rawRoutes) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    if (typeof r.id !== 'string' || typeof r.partnerFactionId !== 'string') continue;

    const exportRes =
      typeof r.exportResource === 'string' &&
      TRADABLE_RESOURCES.includes(r.exportResource as TradableResource)
        ? (r.exportResource as TradableResource)
        : null;
    const importRes =
      typeof r.importResource === 'string' &&
      TRADABLE_RESOURCES.includes(r.importResource as TradableResource)
        ? (r.importResource as TradableResource)
        : null;

    if (!exportRes && !importRes) continue;

    const mode: RouteTransportMode = r.mode === 'maritime' ? 'maritime' : 'land';
    const validStatuses: InternationalRouteStatus[] = [
      'active',
      'disrupted',
      'embargoed',
      'suspended',
    ];
    const status: InternationalRouteStatus = validStatuses.includes(
      r.status as InternationalRouteStatus
    )
      ? (r.status as InternationalRouteStatus)
      : 'active';

    const pathCoords: AxialCoord[] = Array.isArray(r.pathCoords)
      ? r.pathCoords
          .filter(
            (c): c is AxialCoord =>
              Boolean(c) &&
              typeof c === 'object' &&
              typeof (c as AxialCoord).q === 'number' &&
              typeof (c as AxialCoord).r === 'number'
          )
          .map((c) => ({ q: c.q, r: c.r }))
      : [];

    routes.push({
      id: r.id,
      partnerFactionId: r.partnerFactionId as HexOwner,
      mode,
      status,
      exportResource: exportRes,
      exportAmount: exportRes ? Math.max(1, Math.min(20, isFinitePositive(r.exportAmount))) : 0,
      importResource: importRes,
      importAmount: importRes ? Math.max(1, Math.min(20, isFinitePositive(r.importAmount))) : 0,
      establishedTurn: isFinitePositive(r.establishedTurn),
      disruptedTurnsRemaining: isFinitePositive(r.disruptedTurnsRemaining),
      pathCoords,
      connectivityScore: Math.max(0, Math.min(100, isFinitePositive(r.connectivityScore) || 50)),
      securityScore: Math.max(0, Math.min(100, isFinitePositive(r.securityScore) || 50)),
      tariffRatePct: Math.max(0, Math.min(45, isFinitePositive(r.tariffRatePct))),
      totalValueTradedGold: isFinitePositive(r.totalValueTradedGold),
      successfulTurns: isFinitePositive(r.successfulTurns),
      interruptionReasonPt:
        typeof r.interruptionReasonPt === 'string' ? r.interruptionReasonPt : null,
    });
  }

  return {
    routes,
    nextRouteSeq: Math.max(routes.length + 1, isFinitePositive(obj.nextRouteSeq) || 1),
    totalExportGoldAllTime: isFinitePositive(obj.totalExportGoldAllTime),
    totalImportSpendAllTime: isFinitePositive(obj.totalImportSpendAllTime),
    totalTariffGoldAllTime: isFinitePositive(obj.totalTariffGoldAllTime),
    lastTurnNetGold:
      typeof obj.lastTurnNetGold === 'number' && Number.isFinite(obj.lastTurnNetGold)
        ? Math.round(obj.lastTurnNetGold)
        : 0,
    lastTurnSummaryPt:
      typeof obj.lastTurnSummaryPt === 'string' ? obj.lastTurnSummaryPt : null,
  };
}

function getDefaultFactionCaps(faction: FactionState, worldState: HexWorldState): ResourceStorageCaps {
  let territoryCount = 0;
  for (const tile of Object.values(worldState.hexes)) {
    if (tile.owner === faction.id) territoryCount += 1;
  }
  const extraCap = Math.min(140, territoryCount * 12);
  return {
    wood: 100 + extraCap,
    stone: 100 + extraCap,
    food: 120 + extraCap + 20,
    ore: 80 + extraCap,
    metal: 60 + extraCap,
  };
}

function defaultDiplomacyContext(faction: FactionState): DiplomacyTradeContext {
  const relation = faction.relation;
  if (relation === 'hostile') {
    return {
      stance: 'hostile',
      hasTradePact: false,
      atWar: true,
      embargoed: true,
      trustScore: -55,
    };
  }
  if (relation === 'trade_pact') {
    return {
      stance: 'friendly',
      hasTradePact: true,
      atWar: false,
      embargoed: false,
      trustScore: 45,
    };
  }
  if (relation === 'truce') {
    return {
      stance: 'wary',
      hasTradePact: false,
      atWar: false,
      embargoed: false,
      trustScore: -10,
    };
  }
  return {
    stance: 'neutral',
    hasTradePact: false,
    atWar: false,
    embargoed: false,
    trustScore: 5,
  };
}

export function evaluateTradeInfrastructure(params: {
  worldState: HexWorldState;
  assets: HexAssetEntry[];
  unlockedTechs: TechId[];
  underConstructionKeys?: Set<string>;
  roadConnectivity?: RoadConnectivitySummary;
  roads?: RoadMap;
}): TradeInfrastructureSummary {
  const {
    worldState,
    assets,
    unlockedTechs,
    underConstructionKeys,
    roadConnectivity,
    roads,
  } = params;

  let marketCount = 0;
  let portCount = 0;
  let dockCount = 0;
  let hasLighthouse = false;
  let hasExchangeOrTradeCenter = false;
  let moduleTradeBonusPct = 0;
  let extraCapacity = 0;

  for (const tile of Object.values(worldState.hexes)) {
    if (tile.owner !== 'player' || !hasHexConstruction(tile, assets)) continue;
    const key = hexKey(tile.q, tile.r);
    if (underConstructionKeys?.has(key)) continue;

    const assetName = assets[tile.structureIndex]?.name ?? '';
    const level = getBuildingLevel(tile);
    const modules = getInstalledModules(tile);

    if (assetName === 'building-market') {
      marketCount += 1;
      extraCapacity += level >= 2 ? 1 : 0;
      if (modules.includes('market_expanded_stalls')) moduleTradeBonusPct += 5;
      if (modules.includes('market_exchange')) {
        moduleTradeBonusPct += 6;
        hasExchangeOrTradeCenter = true;
      }
      if (modules.includes('market_trade_center')) {
        moduleTradeBonusPct += 8;
        hasExchangeOrTradeCenter = true;
        extraCapacity += 1;
      }
    } else if (assetName === 'building-port') {
      portCount += 1;
      extraCapacity += 1;
      if (modules.includes('port_lighthouse')) hasLighthouse = true;
      if (modules.includes('port_expanded_dock')) {
        extraCapacity += 1;
        moduleTradeBonusPct += 6;
      }
      if (modules.includes('port_crane')) moduleTradeBonusPct += 4;
    } else if (assetName === 'building-dock') {
      dockCount += 1;
      if (modules.includes('port_lighthouse')) hasLighthouse = true;
      if (modules.includes('port_expanded_dock')) moduleTradeBonusPct += 5;
    }
  }

  const roadTileCount =
    roadConnectivity?.totalRoadTiles ?? (roads ? Object.keys(roads).length : 0);
  const connectedCitiesCount = roadConnectivity
    ? roadConnectivity.networks.filter((n) => n.connectedCityIds.length >= 2).length
    : 0;
  const maxRoadLevel = roadConnectivity?.maxConnectedRoadLevel ?? 0;

  const hasTradeTech = unlockedTechs.includes('trade');
  const hasMaritimeCapability = portCount > 0 || dockCount > 0;

  const landRouteCapacity =
    1 +
    Math.min(2, marketCount) +
    (hasTradeTech ? 1 : 0) +
    (roadTileCount >= 4 ? 1 : 0) +
    (connectedCitiesCount >= 1 ? 1 : 0);

  const maritimeRouteCapacity = hasMaritimeCapability
    ? portCount + (dockCount > 0 && portCount === 0 ? 1 : 0) + (hasTradeTech ? 1 : 0)
    : 0;

  const totalRouteCapacity = landRouteCapacity + maritimeRouteCapacity + Math.floor(extraCapacity / 2);

  const connectivityBonusPct = Math.min(
    40,
    marketCount * 6 +
      portCount * 7 +
      Math.min(10, roadTileCount * 2) +
      maxRoadLevel * 2 +
      connectedCitiesCount * 5
  );

  const tariffDiscountPct = Math.min(
    8,
    (hasTradeTech ? 3 : 0) +
      (hasExchangeOrTradeCenter ? 3 : 0) +
      (connectedCitiesCount >= 1 ? 2 : 0)
  );

  const efficiencyBonusPct = Math.min(
    45,
    connectivityBonusPct + moduleTradeBonusPct + (hasTradeTech ? 8 : 0)
  );

  return {
    marketCount,
    portCount,
    dockCount,
    hasMaritimeCapability,
    hasLighthouse,
    hasExchangeOrTradeCenter,
    connectedCitiesCount,
    roadTileCount,
    landRouteCapacity,
    maritimeRouteCapacity,
    totalRouteCapacity,
    connectivityBonusPct,
    tariffDiscountPct,
    efficiencyBonusPct,
  };
}

function classifySupplyState(params: {
  resource: TradableResource;
  stock: number;
  cap: number;
  netPerTurn: number;
}): {
  supplyState: MarketSupplyState;
  supplyLabelPt: string;
  balanceScore: number;
} {
  const { resource, stock, cap, netPerTurn } = params;
  const meta = RESOURCE_META[resource];
  const ratio = cap > 0 ? stock / cap : 0;

  let supplyState: MarketSupplyState = 'equilibrado';
  if (stock < meta.safeLowThreshold || (netPerTurn < 0 && ratio < 0.45)) {
    supplyState = 'escassez';
  } else if (ratio >= 0.52 || netPerTurn >= 6 || stock >= cap * 0.65) {
    supplyState = 'excedente';
  }

  const ratioScore = Math.round((ratio - 0.38) * 110);
  const netScore = Math.round(netPerTurn * 4);
  const balanceScore = Math.max(-100, Math.min(100, ratioScore + netScore));

  const supplyLabelPt =
    supplyState === 'escassez'
      ? 'Escassez'
      : supplyState === 'excedente'
        ? 'Excedente'
        : 'Equilibrado';

  return { supplyState, supplyLabelPt, balanceScore };
}

function estimateFactionNetPerTurn(
  faction: FactionState,
  worldState: HexWorldState,
  assets: HexAssetEntry[]
): Record<TradableResource, number> {
  const net: Record<TradableResource, number> = {
    wood: 2,
    stone: 1,
    food: Math.max(-3, 4 - Math.floor(faction.population / 4)),
    ore: 1,
    metal: 0,
  };

  for (const tile of Object.values(worldState.hexes)) {
    if (tile.owner !== faction.id || !hasHexConstruction(tile, assets)) continue;
    const assetName = assets[tile.structureIndex]?.name ?? '';
    const stats = getEffectiveBuildingStats(assetName, getBuildingLevel(tile));
    net.wood += Math.round(stats.production.wood ?? 0);
    net.stone += Math.round(stats.production.stone ?? 0);
    net.food += Math.round(stats.production.food ?? 0);
    net.ore += Math.round(stats.production.ore ?? 0);
    net.metal += Math.round(stats.production.metal ?? 0);
  }

  return net;
}

export function analyzeFactionResourceBalances(params: {
  worldState: HexWorldState;
  assets: HexAssetEntry[];
  playerResources: KingdomResources;
  playerEconomy?: TurnProductionBreakdown;
  playerCaps?: ResourceStorageCaps;
  factions: FactionState[];
}): {
  playerProfile: FactionResourceProfile;
  partnerProfilesById: Record<string, FactionResourceProfile>;
} {
  const { worldState, assets, playerResources, playerEconomy, playerCaps, factions } = params;

  const resolvedPlayerCaps: ResourceStorageCaps = playerCaps ??
    playerEconomy?.storageCaps ?? {
      wood: 100,
      stone: 100,
      food: 120,
      ore: 80,
      metal: 60,
    };

  const playerBalances = {} as Record<TradableResource, ResourceMarketBalance>;
  const playerSurplus: TradableResource[] = [];
  const playerScarce: TradableResource[] = [];

  for (const res of TRADABLE_RESOURCES) {
    const net =
      playerEconomy == null
        ? 0
        : res === 'wood'
          ? playerEconomy.woodNet
          : res === 'stone'
            ? playerEconomy.stoneNet
            : res === 'food'
              ? playerEconomy.foodNet
              : res === 'ore'
                ? playerEconomy.oreNet
                : playerEconomy.metalNet;

    const classified = classifySupplyState({
      resource: res,
      stock: playerResources[res],
      cap: resolvedPlayerCaps[res],
      netPerTurn: net,
    });

    playerBalances[res] = {
      resource: res,
      labelPt: RESOURCE_META[res].labelPt,
      stock: playerResources[res],
      cap: resolvedPlayerCaps[res],
      netPerTurn: net,
      ...classified,
    };
    if (classified.supplyState === 'excedente') playerSurplus.push(res);
    if (classified.supplyState === 'escassez') playerScarce.push(res);
  }

  const playerProfile: FactionResourceProfile = {
    owner: 'player',
    namePt: 'Reino do Jogador',
    cash: 0,
    balances: playerBalances,
    surplusResources: playerSurplus,
    scarceResources: playerScarce,
  };

  const partnerProfilesById: Record<string, FactionResourceProfile> = {};
  for (const faction of factions) {
    const caps = getDefaultFactionCaps(faction, worldState);
    const estNet = estimateFactionNetPerTurn(faction, worldState, assets);
    const balances = {} as Record<TradableResource, ResourceMarketBalance>;
    const surplusResources: TradableResource[] = [];
    const scarceResources: TradableResource[] = [];

    for (const res of TRADABLE_RESOURCES) {
      const classified = classifySupplyState({
        resource: res,
        stock: faction.resources[res] ?? 0,
        cap: caps[res],
        netPerTurn: estNet[res],
      });
      balances[res] = {
        resource: res,
        labelPt: RESOURCE_META[res].labelPt,
        stock: faction.resources[res] ?? 0,
        cap: caps[res],
        netPerTurn: estNet[res],
        ...classified,
      };
      if (classified.supplyState === 'excedente') surplusResources.push(res);
      if (classified.supplyState === 'escassez') scarceResources.push(res);
    }

    partnerProfilesById[faction.id] = {
      owner: faction.id,
      namePt: faction.namePt,
      cash: faction.cash,
      balances,
      surplusResources,
      scarceResources,
    };
  }

  return { playerProfile, partnerProfilesById };
}

export function computeBilateralTariffPct(params: {
  diplomacy: DiplomacyTradeContext;
  infrastructure: TradeInfrastructureSummary;
  factionPersonality: FactionState['personality'];
}): number {
  const { diplomacy, infrastructure, factionPersonality } = params;

  const baseByStance: Record<TradeDiplomaticStance, number> = {
    hostile: 40,
    wary: 18,
    neutral: 12,
    friendly: 6,
    allied: 2,
  };

  let tariff = baseByStance[diplomacy.stance] ?? 12;
  if (diplomacy.hasTradePact) tariff -= 5;
  if (factionPersonality === 'mercantile') tariff -= 2;
  tariff -= infrastructure.tariffDiscountPct;

  return Math.max(0, Math.min(35, Math.round(tariff)));
}

export function quoteBilateralResourcePrices(params: {
  playerProfile: FactionResourceProfile;
  partnerProfile: FactionResourceProfile;
  faction: FactionState;
  diplomacy: DiplomacyTradeContext;
  infrastructure: TradeInfrastructureSummary;
  season?: SeasonId | null;
  weather?: ActiveClimateWeather | null;
}): BilateralPriceQuote[] {
  const {
    playerProfile,
    partnerProfile,
    faction,
    diplomacy,
    infrastructure,
    season,
    weather,
  } = params;

  const tariffPct = computeBilateralTariffPct({
    diplomacy,
    infrastructure,
    factionPersonality: faction.personality,
  });
  const infraEffBonus = infrastructure.efficiencyBonusPct / 100;
  const pactPriceBonus = diplomacy.hasTradePact ? 0.08 : 0;
  const stanceFactor =
    diplomacy.stance === 'allied'
      ? 0.08
      : diplomacy.stance === 'friendly'
        ? 0.04
        : diplomacy.stance === 'wary'
          ? -0.08
          : 0;

  return TRADABLE_RESOURCES.map((res) => {
    const meta = RESOURCE_META[res];
    const pBal = partnerProfile.balances[res];
    const myBal = playerProfile.balances[res];

    const partnerDemandFactor =
      pBal.supplyState === 'escassez'
        ? 1.38
        : pBal.supplyState === 'excedente'
          ? 0.78
          : 1.0;

    const playerDemandFactor =
      myBal.supplyState === 'escassez'
        ? 1.2
        : myBal.supplyState === 'excedente'
          ? 0.88
          : 1.0;

    let seasonalFactor = 1.0;
    if (res === 'food' && season === 'winter') seasonalFactor *= 1.18;
    if (res === 'food' && weather?.id === 'drought_weather') seasonalFactor *= 1.22;
    if (res === 'wood' && weather?.id === 'frost') seasonalFactor *= 1.12;
    if (weather?.id === 'storm') seasonalFactor *= 1.08;

    const marketMid = meta.basePrice * partnerDemandFactor * seasonalFactor;

    const rawImportCost =
      marketMid *
      (1 + tariffPct / 100) *
      (1.12 - Math.min(0.18, infraEffBonus * 0.35 + (stanceFactor > 0 ? stanceFactor : 0))) *
      Math.max(0.9, playerDemandFactor * 0.15 + 0.85);

    const rawExportRevenue =
      marketMid *
      (1 - (tariffPct * 0.5) / 100) *
      (0.86 + Math.min(0.28, infraEffBonus * 0.4 + pactPriceBonus + Math.max(0, stanceFactor))) *
      (diplomacy.stance === 'wary' ? 0.88 : 1.0);

    const importUnitCostGold = Math.max(4, Math.round(rawImportCost));
    const exportUnitRevenueGold = Math.max(
      3,
      Math.min(importUnitCostGold - 1, Math.round(rawExportRevenue))
    );

    let strategicFitLabelPt = 'Troca neutra';
    if (myBal.supplyState === 'excedente' && pBal.supplyState === 'escassez') {
      strategicFitLabelPt = 'Alta oportunidade de exportação';
    } else if (myBal.supplyState === 'escassez' && pBal.supplyState === 'excedente') {
      strategicFitLabelPt = 'Boa fonte de importação';
    } else if (pBal.supplyState === 'escassez') {
      strategicFitLabelPt = 'Parceiro com demanda urgente';
    } else if (pBal.supplyState === 'excedente') {
      strategicFitLabelPt = 'Parceiro com oferta farta';
    }

    return {
      resource: res,
      labelPt: meta.labelPt,
      partnerSupplyState: pBal.supplyState,
      playerSupplyState: myBal.supplyState,
      importUnitCostGold,
      exportUnitRevenueGold,
      tariffPct,
      strategicFitLabelPt,
    };
  });
}

export function computeRoutePathCoords(params: {
  worldState: HexWorldState;
  from: AxialCoord;
  to: AxialCoord;
  roads?: RoadMap;
  assets?: HexAssetEntry[];
}): AxialCoord[] {
  const { worldState, from, to, roads, assets } = params;
  const maxSteps = Math.min(28, Math.max(2, axialDistance(from, to) + 4));
  const path: AxialCoord[] = [{ q: from.q, r: from.r }];
  const visited = new Set<string>([hexKey(from.q, from.r)]);
  let current: AxialCoord = { q: from.q, r: from.r };

  for (let step = 0; step < maxSteps; step++) {
    if (current.q === to.q && current.r === to.r) break;
    const dirs: AxialCoord[] = [
      { q: 1, r: -1 },
      { q: 0, r: -1 },
      { q: -1, r: 0 },
      { q: -1, r: 1 },
      { q: 0, r: 1 },
      { q: 1, r: 0 },
    ];
    let best: AxialCoord | null = null;
    let bestScore = Infinity;

    for (const d of dirs) {
      const nq = current.q + d.q;
      const nr = current.r + d.r;
      const k = hexKey(nq, nr);
      if (visited.has(k)) continue;
      const tile = worldState.hexes[k];
      if (!tile) continue;

      const dist = axialDistance({ q: nq, r: nr }, to);
      const hasRoad = Boolean(roads?.[k]);
      const assetName = assets ? assets[tile.structureIndex]?.name ?? '' : '';
      const isPort = assetName === 'building-port' || assetName === 'building-dock' || assetName === 'bridge';
      const bonus = (hasRoad ? -0.35 : 0) + (isPort ? -0.2 : 0) + (tile.owner === 'player' ? -0.1 : 0);
      const score = dist + bonus;
      if (score < bestScore) {
        bestScore = score;
        best = { q: nq, r: nr };
      }
    }

    if (!best) break;
    current = best;
    visited.add(hexKey(best.q, best.r));
    path.push(best);
  }

  return path;
}

function findBestTradeOriginCoord(params: {
  worldState: HexWorldState;
  assets: HexAssetEntry[];
  mode: RouteTransportMode;
  playerCapital: AxialCoord;
  targetCoord: AxialCoord;
}): AxialCoord {
  const { worldState, assets, mode, playerCapital, targetCoord } = params;
  let bestCoord = playerCapital;
  let bestScore = Infinity;

  for (const tile of Object.values(worldState.hexes)) {
    if (tile.owner !== 'player' || !hasHexConstruction(tile, assets)) continue;
    const name = assets[tile.structureIndex]?.name ?? '';
    const isTradeHub =
      mode === 'maritime'
        ? name === 'building-port' || name === 'building-dock'
        : name === 'building-market' || name === 'building-castle';
    if (!isTradeHub) continue;
    const dist = axialDistance(tile, targetCoord);
    const priority = name === 'building-port' || name === 'building-market' ? -2 : 0;
    if (dist + priority < bestScore) {
      bestScore = dist + priority;
      bestCoord = { q: tile.q, r: tile.r };
    }
  }

  return bestCoord;
}

export function canOpenInternationalRoute(params: {
  tradeState: InterfactionTradeState;
  worldState: HexWorldState;
  assets: HexAssetEntry[];
  unlockedTechs: TechId[];
  factions: FactionState[];
  partnerFactionId: HexOwner;
  mode: RouteTransportMode;
  exportResource: TradableResource | null;
  exportAmount: number;
  importResource: TradableResource | null;
  importAmount: number;
  diplomacy?: DiplomacyTradeContext;
  underConstructionKeys?: Set<string>;
  roadConnectivity?: RoadConnectivitySummary;
  roads?: RoadMap;
}): {
  ok: boolean;
  reasonPt: string | null;
  infrastructure: TradeInfrastructureSummary;
} {
  const {
    tradeState,
    worldState,
    assets,
    unlockedTechs,
    factions,
    partnerFactionId,
    mode,
    exportResource,
    exportAmount,
    importResource,
    importAmount,
    diplomacy,
    underConstructionKeys,
    roadConnectivity,
    roads,
  } = params;

  const infrastructure = evaluateTradeInfrastructure({
    worldState,
    assets,
    unlockedTechs,
    underConstructionKeys,
    roadConnectivity,
    roads,
  });

  const faction = factions.find((f) => f.id === partnerFactionId);
  if (!faction) {
    return { ok: false, reasonPt: 'Facção parceira não encontrada.', infrastructure };
  }

  const dip = diplomacy ?? defaultDiplomacyContext(faction);
  if (dip.atWar || dip.stance === 'hostile' || dip.embargoed) {
    return {
      ok: false,
      reasonPt: `Comércio embargado com ${faction.namePt} devido a hostilidade ou guerra.`,
      infrastructure,
    };
  }

  if (!exportResource && !importResource) {
    return {
      ok: false,
      reasonPt: 'Defina ao menos um recurso de exportação ou importação.',
      infrastructure,
    };
  }

  if (exportResource && (exportAmount < 1 || exportAmount > 15)) {
    return {
      ok: false,
      reasonPt: 'Volume de exportação deve ficar entre 1 e 15 unidades por turno.',
      infrastructure,
    };
  }
  if (importResource && (importAmount < 1 || importAmount > 15)) {
    return {
      ok: false,
      reasonPt: 'Volume de importação deve ficar entre 1 e 15 unidades por turno.',
      infrastructure,
    };
  }
  if (exportResource && importResource && exportResource === importResource) {
    return {
      ok: false,
      reasonPt: 'Exportação e importação na mesma rota devem ser recursos distintos.',
      infrastructure,
    };
  }

  const activeModeRoutes = tradeState.routes.filter(
    (r) => r.mode === mode && r.status !== 'embargoed'
  ).length;

  if (mode === 'maritime') {
    if (!infrastructure.hasMaritimeCapability) {
      return {
        ok: false,
        reasonPt: 'Construa um Porto ou Doca operacional para abrir rotas marítimas.',
        infrastructure,
      };
    }
    if (activeModeRoutes >= infrastructure.maritimeRouteCapacity) {
      return {
        ok: false,
        reasonPt: `Capacidade marítima esgotada (${activeModeRoutes}/${infrastructure.maritimeRouteCapacity}). Expanda portos ou pesquise Comércio.`,
        infrastructure,
      };
    }
  } else {
    if (activeModeRoutes >= infrastructure.landRouteCapacity) {
      return {
        ok: false,
        reasonPt: `Capacidade terrestre esgotada (${activeModeRoutes}/${infrastructure.landRouteCapacity}). Construa Mercados ou Estradas.`,
        infrastructure,
      };
    }
  }

  if (tradeState.routes.length >= infrastructure.totalRouteCapacity) {
    return {
      ok: false,
      reasonPt: `Limite logístico de rotas comerciais atingido (${tradeState.routes.length}/${infrastructure.totalRouteCapacity}).`,
      infrastructure,
    };
  }

  return { ok: true, reasonPt: null, infrastructure };
}

export function openInternationalRoute(params: {
  tradeState: InterfactionTradeState;
  worldState: HexWorldState;
  assets: HexAssetEntry[];
  units: UnitEntity[];
  unlockedTechs: TechId[];
  factions: FactionState[];
  partnerFactionId: HexOwner;
  mode: RouteTransportMode;
  exportResource: TradableResource | null;
  exportAmount?: number;
  importResource: TradableResource | null;
  importAmount?: number;
  playerCapital: AxialCoord;
  currentTurn: number;
  diplomacy?: DiplomacyTradeContext;
  underConstructionKeys?: Set<string>;
  roadConnectivity?: RoadConnectivitySummary;
  roads?: RoadMap;
}): {
  nextTradeState: InterfactionTradeState;
  route: InternationalTradeRoute | null;
  success: boolean;
  messagePt: string;
} {
  const exportAmount = params.exportResource ? Math.max(1, Math.round(params.exportAmount ?? 4)) : 0;
  const importAmount = params.importResource ? Math.max(1, Math.round(params.importAmount ?? 4)) : 0;

  const check = canOpenInternationalRoute({
    tradeState: params.tradeState,
    worldState: params.worldState,
    assets: params.assets,
    unlockedTechs: params.unlockedTechs,
    factions: params.factions,
    partnerFactionId: params.partnerFactionId,
    mode: params.mode,
    exportResource: params.exportResource,
    exportAmount,
    importResource: params.importResource,
    importAmount,
    diplomacy: params.diplomacy,
    underConstructionKeys: params.underConstructionKeys,
    roadConnectivity: params.roadConnectivity,
    roads: params.roads,
  });

  if (!check.ok) {
    return {
      nextTradeState: params.tradeState,
      route: null,
      success: false,
      messagePt: check.reasonPt ?? 'Não foi possível estabelecer rota comercial.',
    };
  }

  const faction = params.factions.find((f) => f.id === params.partnerFactionId)!;
  const diplomacy = params.diplomacy ?? defaultDiplomacyContext(faction);
  const originCoord = findBestTradeOriginCoord({
    worldState: params.worldState,
    assets: params.assets,
    mode: params.mode,
    playerCapital: params.playerCapital,
    targetCoord: faction.capitalCoord,
  });
  const pathCoords = computeRoutePathCoords({
    worldState: params.worldState,
    from: originCoord,
    to: faction.capitalCoord,
    roads: params.roads,
    assets: params.assets,
  });

  const protection = evaluateRouteMilitaryProtection({
    worldState: params.worldState,
    units: params.units,
    assets: params.assets,
    owner: 'player',
    pathCoords,
    underConstructionKeys: params.underConstructionKeys,
  });

  const roadHits = pathCoords.filter((c) => Boolean(params.roads?.[hexKey(c.q, c.r)])).length;
  const roadSharePct = pathCoords.length > 0 ? Math.round((roadHits / pathCoords.length) * 40) : 0;
  const connectivityScore = Math.min(
    100,
    35 + check.infrastructure.connectivityBonusPct + roadSharePct + (params.mode === 'maritime' ? 12 : 0)
  );

  const tariffRatePct = computeBilateralTariffPct({
    diplomacy,
    infrastructure: check.infrastructure,
    factionPersonality: faction.personality,
  });

  const seq = params.tradeState.nextRouteSeq;
  const route: InternationalTradeRoute = {
    id: `route-${faction.id}-${params.mode}-${seq}`,
    partnerFactionId: faction.id,
    mode: params.mode,
    status: 'active',
    exportResource: params.exportResource,
    exportAmount,
    importResource: params.importResource,
    importAmount,
    establishedTurn: params.currentTurn,
    disruptedTurnsRemaining: 0,
    pathCoords,
    connectivityScore,
    securityScore: protection.protectionScore,
    tariffRatePct,
    totalValueTradedGold: 0,
    successfulTurns: 0,
    interruptionReasonPt: null,
  };

  const modeLabel = params.mode === 'maritime' ? 'marítima' : 'terrestre';
  return {
    nextTradeState: {
      ...params.tradeState,
      routes: [...params.tradeState.routes, route],
      nextRouteSeq: seq + 1,
    },
    route,
    success: true,
    messagePt: `Rota comercial ${modeLabel} estabelecida com ${faction.namePt} (tarifa ${tariffRatePct}%, segurança ${protection.protectionScore}%).`,
  };
}

export function closeInternationalRoute(
  tradeState: InterfactionTradeState,
  routeId: string
): {
  nextTradeState: InterfactionTradeState;
  closed: boolean;
  messagePt: string;
} {
  const existing = tradeState.routes.find((r) => r.id === routeId);
  if (!existing) {
    return {
      nextTradeState: tradeState,
      closed: false,
      messagePt: 'Rota comercial não encontrada.',
    };
  }
  return {
    nextTradeState: {
      ...tradeState,
      routes: tradeState.routes.filter((r) => r.id !== routeId),
    },
    closed: true,
    messagePt: `Rota comercial ${existing.id} encerrada.`,
  };
}

export function disruptRoutesNearCoord(
  tradeState: InterfactionTradeState,
  coord: AxialCoord,
  radius: number,
  turns: number,
  reasonPt: string
): {
  nextTradeState: InterfactionTradeState;
  disruptedIds: string[];
} {
  const disruptedIds: string[] = [];
  const nextRoutes = tradeState.routes.map((route) => {
    if (route.status === 'embargoed') return route;
    const touches = route.pathCoords.some((c) => axialDistance(c, coord) <= radius);
    if (!touches) return route;
    disruptedIds.push(route.id);
    return {
      ...route,
      status: 'disrupted' as const,
      disruptedTurnsRemaining: Math.max(route.disruptedTurnsRemaining, turns),
      interruptionReasonPt: reasonPt,
    };
  });

  if (disruptedIds.length === 0) {
    return { nextTradeState: tradeState, disruptedIds: [] };
  }
  return {
    nextTradeState: {
      ...tradeState,
      routes: nextRoutes,
    },
    disruptedIds,
  };
}

export function embargoFactionRoutes(
  tradeState: InterfactionTradeState,
  factionId: HexOwner,
  embargoed: boolean,
  reasonPt?: string
): InterfactionTradeState {
  let changed = false;
  const nextRoutes = tradeState.routes.map((route) => {
    if (route.partnerFactionId !== factionId) return route;
    if (embargoed) {
      if (route.status === 'embargoed') return route;
      changed = true;
      return {
        ...route,
        status: 'embargoed' as const,
        interruptionReasonPt:
          reasonPt ?? 'Embargo comercial declarado pelo rompimento diplomático.',
      };
    } else if (route.status === 'embargoed') {
      changed = true;
      return {
        ...route,
        status: 'active' as const,
        disruptedTurnsRemaining: 0,
        interruptionReasonPt: null,
      };
    }
    return route;
  });

  if (!changed) return tradeState;
  return {
    ...tradeState,
    routes: nextRoutes,
  };
}

export function executeInternationalSpotTrade(params: {
  worldState: HexWorldState;
  assets: HexAssetEntry[];
  playerGold: number;
  playerResources: KingdomResources;
  playerEconomy?: TurnProductionBreakdown;
  playerCaps?: ResourceStorageCaps;
  factions: FactionState[];
  partnerFactionId: HexOwner;
  action: 'buy' | 'sell';
  resource: TradableResource;
  amount: number;
  unlockedTechs: TechId[];
  diplomacyByFactionId?: Partial<Record<string, DiplomacyTradeContext>>;
  underConstructionKeys?: Set<string>;
  roadConnectivity?: RoadConnectivitySummary;
  roads?: RoadMap;
  season?: SeasonId | null;
  weather?: ActiveClimateWeather | null;
}): {
  success: boolean;
  nextPlayerGold: number;
  nextPlayerResources: KingdomResources;
  nextFactions: FactionState[];
  totalGold: number;
  tariffGold: number;
  goodwillGain: number;
  messagePt: string;
} {
  const {
    worldState,
    assets,
    playerGold,
    playerResources,
    playerEconomy,
    playerCaps,
    factions,
    partnerFactionId,
    action,
    resource,
    amount,
    unlockedTechs,
    diplomacyByFactionId,
    underConstructionKeys,
    roadConnectivity,
    roads,
    season,
    weather,
  } = params;

  const qty = Math.max(1, Math.round(amount));
  const factionIdx = factions.findIndex((f) => f.id === partnerFactionId);
  if (factionIdx === -1) {
    return {
      success: false,
      nextPlayerGold: playerGold,
      nextPlayerResources: playerResources,
      nextFactions: factions,
      totalGold: 0,
      tariffGold: 0,
      goodwillGain: 0,
      messagePt: 'Facção parceira inválida para transação internacional.',
    };
  }

  const faction = factions[factionIdx];
  const diplomacy = diplomacyByFactionId?.[faction.id] ?? defaultDiplomacyContext(faction);
  if (diplomacy.atWar || diplomacy.stance === 'hostile' || diplomacy.embargoed) {
    return {
      success: false,
      nextPlayerGold: playerGold,
      nextPlayerResources: playerResources,
      nextFactions: factions,
      totalGold: 0,
      tariffGold: 0,
      goodwillGain: 0,
      messagePt: `${faction.namePt} recusou comércio: relações hostis ou embargo ativo.`,
    };
  }

  const infra = evaluateTradeInfrastructure({
    worldState,
    assets,
    unlockedTechs,
    underConstructionKeys,
    roadConnectivity,
    roads,
  });
  const { playerProfile, partnerProfilesById } = analyzeFactionResourceBalances({
    worldState,
    assets,
    playerResources,
    playerEconomy,
    playerCaps,
    factions,
  });
  const partnerProfile = partnerProfilesById[faction.id];
  const quotes = quoteBilateralResourcePrices({
    playerProfile,
    partnerProfile,
    faction,
    diplomacy,
    infrastructure: infra,
    season,
    weather,
  });
  const quote = quotes.find((q) => q.resource === resource)!;
  const resolvedPlayerCaps: ResourceStorageCaps = playerCaps ??
    playerEconomy?.storageCaps ?? {
      wood: 100,
      stone: 100,
      food: 120,
      ore: 80,
      metal: 60,
    };
  const partnerCaps = getDefaultFactionCaps(faction, worldState);

  if (action === 'buy') {
    const partnerStock = faction.resources[resource] ?? 0;
    if (partnerStock < qty) {
      return {
        success: false,
        nextPlayerGold: playerGold,
        nextPlayerResources: playerResources,
        nextFactions: factions,
        totalGold: 0,
        tariffGold: 0,
        goodwillGain: 0,
        messagePt: `${faction.namePt} possui apenas ${partnerStock} de ${quote.labelPt} disponíveis.`,
      };
    }
    const freeSpace = Math.max(0, resolvedPlayerCaps[resource] - playerResources[resource]);
    if (freeSpace < qty) {
      return {
        success: false,
        nextPlayerGold: playerGold,
        nextPlayerResources: playerResources,
        nextFactions: factions,
        totalGold: 0,
        tariffGold: 0,
        goodwillGain: 0,
        messagePt: `Armazém cheio para ${quote.labelPt} (espaço livre: ${freeSpace}).`,
      };
    }

    const totalGold = quote.importUnitCostGold * qty;
    if (playerGold < totalGold) {
      return {
        success: false,
        nextPlayerGold: playerGold,
        nextPlayerResources: playerResources,
        nextFactions: factions,
        totalGold: 0,
        tariffGold: 0,
        goodwillGain: 0,
        messagePt: `Ouro insuficiente para importar ${qty}x ${quote.labelPt} ($${totalGold}).`,
      };
    }

    const tariffGold = Math.round((totalGold * quote.tariffPct) / 100);
    const partnerProceeds = Math.max(1, totalGold - tariffGold);
    const nextFactions = factions.map((f, idx) =>
      idx === factionIdx
        ? {
            ...f,
            cash: f.cash + partnerProceeds,
            resources: {
              ...f.resources,
              [resource]: Math.max(0, (f.resources[resource] ?? 0) - qty),
            },
          }
        : f
    );

    return {
      success: true,
      nextPlayerGold: playerGold - totalGold,
      nextPlayerResources: {
        ...playerResources,
        [resource]: Math.min(resolvedPlayerCaps[resource], playerResources[resource] + qty),
      },
      nextFactions,
      totalGold,
      tariffGold,
      goodwillGain: Math.max(2, Math.min(8, Math.ceil(qty / 4) + 1)),
      messagePt: `Importado ${qty}x ${quote.labelPt} de ${faction.namePt} por $${totalGold} (tarifa ${quote.tariffPct}%).`,
    };
  }

  // action === 'sell'
  if (playerResources[resource] < qty) {
    return {
      success: false,
      nextPlayerGold: playerGold,
      nextPlayerResources: playerResources,
      nextFactions: factions,
      totalGold: 0,
      tariffGold: 0,
      goodwillGain: 0,
      messagePt: `${quote.labelPt} insuficiente em estoque para exportação.`,
    };
  }

  const totalGold = quote.exportUnitRevenueGold * qty;
  if (faction.cash < totalGold) {
    return {
      success: false,
      nextPlayerGold: playerGold,
      nextPlayerResources: playerResources,
      nextFactions: factions,
      totalGold: 0,
      tariffGold: 0,
      goodwillGain: 0,
      messagePt: `${faction.namePt} não tem tesouro suficiente ($${faction.cash}) para pagar $${totalGold}.`,
    };
  }

  const tariffGold = Math.round((totalGold * quote.tariffPct) / 100);
  const netGoldToPlayer = Math.max(1, totalGold + Math.round(tariffGold * 0.25));
  const nextPartnerStock = Math.min(
    partnerCaps[resource],
    (faction.resources[resource] ?? 0) + qty
  );

  const nextFactions = factions.map((f, idx) =>
    idx === factionIdx
      ? {
          ...f,
          cash: Math.max(0, f.cash - totalGold),
          resources: {
            ...f.resources,
            [resource]: nextPartnerStock,
          },
        }
      : f
  );

  return {
    success: true,
    nextPlayerGold: playerGold + netGoldToPlayer,
    nextPlayerResources: {
      ...playerResources,
      [resource]: Math.max(0, playerResources[resource] - qty),
    },
    nextFactions,
    totalGold: netGoldToPlayer,
    tariffGold,
    goodwillGain: Math.max(2, Math.min(8, Math.ceil(qty / 4) + 1)),
    messagePt: `Exportado ${qty}x ${quote.labelPt} para ${faction.namePt} por +$${netGoldToPlayer}.`,
  };
}

export function advanceInterfactionTradeTurn(params: {
  tradeState: InterfactionTradeState;
  worldState: HexWorldState;
  assets: HexAssetEntry[];
  units: UnitEntity[];
  playerGold: number;
  playerResources: KingdomResources;
  playerCaps: ResourceStorageCaps;
  factions: FactionState[];
  unlockedTechs: TechId[];
  currentTurn: number;
  diplomacyByFactionId?: Partial<Record<string, DiplomacyTradeContext>>;
  underConstructionKeys?: Set<string>;
  roadConnectivity?: RoadConnectivitySummary;
  roads?: RoadMap;
  season?: SeasonId | null;
  weather?: ActiveClimateWeather | null;
}): InterfactionTradeTurnOutcome {
  const {
    tradeState,
    worldState,
    assets,
    units,
    playerGold,
    playerResources,
    playerCaps,
    factions,
    unlockedTechs,
    diplomacyByFactionId,
    underConstructionKeys,
    roadConnectivity,
    roads,
    season,
    weather,
  } = params;

  const resourceDeltas: Record<TradableResource, number> = {
    wood: 0,
    stone: 0,
    food: 0,
    ore: 0,
    metal: 0,
  };

  if (tradeState.routes.length === 0) {
    return {
      nextTradeState: {
        ...tradeState,
        lastTurnNetGold: 0,
        lastTurnSummaryPt: null,
      },
      nextPlayerResources: playerResources,
      nextPlayerGold: playerGold,
      nextFactions: factions,
      goldDelta: 0,
      tariffGoldCollected: 0,
      resourceDeltas,
      goodwillGainByFactionId: {},
      messagesPt: [],
    };
  }

  let workingGold = playerGold;
  const workingRes: KingdomResources = { ...playerResources };
  const workingFactions: FactionState[] = factions.map((f) => ({
    ...f,
    resources: { ...f.resources },
  }));

  const infra = evaluateTradeInfrastructure({
    worldState,
    assets,
    unlockedTechs,
    underConstructionKeys,
    roadConnectivity,
    roads,
  });

  const { playerProfile, partnerProfilesById } = analyzeFactionResourceBalances({
    worldState,
    assets,
    playerResources: workingRes,
    playerCaps,
    factions: workingFactions,
  });

  let totalTurnGoldDelta = 0;
  let totalExportGold = 0;
  let totalImportSpend = 0;
  let totalTariffGold = 0;
  const goodwillGainByFactionId: Record<string, number> = {};
  const messagesPt: string[] = [];

  const nextRoutes: InternationalTradeRoute[] = [];

  for (const route of tradeState.routes) {
    const fIdx = workingFactions.findIndex((f) => f.id === route.partnerFactionId);
    if (fIdx === -1) continue;
    const faction = workingFactions[fIdx];
    const dip = diplomacyByFactionId?.[faction.id] ?? defaultDiplomacyContext(faction);

    const protection = evaluateRouteMilitaryProtection({
      worldState,
      units,
      assets,
      owner: 'player',
      pathCoords: route.pathCoords,
      underConstructionKeys,
    });

    const tariffRatePct = computeBilateralTariffPct({
      diplomacy: dip,
      infrastructure: infra,
      factionPersonality: faction.personality,
    });

    // Embargo during war / hostility
    if (dip.atWar || dip.stance === 'hostile' || dip.embargoed) {
      nextRoutes.push({
        ...route,
        status: 'embargoed',
        securityScore: protection.protectionScore,
        tariffRatePct,
        interruptionReasonPt: `Embargo ativo contra ${faction.namePt}.`,
      });
      continue;
    }

    // Disrupted route countdown
    if (route.status === 'disrupted' && route.disruptedTurnsRemaining > 0) {
      const rem = route.disruptedTurnsRemaining - 1;
      nextRoutes.push({
        ...route,
        status: rem === 0 ? 'active' : 'disrupted',
        disruptedTurnsRemaining: rem,
        securityScore: protection.protectionScore,
        tariffRatePct,
        interruptionReasonPt:
          rem === 0 ? null : route.interruptionReasonPt ?? 'Caravana em reconstrução após incidente.',
      });
      if (rem === 0) {
        messagesPt.push(`Rota comercial com ${faction.namePt} reestabelecida.`);
      }
      continue;
    }

    // Deterministic ambush / storm check
    const hostileUnitsNearby = units.some(
      (u) =>
        u.hp > 0 &&
        u.owner !== 'player' &&
        (u.owner === faction.id
          ? dip.stance === 'wary'
          : (diplomacyByFactionId?.[u.owner]?.atWar ?? false) ||
            (diplomacyByFactionId?.[u.owner]?.stance === 'hostile')) &&
        route.pathCoords.some((c) => axialDistance(c, u) <= 2)
    );

    const stormRiskMaritime =
      route.mode === 'maritime' &&
      weather?.id === 'storm' &&
      !infra.hasLighthouse &&
      protection.protectionScore < 60;

    if (hostileUnitsNearby && protection.protectionScore < 70) {
      nextRoutes.push({
        ...route,
        status: 'disrupted',
        disruptedTurnsRemaining: 1,
        securityScore: protection.protectionScore,
        tariffRatePct,
        interruptionReasonPt: 'Comboio interceptado por forças hostis sem escolta suficiente.',
      });
      messagesPt.push(
        `Rota ${route.mode === 'maritime' ? 'marítima' : 'terrestre'} para ${faction.namePt} interceptada por falta de escolta.`
      );
      continue;
    }

    if (stormRiskMaritime) {
      nextRoutes.push({
        ...route,
        status: 'disrupted',
        disruptedTurnsRemaining: 1,
        securityScore: protection.protectionScore,
        tariffRatePct,
        interruptionReasonPt: 'Tempestade interrompeu rota marítima (construa Farol no Porto).',
      });
      messagesPt.push(`Tempestade paralisou temporariamente rota marítima com ${faction.namePt}.`);
      continue;
    }

    const partnerCaps = getDefaultFactionCaps(faction, worldState);
    const partnerProfile = partnerProfilesById[faction.id];
    const quotes = quoteBilateralResourcePrices({
      playerProfile,
      partnerProfile,
      faction,
      diplomacy: dip,
      infrastructure: infra,
      season,
      weather,
    });

    let routeGoldDelta = 0;
    let routeTariff = 0;
    let routeVolumeGold = 0;
    let executedSomething = false;
    let suspendReason: string | null = null;

    // 1. Export player -> partner
    if (route.exportResource && route.exportAmount > 0) {
      const res = route.exportResource;
      const quote = quotes.find((q) => q.resource === res)!;
      const desiredQty = route.exportAmount;
      const availableQty = Math.min(desiredQty, workingRes[res]);

      if (availableQty <= 0) {
        suspendReason = `Sem estoque de ${quote.labelPt} para exportar.`;
      } else {
        const affordableByPartner = Math.floor(faction.cash / quote.exportUnitRevenueGold);
        const qty = Math.min(availableQty, Math.max(0, affordableByPartner));
        if (qty > 0) {
          const gross = qty * quote.exportUnitRevenueGold;
          const tariff = Math.round((gross * tariffRatePct) / 100);
          const escortBonus = protection.protectionScore >= 75 ? 2 : 0;
          const playerEarn = gross + escortBonus;

          workingRes[res] -= qty;
          resourceDeltas[res] -= qty;
          workingGold += playerEarn;
          faction.cash = Math.max(0, faction.cash - gross);
          faction.resources[res] = Math.min(
            partnerCaps[res],
            (faction.resources[res] ?? 0) + qty
          );

          routeGoldDelta += playerEarn;
          totalExportGold += playerEarn;
          routeTariff += tariff;
          routeVolumeGold += gross;
          executedSomething = true;
        } else {
          suspendReason = `${faction.namePt} sem ouro disponível para pagar a exportação.`;
        }
      }
    }

    // 2. Import partner -> player
    if (route.importResource && route.importAmount > 0) {
      const res = route.importResource;
      const quote = quotes.find((q) => q.resource === res)!;
      const partnerAvail = Math.min(route.importAmount, faction.resources[res] ?? 0);
      const playerSpace = Math.max(0, playerCaps[res] - workingRes[res]);
      const maxAffordable = Math.floor(workingGold / quote.importUnitCostGold);
      const qty = Math.min(partnerAvail, playerSpace, maxAffordable);

      if (qty > 0) {
        const spend = qty * quote.importUnitCostGold;
        const tariff = Math.round((spend * tariffRatePct) / 100);
        const partnerGain = Math.max(1, spend - tariff);

        faction.resources[res] = Math.max(0, (faction.resources[res] ?? 0) - qty);
        faction.cash += partnerGain;
        workingRes[res] = Math.min(playerCaps[res], workingRes[res] + qty);
        resourceDeltas[res] += qty;
        workingGold -= spend;

        routeGoldDelta -= spend;
        totalImportSpend += spend;
        routeTariff += tariff;
        routeVolumeGold += spend;
        executedSomething = true;
      } else if (!suspendReason) {
        suspendReason =
          playerSpace <= 0
            ? `Armazém cheio para importar ${quote.labelPt}.`
            : `${faction.namePt} sem excedente ou reino sem ouro para importar ${quote.labelPt}.`;
      }
    }

    // Diplomatic Pact Trade Efficiency Dividend
    if (executedSomething && dip.hasTradePact) {
      const dividend = 4 + Math.min(4, Math.floor(infra.connectivityBonusPct / 15));
      workingGold += dividend;
      routeGoldDelta += dividend;
      totalExportGold += dividend;
    }

    totalTurnGoldDelta += routeGoldDelta;
    totalTariffGold += routeTariff;

    if (executedSomething) {
      goodwillGainByFactionId[faction.id] =
        (goodwillGainByFactionId[faction.id] ?? 0) + (route.mode === 'maritime' ? 3 : 2);
      nextRoutes.push({
        ...route,
        status: 'active',
        disruptedTurnsRemaining: 0,
        securityScore: protection.protectionScore,
        tariffRatePct,
        totalValueTradedGold: route.totalValueTradedGold + routeVolumeGold,
        successfulTurns: route.successfulTurns + 1,
        interruptionReasonPt: suspendReason,
      });
    } else {
      nextRoutes.push({
        ...route,
        status: 'suspended',
        securityScore: protection.protectionScore,
        tariffRatePct,
        interruptionReasonPt: suspendReason ?? 'Rota aguardando saldo ou estoque.',
      });
    }
  }

  const activeRoutesDone = nextRoutes.filter((r) => r.status === 'active').length;
  const summaryPt =
    activeRoutesDone > 0
      ? `Comércio externo: ${activeRoutesDone} ${
          activeRoutesDone === 1 ? 'rota ativa' : 'rotas ativas'
        } (${totalTurnGoldDelta >= 0 ? '+' : ''}$${totalTurnGoldDelta} líquido).`
      : nextRoutes.length > 0
        ? 'Rotas comerciais externas pausadas por embargo, risco ou falta de carga.'
        : null;

  return {
    nextTradeState: {
      routes: nextRoutes,
      nextRouteSeq: tradeState.nextRouteSeq,
      totalExportGoldAllTime: tradeState.totalExportGoldAllTime + totalExportGold,
      totalImportSpendAllTime: tradeState.totalImportSpendAllTime + totalImportSpend,
      totalTariffGoldAllTime: tradeState.totalTariffGoldAllTime + totalTariffGold,
      lastTurnNetGold: totalTurnGoldDelta,
      lastTurnSummaryPt: summaryPt,
    },
    nextPlayerResources: workingRes,
    nextPlayerGold: Math.max(0, workingGold),
    nextFactions: workingFactions,
    goldDelta: totalTurnGoldDelta,
    tariffGoldCollected: totalTariffGold,
    resourceDeltas,
    goodwillGainByFactionId,
    messagesPt,
  };
}

export function getInterfactionTradeSummary(params: {
  tradeState: InterfactionTradeState;
  worldState: HexWorldState;
  assets: HexAssetEntry[];
  playerResources: KingdomResources;
  playerEconomy?: TurnProductionBreakdown;
  playerCaps?: ResourceStorageCaps;
  factions: FactionState[];
  unlockedTechs: TechId[];
  diplomacyByFactionId?: Partial<Record<string, DiplomacyTradeContext>>;
  underConstructionKeys?: Set<string>;
  roadConnectivity?: RoadConnectivitySummary;
  roads?: RoadMap;
  season?: SeasonId | null;
  weather?: ActiveClimateWeather | null;
}): InterfactionMarketSnapshot {
  const {
    tradeState,
    worldState,
    assets,
    playerResources,
    playerEconomy,
    playerCaps,
    factions,
    unlockedTechs,
    diplomacyByFactionId,
    underConstructionKeys,
    roadConnectivity,
    roads,
    season,
    weather,
  } = params;

  const infrastructure = evaluateTradeInfrastructure({
    worldState,
    assets,
    unlockedTechs,
    underConstructionKeys,
    roadConnectivity,
    roads,
  });

  const { playerProfile, partnerProfilesById } = analyzeFactionResourceBalances({
    worldState,
    assets,
    playerResources,
    playerEconomy,
    playerCaps,
    factions,
  });

  const partners: PartnerTradeOverview[] = factions.map((faction) => {
    const dip = diplomacyByFactionId?.[faction.id] ?? defaultDiplomacyContext(faction);
    const tariffRatePct = computeBilateralTariffPct({
      diplomacy: dip,
      infrastructure,
      factionPersonality: faction.personality,
    });
    const tradeAllowed = !dip.atWar && dip.stance !== 'hostile' && !dip.embargoed;
    const blockedReasonPt = tradeAllowed
      ? null
      : 'Relações hostis ou guerra bloqueiam negociações comerciais.';
    const partnerProfile = partnerProfilesById[faction.id];
    const quotes = quoteBilateralResourcePrices({
      playerProfile,
      partnerProfile,
      faction,
      diplomacy: dip,
      infrastructure,
      season,
      weather,
    });
    const activeRouteCount = tradeState.routes.filter(
      (r) => r.partnerFactionId === faction.id && r.status === 'active'
    ).length;

    return {
      factionId: faction.id,
      factionNamePt: faction.namePt,
      stance: dip.stance,
      hasTradePact: dip.hasTradePact,
      tradeAllowed,
      blockedReasonPt,
      tariffRatePct,
      partnerProfile,
      quotes,
      activeRouteCount,
    };
  });

  return {
    infrastructure,
    playerProfile,
    partners,
    routes: tradeState.routes,
    activeRouteCount: tradeState.routes.filter((r) => r.status === 'active').length,
    disruptedRouteCount: tradeState.routes.filter((r) => r.status === 'disrupted').length,
    embargoedRouteCount: tradeState.routes.filter((r) => r.status === 'embargoed').length,
    projectedGoldPerTurn: tradeState.lastTurnNetGold,
  };
}
