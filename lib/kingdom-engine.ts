import type { HexAssetEntry } from './godot-docs';
import { getBuildingDefinition, type ResourceCost } from './buildings-catalog';
import {
  canAffordCost,
  computeEffectiveBuildCost,
  computeTurnEconomyBreakdown,
  createInitialResources,
  getKingdomStage,
  type KingdomResources,
  type KingdomStageInfo,
  type TurnProductionBreakdown,
} from './economy-engine';
import {
  generateTurnEvent,
  type ActiveKingdomEvent,
  type ActiveWorldEffect,
  type EventHistoryEntry,
} from './events-engine';
import {
  advanceFactionsTurn,
  createInitialFactions,
  getTradePactBonusGold,
  normalizeFactionState,
  seedRivalFactionTilesAndUnits,
  type FactionState,
} from './faction-engine';
import {
  DEFAULT_ROTATION_DEG,
  createEmptyWorldState,
  createStarterWorldState,
  demolishHexInState,
  deserializeWorldState,
  hasHexConstruction,
  hexKey,
  placeHexInState,
  type AxialCoord,
  type HexOwner,
  type HexWorldState,
} from './hex-engine';
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
  getTechModifiers,
  selectActiveTech,
  TECH_BY_ID,
  type ResearchState,
  type TechDefinition,
  type TechId,
} from './tech-engine';
import {
  INCOMPATIBLE_TERRAIN_MESSAGE,
  getHexTerrainAndResource,
  getStrategicRegionInfo,
  TERRAIN_METADATA,
} from './terrain-engine';
import {
  ALREADY_OCCUPIED_BUILD_MESSAGE,
  NOT_OWNED_BUILD_MESSAGE,
  calculateConquestCost,
  countPlayerTerritory,
  getConquestFailureMessage,
  isAdjacentToPlayerTerritory,
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
  worldState: HexWorldState;
  resources: KingdomResources;
  population: number;
  research: ResearchState;
  units: UnitEntity[];
  factions: FactionState[];
  constructions: ActiveConstruction[];
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

export function createStarterKingdomState(assets: HexAssetEntry[]): KingdomState {
  const baseWorld = createStarterWorldState(assets);
  const { worldState, units } = seedRivalFactionTilesAndUnits(baseWorld, assets);

  return {
    turn: 1,
    worldState,
    resources: createInitialResources(),
    population: 18,
    research: createInitialResearchState(),
    units,
    factions: createInitialFactions(),
    constructions: [],
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
    research: createInitialResearchState(),
    units: [],
    factions: createInitialFactions(),
    constructions: [],
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
  return computeTurnEconomyBreakdown({
    worldState: state.worldState,
    resources: state.resources,
    population: state.population,
    unlockedTechs: state.research.unlocked,
    units: state.units,
    assets,
    owner: 'player',
    underConstructionKeys: underKeys,
    activeEffects: state.activeEffects,
    tradePactGoldBonus: tradePactBonus,
    eventGoldMultiplier: state.activeEvent?.goldMultiplierMod ?? 1,
    eventFoodMultiplier: state.activeEvent?.foodMultiplierMod ?? 1,
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

export function calculateStrategicConquestCost(
  state: KingdomState,
  q: number,
  r: number,
  assets: HexAssetEntry[]
): number {
  const existing = state.worldState.hexes[hexKey(q, r)];
  const base = calculateConquestCost({ q, r }, existing, assets);
  const strategic = getStrategicRegionInfo(q, r);
  const mods = getTechModifiers(state.research.unlocked);
  return Math.round(base * strategic.conquestCostMultiplier * mods.expansionCostMultiplier);
}

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

  if (!existing || existing.owner !== 'player') {
    return { nextState: state, built: false, messagePt: NOT_OWNED_BUILD_MESSAGE };
  }

  if (hasHexConstruction(existing, assets) || getConstructionAt(state, q, r)) {
    return {
      nextState: state,
      built: false,
      messagePt: ALREADY_OCCUPIED_BUILD_MESSAGE,
    };
  }

  const bDef = getBuildingDefinition(asset.name);
  if (bDef.requiredTech && !state.research.unlocked.includes(bDef.requiredTech)) {
    const techName = TECH_BY_ID[bDef.requiredTech]?.namePt ?? bDef.requiredTech;
    return {
      nextState: state,
      built: false,
      messagePt: `Requer pesquisa: ${techName}.`,
    };
  }

  const terrainInfo = getHexTerrainAndResource(q, r, existing);
  if (bDef.allowedTerrains && !bDef.allowedTerrains.includes(terrainInfo.terrainType)) {
    return {
      nextState: state,
      built: false,
      messagePt: INCOMPATIBLE_TERRAIN_MESSAGE,
    };
  }

  const econ = getKingdomEconomy(state, assets);
  if (bDef.workersRequired > 0 && econ.population.availableWorkers < bDef.workersRequired) {
    return {
      nextState: state,
      built: false,
      messagePt: `Sem trabalhadores livres (precisa ${bDef.workersRequired}). Construa Casas.`,
    };
  }

  const cost: ResourceCost = computeEffectiveBuildCost(asset.name, state.research.unlocked);
  const afford = canAffordCost(state.worldState.cash, state.resources, cost);
  if (!afford.affordable) {
    return {
      nextState: state,
      built: false,
      messagePt: afford.missingLabelPt ?? 'Recursos insuficientes.',
    };
  }

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
      },
      constructions: [...state.constructions, newConstruction],
    },
    built: true,
    messagePt: `${bDef.labelPt} em construção (${totalTurns} ${
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

export function conquerInKingdom(
  state: KingdomState,
  q: number,
  r: number,
  assets: HexAssetEntry[]
): {
  nextState: KingdomState;
  conquered: boolean;
  cost: number;
  messagePt: string | null;
} {
  const key = hexKey(q, r);
  const existing = state.worldState.hexes[key];
  const owner = existing?.owner ?? 'neutral';

  if (owner === 'player') {
    return {
      nextState: state,
      conquered: false,
      cost: 0,
      messagePt: getConquestFailureMessage('already_owned', 0),
    };
  }

  if (owner !== 'neutral') {
    return {
      nextState: state,
      conquered: false,
      cost: 0,
      messagePt: 'Território de outra facção! Use uma unidade militar para atacar.',
    };
  }

  if (!isAdjacentToPlayerTerritory(state.worldState, q, r)) {
    return {
      nextState: state,
      conquered: false,
      cost: 0,
      messagePt: getConquestFailureMessage('not_adjacent', 0),
    };
  }

  const cost = calculateStrategicConquestCost(state, q, r, assets);
  if (state.worldState.cash < cost) {
    return {
      nextState: state,
      conquered: false,
      cost,
      messagePt: getConquestFailureMessage('insufficient_funds', cost),
    };
  }

  const terrainInfo = getHexTerrainAndResource(q, r, existing);
  const targetAssetName = TERRAIN_METADATA[terrainInfo.terrainType].defaultAssetName;
  const terrainAssetIdx = Math.max(
    0,
    assets.findIndex((a) => a.name === targetAssetName)
  );

  const nextTile = existing
    ? {
        ...existing,
        owner: 'player' as const,
        terrainType: terrainInfo.terrainType,
        resourceType: terrainInfo.resourceType,
        resourceAmount: terrainInfo.resourceAmount,
      }
    : {
        q,
        r,
        orientation: DEFAULT_ROTATION_DEG,
        structureIndex: terrainAssetIdx,
        owner: 'player' as const,
        terrainType: terrainInfo.terrainType,
        resourceType: terrainInfo.resourceType,
        resourceAmount: terrainInfo.resourceAmount,
      };

  const strategic = getStrategicRegionInfo(q, r);

  return {
    nextState: {
      ...state,
      worldState: {
        ...state.worldState,
        cash: state.worldState.cash - cost,
        hexes: {
          ...state.worldState.hexes,
          [key]: nextTile,
        },
      },
    },
    conquered: true,
    cost,
    messagePt: strategic.labelPt
      ? `Território conquistado: ${strategic.labelPt}!`
      : 'Novo território conquistado!',
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

  return {
    nextState: {
      ...state,
      worldState: nextWorld,
      units: nextUnits,
      factions: nextFactions,
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

  const econ = getKingdomEconomy(working, assets);
  const nextTurn = working.turn + 1;

  const nextCash = Math.max(0, working.worldState.cash + econ.goldNet);
  const nextResources: KingdomResources = {
    wood: Math.min(econ.storageCaps.wood, Math.max(0, working.resources.wood + econ.woodNet)),
    stone: Math.min(
      econ.storageCaps.stone,
      Math.max(0, working.resources.stone + econ.stoneNet)
    ),
    food: Math.min(econ.storageCaps.food, Math.max(0, working.resources.food + econ.foodNet)),
    ore: Math.min(econ.storageCaps.ore, Math.max(0, working.resources.ore + econ.oreNet)),
    science: working.resources.science + econ.scienceNet,
  };

  const nextPop = Math.min(
    econ.population.capacity,
    working.population + econ.population.projectedGrowth
  );

  // Progress active multi-turn constructions
  const completedBuildings: string[] = [];
  const nextConstructions: ActiveConstruction[] = [];
  for (const c of working.constructions) {
    const rem = c.turnsRemaining - 1;
    if (rem <= 0) {
      completedBuildings.push(getBuildingDefinition(c.assetName).labelPt);
    } else {
      nextConstructions.push({ ...c, turnsRemaining: rem });
    }
  }

  // Decrement ongoing multi-turn world effects
  const nextEffects: ActiveWorldEffect[] = working.activeEffects
    .map((eff) => ({ ...eff, turnsRemaining: eff.turnsRemaining - 1 }))
    .filter((eff) => eff.turnsRemaining > 0);

  const researchStep = advanceResearchProgress(working.research, econ.scienceNet);

  // Refresh player & AI unit movement + small garrison healing on owned tiles
  const refreshedUnits = working.units.map((u) => {
    const tile = working.worldState.hexes[hexKey(u.q, u.r)];
    const onFriendly = tile?.owner === u.owner;
    return {
      ...u,
      movedThisTurn: false,
      hp: onFriendly ? Math.min(u.maxHp, u.hp + 3) : u.hp,
    };
  });

  const underKeysAfterBuild = new Set(
    nextConstructions.map((c) => hexKey(c.q, c.r))
  );

  const aiResult = advanceFactionsTurn({
    worldState: { ...working.worldState, cash: nextCash },
    factions: working.factions,
    units: refreshedUnits,
    assets,
    turn: nextTurn,
    underConstructionKeys: underKeysAfterBuild,
  });

  const playerBorderHex = Object.values(aiResult.worldState.hexes).find(
    (t) => t.owner === 'player'
  );
  const newEvent = generateTurnEvent(
    nextTurn,
    playerBorderHex ? { q: playerBorderHex.q, r: playerBorderHex.r } : undefined
  );

  const summaryParts: string[] = [
    `Turno ${nextTurn}`,
    `${econ.goldNet >= 0 ? '+' : ''}$${econ.goldNet}`,
  ];
  if (completedBuildings.length > 0) {
    summaryParts.push(`Pronto: ${completedBuildings.join(', ')}`);
  }
  if (researchStep.completedTech) {
    summaryParts.push(`Pesquisa: ${researchStep.completedTech.namePt}`);
  } else if (newEvent) {
    summaryParts.push(`Evento: ${newEvent.titlePt}`);
  } else if (aiResult.newsPt) {
    summaryParts.push(aiResult.newsPt);
  }

  return {
    nextState: {
      turn: nextTurn,
      worldState: aiResult.worldState,
      resources: nextResources,
      population: nextPop,
      research: researchStep.nextResearch,
      units: aiResult.units,
      factions: aiResult.factions,
      constructions: nextConstructions,
      activeEffects: nextEffects,
      activeEvent: newEvent,
      eventHistory: working.eventHistory,
      lastTurnSummaryPt: summaryParts.join(' · '),
    },
    completedTech: researchStep.completedTech,
    completedBuildings,
    newEvent,
    conqueredByAiKeys: aiResult.conqueredKeys,
    headlinePt: summaryParts.join(' · '),
  };
}

export function serializeKingdomState(state: KingdomState): string {
  return JSON.stringify({
    version: 3,
    turn: state.turn,
    cash: state.worldState.cash,
    structures: Object.values(state.worldState.hexes),
    resources: state.resources,
    population: state.population,
    research: state.research,
    units: state.units,
    factions: state.factions,
    constructions: state.constructions,
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
    const parsed = JSON.parse(raw) as Partial<KingdomState> & { version?: number };
    const defaults = createInitialResources();
    const resources: KingdomResources =
      parsed.resources && typeof parsed.resources === 'object'
        ? {
            wood: Number(parsed.resources.wood ?? defaults.wood),
            stone: Number(parsed.resources.stone ?? defaults.stone),
            food: Number(parsed.resources.food ?? defaults.food),
            ore: Number(parsed.resources.ore ?? defaults.ore),
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

    const activeEffects: ActiveWorldEffect[] = Array.isArray(parsed.activeEffects)
      ? parsed.activeEffects.filter(
          (e): e is ActiveWorldEffect =>
            Boolean(e) && typeof e.id === 'string' && typeof e.turnsRemaining === 'number'
        )
      : [];

    return {
      turn: typeof parsed.turn === 'number' && parsed.turn >= 1 ? parsed.turn : 1,
      worldState,
      resources,
      population:
        typeof parsed.population === 'number' && parsed.population >= 1
          ? Math.round(parsed.population)
          : 18,
      research:
        parsed.research && Array.isArray(parsed.research.unlocked)
          ? parsed.research
          : createInitialResearchState(),
      units: Array.isArray(parsed.units) ? parsed.units : [],
      factions,
      constructions,
      activeEffects,
      activeEvent: parsed.activeEvent ?? null,
      eventHistory: Array.isArray(parsed.eventHistory) ? parsed.eventHistory : [],
      lastTurnSummaryPt: null,
    };
  } catch {
    return null;
  }
}
