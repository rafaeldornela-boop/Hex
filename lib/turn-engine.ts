import type { HexAssetEntry } from './godot-docs';
import { getBuildingDefinition } from './buildings-catalog';
import { toRomanLevel } from './building-upgrade-engine';
import { computeCalendarSnapshot } from './calendar-engine';
import { getDayPhaseForTurn } from './day-night-engine';
import {
  advanceClimateWeather,
  createInitialClimateWeather,
} from './season-engine';
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
import {
  CITY_STAGE_META,
  syncAndEvolveCities,
  type CityEntity,
} from './city-engine';
import type { RoadMap } from './road-engine';

export interface TurnAdvanceResult {
  nextState: KingdomState;
  completedTech: TechDefinition | null;
  completedBuildings: string[];
  completedUpgrades: string[];
  incorporatedKeys: string[];
  foundedCities: string[];
  leveledUpCities: string[];
  seasonChangedToPt: string | null;
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
 * 1. Advance calendar, day/night phase, climate weather & complete constructions/upgrades/expansions
 * 2. Calculate production, location efficiency, worker allocation, and ore-to-metal conversion with seasonal/tier effects
 * 3. Consume food (with seasonal demand) & track safety-margin foodDeficitTurns
 * 4. Apply gold net (gross - building, road & military maintenance)
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
  const prevCalendar = working.calendar ?? computeCalendarSnapshot(working.turn);
  const nextCalendar = computeCalendarSnapshot(nextTurn);
  const nextDayPhase = getDayPhaseForTurn(nextTurn);
  const seasonChangedToPt =
    prevCalendar.season !== nextCalendar.season ? nextCalendar.seasonLabelPt : null;

  const weatherStep = advanceClimateWeather({
    nextTurn,
    season: nextCalendar.season,
    prevWeather: working.climateWeather ?? createInitialClimateWeather(),
    worldSeed: working.worldSeed ?? working.worldState.seed,
  });

  // Step 1a: Progress active multi-turn constructions & building upgrades
  const completedBuildings: string[] = [];
  const completedUpgrades: string[] = [];
  const nextConstructions: ActiveConstruction[] = [];
  const nextHexes = { ...working.worldState.hexes };
  let hexesMutated = false;

  for (const c of working.constructions) {
    const rem = c.turnsRemaining - 1;
    if (rem <= 0) {
      if (c.kind === 'upgrade' && typeof c.targetLevel === 'number') {
        const key = hexKey(c.q, c.r);
        const existing = nextHexes[key];
        if (existing) {
          nextHexes[key] = {
            ...existing,
            level: c.targetLevel,
            ...(existing.meta
              ? { meta: { ...existing.meta, level: c.targetLevel } }
              : {}),
          };
          hexesMutated = true;
        }
        const label = `${getBuildingDefinition(c.assetName).labelPt} Nv.${toRomanLevel(c.targetLevel)}`;
        completedUpgrades.push(label);
        completedBuildings.push(label);
      } else {
        completedBuildings.push(getBuildingDefinition(c.assetName).labelPt);
      }
    } else {
      nextConstructions.push({ ...c, turnsRemaining: rem });
    }
  }

  const underKeysAfterBuild = new Set(
    nextConstructions.filter((c) => c.kind !== 'upgrade').map((c) => hexKey(c.q, c.r))
  );
  const upgradingByKeyAfterBuild: Record<
    string,
    { targetLevel: number; turnsRemaining: number; totalTurns: number }
  > = {};
  for (const c of nextConstructions) {
    if (c.kind === 'upgrade' && typeof c.targetLevel === 'number') {
      upgradingByKeyAfterBuild[hexKey(c.q, c.r)] = {
        targetLevel: c.targetLevel,
        turnsRemaining: c.turnsRemaining,
        totalTurns: c.totalTurns,
      };
    }
  }

  // Step 1b: Progress active multi-turn territorial incorporations
  const incorporatedKeys: string[] = [];
  const nextExpansions: ActiveExpansion[] = [];
  let worldAfterExpansions = working.worldState;

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

  const workingRoads: RoadMap = working.roads ?? {};

  // Step 1c: Organically found and evolve cities based on completed buildings, roads, districts, and connections
  const citySync = syncAndEvolveCities({
    worldState: worldAfterExpansions,
    roads: workingRoads,
    existingCities: working.cities ?? [],
    playerCapital: working.playerCapital,
    population: working.population,
    unlockedTechs: working.research.unlocked,
    assets,
    underConstructionKeys: underKeysAfterBuild,
    hasFoodDeficit: (working.foodDeficitTurns ?? 0) > 0,
    turn: nextTurn,
    worldSeed: working.worldSeed ?? working.worldState.seed,
  });

  // Step 2 & 3 & 4: Compute production, input conversions, food balance, road upkeep, and seasonal/tier effects
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
    roads: workingRoads,
    cities: citySync.cities,
    playerCapital: working.playerCapital,
    worldSeed: working.worldSeed ?? working.worldState.seed,
    season: nextCalendar.season,
    weather: weatherStep.weather,
    upgradingConstructionsByKey: upgradingByKeyAfterBuild,
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

  // Strip player roads & lost city centers if rival factions captured tiles
  let nextRoads: RoadMap = workingRoads;
  if (aiResult.conqueredKeys.length > 0) {
    const conqueredSet = new Set(aiResult.conqueredKeys);
    const filtered: RoadMap = {};
    for (const [k, road] of Object.entries(workingRoads)) {
      if (!conqueredSet.has(k)) {
        filtered[k] = road;
      }
    }
    nextRoads = filtered;
  }

  const finalCities: CityEntity[] = citySync.cities.filter((c) => {
    const tile = aiResult.worldState.hexes[hexKey(c.center.q, c.center.r)];
    return tile && tile.owner === c.owner;
  });

  const foundedCities = citySync.newlyFoundedCities.map((c) => c.name);
  const leveledUpCities = citySync.leveledUpCities.map(
    (entry) => `${entry.city.name} (${CITY_STAGE_META[entry.toLevel].labelPt})`
  );

  const playerBorderHex = Object.values(aiResult.worldState.hexes).find(
    (t) => t.owner === 'player'
  );
  const newEvent = generateTurnEvent(
    nextTurn,
    playerBorderHex ? { q: playerBorderHex.q, r: playerBorderHex.r } : undefined
  );

  // Concise causal turn headline
  const summaryParts: string[] = [
    `Turno ${nextTurn} · ${nextCalendar.seasonLabelPt}`,
    `${econ.goldNet >= 0 ? '+' : ''}$${econ.goldNet}`,
  ];
  if (seasonChangedToPt) {
    summaryParts.push(`Nova estação: ${seasonChangedToPt}`);
  }
  if (weatherStep.changed && weatherStep.weather.id !== 'clear') {
    summaryParts.push(`Clima: ${weatherStep.weather.labelPt}`);
  }
  if (completedUpgrades.length > 0) {
    summaryParts.push(`Evoluiu: ${completedUpgrades.join(', ')}`);
  } else if (completedBuildings.length > 0) {
    summaryParts.push(`Pronto: ${completedBuildings.join(', ')}`);
  }
  if (foundedCities.length > 0) {
    summaryParts.push(`Nova cidade: ${foundedCities.join(', ')}`);
  }
  if (leveledUpCities.length > 0) {
    summaryParts.push(`Cresceu: ${leveledUpCities.join(', ')}`);
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
      calendar: nextCalendar,
      dayPhase: nextDayPhase,
      climateWeather: weatherStep.weather,
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
      roads: nextRoads,
      cities: finalCities,
      activeEffects: nextEffects,
      activeEvent: newEvent,
      eventHistory: working.eventHistory,
      lastTurnSummaryPt: headlinePt,
    },
    completedTech: researchStep.completedTech,
    completedBuildings,
    completedUpgrades,
    incorporatedKeys,
    foundedCities,
    leveledUpCities,
    seasonChangedToPt,
    newEvent,
    conqueredByAiKeys: aiResult.conqueredKeys,
    headlinePt,
  };
}

