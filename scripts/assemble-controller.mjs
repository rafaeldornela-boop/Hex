#!/usr/bin/env node
/**
 * Assembles HexSceneController.ts from split parts.
 * Used to recover after an accidental stub overwrite when the
 * full file cannot be pushed in a single GitHub API call.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const partsDir = path.join(root, 'scripts', 'controller-parts');
const outFile = path.join(root, 'components', 'game', 'HexSceneController.ts');

if (!fs.existsSync(partsDir)) {
  console.error('Missing scripts/controller-parts — skip assemble');
  process.exit(0);
}

const files = fs.readdirSync(partsDir).filter((f) => f.endsWith('.txt')).sort();
if (files.length === 0) {
  console.error('No controller parts found');
  process.exit(1);
}

const content = files.map((f) => fs.readFileSync(path.join(partsDir, f), 'utf8')).join('');
if (!content.includes('export class HexSceneController') && !content.includes('class HexSceneController')) {
  console.warn('Warning: assembled content may be incomplete');
}
if (content.includes('RESTORE_PLACEHOLDER') || content.length < 1000) {
  console.error('Assembled controller looks invalid, aborting');
  process.exit(1);
}

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, content);
console.log('Assembled HexSceneController.ts from', files.length, 'parts (', content.length, 'chars)');
