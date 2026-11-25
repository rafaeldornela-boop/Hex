export type SeasonId = 'spring' | 'summer' | 'autumn' | 'winter';

export const DAYS_PER_TURN = 2.5;
export const TURNS_PER_MONTH = 12; // 12 turns * 2.5 days = 30 days
export const TURNS_PER_SEASON = 12; // 12 turns per season -> 48 turns per complete 4-season year
export const SEASONS_PER_YEAR = 4;
export const TURNS_PER_YEAR = TURNS_PER_SEASON * SEASONS_PER_YEAR; // 48 turns

export const SEASON_ORDER: readonly SeasonId[] = [
  'spring',
  'summer',
  'autumn',
  'winter',
] as const;

export interface SeasonMeta {
  id: SeasonId;
  labelPt: string;
  shortPt: string;
  accentHex: string;
}

export const SEASON_META: Record<SeasonId, SeasonMeta> = {
  spring: {
    id: 'spring',
    labelPt: 'Primavera',
    shortPt: 'Prim.',
    accentHex: '#10b981',
  },
  summer: {
    id: 'summer',
    labelPt: 'Verão',
    shortPt: 'Verão',
    accentHex: '#f59e0b',
  },
  autumn: {
    id: 'autumn',
    labelPt: 'Outono',
    shortPt: 'Outono',
    accentHex: '#ea580c',
  },
  winter: {
    id: 'winter',
    labelPt: 'Inverno',
    shortPt: 'Inverno',
    accentHex: '#38bdf8',
  },
};

export interface CalendarSnapshot {
  turn: number;
  dayFloat: number;
  dayOfMonth: number; // 1..30
  monthOfYear: number; // 1..4 (each season spans 12 turns = 1 calendar month of 30 days)
  totalMonthsElapsed: number;
  year: number;
  season: SeasonId;
  seasonLabelPt: string;
  nextSeason: SeasonId;
  nextSeasonLabelPt: string;
  turnInSeason: number; // 1..12
  seasonProgress: number; // 0..1 across the 12 turns of the season
  turnsUntilNextSeason: number; // 1..12
  turnsUntilWinter: number; // 0 during winter, otherwise turns until next winter starts
  isWinterWarning: boolean;
  formattedDatePt: string;
  shortLabelPt: string;
}

export function getSeasonMeta(season: SeasonId): SeasonMeta {
  return SEASON_META[season];
}

export function getSeasonIndex(season: SeasonId): number {
  return SEASON_ORDER.indexOf(season);
}

/**
 * Deterministic calendar clock derived from the master turn counter:
 * - Each turn advances 2.5 days (12 turns = 30 days = 1 full month)
 * - Each season lasts exactly 12 turns (Primavera -> Verão -> Outono -> Inverno)
 * - 1 full year of 4 seasons = 48 turns
 */
export function computeCalendarSnapshot(rawTurn: number): CalendarSnapshot {
  const turn = Math.max(1, Math.round(Number.isFinite(rawTurn) ? rawTurn : 1));
  const zeroTurn = turn - 1;

  const year = Math.floor(zeroTurn / TURNS_PER_YEAR) + 1;
  const turnInYear = zeroTurn % TURNS_PER_YEAR;
  const seasonIdx = Math.floor(turnInYear / TURNS_PER_SEASON);
  const season = SEASON_ORDER[seasonIdx] ?? 'spring';
  const nextSeason = SEASON_ORDER[(seasonIdx + 1) % SEASON_ORDER.length] ?? 'spring';

  const turnInSeason = (turnInYear % TURNS_PER_SEASON) + 1; // 1..12
  const seasonProgress =
    TURNS_PER_SEASON > 1 ? (turnInSeason - 1) / (TURNS_PER_SEASON - 1) : 0;
  const turnsUntilNextSeason = TURNS_PER_SEASON - turnInSeason + 1;

  const monthOfYear = Math.floor(turnInYear / TURNS_PER_MONTH) + 1; // 1..4
  const totalMonthsElapsed = Math.floor(zeroTurn / TURNS_PER_MONTH) + 1;
  const turnInMonth = zeroTurn % TURNS_PER_MONTH;
  const dayFloat = turnInMonth * DAYS_PER_TURN + 1;
  const dayOfMonth = Math.min(30, Math.max(1, Math.floor(dayFloat)));

  const winterStartTurnInYear = 3 * TURNS_PER_SEASON; // turnInYear === 36 (turn 37)
  const turnsUntilWinter =
    season === 'winter' ? 0 : Math.max(1, winterStartTurnInYear - turnInYear);

  const seasonLabelPt = SEASON_META[season].labelPt;
  const nextSeasonLabelPt = SEASON_META[nextSeason].labelPt;
  const isWinterWarning = season !== 'winter' && turnsUntilWinter <= 12;

  return {
    turn,
    dayFloat,
    dayOfMonth,
    monthOfYear,
    totalMonthsElapsed,
    year,
    season,
    seasonLabelPt,
    nextSeason,
    nextSeasonLabelPt,
    turnInSeason,
    seasonProgress,
    turnsUntilNextSeason,
    turnsUntilWinter,
    isWinterWarning,
    formattedDatePt: `Ano ${year} · ${seasonLabelPt} · Dia ${dayOfMonth}`,
    shortLabelPt: `Ano ${year} · ${seasonLabelPt}`,
  };
}

export function normalizeCalendarSnapshot(
  raw: unknown,
  fallbackTurn: number
): CalendarSnapshot {
  if (raw && typeof raw === 'object' && typeof (raw as { turn?: unknown }).turn === 'number') {
    const savedTurn = Math.max(1, Math.round((raw as { turn: number }).turn));
    return computeCalendarSnapshot(savedTurn);
  }
  return computeCalendarSnapshot(fallbackTurn);
}
