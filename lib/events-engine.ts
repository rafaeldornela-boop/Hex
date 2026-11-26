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
  hasTradeTech?: boolean;
  hasMilitaryTech?: boolean;
  defensePower?: number;
  foodDeficit?: boolean;
  foodStock?: number;
  gold?: number;
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

function conditionsMet(def: EventDefinition, ctx: EventWorldContext): boolean {
  const c = def.conditions;
  if (c.minTurn !== undefined && ctx.turn < c.minTurn) return false;
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
    const cd = c.cooldownTurns ?? 6;
    const scheduledFor = ctx.scheduled?.[def.id];
    const explicitlyDue = typeof scheduledFor === 'number' && scheduledFor <= ctx.turn;
    if (!explicitlyDue && typeof last === 'number' && ctx.turn - last < cd) return false;
  }
  if (ctx.scheduled && ctx.scheduled[def.id] !== undefined) {
    if (ctx.turn < ctx.scheduled[def.id]!) return false;
  }
  return true;
}

function computeWeight(def: EventDefinition, ctx: EventWorldContext): number {
  let w = def.weight;
  if (def.conditions.weatherIds && ctx.weatherId) {
    if (def.conditions.weatherIds.includes(ctx.weatherId)) w *= 1.6;
  }
  if (def.category === 'seasonal' && ctx.season) w *= 1.3;
  if (def.category === 'crisis' && ctx.foodDeficit) w *= 1.5;
  if (def.category === 'military' && ctx.conflictActive) w *= 1.4;
  if (def.category === 'exploration' && (ctx.explorationCount ?? 0) > 3) w *= 1.25;
  if (def.rarity === 'rare') w *= 0.7;
  if (def.rarity === 'legendary') w *= 0.45;
  if (ctx.scheduled && ctx.scheduled[def.id] !== undefined && ctx.turn >= ctx.scheduled[def.id]!) {
    w += 50;
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

/** Legacy entry used by turn-engine - cadence every 3 turns from turn 3. */
export function generateTurnEvent(
  turn: number,
  borderTarget?: { q: number; r: number },
  context?: Omit<EventWorldContext, 'turn' | 'borderTarget'>
): ActiveKingdomEvent | null {
  if (turn < 3 || turn % 3 !== 0) return null;
  const classicOrder = [
    'drought_early_warning',
    'classic_good_harvest',
    'classic_discovery',
    'classic_trade',
    'classic_epidemic',
    'classic_economic_crisis',
    'classic_revolt',
    'classic_tech',
    'classic_invasion',
  ];
  const pick = turn === 3 ? 0 : hashTurnSeed(turn, 42026) % classicOrder.length;
  if (!context) {
    const def = DEFINITION_BY_ID[classicOrder[pick]!];
    return def ? materializeEvent(def, turn, borderTarget) : null;
  }

  const eventContext: EventWorldContext = { ...context, turn, borderTarget };
  for (let offset = 0; offset < classicOrder.length; offset += 1) {
    const id = classicOrder[(pick + offset) % classicOrder.length]!;
    const def = DEFINITION_BY_ID[id];
    if (def && conditionsMet(def, eventContext)) {
      return materializeEvent(def, turn, borderTarget);
    }
  }
  return null;
}

export function generateContextualEvent(ctx: EventWorldContext): ActiveKingdomEvent | null {
  if (ctx.turn < 3) return null;
  const last = ctx.history?.[0];
  if (last && last.turn === ctx.turn) return null;

  const dueScheduled = Object.entries(ctx.scheduled ?? {})
    .filter(([, t]) => t <= ctx.turn)
    .map(([id]) => id);

  const candidates: { def: EventDefinition; weight: number }[] = [];
  for (const def of EVENT_CATALOG) {
    if (!conditionsMet(def, ctx)) continue;
    if (dueScheduled.length > 0 && !dueScheduled.includes(def.id)) continue;
    const w = computeWeight(def, ctx);
    if (w > 0) candidates.push({ def, weight: w });
  }
  if (candidates.length === 0) return null;

  const maxPriority = Math.max(...candidates.map((c) => c.def.priority));
  const band = candidates.filter((c) => c.def.priority >= maxPriority - 15);
  const total = band.reduce((s, c) => s + c.weight, 0);
  if (total <= 0) return null;

  let roll = hashTurnSeed(ctx.turn, ctx.worldSeed ?? 42026) % total;
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
