import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateTurnEvent,
  generateContextualEvent,
  resolveEventChoice,
  materializeEvent,
  getEventDefinition,
  listEventDefinitions,
  getEventCatalogStats,
  createInitialNarrativeState,
  applyResolutionToNarrative,
  serializeNarrativeState,
  deserializeNarrativeState,
  type EventWorldContext,
} from './events-engine';
import {
  getEventImage,
  listEventImageCategories,
  type EventImageCategory,
} from './event-images';

test('catalog size, categories and chain', () => {
  const stats = getEventCatalogStats();
  assert.equal(stats.total, 21, `events: ${stats.total}`);
  // The imported grok/events-narrative branch currently has 42 choice records;
  // its accompanying contract says 48, so do not invent six gameplay choices here.
  assert.equal(stats.choiceCount, 42, `choices: ${stats.choiceCount}`);
  assert.ok(stats.chains.includes('drought_arc'));
  assert.ok((stats.byCategory.crisis ?? 0) >= 2);
  assert.ok((stats.byRarity.rare ?? 0) + (stats.byRarity.legendary ?? 0) >= 2);
});

test('generateTurnEvent cadence and determinism', () => {
  assert.equal(generateTurnEvent(1), null);
  assert.equal(generateTurnEvent(2), null);
  const a = generateTurnEvent(3);
  const b = generateTurnEvent(3);
  assert.ok(a);
  assert.equal(a!.id, b!.id);
  assert.ok(a!.choices.length >= 2);
  assert.equal(generateTurnEvent(4), null);
  assert.ok(generateTurnEvent(6));
});

test('legacy choice ids preserved', () => {
  const ids = new Set(listEventDefinitions().flatMap((d) => d.choices.map((c) => c.id)));
  for (const id of [
    'irrigate_fields', 'accept_drought', 'store_food', 'sell_surplus',
    'extract_minerals', 'study_findings', 'invest_caravan', 'decline_caravan',
    'fund_healers', 'quarantine_only', 'stabilize_treasury', 'absorb_crisis',
    'tax_relief', 'suppress_revolt', 'sponsor_academy', 'sell_manuscripts',
    'defend_borders', 'pay_tribute',
  ]) {
    assert.ok(ids.has(id), id);
  }
});

test('narrative texts are substantial', () => {
  for (const def of listEventDefinitions()) {
    assert.ok(def.descriptionPt.length > 50, def.id);
    assert.ok(!/você recebeu um evento/i.test(def.descriptionPt));
  }
});

test('trade contract uses net gold in resolution', () => {
  const def = getEventDefinition('classic_trade')!;
  const event = materializeEvent(def, 9);
  const rich = resolveEventChoice(event, 'invest_caravan', { turn: 9, gold: 500 });
  assert.equal(rich.goldDelta, 160);
  assert.equal(rich.woodDelta, 20);
  const poor = resolveEventChoice(event, 'invest_caravan', { turn: 9, gold: 0 });
  assert.equal(poor.goldDelta, 0);
});

test('drought chain schedules follow-up', () => {
  const def = getEventDefinition('drought_early_warning')!;
  const event = materializeEvent(def, 10);
  const res = resolveEventChoice(event, 'accept_drought', { turn: 10, gold: 1000, defensePower: 20 });
  assert.ok(res.effectsToAdd.some((e) => e.foodMultiplierMod === 0.7));
  assert.equal(res.schedule['drought_harvest_fail'], 12);
  let narrative = createInitialNarrativeState();
  narrative = applyResolutionToNarrative(narrative, res, 10);
  assert.ok(narrative.flags.includes('drought_ignored'));
  assert.ok(narrative.scheduled['drought_harvest_fail']);
});

test('drought warning requires dry weather when contextual conditions are evaluated', () => {
  const dry = generateContextualEvent({
    turn: 10, season: 'summer', weatherId: 'drought_weather', farmCount: 1, worldSeed: 7,
  });
  const clear = generateContextualEvent({
    turn: 10, season: 'summer', weatherId: 'clear', farmCount: 1, worldSeed: 7,
  });
  assert.equal(dry?.definitionId, 'drought_early_warning');
  assert.notEqual(clear?.definitionId, 'drought_early_warning');

  const periodicDry = generateTurnEvent(3, undefined, {
    season: 'summer', weatherId: 'drought_weather', farmCount: 1,
  });
  const periodicClear = generateTurnEvent(3, undefined, {
    season: 'summer', weatherId: 'clear', farmCount: 1,
  });
  assert.equal(periodicDry?.definitionId, 'drought_early_warning');
  assert.notEqual(periodicClear?.definitionId, 'drought_early_warning');
});

test('drought_arc completes all scheduled stages while sharing the campaign cooldown', () => {
  let narrative = createInitialNarrativeState();
  let history: NonNullable<EventWorldContext['history']> = [];
  const warning = materializeEvent(getEventDefinition('drought_early_warning')!, 10);
  const warningResolution = resolveEventChoice(warning, 'accept_drought', {
    turn: 10, gold: 1000, defensePower: 20,
  });
  narrative = applyResolutionToNarrative(narrative, warningResolution, 10);
  history = [warningResolution.historyEntry, ...history];
  assert.equal(narrative.cooldowns.drought_arc, 10);
  assert.equal(narrative.scheduled.drought_harvest_fail, 12);

  const contextAt = (turn: number): EventWorldContext => ({
    turn,
    season: 'summer',
    weatherId: 'drought_weather',
    farmCount: 1,
    worldSeed: 7,
    history,
    flags: narrative.flags,
    scheduled: narrative.scheduled,
    cooldowns: narrative.cooldowns,
  });

  const beforeStepTwo = generateContextualEvent(contextAt(11));
  assert.notEqual(beforeStepTwo?.definitionId, 'drought_harvest_fail');
  assert.notEqual(beforeStepTwo?.definitionId, 'drought_early_warning');
  const harvestFail = generateContextualEvent(contextAt(12));
  assert.equal(harvestFail?.definitionId, 'drought_harvest_fail');
  assert.equal(narrative.cooldowns.drought_arc, 10);

  const rationingResolution = resolveEventChoice(harvestFail!, 'ration_strict', {
    turn: 12, gold: 1000, defensePower: 20,
  });
  narrative = applyResolutionToNarrative(narrative, rationingResolution, 12);
  history = [rationingResolution.historyEntry, ...history];
  assert.equal(narrative.cooldowns.drought_arc, 12);
  assert.equal(narrative.scheduled.drought_famine_crisis, 15);

  const beforeStepThree = generateContextualEvent(contextAt(14));
  assert.notEqual(beforeStepThree?.definitionId, 'drought_famine_crisis');
  // The due chain stage must win even when an unrelated high-priority invasion is eligible.
  const famine = generateContextualEvent({
    ...contextAt(15),
    conflictActive: true,
    worldSeed: 3,
  });
  assert.equal(famine?.definitionId, 'drought_famine_crisis');

  const reliefResolution = resolveEventChoice(famine!, 'emergency_relief', {
    turn: 15, gold: 1000, defensePower: 20,
  });
  assert.deepEqual(reliefResolution.clearFlags, ['drought_ignored', 'rationing']);
  narrative = applyResolutionToNarrative(narrative, reliefResolution, 15);
  assert.ok(!narrative.flags.includes('drought_ignored'));
  assert.ok(!narrative.flags.includes('rationing'));
});

test('defense gate on invasion', () => {
  const event = materializeEvent(getEventDefinition('classic_invasion')!, 15, { q: 1, r: 0 });
  const success = resolveEventChoice(event, 'defend_borders', {
    turn: 15, gold: 500, defensePower: 20,
  });
  assert.equal(success.goldDelta, 180);
  const failure = resolveEventChoice(event, 'defend_borders', {
    turn: 15, gold: 500, defensePower: 5,
  });
  assert.equal(failure.goldDelta, -160);
  assert.equal(failure.populationDelta, -15);
  assert.match(failure.outcomePt, /−160 ouro, −15 pop/);
});

test('narrative persistence round-trip', () => {
  const n = createInitialNarrativeState();
  n.flags.push('foreign_trade_pact');
  n.cooldowns['harvest'] = 4;
  n.chronicle.push({ turn: 4, titlePt: 'Teste', bodyPt: 'Corpo', kind: 'rare', importance: 'major' });
  const back = deserializeNarrativeState(serializeNarrativeState(n));
  assert.ok(back);
  assert.deepEqual(back!.flags, ['foreign_trade_pact']);
  assert.equal(back!.cooldowns['harvest'], 4);
  assert.equal(back!.chronicle.length, 1);
});

test('chronicle only records worthy events', () => {
  const harvest = materializeEvent(getEventDefinition('classic_good_harvest')!, 6);
  const res = resolveEventChoice(harvest, 'store_food', { turn: 6, gold: 100 });
  assert.equal(res.chronicleWorthy, false);
  let n = createInitialNarrativeState();
  n = applyResolutionToNarrative(n, res, 6);
  assert.equal(n.chronicle.length, 0);
  const rare = materializeEvent(getEventDefinition('rare_ancient_site')!, 12);
  const rareRes = resolveEventChoice(rare, 'seal_site', { turn: 12, gold: 100 });
  assert.equal(rareRes.chronicleWorthy, true);
  n = applyResolutionToNarrative(n, rareRes, 12);
  assert.equal(n.chronicle.length, 1);
});

test('image library covers catalog categories', () => {
  const cats = new Set(listEventImageCategories());
  for (const def of listEventDefinitions()) {
    assert.ok(cats.has(def.imageCategory as EventImageCategory), def.imageCategory);
    assert.ok(getEventImage(def.imageCategory).src.startsWith('/event-images/'));
  }
});

test('ActiveKingdomEvent exposes image and definition fields', () => {
  const evt = generateTurnEvent(3);
  assert.ok(evt?.imageSrc);
  assert.ok(evt?.definitionId);
  assert.ok(evt?.category);
});
