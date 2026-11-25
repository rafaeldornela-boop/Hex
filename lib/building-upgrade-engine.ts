import type { HexAssetEntry } from './godot-docs';
import {
  BUILDING_CATALOG,
  getBuildingDefinition,
  type BuildingDefinition,
  type BuildingProduction,
  type ResourceCost,
} from './buildings-catalog';
import { canAffordCost, type KingdomResources } from './economy-engine';
import { hexKey, hasHexConstruction, type AxialCoord, type HexWorldState, type PlacedHex } from './hex-engine';
import { AXIAL_DIRECTIONS } from './territory-engine';
import { getHexTerrainAndResource } from './terrain-engine';
import { TECH_BY_ID, getTechModifiers, type TechId } from './tech-engine';
import type { RoadConnectivitySummary, RoadMap } from './road-engine';
import type { CityEntity } from './city-engine';

export interface BuildingUpgradeTier {
  level: number;
  titlePt: string;
  descriptionPt: string;
  upgradeCost: ResourceCost;
  upgradeTimeTurns: number;
  requiredTech: TechId | null;
  minPopulation: number;
  minCityLevel: number;
  requiresRoad: boolean;
  requiresWaterNeighbor: boolean;
  /** Multiplier applied to base production outputs when completed */
  productionMultiplier: number;
  /** Additional housing slots added on top of base building */
  housingBonus: number;
  /** Additional storage capacity added on top of base building */
  storageBonus: number;
  /** Additional defense bonus added on top of base building */
  defenseBonus: number;
  /** Additional workers required at this higher tier */
  extraWorkers: number;
  /** Additional gold maintenance per turn at this tier */
  maintenanceDelta: number;
  /** 0..0.60 reduction of winter/drought/frost penalties for this structure */
  seasonalResilience: number;
  /** Optional model upgrade hint if a compatible asset exists in repo */
  visualHint: 'plinth' | 'wing' | 'spire' | 'fortified' | 'lanterns';
}

export interface BuildingUpgradeTree {
  assetName: string;
  maxLevel: number;
  tiers: Record<number, BuildingUpgradeTier>; // keys: 2..maxLevel
}

const ZERO_COST: ResourceCost = { gold: 0, wood: 0, stone: 0, food: 0, ore: 0, metal: 0 };

function makeCost(partial: Partial<ResourceCost>): ResourceCost {
  return { ...ZERO_COST, ...partial };
}

export const BUILDING_UPGRADE_TREES: Record<string, BuildingUpgradeTree> = {
  'building-castle': {
    assetName: 'building-castle',
    maxLevel: 4,
    tiers: {
      2: {
        level: 2,
        titlePt: 'Castelo Real II — Fortaleza de Pedra',
        descriptionPt: '+40% receita, +4 População, +60 Armazém, +8 Defesa.',
        upgradeCost: makeCost({ gold: 280, wood: 25, stone: 35, metal: 4 }),
        upgradeTimeTurns: 2,
        requiredTech: 'construction',
        minPopulation: 20,
        minCityLevel: 1,
        requiresRoad: false,
        requiresWaterNeighbor: false,
        productionMultiplier: 1.4,
        housingBonus: 4,
        storageBonus: 60,
        defenseBonus: 8,
        extraWorkers: 0,
        maintenanceDelta: 2,
        seasonalResilience: 0.2,
        visualHint: 'fortified',
      },
      3: {
        level: 3,
        titlePt: 'Castelo Real III — Cidadela Real',
        descriptionPt: '+85% receita, +8 População, +140 Armazém, +16 Defesa.',
        upgradeCost: makeCost({ gold: 480, wood: 35, stone: 55, ore: 12, metal: 8 }),
        upgradeTimeTurns: 3,
        requiredTech: 'engineering',
        minPopulation: 28,
        minCityLevel: 2,
        requiresRoad: false,
        requiresWaterNeighbor: false,
        productionMultiplier: 1.85,
        housingBonus: 8,
        storageBonus: 140,
        defenseBonus: 16,
        extraWorkers: 0,
        maintenanceDelta: 4,
        seasonalResilience: 0.35,
        visualHint: 'spire',
      },
      4: {
        level: 4,
        titlePt: 'Castelo Real IV — Bastilha Imperial',
        descriptionPt: '+140% receita, +12 População, +220 Armazém, +24 Defesa.',
        upgradeCost: makeCost({ gold: 760, wood: 45, stone: 80, ore: 20, metal: 14 }),
        upgradeTimeTurns: 4,
        requiredTech: 'metallurgy',
        minPopulation: 38,
        minCityLevel: 3,
        requiresRoad: false,
        requiresWaterNeighbor: false,
        productionMultiplier: 2.4,
        housingBonus: 12,
        storageBonus: 220,
        defenseBonus: 24,
        extraWorkers: 0,
        maintenanceDelta: 7,
        seasonalResilience: 0.5,
        visualHint: 'spire',
      },
    },
  },

  'building-farm': {
    assetName: 'building-farm',
    maxLevel: 3,
    tiers: {
      2: {
        level: 2,
        titlePt: 'Fazenda II — Irrigada',
        descriptionPt: '+55% Alimento, +25 Armazém, 25% resistência ao inverno/seca.',
        upgradeCost: makeCost({ gold: 110, wood: 18, stone: 10 }),
        upgradeTimeTurns: 2,
        requiredTech: 'agriculture',
        minPopulation: 16,
        minCityLevel: 1,
        requiresRoad: false,
        requiresWaterNeighbor: false,
        productionMultiplier: 1.55,
        housingBonus: 0,
        storageBonus: 25,
        defenseBonus: 0,
        extraWorkers: 1,
        maintenanceDelta: 1,
        seasonalResilience: 0.25,
        visualHint: 'wing',
      },
      3: {
        level: 3,
        titlePt: 'Fazenda III — Agrária Avançada',
        descriptionPt: '+115% Alimento, +55 Armazém, 45% resistência climática.',
        upgradeCost: makeCost({ gold: 210, wood: 26, stone: 22, metal: 3 }),
        upgradeTimeTurns: 3,
        requiredTech: 'engineering',
        minPopulation: 24,
        minCityLevel: 1,
        requiresRoad: true,
        requiresWaterNeighbor: false,
        productionMultiplier: 2.15,
        housingBonus: 0,
        storageBonus: 55,
        defenseBonus: 0,
        extraWorkers: 1,
        maintenanceDelta: 3,
        seasonalResilience: 0.45,
        visualHint: 'plinth',
      },
    },
  },

  'building-sheep': {
    assetName: 'building-sheep',
    maxLevel: 3,
    tiers: {
      2: {
        level: 2,
        titlePt: 'Curral II — Aprisco Coberto',
        descriptionPt: '+50% Alimento e Ouro, +20 Armazém, protege rebanho no inverno.',
        upgradeCost: makeCost({ gold: 115, wood: 16, stone: 8 }),
        upgradeTimeTurns: 2,
        requiredTech: 'agriculture',
        minPopulation: 14,
        minCityLevel: 1,
        requiresRoad: false,
        requiresWaterNeighbor: false,
        productionMultiplier: 1.5,
        housingBonus: 0,
        storageBonus: 20,
        defenseBonus: 0,
        extraWorkers: 1,
        maintenanceDelta: 1,
        seasonalResilience: 0.25,
        visualHint: 'wing',
      },
      3: {
        level: 3,
        titlePt: 'Curral III — Estância Real',
        descriptionPt: '+100% Alimento e Ouro, +40 Armazém, 40% resistência climática.',
        upgradeCost: makeCost({ gold: 195, wood: 24, stone: 18, metal: 2 }),
        upgradeTimeTurns: 2,
        requiredTech: 'trade',
        minPopulation: 22,
        minCityLevel: 1,
        requiresRoad: true,
        requiresWaterNeighbor: false,
        productionMultiplier: 2.0,
        housingBonus: 0,
        storageBonus: 40,
        defenseBonus: 0,
        extraWorkers: 1,
        maintenanceDelta: 2,
        seasonalResilience: 0.4,
        visualHint: 'lanterns',
      },
    },
  },

  'building-mill': {
    assetName: 'building-mill',
    maxLevel: 3,
    tiers: {
      2: {
        level: 2,
        titlePt: 'Moinho II — Mós Reforçadas',
        descriptionPt: '+55% Alimento e Ouro, +35 Armazém para estocar safras.',
        upgradeCost: makeCost({ gold: 150, wood: 22, stone: 18 }),
        upgradeTimeTurns: 2,
        requiredTech: 'agriculture',
        minPopulation: 18,
        minCityLevel: 1,
        requiresRoad: false,
        requiresWaterNeighbor: false,
        productionMultiplier: 1.55,
        housingBonus: 0,
        storageBonus: 35,
        defenseBonus: 0,
        extraWorkers: 1,
        maintenanceDelta: 2,
        seasonalResilience: 0.25,
        visualHint: 'plinth',
      },
      3: {
        level: 3,
        titlePt: 'Moinho III — Grande Silo Real',
        descriptionPt: '+110% Alimento e Ouro, +80 Armazém e reserva contra inverno.',
        upgradeCost: makeCost({ gold: 245, wood: 28, stone: 30, metal: 4 }),
        upgradeTimeTurns: 3,
        requiredTech: 'engineering',
        minPopulation: 26,
        minCityLevel: 2,
        requiresRoad: true,
        requiresWaterNeighbor: false,
        productionMultiplier: 2.1,
        housingBonus: 0,
        storageBonus: 80,
        defenseBonus: 0,
        extraWorkers: 1,
        maintenanceDelta: 3,
        seasonalResilience: 0.45,
        visualHint: 'spire',
      },
    },
  },

  'building-cabin': {
    assetName: 'building-cabin',
    maxLevel: 2,
    tiers: {
      2: {
        level: 2,
        titlePt: 'Cabana II — Cabana Isolada',
        descriptionPt: '+3 Moradores e proteção térmica contra o frio.',
        upgradeCost: makeCost({ gold: 75, wood: 16, stone: 6 }),
        upgradeTimeTurns: 1,
        requiredTech: null,
        minPopulation: 12,
        minCityLevel: 1,
        requiresRoad: false,
        requiresWaterNeighbor: false,
        productionMultiplier: 1.0,
        housingBonus: 3,
        storageBonus: 10,
        defenseBonus: 0,
        extraWorkers: 0,
        maintenanceDelta: 1,
        seasonalResilience: 0.2,
        visualHint: 'wing',
      },
    },
  },

  'building-house': {
    assetName: 'building-house',
    maxLevel: 3,
    tiers: {
      2: {
        level: 2,
        titlePt: 'Casa II — Casa de Alvenaria',
        descriptionPt: '+4 População, +15 Armazém, reduz impacto do inverno.',
        upgradeCost: makeCost({ gold: 120, wood: 18, stone: 14 }),
        upgradeTimeTurns: 2,
        requiredTech: 'construction',
        minPopulation: 16,
        minCityLevel: 1,
        requiresRoad: false,
        requiresWaterNeighbor: false,
        productionMultiplier: 1.0,
        housingBonus: 4,
        storageBonus: 15,
        defenseBonus: 1,
        extraWorkers: 0,
        maintenanceDelta: 1,
        seasonalResilience: 0.2,
        visualHint: 'plinth',
      },
      3: {
        level: 3,
        titlePt: 'Casa III — Sobrado Urbano',
        descriptionPt: '+8 População total extra, +30 Armazém e iluminação noturna.',
        upgradeCost: makeCost({ gold: 210, wood: 24, stone: 24, metal: 3 }),
        upgradeTimeTurns: 2,
        requiredTech: 'engineering',
        minPopulation: 24,
        minCityLevel: 2,
        requiresRoad: true,
        requiresWaterNeighbor: false,
        productionMultiplier: 1.0,
        housingBonus: 8,
        storageBonus: 30,
        defenseBonus: 2,
        extraWorkers: 0,
        maintenanceDelta: 2,
        seasonalResilience: 0.35,
        visualHint: 'lanterns',
      },
    },
  },

  'building-village': {
    assetName: 'building-village',
    maxLevel: 3,
    tiers: {
      2: {
        level: 2,
        titlePt: 'Vila II — Vila Murada',
        descriptionPt: '+6 População, +45 Armazém, +50% Ouro e +2 Defesa.',
        upgradeCost: makeCost({ gold: 220, wood: 26, stone: 24, metal: 2 }),
        upgradeTimeTurns: 2,
        requiredTech: 'construction',
        minPopulation: 22,
        minCityLevel: 1,
        requiresRoad: true,
        requiresWaterNeighbor: false,
        productionMultiplier: 1.5,
        housingBonus: 6,
        storageBonus: 45,
        defenseBonus: 2,
        extraWorkers: 0,
        maintenanceDelta: 2,
        seasonalResilience: 0.25,
        visualHint: 'fortified',
      },
      3: {
        level: 3,
        titlePt: 'Vila III — Distrito Central',
        descriptionPt: '+12 População, +95 Armazém, +110% Ouro e +4 Defesa.',
        upgradeCost: makeCost({ gold: 340, wood: 35, stone: 40, metal: 5 }),
        upgradeTimeTurns: 3,
        requiredTech: 'engineering',
        minPopulation: 32,
        minCityLevel: 2,
        requiresRoad: true,
        requiresWaterNeighbor: false,
        productionMultiplier: 2.1,
        housingBonus: 12,
        storageBonus: 95,
        defenseBonus: 4,
        extraWorkers: 0,
        maintenanceDelta: 4,
        seasonalResilience: 0.4,
        visualHint: 'lanterns',
      },
    },
  },

  'unit-mansion': {
    assetName: 'unit-mansion',
    maxLevel: 2,
    tiers: {
      2: {
        level: 2,
        titlePt: 'Mansão II — Solar Real',
        descriptionPt: '+6 População, +65% Ouro, +40 Armazém e jardins iluminados.',
        upgradeCost: makeCost({ gold: 290, wood: 30, stone: 30, metal: 5 }),
        upgradeTimeTurns: 2,
        requiredTech: 'engineering',
        minPopulation: 28,
        minCityLevel: 2,
        requiresRoad: true,
        requiresWaterNeighbor: false,
        productionMultiplier: 1.65,
        housingBonus: 6,
        storageBonus: 40,
        defenseBonus: 3,
        extraWorkers: 0,
        maintenanceDelta: 3,
        seasonalResilience: 0.3,
        visualHint: 'lanterns',
      },
    },
  },

  'dirt-lumber': {
    assetName: 'dirt-lumber',
    maxLevel: 3,
    tiers: {
      2: {
        level: 2,
        titlePt: 'Serraria II — Serra Reforçada',
        descriptionPt: '+55% Madeira, +20 Armazém, opera melhor no inverno.',
        upgradeCost: makeCost({ gold: 130, wood: 12, stone: 18, metal: 2 }),
        upgradeTimeTurns: 2,
        requiredTech: 'construction',
        minPopulation: 16,
        minCityLevel: 1,
        requiresRoad: false,
        requiresWaterNeighbor: false,
        productionMultiplier: 1.55,
        housingBonus: 0,
        storageBonus: 20,
        defenseBonus: 0,
        extraWorkers: 1,
        maintenanceDelta: 2,
        seasonalResilience: 0.25,
        visualHint: 'wing',
      },
      3: {
        level: 3,
        titlePt: 'Serraria III — Complexo Madeireiro',
        descriptionPt: '+115% Madeira, +45 Armazém, exige acesso por estrada.',
        upgradeCost: makeCost({ gold: 225, wood: 16, stone: 26, ore: 8, metal: 5 }),
        upgradeTimeTurns: 3,
        requiredTech: 'engineering',
        minPopulation: 24,
        minCityLevel: 1,
        requiresRoad: true,
        requiresWaterNeighbor: false,
        productionMultiplier: 2.15,
        housingBonus: 0,
        storageBonus: 45,
        defenseBonus: 0,
        extraWorkers: 1,
        maintenanceDelta: 3,
        seasonalResilience: 0.45,
        visualHint: 'plinth',
      },
    },
  },

  'building-mine': {
    assetName: 'building-mine',
    maxLevel: 3,
    tiers: {
      2: {
        level: 2,
        titlePt: 'Mina II — Galerias Profundas',
        descriptionPt: '+55% Minério e Pedra, +30 Armazém.',
        upgradeCost: makeCost({ gold: 175, wood: 24, stone: 14, metal: 3 }),
        upgradeTimeTurns: 2,
        requiredTech: 'mining',
        minPopulation: 18,
        minCityLevel: 1,
        requiresRoad: false,
        requiresWaterNeighbor: false,
        productionMultiplier: 1.55,
        housingBonus: 0,
        storageBonus: 30,
        defenseBonus: 0,
        extraWorkers: 1,
        maintenanceDelta: 2,
        seasonalResilience: 0.25,
        visualHint: 'plinth',
      },
      3: {
        level: 3,
        titlePt: 'Mina III — Mina Mecanizada',
        descriptionPt: '+115% Minério e Pedra, +65 Armazém, ligada à malha viária.',
        upgradeCost: makeCost({ gold: 290, wood: 30, stone: 22, ore: 10, metal: 7 }),
        upgradeTimeTurns: 3,
        requiredTech: 'engineering',
        minPopulation: 26,
        minCityLevel: 2,
        requiresRoad: true,
        requiresWaterNeighbor: false,
        productionMultiplier: 2.15,
        housingBonus: 0,
        storageBonus: 65,
        defenseBonus: 1,
        extraWorkers: 1,
        maintenanceDelta: 4,
        seasonalResilience: 0.4,
        visualHint: 'spire',
      },
    },
  },

  'building-smelter': {
    assetName: 'building-smelter',
    maxLevel: 3,
    tiers: {
      2: {
        level: 2,
        titlePt: 'Fundição II — Alto-Forno',
        descriptionPt: '+60% Metal e Ouro, +30 Armazém.',
        upgradeCost: makeCost({ gold: 210, wood: 22, stone: 26, ore: 10, metal: 4 }),
        upgradeTimeTurns: 2,
        requiredTech: 'metallurgy',
        minPopulation: 20,
        minCityLevel: 1,
        requiresRoad: true,
        requiresWaterNeighbor: false,
        productionMultiplier: 1.6,
        housingBonus: 0,
        storageBonus: 30,
        defenseBonus: 0,
        extraWorkers: 1,
        maintenanceDelta: 3,
        seasonalResilience: 0.3,
        visualHint: 'spire',
      },
      3: {
        level: 3,
        titlePt: 'Fundição III — Siderúrgica Real',
        descriptionPt: '+125% Metal e Ouro, +70 Armazém.',
        upgradeCost: makeCost({ gold: 340, wood: 26, stone: 38, ore: 16, metal: 8 }),
        upgradeTimeTurns: 3,
        requiredTech: 'engineering',
        minPopulation: 30,
        minCityLevel: 2,
        requiresRoad: true,
        requiresWaterNeighbor: false,
        productionMultiplier: 2.25,
        housingBonus: 0,
        storageBonus: 70,
        defenseBonus: 1,
        extraWorkers: 1,
        maintenanceDelta: 5,
        seasonalResilience: 0.45,
        visualHint: 'lanterns',
      },
    },
  },

  'building-market': {
    assetName: 'building-market',
    maxLevel: 3,
    tiers: {
      2: {
        level: 2,
        titlePt: 'Mercado II — Mercado Coberto',
        descriptionPt: '+55% Ouro, +50 Armazém, iluminação noturna comercial.',
        upgradeCost: makeCost({ gold: 185, wood: 24, stone: 18 }),
        upgradeTimeTurns: 2,
        requiredTech: 'trade',
        minPopulation: 18,
        minCityLevel: 1,
        requiresRoad: false,
        requiresWaterNeighbor: false,
        productionMultiplier: 1.55,
        housingBonus: 0,
        storageBonus: 50,
        defenseBonus: 0,
        extraWorkers: 1,
        maintenanceDelta: 2,
        seasonalResilience: 0.25,
        visualHint: 'lanterns',
      },
      3: {
        level: 3,
        titlePt: 'Mercado III — Empório Real',
        descriptionPt: '+120% Ouro, +110 Armazém, centro de rotas comerciais.',
        upgradeCost: makeCost({ gold: 320, wood: 30, stone: 32, metal: 5 }),
        upgradeTimeTurns: 3,
        requiredTech: 'engineering',
        minPopulation: 28,
        minCityLevel: 2,
        requiresRoad: true,
        requiresWaterNeighbor: false,
        productionMultiplier: 2.2,
        housingBonus: 0,
        storageBonus: 110,
        defenseBonus: 0,
        extraWorkers: 1,
        maintenanceDelta: 4,
        seasonalResilience: 0.45,
        visualHint: 'lanterns',
      },
    },
  },

  'building-port': {
    assetName: 'building-port',
    maxLevel: 3,
    tiers: {
      2: {
        level: 2,
        titlePt: 'Porto II — Porto Comercial',
        descriptionPt: '+55% Ouro e Alimento, +60 Armazém, +2 Defesa.',
        upgradeCost: makeCost({ gold: 240, wood: 32, stone: 22, metal: 3 }),
        upgradeTimeTurns: 2,
        requiredTech: 'trade',
        minPopulation: 20,
        minCityLevel: 1,
        requiresRoad: false,
        requiresWaterNeighbor: false,
        productionMultiplier: 1.55,
        housingBonus: 0,
        storageBonus: 60,
        defenseBonus: 2,
        extraWorkers: 1,
        maintenanceDelta: 3,
        seasonalResilience: 0.25,
        visualHint: 'lanterns',
      },
      3: {
        level: 3,
        titlePt: 'Porto III — Grande Porto Real',
        descriptionPt: '+120% Ouro e Alimento, +120 Armazém, +4 Defesa.',
        upgradeCost: makeCost({ gold: 390, wood: 44, stone: 36, metal: 6 }),
        upgradeTimeTurns: 3,
        requiredTech: 'engineering',
        minPopulation: 30,
        minCityLevel: 2,
        requiresRoad: false,
        requiresWaterNeighbor: false,
        productionMultiplier: 2.2,
        housingBonus: 0,
        storageBonus: 120,
        defenseBonus: 4,
        extraWorkers: 1,
        maintenanceDelta: 5,
        seasonalResilience: 0.45,
        visualHint: 'spire',
      },
    },
  },

  'building-dock': {
    assetName: 'building-dock',
    maxLevel: 2,
    tiers: {
      2: {
        level: 2,
        titlePt: 'Doca II — Frota Pesqueira',
        descriptionPt: '+60% Alimento e Ouro, +25 Armazém, menos afetada no inverno.',
        upgradeCost: makeCost({ gold: 130, wood: 22, stone: 8 }),
        upgradeTimeTurns: 2,
        requiredTech: 'trade',
        minPopulation: 16,
        minCityLevel: 1,
        requiresRoad: false,
        requiresWaterNeighbor: false,
        productionMultiplier: 1.6,
        housingBonus: 0,
        storageBonus: 25,
        defenseBonus: 0,
        extraWorkers: 1,
        maintenanceDelta: 1,
        seasonalResilience: 0.3,
        visualHint: 'lanterns',
      },
    },
  },

  'building-watermill': {
    assetName: 'building-watermill',
    maxLevel: 2,
    tiers: {
      2: {
        level: 2,
        titlePt: 'Moinho Fluvial II — Roda Dupla',
        descriptionPt: '+60% Alimento e Ouro, +30 Armazém.',
        upgradeCost: makeCost({ gold: 155, wood: 24, stone: 16, metal: 2 }),
        upgradeTimeTurns: 2,
        requiredTech: 'engineering',
        minPopulation: 18,
        minCityLevel: 1,
        requiresRoad: false,
        requiresWaterNeighbor: false,
        productionMultiplier: 1.6,
        housingBonus: 0,
        storageBonus: 30,
        defenseBonus: 0,
        extraWorkers: 1,
        maintenanceDelta: 2,
        seasonalResilience: 0.3,
        visualHint: 'wing',
      },
    },
  },

  'building-wizard-tower': {
    assetName: 'building-wizard-tower',
    maxLevel: 3,
    tiers: {
      2: {
        level: 2,
        titlePt: 'Universidade II — Academia Real',
        descriptionPt: '+65% Ciência, +25 Armazém, +2 Defesa.',
        upgradeCost: makeCost({ gold: 210, wood: 24, stone: 28, metal: 2 }),
        upgradeTimeTurns: 2,
        requiredTech: 'construction',
        minPopulation: 20,
        minCityLevel: 1,
        requiresRoad: false,
        requiresWaterNeighbor: false,
        productionMultiplier: 1.65,
        housingBonus: 0,
        storageBonus: 25,
        defenseBonus: 2,
        extraWorkers: 1,
        maintenanceDelta: 3,
        seasonalResilience: 0.25,
        visualHint: 'spire',
      },
      3: {
        level: 3,
        titlePt: 'Universidade III — Grande Observatório',
        descriptionPt: '+135% Ciência, +55 Armazém, +4 Defesa e farol arcano noturno.',
        upgradeCost: makeCost({ gold: 340, wood: 30, stone: 42, ore: 8, metal: 5 }),
        upgradeTimeTurns: 3,
        requiredTech: 'engineering',
        minPopulation: 30,
        minCityLevel: 2,
        requiresRoad: true,
        requiresWaterNeighbor: false,
        productionMultiplier: 2.35,
        housingBonus: 0,
        storageBonus: 55,
        defenseBonus: 4,
        extraWorkers: 1,
        maintenanceDelta: 5,
        seasonalResilience: 0.4,
        visualHint: 'lanterns',
      },
    },
  },

  'building-archery': {
    assetName: 'building-archery',
    maxLevel: 3,
    tiers: {
      2: {
        level: 2,
        titlePt: 'Quartel II — Guarnição Veterana',
        descriptionPt: '+6 Defesa, +15 Armazém e campo iluminado.',
        upgradeCost: makeCost({ gold: 195, wood: 20, stone: 24, ore: 8, metal: 4 }),
        upgradeTimeTurns: 2,
        requiredTech: 'military',
        minPopulation: 18,
        minCityLevel: 1,
        requiresRoad: false,
        requiresWaterNeighbor: false,
        productionMultiplier: 1.25,
        housingBonus: 0,
        storageBonus: 15,
        defenseBonus: 6,
        extraWorkers: 1,
        maintenanceDelta: 2,
        seasonalResilience: 0.25,
        visualHint: 'fortified',
      },
      3: {
        level: 3,
        titlePt: 'Quartel III — Academia Militar',
        descriptionPt: '+12 Defesa total extra, +30 Armazém.',
        upgradeCost: makeCost({ gold: 310, wood: 24, stone: 36, ore: 14, metal: 8 }),
        upgradeTimeTurns: 3,
        requiredTech: 'metallurgy',
        minPopulation: 26,
        minCityLevel: 2,
        requiresRoad: true,
        requiresWaterNeighbor: false,
        productionMultiplier: 1.5,
        housingBonus: 0,
        storageBonus: 30,
        defenseBonus: 12,
        extraWorkers: 1,
        maintenanceDelta: 4,
        seasonalResilience: 0.4,
        visualHint: 'spire',
      },
    },
  },

  'unit-wall-tower': {
    assetName: 'unit-wall-tower',
    maxLevel: 2,
    tiers: {
      2: {
        level: 2,
        titlePt: 'Bastião II — Bastião Blindado',
        descriptionPt: '+10 Defesa, +50% Ouro e vigia noturna.',
        upgradeCost: makeCost({ gold: 250, wood: 16, stone: 36, ore: 12, metal: 7 }),
        upgradeTimeTurns: 2,
        requiredTech: 'engineering',
        minPopulation: 24,
        minCityLevel: 2,
        requiresRoad: false,
        requiresWaterNeighbor: false,
        productionMultiplier: 1.5,
        housingBonus: 0,
        storageBonus: 20,
        defenseBonus: 10,
        extraWorkers: 1,
        maintenanceDelta: 3,
        seasonalResilience: 0.35,
        visualHint: 'fortified',
      },
    },
  },

  'building-tower': {
    assetName: 'building-tower',
    maxLevel: 3,
    tiers: {
      2: {
        level: 2,
        titlePt: 'Torre II — Torre Reforçada',
        descriptionPt: '+5 Defesa e farol de vigilância.',
        upgradeCost: makeCost({ gold: 130, wood: 12, stone: 20, metal: 2 }),
        upgradeTimeTurns: 2,
        requiredTech: 'construction',
        minPopulation: 14,
        minCityLevel: 1,
        requiresRoad: false,
        requiresWaterNeighbor: false,
        productionMultiplier: 1.0,
        housingBonus: 0,
        storageBonus: 0,
        defenseBonus: 5,
        extraWorkers: 0,
        maintenanceDelta: 1,
        seasonalResilience: 0.2,
        visualHint: 'spire',
      },
      3: {
        level: 3,
        titlePt: 'Torre III — Atalaia Real',
        descriptionPt: '+11 Defesa total extra.',
        upgradeCost: makeCost({ gold: 215, wood: 16, stone: 32, ore: 8, metal: 5 }),
        upgradeTimeTurns: 2,
        requiredTech: 'engineering',
        minPopulation: 22,
        minCityLevel: 2,
        requiresRoad: false,
        requiresWaterNeighbor: false,
        productionMultiplier: 1.0,
        housingBonus: 0,
        storageBonus: 0,
        defenseBonus: 11,
        extraWorkers: 0,
        maintenanceDelta: 2,
        seasonalResilience: 0.35,
        visualHint: 'lanterns',
      },
    },
  },

  'building-wall': {
    assetName: 'building-wall',
    maxLevel: 2,
    tiers: {
      2: {
        level: 2,
        titlePt: 'Paliçada II — Paliçada Dupla',
        descriptionPt: '+5 Defesa territorial.',
        upgradeCost: makeCost({ gold: 80, wood: 16, stone: 14 }),
        upgradeTimeTurns: 1,
        requiredTech: 'construction',
        minPopulation: 12,
        minCityLevel: 1,
        requiresRoad: false,
        requiresWaterNeighbor: false,
        productionMultiplier: 1.0,
        housingBonus: 0,
        storageBonus: 0,
        defenseBonus: 5,
        extraWorkers: 0,
        maintenanceDelta: 1,
        seasonalResilience: 0.15,
        visualHint: 'fortified',
      },
    },
  },

  'building-walls': {
    assetName: 'building-walls',
    maxLevel: 3,
    tiers: {
      2: {
        level: 2,
        titlePt: 'Muralha II — Muralha Ameada',
        descriptionPt: '+7 Defesa adicional.',
        upgradeCost: makeCost({ gold: 140, wood: 6, stone: 30, metal: 4 }),
        upgradeTimeTurns: 2,
        requiredTech: 'engineering',
        minPopulation: 20,
        minCityLevel: 1,
        requiresRoad: false,
        requiresWaterNeighbor: false,
        productionMultiplier: 1.0,
        housingBonus: 0,
        storageBonus: 0,
        defenseBonus: 7,
        extraWorkers: 0,
        maintenanceDelta: 1,
        seasonalResilience: 0.25,
        visualHint: 'fortified',
      },
      3: {
        level: 3,
        titlePt: 'Muralha III — Baluarte de Pedra',
        descriptionPt: '+14 Defesa adicional.',
        upgradeCost: makeCost({ gold: 240, wood: 10, stone: 46, ore: 10, metal: 8 }),
        upgradeTimeTurns: 3,
        requiredTech: 'metallurgy',
        minPopulation: 28,
        minCityLevel: 2,
        requiresRoad: false,
        requiresWaterNeighbor: false,
        productionMultiplier: 1.0,
        housingBonus: 0,
        storageBonus: 0,
        defenseBonus: 14,
        extraWorkers: 0,
        maintenanceDelta: 2,
        seasonalResilience: 0.4,
        visualHint: 'spire',
      },
    },
  },

  bridge: {
    assetName: 'bridge',
    maxLevel: 2,
    tiers: {
      2: {
        level: 2,
        titlePt: 'Ponte II — Ponte de Pedra',
        descriptionPt: '+100% pedágio comercial e lanternas sobre o rio.',
        upgradeCost: makeCost({ gold: 145, wood: 12, stone: 24, metal: 2 }),
        upgradeTimeTurns: 2,
        requiredTech: 'engineering',
        minPopulation: 18,
        minCityLevel: 1,
        requiresRoad: false,
        requiresWaterNeighbor: false,
        productionMultiplier: 2.0,
        housingBonus: 0,
        storageBonus: 0,
        defenseBonus: 2,
        extraWorkers: 0,
        maintenanceDelta: 1,
        seasonalResilience: 0.3,
        visualHint: 'lanterns',
      },
    },
  },
};

export const ROMAN_NUMERALS = ['', 'I', 'II', 'III', 'IV'] as const;

export function toRomanLevel(level: number): string {
  const safe = Math.max(1, Math.min(4, Math.round(level)));
  return ROMAN_NUMERALS[safe] ?? String(safe);
}

export function getBuildingLevel(
  tile: Pick<PlacedHex, 'level' | 'meta'> | null | undefined
): number {
  const raw =
    typeof tile?.level === 'number' && Number.isFinite(tile.level)
      ? tile.level
      : typeof tile?.meta?.level === 'number' && Number.isFinite(tile.meta.level)
        ? tile.meta.level
        : 1;
  return Math.max(1, Math.min(4, Math.round(raw)));
}

export function getBuildingMaxLevel(assetName: string): number {
  return BUILDING_UPGRADE_TREES[assetName]?.maxLevel ?? 1;
}

export function getBuildingUpgradeTier(
  assetName: string,
  targetLevel: number
): BuildingUpgradeTier | null {
  const tree = BUILDING_UPGRADE_TREES[assetName];
  if (!tree) return null;
  return tree.tiers[targetLevel] ?? null;
}

export interface EffectiveBuildingStats {
  assetName: string;
  level: number;
  maxLevel: number;
  labelPt: string;
  baseDef: BuildingDefinition;
  production: BuildingProduction;
  housingCapacity: number;
  storageBonus: number;
  defenseBonus: number;
  workersRequired: number;
  maintenanceGold: number;
  seasonalResilience: number;
}

export function getEffectiveBuildingStats(
  assetName: string,
  rawLevel = 1
): EffectiveBuildingStats {
  const baseDef = getBuildingDefinition(assetName);
  const maxLevel = getBuildingMaxLevel(assetName);
  const level = Math.max(1, Math.min(maxLevel, Math.round(rawLevel)));
  const tier = level >= 2 ? getBuildingUpgradeTier(assetName, level) : null;

  const mult = tier ? tier.productionMultiplier : 1;
  const production: BuildingProduction = {
    gold: Math.round(baseDef.production.gold * mult),
    wood: Math.round(baseDef.production.wood * mult),
    stone: Math.round(baseDef.production.stone * mult),
    food: Math.round(baseDef.production.food * mult),
    ore: Math.round(baseDef.production.ore * mult),
    metal: Math.round(baseDef.production.metal * mult),
    science: Math.round(baseDef.production.science * mult),
  };

  return {
    assetName,
    level,
    maxLevel,
    labelPt: level > 1 ? `${baseDef.labelPt} ${toRomanLevel(level)}` : baseDef.labelPt,
    baseDef,
    production,
    housingCapacity: baseDef.housingCapacity + (tier?.housingBonus ?? 0),
    storageBonus: baseDef.storageBonus + (tier?.storageBonus ?? 0),
    defenseBonus: baseDef.defenseBonus + (tier?.defenseBonus ?? 0),
    workersRequired: baseDef.workersRequired + (tier?.extraWorkers ?? 0),
    maintenanceGold: baseDef.maintenanceGold + (tier?.maintenanceDelta ?? 0),
    seasonalResilience: tier?.seasonalResilience ?? 0,
  };
}

export function computeEffectiveUpgradeCost(
  tier: BuildingUpgradeTier,
  unlockedTechs: TechId[]
): ResourceCost {
  const mods = getTechModifiers(unlockedTechs);
  const mult = mods.buildCostMultiplier;
  return {
    gold: Math.round(tier.upgradeCost.gold * mult),
    wood: Math.round(tier.upgradeCost.wood * mult),
    stone: Math.round(tier.upgradeCost.stone * mult),
    food: Math.round(tier.upgradeCost.food * mult),
    ore: Math.round(tier.upgradeCost.ore * mult),
    metal: Math.round(tier.upgradeCost.metal * mult),
  };
}

export interface BuildingUpgradeEvaluation {
  canUpgrade: boolean;
  isMaxLevel: boolean;
  currentLevel: number;
  maxLevel: number;
  nextTier: BuildingUpgradeTier | null;
  effectiveCost: ResourceCost | null;
  affordable: boolean;
  missingRequirementsPt: string[];
  reasonPt: string | null;
  deltaSummaryPt: string[];
}

export function evaluateBuildingUpgrade(params: {
  worldState: HexWorldState;
  q: number;
  r: number;
  assets: HexAssetEntry[];
  resources: KingdomResources;
  population: number;
  unlockedTechs: TechId[];
  availableWorkers: number;
  hasActiveConstructionAtCoord: boolean;
  roads?: RoadMap;
  roadConnectivity?: RoadConnectivitySummary;
  cities?: CityEntity[];
}): BuildingUpgradeEvaluation {
  const {
    worldState,
    q,
    r,
    assets,
    resources,
    population,
    unlockedTechs,
    availableWorkers,
    hasActiveConstructionAtCoord,
    roads = {},
    cities = [],
  } = params;

  const key = hexKey(q, r);
  const tile = worldState.hexes[key];

  const fail = (
    reasonPt: string,
    currentLevel = 1,
    maxLevel = 1,
    isMaxLevel = false,
    nextTier: BuildingUpgradeTier | null = null,
    effectiveCost: ResourceCost | null = null,
    affordable = false,
    missingRequirementsPt: string[] = [reasonPt],
    deltaSummaryPt: string[] = []
  ): BuildingUpgradeEvaluation => ({
    canUpgrade: false,
    isMaxLevel,
    currentLevel,
    maxLevel,
    nextTier,
    effectiveCost,
    affordable,
    missingRequirementsPt,
    reasonPt,
    deltaSummaryPt,
  });

  if (!tile || tile.owner !== 'player') {
    return fail('Apenas estruturas do seu território podem ser evoluídas.');
  }

  if (!hasHexConstruction(tile, assets)) {
    return fail('Não há construção neste hexágono.');
  }

  const assetName = assets[tile.structureIndex]?.name ?? '';
  if (!BUILDING_CATALOG[assetName]) {
    return fail('Esta estrutura não possui evolução disponível.');
  }

  const currentLevel = getBuildingLevel(tile);
  const maxLevel = getBuildingMaxLevel(assetName);

  if (currentLevel >= maxLevel) {
    return fail(
      'Esta construção já atingiu o nível máximo.',
      currentLevel,
      maxLevel,
      true,
      null,
      null,
      false,
      [],
      []
    );
  }

  const nextTier = getBuildingUpgradeTier(assetName, currentLevel + 1);
  if (!nextTier) {
    return fail('Nível seguinte indisponível.', currentLevel, maxLevel, true);
  }

  const currentStats = getEffectiveBuildingStats(assetName, currentLevel);
  const nextStats = getEffectiveBuildingStats(assetName, nextTier.level);
  const deltaSummaryPt: string[] = [];

  const dFood = nextStats.production.food - currentStats.production.food;
  const dGold = nextStats.production.gold - currentStats.production.gold;
  const dWood = nextStats.production.wood - currentStats.production.wood;
  const dStone = nextStats.production.stone - currentStats.production.stone;
  const dOre = nextStats.production.ore - currentStats.production.ore;
  const dMetal = nextStats.production.metal - currentStats.production.metal;
  const dSci = nextStats.production.science - currentStats.production.science;
  const dHousing = nextStats.housingCapacity - currentStats.housingCapacity;
  const dStorage = nextStats.storageBonus - currentStats.storageBonus;
  const dDef = nextStats.defenseBonus - currentStats.defenseBonus;

  if (dFood > 0) deltaSummaryPt.push(`+${dFood} Alim.`);
  if (dGold > 0) deltaSummaryPt.push(`+${dGold} Ouro`);
  if (dWood > 0) deltaSummaryPt.push(`+${dWood} Mad.`);
  if (dStone > 0) deltaSummaryPt.push(`+${dStone} Pedra`);
  if (dOre > 0) deltaSummaryPt.push(`+${dOre} Min.`);
  if (dMetal > 0) deltaSummaryPt.push(`+${dMetal} Metal`);
  if (dSci > 0) deltaSummaryPt.push(`+${dSci} Ciênc.`);
  if (dHousing > 0) deltaSummaryPt.push(`+${dHousing} Pop.`);
  if (dStorage > 0) deltaSummaryPt.push(`+${dStorage} Arm.`);
  if (dDef > 0) deltaSummaryPt.push(`+${dDef} Def.`);
  if (nextTier.seasonalResilience > currentStats.seasonalResilience) {
    deltaSummaryPt.push(
      `+${Math.round(nextTier.seasonalResilience * 100)}% Resist. Sazonal`
    );
  }

  const missing: string[] = [];

  if (hasActiveConstructionAtCoord) {
    missing.push('Obra ou melhoria já está em andamento neste hexágono.');
  }

  if (nextTier.requiredTech && !unlockedTechs.includes(nextTier.requiredTech)) {
    const techName = TECH_BY_ID[nextTier.requiredTech]?.namePt ?? nextTier.requiredTech;
    missing.push(`Requer pesquisa: ${techName}.`);
  }

  if (population < nextTier.minPopulation) {
    missing.push(`Requer ${nextTier.minPopulation} habitantes (atual: ${population}).`);
  }

  const maxCityLv = cities.reduce((m, c) => Math.max(m, c.level), 1);
  if (maxCityLv < nextTier.minCityLevel) {
    missing.push(`Requer uma cidade de estágio ${nextTier.minCityLevel}+.`);
  }

  if (nextTier.requiresRoad) {
    const hasRoad = Boolean(roads[key] && roads[key].owner === 'player');
    if (!hasRoad) {
      missing.push('Requer estrada neste hexágono.');
    }
  }

  if (nextTier.requiresWaterNeighbor) {
    const hasWater = AXIAL_DIRECTIONS.some((dir) => {
      const nq = q + dir.q;
      const nr = r + dir.r;
      const nt = worldState.hexes[hexKey(nq, nr)];
      return getHexTerrainAndResource(nq, nr, nt).terrainType === 'water';
    });
    if (!hasWater) {
      missing.push('Requer hexágono de água adjacente.');
    }
  }

  const extraWorkerNeed = nextStats.workersRequired - currentStats.workersRequired;
  if (extraWorkerNeed > 0 && availableWorkers < extraWorkerNeed) {
    missing.push(
      `Falta ${extraWorkerNeed} trabalhador livre (disponível: ${availableWorkers}).`
    );
  }

  const effectiveCost = computeEffectiveUpgradeCost(nextTier, unlockedTechs);
  const afford = canAffordCost(worldState.cash, resources, effectiveCost);
  if (!afford.affordable) {
    missing.push(afford.missingLabelPt ?? 'Recursos insuficientes.');
  }

  if (missing.length > 0) {
    return fail(
      missing[0],
      currentLevel,
      maxLevel,
      false,
      nextTier,
      effectiveCost,
      afford.affordable,
      missing,
      deltaSummaryPt
    );
  }

  return {
    canUpgrade: true,
    isMaxLevel: false,
    currentLevel,
    maxLevel,
    nextTier,
    effectiveCost,
    affordable: true,
    missingRequirementsPt: [],
    reasonPt: null,
    deltaSummaryPt,
  };
}
