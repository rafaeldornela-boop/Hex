/**
 * Events Narrative 2.0 - generation, resolution, chronicle.
 * Catalog lives in events-catalog.ts.
 */

import {
  EVENT_CATALOG,
  type ActiveKingdomEvent,
  type ActiveWorldEffect,
  type EventDefinition,
  type EventHistoryEntry,
  type EventConsequence,
  type KingdomEventKind,
  type EventCategory,
  type EventRarity,
  type DecisionStyle,
  type EventChoiceOption,
  type EventCondition,
  type EventChoiceDefinition,
} from './events-catalog';
import { getEventImage, type EventImageCategory } from './event-images';

// Re-export catalog types for existing importers (kingdom-engine, turn-engine)
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
};
export { EVENT_CATALOG };

export interface EventWorldContext {
  turn: number;
  season?: import('./calendar-engine').SeasonId;
  weatherId?: string;
  farmCount?: number;
  mineCount?: number;
  portCount?: number;
  territoryCount?: number;
  hasTradeTech?: boolean;
  hasMilitaryTech?: boolean;
  defensePower?: number;
  foodDeficit?: boolean;
  foodStock?: number;
  gold?: number;
  goldNet?: number;
  population?: number;
  conflictActive?: boolean;
  explorationCount?: number;
  unlockedTechCount?: number;
  history?: EventHistoryEntry[];
  flags?: string[];
  scheduled?: Record<string, number>;
  cooldowns?: Record<string, number>;
  borderTarget?: { q: number; r: number };
  worldSeed?: number;
  /** Internal test/caller override to bypass probability gate when checking pure candidate selection */
  forceRoll?: boolean;
}

export interface EventResolution {
  goldDelta: number;
  foodDelta: number;
  woodDelta: number;
  oreDelta: number;
  stoneDelta: number;
  scienceDelta: number;
  populationDelta: number;
  effectsToAdd: ActiveWorldEffect[];
  outcomePt: string;
  historyEntry: EventHistoryEntry;
  setFlags: string[];
  clearFlags: string[];
  schedule: Record<string, number>;
  cooldownKey?: string;
  chronicleWorthy: boolean;
}

export interface ChronicleEntry {
  turn: number;
  titlePt: string;
  bodyPt: string;
  kind: KingdomEventKind;
  importance: 'minor' | 'major' | 'critical';
}

export interface NarrativeState {
  flags: string[];
  cooldowns: Record<string, number>;
  scheduled: Record<string, number>;
  chronicle: ChronicleEntry[];
}

const DEFINITION_BY_ID: Record<string, EventDefinition> = Object.fromEntries(
  EVENT_CATALOG.map((d) => [d.id, d])
);

export function createInitialNarrativeState(): NarrativeState {
  return { flags: [], cooldowns: {}, scheduled: {}, chronicle: [] };
}

export function serializeNarrativeState(state: NarrativeState): string {
  return JSON.stringify({ version: 1, ...state });
}

export function deserializeNarrativeState(raw: string): NarrativeState | null {
  try {
    const p = JSON.parse(raw) as Partial<NarrativeState>;
    return {
      flags: Array.isArray(p.flags) ? p.flags.filter((f) => typeof f === 'string') : [],
      cooldowns:
        p.cooldowns && typeof p.cooldowns === 'object'
          ? (p.cooldowns as Record<string, number>)
          : {},
      scheduled:
        p.scheduled && typeof p.scheduled === 'object'
          ? (p.scheduled as Record<string, number>)
          : {},
      chronicle: Array.isArray(p.chronicle) ? (p.chronicle as ChronicleEntry[]) : [],
    };
  } catch {
    return null;
  }
}

function hashTurnSeed(turn: number, seed: number): number {
  let h = (Math.imul(turn, 2654435761) ^ Math.imul(seed, 1597334677)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 2246822507) >>> 0;
  return h >>> 0;
}

function getLastEventCategory(ctx: EventWorldContext): EventCategory | null {
  const last = ctx.history?.[0];
  if (!last) return null;
  if (last.definitionId && DEFINITION_BY_ID[last.definitionId]) {
    return DEFINITION_BY_ID[last.definitionId]!.category;
  }
  const byKind = EVENT_CATALOG.find((d) => d.kind === last.kind);
  return byKind ? byKind.category : null;
}

function conditionsMet(def: EventDefinition, ctx: EventWorldContext): boolean {
  const c = def.conditions;
  if (c.minTurn !== undefined && ctx.turn < c.minTurn) return false;
  if (def.rarity === 'rare' && ctx.turn < 8) return false;
  if (def.rarity === 'legendary' && ctx.turn < 14) return false;
  if (c.seasons && (!ctx.season || !c.seasons.includes(ctx.season))) return false;
  if (c.weatherIds && (!ctx.weatherId || !c.weatherIds.includes(ctx.weatherId))) return false;
  if (c.minFarms !== undefined && (ctx.farmCount ?? 0) < c.minFarms) return false;
  if (c.minMines !== undefined && (ctx.mineCount ?? 0) < c.minMines) return false;
  if (c.requiresTrade && !ctx.hasTradeTech && (ctx.portCount ?? 0) < 1) return false;
  if (c.requiresMilitary && !ctx.hasMilitaryTech) return false;
  if (c.foodDeficit && !ctx.foodDeficit) return false;
  if (c.conflict && !ctx.conflictActive) return false;
  if (c.afterDefinitionId) {
    if (!(ctx.history ?? []).some((h) => h.definitionId === c.afterDefinitionId)) return false;
  }
  if (c.afterChoiceId) {
    if (!(ctx.history ?? []).some((h) => h.choiceId === c.afterChoiceId)) return false;
  }
  if (c.cooldownKey) {
    const last = ctx.cooldowns?.[c.cooldownKey];
    const cd = c.cooldownTurns ?? 8;
    const scheduledFor = ctx.scheduled?.[def.id];
    const explicitlyDue = typeof scheduledFor === 'number' && scheduledFor <= ctx.turn;
    if (!explicitlyDue && typeof last === 'number' && ctx.turn - last < cd) return false;
  }
  if (ctx.scheduled && ctx.scheduled[def.id] !== undefined) {
    if (ctx.turn < ctx.scheduled[def.id]!) return false;
  }
  return true;
}

/**
 * Computes organic, variable probability (0..0.95) for a non-scheduled event to trigger.
 * Target average cadence: ~5 to 8 turns, influenced by kingdom stress and development.
 */
export function computeEventTriggerProbability(ctx: EventWorldContext): number {
  const dueScheduled = Object.entries(ctx.scheduled ?? {}).some(
    ([id, t]) => t <= ctx.turn && Boolean(DEFINITION_BY_ID[id]) && conditionsMet(DEFINITION_BY_ID[id]!, ctx)
  );
  if (dueScheduled) return 1;

  if (ctx.turn < 4) return 0;

  const lastTurn = ctx.history?.[0]?.turn ?? 0;
  const gap = ctx.turn - lastTurn;

  const severeStress =
    Boolean(ctx.foodDeficit) ||
    Boolean(ctx.conflictActive) ||
    ctx.weatherId === 'drought_weather' ||
    ctx.weatherId === 'storm' ||
    ((ctx.gold ?? 200) < 70 && (ctx.goldNet ?? 0) < 0);

  // Breathing room so the player is never bombarded turn after turn
  if (gap < 4) {
    if (gap === 3 && severeStress) return 0.14;
    return 0;
  }

  let baseProb: number;
  if (gap === 4) baseProb = 0.10;
  else if (gap === 5) baseProb = 0.22;
  else if (gap === 6) baseProb = 0.36;
  else if (gap === 7) baseProb = 0.52;
  else if (gap === 8) baseProb = 0.70;
  else if (gap === 9) baseProb = 0.82;
  else baseProb = 0.92;

  // Contextual modifiers from world state
  let mod = 0;
  if (ctx.foodDeficit) mod += 0.10;
  if (ctx.conflictActive) mod += 0.08;
  if (ctx.weatherId === 'drought_weather' || ctx.weatherId === 'storm' || ctx.weatherId === 'frost') {
    mod += 0.07;
  }
  if ((ctx.gold ?? 200) < 80 || (ctx.goldNet ?? 0) < -15) mod += 0.06;
  if ((ctx.territoryCount ?? 0) >= 12 || (ctx.population ?? 0) >= 25) mod += 0.03;
  if ((ctx.unlockedTechCount ?? 0) >= 4) mod += 0.02;

  return Math.max(0, Math.min(0.95, Number((baseProb + mod).toFixed(3))));
}

function computeWeight(def: EventDefinition, ctx: EventWorldContext): number {
  let w = def.weight;
  const isExplicitlyDue =
    ctx.scheduled !== undefined &&
    ctx.scheduled[def.id] !== undefined &&
    ctx.turn >= ctx.scheduled[def.id]!;

  if (def.conditions.weatherIds && ctx.weatherId) {
    if (def.conditions.weatherIds.includes(ctx.weatherId)) w *= 1.65;
  }
  if (def.category === 'seasonal' && ctx.season) w *= 1.25;
  if (def.category === 'crisis') {
    if (ctx.foodDeficit) w *= 1.65;
    if ((ctx.gold ?? 200) < 80 || (ctx.goldNet ?? 0) < -15) w *= 1.35;
    if (ctx.weatherId === 'drought_weather' || ctx.weatherId === 'storm') w *= 1.35;
  }
  if (def.category === 'military' && ctx.conflictActive) w *= 1.5;
  if (def.category === 'economic' && (ctx.hasTradeTech || (ctx.portCount ?? 0) > 0)) w *= 1.25;
  if (def.category === 'political' && ((ctx.population ?? 0) >= 18 || (ctx.territoryCount ?? 0) >= 10)) {
    w *= 1.25;
  }
  if (def.category === 'exploration' && (ctx.explorationCount ?? 0) > 2) w *= 1.3;
  if (def.kind === 'tech' && (ctx.unlockedTechCount ?? 0) >= 2) w *= 1.2;

  // Rarity pacing: rare & legendary events should genuinely feel rare
  if (def.rarity === 'rare') w *= 0.36;
  if (def.rarity === 'legendary') w *= 0.18;

  // Avoid repeating the same category back-to-back unless scheduled
  if (!isExplicitlyDue) {
    const lastCat = getLastEventCategory(ctx);
    if (lastCat && lastCat === def.category) {
      w *= 0.08;
    }
    // Additional penalty if exact same event appeared in last 4 history entries
    const recentSame = (ctx.history ?? []).slice(0, 4).some((h) => h.definitionId === def.id);
    if (recentSame) {
      w *= 0.15;
    }
  } else {
    w += 80;
  }

  return Math.max(0, w);
}

export function materializeEvent(
  def: EventDefinition,
  turn: number,
  borderTarget?: { q: number; r: number }
): ActiveKingdomEvent {
  const img = getEventImage(def.imageCategory);
  return {
    id: `evt-${turn}-${def.id}`,
    turn,
    kind: def.kind,
    titlePt: def.titlePt,
    descriptionPt: def.descriptionPt,
    targetCoord: def.kind === 'invasion' ? borderTarget : undefined,
    resolved: false,
    choices: def.choices.map((ch) => ({
      id: ch.id,
      labelPt: ch.labelPt,
      descriptionPt: ch.descriptionPt,
      style: ch.style,
      costGoldHint: ch.requiresGold,
    })),
    category: def.category,
    rarity: def.rarity,
    priority: def.priority,
    imageCategory: def.imageCategory,
    imageSrc: img.src,
    durationTurns: def.durationTurns,
    chainId: def.chainId,
    chainStep: def.chainStep,
    definitionId: def.id,
  };
}

/**
 * Natural variable-cadence event generator (replaces rigid turn % 3 calendar).
 */
export function generateTurnEvent(
  turn: number,
  borderTarget?: { q: number; r: number },
  context?: Omit<EventWorldContext, 'turn' | 'borderTarget'>
): ActiveKingdomEvent | null {
  return generateContextualEvent({
    ...(context ?? {}),
    turn,
    borderTarget,
  });
}

export function generateContextualEvent(ctx: EventWorldContext): ActiveKingdomEvent | null {
  const last = ctx.history?.[0];
  if (last && last.turn === ctx.turn) return null;

  const dueScheduled = Object.entries(ctx.scheduled ?? {})
    .filter(([, t]) => t <= ctx.turn)
    .map(([id]) => id);

  if (dueScheduled.length === 0 && !ctx.forceRoll) {
    const triggerChance = computeEventTriggerProbability(ctx);
    if (triggerChance <= 0) return null;
    const gap = ctx.turn - (last?.turn ?? 0);
    const roll =
      hashTurnSeed(ctx.turn * 17 + gap * 31, (ctx.worldSeed ?? 42026) ^ 0x9e3779b9) /
      0x100000000;
    if (roll >= triggerChance) return null;
  }

  const candidates: { def: EventDefinition; weight: number }[] = [];
  for (const def of EVENT_CATALOG) {
    if (!conditionsMet(def, ctx)) continue;
    if (dueScheduled.length > 0 && !dueScheduled.includes(def.id)) continue;
    const w = computeWeight(def, ctx);
    if (w > 0) candidates.push({ def, weight: w });
  }
  if (candidates.length === 0) return null;

  // Prefer non-repeated categories strictly when alternatives exist (for non-scheduled events)
  let pool = candidates;
  if (dueScheduled.length === 0) {
    const lastCat = getLastEventCategory(ctx);
    if (lastCat) {
      const differentCat = candidates.filter((c) => c.def.category !== lastCat);
      if (differentCat.length > 0) pool = differentCat;
    }
  }

  const maxPriority = Math.max(...pool.map((c) => c.def.priority));
  const band = pool.filter((c) => c.def.priority >= maxPriority - 15);
  const total = band.reduce((s, c) => s + c.weight, 0);
  if (total <= 0) return null;

  let roll = hashTurnSeed(ctx.turn, ctx.worldSeed ?? 42026) % Math.max(1, Math.round(total));
  for (const c of band) {
    roll -= c.weight;
    if (roll < 0) return materializeEvent(c.def, ctx.turn, ctx.borderTarget);
  }
  return materializeEvent(band[band.length - 1]!.def, ctx.turn, ctx.borderTarget);
}

function applyConsequence(
  cons: EventConsequence,
  turn: number,
  choiceId: string
): Pick<
  EventResolution,
  | 'goldDelta'
  | 'foodDelta'
  | 'woodDelta'
  | 'oreDelta'
  | 'stoneDelta'
  | 'scienceDelta'
  | 'populationDelta'
  | 'effectsToAdd'
  | 'setFlags'
  | 'clearFlags'
  | 'schedule'
> {
  const effectsToAdd: ActiveWorldEffect[] = [];
  if (cons.effect) {
    effectsToAdd.push({
      id: cons.effect.id ?? `eff-${choiceId}-${turn}`,
      titlePt: cons.effect.titlePt,
      descriptionPt: cons.effect.descriptionPt,
      turnsRemaining: cons.effect.turnsRemaining,
      goldMultiplierMod: cons.effect.goldMultiplierMod,
      foodMultiplierMod: cons.effect.foodMultiplierMod,
      scienceBonusPerTurn: cons.effect.scienceBonusPerTurn,
      populationDeltaPerTurn: cons.effect.populationDeltaPerTurn,
      efficiencyPenalty: cons.effect.efficiencyPenalty,
    });
  }
  const schedule: Record<string, number> = {};
  if (cons.scheduleDefinitionId) {
    schedule[cons.scheduleDefinitionId] = turn + (cons.scheduleInTurns ?? 2);
  }
  return {
    goldDelta: cons.goldDelta ?? 0,
    foodDelta: cons.foodDelta ?? 0,
    woodDelta: cons.woodDelta ?? 0,
    oreDelta: cons.oreDelta ?? 0,
    stoneDelta: cons.stoneDelta ?? 0,
    scienceDelta: cons.scienceDelta ?? 0,
    populationDelta: cons.populationDelta ?? 0,
    effectsToAdd,
    setFlags: cons.setFlag ? [cons.setFlag] : [],
    clearFlags: cons.clearFlags ? [...cons.clearFlags] : [],
    schedule,
  };
}

export function resolveEventChoice(
  event: ActiveKingdomEvent,
  choiceId: string,
  ctx: Pick<EventWorldContext, 'turn' | 'gold' | 'defensePower'>
): EventResolution {
  const def =
    (event.definitionId ? DEFINITION_BY_ID[event.definitionId] : undefined) ??
    EVENT_CATALOG.find((d) => d.choices.some((c) => c.id === choiceId));

  const empty: EventResolution = {
    goldDelta: 0,
    foodDelta: 0,
    woodDelta: 0,
    oreDelta: 0,
    stoneDelta: 0,
    scienceDelta: 0,
    populationDelta: 0,
    effectsToAdd: [],
    outcomePt: 'Escolha de evento desconhecida.',
    historyEntry: {
      turn: event.turn,
      titlePt: event.titlePt,
      outcomePt: 'Escolha de evento desconhecida.',
      kind: event.kind,
      choiceId,
    },
    setFlags: [],
    clearFlags: [],
    schedule: {},
    chronicleWorthy: false,
  };

  if (!def) return empty;
  const choice = def.choices.find((c) => c.id === choiceId);
  if (!choice) return empty;

  const gold = ctx.gold ?? 0;
  const defense = ctx.defensePower ?? 0;
  const canPay =
    (choice.requiresGold === undefined || gold >= choice.requiresGold) &&
    (choice.requiresDefense === undefined || defense >= choice.requiresDefense);

  const cons = canPay ? choice.immediate : choice.fallback ?? choice.immediate;
  const partial = applyConsequence(cons, event.turn, choiceId);
  if (choice.hiddenSchedule) {
    partial.schedule[choice.hiddenSchedule.definitionId] =
      event.turn + choice.hiddenSchedule.inTurns;
  }

  const outcomePt = canPay
    ? choice.outcomePt
    : choice.fallbackOutcomePt ?? choice.outcomePt;

  const chronicleWorthy =
    def.rarity === 'rare' ||
    def.rarity === 'legendary' ||
    def.category === 'crisis' ||
    def.kind === 'invasion' ||
    def.kind === 'diplomatic' ||
    (def.chainStep !== undefined && def.chainStep >= 3);

  return {
    ...partial,
    outcomePt,
    historyEntry: {
      turn: event.turn,
      titlePt: event.titlePt,
      outcomePt,
      kind: event.kind,
      choiceId,
      definitionId: def.id,
      chainId: def.chainId,
    },
    cooldownKey: def.conditions.cooldownKey,
    chronicleWorthy,
  };
}

export function applyResolutionToNarrative(
  narrative: NarrativeState,
  resolution: EventResolution,
  turn: number,
  importance?: ChronicleEntry['importance']
): NarrativeState {
  const flags = new Set(narrative.flags);
  for (const f of resolution.clearFlags) flags.delete(f);
  for (const f of resolution.setFlags) flags.add(f);

  const cooldowns = { ...narrative.cooldowns };
  if (resolution.cooldownKey) cooldowns[resolution.cooldownKey] = turn;

  const scheduled = { ...narrative.scheduled };
  for (const [id, t] of Object.entries(resolution.schedule)) scheduled[id] = t;
  if (resolution.historyEntry.definitionId) {
    delete scheduled[resolution.historyEntry.definitionId];
  }

  let chronicle = narrative.chronicle;
  if (resolution.chronicleWorthy) {
    const imp =
      importance ??
      (resolution.historyEntry.kind === 'invasion' ||
      resolution.historyEntry.kind === 'rare'
        ? 'critical'
        : 'major');
    chronicle = [
      {
        turn,
        titlePt: resolution.historyEntry.titlePt,
        bodyPt: resolution.outcomePt,
        kind: resolution.historyEntry.kind,
        importance: imp,
      },
      ...chronicle,
    ].slice(0, 40);
  }

  return {
    flags: Array.from(flags),
    cooldowns,
    scheduled,
    chronicle,
  };
}

export function getEventDefinition(id: string): EventDefinition | undefined {
  return DEFINITION_BY_ID[id];
}

export function listEventDefinitions(): readonly EventDefinition[] {
  return EVENT_CATALOG;
}

export function getEventCatalogStats(): {
  total: number;
  byCategory: Record<string, number>;
  byRarity: Record<string, number>;
  chains: string[];
  choiceCount: number;
} {
  const byCategory: Record<string, number> = {};
  const byRarity: Record<string, number> = {};
  const chains = new Set<string>();
  let choiceCount = 0;
  for (const d of EVENT_CATALOG) {
    byCategory[d.category] = (byCategory[d.category] ?? 0) + 1;
    byRarity[d.rarity] = (byRarity[d.rarity] ?? 0) + 1;
    if (d.chainId) chains.add(d.chainId);
    choiceCount += d.choices.length;
  }
  return {
    total: EVENT_CATALOG.length,
    byCategory,
    byRarity,
    chains: Array.from(chains),
    choiceCount,
  };
}
