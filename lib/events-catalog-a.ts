/** Compatibility re-export — full catalog lives in events-catalog-data*.ts */
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
export const EVENT_CATALOG_A: readonly EventDefinition[] = [];
