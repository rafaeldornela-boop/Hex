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
} from './events-catalog-types';

import type { EventDefinition } from './events-catalog-types';
import { EVENT_CATALOG_DATA } from './events-catalog-data';

export const EVENT_CATALOG: readonly EventDefinition[] = EVENT_CATALOG_DATA;
