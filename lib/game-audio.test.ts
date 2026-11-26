import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  AMBIENT_TRACK_PATHS,
  DEFAULT_AUDIO_PREFERENCES,
  MUSIC_TRACK_PATHS,
  SFX_ASSET_PATHS,
  gameAudio,
  normalizeAudioPreferences,
  resolveAdaptiveMusicState,
} from './game-audio';

test('all referenced music, ambient, and SFX audio files exist under public/ and are non-empty', () => {
  const publicDir = path.join(process.cwd(), 'public');
  const allPaths = [
    ...Object.values(MUSIC_TRACK_PATHS),
    ...Object.values(AMBIENT_TRACK_PATHS),
    ...Object.values(SFX_ASSET_PATHS),
  ];

  assert.equal(Object.keys(MUSIC_TRACK_PATHS).length, 5);
  assert.equal(Object.keys(AMBIENT_TRACK_PATHS).length, 8);
  assert.equal(Object.keys(SFX_ASSET_PATHS).length, 11);

  for (const relPath of allPaths) {
    const absPath = path.join(publicDir, relPath.replace(/^\//, ''));
    assert.ok(fs.existsSync(absPath), `Missing audio asset: ${relPath}`);
    const stat = fs.statSync(absPath);
    assert.ok(stat.size > 2000, `Audio asset unexpectedly small (${stat.size} bytes): ${relPath}`);
  }

  assert.ok(
    fs.existsSync(path.join(publicDir, 'audio/LICENSES.md')),
    'Missing public/audio/LICENSES.md'
  );
});

test('normalizeAudioPreferences clamps volumes and preserves valid accessibility flags', () => {
  const normalized = normalizeAudioPreferences({
    masterVolume: 1.5,
    musicVolume: -0.4,
    sfxVolume: 0.65,
    ambientVolume: Number.NaN,
    muted: true,
    ambientEnabled: false,
    reduceAnimations: true,
    reduceEffects: true,
    textSize: 'large',
  });

  assert.equal(normalized.masterVolume, 1);
  assert.equal(normalized.musicVolume, 0);
  assert.equal(normalized.sfxVolume, 0.65);
  assert.equal(normalized.ambientVolume, DEFAULT_AUDIO_PREFERENCES.ambientVolume);
  assert.equal(normalized.muted, true);
  assert.equal(normalized.ambientEnabled, false);
  assert.equal(normalized.reduceAnimations, true);
  assert.equal(normalized.reduceEffects, true);
  assert.equal(normalized.textSize, 'large');
});

test('resolveAdaptiveMusicState transitions coherently by global kingdom state', () => {
  assert.equal(
    resolveAdaptiveMusicState({
      atWar: true,
      hasCrisis: true,
      hasFoodDeficit: false,
      lowGold: false,
      recentDiscovery: true,
      goldNet: 50,
      populationGrowth: 2,
      cityCount: 2,
    }),
    'war'
  );

  assert.equal(
    resolveAdaptiveMusicState({
      atWar: false,
      hasCrisis: false,
      hasFoodDeficit: true,
      lowGold: false,
      recentDiscovery: false,
      goldNet: 10,
      populationGrowth: 0,
      cityCount: 1,
    }),
    'crisis'
  );

  assert.equal(
    resolveAdaptiveMusicState({
      atWar: false,
      hasCrisis: false,
      hasFoodDeficit: false,
      lowGold: false,
      recentDiscovery: true,
      goldNet: 10,
      populationGrowth: 0,
      cityCount: 1,
    }),
    'discovery'
  );

  assert.equal(
    resolveAdaptiveMusicState({
      atWar: false,
      hasCrisis: false,
      hasFoodDeficit: false,
      lowGold: false,
      recentDiscovery: false,
      goldNet: 45,
      populationGrowth: 1,
      cityCount: 2,
    }),
    'prosperity'
  );

  assert.equal(
    resolveAdaptiveMusicState({
      atWar: false,
      hasCrisis: false,
      hasFoodDeficit: false,
      lowGold: false,
      recentDiscovery: false,
      goldNet: 5,
      populationGrowth: 0,
      cityCount: 1,
    }),
    'normal'
  );
});

test('gameAudio preferences update, notify subscribers, and all SFX methods are safe headless', () => {
  const observed: boolean[] = [];
  const unsub = gameAudio.subscribePreferences((p) => observed.push(p.muted));

  gameAudio.updatePreferences({ muted: true, reduceAnimations: true, textSize: 'large' });
  assert.equal(gameAudio.isMuted(), true);
  assert.equal(gameAudio.getPreferences().reduceAnimations, true);
  assert.equal(gameAudio.getPreferences().textSize, 'large');
  assert.deepEqual(observed, [true]);

  // All SFX & adaptive music/ambient calls should execute cleanly without AudioContext in Node/Bun
  gameAudio.setMusicState('prosperity', true);
  assert.equal(gameAudio.getMusicState(), 'prosperity');
  gameAudio.setAmbientBiome('rain');
  assert.equal(gameAudio.getAmbientBiome(), 'rain');

  gameAudio.playUiClick();
  gameAudio.playBuildStart();
  gameAudio.playBuildComplete();
  gameAudio.playUpgrade();
  gameAudio.playModuleInstall();
  gameAudio.playResearchComplete();
  gameAudio.playCombat();
  gameAudio.playDiscovery();
  gameAudio.playConquest();
  gameAudio.playTrade();
  gameAudio.playDecision();
  gameAudio.playError();
  gameAudio.playVictory();
  gameAudio.playDefeat();
  gameAudio.playSpecialEvent();
  gameAudio.playTurnAdvance();
  gameAudio.playSeasonChange();
  gameAudio.playDiplomacy();

  unsub();
  gameAudio.resetPreferences();
  assert.equal(gameAudio.isMuted(), false);
});
