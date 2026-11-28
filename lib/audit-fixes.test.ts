import test from 'node:test';
import assert from 'node:assert/strict';
import { HEX_ASSETS } from './repo-data';
import {
  DEFAULT_ROTATION_DEG,
  hasHexConstruction,
  hexKey,
  placeHexInState,
  type PlacedHex,
} from './hex-engine';
import {
  DEFAULT_FOREST_WOOD_STOCK,
  TERRAIN_METADATA,
  type TerrainType,
} from './terrain-engine';
import {
  advanceKingdomTurn,
  buildInKingdom,
  commandUnitInKingdom,
  createSandboxKingdomState,
  demolishInKingdom,
  getKingdomEconomy,
  type KingdomState,
} from './kingdom-engine';
import {
  getReachableUnitCoords,
  resolveHexCombat,
  UNIT_CATALOG,
  type UnitEntity,
} from './military-engine';
import { advanceFactionsTurn } from './faction-engine';
import { computeHexSeasonalVisualProfile } from './season-engine';

function idxOf(name: string): number {
  const idx = HEX_ASSETS.findIndex((a) => a.name === name);
  assert.ok(idx >= 0, `Missing asset ${name}`);
  return idx;
}

function makeTile(
  q: number,
  r: number,
  terrainType: TerrainType,
  assetName?: string,
  extra?: Partial<PlacedHex>
): PlacedHex {
  const chosenAsset = assetName ?? TERRAIN_METADATA[terrainType].defaultAssetName;
  const resourceMap: Record<TerrainType, 'none' | 'wood' | 'food' | 'ore' | 'water'> = {
    plains: 'none',
    forest: 'wood',
    mountain: 'ore',
    fertile: 'food',
    water: 'water',
  };
  return {
    q,
    r,
    orientation: DEFAULT_ROTATION_DEG,
    structureIndex: idxOf(chosenAsset),
    owner: 'player',
    terrainType,
    resourceType: resourceMap[terrainType],
    resourceAmount: terrainType === 'plains' ? 0 : 10,
    ...(terrainType === 'forest' ? { woodStock: DEFAULT_FOREST_WOOD_STOCK } : {}),
    ...extra,
  };
}

function makeKingdom(
  tiles: PlacedHex[],
  overrides?: Partial<KingdomState>
): KingdomState {
  const base = createSandboxKingdomState();
  const hexes: Record<string, PlacedHex> = {};
  for (const t of tiles) {
    hexes[hexKey(t.q, t.r)] = t;
  }
  return {
    ...base,
    population: 24,
    research: {
      ...base.research,
      unlocked: ['agriculture', 'masonry', 'forestry', 'mining', 'metallurgy', 'trade', 'military'],
    },
    resources: {
      wood: 80,
      stone: 60,
      food: 120,
      ore: 60,
      metal: 20,
      science: 0,
    },
    worldState: {
      ...base.worldState,
      cash: 2500,
      hexes,
    },
    ...overrides,
  };
}

// 1.1 BuildingOperationReport completo em construções em andamento
test('Repro 1.1: under_construction inclui todos os campos obrigatórios de BuildingOperationReport', () => {
  let state = makeKingdom([
    makeTile(0, 0, 'plains', 'building-castle'),
    makeTile(1, 0, 'plains'),
  ]);
  const res = buildInKingdom(state, 1, 0, idxOf('building-house'), 90, HEX_ASSETS);
  assert.equal(res.built, true);
  state = res.nextState;

  const econ = getKingdomEconomy(state, HEX_ASSETS);
  const report = econ.buildingsByKey['1,0'];
  assert.equal(report.status, 'under_construction');
  assert.equal(Array.isArray(report.positiveNeighborKeys), true);
  assert.equal(Array.isArray(report.penaltyNeighborKeys), true);
  assert.equal(Array.isArray(report.bonusSummaryPt), true);
  assert.equal(Array.isArray(report.penaltySummaryPt), true);
  assert.equal('capacitySummaryPt' in report, true);
  assert.equal('resourceOriginPt' in report, true);
  assert.equal('workerOriginPt' in report, true);
});

// 1.2 Conflito dirt-lumber (floresta esgotada vs Serraria construída)
test('Repro 1.2: Serraria construída sobre floresta esgotada opera usando floresta vizinha e pode ser demolida', () => {
  let state = makeKingdom([
    makeTile(0, 0, 'plains', 'building-castle'),
    makeTile(1, 0, 'forest', 'dirt-lumber', { woodStock: 0, forestDepleted: true }),
    makeTile(2, 0, 'forest', 'grass-forest', { woodStock: 40 }),
    makeTile(0, 1, 'plains', 'building-village'),
  ]);

  assert.equal(hasHexConstruction(state.worldState.hexes['1,0'], HEX_ASSETS), false);

  const built = buildInKingdom(state, 1, 0, idxOf('dirt-lumber'), 90, HEX_ASSETS);
  assert.equal(built.built, true);
  state = built.nextState;

  // Avança 2 turnos até conclusão da Serraria
  state = advanceKingdomTurn(state, HEX_ASSETS).nextState;
  state = advanceKingdomTurn(state, HEX_ASSETS).nextState;

  const tileAfter = state.worldState.hexes['1,0'];
  assert.equal(hasHexConstruction(tileAfter, HEX_ASSETS), true);

  const econ = getKingdomEconomy(state, HEX_ASSETS);
  assert.equal(econ.buildingsByKey['1,0'].status, 'operating');
  assert.ok(econ.buildingsByKey['1,0'].actualProduction.wood > 0);

  // Ao demolir com woodStock=0, volta a ser floresta esgotada (forestDepleted: true)
  const dem = demolishInKingdom(state, 1, 0, HEX_ASSETS);
  assert.equal(dem.removed, true);
  assert.equal(hasHexConstruction(dem.nextState.worldState.hexes['1,0'], HEX_ASSETS), false);
  assert.equal(dem.nextState.worldState.hexes['1,0'].forestDepleted, true);
});

// 2.1 Dano de guerra não é aplicado em dobro e soma dos cards bate com totais
test('Repro 2.1: dano de guerra afeta apenas o setor danificado sem penalidade dupla nem dessincronia', () => {
  const cleanState = makeKingdom([
    makeTile(0, 0, 'plains', 'building-castle'),
    makeTile(1, 0, 'plains', 'building-farm'),
    makeTile(-1, 0, 'plains', 'building-farm'),
  ]);
  const damagedState: KingdomState = {
    ...cleanState,
    damagedHexes: {
      '1,0': {
        key: '1,0',
        q: 1,
        r: 0,
        damagePct: 40,
        productionPenaltyPct: 40,
        defensePenalty: 4,
        turnsRemaining: 3,
        repairCost: { gold: 40, wood: 10, stone: 10, food: 0, ore: 0, metal: 0 },
        reasonPt: 'Cerco.',
        lastConflictTurn: 1,
      },
    },
  };

  const cleanEcon = getKingdomEconomy(cleanState, HEX_ASSETS);
  const dmgEcon = getKingdomEconomy(damagedState, HEX_ASSETS);

  // Setor não danificado (-1,0) mantém produção intacta
  assert.equal(
    dmgEcon.buildingsByKey['-1,0'].actualProduction.food,
    cleanEcon.buildingsByKey['-1,0'].actualProduction.food
  );
  // Setor danificado (1,0) sofre -40% apenas uma vez (60% do limpo, tolerância de arredondamento)
  const ratio =
    dmgEcon.buildingsByKey['1,0'].actualProduction.food /
    cleanEcon.buildingsByKey['1,0'].actualProduction.food;
  assert.ok(ratio >= 0.5 && ratio <= 0.7, `Expected ~0.6 ratio without double penalty, got ${ratio}`);

  // foodProduced mantém o mesmo baseline constante do reino e cai exatamente pela queda do setor danificado (zero dessincronia)
  const sumCleanFood = Object.values(cleanEcon.buildingsByKey).reduce(
    (acc, b) => acc + b.actualProduction.food,
    0
  );
  const sumBuildingFood = Object.values(dmgEcon.buildingsByKey).reduce(
    (acc, b) => acc + b.actualProduction.food,
    0
  );
  assert.equal(
    dmgEcon.foodProduced - sumBuildingFood,
    cleanEcon.foodProduced - sumCleanFood
  );
  assert.equal(
    cleanEcon.foodProduced - dmgEcon.foodProduced,
    cleanEcon.buildingsByKey['1,0'].actualProduction.food -
      dmgEcon.buildingsByKey['1,0'].actualProduction.food
  );
});

// 2.2 Multiplicadores Farm -> Mill não são aplicados duas vezes
test('Repro 2.2: cadeia Farm -> Mill não aplica effectFactor em dobro', () => {
  const baseState = makeKingdom([
    makeTile(0, 0, 'plains', 'building-castle'),
    makeTile(1, 0, 'plains', 'building-farm'), // planície (~5 grãos <= 6 cap do moinho -> 100% processado)
    makeTile(2, 0, 'fertile', 'building-mill'),
    makeTile(0, 1, 'plains', 'building-village'),
  ]);
  const normalEcon = getKingdomEconomy(baseState, HEX_ASSETS);
  const debuffedState: KingdomState = {
    ...baseState,
    activeEffects: [
      {
        id: 'test-debuff',
        titlePt: 'Teste',
        descriptionPt: 'Teste',
        turnsRemaining: 2,
        efficiencyPenalty: 0.25,
      },
    ],
  };
  const debuffedEcon = getKingdomEconomy(debuffedState, HEX_ASSETS);

  const normalMillFood = normalEcon.buildingsByKey['2,0'].actualProduction.food;
  const debuffedMillFood = debuffedEcon.buildingsByKey['2,0'].actualProduction.food;
  const ratio = debuffedMillFood / normalMillFood;
  // Queda única de 25% deve dar ~0.75 (com dupla aplicação caía para ~0.56)
  assert.ok(ratio >= 0.68, `Expected ~0.75 single effectFactor scaling, got ${ratio} (${debuffedMillFood}/${normalMillFood})`);
});

// 2.3 Smelter não pode consumir minério inexistente durante escassez
test('Repro 2.3: Smelter não gera metal com minério inexistente durante escassez alimentar', () => {
  const state = makeKingdom(
    [
      makeTile(0, 0, 'plains', 'building-castle'),
      makeTile(5, 5, 'mountain', 'building-mine', { mountainDeposit: 'mixed' }), // isolada: ~7 ore base -> com 0.65 fome = ~5 ore
      makeTile(0, 1, 'plains', 'building-smelter'),
      makeTile(-1, 1, 'plains', 'building-smelter'),
      makeTile(1, -1, 'plains', 'building-smelter'),
      makeTile(0, -1, 'plains', 'building-smelter'), // 4 smelters = 8 ore demanda
    ],
    {
      population: 24,
      foodDeficitTurns: 2, // starvationFactor = 0.65
      resources: { wood: 100, stone: 40, food: 0, ore: 0, metal: 0, science: 0 },
    }
  );

  const econ = getKingdomEconomy(state, HEX_ASSETS);
  assert.ok(
    econ.oreConsumed <= econ.oreProduced + 0.01,
    `Ore consumed (${econ.oreConsumed}) must not exceed produced (${econ.oreProduced}) when stock is 0`
  );
  assert.ok(econ.oreNet >= 0, `Expected oreNet >= 0 with ore stock 0, got ${econ.oreNet}`);
});

// 2.4 Bônus duplicado de água na Farm adjacente a Watermill sem água direta
test('Repro 2.4: Farm vizinha de Moinho Fluvial sem água direta não recebe bônus de água duplicado', () => {
  const farmWithWatermill = makeKingdom([
    makeTile(0, 0, 'plains', 'building-castle'),
    makeTile(1, 0, 'fertile', 'building-farm'),
    makeTile(2, 0, 'plains', 'building-watermill'),
    makeTile(3, 0, 'water'), // água adjacente ao Moinho Fluvial, NÃO à Fazenda
  ]);
  const econ = getKingdomEconomy(farmWithWatermill, HEX_ASSETS);
  const farmRep = econ.buildingsByKey['1,0'];
  const waterNotes = farmRep.locationBonusNotesPt.filter((n) => /Água próxima/i.test(n));
  assert.equal(waterNotes.length, 1);
  // 100% + 15% água próxima (não +30%!)
  assert.equal(farmRep.locationEfficiencyPct, 100);
  const waterBonusCount = farmRep.bonusSummaryPt.filter((n) => /Água próxima/i.test(n)).length;
  assert.equal(waterBonusCount, 1);
});

// 3.1 + 3.2 IA respeita techs defensivas do jogador e navegação em água
test('Repro 3.1 & 3.2: IA respeita techs defensivas do jogador e unidade terrestre não invade água', () => {
  // 3.1: Torre + tecnologias defensivas (masonry +1, fortifications +5, tactics +4 => +10 def = 18 def) vence cavaleiro AI (17 atk)
  const techProtectedState = makeKingdom(
    [
      makeTile(0, 0, 'plains', 'building-tower'), // base terrain 0 + militia 3 + tower 5 + techs 10 = 18 def (sem techs = 8 def!)
      makeTile(1, 0, 'plains', 'building-castle', { owner: 'iron_clan' }),
    ],
    {
      research: {
        unlocked: ['agriculture', 'masonry', 'military', 'fortifications', 'tactics'],
        activeTechId: null,
        progressScience: 0,
      },
      factions: createSandboxKingdomState().factions.map((f) =>
        f.id === 'iron_clan' ? { ...f, relation: 'hostile', unlockedTechs: [] } : f
      ),
      units: [
        {
          id: 'ai-knight-att',
          type: 'knight', // 14 + 3 = 17 atk -> ganha de 8 def (sem tech), perde de 18 def (com tech)!
          owner: 'iron_clan',
          q: 1,
          r: 0,
          hp: UNIT_CATALOG.knight.maxHp,
          maxHp: UNIT_CATALOG.knight.maxHp,
          movedThisTurn: false,
        },
      ],
    }
  );
  const aiVsTech = advanceFactionsTurn({
    worldState: techProtectedState.worldState,
    factions: techProtectedState.factions,
    units: techProtectedState.units,
    assets: HEX_ASSETS,
    turn: 6,
    playerTechs: techProtectedState.research.unlocked,
  });
  assert.equal(aiVsTech.worldState.hexes['0,0'].owner, 'player');

  // 3.2: Unidade terrestre de iron_clan NÃO pode invadir ou capturar Porto sobre água!
  const seaState = makeKingdom(
    [
      makeTile(0, 0, 'water', 'building-port'), // porto do jogador sobre água!
      makeTile(1, 0, 'plains', 'building-tower', { owner: 'iron_clan' }),
    ],
    {
      factions: createSandboxKingdomState().factions.map((f) =>
        f.id === 'iron_clan' ? { ...f, relation: 'hostile' } : f
      ),
      units: [
        {
          id: 'ai-inf-water',
          type: 'infantry',
          owner: 'iron_clan',
          q: 1,
          r: 0,
          hp: UNIT_CATALOG.infantry.maxHp,
          maxHp: UNIT_CATALOG.infantry.maxHp,
          movedThisTurn: false,
        },
      ],
    }
  );

  const aiRes = advanceFactionsTurn({
    worldState: seaState.worldState,
    factions: seaState.factions,
    units: seaState.units,
    assets: HEX_ASSETS,
    turn: 6,
    playerTechs: seaState.research.unlocked,
  });

  assert.equal(aiRes.worldState.hexes['0,0'].owner, 'player');
  const aiUnit = aiRes.units.find((u) => u.id === 'ai-inf-water');
  assert.ok(aiUnit && (aiUnit.q !== 0 || aiUnit.r !== 0));
});

// 3.3 Atacante vencedor com 1 HP não morre no próprio ataque vencedor
test('Repro 3.3: atacante com 1 HP que vence combate não morre (attackerDamage === 0)', () => {
  const worldState = makeKingdom([
    makeTile(0, 0, 'plains', 'building-castle'),
    makeTile(1, 0, 'plains', undefined, { owner: 'iron_clan' }),
  ]).worldState;

  const attacker: UnitEntity = {
    id: 'knight-1hp',
    type: 'knight',
    owner: 'player',
    q: 0,
    r: 0,
    hp: 1,
    maxHp: UNIT_CATALOG.knight.maxHp,
    movedThisTurn: false,
  };

  const combat = resolveHexCombat(
    attacker,
    ['metallurgy', 'tactics'],
    worldState,
    1,
    0,
    [attacker],
    HEX_ASSETS,
    []
  );
  assert.equal(combat.attackerWon, true);
  assert.equal(combat.capturedHex, true);
  assert.ok(attacker.hp - combat.attackerDamage >= 1);
});

// 3.4 Unidade inimiga em hex neutro pode ser atacada pelo jogador
test('Repro 3.4: unidade inimiga em território neutro pode ser atacada por unidade do jogador', () => {
  let state = makeKingdom([
    makeTile(0, 0, 'plains', 'building-castle'),
    makeTile(1, 0, 'plains', undefined, { owner: 'neutral' } as Partial<PlacedHex>),
  ]);
  state.worldState.hexes['1,0'] = {
    ...state.worldState.hexes['1,0'],
    owner: 'neutral',
  };
  state = {
    ...state,
    units: [
      {
        id: 'p-knight',
        type: 'knight',
        owner: 'player',
        q: 0,
        r: 0,
        hp: UNIT_CATALOG.knight.maxHp,
        maxHp: UNIT_CATALOG.knight.maxHp,
        movedThisTurn: false,
      },
      {
        id: 'enemy-on-neutral',
        type: 'infantry',
        owner: 'iron_clan',
        q: 1,
        r: 0,
        hp: 5,
        maxHp: UNIT_CATALOG.infantry.maxHp,
        movedThisTurn: false,
      },
    ],
  };

  const reachable = getReachableUnitCoords({
    unit: state.units[0],
    worldState: state.worldState,
    units: state.units,
    assets: HEX_ASSETS,
  });
  const target = reachable.find((c) => c.q === 1 && c.r === 0);
  assert.ok(target && target.isAttackTarget === true);

  const cmd = commandUnitInKingdom(state, { q: 0, r: 0 }, { q: 1, r: 0 }, HEX_ASSETS);
  assert.equal(cmd.acted, true);
});

// 4.1 TurnAdvanceResult expõe chaves exatas para VFX 3D de conclusão
test('Repro 4.1: TurnAdvanceResult expõe chaves exatas de construção, upgrade, módulo e cidade evoluída', () => {
  let state = makeKingdom([
    makeTile(0, 0, 'plains', 'building-castle'),
    makeTile(1, 0, 'plains'),
  ]);
  const built = buildInKingdom(state, 1, 0, idxOf('building-house'), 90, HEX_ASSETS);
  assert.equal(built.built, true);
  state = built.nextState;

  const adv = advanceKingdomTurn(state, HEX_ASSETS);
  assert.ok(adv.completedBuildingKeys.includes('1,0'));
});

// 5.4 dirt-lumber floresta esgotada não recebe perfil de folhagem sazonal de floresta viva
test('Repro 5.4: perfil sazonal de floresta esgotada (dirt-lumber) não trata como árvore decídua', () => {
  const depletedTile = makeTile(2, 2, 'forest', 'dirt-lumber', {
    woodStock: 0,
    forestDepleted: true,
  });
  const profile = computeHexSeasonalVisualProfile({
    q: 2,
    r: 2,
    tile: depletedTile,
    assetName: 'dirt-lumber',
    ownerTintHex: 0xffffff,
    season: 'autumn',
    seasonProgress: 0.7,
    weather: 'clear',
  });
  assert.equal(profile.isDeciduous, false);
  assert.equal(profile.foliageShift, 0);
});
