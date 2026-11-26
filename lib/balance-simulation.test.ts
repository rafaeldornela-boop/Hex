import test from 'node:test';
import assert from 'node:assert/strict';
import { HEX_ASSETS } from './repo-data';
import { runKingdomSimulation, type SimulationStrategy } from './balance-simulation';

test('automated 192-turn simulations across all 5 strategies and multiple seeds remain finite and paced', () => {
  const strategies: SimulationStrategy[] = [
    'agricola',
    'minerador',
    'comercial',
    'militar',
    'urbano',
  ];
  const seeds = [42026, 777];

  const resultsByStrategy = new Map<SimulationStrategy, ReturnType<typeof runKingdomSimulation>>();

  for (const seed of seeds) {
    for (const strategy of strategies) {
      const res = runKingdomSimulation({
        strategy,
        seed,
        maxTurns: 192,
        assets: HEX_ASSETS,
      });

      assert.equal(res.checkpoints.length, 6, `Expected 6 checkpoints (12,24,48,96,144,192) for ${strategy}`);
      assert.deepEqual(
        res.checkpoints.map((c) => c.turn),
        [12, 24, 48, 96, 144, 192]
      );

      for (const cp of res.checkpoints) {
        assert.ok(Number.isFinite(cp.gold), `${strategy} T${cp.turn} gold finite`);
        assert.ok(Number.isFinite(cp.goldNet), `${strategy} T${cp.turn} goldNet finite`);
        assert.ok(Number.isFinite(cp.food), `${strategy} T${cp.turn} food finite`);
        assert.ok(Number.isFinite(cp.population) && cp.population >= 0, `${strategy} T${cp.turn} pop valid`);
        assert.ok(Number.isFinite(cp.militaryPower), `${strategy} T${cp.turn} militaryPower finite`);
        assert.ok(
          cp.victoryStatus === 'defeat' || cp.territoryCount >= 1,
          `${strategy} T${cp.turn} territory >= 1 while ongoing`
        );
      }

      // Early pacing check: player should NOT have all 7 techs unlocked by turn 24
      const t24 = res.checkpoints.find((c) => c.turn === 24)!;
      assert.ok(t24.techCount < 7, `${strategy} should not finish entire tech tree by turn 24 (got ${t24.techCount})`);

      if (seed === 42026) {
        resultsByStrategy.set(strategy, res);
      }
    }
  }

  // Strategy differentiation check on seed 42026
  const comercialT48 = resultsByStrategy.get('comercial')!.checkpoints.find((c) => c.turn === 48)!;
  const militarT48 = resultsByStrategy.get('militar')!.checkpoints.find((c) => c.turn === 48)!;
  assert.ok(
    comercialT48.gold >= militarT48.gold,
    `Comercial gold (${comercialT48.gold}) should be >= Militar gold (${militarT48.gold}) at T48`
  );
  assert.ok(
    militarT48.militaryPower >= comercialT48.militaryPower,
    `Militar power (${militarT48.militaryPower}) should be >= Comercial power (${comercialT48.militaryPower}) at T48`
  );
});
