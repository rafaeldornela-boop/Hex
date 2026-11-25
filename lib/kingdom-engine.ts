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
  type ActiveKingdomEvent,
  type ActiveWorldEffect,
  type EventHistoryEntry,
} from './events-engine';
import {
  createInitialFactions,
  getTradePactBonusGold,
  normalizeFactionState,
  type FactionState,
} from './faction-engine';
import { processKingdomTurn } from './turn-engine';
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
  computeFactionMilitaryPower,
  getUnitAt,
  isAdjacentCoord,
  resolveHexCombat,
  type UnitEntity,
  type UnitType,
} from './military-engine';
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

export interface ActiveConstruction {
  q: number;
  r: number;
  structureIndex: number;
  orientation: number;
  assetName: string;
  turnsRemaining: number;
  totalTurns: number;
  owner: HexOwner;
}

export interface KingdomState {
  turn: number;
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
  activeEffects: ActiveWorldEffect[];
  activeEvent: ActiveKingdomEvent | null;
  eventHistory: EventHistoryEntry[];
  lastTurnSummaryPt: string | null;
}

export function getUnderConstructionKeys(state: KingdomState): Set<string> {
  return new Set(state.constructions.map((c) => hexKey(c.q, c.r)));
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

export function createStarterKingdomState(
  assets: HexAssetEntry[],
  seed: number = DEFAULT_WORLD_SEED
): KingdomState {
  const generated = generateProceduralKingdomWorld(assets, seed);

  return {
    turn: 1,
    worldSeed: generated.seed,
    playerCapital: generated.playerCapital,
    worldState: generated.worldState,
    resources: createInitialResources(),
    population: 18,
    foodDeficitTurns: 0,
    research: createInitialResearchState(),
    units: generated.units,
    factions: generated.factions,
    constructions: [],
    expansions: [],
    activeEffects: [],
    activeEvent: null,
    eventHistory: [],
    lastTurnSummaryPt: null,
  };
}

export function createSandboxKingdomState(): KingdomState {
  return {
    turn: 1,
    worldState: createEmptyWorldState(),
    resources: createInitialResources(),
    population: 8,
    foodDeficitTurns: 0,
    research: createInitialResearchState(),
    units: [],
    factions: createInitialFactions(),
    constructions: [],
    expansions: [],
    activeEffects: [],
    activeEvent: null,
    eventHistory: [],
    lastTurnSummaryPt: null,
  };
}

export function getKingdomEconomy(
  state: KingdomState,
  assets: HexAssetEntry[]
): TurnProductionBreakdown {
  const tradePactBonus = getTradePactBonusGold(state.factions);
  const underKeys = getUnderConstructionKeys(state);
  const expansionWorkersUsed = (state.expansions ?? [])
    .filter((e) => e.owner === 'player')
    .reduce((sum, e) => sum + e.workersCommitted, 0);
  return computeTurnEconomyBreakdown({
    worldState: state.worldState,
    resources: state.resources,
    population: state.population,
    unlockedTechs: state.research.unlocked,
    units: state.units,
    assets,
    owner: 'player',
    underConstructionKeys: underKeys,
    expansionWorkersUsed,
    activeEffects: state.activeEffects,
    tradePactGoldBonus: tradePactBonus,
    eventGoldMultiplier: state.activeEvent?.goldMultiplierMod ?? 1,
    eventFoodMultiplier: state.activeEvent?.foodMultiplierMod ?? 1,
    foodDeficitTurns: state.foodDeficitTurns ?? 0,
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
    getUnderConstructionKeys(state)
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
  return computeTerritorialCapacity({
    worldState: state.worldState,
    population: state.population,
    unlockedTechs: state.research.unlocked,
    assets,
    owner: 'player',
    underConstructionKeys: getUnderConstructionKeys(state),
    activeExpansions: state.expansions ?? [],
    playerCapital: state.playerCapital,
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

  return {
    nextState: {
      ...state,
      worldState: res.nextState,
      constructions: state.constructions.filter((c) => !(c.q === q && c.r === r)),
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
  if (!isAdjacentCoord(from, to)) {
    return {
      nextState: state,
      acted: false,
      messagePt: 'Selecione um hexágono adjacente para mover ou atacar.',
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

  const occupant = getUnitAt(state.units, to.q, to.r);
  const targetOwner = targetTile?.owner ?? 'neutral';

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
  const combat = resolveHexCombat(
    unit,
    state.research.unlocked,
    state.worldState,
    to.q,
    to.r,
    state.units,
    assets,
    enemyFaction?.unlockedTechs ?? [],
    getUnderConstructionKeys(state)
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
  }

  const nextFactions = state.factions.map((f) =>
    f.id === targetOwner ? { ...f, relation: 'hostile' as const, truceTurnsRemaining: 0 } : f
  );

  const nextExpansions = combat.capturedHex
    ? (state.expansions ?? []).filter((e) => !(e.q === to.q && e.r === to.r))
    : state.expansions ?? [];

  return {
    nextState: {
      ...state,
      worldState: nextWorld,
      units: nextUnits,
      factions: nextFactions,
      expansions: nextExpansions,
    },
    acted: true,
    capturedKey: combat.capturedHex ? targetKey : undefined,
    messagePt: combat.summaryPt,
  };
}

export function performDiplomacyAction(
  state: KingdomState,
  factionId: string,
  action: 'truce' | 'trade_pact' | 'war'
): { nextState: KingdomState; success: boolean; messagePt: string } {
  const target = state.factions.find((f) => f.id === factionId);
  if (!target) {
    return { nextState: state, success: false, messagePt: 'Facção não encontrada.' };
  }

  if (action === 'war') {
    return {
      nextState: {
        ...state,
        factions: state.factions.map((f) =>
          f.id === factionId
            ? { ...f, relation: 'hostile', truceTurnsRemaining: 0 }
            : f
        ),
      },
      success: true,
      messagePt: `Guerra declarada contra ${target.namePt}!`,
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
    return {
      nextState: {
        ...state,
        worldState: { ...state.worldState, cash: state.worldState.cash - cost },
        factions: state.factions.map((f) =>
          f.id === factionId
            ? { ...f, relation: 'truce', truceTurnsRemaining: 5 }
            : f
        ),
      },
      success: true,
      messagePt: `Trégua de 5 turnos firmada com ${target.namePt}.`,
    };
  }

  const pactCost = 300;
  if (target.relation === 'hostile') {
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
  return {
    nextState: {
      ...state,
      worldState: { ...state.worldState, cash: state.worldState.cash - pactCost },
      factions: state.factions.map((f) =>
        f.id === factionId ? { ...f, relation: 'trade_pact' } : f
      ),
    },
    success: true,
    messagePt: `Acordo comercial ativo com ${target.namePt} (+$20/turno)!`,
  };
}

export function resolveKingdomEvent(
  state: KingdomState,
  choiceId: string,
  assets: HexAssetEntry[]
): { nextState: KingdomState; outcomePt: string } {
  const evt = state.activeEvent;
  if (!evt) {
    return { nextState: state, outcomePt: '' };
  }

  const econ = getKingdomEconomy(state, assets);
  const { military } = getKingdomProgression(state, assets);
  let nextCash = state.worldState.cash;
  const nextRes = { ...state.resources };
  let nextResearch = state.research;
  let nextPop = state.population;
  const nextEffects = [...state.activeEffects];
  let outcomePt = 'Evento resolvido.';

  switch (choiceId) {
    case 'irrigate_fields':
      if (nextCash >= 500) {
        nextCash -= 500;
        outcomePt = 'Irrigação emergencial concluída (-$500). Colheitas protegidas.';
      } else {
        nextEffects.push({
          id: `eff-drought-${evt.turn}`,
          titlePt: 'Seca Severa',
          descriptionPt: '-30% produção agrícola',
          turnsRemaining: 3,
          foodMultiplierMod: 0.7,
        });
        outcomePt = 'Saldo insuficiente ($500): seca reduzirá alimentos em 30% por 3 turnos.';
      }
      break;
    case 'accept_drought':
      nextEffects.push({
        id: `eff-drought-${evt.turn}`,
        titlePt: 'Seca Severa',
        descriptionPt: '-30% produção agrícola',
        turnsRemaining: 3,
        foodMultiplierMod: 0.7,
      });
      outcomePt = 'Seca ativa por 3 turnos (-30% Alimento/turno).';
      break;
    case 'store_food':
      nextRes.food = Math.min(econ.storageCaps.food, nextRes.food + 35);
      outcomePt = '+35 Alimento estocado.';
      break;
    case 'sell_surplus':
      nextCash += 160;
      outcomePt = 'Excedente vendido por +$160.';
      break;
    case 'extract_minerals':
      nextRes.stone = Math.min(econ.storageCaps.stone, nextRes.stone + 25);
      nextRes.ore = Math.min(econ.storageCaps.ore, nextRes.ore + 20);
      outcomePt = '+25 Pedra e +20 Minério extraídos.';
      break;
    case 'study_findings': {
      const adv = advanceResearchProgress(nextResearch, 15);
      nextResearch = adv.nextResearch;
      outcomePt = adv.completedTech
        ? `Pesquisa ${adv.completedTech.namePt} concluída!`
        : '+15 Ciência aplicada à pesquisa.';
      break;
    }
    case 'invest_caravan':
      if (nextCash >= 120) {
        nextCash += 160; // -120 + 280
        nextRes.wood = Math.min(econ.storageCaps.wood, nextRes.wood + 20);
        outcomePt = 'Caravana rendeu +$160 líquidos e +20 Madeira!';
      } else {
        outcomePt = 'Saldo insuficiente para investir; caravana partiu.';
      }
      break;
    case 'decline_caravan':
      outcomePt = 'Oferta recusada.';
      break;
    case 'fund_healers':
      if (nextCash >= 240) {
        nextCash -= 240;
        outcomePt = 'Boticários contiveram a epidemia (-$240). População preservada.';
      } else {
        nextPop = Math.max(4, nextPop - 2);
        nextEffects.push({
          id: `eff-epidemic-${evt.turn}`,
          titlePt: 'Epidemia',
          descriptionPt: '-15% produtividade',
          turnsRemaining: 2,
          efficiencyPenalty: 0.15,
        });
        outcomePt = 'Sem ouro suficiente: -2 moradores e -15% eficiência por 2 turnos.';
      }
      break;
    case 'quarantine_only':
      nextPop = Math.max(4, nextPop - 1);
      nextEffects.push({
        id: `eff-epidemic-${evt.turn}`,
        titlePt: 'Epidemia',
        descriptionPt: '-15% produtividade',
        turnsRemaining: 2,
        efficiencyPenalty: 0.15,
      });
      outcomePt = 'Quarentena aplicada (-1 morador, -15% eficiência por 2 turnos).';
      break;
    case 'stabilize_treasury':
      if (nextCash >= 140) {
        nextCash -= 140;
        const adv = advanceResearchProgress(nextResearch, 10);
        nextResearch = adv.nextResearch;
        outcomePt = 'Reforma comercial estabilizou o reino (-$140, +10 Ciência).';
      } else {
        nextEffects.push({
          id: `eff-crisis-${evt.turn}`,
          titlePt: 'Crise Econômica',
          descriptionPt: '-20% receita em ouro',
          turnsRemaining: 2,
          goldMultiplierMod: 0.8,
        });
        outcomePt = 'Crise econômica reduzirá ouro em 20% por 2 turnos.';
      }
      break;
    case 'absorb_crisis':
      nextEffects.push({
        id: `eff-crisis-${evt.turn}`,
        titlePt: 'Crise Econômica',
        descriptionPt: '-20% receita em ouro',
        turnsRemaining: 2,
        goldMultiplierMod: 0.8,
      });
      outcomePt = 'Retração econômica ativa por 2 turnos (-20% Ouro).';
      break;
    case 'tax_relief':
      if (nextCash >= 180) {
        nextCash -= 180;
        outcomePt = 'Alívio fiscal concedido (-$180). Ordem restaurada.';
      } else {
        nextEffects.push({
          id: `eff-revolt-${evt.turn}`,
          titlePt: 'Greve Tributária',
          descriptionPt: '-15% produtividade',
          turnsRemaining: 2,
          efficiencyPenalty: 0.15,
        });
        outcomePt = 'Sem ouro para alívio: agitação reduz eficiência por 2 turnos.';
      }
      break;
    case 'suppress_revolt':
      if (military.defensePower >= 14) {
        outcomePt = `Guarda real pacificou a região (Defesa ${military.defensePower}).`;
      } else {
        nextEffects.push({
          id: `eff-revolt-${evt.turn}`,
          titlePt: 'Greve Tributária',
          descriptionPt: '-15% produtividade',
          turnsRemaining: 2,
          efficiencyPenalty: 0.15,
        });
        outcomePt = `Defesa insuficiente (${military.defensePower}/14): -15% produtividade por 2 turnos.`;
      }
      break;
    case 'sponsor_academy':
      if (nextCash >= 180) {
        nextCash -= 180;
        const adv = advanceResearchProgress(nextResearch, 22);
        nextResearch = adv.nextResearch;
        outcomePt = adv.completedTech
          ? `Pesquisa ${adv.completedTech.namePt} concluída (-$180)!`
          : 'Experimentos financiados (-$180, +22 Ciência)!';
      } else {
        const adv = advanceResearchProgress(nextResearch, 6);
        nextResearch = adv.nextResearch;
        outcomePt = 'Sem ouro para patrocínio integral (+6 Ciência).';
      }
      break;
    case 'sell_manuscripts': {
      nextCash += 140;
      const adv = advanceResearchProgress(nextResearch, 6);
      nextResearch = adv.nextResearch;
      outcomePt = 'Tratados vendidos (+$140, +6 Ciência).';
      break;
    }
    case 'defend_borders':
      if (military.defensePower >= 12) {
        nextCash += 180;
        outcomePt = `Fronteira defendida (Defesa ${military.defensePower})! Saqueadores derrotados (+$180).`;
      } else {
        nextCash = Math.max(0, nextCash - 160);
        outcomePt = `Defesa insuficiente (${military.defensePower}/12): saqueadores levaram $160.`;
      }
      break;
    case 'pay_tribute':
      nextCash = Math.max(0, nextCash - 140);
      outcomePt = 'Tributo pago (-$140). Fronteira preservada.';
      break;
    default:
      break;
  }

  const historyEntry: EventHistoryEntry = {
    turn: evt.turn,
    titlePt: evt.titlePt,
    outcomePt,
    kind: evt.kind,
  };

  return {
    nextState: {
      ...state,
      worldState: { ...state.worldState, cash: nextCash },
      resources: nextRes,
      population: nextPop,
      research: nextResearch,
      activeEffects: nextEffects,
      activeEvent: null,
      eventHistory: [historyEntry, ...state.eventHistory].slice(0, 12),
    },
    outcomePt,
  };
}

export function advanceKingdomTurn(
  state: KingdomState,
  assets: HexAssetEntry[]
): {
  nextState: KingdomState;
  completedTech: TechDefinition | null;
  completedBuildings: string[];
  incorporatedKeys: string[];
  newEvent: ActiveKingdomEvent | null;
  conqueredByAiKeys: string[];
  headlinePt: string;
} {
  let working = state;
  if (working.activeEvent && working.activeEvent.choices.length > 0) {
    const fallbackChoice =
      working.activeEvent.choices[working.activeEvent.choices.length - 1];
    working = resolveKingdomEvent(working, fallbackChoice.id, assets).nextState;
  }

  return processKingdomTurn(working, assets);
}

export function serializeKingdomState(state: KingdomState): string {
  return JSON.stringify({
    version: 6,
    turn: state.turn,
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
    activeEffects: state.activeEffects,
    activeEvent: state.activeEvent,
    eventHistory: state.eventHistory,
  });
}

export function deserializeKingdomState(
  raw: string,
  totalAssets: number
): KingdomState | null {
  const worldState = deserializeWorldState(raw, totalAssets);
  if (!worldState) return null;

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
      ? parsed.constructions.filter(
          (c): c is ActiveConstruction =>
            Boolean(c) &&
            typeof c.q === 'number' &&
            typeof c.r === 'number' &&
            typeof c.turnsRemaining === 'number' &&
            c.turnsRemaining > 0
        )
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

    return {
      turn: typeof parsed.turn === 'number' && parsed.turn >= 1 ? parsed.turn : 1,
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
      factions,
      constructions,
      expansions,
      activeEffects,
      activeEvent: parsed.activeEvent ?? null,
      eventHistory: Array.isArray(parsed.eventHistory) ? parsed.eventHistory : [],
      lastTurnSummaryPt: null,
    };
  } catch {
    return null;
  }
}
