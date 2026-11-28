#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const dir = path.join(root, 'scripts', 'season-restore');
const parts = [0,1,2].map(i => fs.readFileSync(path.join(dir, `part${i}.b64`), 'utf8').trim()).join('');
const buf = Buffer.from(parts, 'base64');
const out = path.join(root, 'lib', 'season-engine.ts');
fs.writeFileSync(out, buf);
console.log('Restored', out, 'bytes', buf.length);
if (!buf.toString('utf8').includes("forestDepleted'> | null")) {
  console.error('Missing forestDepleted Pick');
  process.exit(1);
}
