import {
  type AxialCoord,
  type HexWorldState,
  hexKey,
} from './hex-engine';
import {
  axialDistance,
  getAxialNeighbors,
} from './territory-engine';
import {
  type TechId,
  getTechModifiers,
} from './tech-engine';
import {
  type RareFeatureType,
  isValidRareFeatureType,
} from './terrain-engine';

export type DiscoveryKind =
  | 'rare_resource'
  | 'ruin'
  | 'strategic_site'
  | 'special_area'
  | 'cache';

export interface DiscoveryReward {
  gold?: number;
  science?: number;
  food?: number;
  wood?: number;
  ore?: number;
}

export interface ClaimedDiscovery {
  id: string;
  namePt: string;
  kind: DiscoveryKind;
  coord: AxialCoord;
  descriptionPt: string;
  reward?: DiscoveryReward;
}

export interface ActiveExplorer {
  id: number;
  targetCoord: AxialCoord;
  originCoord: AxialCoord;
  turnsRemaining: number;
  totalTurns: number;
}

export interface ExplorationState {
  revealedKeys: string[];
  claimedDiscoveries: ClaimedDiscovery[];
  activeExplorers: ActiveExplorer[];
  nextExplorerId: number;
  rangeBonus: number;
  rangeBonusTurnsRemaining: number;
  explorationCount: number;
}

export type HexVisibility = 'unknown' | 'explored' | 'owned' | 'foreign';

export type ExplorationEventKind =
  | 'nothing'
  | 'friendly_natives'
  | 'resource_cache'
  | 'ancient_map'
  | 'lost_party'
  | 'ambush';

export interface ExplorationEvent {
  kind: ExplorationEventKind;
  namePt: string;
  descriptionPt: string;
  riskCost?: {
    gold?: number;
    population?: number;
  };
}

export interface ExplorationEvaluation {
  canExplore: boolean;
  reason?: string;
  distance: number;
  effectiveRange: number;
  goldCost: number;
  foodCost: number;
  turnsRequired: number;
}

export interface DiscoveryTemplate {
  id: string;
  namePt: string;
  kind: DiscoveryKind;
  descriptionPt: string;
  reward: DiscoveryReward;
}

export const DISCOVERY_CATALOG: readonly DiscoveryTemplate[] = [
  {
    id: 'ruin_ancient_citadel',
    namePt: 'Cidadela Esquecida',
    kind: 'ruin',
    descriptionPt: 'Restos de fortificações milenares contendo mapas e inscrições arcanas.',
    reward: { science: 25, gold: 30 },
  },
  {
    id: 'ruin_forgotten_crypt',
    namePt: 'Cripta Esquecida',
    kind: 'ruin',
    descriptionPt: 'Câmara mortuária selada guardando relíquias de metal nobre.',
    reward: { gold: 50, science: 10 },
  },
  {
    id: 'strategic_high_pass',
    namePt: 'Passo Estratégico',
    kind: 'strategic_site',
    descriptionPt: 'Desfiladeiro vantajoso que controla rotas comerciais e patrulhas.',
    reward: { science: 15, food: 20 },
  },
  {
    id: 'special_fertile_valley',
    namePt: 'Vale dos Antigos',
    kind: 'special_area',
    descriptionPt: 'Microclima protegido com flora exuberante e solos ricos.',
    reward: { food: 60, wood: 40 },
  },
  {
    id: 'cache_smugglers_den',
    namePt: 'Esconderijo de Contrabandistas',
    kind: 'cache',
    descriptionPt: 'Depósito clandestino de caixotes com ouro, madeira e provisões.',
    reward: { gold: 40, wood: 30, food: 25 },
  },
] as const;

export function getDiscoveryCatalog(): readonly DiscoveryTemplate[] {
  return DISCOVERY_CATALOG;
}

export function createInitialExplorationState(
  initialOwnedCoords?: AxialCoord[]
): ExplorationState {
  const set = new Set<string>();
  if (initialOwnedCoords) {
    for (const c of initialOwnedCoords) {
      set.add(hexKey(c.q, c.r));
    }
  }
  return {
    revealedKeys: Array.from(set),
    claimedDiscoveries: [],
    activeExplorers: [],
    nextExplorerId: 1,
    rangeBonus: 0,
    rangeBonusTurnsRemaining: 0,
    explorationCount: 0,
  };
}

function getTiles(worldState: HexWorldState): Record<string, any> {
  return worldState.hexes ?? (worldState as any).grid ?? {};
}

function getTileCoord(tile: any): AxialCoord {
  if (tile?.coord) return tile.coord;
  return { q: tile?.q ?? 0, r: tile?.r ?? 0 };
}

export function bootstrapExplorationFromWorld(
  worldState: HexWorldState,
  actorId: string = 'player'
): ExplorationState {
  const revealed = new Set<string>();
  const tiles = getTiles(worldState);

  for (const [key, tile] of Object.entries(tiles)) {
    if (tile.owner === actorId) {
      revealed.add(key);
      const coord = getTileCoord(tile);
      const neighbors = getAxialNeighbors(coord.q, coord.r);
      for (const n of neighbors) {
        revealed.add(hexKey(n.q, n.r));
      }
    }
  }

  return {
    revealedKeys: Array.from(revealed),
    claimedDiscoveries: [],
    activeExplorers: [],
    nextExplorerId: 1,
    rangeBonus: 0,
    rangeBonusTurnsRemaining: 0,
    explorationCount: 0,
  };
}

export function isHexRevealed(
  exploration: ExplorationState,
  q: number,
  r: number
): boolean {
  return exploration.revealedKeys.includes(hexKey(q, r));
}

export function getHexVisibility(
  exploration: ExplorationState,
  worldState: HexWorldState,
  q: number,
  r: number,
  actorId: string = 'player'
): HexVisibility {
  const key = hexKey(q, r);
  const tiles = getTiles(worldState);
  const tile = tiles[key];

  if (tile?.owner === actorId) {
    return 'owned';
  }

  if (!exploration.revealedKeys.includes(key)) {
    return 'unknown';
  }

  if (tile?.owner && tile.owner !== 'none' && tile.owner !== actorId) {
    return 'foreign';
  }

  return 'explored';
}

export function evaluateExploration(params: {
  exploration: ExplorationState;
  worldState: HexWorldState;
  q: number;
  r: number;
  unlockedTechs?: TechId[];
  availableGold?: number;
  availableFood?: number;
}): ExplorationEvaluation {
  const { exploration, worldState, q, r, unlockedTechs = [], availableGold, availableFood } = params;
  const targetKey = hexKey(q, r);
  const targetCoord: AxialCoord = { q, r };
  const tiles = getTiles(worldState);
  const tile = tiles[targetKey];

  // Base range is 2
  const techRangeBonus = getTechModifiers(unlockedTechs).explorationRangeBonus;
  const tempRangeBonus = exploration.rangeBonusTurnsRemaining > 0 ? exploration.rangeBonus : 0;
  const effectiveRange = 2 + techRangeBonus + tempRangeBonus;

  // Rule 5: Cannot explore already revealed or player-owned hex
  if (exploration.revealedKeys.includes(targetKey)) {
    return {
      canExplore: false,
      reason: 'Hexágono já revelado.',
      distance: 0,
      effectiveRange,
      goldCost: 0,
      foodCost: 0,
      turnsRequired: 0,
    };
  }

  if (tile?.owner === 'player') {
    return {
      canExplore: false,
      reason: 'Hexágono já pertence ao seu reino.',
      distance: 0,
      effectiveRange,
      goldCost: 0,
      foodCost: 0,
      turnsRequired: 0,
    };
  }

  // Rule 6: At most one expedition targeting the same hex
  const alreadyTargeted = exploration.activeExplorers.some(
    (e) => e.targetCoord.q === q && e.targetCoord.r === r
  );
  if (alreadyTargeted) {
    return {
      canExplore: false,
      reason: 'Expedição já em andamento para este hexágono.',
      distance: 0,
      effectiveRange,
      goldCost: 0,
      foodCost: 0,
      turnsRequired: 0,
    };
  }

  // Find minimum distance to any revealed hex
  let minDistance = Infinity;
  let hasAdjacentRevealed = false;

  for (const revealedKey of exploration.revealedKeys) {
    const revTile = tiles[revealedKey];
    if (revTile) {
      const d = axialDistance(getTileCoord(revTile), targetCoord);
      if (d < minDistance) {
        minDistance = d;
      }
      if (d === 1) {
        hasAdjacentRevealed = true;
      }
    }
  }

  if (minDistance === Infinity) {
    minDistance = 1;
    hasAdjacentRevealed = true;
  }

  // Rule 1: Must be adjacent to at least one revealed hex (distance = 1)
  if (!hasAdjacentRevealed) {
    return {
      canExplore: false,
      reason: 'O alvo deve ser adjacente a uma área já revelada.',
      distance: minDistance,
      effectiveRange,
      goldCost: 0,
      foodCost: 0,
      turnsRequired: 0,
    };
  }

  // Rule 2: Minimum distance to revealed area <= effectiveRange
  if (minDistance > effectiveRange) {
    return {
      canExplore: false,
      reason: `Alvo além do alcance de exploração (${minDistance} > ${effectiveRange}).`,
      distance: minDistance,
      effectiveRange,
      goldCost: 0,
      foodCost: 0,
      turnsRequired: 0,
    };
  }

  // Rule 3: Cost = gold (18 * ceil(distance)) + food (4 * ceil(distance))
  const distMultiplier = Math.max(1, Math.ceil(minDistance));
  const goldCost = 18 * distMultiplier;
  const foodCost = 4 * distMultiplier;

  // Rule 4: Time = 1 turn base (+1 if distance >= 3)
  const turnsRequired = minDistance >= 3 ? 2 : 1;

  if (typeof availableGold === 'number' && availableGold < goldCost) {
    return {
      canExplore: false,
      reason: `Ouro insuficiente (necessário: ${goldCost}, disponível: ${availableGold}).`,
      distance: minDistance,
      effectiveRange,
      goldCost,
      foodCost,
      turnsRequired,
    };
  }

  if (typeof availableFood === 'number' && availableFood < foodCost) {
    return {
      canExplore: false,
      reason: `Alimento insuficiente (necessário: ${foodCost}, disponível: ${availableFood}).`,
      distance: minDistance,
      effectiveRange,
      goldCost,
      foodCost,
      turnsRequired,
    };
  }

  return {
    canExplore: true,
    distance: minDistance,
    effectiveRange,
    goldCost,
    foodCost,
    turnsRequired,
  };
}

export function startExploration(params: {
  exploration: ExplorationState;
  worldState: HexWorldState;
  q: number;
  r: number;
  unlockedTechs?: TechId[];
  availableGold?: number;
  availableFood?: number;
}): {
  nextExploration: ExplorationState;
  started: boolean;
  check: ExplorationEvaluation;
  explorer: ActiveExplorer | null;
} {
  const check = evaluateExploration(params);
  if (!check.canExplore) {
    return {
      nextExploration: params.exploration,
      started: false,
      check,
      explorer: null,
    };
  }

  const { exploration, worldState, q, r } = params;
  const targetCoord: AxialCoord = { q, r };
  const tiles = getTiles(worldState);

  // Find nearest revealed origin
  let nearestOrigin: AxialCoord = { q: 0, r: 0 };
  let minD = Infinity;
  for (const revKey of exploration.revealedKeys) {
    const tile = tiles[revKey];
    if (tile) {
      const d = axialDistance(getTileCoord(tile), targetCoord);
      if (d < minD) {
        minD = d;
        nearestOrigin = getTileCoord(tile);
      }
    }
  }

  const newExplorer: ActiveExplorer = {
    id: exploration.nextExplorerId,
    targetCoord,
    originCoord: nearestOrigin,
    turnsRemaining: check.turnsRequired,
    totalTurns: check.turnsRequired,
  };

  const nextExploration: ExplorationState = {
    ...exploration,
    activeExplorers: [...exploration.activeExplorers, newExplorer],
    nextExplorerId: exploration.nextExplorerId + 1,
    explorationCount: exploration.explorationCount + 1,
  };

  return {
    nextExploration,
    started: true,
    check,
    explorer: newExplorer,
  };
}

export function advanceExplorationTurn(params: {
  exploration: ExplorationState;
  worldState: HexWorldState;
  turn: number;
  unlockedTechs?: TechId[];
}): {
  nextState: ExplorationState;
  newlyRevealed: AxialCoord[];
  discoveries: ClaimedDiscovery[];
  event: ExplorationEvent | null;
  rewardsApplied: DiscoveryReward;
} {
  const { exploration, worldState, turn } = params;
  const tiles = getTiles(worldState);

  const newlyRevealedMap = new Map<string, AxialCoord>();
  const newDiscoveries: ClaimedDiscovery[] = [];
  let triggeredEvent: ExplorationEvent | null = null;
  const aggregatedRewards: DiscoveryReward = {};

  const remainingExplorers: ActiveExplorer[] = [];

  for (const explorer of exploration.activeExplorers) {
    const nextTurns = explorer.turnsRemaining - 1;
    if (nextTurns > 0) {
      remainingExplorers.push({
        ...explorer,
        turnsRemaining: nextTurns,
      });
      continue;
    }

    // Explorer completed mission!
    const target = explorer.targetCoord;
    const targetKey = hexKey(target.q, target.r);
    newlyRevealedMap.set(targetKey, target);

    // Reveal 6 axial neighbors
    const neighbors = getAxialNeighbors(target.q, target.r);
    for (const n of neighbors) {
      const nKey = hexKey(n.q, n.r);
      newlyRevealedMap.set(nKey, n);
    }

    // Check discoveries on target hex
    const tile = tiles[targetKey];
    const claimedIds = new Set(exploration.claimedDiscoveries.map((d) => d.id));

    if (tile && isValidRareFeatureType(tile.rareFeature) && tile.rareFeature !== 'none') {
      const featureId = `rare_${tile.rareFeature}_${targetKey}`;
      if (!claimedIds.has(featureId)) {
        const rareDiscovery = mapRareFeatureToDiscovery(tile.rareFeature, target);
        newDiscoveries.push(rareDiscovery);
        claimedIds.add(featureId);
        applyReward(aggregatedRewards, rareDiscovery.reward);
      }
    } else {
      // Deterministic procedural discovery chance based on coordinates & turn
      const hash = Math.abs(target.q * 37 + target.r * 17 + turn * 13) % 100;
      if (hash < 35 && DISCOVERY_CATALOG.length > 0) {
        const catIndex = (Math.abs(target.q * 7 + target.r * 11) + exploration.explorationCount) % DISCOVERY_CATALOG.length;
        const template = DISCOVERY_CATALOG[catIndex];
        const discId = `${template.id}_${targetKey}`;
        if (!claimedIds.has(discId)) {
          const disc: ClaimedDiscovery = {
            id: discId,
            namePt: template.namePt,
            kind: template.kind,
            coord: target,
            descriptionPt: template.descriptionPt,
            reward: { ...template.reward },
          };
          newDiscoveries.push(disc);
          claimedIds.add(discId);
          applyReward(aggregatedRewards, disc.reward);
        }
      }
    }

    // Roll exploration event deterministically
    const eventRoll = Math.abs(exploration.explorationCount * 41 + target.q * 19 + target.r * 23 + turn) % 100;
    if (eventRoll < 20) {
      triggeredEvent = {
        kind: 'nothing',
        namePt: 'Jornada Tranquila',
        descriptionPt: 'Os batedores retornaram sem enfrentar percalços no caminho.',
      };
    } else if (eventRoll < 40) {
      triggeredEvent = {
        kind: 'friendly_natives',
        namePt: 'Nativos Amigáveis',
        descriptionPt: 'Comunidades locais compartilharam suprimentos e conhecimento geográfico.',
      };
      applyReward(aggregatedRewards, { food: 20, science: 15 });
    } else if (eventRoll < 60) {
      triggeredEvent = {
        kind: 'resource_cache',
        namePt: 'Depósito Esquecido',
        descriptionPt: 'Foi encontrado um caixote antigo de suprimentos nas matas.',
      };
      applyReward(aggregatedRewards, { gold: 25, wood: 20, ore: 10 });
    } else if (eventRoll < 75) {
      triggeredEvent = {
        kind: 'ancient_map',
        namePt: 'Mapa Ancestral',
        descriptionPt: 'Um pergaminho desgastado revelou novos horizontes.',
      };
      applyReward(aggregatedRewards, { science: 25 });
    } else if (eventRoll < 90) {
      triggeredEvent = {
        kind: 'lost_party',
        namePt: 'Equipamento Perdido',
        descriptionPt: 'Dificuldades no terreno causaram perda de ferramentas da expedição.',
        riskCost: { gold: 15 },
      };
    } else {
      triggeredEvent = {
        kind: 'ambush',
        namePt: 'Emboscada Selvagem',
        descriptionPt: 'Bandidos atacaram a vanguarda dos exploradores antes de recuarem.',
        riskCost: { gold: 20, population: 1 },
      };
    }
  }

  // Update revealed keys
  const updatedRevealed = new Set(exploration.revealedKeys);
  const newlyRevealedList: AxialCoord[] = [];

  for (const [key, coord] of newlyRevealedMap) {
    if (!updatedRevealed.has(key)) {
      updatedRevealed.add(key);
      newlyRevealedList.push(coord);
    }
  }

  // Update temporary range bonus turns
  let rangeBonus = exploration.rangeBonus;
  let rangeTurns = Math.max(0, exploration.rangeBonusTurnsRemaining - 1);
  if (rangeTurns === 0) {
    rangeBonus = 0;
  }

  // If ancient map was triggered, grant temporary exploration range bonus
  if (triggeredEvent?.kind === 'ancient_map') {
    rangeBonus = Math.max(rangeBonus, 1);
    rangeTurns = Math.max(rangeTurns, 3);
  }

  const nextState: ExplorationState = {
    revealedKeys: Array.from(updatedRevealed),
    claimedDiscoveries: [...exploration.claimedDiscoveries, ...newDiscoveries],
    activeExplorers: remainingExplorers,
    nextExplorerId: exploration.nextExplorerId,
    rangeBonus,
    rangeBonusTurnsRemaining: rangeTurns,
    explorationCount: exploration.explorationCount,
  };

  return {
    nextState,
    newlyRevealed: newlyRevealedList,
    discoveries: newDiscoveries,
    event: triggeredEvent,
    rewardsApplied: aggregatedRewards,
  };
}

function mapRareFeatureToDiscovery(
  feature: RareFeatureType,
  coord: AxialCoord
): ClaimedDiscovery {
  switch (feature) {
    case 'gold_vein':
      return {
        id: `rare_gold_${hexKey(coord.q, coord.r)}`,
        namePt: 'Veio de Ouro Puro',
        kind: 'rare_resource',
        coord,
        descriptionPt: 'Filão brilhante descoberto nas encostas rochosas.',
        reward: { gold: 60 },
      };
    case 'pure_iron':
      return {
        id: `rare_iron_${hexKey(coord.q, coord.r)}`,
        namePt: 'Jazida de Ferro Maciço',
        kind: 'rare_resource',
        coord,
        descriptionPt: 'Minério de alta densidade pronto para forja rápida.',
        reward: { ore: 40, wood: 20 },
      };
    case 'arcane_crystal':
      return {
        id: `rare_crystal_${hexKey(coord.q, coord.r)}`,
        namePt: 'Geodo de Cristais Arcanos',
        kind: 'rare_resource',
        coord,
        descriptionPt: 'Formações cristalinas que amplificam os estudos arcanos.',
        reward: { science: 40, gold: 30 },
      };
    case 'rich_soil':
      return {
        id: `rare_soil_${hexKey(coord.q, coord.r)}`,
        namePt: 'Planície Aluvial Fértil',
        kind: 'rare_resource',
        coord,
        descriptionPt: 'Húmus profundo perfeito para safras abundantes.',
        reward: { food: 70 },
      };
    case 'natural_harbor':
      return {
        id: `rare_harbor_${hexKey(coord.q, coord.r)}`,
        namePt: 'Enseada de Águas Calmas',
        kind: 'strategic_site',
        coord,
        descriptionPt: 'Porto natural ideal para ancoragem protegida contra marés.',
        reward: { gold: 35, wood: 35 },
      };
    default:
      return {
        id: `rare_generic_${hexKey(coord.q, coord.r)}`,
        namePt: 'Recurso Extraordinário',
        kind: 'rare_resource',
        coord,
        descriptionPt: 'Achado geológico valioso na região recém-explorada.',
        reward: { gold: 30 },
      };
  }
}

function applyReward(target: DiscoveryReward, reward?: DiscoveryReward) {
  if (!reward) return;
  if (reward.gold) target.gold = (target.gold ?? 0) + reward.gold;
  if (reward.science) target.science = (target.science ?? 0) + reward.science;
  if (reward.food) target.food = (target.food ?? 0) + reward.food;
  if (reward.wood) target.wood = (target.wood ?? 0) + reward.wood;
  if (reward.ore) target.ore = (target.ore ?? 0) + reward.ore;
}

export function serializeExplorationState(state: ExplorationState): string {
  return JSON.stringify(state);
}

export function deserializeExplorationState(
  raw: string
): ExplorationState | null {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.revealedKeys)) return null;
    return {
      revealedKeys: parsed.revealedKeys.filter((k: unknown) => typeof k === 'string'),
      claimedDiscoveries: Array.isArray(parsed.claimedDiscoveries) ? parsed.claimedDiscoveries : [],
      activeExplorers: Array.isArray(parsed.activeExplorers) ? parsed.activeExplorers : [],
      nextExplorerId: typeof parsed.nextExplorerId === 'number' ? parsed.nextExplorerId : 1,
      rangeBonus: typeof parsed.rangeBonus === 'number' ? parsed.rangeBonus : 0,
      rangeBonusTurnsRemaining:
        typeof parsed.rangeBonusTurnsRemaining === 'number' ? parsed.rangeBonusTurnsRemaining : 0,
      explorationCount: typeof parsed.explorationCount === 'number' ? parsed.explorationCount : 0,
    };
  } catch {
    return null;
  }
}
