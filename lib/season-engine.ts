import type { SeasonId } from './calendar-engine';
import type { PlacedHex } from './hex-engine';
import { getHexTerrainAndResource, type TerrainType } from './terrain-engine';
import { WORLD_COLS, WORLD_ROWS } from './world-generator';

export type ClimateWeatherId =
  | 'clear'
  | 'rain'
  | 'drought_weather'
  | 'frost'
  | 'storm';

export interface ActiveClimateWeather {
  id: ClimateWeatherId;
  labelPt: string;
  descriptionPt: string;
  turnsRemaining: number;
  foodProductionMult: number;
  woodProductionMult: number;
  goldProductionMult: number;
}

export interface SeasonEconomicProfile {
  season: SeasonId;
  labelPt: string;
  descriptionPt: string;
  foodProductionMult: number;
  woodProductionMult: number;
  foodDemandMult: number;
  popGrowthBonusMod: number;
  upkeepMult: number;
  tradeBonusMod: number;
}

export const SEASON_PROFILES: Record<SeasonId, SeasonEconomicProfile> = {
  spring: {
    season: 'spring',
    labelPt: 'Primavera',
    descriptionPt:
      'Solo fértil e rebrotamento aceleram lavouras (+5% Alim.) e madeira (+8% Mad.).',
    foodProductionMult: 1.05,
    woodProductionMult: 1.08,
    foodDemandMult: 1.0,
    popGrowthBonusMod: 1,
    upkeepMult: 1.0,
    tradeBonusMod: 1.0,
  },
  summer: {
    season: 'summer',
    labelPt: 'Verão',
    descriptionPt:
      'Sol forte impulsiona colheitas (+15% Alim.) e comércio (+8%), mas eleva risco de seca.',
    foodProductionMult: 1.15,
    woodProductionMult: 1.0,
    foodDemandMult: 1.0,
    popGrowthBonusMod: 0,
    upkeepMult: 1.0,
    tradeBonusMod: 1.08,
  },
  autumn: {
    season: 'autumn',
    labelPt: 'Outono',
    descriptionPt:
      'Colheita farta (+22% Alim., +10% Comércio). Estoque reservas antes do inverno.',
    foodProductionMult: 1.22,
    woodProductionMult: 1.05,
    foodDemandMult: 1.0,
    popGrowthBonusMod: 0,
    upkeepMult: 1.0,
    tradeBonusMod: 1.1,
  },
  winter: {
    season: 'winter',
    labelPt: 'Inverno',
    descriptionPt:
      'Frio reduz safras (-35% Alim.) e eleva consumo (+25% demanda) e manutenção (+12%).',
    foodProductionMult: 0.65,
    woodProductionMult: 0.85,
    foodDemandMult: 1.25,
    popGrowthBonusMod: -1,
    upkeepMult: 1.12,
    tradeBonusMod: 0.9,
  },
};

export const CLEAR_CLIMATE_WEATHER: ActiveClimateWeather = {
  id: 'clear',
  labelPt: 'Tempo Estável',
  descriptionPt: 'Céu limpo sem perturbações climáticas.',
  turnsRemaining: 0,
  foodProductionMult: 1.0,
  woodProductionMult: 1.0,
  goldProductionMult: 1.0,
};

const WEATHER_TEMPLATES: Record<
  Exclude<ClimateWeatherId, 'clear'>,
  Omit<ActiveClimateWeather, 'turnsRemaining'>
> = {
  rain: {
    id: 'rain',
    labelPt: 'Chuvas Benéficas',
    descriptionPt: 'Chuvas irrigam lavouras (+12% Alimento, +6% Madeira).',
    foodProductionMult: 1.12,
    woodProductionMult: 1.06,
    goldProductionMult: 1.0,
  },
  drought_weather: {
    id: 'drought_weather',
    labelPt: 'Estiagem Sazonal',
    descriptionPt: 'Calor seco reduz lavouras em terras secas (-18% Alimento). Água próxima mitiga.',
    foodProductionMult: 0.82,
    woodProductionMult: 0.95,
    goldProductionMult: 1.0,
  },
  frost: {
    id: 'frost',
    labelPt: 'Geada Rigorosa',
    descriptionPt: 'Geada reduz safras abertas (-20% Alimento). Fazendas evoluídas resistem melhor.',
    foodProductionMult: 0.8,
    woodProductionMult: 0.92,
    goldProductionMult: 0.96,
  },
  storm: {
    id: 'storm',
    labelPt: 'Tempestade Regional',
    descriptionPt: 'Ventos fortes reduzem madeira (-12%) e comércio (-8%).',
    foodProductionMult: 0.94,
    woodProductionMult: 0.88,
    goldProductionMult: 0.92,
  },
};

function deterministicWeatherHash(turn: number, seed: number): number {
  let h = (turn * 374761393 + seed * 668265263) >>> 0;
  h = ((h ^ (h >>> 13)) * 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function getSeasonEconomicProfile(season: SeasonId): SeasonEconomicProfile {
  return SEASON_PROFILES[season] ?? SEASON_PROFILES.spring;
}

export function createInitialClimateWeather(): ActiveClimateWeather {
  return { ...CLEAR_CLIMATE_WEATHER };
}

export function normalizeClimateWeather(raw: unknown): ActiveClimateWeather {
  if (!raw || typeof raw !== 'object') return createInitialClimateWeather();
  const obj = raw as Partial<ActiveClimateWeather>;
  const id = obj.id;
  if (id === 'clear' || !id) return createInitialClimateWeather();
  if (
    id === 'rain' ||
    id === 'drought_weather' ||
    id === 'frost' ||
    id === 'storm'
  ) {
    const tpl = WEATHER_TEMPLATES[id];
    return {
      ...tpl,
      turnsRemaining:
        typeof obj.turnsRemaining === 'number' && obj.turnsRemaining >= 1
          ? Math.min(4, Math.round(obj.turnsRemaining))
          : 2,
    };
  }
  return createInitialClimateWeather();
}

/**
 * Advances active climate weather each turn and generates bounded, season-appropriate weather
 * with a cooldown so weather never stacks uncontrollably.
 */
export function advanceClimateWeather(params: {
  nextTurn: number;
  season: SeasonId;
  prevWeather: ActiveClimateWeather;
  worldSeed?: number;
}): { weather: ActiveClimateWeather; changed: boolean } {
  const { nextTurn, season, prevWeather, worldSeed = 42026 } = params;

  if (prevWeather.id !== 'clear' && prevWeather.turnsRemaining > 1) {
    return {
      weather: {
        ...prevWeather,
        turnsRemaining: prevWeather.turnsRemaining - 1,
      },
      changed: false,
    };
  }

  // Cooldown when an active weather just ended
  if (prevWeather.id !== 'clear' && prevWeather.turnsRemaining <= 1) {
    return { weather: createInitialClimateWeather(), changed: true };
  }

  // Keep Turn 1-4 calm, then evaluate periodic weather roll every ~4 turns
  if (nextTurn < 5 || nextTurn % 4 !== 0) {
    return { weather: createInitialClimateWeather(), changed: false };
  }

  const roll = deterministicWeatherHash(nextTurn, worldSeed);
  let nextId: ClimateWeatherId = 'clear';
  if (season === 'spring') {
    if (roll < 0.48) nextId = 'rain';
    else if (roll > 0.86) nextId = 'storm';
  } else if (season === 'summer') {
    if (roll < 0.42) nextId = 'drought_weather';
    else if (roll > 0.78) nextId = 'rain';
  } else if (season === 'autumn') {
    if (roll < 0.32) nextId = 'rain';
    else if (roll > 0.72) nextId = 'storm';
  } else if (season === 'winter') {
    if (roll < 0.48) nextId = 'frost';
    else if (roll > 0.8) nextId = 'storm';
  }

  if (nextId === 'clear') {
    return { weather: createInitialClimateWeather(), changed: false };
  }

  const tpl = WEATHER_TEMPLATES[nextId];
  const duration = nextId === 'storm' ? 2 : 3;
  return {
    weather: {
      ...tpl,
      turnsRemaining: duration,
    },
    changed: true,
  };
}

export type TileClimateZone = 'warm' | 'temperate' | 'cold' | 'alpine';

export interface TileClimateProfile {
  zone: TileClimateZone;
  supportsSnow: boolean;
  /** 0..1 snow susceptibility when winter hits */
  frostExposure: number;
}

/**
 * Classifies each hex's climate zone by terrain, latitude band (north/south highlands vs warm center/coasts),
 * and deterministic variation so winter snow ONLY settles on cold/alpine/mountain/frost-prone regions
 * and never blankets warm lowlands, sand beaches, or coastal plains indiscriminately.
 */
export function computeTileClimateProfile(params: {
  q: number;
  r: number;
  tile?: Pick<PlacedHex, 'terrainType' | 'resourceType' | 'rareFeature'> | null;
  worldCols?: number;
  worldRows?: number;
  worldSeed?: number;
}): TileClimateProfile {
  const {
    q,
    r,
    tile,
    worldCols = WORLD_COLS,
    worldRows = WORLD_ROWS,
    worldSeed = 42026,
  } = params;

  const terrain = getHexTerrainAndResource(q, r, tile).terrainType;
  if (terrain === 'water') {
    return { zone: 'temperate', supportsSnow: false, frostExposure: 0 };
  }

  // World north-south axis from axial (q, r): z ~ -(r + 0.5*q)
  const halfRows = Math.max(8, worldRows / 2);
  const northSouth = -(r + 0.5 * q); // negative = north, positive = south
  const northRatio = Math.max(0, Math.min(1, (-northSouth + 1) / halfRows));
  const radial = Math.min(1, Math.hypot(q, r + 0.5 * q) / Math.max(10, worldCols * 0.52));

  const noise = deterministicWeatherHash(q * 73 + r * 179, worldSeed);

  if (terrain === 'mountain') {
    // High alpine peaks & northern ridges always receive winter snow
    const exposure = Math.min(1, 0.72 + northRatio * 0.22 + noise * 0.12);
    return { zone: 'alpine', supportsSnow: true, frostExposure: exposure };
  }

  // Southern warm lowlands & coastal fertile/plains belts stay warm and green
  if (northSouth > halfRows * 0.18 && terrain !== 'forest') {
    return { zone: 'warm', supportsSnow: false, frostExposure: 0 };
  }

  // Northern boreal highland belt or outer high forest/plains ridges
  if (northRatio >= 0.42 || (terrain === 'forest' && radial >= 0.55 && northRatio >= 0.2)) {
    const exposure = Math.min(
      0.88,
      0.38 + northRatio * 0.38 + (terrain === 'forest' ? 0.12 : 0) + noise * 0.1
    );
    return { zone: 'cold', supportsSnow: true, frostExposure: exposure };
  }

  // Temperate center: crisp winter cool-down without heavy blanket snow
  return { zone: 'temperate', supportsSnow: false, frostExposure: 0.12 };
}

/**
 * Computes 0..1 snow accumulation on a specific tile given season & progress.
 * Builds up smoothly in late Autumn -> peaks in mid/late Winter -> melts cleanly in early Spring.
 */
export function computeTileSnowFactor(params: {
  climate: TileClimateProfile;
  season: SeasonId;
  seasonProgress: number;
  weather?: ClimateWeatherId;
}): number {
  const { climate, season, seasonProgress, weather = 'clear' } = params;
  if (!climate.supportsSnow) return 0;

  let seasonalCover = 0;
  if (season === 'winter') {
    // Smooth curve: 0.45 at start of winter -> 1.0 mid-winter -> 0.85 late winter
    seasonalCover = 0.48 + Math.sin(Math.min(1, seasonProgress * 0.92 + 0.08) * Math.PI) * 0.52;
  } else if (season === 'autumn' && seasonProgress >= 0.68) {
    seasonalCover = ((seasonProgress - 0.68) / 0.32) * 0.35;
  } else if (season === 'spring' && seasonProgress <= 0.32) {
    seasonalCover = (1 - seasonProgress / 0.32) * 0.4;
  }

  if (weather === 'frost') {
    seasonalCover = Math.min(1, seasonalCover + 0.25);
  }

  return Math.max(0, Math.min(1, seasonalCover * climate.frostExposure));
}

function lerpChannel(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

function blendHex(baseHex: number, targetHex: number, t: number): number {
  const k = Math.max(0, Math.min(1, t));
  const r = lerpChannel((baseHex >> 16) & 0xff, (targetHex >> 16) & 0xff, k);
  const g = lerpChannel((baseHex >> 8) & 0xff, (targetHex >> 8) & 0xff, k);
  const b = lerpChannel(baseHex & 0xff, targetHex & 0xff, k);
  return (r << 16) | (g << 8) | b;
}

/**
 * Returns a subtle per-tile tint multiplier combining owner color tint,
 * seasonal foliage/ground palette shift, and selective winter snow caps.
 */
export function computeTileSeasonalTintHex(params: {
  ownerTintHex: number;
  terrainType: TerrainType;
  season: SeasonId;
  seasonProgress: number;
  climate: TileClimateProfile;
  weather?: ClimateWeatherId;
}): number {
  const {
    ownerTintHex,
    terrainType,
    season,
    seasonProgress,
    climate,
    weather = 'clear',
  } = params;

  let tint = ownerTintHex;

  if (terrainType === 'water') {
    if (season === 'winter') {
      tint = blendHex(tint, 0xc7e0f5, 0.22);
    } else if (season === 'summer') {
      tint = blendHex(tint, 0xe8f9ff, 0.14);
    }
    return tint;
  }

  // Seasonal botanical / ground warmth shift
  if (season === 'spring') {
    const springTarget = terrainType === 'forest' ? 0xd9f9d6 : 0xeffbe8;
    tint = blendHex(tint, springTarget, 0.16);
  } else if (season === 'summer') {
    const summerTarget = weather === 'drought_weather' ? 0xf7dfab : 0xfbf4d8;
    tint = blendHex(tint, summerTarget, weather === 'drought_weather' ? 0.28 : 0.14);
  } else if (season === 'autumn') {
    const autumnTarget =
      terrainType === 'forest'
        ? 0xf3ba7a
        : terrainType === 'fertile'
          ? 0xf5cf87
          : 0xebd0a2;
    tint = blendHex(tint, autumnTarget, terrainType === 'forest' ? 0.34 : 0.2);
  } else if (season === 'winter') {
    const coolTarget = climate.zone === 'warm' ? 0xeaf0e6 : 0xd0dfed;
    tint = blendHex(tint, coolTarget, climate.zone === 'warm' ? 0.1 : 0.24);
  }

  // Selective snow cap ONLY on cold/alpine tiles
  const snow = computeTileSnowFactor({ climate, season, seasonProgress, weather });
  if (snow > 0.02) {
    tint = blendHex(tint, 0xf2f7fc, Math.min(0.86, snow * 0.9));
  }

  return tint;
}
