import type { TerrainType } from './terrain-engine';
import type { TechId } from './tech-engine';

export type BuildingRole =
  | 'capital'
  | 'housing'
  | 'production'
  | 'commerce'
  | 'science'
  | 'military'
  | 'infrastructure';

export interface ResourceCost {
  gold: number;
  wood: number;
  stone: number;
  food: number;
  ore: number;
  metal: number;
}

export interface BuildingProduction {
  gold: number;
  wood: number;
  stone: number;
  food: number;
  ore: number;
  metal: number;
  science: number;
}

export type InputResourceKey = 'wood' | 'stone' | 'food' | 'ore' | 'metal';

export interface BuildingDefinition {
  assetName: string;
  labelPt: string;
  role: BuildingRole;
  summaryPt: string;
  buildCost: ResourceCost;
  buildTimeTurns: number;
  maintenanceGold: number;
  workersRequired: number;
  housingCapacity: number;
  storageBonus: number;
  defenseBonus: number;
  production: BuildingProduction;
  inputConsumption?: Partial<Record<InputResourceKey, number>>;
  allowedTerrains: TerrainType[] | null;
  requiredTech: TechId | null;
  canRecruitUnits: boolean;
}

const ZERO_COST: ResourceCost = { gold: 0, wood: 0, stone: 0, food: 0, ore: 0, metal: 0 };
const ZERO_PROD: BuildingProduction = {
  gold: 0,
  wood: 0,
  stone: 0,
  food: 0,
  ore: 0,
  metal: 0,
  science: 0,
};

export const BUILDING_CATALOG: Record<string, BuildingDefinition> = {
  'building-castle': {
    assetName: 'building-castle',
    labelPt: 'Castelo Real',
    role: 'capital',
    summaryPt: '+8 Pop · +100 Armazém · +10 Ouro · +2 Ciência · +15 Def',
    buildCost: { gold: 500, wood: 60, stone: 60, food: 0, ore: 15, metal: 10 },
    buildTimeTurns: 4,
    maintenanceGold: 0,
    workersRequired: 0,
    housingCapacity: 8,
    storageBonus: 100,
    defenseBonus: 15,
    production: { gold: 10, wood: 0, stone: 0, food: 0, ore: 0, metal: 0, science: 2 },
    allowedTerrains: ['plains', 'fertile'],
    requiredTech: 'engineering',
    canRecruitUnits: true,
  },
  'building-cabin': {
    assetName: 'building-cabin',
    labelPt: 'Cabana',
    role: 'housing',
    summaryPt: '+4 População · 1 turno',
    buildCost: { gold: 50, wood: 10, stone: 0, food: 0, ore: 0, metal: 0 },
    buildTimeTurns: 1,
    maintenanceGold: 1,
    workersRequired: 0,
    housingCapacity: 4,
    storageBonus: 0,
    defenseBonus: 0,
    production: ZERO_PROD,
    allowedTerrains: ['plains', 'fertile', 'forest'],
    requiredTech: null,
    canRecruitUnits: false,
  },
  'building-house': {
    assetName: 'building-house',
    labelPt: 'Casa',
    role: 'housing',
    summaryPt: '+6 População · 1 turno',
    buildCost: { gold: 80, wood: 15, stone: 5, food: 0, ore: 0, metal: 0 },
    buildTimeTurns: 1,
    maintenanceGold: 2,
    workersRequired: 0,
    housingCapacity: 6,
    storageBonus: 10,
    defenseBonus: 0,
    production: ZERO_PROD,
    allowedTerrains: ['plains', 'fertile', 'forest'],
    requiredTech: null,
    canRecruitUnits: false,
  },
  'building-village': {
    assetName: 'building-village',
    labelPt: 'Vila',
    role: 'housing',
    summaryPt: '+10 População · +60 Armazém · +4 Ouro · 3 turnos',
    buildCost: { gold: 180, wood: 30, stone: 15, food: 0, ore: 0, metal: 0 },
    buildTimeTurns: 3,
    maintenanceGold: 4,
    workersRequired: 0,
    housingCapacity: 10,
    storageBonus: 60,
    defenseBonus: 2,
    production: { gold: 4, wood: 0, stone: 0, food: 0, ore: 0, metal: 0, science: 0 },
    allowedTerrains: ['plains', 'fertile', 'forest'],
    requiredTech: 'construction',
    canRecruitUnits: false,
  },
  'unit-mansion': {
    assetName: 'unit-mansion',
    labelPt: 'Mansão',
    role: 'housing',
    summaryPt: '+12 População · +12 Ouro · 3 turnos',
    buildCost: { gold: 240, wood: 35, stone: 25, food: 0, ore: 0, metal: 2 },
    buildTimeTurns: 3,
    maintenanceGold: 5,
    workersRequired: 0,
    housingCapacity: 12,
    storageBonus: 30,
    defenseBonus: 2,
    production: { gold: 12, wood: 0, stone: 0, food: 0, ore: 0, metal: 0, science: 0 },
    allowedTerrains: ['plains', 'fertile'],
    requiredTech: 'construction',
    canRecruitUnits: false,
  },
  'building-farm': {
    assetName: 'building-farm',
    labelPt: 'Fazenda',
    role: 'production',
    summaryPt: '+8 Alimento · 2 trabalhadores · 1 turno · Terra fértil',
    buildCost: { gold: 60, wood: 12, stone: 0, food: 0, ore: 0, metal: 0 },
    buildTimeTurns: 1,
    maintenanceGold: 2,
    workersRequired: 2,
    housingCapacity: 0,
    storageBonus: 20,
    defenseBonus: 0,
    production: { gold: 0, wood: 0, stone: 0, food: 8, ore: 0, metal: 0, science: 0 },
    allowedTerrains: ['fertile', 'plains'],
    requiredTech: null,
    canRecruitUnits: false,
  },
  'building-sheep': {
    assetName: 'building-sheep',
    labelPt: 'Curral',
    role: 'production',
    summaryPt: '+4 Alimento · +5 Ouro · 1 trabalhador · 1 turno',
    buildCost: { gold: 70, wood: 10, stone: 0, food: 0, ore: 0, metal: 0 },
    buildTimeTurns: 1,
    maintenanceGold: 2,
    workersRequired: 1,
    housingCapacity: 0,
    storageBonus: 10,
    defenseBonus: 0,
    production: { gold: 5, wood: 0, stone: 0, food: 4, ore: 0, metal: 0, science: 0 },
    allowedTerrains: ['plains', 'fertile'],
    requiredTech: null,
    canRecruitUnits: false,
  },
  'building-mill': {
    assetName: 'building-mill',
    labelPt: 'Moinho',
    role: 'production',
    summaryPt: '+7 Alimento · +6 Ouro · 2 trabalhadores · 2 turnos',
    buildCost: { gold: 110, wood: 20, stone: 10, food: 0, ore: 0, metal: 0 },
    buildTimeTurns: 2,
    maintenanceGold: 3,
    workersRequired: 2,
    housingCapacity: 0,
    storageBonus: 30,
    defenseBonus: 0,
    production: { gold: 6, wood: 0, stone: 0, food: 7, ore: 0, metal: 0, science: 0 },
    allowedTerrains: ['plains', 'fertile'],
    requiredTech: 'agriculture',
    canRecruitUnits: false,
  },
  'dirt-lumber': {
    assetName: 'dirt-lumber',
    labelPt: 'Serraria',
    role: 'production',
    summaryPt: '+7 Madeira · 2 trabalhadores · 2 turnos · Floresta',
    buildCost: { gold: 75, wood: 5, stone: 10, food: 0, ore: 0, metal: 0 },
    buildTimeTurns: 2,
    maintenanceGold: 2,
    workersRequired: 2,
    housingCapacity: 0,
    storageBonus: 20,
    defenseBonus: 0,
    production: { gold: 0, wood: 7, stone: 0, food: 0, ore: 0, metal: 0, science: 0 },
    allowedTerrains: ['forest'],
    requiredTech: null,
    canRecruitUnits: false,
  },
  'building-smelter': {
    assetName: 'building-smelter',
    labelPt: 'Fundição',
    role: 'production',
    summaryPt: '2 Minério → +3 Metal · +4 Ouro · 2 trabalhadores · 2 turnos',
    buildCost: { gold: 140, wood: 20, stone: 20, food: 0, ore: 10, metal: 0 },
    buildTimeTurns: 2,
    maintenanceGold: 4,
    workersRequired: 2,
    housingCapacity: 0,
    storageBonus: 35,
    defenseBonus: 0,
    production: { gold: 4, wood: 0, stone: 0, food: 0, ore: 0, metal: 3, science: 0 },
    inputConsumption: { ore: 2 },
    allowedTerrains: ['mountain', 'plains'],
    requiredTech: 'metallurgy',
    canRecruitUnits: false,
  },
  'building-mine': {
    assetName: 'building-mine',
    labelPt: 'Mina',
    role: 'production',
    summaryPt: '+7 Minério · +4 Pedra · 2 trabalhadores · 3 turnos · Montanha',
    buildCost: { gold: 120, wood: 20, stone: 10, food: 0, ore: 0, metal: 0 },
    buildTimeTurns: 3,
    maintenanceGold: 4,
    workersRequired: 2,
    housingCapacity: 0,
    storageBonus: 25,
    defenseBonus: 0,
    production: { gold: 0, wood: 0, stone: 4, food: 0, ore: 7, metal: 0, science: 0 },
    allowedTerrains: ['mountain'],
    requiredTech: 'mining',
    canRecruitUnits: false,
  },
  'building-market': {
    assetName: 'building-market',
    labelPt: 'Mercado',
    role: 'commerce',
    summaryPt: '+18 Ouro · +60 Armazém · Melhora preços · 2 turnos',
    buildCost: { gold: 120, wood: 20, stone: 10, food: 0, ore: 0, metal: 0 },
    buildTimeTurns: 2,
    maintenanceGold: 2,
    workersRequired: 2,
    housingCapacity: 0,
    storageBonus: 60,
    defenseBonus: 0,
    production: { gold: 18, wood: 0, stone: 0, food: 0, ore: 0, metal: 0, science: 0 },
    allowedTerrains: ['plains', 'fertile'],
    requiredTech: null,
    canRecruitUnits: false,
  },
  'building-port': {
    assetName: 'building-port',
    labelPt: 'Porto',
    role: 'commerce',
    summaryPt: '+25 Ouro · +5 Alim · +80 Armazém · Recruta Navios · 3 turnos',
    buildCost: { gold: 180, wood: 30, stone: 15, food: 0, ore: 0, metal: 0 },
    buildTimeTurns: 3,
    maintenanceGold: 5,
    workersRequired: 2,
    housingCapacity: 0,
    storageBonus: 80,
    defenseBonus: 2,
    production: { gold: 25, wood: 0, stone: 0, food: 5, ore: 0, metal: 0, science: 0 },
    allowedTerrains: ['water'],
    requiredTech: 'trade',
    canRecruitUnits: true,
  },
  'building-dock': {
    assetName: 'building-dock',
    labelPt: 'Doca de Pesca',
    role: 'production',
    summaryPt: '+6 Alimento · +8 Ouro · 1 trabalhador · 2 turnos · Água',
    buildCost: { gold: 80, wood: 15, stone: 0, food: 0, ore: 0, metal: 0 },
    buildTimeTurns: 2,
    maintenanceGold: 2,
    workersRequired: 1,
    housingCapacity: 0,
    storageBonus: 15,
    defenseBonus: 0,
    production: { gold: 8, wood: 0, stone: 0, food: 6, ore: 0, metal: 0, science: 0 },
    allowedTerrains: ['water', 'plains', 'fertile'],
    requiredTech: null,
    canRecruitUnits: false,
  },
  'building-watermill': {
    assetName: 'building-watermill',
    labelPt: 'Moinho Fluvial',
    role: 'production',
    summaryPt: '+7 Alimento · +8 Ouro · 1 trabalhador · 2 turnos · Água adj.',
    buildCost: { gold: 100, wood: 20, stone: 10, food: 0, ore: 0, metal: 0 },
    buildTimeTurns: 2,
    maintenanceGold: 2,
    workersRequired: 1,
    housingCapacity: 0,
    storageBonus: 20,
    defenseBonus: 0,
    production: { gold: 8, wood: 0, stone: 0, food: 7, ore: 0, metal: 0, science: 0 },
    allowedTerrains: ['water', 'plains', 'fertile'],
    requiredTech: 'agriculture',
    canRecruitUnits: false,
  },
  'building-wizard-tower': {
    assetName: 'building-wizard-tower',
    labelPt: 'Universidade',
    role: 'science',
    summaryPt: '+6 Ciência · 2 trabalhadores · 2 turnos',
    buildCost: { gold: 150, wood: 20, stone: 20, food: 0, ore: 0, metal: 0 },
    buildTimeTurns: 2,
    maintenanceGold: 5,
    workersRequired: 2,
    housingCapacity: 0,
    storageBonus: 20,
    defenseBonus: 3,
    production: { gold: 0, wood: 0, stone: 0, food: 0, ore: 0, metal: 0, science: 6 },
    allowedTerrains: ['plains', 'fertile', 'forest', 'mountain'],
    requiredTech: null,
    canRecruitUnits: false,
  },
  'building-archery': {
    assetName: 'building-archery',
    labelPt: 'Quartel',
    role: 'military',
    summaryPt: 'Recruta tropas · +6 Defesa · 2 trabalhadores · 2 turnos',
    buildCost: { gold: 150, wood: 20, stone: 20, food: 0, ore: 10, metal: 0 },
    buildTimeTurns: 2,
    maintenanceGold: 3,
    workersRequired: 2,
    housingCapacity: 0,
    storageBonus: 10,
    defenseBonus: 6,
    production: ZERO_PROD,
    allowedTerrains: ['plains', 'fertile', 'forest'],
    requiredTech: 'military',
    canRecruitUnits: true,
  },
  'unit-wall-tower': {
    assetName: 'unit-wall-tower',
    labelPt: 'Bastião de Ferro',
    role: 'military',
    summaryPt: '+14 Defesa · +6 Ouro · Recruta Cavaleiro · 3 turnos',
    buildCost: { gold: 190, wood: 15, stone: 30, food: 0, ore: 10, metal: 6 },
    buildTimeTurns: 3,
    maintenanceGold: 3,
    workersRequired: 2,
    housingCapacity: 0,
    storageBonus: 20,
    defenseBonus: 14,
    production: { gold: 6, wood: 0, stone: 0, food: 0, ore: 0, metal: 0, science: 0 },
    allowedTerrains: ['plains', 'fertile', 'mountain'],
    requiredTech: 'metallurgy',
    canRecruitUnits: true,
  },
  'building-tower': {
    assetName: 'building-tower',
    labelPt: 'Torre de Guarda',
    role: 'military',
    summaryPt: '+8 Defesa · 1 trabalhador · 2 turnos',
    buildCost: { gold: 100, wood: 10, stone: 15, food: 0, ore: 5, metal: 0 },
    buildTimeTurns: 2,
    maintenanceGold: 2,
    workersRequired: 1,
    housingCapacity: 0,
    storageBonus: 0,
    defenseBonus: 8,
    production: ZERO_PROD,
    allowedTerrains: ['plains', 'fertile', 'forest', 'mountain'],
    requiredTech: 'military',
    canRecruitUnits: false,
  },
  'building-wall': {
    assetName: 'building-wall',
    labelPt: 'Paliçada',
    role: 'military',
    summaryPt: '+7 Defesa · 1 turno',
    buildCost: { gold: 50, wood: 12, stone: 8, food: 0, ore: 0, metal: 0 },
    buildTimeTurns: 1,
    maintenanceGold: 1,
    workersRequired: 0,
    housingCapacity: 0,
    storageBonus: 0,
    defenseBonus: 7,
    production: ZERO_PROD,
    allowedTerrains: ['plains', 'fertile', 'forest', 'mountain'],
    requiredTech: null,
    canRecruitUnits: false,
  },
  'building-walls': {
    assetName: 'building-walls',
    labelPt: 'Muralha',
    role: 'military',
    summaryPt: '+12 Defesa · 3 turnos',
    buildCost: { gold: 80, wood: 0, stone: 22, food: 0, ore: 5, metal: 4 },
    buildTimeTurns: 3,
    maintenanceGold: 1,
    workersRequired: 0,
    housingCapacity: 0,
    storageBonus: 0,
    defenseBonus: 12,
    production: ZERO_PROD,
    allowedTerrains: ['plains', 'fertile', 'mountain'],
    requiredTech: 'engineering',
    canRecruitUnits: false,
  },
  bridge: {
    assetName: 'bridge',
    labelPt: 'Ponte',
    role: 'infrastructure',
    summaryPt: 'Travessia · +4 Ouro · 1 turno · Água',
    buildCost: { gold: 100, wood: 15, stone: 10, food: 0, ore: 0, metal: 0 },
    buildTimeTurns: 1,
    maintenanceGold: 1,
    workersRequired: 0,
    housingCapacity: 0,
    storageBonus: 0,
    defenseBonus: 0,
    production: { gold: 4, wood: 0, stone: 0, food: 0, ore: 0, metal: 0, science: 0 },
    allowedTerrains: ['water'],
    requiredTech: null,
    canRecruitUnits: false,
  },
};

export function isConstructibleBuildingName(assetName: string): boolean {
  return Object.prototype.hasOwnProperty.call(BUILDING_CATALOG, assetName);
}

export function getBuildingDefinition(assetName: string): BuildingDefinition {
  const known = BUILDING_CATALOG[assetName];
  if (known) return known;

  return {
    assetName,
    labelPt: assetName.replace(/^(building|unit|path|river)-/, '').replace(/-/g, ' '),
    role: 'infrastructure',
    summaryPt: 'Estrutura do território',
    buildCost: { ...ZERO_COST, gold: 25 },
    buildTimeTurns: 1,
    maintenanceGold: 0,
    workersRequired: 0,
    housingCapacity: 0,
    storageBonus: 0,
    defenseBonus: 0,
    production: ZERO_PROD,
    allowedTerrains: null,
    requiredTech: null,
    canRecruitUnits: false,
  };
}

/**
 * Curated strategy building palette order so key buildings appear first in the UI.
 */
export const STRATEGY_PALETTE_ORDER: readonly string[] = [
  'building-house',
  'building-cabin',
  'building-farm',
  'dirt-lumber',
  'building-mine',
  'building-smelter',
  'building-market',
  'building-wizard-tower',
  'building-archery',
  'building-tower',
  'unit-wall-tower',
  'building-mill',
  'building-watermill',
  'building-sheep',
  'building-dock',
  'building-port',
  'building-village',
  'building-walls',
  'building-wall',
  'unit-mansion',
  'bridge',
];
