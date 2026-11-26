/** Shared types for Events Narrative 2.0 */

export type KingdomEventKind =
  | 'drought'
  | 'harvest'
  | 'discovery'
  | 'trade'
  | 'epidemic'
  | 'economic'
  | 'revolt'
  | 'tech'
  | 'invasion'
  | 'diplomatic'
  | 'seasonal'
  | 'exploration'
  | 'political'
  | 'rare'
  | 'crisis'
  | 'positive';

export type EventCategory =
  | 'common'
  | 'seasonal'
  | 'economic'
  | 'political'
  | 'diplomatic'
  | 'military'
  | 'exploration'
  | 'technological'
  | 'positive'
  | 'rare'
  | 'crisis';

export type EventRarity = 'common' | 'uncommon' | 'rare' | 'legendary';

export type DecisionStyle = 'balanced' | 'aggressive' | 'cautious' | 'opportunistic' | 'humanitarian';

export interface ActiveWorldEffect {
  id: string;
  titlePt: string;
  descriptionPt: string;
  turnsRemaining: number;
  goldMultiplierMod?: number;
  foodMultiplierMod?: number;
  scienceBonusPerTurn?: number;
  populationDeltaPerTurn?: number;
  efficiencyPenalty?: number;
}

export interface EventChoiceOption {
  id: string;
  labelPt: string;
  descriptionPt: string;
  style?: DecisionStyle;
  costGoldHint?: number;
}

export interface ActiveKingdomEvent {
  id: string;
  turn: number;
  kind: KingdomEventKind;
  titlePt: string;
  descriptionPt: string;
  targetCoord?: { q: number; r: number };
  resolved: boolean;
  choices: EventChoiceOption[];
  category?: EventCategory;
  rarity?: EventRarity;
  priority?: number;
  imageCategory?: string;
  imageSrc?: string;
  goldMultiplierMod?: number;
  foodMultiplierMod?: number;
  durationTurns?: number;
  chainId?: string;
  chainStep?: number;
  definitionId?: string;
}

export interface EventHistoryEntry {
  turn: number;
  titlePt: string;
  outcomePt: string;
  kind: KingdomEventKind;
  choiceId?: string;
  definitionId?: string;
  chainId?: string;
}

export interface EventCondition {
  minTurn?: number;
  seasons?: string[];
  weatherIds?: string[];
  minFarms?: number;
  minMines?: number;
  requiresTrade?: boolean;
  requiresMilitary?: boolean;
  foodDeficit?: boolean;
  conflict?: boolean;
  afterDefinitionId?: string;
  afterChoiceId?: string;
  cooldownKey?: string;
  cooldownTurns?: number;
}

export interface EventConsequence {
  goldDelta?: number;
  foodDelta?: number;
  woodDelta?: number;
  oreDelta?: number;
  stoneDelta?: number;
  scienceDelta?: number;
  populationDelta?: number;
  effect?: {
    id?: string;
    titlePt: string;
    descriptionPt: string;
    turnsRemaining: number;
    goldMultiplierMod?: number;
    foodMultiplierMod?: number;
    scienceBonusPerTurn?: number;
    populationDeltaPerTurn?: number;
    efficiencyPenalty?: number;
  };
  setFlag?: string;
  clearFlags?: string[];
  scheduleDefinitionId?: string;
  scheduleInTurns?: number;
}

export interface EventChoiceDefinition {
  id: string;
  labelPt: string;
  descriptionPt: string;
  style?: DecisionStyle;
  requiresGold?: number;
  requiresDefense?: number;
  outcomePt: string;
  fallbackOutcomePt?: string;
  immediate: EventConsequence;
  fallback?: EventConsequence;
  hiddenSchedule?: { definitionId: string; inTurns: number };
}

export interface EventDefinition {
  id: string;
  kind: KingdomEventKind;
  category: EventCategory;
  rarity: EventRarity;
  priority: number;
  weight: number;
  titlePt: string;
  descriptionPt: string;
  imageCategory: string;
  durationTurns?: number;
  chainId?: string;
  chainStep?: number;
  conditions: EventCondition;
  choices: EventChoiceDefinition[];
}
