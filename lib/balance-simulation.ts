import type { HexAssetEntry } from './godot-docs';
import {
  advanceKingdomTurn,
  buildInKingdom,
  buildOrUpgradeRoadInKingdom,
  createStarterKingdomState,
  evaluateBuildingModulesInKingdom,
  evaluateBuildingUpgradeInKingdom,
  evaluateExpansionInKingdom,
  getKingdomEconomy,
  getKingdomVictoryProgress,
  installBuildingModuleInKingdom,
  recruitUnitInKingdom,
  resolveKingdomEvent,
  setActiveResearchInKingdom,
  startExpansionInKingdom,
  upgradeBuildingInKingdom,
  type KingdomState,
} from './kingdom-engine';
import { getAvailableTechs, type TechId } from './tech-engine';
import { hasHexConstruction, hexKey } from './hex-engine';
import { isBuildingAllowedOnTerrain } from './build-rules';
import { getHexTerrainAndResource } from './terrain-engine';

export type SimulationStrategy =
  | 'agricola'
  | 'minerador'
  | 'comercial'
  | 'militar'
  | 'urbano';

export interface SimulationSnapshot {
  turn: number;
  gold: number;
  goldNet: number;
  food: number;
  foodNet: number;
  wood: number;
  stone: number;
  ore: number;
  metal: number;
  population: number;
  housingCapacity: number;
  territoryCount: number;
  cityCount: number;
  techCount: number;
  scienceNet: number;
  militaryPower: number;
  unitCount: number;
  victoryStatus: 'ongoing' | 'victory' | 'defeat';
  leadingVictoryPath: string;
}

export interface SimulationRunResult {
  strategy: SimulationStrategy;
  seed: number;
  checkpoints: SimulationSnapshot[];
  finalTurn: number;
  victoryStatus: 'ongoing' | 'victory' | 'defeat';
  achievedVictoryId: string | null;
  defeatReason: string | null;
}

const CHECKPOINT_TURNS = new Set([12, 24, 48, 96, 144, 192]);

const STRATEGY_BUILD_PRIORITIES: Record<SimulationStrategy, string[]> = {
  agricola: [
    'building-farm',
    'building-mill',
    'building-watermill',
    'building-house',
    'building-sheep',
    'building-market',
    'building-wizard-tower',
  ],
  minerador: [
    'building-mine',
    'building-smelter',
    'building-farm',
    'dirt-lumber',
    'building-house',
    'building-wizard-tower',
    'building-market',
  ],
  comercial: [
    'building-market',
    'building-port',
    'building-farm',
    'building-house',
    'building-dock',
    'building-wizard-tower',
    'dirt-lumber',
  ],
  militar: [
    'building-archery',
    'building-tower',
    'building-mine',
    'building-smelter',
    'building-farm',
    'building-house',
    'building-walls',
  ],
  urbano: [
    'building-house',
    'building-village',
    'building-farm',
    'building-market',
    'building-wizard-tower',
    'building-mill',
    'dirt-lumber',
  ],
};

const STRATEGY_TECH_PRIORITIES: Record<SimulationStrategy, TechId[]> = {
  agricola: ['agriculture', 'construction', 'trade', 'mining', 'engineering', 'military', 'metallurgy'],
  minerador: ['mining', 'military', 'metallurgy', 'agriculture', 'construction', 'engineering', 'trade'],
  comercial: ['agriculture', 'trade', 'construction', 'mining', 'engineering', 'military', 'metallurgy'],
  militar: ['mining', 'military', 'metallurgy', 'agriculture', 'construction', 'engineering', 'trade'],
  urbano: ['agriculture', 'construction', 'engineering', 'trade', 'mining', 'military', 'metallurgy'],
};

import { computeFactionMilitaryPower } from './military-engine';

function takeSnapshot(state: KingdomState, assets: HexAssetEntry[]): SimulationSnapshot {
  const econ = getKingdomEconomy(state, assets);
  const victory = getKingdomVictoryProgress(state, assets);
  const territoryCount = Object.values(state.worldState.hexes).filter((h) => h.owner === 'player').length;
  const playerUnits = state.units.filter((u) => u.owner === 'player');
  const power = computeFactionMilitaryPower(
    state.worldState,
    state.units,
    assets,
    'player',
    state.research.unlocked
  );
  const militaryPower = power.attackPower + power.defensePower;

  return {
    turn: state.turn,
    gold: Math.round(state.worldState.cash),
    goldNet: Math.round(econ.goldNet),
    food: Math.round(state.resources.food),
    foodNet: Math.round(econ.foodNet),
    wood: Math.round(state.resources.wood),
    stone: Math.round(state.resources.stone),
    ore: Math.round(state.resources.ore),
    metal: Math.round(state.resources.metal),
    population: econ.population.current,
    housingCapacity: econ.population.capacity,
    territoryCount,
    cityCount: state.cities.filter((c) => c.owner === 'player').length,
    techCount: state.research.unlocked.length,
    scienceNet: Math.round(econ.scienceNet),
    militaryPower,
    unitCount: playerUnits.length,
    victoryStatus: victory.status,
    leadingVictoryPath: victory.leadingPathId,
  };
}

function stepStrategyActions(
  state: KingdomState,
  strategy: SimulationStrategy,
  assets: HexAssetEntry[]
): KingdomState {
  let cur = state;

  // 1. Resolve active event deterministically
  if (cur.activeEvent && !cur.activeEvent.resolved && cur.activeEvent.choices.length > 0) {
    const choice = cur.activeEvent.choices[0];
    cur = resolveKingdomEvent(cur, choice.id, assets).nextState;
  }

  // 2. Pick preferred research if needed
  const availableTechs = getAvailableTechs(cur.research);
  if (availableTechs.length > 0) {
    const preferred = STRATEGY_TECH_PRIORITIES[strategy].find((tid) =>
      availableTechs.some((t) => t.id === tid)
    );
    if (preferred && cur.research.activeTechId !== preferred) {
      const sel = setActiveResearchInKingdom(cur, preferred);
      if (sel.selected) cur = sel.nextState;
    }
  }

  const econ = getKingdomEconomy(cur, assets);

  // 3. Expand territory if workers & capacity allow
  if (econ.population.availableWorkers >= 1) {
    const playerTiles = Object.values(cur.worldState.hexes).filter((h) => h.owner === 'player');
    const seen = new Set<string>();
    const dirs = [
      { q: 1, r: 0 },
      { q: -1, r: 0 },
      { q: 0, r: 1 },
      { q: 0, r: -1 },
      { q: 1, r: -1 },
      { q: -1, r: 1 },
    ];
    for (const tile of playerTiles) {
      let expanded = false;
      for (const d of dirs) {
        const nq = tile.q + d.q;
        const nr = tile.r + d.r;
        const k = hexKey(nq, nr);
        if (seen.has(k)) continue;
        seen.add(k);
        const check = evaluateExpansionInKingdom(cur, nq, nr, assets);
        if (check.canExpand) {
          const res = startExpansionInKingdom(cur, nq, nr, assets);
          if (res.started) {
            cur = res.nextState;
            expanded = true;
            break;
          }
        }
      }
      if (expanded) break;
    }
  }

  // 4. Maintain food security & housing first, then strategy buildings
  const updatedEcon = getKingdomEconomy(cur, assets);
  const needsFood = updatedEcon.foodNet < 2 || cur.resources.food < 15;
  const needsHousing = updatedEcon.population.current >= updatedEcon.population.capacity - 1;

  const buildOrder: string[] = [];
  if (needsFood) buildOrder.push('building-farm', 'building-mill');
  if (needsHousing) buildOrder.push('building-house', 'building-village');
  for (const b of STRATEGY_BUILD_PRIORITIES[strategy]) {
    if (!buildOrder.includes(b)) buildOrder.push(b);
  }
  if (!buildOrder.includes('dirt-lumber')) buildOrder.push('dirt-lumber');

  const freePlayerTiles = Object.values(cur.worldState.hexes).filter(
    (h) => h.owner === 'player' && !hasHexConstruction(h, assets)
  );

  if (freePlayerTiles.length > 0 && cur.constructions.length < 2) {
    outer: for (const assetName of buildOrder) {
      const idx = assets.findIndex((a) => a.name === assetName);
      if (idx < 0) continue;
      for (const tile of freePlayerTiles) {
        const terrain = getHexTerrainAndResource(tile.q, tile.r, tile);
        if (!isBuildingAllowedOnTerrain(assetName, terrain.terrainType)) continue;
        const res = buildInKingdom(cur, tile.q, tile.r, idx, 90, assets);
        if (res.built) {
          cur = res.nextState;
          break outer;
        }
      }
    }
  }

  // 5. Upgrade buildings or install modules when surplus allows
  if (cur.worldState.cash > 220 && cur.constructions.length < 2) {
    const builtTiles = Object.values(cur.worldState.hexes).filter(
      (h) => h.owner === 'player' && hasHexConstruction(h, assets)
    );
    for (const tile of builtTiles) {
      const upCheck = evaluateBuildingUpgradeInKingdom(cur, tile.q, tile.r, assets);
      if (upCheck.canUpgrade) {
        const upRes = upgradeBuildingInKingdom(cur, tile.q, tile.r, assets);
        if (upRes.started) {
          cur = upRes.nextState;
          break;
        }
      }
      const modEval = evaluateBuildingModulesInKingdom(cur, tile.q, tile.r, assets);
      const installable = modEval ? modEval.options.filter((m) => m.status === 'available') : [];
      if (installable.length > 0) {
        const modRes = installBuildingModuleInKingdom(
          cur,
          tile.q,
          tile.r,
          installable[0].definition.id,
          assets
        );
        if (modRes.started) {
          cur = modRes.nextState;
          break;
        }
      }
    }
  }

  // 6. Build roads periodically for urbano / comercial
  if ((strategy === 'urbano' || strategy === 'comercial') && cur.turn % 4 === 0 && cur.worldState.cash > 160) {
    const owned = Object.values(cur.worldState.hexes).filter((h) => h.owner === 'player');
    for (const tile of owned) {
      const roadRes = buildOrUpgradeRoadInKingdom(cur, tile.q, tile.r, assets);
      if (roadRes.built) {
        cur = roadRes.nextState;
        break;
      }
    }
  }

  // 7. Recruit military units for militar strategy (or basic defense)
  const targetUnits = strategy === 'militar' ? 5 : 2;
  const playerUnits = cur.units.filter((u) => u.owner === 'player');
  if (playerUnits.length < targetUnits && cur.worldState.cash > 180) {
    const unitType = cur.research.unlocked.includes('metallurgy')
      ? 'knight'
      : cur.research.unlocked.includes('military')
        ? 'infantry'
        : null;
    if (unitType) {
      const spawnTile = Object.values(cur.worldState.hexes).find((h) => h.owner === 'player');
      if (spawnTile) {
        const rec = recruitUnitInKingdom(cur, spawnTile.q, spawnTile.r, unitType, assets);
        if (rec.recruited) cur = rec.nextState;
      }
    }
  }

  return cur;
}

export function runKingdomSimulation(params: {
  strategy: SimulationStrategy;
  seed: number;
  maxTurns?: number;
  assets: HexAssetEntry[];
}): SimulationRunResult {
  const maxTurns = params.maxTurns ?? 192;
  let state = createStarterKingdomState(params.assets, params.seed);
  const checkpoints: SimulationSnapshot[] = [];

  for (let t = 1; t <= maxTurns; t++) {
    state = stepStrategyActions(state, params.strategy, params.assets);
    const adv = advanceKingdomTurn(state, params.assets);
    state = adv.nextState;

    if (CHECKPOINT_TURNS.has(state.turn)) {
      checkpoints.push(takeSnapshot(state, params.assets));
    }
  }

  const finalVictory = getKingdomVictoryProgress(state, params.assets);
  return {
    strategy: params.strategy,
    seed: params.seed,
    checkpoints,
    finalTurn: state.turn,
    victoryStatus: finalVictory.status,
    achievedVictoryId: finalVictory.achievedVictoryId,
    defeatReason: finalVictory.defeatReason,
  };
}
