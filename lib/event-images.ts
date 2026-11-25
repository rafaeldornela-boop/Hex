/**
 * Static thematic image catalog for kingdom events.
 * Paths under /public/event-images/ — replace SVGs with WebP/PNG later
 * without changing narrative engine code.
 */

export type EventImageCategory =
  | 'drought'
  | 'rain'
  | 'storm'
  | 'winter'
  | 'harvest'
  | 'famine'
  | 'trade'
  | 'discovery'
  | 'mining'
  | 'forest'
  | 'war'
  | 'diplomacy'
  | 'revolt'
  | 'prosperity'
  | 'technology'
  | 'exploration'
  | 'epidemic'
  | 'fire'
  | 'disaster'
  | 'political';

export interface EventImageAsset {
  id: EventImageCategory;
  /** Public URL path served from /public */
  src: string;
  labelPt: string;
  accentHex: string;
}

export const EVENT_IMAGE_LIBRARY: Record<EventImageCategory, EventImageAsset> = {
  drought: {
    id: 'drought',
    src: '/event-images/drought.svg',
    labelPt: 'Seca',
    accentHex: '#d97706',
  },
  rain: {
    id: 'rain',
    src: '/event-images/rain.svg',
    labelPt: 'Chuva',
    accentHex: '#0ea5e9',
  },
  storm: {
    id: 'storm',
    src: '/event-images/storm.svg',
    labelPt: 'Tempestade',
    accentHex: '#6366f1',
  },
  winter: {
    id: 'winter',
    src: '/event-images/winter.svg',
    labelPt: 'Inverno',
    accentHex: '#94a3b8',
  },
  harvest: {
    id: 'harvest',
    src: '/event-images/harvest.svg',
    labelPt: 'Colheita',
    accentHex: '#eab308',
  },
  famine: {
    id: 'famine',
    src: '/event-images/famine.svg',
    labelPt: 'Escassez',
    accentHex: '#b45309',
  },
  trade: {
    id: 'trade',
    src: '/event-images/trade.svg',
    labelPt: 'Comércio',
    accentHex: '#f59e0b',
  },
  discovery: {
    id: 'discovery',
    src: '/event-images/discovery.svg',
    labelPt: 'Descoberta',
    accentHex: '#a855f7',
  },
  mining: {
    id: 'mining',
    src: '/event-images/mining.svg',
    labelPt: 'Mineração',
    accentHex: '#78716c',
  },
  forest: {
    id: 'forest',
    src: '/event-images/forest.svg',
    labelPt: 'Floresta',
    accentHex: '#16a34a',
  },
  war: {
    id: 'war',
    src: '/event-images/war.svg',
    labelPt: 'Guerra',
    accentHex: '#dc2626',
  },
  diplomacy: {
    id: 'diplomacy',
    src: '/event-images/diplomacy.svg',
    labelPt: 'Diplomacia',
    accentHex: '#2563eb',
  },
  revolt: {
    id: 'revolt',
    src: '/event-images/revolt.svg',
    labelPt: 'Revolta',
    accentHex: '#ea580c',
  },
  prosperity: {
    id: 'prosperity',
    src: '/event-images/prosperity.svg',
    labelPt: 'Prosperidade',
    accentHex: '#10b981',
  },
  technology: {
    id: 'technology',
    src: '/event-images/technology.svg',
    labelPt: 'Tecnologia',
    accentHex: '#7c3aed',
  },
  exploration: {
    id: 'exploration',
    src: '/event-images/exploration.svg',
    labelPt: 'Exploração',
    accentHex: '#0d9488',
  },
  epidemic: {
    id: 'epidemic',
    src: '/event-images/epidemic.svg',
    labelPt: 'Epidemia',
    accentHex: '#6b7280',
  },
  fire: {
    id: 'fire',
    src: '/event-images/fire.svg',
    labelPt: 'Incêndio',
    accentHex: '#ef4444',
  },
  disaster: {
    id: 'disaster',
    src: '/event-images/disaster.svg',
    labelPt: 'Desastre',
    accentHex: '#7f1d1d',
  },
  political: {
    id: 'political',
    src: '/event-images/political.svg',
    labelPt: 'Política',
    accentHex: '#1e3a8a',
  },
};

export function getEventImage(
  category: EventImageCategory | string | undefined
): EventImageAsset {
  if (category && category in EVENT_IMAGE_LIBRARY) {
    return EVENT_IMAGE_LIBRARY[category as EventImageCategory];
  }
  return EVENT_IMAGE_LIBRARY.political;
}

export function listEventImageCategories(): EventImageCategory[] {
  return Object.keys(EVENT_IMAGE_LIBRARY) as EventImageCategory[];
}
