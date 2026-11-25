import type { SeasonId } from './calendar-engine';
import type { ClimateWeatherId } from './season-engine';

export type DayPhaseId =
  | 'dawn'
  | 'morning'
  | 'day'
  | 'afternoon'
  | 'dusk'
  | 'night';

export const DAY_PHASE_ORDER: readonly DayPhaseId[] = [
  'dawn',
  'morning',
  'day',
  'afternoon',
  'dusk',
  'night',
] as const;

export interface DayPhaseMeta {
  id: DayPhaseId;
  labelPt: string;
  isNight: boolean;
  isTwilight: boolean;
}

export const DAY_PHASE_META: Record<DayPhaseId, DayPhaseMeta> = {
  dawn: { id: 'dawn', labelPt: 'Amanhecer', isNight: false, isTwilight: true },
  morning: { id: 'morning', labelPt: 'Manhã', isNight: false, isTwilight: false },
  day: { id: 'day', labelPt: 'Dia', isNight: false, isTwilight: false },
  afternoon: { id: 'afternoon', labelPt: 'Tarde', isNight: false, isTwilight: false },
  dusk: { id: 'dusk', labelPt: 'Entardecer', isNight: false, isTwilight: true },
  night: { id: 'night', labelPt: 'Noite', isNight: true, isTwilight: false },
};

export interface AtmosphereTarget {
  phase: DayPhaseId;
  phaseLabelPt: string;
  isNight: boolean;
  isTwilight: boolean;
  sunAzimuthRad: number;
  sunElevationRad: number;
  sunColorHex: number;
  sunIntensity: number;
  hemiSkyHex: number;
  hemiGroundHex: number;
  hemiIntensity: number;
  rimColorHex: number;
  rimIntensity: number;
  skyHex: number;
  fogHex: number;
  fogNear: number;
  fogFar: number;
  waterTintHex: number;
  exposure: number;
  environmentIntensity: number;
  cityNightGlow: number; // 0..1
  roadLampGlow: number; // 0..1
  starVisibility: number; // 0..1
}

interface PhaseVisualPreset {
  sunAzimuthRad: number;
  sunElevationRad: number;
  sunColorHex: number;
  sunIntensity: number;
  hemiSkyHex: number;
  hemiGroundHex: number;
  hemiIntensity: number;
  rimColorHex: number;
  rimIntensity: number;
  skyHex: number;
  fogHex: number;
  fogNear: number;
  fogFar: number;
  waterTintHex: number;
  exposure: number;
  environmentIntensity: number;
  cityNightGlow: number;
  roadLampGlow: number;
  starVisibility: number;
}

const PHASE_PRESETS: Record<DayPhaseId, PhaseVisualPreset> = {
  dawn: {
    sunAzimuthRad: 0.42,
    sunElevationRad: 0.34,
    sunColorHex: 0xffb178,
    sunIntensity: 1.18,
    hemiSkyHex: 0x90b2de,
    hemiGroundHex: 0x544840,
    hemiIntensity: 0.56,
    rimColorHex: 0xf4b6c2,
    rimIntensity: 0.34,
    skyHex: 0xd99b8c,
    fogHex: 0xd6a49a,
    fogNear: 32,
    fogFar: 124,
    waterTintHex: 0xd1bccc,
    exposure: 0.86,
    environmentIntensity: 0.2,
    cityNightGlow: 0.48,
    roadLampGlow: 0.42,
    starVisibility: 0.22,
  },
  morning: {
    sunAzimuthRad: 0.72,
    sunElevationRad: 0.78,
    sunColorHex: 0xfff3d8,
    sunIntensity: 1.56,
    hemiSkyHex: 0x98d2f7,
    hemiGroundHex: 0x5a6e47,
    hemiIntensity: 0.6,
    rimColorHex: 0xc2e4ff,
    rimIntensity: 0.28,
    skyHex: 0xa6d8f2,
    fogHex: 0xaad9f0,
    fogNear: 46,
    fogFar: 162,
    waterTintHex: 0xffffff,
    exposure: 0.93,
    environmentIntensity: 0.32,
    cityNightGlow: 0.05,
    roadLampGlow: 0,
    starVisibility: 0,
  },
  day: {
    sunAzimuthRad: 0.96,
    sunElevationRad: 1.04,
    sunColorHex: 0xfff5e0,
    sunIntensity: 1.68,
    hemiSkyHex: 0x8ecbf5,
    hemiGroundHex: 0x566842,
    hemiIntensity: 0.58,
    rimColorHex: 0xbbe0ff,
    rimIntensity: 0.28,
    skyHex: 0x9bd2ee,
    fogHex: 0x9bd2ee,
    fogNear: 48,
    fogFar: 170,
    waterTintHex: 0xffffff,
    exposure: 0.93,
    environmentIntensity: 0.34,
    cityNightGlow: 0,
    roadLampGlow: 0,
    starVisibility: 0,
  },
  afternoon: {
    sunAzimuthRad: 1.48,
    sunElevationRad: 0.7,
    sunColorHex: 0xffdfa8,
    sunIntensity: 1.54,
    hemiSkyHex: 0x9ac6eb,
    hemiGroundHex: 0x626142,
    hemiIntensity: 0.58,
    rimColorHex: 0xadd4f8,
    rimIntensity: 0.3,
    skyHex: 0xaacae4,
    fogHex: 0xb5cde0,
    fogNear: 44,
    fogFar: 158,
    waterTintHex: 0xf7ebd9,
    exposure: 0.92,
    environmentIntensity: 0.3,
    cityNightGlow: 0.08,
    roadLampGlow: 0.05,
    starVisibility: 0,
  },
  dusk: {
    sunAzimuthRad: 1.98,
    sunElevationRad: 0.26,
    sunColorHex: 0xff854d,
    sunIntensity: 0.96,
    hemiSkyHex: 0x564e82,
    hemiGroundHex: 0x382834,
    hemiIntensity: 0.5,
    rimColorHex: 0x9c8de0,
    rimIntensity: 0.34,
    skyHex: 0x4b3b69,
    fogHex: 0x5c476e,
    fogNear: 28,
    fogFar: 112,
    waterTintHex: 0x82658a,
    exposure: 0.8,
    environmentIntensity: 0.14,
    cityNightGlow: 0.82,
    roadLampGlow: 0.78,
    starVisibility: 0.6,
  },
  night: {
    // Readable moonlight lighting: deep indigo sky & ocean + crisp cool moonlight + warm glowing settlements
    sunAzimuthRad: 2.35,
    sunElevationRad: 0.62,
    sunColorHex: 0x5c8de8,
    sunIntensity: 0.72,
    hemiSkyHex: 0x1d345e,
    hemiGroundHex: 0x10192b,
    hemiIntensity: 0.5,
    rimColorHex: 0x3b6cb8,
    rimIntensity: 0.22,
    skyHex: 0x0b162b,
    fogHex: 0x10203d,
    fogNear: 24,
    fogFar: 98,
    waterTintHex: 0x26416b,
    exposure: 0.68,
    environmentIntensity: 0.04,
    cityNightGlow: 1.0,
    roadLampGlow: 1.0,
    starVisibility: 0.98,
  },
};

export function lerpHexColor(hexA: number, hexB: number, t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  const ar = (hexA >> 16) & 0xff;
  const ag = (hexA >> 8) & 0xff;
  const ab = hexA & 0xff;
  const br = (hexB >> 16) & 0xff;
  const bg = (hexB >> 8) & 0xff;
  const bb = hexB & 0xff;
  const r = Math.round(ar + (br - ar) * clamped);
  const g = Math.round(ag + (bg - ag) * clamped);
  const b = Math.round(ab + (bb - ab) * clamped);
  return (r << 16) | (g << 8) | b;
}

/**
 * Turn-driven visual day/night cycle:
 * Cycles smoothly across 6 phases every 6 turns (Amanhecer -> Manhã -> Dia -> Tarde -> Entardecer -> Noite).
 * Turn 1 starts in bright readable 'day' or 'morning'? Prompt:
 * Turn 1 starts in 'morning' (bright & welcoming) -> Turn 2 'day' -> Turn 3 'afternoon' -> Turn 4 'dusk' -> Turn 5 'night' -> Turn 6 'dawn' -> repeats!
 * Starting on 'morning' guarantees crisp daytime readability at Turn 1 and lets players see dusk & night within 3-4 turns.
 */
const TURN_CYCLE_START_OFFSET = 1; // index 1 => 'morning' on Turn 1

export function getDayPhaseForTurn(turn: number): DayPhaseId {
  const safeTurn = Math.max(1, Math.round(Number.isFinite(turn) ? turn : 1));
  const idx = (safeTurn - 1 + TURN_CYCLE_START_OFFSET) % DAY_PHASE_ORDER.length;
  return DAY_PHASE_ORDER[idx] ?? 'morning';
}

export function isValidDayPhase(raw: unknown): raw is DayPhaseId {
  return (
    typeof raw === 'string' &&
    (DAY_PHASE_ORDER as readonly string[]).includes(raw)
  );
}

export function computeAtmosphereTarget(params: {
  phase: DayPhaseId;
  season: SeasonId;
  weather?: ClimateWeatherId;
}): AtmosphereTarget {
  const { phase, season, weather = 'clear' } = params;
  const base = PHASE_PRESETS[phase] ?? PHASE_PRESETS.day;
  const meta = DAY_PHASE_META[phase] ?? DAY_PHASE_META.day;

  let sunElevationRad = base.sunElevationRad;
  let sunColorHex = base.sunColorHex;
  let sunIntensity = base.sunIntensity;
  let hemiSkyHex = base.hemiSkyHex;
  let hemiGroundHex = base.hemiGroundHex;
  let hemiIntensity = base.hemiIntensity;
  let skyHex = base.skyHex;
  let fogHex = base.fogHex;
  let fogNear = base.fogNear;
  let fogFar = base.fogFar;
  let waterTintHex = base.waterTintHex;
  let exposure = base.exposure;
  let environmentIntensity = base.environmentIntensity;

  // Seasonal light tone & elevation adjustments
  if (season === 'summer') {
    sunElevationRad += 0.08;
    if (!meta.isNight) {
      sunColorHex = lerpHexColor(sunColorHex, 0xffe4a8, 0.25);
      sunIntensity *= 1.06;
      skyHex = lerpHexColor(skyHex, 0x8bcaf2, 0.2);
    }
  } else if (season === 'autumn') {
    sunElevationRad = Math.max(0.2, sunElevationRad - 0.08);
    if (!meta.isNight) {
      sunColorHex = lerpHexColor(sunColorHex, 0xffc680, 0.28);
      hemiGroundHex = lerpHexColor(hemiGroundHex, 0x70583b, 0.35);
      skyHex = lerpHexColor(skyHex, 0xd8c3a5, 0.2);
      fogHex = lerpHexColor(fogHex, 0xd8c3a5, 0.2);
    }
  } else if (season === 'winter') {
    sunElevationRad = Math.max(0.18, sunElevationRad - 0.14);
    sunColorHex = lerpHexColor(sunColorHex, 0xdceeff, meta.isNight ? 0.2 : 0.35);
    sunIntensity *= meta.isNight ? 1.04 : 0.92;
    hemiSkyHex = lerpHexColor(hemiSkyHex, 0xb8d7f0, 0.35);
    hemiGroundHex = lerpHexColor(hemiGroundHex, 0x627385, 0.35);
    skyHex = lerpHexColor(skyHex, meta.isNight ? 0x162540 : 0xbdd7eb, 0.32);
    fogHex = lerpHexColor(fogHex, meta.isNight ? 0x1b2d4d : 0xc6ddf0, 0.35);
    waterTintHex = lerpHexColor(waterTintHex, meta.isNight ? 0x3b5882 : 0xadc8e6, 0.35);
    fogNear = Math.max(18, fogNear - 4);
    if (meta.isNight) environmentIntensity = Math.min(environmentIntensity, 0.06);
  } else {
    // Spring: fresh crisp hue
    if (!meta.isNight) {
      hemiGroundHex = lerpHexColor(hemiGroundHex, 0x5c7a49, 0.25);
    }
  }

  // Climate weather adjustments
  if (weather === 'rain' || weather === 'storm') {
    const isStorm = weather === 'storm';
    sunIntensity *= isStorm ? 0.72 : 0.84;
    hemiIntensity *= 1.04;
    environmentIntensity *= isStorm ? 0.75 : 0.88;
    skyHex = lerpHexColor(skyHex, meta.isNight ? 0x0a1322 : 0x72889e, isStorm ? 0.55 : 0.38);
    fogHex = lerpHexColor(fogHex, meta.isNight ? 0x0f1b30 : 0x8096ab, isStorm ? 0.55 : 0.38);
    fogNear = Math.max(18, fogNear - (isStorm ? 10 : 6));
    fogFar = Math.max(76, fogFar - (isStorm ? 32 : 20));
    waterTintHex = lerpHexColor(waterTintHex, 0x455d78, 0.45);
  } else if (weather === 'frost') {
    skyHex = lerpHexColor(skyHex, meta.isNight ? 0x132440 : 0xc8e0f4, 0.35);
    fogHex = lerpHexColor(fogHex, meta.isNight ? 0x182b4a : 0xd0e6f7, 0.4);
  } else if (weather === 'drought_weather') {
    if (!meta.isNight) {
      sunColorHex = lerpHexColor(sunColorHex, 0xffd28a, 0.3);
      skyHex = lerpHexColor(skyHex, 0xe8d0a3, 0.25);
      fogHex = lerpHexColor(fogHex, 0xe8d2aa, 0.25);
    }
  }

  return {
    phase,
    phaseLabelPt: meta.labelPt,
    isNight: meta.isNight,
    isTwilight: meta.isTwilight,
    sunAzimuthRad: base.sunAzimuthRad,
    sunElevationRad,
    sunColorHex,
    sunIntensity,
    hemiSkyHex,
    hemiGroundHex,
    hemiIntensity,
    rimColorHex: base.rimColorHex,
    rimIntensity: base.rimIntensity,
    skyHex,
    fogHex,
    fogNear,
    fogFar,
    waterTintHex,
    exposure,
    environmentIntensity,
    cityNightGlow: base.cityNightGlow,
    roadLampGlow: base.roadLampGlow,
    starVisibility: weather === 'storm' ? base.starVisibility * 0.25 : base.starVisibility,
  };
}
