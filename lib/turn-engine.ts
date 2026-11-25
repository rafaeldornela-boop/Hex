import type { HexAssetEntry } from './godot-docs';
import { getBuildingDefinition } from './buildings-catalog';
import {
  computeTurnEconomyBreakdown,
  type KingdomResources,
} from './economy-engine';
import {
  generateTurnEvent,
  type ActiveKingdomEvent,
  type ActiveWorldEffect,
} from './events-engine';
import {
  advanceFactionsTurn,
  getTradePactBonusGold,
} from './faction-engine';
import { DEFAULT_ROTATION_DEG, hexKey } from './hex-engine';
import type { ActiveConstruction, KingdomState } from './kingdom-engine';
import { MIN_KINGDOM_POPULATION } from './population-engine';
import {
  TERRAIN_METADATA,
  getHexTerrainAndResource,
} from './terrain-engine';
import type { ActiveExpansion } from './territory-engine';
import {
  advanceResearchProgress,
  type TechDefinition,
} from './tech-engine';

export interface TurnAdvanceResult {
  nextState: KingdomState;
  completedTech: TechDefinition | null;
  completedBuildings: string[];
  incorporatedKeys: string[];
  newEvent: ActiveKingdomEvent | null;
  conqueredByAiKeys: string[];
  headlinePt: string;
}

function safeClampStock(current: number, delta: number, cap: number): number {
  const safeCurr = Number.isFinite(current) ? current : 0;
  const safeDelta = Number.isFinite(delta) ? delta : 0;
  const safeCap = Number.isFinite(cap) ? Math.max(0, cap) : 0;
  return Math.min(safeCap, Math.max(0, Math.round(safeCurr + safeDelta)));
}

/**
 * Deterministic 10-step causal turn resolution pipeline:
 * 1. Complete constructions & territorial incorporations that reach 0 turns remaining
 * 2. Calculate production, location efficiency, worker allocation, and ore-to-metal conversion
 * 3. Consume food & track safety-margin foodDeficitTurns
 * 4. Apply gold net (gross - building & military maintenance)
 * 5. Update population growth or decline (bounded by housing capacity & MIN_KINGDOM_POPULATION)
 * 6. Advance active scientific research
 * 7. Update resource stockpiles safely within storage caps
 * 8. Tick multi-turn world effects and trigger periodic events
 * 9. Advance rival AI factions using the shared economy & territory engine
 * 10. Refresh units and produce concise turn summary
 */
export function processKingdomTurn(
  working: KingdomState,
  assets: HexAssetEntry[]
): TurnAdvanceResult {
  const nextTurn = working.turn + 1;

  // Step 1a: Progress active multi-turn constructions first so completed buildings activate immediately
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
  const underKeysAfterBuild = new Set(
    nextConstructions.map((c) => hexKey(c.q, c.r))
  );

  // Step 1b: Progress active multi-turn territorial incorporations
  const incorporatedKeys: string[] = [];
  const nextExpansions: ActiveExpansion[] = [];
  let worldAfterExpansions = working.worldState;
  const nextHexes = { ...working.worldState.hexes };
  let hexesMutated = false;

  for (const exp of working.expansions ?? []) {
    const rem = exp.turnsRemaining - 1;
    if (rem <= 0) {
      const key = hexKey(exp.q, exp.r);
      const existing = nextHexes[key];
      // Only incorporate if still neutral (protect against war capture in the meantime)
      if (!existing || !existing.owner || existing.owner === 'neutral') {
        const terrainInfo = getHexTerrainAndResource(exp.q, exp.r, existing);
        const defaultName = TERRAIN_METADATA[terrainInfo.terrainType].defaultAssetName;
        const defaultIdx = Math.max(
          0,
          assets.findIndex((a) => a.name === defaultName)
        );
        nextHexes[key] = existing
          ? {
              ...existing,
              owner: exp.owner,
              terrainType: terrainInfo.terrainType,
              resourceType: terrainInfo.resourceType,
              resourceAmount: terrainInfo.resourceAmount,
            }
          : {
              q: exp.q,
              r: exp.r,
              orientation: DEFAULT_ROTATION_DEG,
              structureIndex: defaultIdx,
              owner: exp.owner,
              terrainType: terrainInfo.terrainType,
              resourceType: terrainInfo.resourceType,
              resourceAmount: terrainInfo.resourceAmount,
            };
        hexesMutated = true;
        incorporatedKeys.push(key);
      }
    } else {
      nextExpansions.push({ ...exp, turnsRemaining: rem });
    }
  }

  if (hexesMutated) {
    worldAfterExpansions = {
      ...working.worldState,
      hexes: nextHexes,
    };
  }

  const expansionWorkersUsed = nextExpansions
    .filter((e) => e.owner === 'player')
    .reduce((sum, e) => sum + e.workersCommitted, 0);

  // Step 2 & 3 & 4: Compute production, input conversions, food balance, and maintenance
  const tradePactBonus = getTradePactBonusGold(working.factions);
  const econ = computeTurnEconomyBreakdown({
    worldState: worldAfterExpansions,
    resources: working.resources,
    population: working.population,
    unlockedTechs: working.research.unlocked,
    units: working.units,
    assets,
    owner: 'player',
    underConstructionKeys: underKeysAfterBuild,
    expansionWorkersUsed,
    activeEffects: working.activeEffects,
    tradePactGoldBonus: tradePactBonus,
    eventGoldMultiplier: working.activeEvent?.goldMultiplierMod ?? 1,
    eventFoodMultiplier: working.activeEvent?.foodMultiplierMod ?? 1,
    foodDeficitTurns: working.foodDeficitTurns ?? 0,
  });

  // Step 4: Treasury update
  const nextCash = Math.max(
    0,
    Math.round(
      (Number.isFinite(worldAfterExpansions.cash) ? worldAfterExpansions.cash : 0) +
        (Number.isFinite(econ.goldNet) ? econ.goldNet : 0)
    )
  );

  // Step 5: Population growth / decline bounded by housing capacity
  const minFloor = Math.min(MIN_KINGDOM_POPULATION, econ.population.capacity);
  const nextPop = Math.max(
    minFloor,
    Math.min(econ.population.capacity, working.population + econ.population.projectedGrowth)
  );

  // Step 6: Research progression
  const researchStep = advanceResearchProgress(working.research, econ.scienceNet);

  // Step 7: Resource stockpiles clamped safely to [0, cap]
  const nextResources: KingdomResources = {
    wood: safeClampStock(working.resources.wood, econ.woodNet, econ.storageCaps.wood),
    stone: safeClampStock(working.resources.stone, econ.stoneNet, econ.storageCaps.stone),
    food: safeClampStock(working.resources.food, econ.foodNet, econ.storageCaps.food),
    ore: safeClampStock(working.resources.ore, econ.oreNet, econ.storageCaps.ore),
    metal: safeClampStock(working.resources.metal, econ.metalNet, econ.storageCaps.metal),
    science:
      (Number.isFinite(working.resources.science) ? working.resources.science : 0) +
      econ.scienceNet,
  };

  // Step 8: Decrement ongoing multi-turn world effects & generate periodic event
  const nextEffects: ActiveWorldEffect[] = working.activeEffects
    .map((eff) => ({ ...eff, turnsRemaining: eff.turnsRemaining - 1 }))
    .filter((eff) => eff.turnsRemaining > 0);

  // Step 9 & 10: Refresh player & AI unit movement + friendly healing, then advance rival AI factions
  const refreshedUnits = working.units.map((u) => {
    const tile = worldAfterExpansions.hexes[hexKey(u.q, u.r)];
    const onFriendly = tile?.owner === u.owner;
    return {
      ...u,
      movedThisTurn: false,
      hp: onFriendly ? Math.min(u.maxHp, u.hp + 3) : u.hp,
    };
  });

  const aiResult = advanceFactionsTurn({
    worldState: { ...worldAfterExpansions, cash: nextCash },
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

  // Concise causal turn headline
  const summaryParts: string[] = [
    `Turno ${nextTurn}`,
    `${econ.goldNet >= 0 ? '+' : ''}$${econ.goldNet}`,
  ];
  if (completedBuildings.length > 0) {
    summaryParts.push(`Pronto: ${completedBuildings.join(', ')}`);
  }
  if (incorporatedKeys.length > 0) {
    summaryParts.push(
      `Incorporado: ${incorporatedKeys.length} ${
        incorporatedKeys.length === 1 ? 'território' : 'territórios'
      }`
    );
  }
  if (econ.population.hasFoodDeficit) {
    summaryParts.push(
      working.foodDeficitTurns === 0
        ? 'Alerta de alimento'
        : 'Escassez de alimento (-1 hab)'
    );
  } else if (econ.operationCounts.idle > 0) {
    summaryParts.push(
      `${econ.operationCounts.idle} ${
        econ.operationCounts.idle === 1 ? 'obra parada' : 'obras paradas'
      }`
    );
  }
  if (researchStep.completedTech) {
    summaryParts.push(`Pesquisa: ${researchStep.completedTech.namePt}`);
  } else if (newEvent) {
    summaryParts.push(`Evento: ${newEvent.titlePt}`);
  } else if (aiResult.newsPt) {
    summaryParts.push(aiResult.newsPt);
  }

  const headlinePt = summaryParts.join(' · ');

  return {
    nextState: {
      turn: nextTurn,
      worldSeed: working.worldSeed ?? working.worldState.seed,
      playerCapital: working.playerCapital,
      worldState: aiResult.worldState,
      resources: nextResources,
      population: nextPop,
      foodDeficitTurns: econ.foodDeficitTurnsNext,
      research: researchStep.nextResearch,
      units: aiResult.units,
      factions: aiResult.factions,
      constructions: nextConstructions,
      expansions: nextExpansions,
      activeEffects: nextEffects,
      activeEvent: newEvent,
      eventHistory: working.eventHistory,
      lastTurnSummaryPt: headlinePt,
    },
    completedTech: researchStep.completedTech,
    completedBuildings,
    incorporatedKeys,
    newEvent,
    conqueredByAiKeys: aiResult.conqueredKeys,
    headlinePt,
  };
}
