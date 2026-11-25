import type { EventDefinition } from './events-catalog-types';
import { EVENT_CATALOG_DATA_A } from './events-catalog-data-a';
import { EVENT_CATALOG_DATA_B } from './events-catalog-data-b';

export const EVENT_CATALOG_DATA: readonly EventDefinition[] = [
  ...EVENT_CATALOG_DATA_A,
  ...EVENT_CATALOG_DATA_B,
];
