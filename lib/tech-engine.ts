export type TechId =
  // Original 7 IDs (preserved 100% for save compatibility)
  | 'agriculture'
  | 'mining'
  | 'construction'
  | 'trade'
  | 'metallurgy'
  | 'engineering'
  | 'military'
  // Agricultura & População (Tier 2-4)
  | 'irrigation'
  | 'crop_rotation'
  | 'agronomy'
  // Engenharia & Urbanismo (Tier 1 & 4)
  | 'masonry'
  | 'urban_planning'
  // Mineração & Metalurgia (Tier 2 & 4)
  | 'smelting'
  | 'steel_forging'
  // Comércio & Navegação (Tier 1, 3, 4)
  | 'barter'
  | 'guilds'
  | 'maritime_empire'
  // Militar & Defesa (Tier 1, 3, 4)
  | 'militia'
  | 'fortifications'
  | 'tactics'
  // Exploração & Conhecimento (Tier 1-4)
  | 'scouting'
  | 'cartography'
  | 'academies'
  | 'enlightenment';

export const TECH_PATHS = {
  agricultura: ['agriculture', 'irrigation', 'crop_rotation', 'agronomy'],
  engenharia: ['masonry', 'construction', 'engineering', 'urban_planning'],
  metalurgia: ['mining', 'smelting', 'metallurgy', 'steel_forging'],
  comercio: ['barter', 'trade', 'guilds', 'maritime_empire'],
  militar: ['militia', 'military', 'fortifications', 'tactics'],
  conhecimento: ['scouting', 'cartography', 'academies', 'enlightenment'],
} as const;

export type TechPathId = keyof typeof TECH_PATHS;

export const TECH_PATH_LABELS_PT: Record<TechPathId, string> = {
  agricultura: 'Agricultura e População',
  engenharia: 'Engenharia e Urbanismo',
  metalurgia: 'Mineração e Metalurgia',
  comercio: 'Comércio e Navegação',
  militar: 'Militar e Defesa',
  conhecimento: 'Exploração e Conhecimento',
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
  tier: 1 | 2 | 3 | 4;
  path: TechPathId;
  effects: Record<string, number>;
}

export interface ResearchState {
  unlocked: TechId[];
  activeTechId: TechId | null;
  progressScience: number;
}

export const TECH_TREE: readonly TechDefinition[] = [
  // =========================================================================
  // 1. AGRICULTURA E POPULAÇÃO
  // =========================================================================
  {
    id: 'agriculture',
    namePt: 'Agricultura',
    descriptionPt: 'Técnicas de irrigação e rotação inicial de culturas.',
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
    id: 'irrigation',
    namePt: 'Irrigação Avançada',
    descriptionPt: 'Canais fluviais e reservatórios que estabilizam safras e nutrem vilarejos.',
    costScience: 28,
    prerequisites: ['agriculture'],
    unlocksBuildings: [],
    unlocksUnits: [],
    effectsSummaryPt: '+25% Alimento · +2 Habitação · -10% consumo alimentar',
    tier: 2,
    path: 'agricultura',
    effects: {
      foodMultiplierBonus: 0.25,
      housingBonus: 2,
      foodDemandMultiplier: 0.9,
    },
  },
  {
    id: 'crop_rotation',
    namePt: 'Rotação de Culturas',
    descriptionPt: 'Alternância trienal de plantios preserva o solo e sustenta crescimento contínuo.',
    costScience: 52,
    prerequisites: ['irrigation'],
    unlocksBuildings: [],
    unlocksUnits: [],
    effectsSummaryPt: '+25% Alimento · +1 Crescimento pop. · +40 Armazém',
    tier: 3,
    path: 'agricultura',
    effects: {
      foodMultiplierBonus: 0.25,
      popGrowthBonus: 1,
      bonusStorage: 40,
    },
  },
  {
    id: 'agronomy',
    namePt: 'Agronomia Real',
    descriptionPt: 'Seleção de sementes e celeiros estatais capazes de sustentar metrópoles.',
    costScience: 88,
    prerequisites: ['crop_rotation', 'engineering'],
    unlocksBuildings: [],
    unlocksUnits: [],
    effectsSummaryPt: '+30% Alimento · +4 Habitação · -10% consumo alimentar',
    tier: 4,
    path: 'agricultura',
    effects: {
      foodMultiplierBonus: 0.3,
      housingBonus: 4,
      foodDemandMultiplier: 0.9,
    },
  },

  // =========================================================================
  // 2. ENGENHARIA E URBANISMO
  // =========================================================================
  {
    id: 'masonry',
    namePt: 'Alvenaria Básica',
    descriptionPt: 'Corte de blocos de pedra e fundações sólidas para edifícios duráveis.',
    costScience: 14,
    prerequisites: [],
    unlocksBuildings: [],
    unlocksUnits: [],
    effectsSummaryPt: '-10% custo de obras · +30 Armazém · +1 Defesa',
    tier: 1,
    path: 'engenharia',
    effects: {
      buildCostMultiplier: 0.9,
      bonusStorage: 30,
      defenseBonus: 1,
    },
  },
  {
    id: 'construction',
    namePt: 'Construção',
    descriptionPt: 'Alvenaria estrutural e planejamento urbano organizado.',
    costScience: 30,
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
    id: 'engineering',
    namePt: 'Engenharia',
    descriptionPt: 'Fortificações, pontes de pedra e grandes obras hidráulicas.',
    costScience: 62,
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
  {
    id: 'urban_planning',
    namePt: 'Urbanismo Imperial',
    descriptionPt: 'Bairros planejados, aquedutos e gestão municipal de baixa manutenção.',
    costScience: 96,
    prerequisites: ['engineering', 'guilds'],
    unlocksBuildings: [],
    unlocksUnits: [],
    effectsSummaryPt: '+6 Habitação · +4 Cap. · -15% manutenção · +3 Qualidade Urbana',
    tier: 4,
    path: 'engenharia',
    effects: {
      housingBonus: 6,
      territorialCapacityBonus: 4,
      maintenanceMultiplier: 0.85,
      urbanQualityBonus: 3,
    },
  },

  // =========================================================================
  // 3. MINERAÇÃO E METALURGIA
  // =========================================================================
  {
    id: 'mining',
    namePt: 'Mineração',
    descriptionPt: 'Escavação profunda em montanhas para extrair pedra e minérios.',
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
    id: 'smelting',
    namePt: 'Forja de Bronze e Ferro',
    descriptionPt: 'Ferramentas metálicas para lenhadores, pedreiros e fundidores.',
    costScience: 30,
    prerequisites: ['mining'],
    unlocksBuildings: [],
    unlocksUnits: [],
    effectsSummaryPt: '+25% Madeira · +20% Pedra/Minério · +25% Metal refinado',
    tier: 2,
    path: 'metalurgia',
    effects: {
      woodMultiplierBonus: 0.25,
      stoneOreMultiplierBonus: 0.2,
      metalMultiplierBonus: 0.25,
    },
  },
  {
    id: 'metallurgy',
    namePt: 'Metalurgia',
    descriptionPt: 'Forjas avançadas para refinar minério em metal e armamentos pesados.',
    costScience: 56,
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
    id: 'steel_forging',
    namePt: 'Aço Temperado',
    descriptionPt: 'Altos-fornos que produzem ligas superiores para armas e engenharia.',
    costScience: 92,
    prerequisites: ['metallurgy', 'smelting'],
    unlocksBuildings: [],
    unlocksUnits: [],
    effectsSummaryPt: '+35% Minério e Metal · +5 Ataque/Defesa · -10% custo de obras',
    tier: 4,
    path: 'metalurgia',
    effects: {
      oreBonusMultiplierBonus: 0.35,
      metalMultiplierBonus: 0.35,
      militaryCombatBonus: 5,
      buildCostMultiplier: 0.9,
    },
  },

  // =========================================================================
  // 4. COMÉRCIO E NAVEGAÇÃO
  // =========================================================================
  {
    id: 'barter',
    namePt: 'Mercados e Pesos',
    descriptionPt: 'Padronização de moedas, balanças e feiras locais nas estradas.',
    costScience: 14,
    prerequisites: [],
    unlocksBuildings: [],
    unlocksUnits: [],
    effectsSummaryPt: '+15% Ouro · -10% taxa de mercado',
    tier: 1,
    path: 'comercio',
    effects: {
      goldMultiplierBonus: 0.15,
      tradeFeeReduction: 0.1,
    },
  },
  {
    id: 'trade',
    namePt: 'Comércio',
    descriptionPt: 'Rotas mercantis marítimas e feiras reais.',
    costScience: 34,
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
    id: 'guilds',
    namePt: 'Guildas Mercantis',
    descriptionPt: 'Casas bancárias e corporações que multiplicam a renda das rotas.',
    costScience: 58,
    prerequisites: ['trade', 'barter'],
    unlocksBuildings: [],
    unlocksUnits: [],
    effectsSummaryPt: '+25% Ouro · +30% receita de rotas · -15% taxa de mercado',
    tier: 3,
    path: 'comercio',
    effects: {
      goldMultiplierBonus: 0.25,
      tradeRouteBonus: 0.3,
      tradeFeeReduction: 0.15,
    },
  },
  {
    id: 'maritime_empire',
    namePt: 'Navegação Oceânica',
    descriptionPt: 'Caravelas, astrolábios e grandes frotas comerciais intercontinentais.',
    costScience: 94,
    prerequisites: ['guilds', 'cartography'],
    unlocksBuildings: [],
    unlocksUnits: [],
    effectsSummaryPt: '+35% Ouro · +25% rotas · +2 Alcance Expl. · +3 Cap.',
    tier: 4,
    path: 'comercio',
    effects: {
      goldMultiplierBonus: 0.35,
      tradeRouteBonus: 0.25,
      explorationRangeBonus: 2,
      territorialCapacityBonus: 3,
    },
  },

  // =========================================================================
  // 5. MILITAR E DEFESA
  // =========================================================================
  {
    id: 'militia',
    namePt: 'Milícia Cidadã',
    descriptionPt: 'Treinamento básico de defesa comunitária com baixo custo permanente.',
    costScience: 15,
    prerequisites: [],
    unlocksBuildings: [],
    unlocksUnits: [],
    effectsSummaryPt: '+2 Defesa territorial · -10% manutenção militar',
    tier: 1,
    path: 'militar',
    effects: {
      defenseBonus: 2,
      unitUpkeepMultiplier: 0.9,
    },
  },
  {
    id: 'military',
    namePt: 'Militar',
    descriptionPt: 'Organização de guarnições, quartéis e defesas de fronteira.',
    costScience: 32,
    prerequisites: ['mining'],
    unlocksBuildings: ['building-archery', 'building-tower'],
    unlocksUnits: ['infantry', 'archer'],
    effectsSummaryPt: 'Libera Quartel, Torre e Tropas · +1 Alcance Expl.',
    tier: 2,
    path: 'militar',
    effects: {
      explorationRangeBonus: 1,
    },
  },
  {
    id: 'fortifications',
    namePt: 'Fortificações de Pedra',
    descriptionPt: 'Ameias reforçadas, fossos e guarnições permanentes nas fronteiras.',
    costScience: 60,
    prerequisites: ['military', 'masonry'],
    unlocksBuildings: [],
    unlocksUnits: [],
    effectsSummaryPt: '+5 Defesa territorial · +3 Combate · -15% manutenção militar',
    tier: 3,
    path: 'militar',
    effects: {
      defenseBonus: 5,
      militaryCombatBonus: 3,
      unitUpkeepMultiplier: 0.85,
    },
  },
  {
    id: 'tactics',
    namePt: 'Doutrina Estratégica',
    descriptionPt: 'Logística de campanha, manobras combinadas e marchas forçadas.',
    costScience: 96,
    prerequisites: ['fortifications', 'metallurgy'],
    unlocksBuildings: [],
    unlocksUnits: [],
    effectsSummaryPt: '+6 Combate · +1 Movimento de Tropas · +4 Defesa',
    tier: 4,
    path: 'militar',
    effects: {
      militaryCombatBonus: 6,
      unitMovementBonus: 1,
      defenseBonus: 4,
    },
  },

  // =========================================================================
  // 6. EXPLORAÇÃO E CONHECIMENTO
  // =========================================================================
  {
    id: 'scouting',
    namePt: 'Batedores de Fronteira',
    descriptionPt: 'Companhias de reconhecimento que mapeiam vales e fronteiras distantes.',
    costScience: 14,
    prerequisites: [],
    unlocksBuildings: [],
    unlocksUnits: [],
    effectsSummaryPt: '+1 Alcance Expl. · +15% Ciência · +1 Cap. Territorial',
    tier: 1,
    path: 'conhecimento',
    effects: {
      explorationRangeBonus: 1,
      scienceMultiplierBonus: 0.15,
      territorialCapacityBonus: 1,
    },
  },
  {
    id: 'cartography',
    namePt: 'Cartografia',
    descriptionPt: 'Mapas topográficos precisos ampliam rotas, fronteiras e expedições.',
    costScience: 32,
    prerequisites: ['scouting'],
    unlocksBuildings: [],
    unlocksUnits: [],
    effectsSummaryPt: '+1 Alcance Expl. · +1 Alcance Territorial · +20% Ciência',
    tier: 2,
    path: 'conhecimento',
    effects: {
      explorationRangeBonus: 1,
      anchorReachBonus: 1,
      scienceMultiplierBonus: 0.2,
    },
  },
  {
    id: 'academies',
    namePt: 'Academias Reais',
    descriptionPt: 'Bibliotecas e círculos de sábios que aceleram todo o avanço do reino.',
    costScience: 58,
    prerequisites: ['cartography', 'construction'],
    unlocksBuildings: [],
    unlocksUnits: [],
    effectsSummaryPt: '+35% Ciência · +2 Ciência base/turno · +2 Qualidade Urbana',
    tier: 3,
    path: 'conhecimento',
    effects: {
      scienceMultiplierBonus: 0.35,
      flatScienceBonus: 2,
      urbanQualityBonus: 2,
    },
  },
  {
    id: 'enlightenment',
    namePt: 'Era do Saber',
    descriptionPt: 'Síntese científica e administrativa que eleva o império ao apogeu.',
    costScience: 98,
    prerequisites: ['academies', 'agronomy'],
    unlocksBuildings: [],
    unlocksUnits: [],
    effectsSummaryPt: '+45% Ciência · +4 Ciência base/turno · +2 Alcance Expl. · +3 Cap.',
    tier: 4,
    path: 'conhecimento',
    effects: {
      scienceMultiplierBonus: 0.45,
      flatScienceBonus: 4,
      explorationRangeBonus: 2,
      territorialCapacityBonus: 3,
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
      ? [
          'mining',
          'militia',
          'military',
          'masonry',
          'smelting',
          'metallurgy',
          'fortifications',
          'agriculture',
          'construction',
          'engineering',
          'steel_forging',
          'tactics',
          'scouting',
          'cartography',
          'barter',
          'trade',
          'irrigation',
          'crop_rotation',
          'guilds',
          'academies',
          'urban_planning',
          'maritime_empire',
          'agronomy',
          'enlightenment',
        ]
      : [
          'agriculture',
          'barter',
          'scouting',
          'trade',
          'construction',
          'irrigation',
          'cartography',
          'guilds',
          'mining',
          'masonry',
          'academies',
          'engineering',
          'crop_rotation',
          'maritime_empire',
          'urban_planning',
          'smelting',
          'militia',
          'military',
          'agronomy',
          'enlightenment',
          'metallurgy',
          'fortifications',
          'steel_forging',
          'tactics',
        ];

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
  woodMultiplier: number;
  stoneOreMultiplier: number;
  oreBonusMultiplier: number;
  metalMultiplier: number;
  goldMultiplier: number;
  scienceMultiplier: number;
  flatScienceBonus: number;
  buildCostMultiplier: number;
  maintenanceMultiplier: number;
  unitUpkeepMultiplier: number;
  territorialCapacityBonus: number;
  anchorReachBonus: number;
  expansionTurnReduction: number;
  bonusStorage: number;
  housingBonus: number;
  foodDemandMultiplier: number;
  popGrowthBonus: number;
  urbanQualityBonus: number;
  tradeFeeReduction: number;
  tradeRouteBonus: number;
  militaryCombatBonus: number;
  defenseBonus: number;
  unitMovementBonus: number;
  explorationRangeBonus: number;
}

export function getTechModifiers(unlocked: TechId[]): TechModifiers {
  const has = (id: TechId) => unlocked.includes(id);

  const foodMultiplier = Number(
    (
      1 +
      (has('agriculture') ? 0.4 : 0) +
      (has('irrigation') ? 0.25 : 0) +
      (has('crop_rotation') ? 0.25 : 0) +
      (has('agronomy') ? 0.3 : 0)
    ).toFixed(4)
  );

  const woodMultiplier = Number((1 + (has('smelting') ? 0.25 : 0)).toFixed(4));

  const stoneOreMultiplier = Number(
    (1 + (has('mining') ? 0.4 : 0) + (has('smelting') ? 0.2 : 0)).toFixed(4)
  );

  const oreBonusMultiplier = Number(
    (1 + (has('metallurgy') ? 0.3 : 0) + (has('steel_forging') ? 0.35 : 0)).toFixed(4)
  );

  const metalMultiplier = Number(
    (1 + (has('smelting') ? 0.25 : 0) + (has('steel_forging') ? 0.35 : 0)).toFixed(4)
  );

  const goldMultiplier = Number(
    (
      1 +
      (has('barter') ? 0.15 : 0) +
      (has('trade') ? 0.35 : 0) +
      (has('guilds') ? 0.25 : 0) +
      (has('maritime_empire') ? 0.35 : 0)
    ).toFixed(4)
  );

  const scienceMultiplier = Number(
    (
      1 +
      (has('scouting') ? 0.15 : 0) +
      (has('cartography') ? 0.2 : 0) +
      (has('academies') ? 0.35 : 0) +
      (has('enlightenment') ? 0.45 : 0)
    ).toFixed(4)
  );

  const buildCostMultiplier = Number(
    Math.max(
      0.55,
      (has('masonry') ? 0.9 : 1) *
        (has('construction') ? 0.85 : 1) *
        (has('steel_forging') ? 0.9 : 1)
    ).toFixed(4)
  );

  const maintenanceMultiplier = has('urban_planning') ? 0.85 : 1;

  const unitUpkeepMultiplier = Number(
    ((has('militia') ? 0.9 : 1) * (has('fortifications') ? 0.85 : 1)).toFixed(4)
  );

  const foodDemandMultiplier = Number(
    ((has('irrigation') ? 0.9 : 1) * (has('agronomy') ? 0.9 : 1)).toFixed(4)
  );

  return {
    foodMultiplier,
    woodMultiplier,
    stoneOreMultiplier,
    oreBonusMultiplier,
    metalMultiplier,
    goldMultiplier,
    scienceMultiplier,
    flatScienceBonus: (has('academies') ? 2 : 0) + (has('enlightenment') ? 4 : 0),
    buildCostMultiplier,
    maintenanceMultiplier,
    unitUpkeepMultiplier,
    territorialCapacityBonus:
      (has('scouting') ? 1 : 0) +
      (has('construction') ? 2 : 0) +
      (has('trade') ? 2 : 0) +
      (has('engineering') ? 4 : 0) +
      (has('maritime_empire') ? 3 : 0) +
      (has('enlightenment') ? 3 : 0) +
      (has('urban_planning') ? 4 : 0),
    anchorReachBonus:
      (has('construction') ? 1 : 0) +
      (has('trade') ? 1 : 0) +
      (has('cartography') ? 1 : 0) +
      (has('engineering') ? 1 : 0),
    expansionTurnReduction: has('engineering') ? 1 : 0,
    bonusStorage:
      (has('masonry') ? 30 : 0) +
      (has('construction') ? 50 : 0) +
      (has('crop_rotation') ? 40 : 0) +
      (has('engineering') ? 80 : 0),
    housingBonus:
      (has('irrigation') ? 2 : 0) +
      (has('agronomy') ? 4 : 0) +
      (has('urban_planning') ? 6 : 0),
    foodDemandMultiplier,
    popGrowthBonus: has('crop_rotation') ? 1 : 0,
    urbanQualityBonus: (has('academies') ? 2 : 0) + (has('urban_planning') ? 3 : 0),
    tradeFeeReduction: Number(
      ((has('barter') ? 0.1 : 0) + (has('guilds') ? 0.15 : 0)).toFixed(3)
    ),
    tradeRouteBonus: Number(
      ((has('guilds') ? 0.3 : 0) + (has('maritime_empire') ? 0.25 : 0)).toFixed(3)
    ),
    militaryCombatBonus:
      (has('fortifications') ? 3 : 0) +
      (has('metallurgy') ? 4 : 0) +
      (has('steel_forging') ? 5 : 0) +
      (has('tactics') ? 6 : 0),
    defenseBonus:
      (has('masonry') ? 1 : 0) +
      (has('militia') ? 2 : 0) +
      (has('fortifications') ? 5 : 0) +
      (has('tactics') ? 4 : 0),
    unitMovementBonus: has('tactics') ? 1 : 0,
    explorationRangeBonus:
      (has('scouting') ? 1 : 0) +
      (has('construction') ? 1 : 0) +
      (has('trade') ? 1 : 0) +
      (has('military') ? 1 : 0) +
      (has('cartography') ? 1 : 0) +
      (has('engineering') ? 1 : 0) +
      (has('maritime_empire') ? 2 : 0) +
      (has('enlightenment') ? 2 : 0),
  };
}
