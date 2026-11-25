import {
  type HexWorldState,
  type AxialCoord,
  hexKey,
} from './hex-engine';

export type TechId =
  | 'agriculture'
  | 'mining'
  | 'construction'
  | 'trade'
  | 'metallurgy'
  | 'engineering'
  | 'military';

export const TECH_PATHS = {
  agricultura: ['agriculture'],
  engenharia: ['construction', 'engineering'],
  metalurgia: ['mining', 'metallurgy'],
  comercio: ['trade'],
  militar: ['military'],
} as const;

export type TechPathId = keyof typeof TECH_PATHS;

export const TECH_PATH_LABELS_PT: Record<TechPathId, string> = {
  agricultura: 'Agricultura',
  engenharia: 'Engenharia',
  metalurgia: 'Metalurgia',
  comercio: 'Comércio',
  militar: 'Militar',
};

export interface TechDefinition {
  id: TechId;
  namePt: string;
  descriptionPt: string;
  costScience: number;
  prerequisites: TechId[];
  unlocksBuildings: string[];
  unlocksUnits: string[];
  effectsSummaryPt: string;
  tier: 1 | 2 | 3;
  path: TechPathId;
  effects: Record<string, number>;
}

export interface ResearchState {
  unlocked: TechId[];
  activeTechId: TechId | null;
  progressScience: number;
}

export const TECH_TREE: readonly TechDefinition[] = [
  {
    id: 'agriculture',
    namePt: 'Agricultura',
    descriptionPt: 'Técnicas de irrigação e rotação de culturas.',
    costScience: 12,
    prerequisites: [],
    unlocksBuildings: ['building-mill'],
    unlocksUnits: [],
    effectsSummaryPt: '+40% Alimento · Libera Moinho',
    tier: 1,
    path: 'agricultura',
    effects: {
      foodMultiplier: 1.4,
    },
  },
  {
    id: 'mining',
    namePt: 'Mineração',
    descriptionPt: 'Escavação profunda em montanhas para extrair minérios.',
    costScience: 15,
    prerequisites: [],
    unlocksBuildings: ['building-mine'],
    unlocksUnits: [],
    effectsSummaryPt: '+40% Pedra e Minério · Libera Mina',
    tier: 1,
    path: 'metalurgia',
    effects: {
      stoneOreMultiplier: 1.4,
    },
  },
  {
    id: 'construction',
    namePt: 'Construção',
    descriptionPt: 'Alvenaria estrutural e planejamento urbano.',
    costScience: 18,
    prerequisites: ['agriculture'],
    unlocksBuildings: ['building-village', 'unit-mansion'],
    unlocksUnits: [],
    effectsSummaryPt: '-15% custo de obras · +50 Armazém · +2 Cap. · +1 Alcance · Libera Vila',
    tier: 2,
    path: 'engenharia',
    effects: {
      buildCostMultiplier: 0.85,
      territorialCapacityBonus: 2,
      anchorReachBonus: 1,
      bonusStorage: 50,
      explorationRangeBonus: 1,
    },
  },
  {
    id: 'trade',
    namePt: 'Comércio',
    descriptionPt: 'Rotas mercantis marítimas e feiras reais.',
    costScience: 22,
    prerequisites: ['agriculture'],
    unlocksBuildings: ['building-port'],
    unlocksUnits: ['warship'],
    effectsSummaryPt: '+35% Ouro · +2 Cap. · +1 Alcance · Libera Porto e Navio',
    tier: 2,
    path: 'comercio',
    effects: {
      goldMultiplier: 1.35,
      territorialCapacityBonus: 2,
      anchorReachBonus: 1,
      explorationRangeBonus: 1,
    },
  },
  {
    id: 'military',
    namePt: 'Militar',
    descriptionPt: 'Organização de guarnições, quartéis e defesas de fronteira.',
    costScience: 20,
    prerequisites: ['mining'],
    unlocksBuildings: ['building-archery', 'building-tower'],
    unlocksUnits: ['infantry', 'archer'],
    effectsSummaryPt: 'Libera Quartel, Torre e Tropas',
    tier: 2,
    path: 'militar',
    effects: {
      explorationRangeBonus: 1,
    },
  },
  {
    id: 'metallurgy',
    namePt: 'Metalurgia',
    descriptionPt: 'Forjas avançadas para refinar minério em metal e armamentos pesados.',
    costScience: 28,
    prerequisites: ['mining', 'military'],
    unlocksBuildings: ['building-smelter', 'unit-wall-tower'],
    unlocksUnits: ['knight'],
    effectsSummaryPt: '+4 Ataque/Defesa · +30% Minério · Libera Fundição, Bastião e Cavaleiro',
    tier: 3,
    path: 'metalurgia',
    effects: {
      oreBonusMultiplier: 1.3,
      militaryCombatBonus: 4,
    },
  },
  {
    id: 'engineering',
    namePt: 'Engenharia',
    descriptionPt: 'Fortificações, pontes de pedra e grandes armazéns.',
    costScience: 35,
    prerequisites: ['construction', 'mining'],
    unlocksBuildings: ['building-walls'],
    unlocksUnits: [],
    effectsSummaryPt: '+80 Armazém · -1t incorporação · +4 Cap. · +1 Alcance · Libera Muralhas',
    tier: 3,
    path: 'engenharia',
    effects: {
      territorialCapacityBonus: 4,
      anchorReachBonus: 1,
      expansionTurnReduction: 1,
      bonusStorage: 80,
      explorationRangeBonus: 1,
    },
  },
] as const;

export const TECH_BY_ID: Record<TechId, TechDefinition> = TECH_TREE.reduce(
  (acc, tech) => {
    acc[tech.id] = tech;
    return acc;
  },
  {} as Record<TechId, TechDefinition>
);

export function createInitialResearchState(): ResearchState {
  return {
    unlocked: [],
    activeTechId: 'agriculture',
    progressScience: 0,
  };
}

export function isTechUnlocked(research: ResearchState, techId: TechId): boolean {
  return research.unlocked.includes(techId);
}

export function canStartResearch(research: ResearchState, techId: TechId): boolean {
  if (isTechUnlocked(research, techId)) return false;
  const def = TECH_BY_ID[techId];
  if (!def) return false;
  return def.prerequisites.every((req) => research.unlocked.includes(req));
}

export function getAvailableTechs(research: ResearchState): TechDefinition[] {
  return TECH_TREE.filter((t) => canStartResearch(research, t.id));
}

export function getAvailableTechsInPath(
  research: ResearchState,
  path: TechPathId
): TechDefinition[] {
  return TECH_PATHS[path]
    .filter((id) => canStartResearch(research, id))
    .map((id) => TECH_BY_ID[id]);
}

export function getUnlockedBuildings(unlocked: TechId[]): string[] {
  const set = new Set<string>();
  for (const id of unlocked) {
    const def = TECH_BY_ID[id];
    if (def?.unlocksBuildings) {
      for (const b of def.unlocksBuildings) {
        set.add(b);
      }
    }
  }
  return Array.from(set);
}

export function getUnlockedUnits(unlocked: TechId[]): string[] {
  const set = new Set<string>();
  for (const id of unlocked) {
    const def = TECH_BY_ID[id];
    if (def?.unlocksUnits) {
      for (const u of def.unlocksUnits) {
        set.add(u);
      }
    }
  }
  return Array.from(set);
}

export function serializeResearchState(research: ResearchState): string {
  return JSON.stringify(research);
}

export function deserializeResearchState(raw: string): ResearchState | null {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.unlocked)) return null;
    return {
      unlocked: parsed.unlocked.filter((id: string) => id in TECH_BY_ID),
      activeTechId: (parsed.activeTechId in TECH_BY_ID ? parsed.activeTechId : null) as TechId | null,
      progressScience: typeof parsed.progressScience === 'number' ? parsed.progressScience : 0,
    };
  } catch {
    return null;
  }
}

export function nextRecommendedTech(
  research: ResearchState,
  personality: 'expansionist' | 'mercantile'
): TechId | null {
  const priorityOrder: TechId[] =
    personality === 'expansionist'
      ? ['mining', 'military', 'metallurgy', 'agriculture', 'construction', 'engineering', 'trade']
      : ['agriculture', 'trade', 'construction', 'mining', 'engineering', 'military', 'metallurgy'];

  const available = new Set(getAvailableTechs(research).map((t) => t.id));
  for (const id of priorityOrder) {
    if (available.has(id)) return id;
  }
  return null;
}

export function selectActiveTech(
  research: ResearchState,
  techId: TechId
): { nextResearch: ResearchState; selected: boolean } {
  if (!canStartResearch(research, techId)) {
    return { nextResearch: research, selected: false };
  }
  return {
    nextResearch: {
      ...research,
      activeTechId: techId,
    },
    selected: true,
  };
}

export function advanceResearchProgress(
  research: ResearchState,
  scienceAdded: number
): {
  nextResearch: ResearchState;
  completedTech: TechDefinition | null;
} {
  if (!research.activeTechId || scienceAdded <= 0) {
    return { nextResearch: research, completedTech: null };
  }

  const activeDef = TECH_BY_ID[research.activeTechId];
  if (!activeDef || isTechUnlocked(research, activeDef.id)) {
    return { nextResearch: research, completedTech: null };
  }

  const total = research.progressScience + scienceAdded;
  if (total < activeDef.costScience) {
    return {
      nextResearch: {
        ...research,
        progressScience: total,
      },
      completedTech: null,
    };
  }

  const overflow = total - activeDef.costScience;
  const nextUnlocked: TechId[] = [...research.unlocked, activeDef.id];
  const provisional: ResearchState = {
    unlocked: nextUnlocked,
    activeTechId: null,
    progressScience: overflow,
  };

  // Auto-queue next available tech cleanly so science never goes to waste
  const nextCandidates = getAvailableTechs(provisional);
  const nextActive = nextCandidates.length > 0 ? nextCandidates[0].id : null;

  return {
    nextResearch: {
      unlocked: nextUnlocked,
      activeTechId: nextActive,
      progressScience: nextActive ? Math.min(overflow, TECH_BY_ID[nextActive].costScience - 1) : 0,
    },
    completedTech: activeDef,
  };
}

export interface TechModifiers {
  foodMultiplier: number;
  stoneOreMultiplier: number;
  oreBonusMultiplier: number;
  goldMultiplier: number;
  buildCostMultiplier: number;
  territorialCapacityBonus: number;
  anchorReachBonus: number;
  expansionTurnReduction: number;
  bonusStorage: number;
  militaryCombatBonus: number;
  explorationRangeBonus: number;
}

export function getTechModifiers(unlocked: TechId[]): TechModifiers {
  const has = (id: TechId) => unlocked.includes(id);
  return {
    foodMultiplier: has('agriculture') ? 1.4 : 1,
    stoneOreMultiplier: has('mining') ? 1.4 : 1,
    oreBonusMultiplier: has('metallurgy') ? 1.3 : 1,
    goldMultiplier: has('trade') ? 1.35 : 1,
    buildCostMultiplier: has('construction') ? 0.85 : 1,
    territorialCapacityBonus:
      (has('construction') ? 2 : 0) +
      (has('trade') ? 2 : 0) +
      (has('engineering') ? 4 : 0),
    anchorReachBonus:
      (has('construction') ? 1 : 0) +
      (has('trade') ? 1 : 0) +
      (has('engineering') ? 1 : 0),
    expansionTurnReduction: has('engineering') ? 1 : 0,
    bonusStorage: (has('construction') ? 50 : 0) + (has('engineering') ? 80 : 0),
    militaryCombatBonus: has('metallurgy') ? 4 : 0,
    explorationRangeBonus:
      (has('construction') ? 1 : 0) +
      (has('trade') ? 1 : 0) +
      (has('military') ? 1 : 0) +
      (has('engineering') ? 1 : 0),
  };
}
