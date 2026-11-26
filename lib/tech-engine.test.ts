import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TECH_TREE,
  TECH_BY_ID,
  TECH_PATHS,
  TECH_PATH_LABELS_PT,
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

test('TECH_TREE preserves all 7 original TechIds and expands to at least 24 technologies across 4 tiers and 6 paths', () => {
  const originalIds: TechId[] = [
    'agriculture',
    'mining',
    'construction',
    'trade',
    'metallurgy',
    'engineering',
    'military',
  ];
  const ids = TECH_TREE.map((t) => t.id);
  for (const id of originalIds) {
    assert.ok(ids.includes(id), `missing original tech ${id}`);
    assert.ok(TECH_BY_ID[id], `TECH_BY_ID missing ${id}`);
  }
  assert.ok(ids.length >= 24, `expected at least 24 technologies, got ${ids.length}`);
  assert.equal(new Set(ids).size, ids.length, 'duplicate tech IDs found');
  assert.equal(Object.keys(TECH_PATHS).length, 6, 'expected 6 specialization paths');

  const tiers = new Set(TECH_TREE.map((t) => t.tier));
  assert.deepEqual([...tiers].sort(), [1, 2, 3, 4], 'expected tiers 1..4');
});

test('every tech has path, label, effects, valid cost, and non-empty summary', () => {
  for (const tech of TECH_TREE) {
    assert.ok(tech.path, `${tech.id} missing path`);
    assert.ok(TECH_PATH_LABELS_PT[tech.path], `${tech.id} missing path label`);
    assert.ok(tech.effects && Object.keys(tech.effects).length > 0, `${tech.id} missing concrete effects`);
    assert.ok(tech.effectsSummaryPt.length > 0, `${tech.id} empty summary`);
    assert.ok(tech.costScience > 0, `${tech.id} invalid cost`);
  }
});

test('TECH_PATHS cover every tech exactly once with 4 tiers per path', () => {
  const seen = new Set<TechId>();
  for (const path of Object.keys(TECH_PATHS) as (keyof typeof TECH_PATHS)[]) {
    assert.equal(TECH_PATHS[path].length, 4, `path ${path} should have 4 tiers`);
    for (const id of TECH_PATHS[path]) {
      assert.ok(!seen.has(id), `duplicate path membership ${id}`);
      seen.add(id);
      assert.equal(TECH_BY_ID[id].path, path);
    }
  }
  assert.equal(seen.size, TECH_TREE.length);
});

test('prerequisites exist and form a valid acyclic DAG', () => {
  const visiting = new Set<TechId>();
  const visited = new Set<TechId>();

  function dfs(id: TechId) {
    assert.ok(!visiting.has(id), `cycle detected at ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    const def = TECH_BY_ID[id];
    assert.ok(def, `unknown tech ${id}`);
    for (const pre of def.prerequisites) {
      assert.ok(TECH_BY_ID[pre], `unknown prerequisite ${pre} for ${id}`);
      assert.ok(TECH_BY_ID[pre].tier <= def.tier, `prereq ${pre} tier exceeds ${id}`);
      dfs(pre);
    }
    visiting.delete(id);
    visited.add(id);
  }

  for (const tech of TECH_TREE) {
    dfs(tech.id);
  }
});

test('initial state exposes 6 tier-1 entry technologies across all paths', () => {
  const research = createInitialResearchState();
  assert.deepEqual(research.unlocked, []);
  assert.equal(research.activeTechId, 'agriculture');
  const available = getAvailableTechs(research);
  assert.equal(available.length, 6, 'all 6 tier-1 entry techs should be available initially');
  assert.ok(canStartResearch(research, 'agriculture'));
  assert.ok(canStartResearch(research, 'mining'));
  assert.ok(canStartResearch(research, 'masonry'));
  assert.ok(canStartResearch(research, 'barter'));
  assert.ok(canStartResearch(research, 'militia'));
  assert.ok(canStartResearch(research, 'scouting'));
  assert.equal(canStartResearch(research, 'construction'), false);
  assert.equal(canStartResearch(research, 'military'), false);
  assert.equal(canStartResearch(research, 'enlightenment'), false);
});

test('selectActiveTech and advanceResearchProgress complete a tech and unlock dependents', () => {
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
  assert.ok(canStartResearch(nextResearch, 'irrigation'));
});

test('overflow science queues next available tech', () => {
  const research: ResearchState = {
    unlocked: [],
    activeTechId: 'agriculture',
    progressScience: 0,
  };
  const { nextResearch, completedTech } = advanceResearchProgress(research, 20);
  assert.equal(completedTech!.id, 'agriculture');
  assert.ok(nextResearch.activeTechId !== null);
  assert.ok(nextResearch.progressScience >= 0);
});

test('getTechModifiers applies concrete effects for original and new Tech Tree 2.0 technologies', () => {
  const none = getTechModifiers([]);
  assert.equal(none.foodMultiplier, 1);
  assert.equal(none.woodMultiplier, 1);
  assert.equal(none.scienceMultiplier, 1);
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

  const legacyFull = getTechModifiers([
    'agriculture',
    'mining',
    'construction',
    'trade',
    'military',
    'metallurgy',
    'engineering',
  ]);
  assert.equal(legacyFull.foodMultiplier, 1.4);
  assert.equal(legacyFull.goldMultiplier, 1.35);
  assert.equal(legacyFull.oreBonusMultiplier, 1.3);
  assert.equal(legacyFull.militaryCombatBonus, 4);
  assert.equal(legacyFull.expansionTurnReduction, 1);
  assert.equal(legacyFull.territorialCapacityBonus, 2 + 2 + 4);
  assert.ok(legacyFull.explorationRangeBonus >= 3);

  // Verify new Tier 1..4 specialization effects
  const allTechs = getTechModifiers(TECH_TREE.map((t) => t.id));
  assert.ok(allTechs.foodMultiplier > 2.0);
  assert.ok(allTechs.woodMultiplier > 1.2);
  assert.ok(allTechs.metalMultiplier > 1.5);
  assert.ok(allTechs.scienceMultiplier > 2.0);
  assert.ok(allTechs.flatScienceBonus >= 6);
  assert.ok(allTechs.housingBonus >= 12);
  assert.ok(allTechs.foodDemandMultiplier < 0.85);
  assert.ok(allTechs.maintenanceMultiplier < 0.9);
  assert.ok(allTechs.unitUpkeepMultiplier < 0.8);
  assert.ok(allTechs.tradeRouteBonus >= 0.5);
  assert.ok(allTechs.tradeFeeReduction >= 0.2);
  assert.ok(allTechs.militaryCombatBonus >= 15);
  assert.ok(allTechs.defenseBonus >= 10);
  assert.equal(allTechs.unitMovementBonus, 1);
  assert.ok(allTechs.explorationRangeBonus >= 8);
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

  const conhecimento = getAvailableTechsInPath(research, 'conhecimento');
  assert.equal(conhecimento.length, 1);
  assert.equal(conhecimento[0].id, 'scouting');
});

test('nextRecommendedTech respects personality and 48-turn progression pacing', () => {
  let research = createInitialResearchState();
  const exp = nextRecommendedTech(research, 'expansionist');
  const mer = nextRecommendedTech(research, 'mercantile');
  assert.ok(exp !== null);
  assert.ok(mer !== null);
  assert.notEqual(exp, mer, 'different personalities should prefer different starting paths');

  // Simulate 48 turns of organic science progression (growing from 3 to 14 sci/turn)
  for (let turn = 1; turn <= 48; turn += 1) {
    const sciPerTurn = Math.round(3 + Math.min(11, turn * 0.22));
    if (!research.activeTechId) {
      const next = nextRecommendedTech(research, 'mercantile');
      if (next) research = selectActiveTech(research, next).nextResearch;
    }
    research = advanceResearchProgress(research, sciPerTurn).nextResearch;
  }

  // After 48 turns, player should have meaningful progression (7..16 techs) without exhausting all 24
  assert.ok(
    research.unlocked.length >= 6 && research.unlocked.length <= 18,
    `48-turn tech count should be paced (6..18), got ${research.unlocked.length}`
  );
  assert.ok(research.unlocked.length < TECH_TREE.length, 'should not unlock all 24 techs by turn 48');
});

test('research serialization round-trip preserves old and new tech IDs', () => {
  const research: ResearchState = {
    unlocked: ['agriculture', 'mining', 'scouting', 'cartography'],
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
