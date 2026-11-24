import test from 'node:test';
import assert from 'node:assert/strict';
import {
  README_MD,
  ROADMAP_MD,
  buildRepoUrl,
  filterHexAssets,
  generateGitSetupSteps,
  getCategoryCounts,
  sanitizeSlug,
  type HexAssetEntry,
} from './godot-docs';

test('sanitizeSlug removes invalid characters and falls back cleanly', () => {
  assert.equal(sanitizeSlug('  meu jogo hex! ', 'fallback'), 'meu-jogo-hex');
  assert.equal(sanitizeSlug('   ', 'default-repo'), 'default-repo');
});

test('buildRepoUrl formats HTTPS and SSH GitHub URLs correctly', () => {
  assert.equal(
    buildRepoUrl('rafaeldornela', 'hexagon-estudo', 'https'),
    'https://github.com/rafaeldornela/hexagon-estudo.git'
  );
  assert.equal(
    buildRepoUrl('rafaeldornela', 'hexagon-estudo', 'ssh'),
    'git@github.com:rafaeldornela/hexagon-estudo.git'
  );
});

test('generateGitSetupSteps switches between zip and clone workflows', () => {
  const zipSteps = generateGitSetupSteps({
    githubUser: 'rafaeldornela',
    repoName: 'meu-hex',
    protocol: 'https',
    mode: 'zip',
  });
  assert.equal(zipSteps.length, 3);
  assert.match(zipSteps[1].command, /unzip hexagon-world-starter\.zip -d meu-hex/);
  assert.match(
    zipSteps[2].command,
    /https:\/\/github\.com\/rafaeldornela\/meu-hex\.git/
  );

  const cloneSteps = generateGitSetupSteps({
    githubUser: 'rafaeldornela',
    repoName: 'meu-hex',
    protocol: 'ssh',
    mode: 'clone',
  });
  assert.equal(cloneSteps.length, 3);
  assert.match(cloneSteps[0].command, /rm -rf \.git/);
  assert.match(cloneSteps[2].command, /git@github\.com:rafaeldornela\/meu-hex\.git/);
});

test('filterHexAssets and getCategoryCounts filter accurately by category and query', () => {
  const sample: HexAssetEntry[] = [
    {
      file: 'building-house.tres',
      name: 'building-house',
      category: 'building',
      modelPath: 'res://models/Hexagons/building-house.glb',
      price: 0,
    },
    {
      file: 'bridge.tres',
      name: 'bridge',
      category: 'bridge',
      modelPath: 'res://models/Hexagons/bridge.glb',
      price: 100,
    },
    {
      file: 'grass-forest.tres',
      name: 'grass-forest',
      category: 'grass',
      modelPath: 'res://models/Hexagons/grass-forest.glb',
      price: 0,
    },
  ];

  assert.deepEqual(getCategoryCounts(sample), {
    all: 3,
    building: 1,
    bridge: 1,
    grass: 1,
  });

  assert.equal(filterHexAssets(sample, 'building', '').length, 1);
  assert.equal(filterHexAssets(sample, 'all', 'forest').length, 1);
  assert.equal(filterHexAssets(sample, 'bridge', 'house').length, 0);
});

test('README_MD and ROADMAP_MD contain all required sections and roadmap topics', () => {
  assert.match(README_MD, /Starter-Kit-Hexagon-World/);
  assert.match(README_MD, /Godot 4\.2/);
  assert.match(README_MD, /res:\/\/scenes\/main\.tscn/);

  const requiredTopics = [
    'Recursos por território',
    'Madeira',
    'Pedra',
    'Minério',
    'População',
    'Casas',
    'Trabalhadores',
    'Produção automática',
    'Dinheiro',
    'Expansão territorial',
    'Melhorias de construções',
    'Evolução da cidade',
  ];
  for (const topic of requiredTopics) {
    assert.ok(
      ROADMAP_MD.includes(topic),
      `ROADMAP_MD should include "${topic}"`
    );
  }
});
