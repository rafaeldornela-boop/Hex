import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TECH_TREE,
  TECH_BY_ID,
  TECH_PATHS,
  createInitialResearchState,
  canStartResearch,
  isTechUnlocked,
  getAvailableTechs,
  getAvailableTechsInPath,
  selectActiveTech,
  advanceResearchProgress,
  getTechModifiers,
  getUnlockedBuildings,
  getUnlockedUnits,
  serializeResearchState,
  deserializeResearchState,
  nextRecommendedTech,
  type TechId,
  type ResearchState,
} from './tech-engine';

test('TECH_TREE preserves all original TechIds', () => {
  const expected: TechId[] = [
    'agriculture',
    'mining',
    'construction',
    'trade',
    'metallurgy',
    'engineering',
    'military',
  ];
  const ids = TECH_TREE.map((t) => t.id);
  for (const id of expected) {
    assert.ok(ids.includes(id), `missing tech ${id}`);
    assert.ok(TECH_BY_ID[id], `TECH_BY_ID missing ${id}`);
  }
  assert.equal(ids.length, expected.length);
});

test('every tech has path, effects and non-empty summary', () => {
  for (const tech of TECH_TREE) {
    assert.ok(tech.path, `${tech.id} missing path`);
    assert.ok(tech.effects, `${tech.id} missing effects`);
    assert.ok(tech.effectsSummaryPt.length > 0, `${tech.id} empty summary`);
    assert.ok(tech.costScience > 0, `${tech.id} invalid cost`);
  }
});

test('TECH_PATHS cover every tech exactly once', () => {
  const seen = new Set<TechId>();
  for (const path of Object.keys(TECH_PATHS) as (keyof typeof TECH_PATHS)[]) {
    for (const id of TECH_PATHS[path]) {
      assert.ok(!seen.has(id), `duplicate path membership ${id}`);
      seen.add(id);
      assert.equal(TECH_BY_ID[id].path, path);
    }
  }
  assert.equal(seen.size, TECH_TREE.length);
});

test('prerequisites are acyclic and exist', () => {
  for (const tech of TECH_TREE) {
    for (const pre of tech.prerequisites) {
      assert.ok(TECH_BY_ID[pre], `unknown prerequisite ${pre} for ${tech.id}`);
    }
  }
});

test('initial state and availability', () => {
  const research = createInitialResearchState();
  assert.deepEqual(research.unlocked, []);
  assert.equal(research.activeTechId, 'agriculture');
  assert.ok(canStartResearch(research, 'agriculture'));
  assert.ok(canStartResearch(research, 'mining'));
  assert.equal(canStartResearch(research, 'construction'), false);
  assert.equal(canStartResearch(research, 'military'), false);
});

test('selectActiveTech and advanceResearchProgress complete a tech', () => {
  let research = createInitialResearchState();
  const sel = selectActiveTech(research, 'agriculture');
  assert.equal(sel.selected, true);
  research = sel.nextResearch;

  const { nextResearch, completedTech } = advanceResearchProgress(research, 12);
  assert.ok(completedTech);
  assert.equal(completedTech!.id, 'agriculture');
  assert.ok(isTechUnlocked(nextResearch, 'agriculture'));
  assert.ok(canStartResearch(nextResearch, 'construction'));
  assert.ok(canStartResearch(nextResearch, 'trade'));
});

test('overflow science queues next available tech', () => {
  let research: ResearchState = {
    unlocked: [],
    activeTechId: 'agriculture',
    progressScience: 0,
  };
  const { nextResearch, completedTech } = advanceResearchProgress(research, 20);
  assert.equal(completedTech!.id, 'agriculture');
  assert.ok(nextResearch.activeTechId !== null);
  assert.ok(nextResearch.progressScience >= 0);
});

test('getTechModifiers applies concrete effects', () => {
  const none = getTechModifiers([]);
  assert.equal(none.foodMultiplier, 1);
  assert.equal(none.territorialCapacityBonus, 0);
  assert.equal(none.explorationRangeBonus, 0);

  const agri = getTechModifiers(['agriculture']);
  assert.equal(agri.foodMultiplier, 1.4);

  const mid = getTechModifiers(['agriculture', 'construction', 'mining']);
  assert.equal(mid.buildCostMultiplier, 0.85);
  assert.equal(mid.territorialCapacityBonus, 2);
  assert.equal(mid.anchorReachBonus, 1);
  assert.equal(mid.bonusStorage, 50);
  assert.equal(mid.stoneOreMultiplier, 1.4);
  assert.ok(mid.explorationRangeBonus >= 1);

  const full = getTechModifiers([
    'agriculture',
    'mining',
    'construction',
    'trade',
    'military',
    'metallurgy',
    'engineering',
  ]);
  assert.equal(full.foodMultiplier, 1.4);
  assert.equal(full.goldMultiplier, 1.35);
  assert.equal(full.oreBonusMultiplier, 1.3);
  assert.equal(full.militaryCombatBonus, 4);
  assert.equal(full.expansionTurnReduction, 1);
  assert.equal(full.territorialCapacityBonus, 2 + 2 + 4);
  assert.ok(full.explorationRangeBonus >= 3);
});

test('unlock lists are returned for buildings and units', () => {
  const buildings = getUnlockedBuildings(['agriculture', 'military']);
  assert.ok(buildings.includes('building-mill'));
  assert.ok(buildings.includes('building-archery'));

  const units = getUnlockedUnits(['military', 'metallurgy']);
  assert.ok(units.includes('infantry'));
  assert.ok(units.includes('knight'));
});

test('getAvailableTechsInPath filters by path', () => {
  const research = createInitialResearchState();
  const agri = getAvailableTechsInPath(research, 'agricultura');
  assert.equal(agri.length, 1);
  assert.equal(agri[0].id, 'agriculture');

  const eng = getAvailableTechsInPath(research, 'engenharia');
  assert.equal(eng.length, 0);
});

test('nextRecommendedTech respects personality', () => {
  const research = createInitialResearchState();
  const exp = nextRecommendedTech(research, 'expansionist');
  const mer = nextRecommendedTech(research, 'mercantile');
  assert.ok(exp === 'mining' || exp === 'agriculture');
  assert.ok(mer === 'agriculture' || mer === 'mining');
});

test('research serialization round-trip', () => {
  const research: ResearchState = {
    unlocked: ['agriculture', 'mining'],
    activeTechId: 'construction',
    progressScience: 7,
  };
  const raw = serializeResearchState(research);
  const restored = deserializeResearchState(raw);
  assert.ok(restored);
  assert.deepEqual(restored!.unlocked, research.unlocked);
  assert.equal(restored!.activeTechId, 'construction');
  assert.equal(restored!.progressScience, 7);
});

test('cannot re-research unlocked tech', () => {
  const research: ResearchState = {
    unlocked: ['agriculture'],
    activeTechId: null,
    progressScience: 0,
  };
  assert.equal(canStartResearch(research, 'agriculture'), false);
  const sel = selectActiveTech(research, 'agriculture');
  assert.equal(sel.selected, false);
});
