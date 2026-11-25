import type { HexAssetEntry } from './godot-docs';
import type { ResourceCost } from './buildings-catalog';
import { getBuildingLevel, getBuildingMaxLevel } from './building-upgrade-engine';
import { hexKey, hasHexConstruction, type HexWorldState, type PlacedHex } from './hex-engine';
import type { RegionalSpecializationId } from './regional-engine';
import { TECH_BY_ID, getTechModifiers, type TechId } from './tech-engine';

export type BuildingModuleCategory =
  | 'agro'
  | 'forestry'
  | 'mining'
  | 'commerce'
  | 'industry'
  | 'maritime'
  | 'residential'
  | 'academic'
  | 'military';

export type BuildingModuleId =
  | 'farm_silo'
  | 'farm_irrigation'
  | 'farm_barn'
  | 'farm_seed_vault'
  | 'lumber_drying_yard'
  | 'lumber_workshop'
  | 'lumber_carts'
  | 'lumber_industrial_saw'
  | 'mine_ore_depot'
  | 'mine_toolshop'
  | 'mine_drainage'
  | 'mine_deep_gallery'
  | 'market_warehouse'
  | 'market_expanded_stalls'
  | 'market_exchange'
  | 'market_trade_center'
  | 'smelter_ore_depot'
  | 'smelter_advanced_furnace'
  | 'smelter_cooling'
  | 'smelter_high_temp_furnace'
  | 'port_warehouse'
  | 'port_crane'
  | 'port_lighthouse'
  | 'port_expanded_dock'
  | 'res_extension'
  | 'res_well'
  | 'res_lighting'
  | 'res_plaza'
  | 'castle_royal_archive'
  | 'acad_library'
  | 'acad_scriptorium'
  | 'acad_observatory'
  | 'mil_armory'
  | 'mil_beacon'
  | 'mil_training_yard';

export type BuildingModuleStatus = 'built' | 'building' | 'available' | 'blocked';

export interface BuildingModuleEffect {
  prodPct?: Partial<
    Record<'gold' | 'wood' | 'stone' | 'food' | 'ore' | 'metal' | 'science', number>
  >;
  springSummerFoodPct?: number;
  flatGold?: number;
  flatScience?: number;
  housingBonus?: number;
  storageGeneralBonus?: number;
  storageFoodBonus?: number;
  defenseBonus?: number;
  maintenanceDelta?: number;
  urbanQualityBonus?: number;
  logisticsBonusPct?: number;
  seasonalResilience?: number;
  winterResilience?: number;
  droughtResilience?: number;
  rainStormResilience?: number;
  regionalWeights?: Partial<Record<RegionalSpecializationId, number>>;
}

export interface BuildingModuleDefinition {
  id: BuildingModuleId;
  category: BuildingModuleCategory;
  labelPt: string;
  summaryPt: string;
  compatibleAssets: string[];
  baseCost: ResourceCost;
  buildTimeTurns: number;
  requiredTech: TechId | null;
  effects: BuildingModuleEffect;
}

export interface BuildingModuleOptionState {
  definition: BuildingModuleDefinition;
  status: BuildingModuleStatus;
  statusLabelPt: string;
  reasonPt: string | null;
  scaledCost: ResourceCost;
  affordable: boolean;
  turnsRemaining?: number;
  totalTurns?: number;
}

export interface BuildingModulesEvaluation {
  q: number;
  r: number;
  assetName: string;
  level: number;
  maxLevel: number;
  slotsUsed: number;
  slotsMax: number;
  installedModuleIds: BuildingModuleId[];
  activeModuleConstruction: {
    moduleId: BuildingModuleId;
    labelPt: string;
    turnsRemaining: number;
    totalTurns: number;
  } | null;
  options: BuildingModuleOptionState[];
}

export interface AggregatedTileModuleEffects {
  prodPct: Record<'gold' | 'wood' | 'stone' | 'food' | 'ore' | 'metal' | 'science', number>;
  springSummerFoodPct: number;
  flatGold: number;
  flatScience: number;
  housingBonus: number;
  storageGeneralBonus: number;
  storageFoodBonus: number;
  defenseBonus: number;
  maintenanceDelta: number;
  urbanQualityBonus: number;
  logisticsBonusPct: number;
  seasonalResilience: number;
  winterResilience: number;
  droughtResilience: number;
  rainStormResilience: number;
  regionalWeights: Partial<Record<RegionalSpecializationId, number>>;
}

const ZERO_COST: ResourceCost = {
  gold: 0,
  wood: 0,
  stone: 0,
  food: 0,
  ore: 0,
  metal: 0,
};

function makeCost(partial: Partial<ResourceCost>): ResourceCost {
  return { ...ZERO_COST, ...partial };
}

const AGRO_ASSETS = ['building-farm', 'building-mill', 'building-sheep', 'building-watermill'];
const RESIDENTIAL_ASSETS = [
  'building-cabin',
  'building-house',
  'building-village',
  'unit-mansion',
  'building-castle',
];
const MILITARY_ASSETS = [
  'building-archery',
  'building-tower',
  'unit-wall-tower',
  'building-wall',
  'building-walls',
];

export const BUILDING_MODULES: Record<BuildingModuleId, BuildingModuleDefinition> = {
  // ======================== AGRO ========================
  farm_silo: {
    id: 'farm_silo',
    category: 'agro',
    labelPt: 'Silo',
    summaryPt: '+35 Armazém de Alimento · +20% proteção no inverno',
    compatibleAssets: AGRO_ASSETS,
    baseCost: makeCost({ gold: 100, wood: 20, stone: 12 }),
    buildTimeTurns: 2,
    requiredTech: null,
    effects: {
      storageFoodBonus: 35,
      winterResilience: 0.2,
    },
  },
  farm_irrigation: {
    id: 'farm_irrigation',
    category: 'agro',
    labelPt: 'Irrigação',
    summaryPt: '+15% Alimento · +35% resistência à seca',
    compatibleAssets: AGRO_ASSETS,
    baseCost: makeCost({ gold: 120, wood: 16, stone: 14 }),
    buildTimeTurns: 2,
    requiredTech: 'agriculture',
    effects: {
      prodPct: { food: 0.15 },
      droughtResilience: 0.35,
    },
  },
  farm_barn: {
    id: 'farm_barn',
    category: 'agro',
    labelPt: 'Celeiro',
    summaryPt: '+25 Armazém Alimento · +10 Armazém Geral · +15% proteção climática',
    compatibleAssets: AGRO_ASSETS,
    baseCost: makeCost({ gold: 110, wood: 22, stone: 8 }),
    buildTimeTurns: 2,
    requiredTech: null,
    effects: {
      storageFoodBonus: 25,
      storageGeneralBonus: 10,
      seasonalResilience: 0.15,
    },
  },
  farm_seed_vault: {
    id: 'farm_seed_vault',
    category: 'agro',
    labelPt: 'Armazém de Sementes',
    summaryPt: '+18% Alimento na Primavera/Verão · +1 Ciência · +3 Vocação Agrícola',
    compatibleAssets: AGRO_ASSETS,
    baseCost: makeCost({ gold: 135, wood: 15, stone: 12 }),
    buildTimeTurns: 3,
    requiredTech: 'agriculture',
    effects: {
      springSummerFoodPct: 0.18,
      flatScience: 1,
      regionalWeights: { agricultural: 3 },
    },
  },

  // ======================== SERRARIA ========================
  lumber_drying_yard: {
    id: 'lumber_drying_yard',
    category: 'forestry',
    labelPt: 'Pátio de Secagem',
    summaryPt: '+25 Armazém Geral · +10% Madeira',
    compatibleAssets: ['dirt-lumber'],
    baseCost: makeCost({ gold: 95, wood: 14, stone: 8 }),
    buildTimeTurns: 1,
    requiredTech: null,
    effects: {
      storageGeneralBonus: 25,
      prodPct: { wood: 0.1 },
    },
  },
  lumber_workshop: {
    id: 'lumber_workshop',
    category: 'forestry',
    labelPt: 'Oficina',
    summaryPt: '+12% Madeira · +2 Ouro por turno',
    compatibleAssets: ['dirt-lumber'],
    baseCost: makeCost({ gold: 120, wood: 18, stone: 10 }),
    buildTimeTurns: 2,
    requiredTech: null,
    effects: {
      prodPct: { wood: 0.12 },
      flatGold: 2,
    },
  },
  lumber_carts: {
    id: 'lumber_carts',
    category: 'forestry',
    labelPt: 'Carroças',
    summaryPt: '+12% Logística · +10% Madeira',
    compatibleAssets: ['dirt-lumber'],
    baseCost: makeCost({ gold: 130, wood: 20, stone: 6, metal: 2 }),
    buildTimeTurns: 2,
    requiredTech: null,
    effects: {
      logisticsBonusPct: 0.12,
      prodPct: { wood: 0.1 },
    },
  },
  lumber_industrial_saw: {
    id: 'lumber_industrial_saw',
    category: 'forestry',
    labelPt: 'Serra Industrial',
    summaryPt: '+22% Madeira · +3 Vocação Madeireira',
    compatibleAssets: ['dirt-lumber'],
    baseCost: makeCost({ gold: 190, wood: 16, stone: 14, metal: 6 }),
    buildTimeTurns: 4,
    requiredTech: 'engineering',
    effects: {
      prodPct: { wood: 0.22 },
      regionalWeights: { forestry: 3 },
    },
  },

  // ======================== MINA ========================
  mine_ore_depot: {
    id: 'mine_ore_depot',
    category: 'mining',
    labelPt: 'Depósito Mineral',
    summaryPt: '+30 Armazém Geral · +10% Pedra',
    compatibleAssets: ['building-mine'],
    baseCost: makeCost({ gold: 110, wood: 16, stone: 12 }),
    buildTimeTurns: 2,
    requiredTech: null,
    effects: {
      storageGeneralBonus: 30,
      prodPct: { stone: 0.1 },
    },
  },
  mine_toolshop: {
    id: 'mine_toolshop',
    category: 'mining',
    labelPt: 'Oficina de Ferramentas',
    summaryPt: '+15% Minério · +15% Pedra · -1 Manutenção',
    compatibleAssets: ['building-mine'],
    baseCost: makeCost({ gold: 145, wood: 14, stone: 10, metal: 3 }),
    buildTimeTurns: 2,
    requiredTech: null,
    effects: {
      prodPct: { ore: 0.15, stone: 0.15 },
      maintenanceDelta: -1,
    },
  },
  mine_drainage: {
    id: 'mine_drainage',
    category: 'mining',
    labelPt: 'Sistema de Drenagem',
    summaryPt: '+10% Minério · +45% proteção contra chuva/tempestade',
    compatibleAssets: ['building-mine'],
    baseCost: makeCost({ gold: 135, wood: 18, stone: 14, metal: 2 }),
    buildTimeTurns: 3,
    requiredTech: 'construction',
    effects: {
      prodPct: { ore: 0.1 },
      rainStormResilience: 0.45,
    },
  },
  mine_deep_gallery: {
    id: 'mine_deep_gallery',
    category: 'mining',
    labelPt: 'Galeria Profunda',
    summaryPt: '+25% Minério · +20% Pedra · +3 Vocação Mineradora',
    compatibleAssets: ['building-mine'],
    baseCost: makeCost({ gold: 200, wood: 22, stone: 18, metal: 5 }),
    buildTimeTurns: 4,
    requiredTech: 'mining',
    effects: {
      prodPct: { ore: 0.25, stone: 0.2 },
      regionalWeights: { mining: 3 },
    },
  },

  // ======================== MERCADO ========================
  market_warehouse: {
    id: 'market_warehouse',
    category: 'commerce',
    labelPt: 'Armazém',
    summaryPt: '+35 Armazém Geral',
    compatibleAssets: ['building-market'],
    baseCost: makeCost({ gold: 115, wood: 18, stone: 12 }),
    buildTimeTurns: 2,
    requiredTech: null,
    effects: {
      storageGeneralBonus: 35,
    },
  },
  market_expanded_stalls: {
    id: 'market_expanded_stalls',
    category: 'commerce',
    labelPt: 'Bancas Ampliadas',
    summaryPt: '+15% Ouro',
    compatibleAssets: ['building-market'],
    baseCost: makeCost({ gold: 125, wood: 20, stone: 8 }),
    buildTimeTurns: 1,
    requiredTech: null,
    effects: {
      prodPct: { gold: 0.15 },
    },
  },
  market_exchange: {
    id: 'market_exchange',
    category: 'commerce',
    labelPt: 'Casa de Câmbio',
    summaryPt: '+12% Ouro · +1 Ciência · +8% Logística',
    compatibleAssets: ['building-market'],
    baseCost: makeCost({ gold: 165, wood: 14, stone: 14, metal: 2 }),
    buildTimeTurns: 3,
    requiredTech: null,
    effects: {
      prodPct: { gold: 0.12 },
      flatScience: 1,
      logisticsBonusPct: 0.08,
    },
  },
  market_trade_center: {
    id: 'market_trade_center',
    category: 'commerce',
    labelPt: 'Centro Comercial',
    summaryPt: '+24% Ouro · +4 Vocação Comercial',
    compatibleAssets: ['building-market'],
    baseCost: makeCost({ gold: 230, wood: 22, stone: 20, metal: 4 }),
    buildTimeTurns: 4,
    requiredTech: 'trade',
    effects: {
      prodPct: { gold: 0.24 },
      regionalWeights: { commercial: 4 },
    },
  },

  // ======================== FUNDIÇÃO ========================
  smelter_ore_depot: {
    id: 'smelter_ore_depot',
    category: 'industry',
    labelPt: 'Depósito de Minério',
    summaryPt: '+30 Armazém Geral · +10% Metal',
    compatibleAssets: ['building-smelter'],
    baseCost: makeCost({ gold: 120, wood: 16, stone: 14 }),
    buildTimeTurns: 2,
    requiredTech: null,
    effects: {
      storageGeneralBonus: 30,
      prodPct: { metal: 0.1 },
    },
  },
  smelter_advanced_furnace: {
    id: 'smelter_advanced_furnace',
    category: 'industry',
    labelPt: 'Forno Avançado',
    summaryPt: '+18% Metal',
    compatibleAssets: ['building-smelter'],
    baseCost: makeCost({ gold: 175, wood: 14, stone: 18, metal: 4 }),
    buildTimeTurns: 3,
    requiredTech: null,
    effects: {
      prodPct: { metal: 0.18 },
    },
  },
  smelter_cooling: {
    id: 'smelter_cooling',
    category: 'industry',
    labelPt: 'Sistema de Refrigeração',
    summaryPt: '+10% Metal · +25% proteção climática · -1 Manutenção',
    compatibleAssets: ['building-smelter'],
    baseCost: makeCost({ gold: 155, wood: 12, stone: 16, metal: 4 }),
    buildTimeTurns: 3,
    requiredTech: 'engineering',
    effects: {
      prodPct: { metal: 0.1 },
      seasonalResilience: 0.25,
      maintenanceDelta: -1,
    },
  },
  smelter_high_temp_furnace: {
    id: 'smelter_high_temp_furnace',
    category: 'industry',
    labelPt: 'Forno de Alta Temperatura',
    summaryPt: '+28% Metal · +3 Vocação Mineradora',
    compatibleAssets: ['building-smelter'],
    baseCost: makeCost({ gold: 245, wood: 16, stone: 24, ore: 8, metal: 6 }),
    buildTimeTurns: 5,
    requiredTech: 'metallurgy',
    effects: {
      prodPct: { metal: 0.28 },
      regionalWeights: { mining: 3 },
    },
  },

  // ======================== PORTO & DOCA ========================
  port_warehouse: {
    id: 'port_warehouse',
    category: 'maritime',
    labelPt: 'Armazém Portuário',
    summaryPt: '+40 Armazém Geral · +20 Armazém de Alimento',
    compatibleAssets: ['building-port', 'building-dock'],
    baseCost: makeCost({ gold: 130, wood: 24, stone: 12 }),
    buildTimeTurns: 2,
    requiredTech: null,
    effects: {
      storageGeneralBonus: 40,
      storageFoodBonus: 20,
    },
  },
  port_crane: {
    id: 'port_crane',
    category: 'maritime',
    labelPt: 'Guindaste',
    summaryPt: '+15% Logística · +12% Ouro · +10% Alimento',
    compatibleAssets: ['building-port', 'building-dock', 'bridge'],
    baseCost: makeCost({ gold: 170, wood: 22, stone: 14, metal: 4 }),
    buildTimeTurns: 3,
    requiredTech: 'construction',
    effects: {
      logisticsBonusPct: 0.15,
      prodPct: { gold: 0.12, food: 0.1 },
    },
  },
  port_lighthouse: {
    id: 'port_lighthouse',
    category: 'maritime',
    labelPt: 'Farol',
    summaryPt: '+30% proteção chuva/tempestade · +20% proteção inverno · +10% Ouro · +2 Defesa',
    compatibleAssets: ['building-port', 'building-dock', 'bridge'],
    baseCost: makeCost({ gold: 160, wood: 16, stone: 20, metal: 2 }),
    buildTimeTurns: 3,
    requiredTech: null,
    effects: {
      rainStormResilience: 0.3,
      winterResilience: 0.2,
      prodPct: { gold: 0.1 },
      defenseBonus: 2,
    },
  },
  port_expanded_dock: {
    id: 'port_expanded_dock',
    category: 'maritime',
    labelPt: 'Doca Ampliada',
    summaryPt: '+22% Ouro · +18% Alimento · +4 Vocação Portuária',
    compatibleAssets: ['building-port', 'building-dock'],
    baseCost: makeCost({ gold: 240, wood: 30, stone: 18, metal: 5 }),
    buildTimeTurns: 4,
    requiredTech: 'trade',
    effects: {
      prodPct: { gold: 0.22, food: 0.18 },
      regionalWeights: { port: 4 },
    },
  },

  // ======================== RESIDÊNCIAS & CASTELO ========================
  res_extension: {
    id: 'res_extension',
    category: 'residential',
    labelPt: 'Extensão',
    summaryPt: '+2 Capacidade Habitacional',
    compatibleAssets: RESIDENTIAL_ASSETS,
    baseCost: makeCost({ gold: 85, wood: 16, stone: 10 }),
    buildTimeTurns: 2,
    requiredTech: null,
    effects: {
      housingBonus: 2,
    },
  },
  res_well: {
    id: 'res_well',
    category: 'residential',
    labelPt: 'Poço',
    summaryPt: '+2 Qualidade Urbana · +20% proteção contra seca',
    compatibleAssets: RESIDENTIAL_ASSETS,
    baseCost: makeCost({ gold: 75, wood: 8, stone: 14 }),
    buildTimeTurns: 1,
    requiredTech: null,
    effects: {
      urbanQualityBonus: 2,
      droughtResilience: 0.2,
    },
  },
  res_lighting: {
    id: 'res_lighting',
    category: 'residential',
    labelPt: 'Iluminação',
    summaryPt: '+2 Qualidade Urbana · +1 Defesa · +1 Ouro',
    compatibleAssets: [...RESIDENTIAL_ASSETS, 'building-wizard-tower', ...MILITARY_ASSETS, 'bridge'],
    baseCost: makeCost({ gold: 90, wood: 10, stone: 8, metal: 2 }),
    buildTimeTurns: 2,
    requiredTech: null,
    effects: {
      urbanQualityBonus: 2,
      defenseBonus: 1,
      flatGold: 1,
    },
  },
  res_plaza: {
    id: 'res_plaza',
    category: 'residential',
    labelPt: 'Jardim / Praça',
    summaryPt: '+3 Qualidade Urbana · +1 Ouro · +3 Vocação Urbana',
    compatibleAssets: RESIDENTIAL_ASSETS,
    baseCost: makeCost({ gold: 125, wood: 14, stone: 18 }),
    buildTimeTurns: 2,
    requiredTech: 'construction',
    effects: {
      urbanQualityBonus: 3,
      flatGold: 1,
      regionalWeights: { urban: 3 },
    },
  },
  castle_royal_archive: {
    id: 'castle_royal_archive',
    category: 'residential',
    labelPt: 'Arquivo Real',
    summaryPt: '+2 Ciência · +25 Armazém Geral · +2 Qualidade Urbana',
    compatibleAssets: ['building-castle', 'unit-mansion'],
    baseCost: makeCost({ gold: 210, wood: 20, stone: 24, metal: 4 }),
    buildTimeTurns: 4,
    requiredTech: 'construction',
    effects: {
      flatScience: 2,
      storageGeneralBonus: 25,
      urbanQualityBonus: 2,
      regionalWeights: { academic: 2 },
    },
  },

  // ======================== ACADÊMICO & MILITAR ========================
  acad_library: {
    id: 'acad_library',
    category: 'academic',
    labelPt: 'Biblioteca',
    summaryPt: '+20% Ciência · +15 Armazém Geral',
    compatibleAssets: ['building-wizard-tower'],
    baseCost: makeCost({ gold: 130, wood: 18, stone: 14 }),
    buildTimeTurns: 2,
    requiredTech: null,
    effects: {
      prodPct: { science: 0.2 },
      storageGeneralBonus: 15,
    },
  },
  acad_scriptorium: {
    id: 'acad_scriptorium',
    category: 'academic',
    labelPt: 'Scriptorium',
    summaryPt: '+2 Ciência · +1 Ouro por turno',
    compatibleAssets: ['building-wizard-tower'],
    baseCost: makeCost({ gold: 145, wood: 16, stone: 12 }),
    buildTimeTurns: 2,
    requiredTech: 'construction',
    effects: {
      flatScience: 2,
      flatGold: 1,
    },
  },
  acad_observatory: {
    id: 'acad_observatory',
    category: 'academic',
    labelPt: 'Observatório',
    summaryPt: '+28% Ciência · +3 Vocação Acadêmica',
    compatibleAssets: ['building-wizard-tower'],
    baseCost: makeCost({ gold: 210, wood: 14, stone: 22, metal: 4 }),
    buildTimeTurns: 4,
    requiredTech: 'engineering',
    effects: {
      prodPct: { science: 0.28 },
      regionalWeights: { academic: 3 },
    },
  },
  mil_armory: {
    id: 'mil_armory',
    category: 'military',
    labelPt: 'Armaria',
    summaryPt: '+4 Defesa · +20 Armazém Geral',
    compatibleAssets: [...MILITARY_ASSETS, 'building-castle'],
    baseCost: makeCost({ gold: 140, wood: 16, stone: 16, metal: 4 }),
    buildTimeTurns: 2,
    requiredTech: 'military',
    effects: {
      defenseBonus: 4,
      storageGeneralBonus: 20,
    },
  },
  mil_beacon: {
    id: 'mil_beacon',
    category: 'military',
    labelPt: 'Farol de Vigia',
    summaryPt: '+3 Defesa · +25% proteção no inverno e tempestades',
    compatibleAssets: MILITARY_ASSETS,
    baseCost: makeCost({ gold: 120, wood: 14, stone: 14, metal: 2 }),
    buildTimeTurns: 2,
    requiredTech: null,
    effects: {
      defenseBonus: 3,
      winterResilience: 0.25,
      rainStormResilience: 0.25,
    },
  },
  mil_training_yard: {
    id: 'mil_training_yard',
    category: 'military',
    labelPt: 'Campo de Treino',
    summaryPt: '+3 Defesa · +2 Qualidade Urbana',
    compatibleAssets: MILITARY_ASSETS,
    baseCost: makeCost({ gold: 150, wood: 20, stone: 12, metal: 3 }),
    buildTimeTurns: 3,
    requiredTech: 'construction',
    effects: {
      defenseBonus: 3,
      urbanQualityBonus: 2,
    },
  },
};

export function isValidBuildingModuleId(id: string): id is BuildingModuleId {
  return Object.prototype.hasOwnProperty.call(BUILDING_MODULES, id);
}

export function getCompatibleModulesForBuilding(
  assetName: string
): BuildingModuleDefinition[] {
  return Object.values(BUILDING_MODULES).filter((mod) =>
    mod.compatibleAssets.includes(assetName)
  );
}

/**
 * Slots scale strictly with structural building level (Nv. I = 1, Nv. II = 2, Nv. III = 3, Nv. IV = 4),
 * always capped below compatible.length so players must make meaningful strategic choices.
 */
export function getModuleSlotsForBuilding(assetName: string, rawLevel = 1): number {
  const compatible = getCompatibleModulesForBuilding(assetName);
  if (compatible.length === 0) return 0;
  const maxLevel = getBuildingMaxLevel(assetName);
  const clampedLevel = Math.max(1, Math.min(4, Math.min(maxLevel, Math.round(rawLevel))));
  if (compatible.length === 1) return 1;
  return Math.max(1, Math.min(clampedLevel, compatible.length - 1));
}

export function getInstalledModules(
  tile: Pick<PlacedHex, 'modules'> | null | undefined
): BuildingModuleId[] {
  if (!tile || !Array.isArray(tile.modules)) return [];
  const seen = new Set<BuildingModuleId>();
  const valid: BuildingModuleId[] = [];
  for (const raw of tile.modules) {
    if (typeof raw === 'string' && isValidBuildingModuleId(raw) && !seen.has(raw)) {
      seen.add(raw);
      valid.push(raw);
    }
  }
  return valid;
}

export function computeModuleScaledCost(
  def: BuildingModuleDefinition,
  buildingLevel: number,
  unlockedTechs: TechId[]
): ResourceCost {
  const safeLv = Math.max(1, Math.min(4, Math.round(buildingLevel)));
  const levelScale = 1 + (safeLv - 1) * 0.35;
  const techMult = getTechModifiers(unlockedTechs).buildCostMultiplier;
  const totalMult = levelScale * techMult;
  return {
    gold: Math.round(def.baseCost.gold * totalMult),
    wood: Math.round(def.baseCost.wood * totalMult),
    stone: Math.round(def.baseCost.stone * totalMult),
    food: Math.round(def.baseCost.food * totalMult),
    ore: Math.round(def.baseCost.ore * totalMult),
    metal: Math.round(def.baseCost.metal * totalMult),
  };
}

export function aggregateTileModuleEffects(
  assetName: string,
  moduleIds: readonly string[] | undefined
): AggregatedTileModuleEffects {
  const result: AggregatedTileModuleEffects = {
    prodPct: { gold: 0, wood: 0, stone: 0, food: 0, ore: 0, metal: 0, science: 0 },
    springSummerFoodPct: 0,
    flatGold: 0,
    flatScience: 0,
    housingBonus: 0,
    storageGeneralBonus: 0,
    storageFoodBonus: 0,
    defenseBonus: 0,
    maintenanceDelta: 0,
    urbanQualityBonus: 0,
    logisticsBonusPct: 0,
    seasonalResilience: 0,
    winterResilience: 0,
    droughtResilience: 0,
    rainStormResilience: 0,
    regionalWeights: {},
  };

  if (!moduleIds || moduleIds.length === 0) return result;
  const seen = new Set<string>();

  for (const rawId of moduleIds) {
    if (seen.has(rawId) || !isValidBuildingModuleId(rawId)) continue;
    const def = BUILDING_MODULES[rawId];
    if (!def.compatibleAssets.includes(assetName)) continue;
    seen.add(rawId);

    const eff = def.effects;
    if (eff.prodPct) {
      for (const key of Object.keys(eff.prodPct) as Array<keyof typeof result.prodPct>) {
        result.prodPct[key] += eff.prodPct[key] ?? 0;
      }
    }
    result.springSummerFoodPct += eff.springSummerFoodPct ?? 0;
    result.flatGold += eff.flatGold ?? 0;
    result.flatScience += eff.flatScience ?? 0;
    result.housingBonus += eff.housingBonus ?? 0;
    result.storageGeneralBonus += eff.storageGeneralBonus ?? 0;
    result.storageFoodBonus += eff.storageFoodBonus ?? 0;
    result.defenseBonus += eff.defenseBonus ?? 0;
    result.maintenanceDelta += eff.maintenanceDelta ?? 0;
    result.urbanQualityBonus += eff.urbanQualityBonus ?? 0;
    result.logisticsBonusPct += eff.logisticsBonusPct ?? 0;
    result.seasonalResilience += eff.seasonalResilience ?? 0;
    result.winterResilience += eff.winterResilience ?? 0;
    result.droughtResilience += eff.droughtResilience ?? 0;
    result.rainStormResilience += eff.rainStormResilience ?? 0;

    if (eff.regionalWeights) {
      for (const specKey of Object.keys(eff.regionalWeights) as RegionalSpecializationId[]) {
        result.regionalWeights[specKey] =
          (result.regionalWeights[specKey] ?? 0) + (eff.regionalWeights[specKey] ?? 0);
      }
    }
  }

  return result;
}

function canAffordModule(
  gold: number,
  resources: { wood: number; stone: number; food: number; ore: number; metal: number },
  cost: ResourceCost
): { affordable: boolean; missingLabelPt: string | null } {
  if (gold < cost.gold) return { affordable: false, missingLabelPt: `Falta ouro ($${cost.gold})` };
  if (resources.wood < cost.wood) return { affordable: false, missingLabelPt: `Falta madeira (${cost.wood})` };
  if (resources.stone < cost.stone) return { affordable: false, missingLabelPt: `Falta pedra (${cost.stone})` };
  if (resources.food < cost.food) return { affordable: false, missingLabelPt: `Falta alimento (${cost.food})` };
  if (resources.ore < cost.ore) return { affordable: false, missingLabelPt: `Falta minério (${cost.ore})` };
  if (resources.metal < cost.metal) return { affordable: false, missingLabelPt: `Falta metal (${cost.metal})` };
  return { affordable: true, missingLabelPt: null };
}

export function evaluateBuildingModules(params: {
  worldState: HexWorldState;
  q: number;
  r: number;
  assets: HexAssetEntry[];
  resources: { wood: number; stone: number; food: number; ore: number; metal: number };
  unlockedTechs: TechId[];
  constructions: Array<{
    q: number;
    r: number;
    kind?: 'build' | 'upgrade' | 'module';
    moduleId?: BuildingModuleId;
    turnsRemaining: number;
    totalTurns: number;
  }>;
  underConstructionKeys: Set<string>;
}): BuildingModulesEvaluation | null {
  const {
    worldState,
    q,
    r,
    assets,
    resources,
    unlockedTechs,
    constructions,
    underConstructionKeys,
  } = params;

  const key = hexKey(q, r);
  const tile = worldState.hexes[key];
  if (!tile || tile.owner !== 'player' || !hasHexConstruction(tile, assets)) {
    return null;
  }

  const assetName = assets[tile.structureIndex]?.name ?? '';
  const level = getBuildingLevel(tile);
  const maxLevel = getBuildingMaxLevel(assetName);
  const compatible = getCompatibleModulesForBuilding(assetName);
  if (compatible.length === 0) return null;

  const slotsMax = getModuleSlotsForBuilding(assetName, level);
  const installedModuleIds = getInstalledModules(tile).filter((id) =>
    BUILDING_MODULES[id].compatibleAssets.includes(assetName)
  );
  const slotsUsed = installedModuleIds.length;

  const activeOnHex = constructions.find((c) => c.q === q && c.r === r) ?? null;
  const activeModuleConstruction =
    activeOnHex && activeOnHex.kind === 'module' && activeOnHex.moduleId && isValidBuildingModuleId(activeOnHex.moduleId)
      ? {
          moduleId: activeOnHex.moduleId,
          labelPt: BUILDING_MODULES[activeOnHex.moduleId].labelPt,
          turnsRemaining: activeOnHex.turnsRemaining,
          totalTurns: activeOnHex.totalTurns,
        }
      : null;

  const isHexUnderConstruction = underConstructionKeys.has(key);
  const hasAnyActiveQueue = Boolean(activeOnHex);

  const options: BuildingModuleOptionState[] = compatible.map((def) => {
    const scaledCost = computeModuleScaledCost(def, level, unlockedTechs);
    const afford = canAffordModule(worldState.cash, resources, scaledCost);

    if (installedModuleIds.includes(def.id)) {
      return {
        definition: def,
        status: 'built',
        statusLabelPt: 'Construído',
        reasonPt: null,
        scaledCost,
        affordable: true,
      };
    }

    if (activeModuleConstruction && activeModuleConstruction.moduleId === def.id) {
      return {
        definition: def,
        status: 'building',
        statusLabelPt: `Em construção (${activeModuleConstruction.turnsRemaining}t)`,
        reasonPt: null,
        scaledCost,
        affordable: true,
        turnsRemaining: activeModuleConstruction.turnsRemaining,
        totalTurns: activeModuleConstruction.totalTurns,
      };
    }

    let reasonPt: string | null = null;
    if (isHexUnderConstruction) {
      reasonPt = 'Aguarde a conclusão da construção principal.';
    } else if (hasAnyActiveQueue) {
      reasonPt =
        activeOnHex?.kind === 'upgrade'
          ? 'Evolução estrutural em andamento neste hexágono.'
          : 'Outra melhoria já está em construção neste hexágono.';
    } else if (slotsUsed >= slotsMax) {
      reasonPt =
        level < maxLevel
          ? `Slots cheios (${slotsUsed}/${slotsMax}): evolua para Nv. ${level + 1} para abrir mais.`
          : `Limite máximo de módulos atingido (${slotsUsed}/${slotsMax}).`;
    } else if (def.requiredTech && !unlockedTechs.includes(def.requiredTech)) {
      reasonPt = `Requer pesquisa: ${TECH_BY_ID[def.requiredTech]?.namePt ?? def.requiredTech}.`;
    } else if (!afford.affordable) {
      reasonPt = afford.missingLabelPt ?? 'Recursos insuficientes.';
    }

    return {
      definition: def,
      status: reasonPt ? 'blocked' : 'available',
      statusLabelPt: reasonPt ? 'Bloqueado' : 'Disponível',
      reasonPt,
      scaledCost,
      affordable: afford.affordable,
    };
  });

  return {
    q,
    r,
    assetName,
    level,
    maxLevel,
    slotsUsed,
    slotsMax,
    installedModuleIds,
    activeModuleConstruction,
    options,
  };
}
