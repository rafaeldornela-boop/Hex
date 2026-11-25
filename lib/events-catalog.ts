/**
 * Event definition catalog for Events Narrative 2.0.
 */
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
} from './events-catalog-a';

import { EVENT_CATALOG_A } from './events-catalog-a';
import { EVENT_CATALOG_B } from './events-catalog-b';
import type { EventDefinition } from './events-catalog-a';

export const EVENT_CATALOG: readonly EventDefinition[] = [
  ...EVENT_CATALOG_A,
  ...EVENT_CATALOG_B,
];
