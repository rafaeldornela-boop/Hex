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

export type BiomeSeasonalSubVariant =
  | 'arid_sand'
  | 'riverbank_fertile'
  | 'alpine'
  | 'boreal_conifer'
  | 'deciduous_forest'
  | 'temperate_plains'
  | 'ocean';

export interface SeasonVisualBiomeProfile {
  subVariant: BiomeSeasonalSubVariant;
  terrainType: TerrainType;
  /** -1 = bare/winter dormant, 0 = summer base, +1 = spring vibrant, +2 = autumn gold/crimson */
  foliageShift: number;
  /** 0..1 selective snow buildup on peaks, cold northern forest/plains; 0 on warm lowlands & sand */
  snowAmount: number;
  /** 0..1 moisture sheen on fertile riverbanks/rain OR winter ice factor on cold northern water */
  wetnessOrIce: number;
  /** 1.0 for broadleaf deciduous forests that shift amber/red in autumn, 0.0 for evergreen conifers */
  isDeciduous: boolean;
  /** 0..1 density of spring blossoms on plains/fertile */
  flowerDensity: number;
  /** 0..1 ice plate intensity on cold northern shallow water */
  iceAmount: number;
  /** Per-instance subtle ground tint multiplier (kept neutral white when snow/foliage shader handles accents) */
  instanceTintHex: number;
}

/**
 * Pure visual transformation model per hex tile across the 4 seasons.
 * Strictly visual — never alters underlying gameplay terrainType, resourceType, or owner.
 */
export function computeHexSeasonalVisualProfile(params: {
  q: number;
  r: number;
  tile?: Pick<PlacedHex, 'terrainType' | 'resourceType' | 'rareFeature'> | null;
  assetName?: string;
  ownerTintHex?: number;
  season: SeasonId;
  seasonProgress: number;
  weather?: ClimateWeatherId;
  worldCols?: number;
  worldRows?: number;
  worldSeed?: number;
}): SeasonVisualBiomeProfile {
  const {
    q,
    r,
    tile,
    assetName = '',
    ownerTintHex = 0xffffff,
    season,
    seasonProgress,
    weather = 'clear',
    worldCols = WORLD_COLS,
    worldRows = WORLD_ROWS,
    worldSeed = 42026,
  } = params;

  const p = Math.max(0, Math.min(1, seasonProgress));
  const terrainType = getHexTerrainAndResource(q, r, tile).terrainType;
  const halfRows = Math.max(8, worldRows / 2);
  const northSouth = -(r + 0.5 * q);
  const northRatio = Math.max(0, Math.min(1, (-northSouth + 1) / halfRows));
  const noise = deterministicWeatherHash(q * 97 + r * 211, worldSeed + 19);

  // Arid sand variants never accumulate snow
  if (assetName.startsWith('sand')) {
    let sandTint = ownerTintHex;
    if (season === 'summer' || weather === 'drought_weather') {
      sandTint = blendHex(sandTint, 0xfff0cc, 0.16);
    } else if (season === 'winter') {
      sandTint = blendHex(sandTint, 0xe8eff5, 0.08);
    }
    return {
      subVariant: 'arid_sand',
      terrainType,
      foliageShift: season === 'summer' ? 0.15 : 0,
      snowAmount: 0,
      wetnessOrIce: 0,
      isDeciduous: false,
      flowerDensity: 0,
      iceAmount: 0,
      instanceTintHex: sandTint,
    };
  }

  // Water: subtle coastal ice sheen only on cold northern water tiles in winter
  if (terrainType === 'water') {
    let iceAmount = 0;
    if (season === 'winter' && northRatio >= 0.52) {
      const winterPeak = 0.45 + Math.sin(Math.min(1, p * 0.92 + 0.08) * Math.PI) * 0.55;
      const frostBoost = weather === 'frost' ? 0.24 : 0;
      iceAmount = Math.max(
        0,
        Math.min(1, ((northRatio - 0.52) / 0.48) * 0.72 * winterPeak + frostBoost * northRatio)
      );
    }
    let waterTint = ownerTintHex;
    if (season === 'winter') {
      waterTint = blendHex(waterTint, iceAmount > 0.25 ? 0xd9ecfa : 0xc5def5, 0.24);
    } else if (season === 'summer') {
      waterTint = blendHex(waterTint, 0xe6f8ff, 0.14);
    } else if (season === 'autumn') {
      waterTint = blendHex(waterTint, 0xcbe0eb, 0.12);
    }
    return {
      subVariant: 'ocean',
      terrainType,
      foliageShift: 0,
      snowAmount: 0,
      wetnessOrIce: iceAmount,
      isDeciduous: false,
      flowerDensity: 0,
      iceAmount,
      instanceTintHex: waterTint,
    };
  }

  const climate = computeTileClimateProfile({
    q,
    r,
    tile,
    worldCols,
    worldRows,
    worldSeed,
  });
  const snowAmount = computeTileSnowFactor({ climate, season, seasonProgress: p, weather });

  // Classify forest tiles into deciduous vs boreal conifers (north has more conifers)
  const coniferThreshold = 0.25 + northRatio * 0.52;
  const isConifer = terrainType === 'forest' && noise < coniferThreshold;
  const isDeciduous = terrainType === 'forest' && !isConifer;

  let subVariant: BiomeSeasonalSubVariant = 'temperate_plains';
  if (terrainType === 'mountain') {
    subVariant = 'alpine';
  } else if (terrainType === 'forest') {
    subVariant = isConifer ? 'boreal_conifer' : 'deciduous_forest';
  } else if (terrainType === 'fertile') {
    subVariant = 'riverbank_fertile';
  }

  // Smooth foliage shift across seasons:
  // -0.85..0: winter dormancy/bareness
  // 0..+0.95: spring fresh vibrancy (or summer lush 0..0.2)
  // +1.1..+2.0: autumn golden/amber/crimson foliage (peaks mid-to-late autumn)
  let foliageShift = 0;
  if (terrainType !== 'mountain') {
    if (season === 'spring') {
      foliageShift = 0.9 - p * 0.45; // 0.9 early spring -> 0.45 late spring
    } else if (season === 'summer') {
      foliageShift = weather === 'drought_weather' ? -0.18 : 0.15 - p * 0.1;
    } else if (season === 'autumn') {
      foliageShift = 1.15 + Math.sin(Math.min(1, p * 0.85 + 0.15) * Math.PI * 0.65) * 0.85; // 1.2 -> 2.0
    } else if (season === 'winter') {
      foliageShift = isConifer ? -0.22 : -0.75 - Math.sin(p * Math.PI) * 0.2;
    }
  }

  // Riverbank fertile moisture / drought dryness
  let wetnessOrIce = 0;
  if (terrainType === 'fertile') {
    wetnessOrIce =
      weather === 'rain' || season === 'spring'
        ? 0.72
        : weather === 'drought_weather'
          ? 0.12
          : season === 'winter'
            ? 0.38
            : 0.48;
  } else if (weather === 'rain') {
    wetnessOrIce = 0.42;
  }

  // Spring flower blossoms on grassy plains meadows (fade out in mid-summer; keep plowed dirt clean)
  let flowerDensity = 0;
  if (
    terrainType === 'plains' &&
    snowAmount < 0.12 &&
    !assetName.startsWith('sand')
  ) {
    if (season === 'spring') {
      const bloomRamp = Math.min(1, p * 1.6 + 0.25);
      flowerDensity = noise > 0.26 ? bloomRamp * 0.78 : 0;
    } else if (season === 'summer' && p < 0.35) {
      flowerDensity = noise > 0.52 ? (1 - p / 0.35) * 0.42 : 0;
    }
  }

  // Keep per-instance base tint subtle so the custom shader handles vertex-height foliage/snow accurately
  let instanceTintHex = ownerTintHex;
  if (season === 'spring') {
    instanceTintHex = blendHex(instanceTintHex, 0xf2fce8, 0.12);
  } else if (season === 'summer') {
    instanceTintHex = blendHex(
      instanceTintHex,
      weather === 'drought_weather' ? 0xf6deab : 0xfbf5dc,
      weather === 'drought_weather' ? 0.22 : 0.1
    );
  } else if (season === 'autumn') {
    const autTarget = isDeciduous ? 0xf5c88e : terrainType === 'mountain' ? 0xebdcc7 : 0xf0d7ab;
    instanceTintHex = blendHex(instanceTintHex, autTarget, isDeciduous ? 0.16 : 0.1);
  } else if (season === 'winter') {
    const winTarget = climate.zone === 'warm' ? 0xedf2ea : 0xdde9f5;
    instanceTintHex = blendHex(instanceTintHex, winTarget, climate.zone === 'warm' ? 0.08 : 0.18);
  }

  return {
    subVariant,
    terrainType,
    foliageShift,
    snowAmount,
    wetnessOrIce,
    isDeciduous,
    flowerDensity,
    iceAmount: 0,
    instanceTintHex,
  };
}

export type FarmCropStage = 'sprouts' | 'lush' | 'harvest' | 'dormant';

export interface FarmCropVisualState {
  stage: FarmCropStage;
  labelPt: string;
  stalkHeightScale: number;
  headScale: number;
  stalkColorHex: number;
  headColorHex: number;
  furrowColorHex: number;
}

/**
 * 4-season visual crop cycle for farms (`building-farm` & fertile fields):
 * - Spring: fresh plowed furrows + bright green sprouts
 * - Summer: tall dense emerald foliage
 * - Autumn: golden mature wheat/grain ready for harvest
 * - Winter: frost-dusted dormant stubble
 */
export function computeFarmCropVisualState(params: {
  season: SeasonId;
  seasonProgress: number;
  farmLevel?: number;
  weather?: ClimateWeatherId;
}): FarmCropVisualState {
  const { season, seasonProgress, farmLevel = 1, weather = 'clear' } = params;
  const p = Math.max(0, Math.min(1, seasonProgress));
  const lvlBoost = 1 + Math.max(0, Math.min(2, farmLevel - 1)) * 0.14;

  if (season === 'spring') {
    return {
      stage: 'sprouts',
      labelPt: 'Brotos de Primavera',
      stalkHeightScale: (0.36 + p * 0.34) * lvlBoost,
      headScale: 0.25 + p * 0.2,
      stalkColorHex: 0x73c94a,
      headColorHex: 0xa5e66a,
      furrowColorHex: weather === 'rain' ? 0x4b3827 : 0x624932,
    };
  }

  if (season === 'summer') {
    const dryShift = weather === 'drought_weather';
    return {
      stage: 'lush',
      labelPt: 'Lavoura Viçosa',
      stalkHeightScale: (0.85 + Math.sin(p * Math.PI * 0.5) * 0.2) * lvlBoost,
      headScale: 0.72 + p * 0.2,
      stalkColorHex: dryShift ? 0x7ea341 : 0x4aa83b,
      headColorHex: dryShift ? 0xb5bd57 : 0x74c953,
      furrowColorHex: dryShift ? 0x786043 : 0x5c4630,
    };
  }

  if (season === 'autumn') {
    return {
      stage: 'harvest',
      labelPt: 'Colheita Dourada',
      stalkHeightScale: (1.02 - p * 0.12) * lvlBoost,
      headScale: 1.08 * lvlBoost,
      stalkColorHex: 0xc99c38,
      headColorHex: 0xf0be43,
      furrowColorHex: 0x6b5237,
    };
  }

  return {
    stage: 'dormant',
    labelPt: 'Solo em Repouso',
    stalkHeightScale: 0.24 * lvlBoost,
    headScale: 0.18,
    stalkColorHex: 0x8f8874,
    headColorHex: weather === 'frost' ? 0xd9e8f5 : 0xb5b3a6,
    furrowColorHex: weather === 'frost' ? 0x7d8a96 : 0x695d52,
  };
}

