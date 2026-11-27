import test from 'node:test';
import assert from 'node:assert/strict';
import { HEX_ASSETS } from './repo-data';
import {
  DEFAULT_ROTATION_DEG,
  hexKey,
  type PlacedHex,
} from './hex-engine';
import {
  DEFAULT_FOREST_WOOD_STOCK,
  TERRAIN_METADATA,
  getMountainDepositType,
  type TerrainType,
} from './terrain-engine';
import {
  advanceKingdomTurn,
  createSandboxKingdomState,
  getKingdomEconomy,
  type KingdomState,
} from './kingdom-engine';
import { computeMarketSummary } from './trade-engine';

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
      unlocked: [
        'agriculture',
        'masonry',
        'forestry',
        'mining',
        'metallurgy',
        'trade',
        'sailing',
      ],
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

test('Fazenda funciona plenamente em Fértil e com rendimento reduzido em Planície', () => {
  const fertileKingdom = makeKingdom([
    makeTile(0, 0, 'plains', 'building-castle'),
    makeTile(1, 0, 'fertile', 'building-farm'),
    makeTile(-1, 0, 'plains', 'building-village'),
  ]);
  const plainsKingdom = makeKingdom([
    makeTile(0, 0, 'plains', 'building-castle'),
    makeTile(1, 0, 'plains', 'building-farm'),
    makeTile(-1, 0, 'plains', 'building-village'),
  ]);

  const fertileEcon = getKingdomEconomy(fertileKingdom, HEX_ASSETS);
  const plainsEcon = getKingdomEconomy(plainsKingdom, HEX_ASSETS);

  const fertileFarm = fertileEcon.buildingsByKey['1,0'];
  const plainsFarm = plainsEcon.buildingsByKey['1,0'];

  assert.equal(fertileFarm.status, 'operating');
  assert.equal(plainsFarm.status, 'operating');
  assert.ok(fertileFarm.actualProduction.food > plainsFarm.actualProduction.food);
  assert.ok(plainsFarm.actualProduction.food >= 4);
});

test('Fazenda + Água gera irrigação real aumentando produção', () => {
  const dryKingdom = makeKingdom([
    makeTile(0, 0, 'plains', 'building-castle'),
    makeTile(1, 0, 'fertile', 'building-farm'),
    makeTile(-1, 0, 'plains', 'building-village'),
  ]);
  const irrigatedKingdom = makeKingdom([
    makeTile(0, 0, 'plains', 'building-castle'),
    makeTile(1, 0, 'fertile', 'building-farm'),
    makeTile(2, 0, 'water'),
    makeTile(1, 1, 'water'),
    makeTile(-1, 0, 'plains', 'building-village'),
  ]);

  const dryEcon = getKingdomEconomy(dryKingdom, HEX_ASSETS);
  const irrigatedEcon = getKingdomEconomy(irrigatedKingdom, HEX_ASSETS);

  assert.ok(
    irrigatedEcon.buildingsByKey['1,0'].actualProduction.food >
      dryEcon.buildingsByKey['1,0'].actualProduction.food
  );
  assert.ok(
    irrigatedEcon.buildingsByKey['1,0'].locationBonusNotesPt.some((n) => /Irriga/i.test(n))
  );
});

test('Fazenda + Moinho processa grão limitado, preserva excedente bruto e Moinho d água exige Água com capacidade maior', () => {
  const millKingdom = makeKingdom([
    makeTile(0, 0, 'plains', 'building-castle'),
    makeTile(1, 0, 'fertile', 'building-farm'),
    makeTile(2, 0, 'fertile', 'building-mill'),
    makeTile(1, -1, 'water'),
    makeTile(0, 1, 'plains', 'building-village'),
  ]);
  const watermillKingdom = makeKingdom([
    makeTile(0, 0, 'plains', 'building-castle'),
    makeTile(1, 0, 'fertile', 'building-farm'),
    makeTile(2, 0, 'fertile', 'building-watermill'),
    makeTile(2, -1, 'water'),
    makeTile(1, -1, 'water'),
    makeTile(0, 1, 'plains', 'building-village'),
  ]);

  const farmOnlyKingdom = makeKingdom([
    makeTile(0, 0, 'plains', 'building-castle'),
    makeTile(1, 0, 'fertile', 'building-farm'),
    makeTile(1, -1, 'water'),
    makeTile(0, 1, 'plains', 'building-village'),
  ]);

  const farmOnlyEcon = getKingdomEconomy(farmOnlyKingdom, HEX_ASSETS);
  const millEcon = getKingdomEconomy(millKingdom, HEX_ASSETS);
  const watermillEcon = getKingdomEconomy(watermillKingdom, HEX_ASSETS);

  // Farm produces grain in excess of Mill capacity (6), keeping raw grain on Farm
  assert.ok(millEcon.grainChain.grainProcessedByMillKey['2,0'] > 0);
  assert.ok(millEcon.grainChain.excessGrainByFarmKey['1,0'] > 0);
  assert.ok(millEcon.buildingsByKey['1,0'].actualProduction.food > 0);
  assert.ok(
    millEcon.buildingsByKey['2,0'].actualProduction.food +
      millEcon.buildingsByKey['1,0'].actualProduction.food >
      farmOnlyEcon.buildingsByKey['1,0'].actualProduction.food
  );
  assert.ok(millEcon.buildingsByKey['2,0'].actualProduction.gold > 0);

  // Watermill has higher capacity (10 vs 6) and yields more processed food & gold
  assert.ok(
    watermillEcon.grainChain.grainProcessedByMillKey['2,0'] >
      millEcon.grainChain.grainProcessedByMillKey['2,0']
  );
  assert.ok(
    watermillEcon.buildingsByKey['2,0'].actualProduction.food >=
      millEcon.buildingsByKey['2,0'].actualProduction.food
  );
});

test('Moinho sem Fazenda fica parado e sem processamento, assim como Moinho d água sem Água', () => {
  const noFarmKingdom = makeKingdom([
    makeTile(0, 0, 'plains', 'building-castle'),
    makeTile(2, 0, 'fertile', 'building-mill'),
    makeTile(1, 0, 'plains', 'building-village'),
  ]);
  const dryWatermillKingdom = makeKingdom([
    makeTile(0, 0, 'plains', 'building-castle'),
    makeTile(1, 0, 'fertile', 'building-farm'),
    makeTile(2, 0, 'fertile', 'building-watermill'),
    makeTile(0, 1, 'plains', 'building-village'),
  ]);

  const noFarmEcon = getKingdomEconomy(noFarmKingdom, HEX_ASSETS);
  assert.equal(noFarmEcon.buildingsByKey['2,0'].status, 'idle');
  assert.equal(noFarmEcon.buildingsByKey['2,0'].actualProduction.food, 0);
  assert.equal(noFarmEcon.buildingsByKey['2,0'].actualProduction.gold, 0);

  const dryWatermillEcon = getKingdomEconomy(dryWatermillKingdom, HEX_ASSETS);
  assert.equal(dryWatermillEcon.buildingsByKey['2,0'].status, 'idle');
  assert.equal(dryWatermillEcon.buildingsByKey['2,0'].actualProduction.food, 0);
});

test('Curral consome pool de pasto e dois Currais dividem o mesmo pool finito', () => {
  const singleCurral = makeKingdom([
    makeTile(0, 0, 'plains', 'building-castle'),
    makeTile(1, 0, 'plains', 'building-sheep'),
    makeTile(2, 0, 'plains'),
    makeTile(1, 1, 'plains'), // 2 planícies abertas = capacidade de pasto suficiente (>= 4)
    makeTile(0, 1, 'plains', 'building-village'),
  ]);

  // One tiny shared plains tile at (2, 0) adjacent to two Currais at (1, 0) and (2, -1),
  // with remaining surrounding hexes non-plains so total pool capacity stays scarce (= 3)
  const sharedSinglePasture = makeKingdom([
    makeTile(0, 0, 'water', 'building-castle'),
    makeTile(0, 1, 'water'),
    makeTile(1, 0, 'fertile', 'building-sheep'),
    makeTile(2, 0, 'plains'), // capacity 3, shared!
    makeTile(2, -1, 'fertile', 'building-sheep'),
    makeTile(1, -1, 'water'),
    makeTile(3, -1, 'water'),
    makeTile(3, 0, 'water'),
  ]);

  const singleEcon = getKingdomEconomy(singleCurral, HEX_ASSETS);
  assert.equal(singleEcon.buildingsByKey['1,0'].status, 'operating');
  assert.ok(singleEcon.buildingsByKey['1,0'].actualProduction.food > 0);
  assert.ok(singleEcon.buildingsByKey['1,0'].actualProduction.gold > 0);

  const sharedEcon = getKingdomEconomy(sharedSinglePasture, HEX_ASSETS);
  const pasture1 = sharedEcon.adjacencyPools.pasture.consumersByKey['1,0'];
  const pasture2 = sharedEcon.adjacencyPools.pasture.consumersByKey['2,-1'];
  assert.ok(pasture1 && pasture2);
  assert.ok(pasture1.sharedWithConsumerKeys.includes('2,-1'));
  assert.ok(pasture2.sharedWithConsumerKeys.includes('1,0'));
  assert.ok(
    pasture1.allocated + pasture2.allocated <=
      sharedEcon.adjacencyPools.pasture.totalCapacity + 1e-6
  );
  // Both get partial (~1.5 / 4 = 0.375 of demand) rather than duplicating full output
  assert.ok(pasture1.fulfillmentRatio < 1);
  assert.ok(pasture2.fulfillmentRatio < 1);
});

test('Serraria consome estoque finito da Floresta e Floresta esgotada impede produção', () => {
  // Floresta em (1,0) adjacente à Serraria em (0,1), ambas com madeira baixa (3 no adjacente, 0 na própria telha da serraria)
  let state = makeKingdom([
    makeTile(0, 0, 'plains', 'building-castle'),
    makeTile(1, 0, 'forest', undefined, { woodStock: 3 }),
    makeTile(0, 1, 'forest', 'dirt-lumber', { woodStock: 0 }),
    makeTile(-1, 0, 'plains', 'building-village'),
  ]);

  const econTurn1 = getKingdomEconomy(state, HEX_ASSETS);
  assert.equal(econTurn1.buildingsByKey['0,1'].status !== 'idle', true);
  assert.ok(econTurn1.buildingsByKey['0,1'].actualProduction.wood > 0);
  assert.ok((econTurn1.forestWoodConsumptionsByKey['1,0'] ?? 0) > 0);

  // Avança 1 turno -> estoque real de (1,0) zera e transição visual/lógica vai para dirt-lumber!
  const step1 = advanceKingdomTurn(state, HEX_ASSETS);
  state = step1.nextState;
  const forestAfter = state.worldState.hexes['1,0'];
  assert.equal(forestAfter.woodStock, 0);
  assert.equal(forestAfter.forestDepleted, true);
  assert.equal(HEX_ASSETS[forestAfter.structureIndex].name, 'dirt-lumber');

  // Turno seguinte: Floresta esgotada não abastece mais a Serraria -> produção zera e status vira idle
  const econDepleted = getKingdomEconomy(state, HEX_ASSETS);
  assert.equal(econDepleted.buildingsByKey['0,1'].status, 'idle');
  assert.equal(econDepleted.buildingsByKey['0,1'].actualProduction.wood, 0);
});

test('Mina produz pedra vs minério conforme depósito e recebe escoramento da Floresta; Fundição transforma minério em metal consumindo combustível de madeira', () => {
  const stoneMineKingdom = makeKingdom([
    makeTile(0, 0, 'plains', 'building-castle'),
    makeTile(1, 0, 'mountain', 'building-mine', { mountainDeposit: 'stone' }),
    makeTile(0, 1, 'plains', 'building-village'),
  ]);
  const oreMineNoForest = makeKingdom([
    makeTile(0, 0, 'plains', 'building-castle'),
    makeTile(1, 0, 'mountain', 'building-mine', { mountainDeposit: 'ore' }),
    makeTile(0, 1, 'plains', 'building-village'),
  ]);
  const oreMineWithForestAndSmelter = makeKingdom([
    makeTile(0, 0, 'plains', 'building-castle'),
    makeTile(1, 0, 'mountain', 'building-mine', { mountainDeposit: 'ore' }),
    makeTile(2, 0, 'forest', undefined, { woodStock: 10 }),
    makeTile(1, 1, 'plains', 'building-smelter'),
    makeTile(0, 1, 'plains', 'building-village'),
  ]);

  assert.equal(
    getMountainDepositType(1, 0, stoneMineKingdom.worldState.hexes['1,0'], HEX_ASSETS),
    'stone'
  );
  assert.equal(
    getMountainDepositType(1, 0, oreMineNoForest.worldState.hexes['1,0'], HEX_ASSETS),
    'ore'
  );

  const stoneEcon = getKingdomEconomy(stoneMineKingdom, HEX_ASSETS);
  const oreNoForestEcon = getKingdomEconomy(oreMineNoForest, HEX_ASSETS);
  const fullChainEcon = getKingdomEconomy(oreMineWithForestAndSmelter, HEX_ASSETS);

  assert.ok(stoneEcon.buildingsByKey['1,0'].actualProduction.stone >= 6);
  assert.equal(stoneEcon.buildingsByKey['1,0'].actualProduction.ore, 0);

  assert.ok(oreNoForestEcon.buildingsByKey['1,0'].actualProduction.ore >= 6);
  assert.ok(
    fullChainEcon.buildingsByKey['1,0'].actualProduction.ore >=
      oreNoForestEcon.buildingsByKey['1,0'].actualProduction.ore
  );
  assert.ok(
    fullChainEcon.buildingsByKey['1,0'].locationBonusNotesPt.some((n) => /Escoramento/i.test(n))
  );

  // Fundição produz metal consumindo minério e combustível real da Floresta adjacente (2,0)
  const smelterRep = fullChainEcon.buildingsByKey['1,1'];
  assert.equal(smelterRep.status, 'operating');
  assert.ok(smelterRep.actualProduction.metal >= 3);
  assert.equal(smelterRep.inputConsumed.ore, 2);
  assert.ok((smelterRep.inputConsumed.wood ?? 0) > 0);
  assert.ok((fullChainEcon.forestWoodConsumptionsByKey['2,0'] ?? 0) > 0);

  const afterSmelt = advanceKingdomTurn(oreMineWithForestAndSmelter, HEX_ASSETS).nextState;
  assert.ok((afterSmelt.worldState.hexes['2,0'].woodStock ?? 99) < 10);

  // Sem minério e sem madeira (reino zerado e sem floresta): Fundição paralisa
  const starvedSmelter = makeKingdom(
    [
      makeTile(0, 0, 'plains', 'building-castle'),
      makeTile(1, 1, 'plains', 'building-smelter'),
      makeTile(0, 1, 'plains', 'building-village'),
    ],
    {
      resources: { wood: 0, stone: 40, food: 120, ore: 0, metal: 0, science: 0 },
    }
  );
  const starvedEcon = getKingdomEconomy(starvedSmelter, HEX_ASSETS);
  assert.equal(starvedEcon.buildingsByKey['1,1'].status, 'idle');
  assert.equal(starvedEcon.buildingsByKey['1,1'].actualProduction.metal, 0);
});

test('Doca consome pool de pesca e duas Docas dividem o mesmo pool', () => {
  const oneDock = makeKingdom([
    makeTile(0, 0, 'plains', 'building-castle'),
    makeTile(1, 0, 'plains', 'building-dock'),
    makeTile(2, 0, 'water'),
    makeTile(2, -1, 'water'),
    makeTile(0, 1, 'plains', 'building-village'),
  ]);

  // Dois hexes de Doca disputam um único hex de Água em (2, 0) sem outras Águas ao redor
  const twoDocksOneWater = makeKingdom([
    makeTile(0, 0, 'plains', 'building-castle'),
    makeTile(1, 0, 'plains', 'building-dock'),
    makeTile(2, -1, 'plains', 'building-dock'),
    makeTile(2, 0, 'water'),
    makeTile(0, 1, 'plains', 'building-village'),
  ]);

  const oneEcon = getKingdomEconomy(oneDock, HEX_ASSETS);
  assert.equal(oneEcon.buildingsByKey['1,0'].status, 'operating');
  assert.ok(oneEcon.buildingsByKey['1,0'].actualProduction.food > 0);

  const twoEcon = getKingdomEconomy(twoDocksOneWater, HEX_ASSETS);
  const f1 = twoEcon.adjacencyPools.fishing.consumersByKey['1,0'];
  const f2 = twoEcon.adjacencyPools.fishing.consumersByKey['2,-1'];
  assert.ok(f1 && f2);
  assert.ok(f1.sharedWithConsumerKeys.includes('2,-1'));
  assert.ok(f2.sharedWithConsumerKeys.includes('1,0'));
  assert.ok(
    f1.allocated + f2.allocated <= twoEcon.adjacencyPools.fishing.totalCapacity + 1e-6
  );
  assert.ok(f1.fulfillmentRatio < 1);
  assert.ok(f2.fulfillmentRatio < 1);
});

test('Mercado comercializa produtores sem gerar recursos físicos; variedade supera repetição e dois Mercados dividem demanda', () => {
  // Variedade: Farm (food) + Serraria (wood) + Mina (mineral)
  const diverseKingdom = makeKingdom([
    makeTile(0, 0, 'plains', 'building-castle'),
    makeTile(1, 0, 'plains', 'building-market'),
    makeTile(1, -1, 'fertile', 'building-farm'),
    makeTile(2, -1, 'forest', 'dirt-lumber'),
    makeTile(2, 0, 'mountain', 'building-mine', { mountainDeposit: 'ore' }),
    makeTile(0, 1, 'plains', 'building-village'),
  ]);

  // Repetição: 3 Fazendas ao redor do Mercado
  const duplicateKingdom = makeKingdom([
    makeTile(0, 0, 'plains', 'building-castle'),
    makeTile(1, 0, 'plains', 'building-market'),
    makeTile(1, -1, 'fertile', 'building-farm'),
    makeTile(2, -1, 'fertile', 'building-farm'),
    makeTile(2, 0, 'fertile', 'building-farm'),
    makeTile(0, 1, 'plains', 'building-village'),
  ]);

  const diverseEcon = getKingdomEconomy(diverseKingdom, HEX_ASSETS);
  const dupEcon = getKingdomEconomy(duplicateKingdom, HEX_ASSETS);

  const divMarket = diverseEcon.buildingsByKey['1,0'];
  const dupMarket = dupEcon.buildingsByKey['1,0'];

  // Mercado nunca produz recursos físicos
  assert.equal(divMarket.actualProduction.food, 0);
  assert.equal(divMarket.actualProduction.wood, 0);
  assert.equal(divMarket.actualProduction.stone, 0);
  assert.equal(divMarket.actualProduction.ore, 0);
  assert.equal(divMarket.actualProduction.metal, 0);

  // Variedade supera produtores iguais tanto na saída local quanto no resumo comercial global
  const divRep = diverseEcon.commerceChain.marketsByKey['1,0'];
  const dupRep = dupEcon.commerceChain.marketsByKey['1,0'];
  assert.equal(divRep.distinctProductTypes.length, 3);
  assert.equal(dupRep.distinctProductTypes.length, 1);
  assert.ok(divRep.varietyMultiplier > dupRep.varietyMultiplier);
  assert.ok(divMarket.actualProduction.gold > dupMarket.actualProduction.gold);

  const divSummary = computeMarketSummary({
    worldState: diverseKingdom.worldState,
    resources: diverseKingdom.resources,
    economy: diverseEcon,
    unlockedTechs: ['trade'],
    factions: diverseKingdom.factions,
    activeEffects: diverseKingdom.activeEffects,
    assets: HEX_ASSETS,
  });
  const dupSummary = computeMarketSummary({
    worldState: duplicateKingdom.worldState,
    resources: duplicateKingdom.resources,
    economy: dupEcon,
    unlockedTechs: ['trade'],
    factions: duplicateKingdom.factions,
    activeEffects: duplicateKingdom.activeEffects,
    assets: HEX_ASSETS,
  });
  assert.ok(divSummary.tradeBonusPercent > dupSummary.tradeBonusPercent);

  // Dois Mercados vizinhos dividem oferta/demanda local
  const sharedMarketsKingdom = makeKingdom([
    makeTile(0, 0, 'plains', 'building-castle'),
    makeTile(1, 0, 'plains', 'building-market'),
    makeTile(1, -1, 'plains', 'building-market'),
    makeTile(2, -1, 'plains', 'building-village'), // adjacente a ambos (dist=1)
    makeTile(2, 0, 'fertile', 'building-farm'), // adjacente a ambos (dist=1)
  ]);

  const sharedMarketsEcon = getKingdomEconomy(sharedMarketsKingdom, HEX_ASSETS);
  const m1 = sharedMarketsEcon.commerceChain.marketsByKey['1,0'];
  const m2 = sharedMarketsEcon.commerceChain.marketsByKey['1,-1'];
  assert.ok(m1.sharedWithMarketKeys.includes('1,-1'));
  assert.ok(m2.sharedWithMarketKeys.includes('1,0'));
  assert.ok(
    m1.allocatedDemandUnits + m2.allocatedDemandUnits <=
      sharedMarketsEcon.commerceChain.demandPool.totalCapacity + 1e-6
  );
  // Vila em (2,-1) fornece trabalhadores locais às estruturas adjacentes
  assert.ok(sharedMarketsEcon.adjacencyPools.villagesByKey['2,-1'].workerSupply > 0);
  assert.ok(
    (sharedMarketsEcon.adjacencyPools.workers.consumersByKey['2,0']?.allocated ?? 0) > 0
  );
  assert.ok((sharedMarketsEcon.buildingsByKey['2,0'].localWorkersFromVillages ?? 0) > 0);
});

test('Ônus de poluição e predação funcionam e estruturas defensivas mitigam predação no Curral', () => {
  // Predação da Floresta no Curral vs mitigação com Arquearia/Torre
  const unprotectedCurral = makeKingdom([
    makeTile(0, 0, 'plains', 'building-castle'),
    makeTile(1, 0, 'plains', 'building-sheep'),
    makeTile(2, 0, 'forest'),
    makeTile(1, 1, 'plains'), // pasto aberto
    makeTile(2, -1, 'plains'), // pasto aberto suficiente para manter pasto cheio
    makeTile(0, 1, 'plains', 'building-village'),
  ]);
  const protectedCurral = makeKingdom([
    makeTile(0, 0, 'plains', 'building-castle'),
    makeTile(1, 0, 'plains', 'building-sheep'),
    makeTile(2, 0, 'forest'),
    makeTile(1, 1, 'plains'),
    makeTile(2, -1, 'plains'),
    makeTile(1, -1, 'plains', 'building-archery'), // guarda adjacente sem remover pasto
    makeTile(0, 1, 'plains', 'building-village'),
  ]);

  const unprotEcon = getKingdomEconomy(unprotectedCurral, HEX_ASSETS);
  const protEcon = getKingdomEconomy(protectedCurral, HEX_ASSETS);
  assert.ok(
    protEcon.buildingsByKey['1,0'].actualProduction.food >
      unprotEcon.buildingsByKey['1,0'].actualProduction.food
  );
  assert.ok(
    unprotEcon.buildingsByKey['1,0'].locationBonusNotesPt.some((n) => /Predação/i.test(n))
  );
  assert.ok(
    protEcon.buildingsByKey['1,0'].locationBonusNotesPt.some((n) =>
      /neutralizada|Guarda|Proteção/i.test(n)
    )
  );

  // Poluição da Fundição e Mina reduzindo pesca na Água e trabalhadores/saúde na Vila
  const cleanDockAndVillage = makeKingdom([
    makeTile(0, 0, 'plains', 'building-castle'),
    makeTile(1, 0, 'plains', 'building-dock'),
    makeTile(2, 0, 'water'),
    makeTile(2, -1, 'water'),
    makeTile(0, 1, 'plains', 'building-village'),
  ]);
  const pollutedDockAndVillage = makeKingdom([
    makeTile(0, 0, 'plains', 'building-castle'),
    makeTile(1, 0, 'plains', 'building-dock'),
    makeTile(2, 0, 'water'),
    makeTile(2, -1, 'water'),
    makeTile(1, 1, 'plains', 'building-smelter'), // polui (2,0) e (0,1)!
    makeTile(2, 1, 'mountain', 'building-mine', { mountainDeposit: 'ore' }), // contamina (2,0)!
    makeTile(0, 1, 'plains', 'building-village'),
  ]);

  const cleanEcon = getKingdomEconomy(cleanDockAndVillage, HEX_ASSETS);
  const pollutedEcon = getKingdomEconomy(pollutedDockAndVillage, HEX_ASSETS);

  assert.ok(
    pollutedEcon.adjacencyPools.waterByKey['2,0'].pollutionPenaltyPct > 0
  );
  assert.ok(
    pollutedEcon.adjacencyPools.waterByKey['2,0'].totalCapacity <
      cleanEcon.adjacencyPools.waterByKey['2,0'].totalCapacity
  );
  assert.ok(
    pollutedEcon.adjacencyPools.villagesByKey['0,1'].pollutionPenaltyPct > 0
  );
  assert.ok(
    pollutedEcon.adjacencyPools.villagesByKey['0,1'].workerSupply <
      cleanEcon.adjacencyPools.villagesByKey['0,1'].workerSupply
  );
});
