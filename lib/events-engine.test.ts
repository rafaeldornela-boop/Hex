import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateTurnEvent,
  generateContextualEvent,
  computeEventTriggerProbability,
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

test('variable contextual event cadence averages 5-8 turns without rigid turn % 3 clock', () => {
  assert.equal(generateTurnEvent(1), null);
  assert.equal(generateTurnEvent(2), null);
  assert.equal(generateTurnEvent(3), null);

  // Simulate 100 turns across normal kingdom conditions
  const triggerTurns: number[] = [];
  const categories: string[] = [];
  let narrative = createInitialNarrativeState();
  let history: NonNullable<EventWorldContext['history']> = [];
  const seasons = ['spring', 'summer', 'autumn', 'winter'] as const;

  for (let turn = 1; turn <= 100; turn += 1) {
    const evt = generateContextualEvent({
      turn,
      season: seasons[Math.floor((turn - 1) / 4) % 4],
      weatherId: turn % 9 === 0 ? 'rain' : 'clear',
      farmCount: 2,
      mineCount: 1,
      portCount: 1,
      territoryCount: 10 + Math.floor(turn / 8),
      population: 14 + Math.floor(turn / 5),
      gold: 300,
      goldNet: 25,
      hasTradeTech: turn >= 16,
      hasMilitaryTech: turn >= 20,
      unlockedTechCount: Math.min(12, Math.floor(turn / 7)),
      history,
      flags: narrative.flags,
      scheduled: narrative.scheduled,
      cooldowns: narrative.cooldowns,
      worldSeed: 42026,
    });
    if (evt) {
      triggerTurns.push(turn);
      if (evt.category) categories.push(evt.category);
      const res = resolveEventChoice(evt, evt.choices[0]!.id, {
        turn,
        gold: 500,
        defensePower: 20,
      });
      narrative = applyResolutionToNarrative(narrative, res, turn);
      history = [res.historyEntry, ...history];
    }
  }

  assert.ok(triggerTurns.length >= 10 && triggerTurns.length <= 22, `Expected 10..22 events in 100 turns, got ${triggerTurns.length}`);
  // Must NOT be every 3 turns
  const allDivisibleBy3 = triggerTurns.every((t) => t % 3 === 0);
  assert.equal(allDivisibleBy3, false, 'Event cadence must not be a rigid turn % 3 schedule');

  // Compute average gap between events
  const gaps: number[] = [];
  for (let i = 1; i < triggerTurns.length; i += 1) {
    gaps.push(triggerTurns[i]! - triggerTurns[i - 1]!);
  }
  const avgGap = gaps.reduce((s, g) => s + g, 0) / gaps.length;
  assert.ok(avgGap >= 4.5 && avgGap <= 8.5, `Average event gap should be ~5-8 turns, got ${avgGap.toFixed(2)}`);

  // Consecutive same-category avoidance
  let consecutiveSame = 0;
  for (let i = 1; i < categories.length; i += 1) {
    if (categories[i] === categories[i - 1]) consecutiveSame += 1;
  }
  assert.ok(consecutiveSame <= 1, `Should avoid consecutive same-category events, got ${consecutiveSame}`);

  // Crisis stress boosts trigger probability vs calm kingdom
  const calmProb = computeEventTriggerProbability({
    turn: 12,
    history: [{ turn: 7, titlePt: 'Prev', outcomePt: 'Ok', kind: 'harvest' }],
    gold: 400,
    goldNet: 30,
  });
  const stressProb = computeEventTriggerProbability({
    turn: 12,
    history: [{ turn: 7, titlePt: 'Prev', outcomePt: 'Ok', kind: 'harvest' }],
    foodDeficit: true,
    conflictActive: true,
    weatherId: 'drought_weather',
    gold: 40,
    goldNet: -25,
  });
  assert.ok(stressProb > calmProb, `Stress prob (${stressProb}) should exceed calm prob (${calmProb})`);
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
    turn: 10, season: 'summer', weatherId: 'drought_weather', farmCount: 1, worldSeed: 7, forceRoll: true,
  });
  const clear = generateContextualEvent({
    turn: 10, season: 'summer', weatherId: 'clear', farmCount: 1, worldSeed: 7, forceRoll: true,
  });
  assert.equal(dry?.definitionId, 'drought_early_warning');
  assert.notEqual(clear?.definitionId, 'drought_early_warning');
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
  const evt = generateContextualEvent({ turn: 8, forceRoll: true, worldSeed: 42 });
  assert.ok(evt?.imageSrc);
  assert.ok(evt?.definitionId);
  assert.ok(evt?.category);
});
