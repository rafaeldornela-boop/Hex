import type { EventDefinition } from './events-catalog-a0';
export type {
  KingdomEventKind,
  EventCategory,
  EventRarity,
  DecisionStyle,
  ActiveWorldEffect,
  EventChoiceOption,
  ActiveKingdomEvent,
  EventHistoryEntry,
  EventCondition,
  EventConsequence,
  EventChoiceDefinition,
  EventDefinition,
} from './events-catalog-a0';
import { EVENT_CATALOG_A0 } from './events-catalog-a0';
import { EVENT_CATALOG_A1 } from './events-catalog-a1';

export const EVENT_CATALOG_A: readonly EventDefinition[] = [
  ...EVENT_CATALOG_A0,
  ...EVENT_CATALOG_A1,
];
